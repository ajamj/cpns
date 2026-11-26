// Import View — validated JSON/CSV import with a smart-merge preview modal.
import { backupRepo, parseImportText } from '../db/repositories/backup';
import { questionsRepo } from '../db/repositories/questions';
import { t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import { openModal, closeModal } from '../core/modal';
import { detectConflicts, type ImportConflict, type MergeStrategy } from '../features/import-export/merge';
import type { ExportData, Question } from '../shared/types';
import type { ImportIssue } from '../features/import-export/schema';

function escapeHTML(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ImportView {
  private element: HTMLElement | null = null;
  private previewOverlay: HTMLElement | null = null;
  private mergeStrategy: MergeStrategy = 'smart';
  /** Full JSON backup retained so restore also covers progress and settings. */
  private fullBackup: ExportData | null = null;
  private previewData: Question[] = [];
  private conflicts: ImportConflict[] = [];
  private issues: ImportIssue[] = [];
  private conflictChoices = new Map<string, MergeStrategy>();
  private applying = false;

  constructor(_params: Record<string, string>) {
    // Route params are not needed by the import view.
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'import-view';
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    return this.element;
  }

  private getMergeStrategyButtons(): string {
    const strategies: MergeStrategy[] = ['smart', 'skip', 'overwrite', 'duplicate'];
    const icons: Record<MergeStrategy, string> = {
      smart: '🧠',
      skip: '⏭️',
      overwrite: '🔄',
      duplicate: '📋',
    };

    return strategies.map(strategy => `
      <button type="button" class="btn ${this.mergeStrategy === strategy ? 'btn-primary' : 'btn-secondary'}"
        data-strategy="${strategy}" style="flex:1;min-width:120px;" aria-pressed="${this.mergeStrategy === strategy}">
        ${icons[strategy]} ${escapeHTML(t('import.' + strategy))}
      </button>
    `).join('');
  }

  private getMergeStrategyHelp(): string {
    switch (this.mergeStrategy) {
      case 'smart':
        return 'ID sama → timpa; stem 90% mirip → flag review; ID baru → insert. User review yang diflag.';
      case 'skip':
        return 'Lewati soal yang ID-nya sudah ada.';
      case 'overwrite':
        return 'Timpa soal yang ID-nya sudah ada.';
      case 'duplicate':
        return 'Buat duplikat dengan ID baru untuk semua soal.';
    }
  }

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${escapeHTML(t('import.title'))}</h1>
        <p class="page-subtitle">${escapeHTML(t('import.dragDrop'))}</p>
      </div>

      <div class="card" style="max-width:800px;">
        <div class="card-content">
          <div id="dropZone" class="drop-zone" style="
            border:2px dashed var(--color-border);
            border-radius:var(--radius-lg);
            padding:var(--space-12);
            text-align:center;
            cursor:pointer;
          ">
            <input type="file" id="fileInput" accept=".json,.csv" hidden>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:var(--space-4);color:var(--color-text-muted);">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <h2 style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">${escapeHTML(t('import.dragDrop'))}</h2>
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);">Atau klik untuk memilih file JSON/CSV</p>
            <button class="btn btn-secondary" id="btnSelectFile" type="button">${escapeHTML(t('common.import'))}</button>
          </div>

          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--color-bg);border-radius:var(--radius-md);">
            <h3 style="font-size:var(--text-base);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">Format yang Didukung</h3>
            <ul style="font-size:var(--text-sm);color:var(--color-text-muted);line-height:var(--leading-relaxed);">
              <li><strong>JSON:</strong> Array soal atau backup lengkap (soal + progress + flashcard + pengaturan)</li>
              <li><strong>CSV:</strong> Satu baris per soal, opsi pada kolom A–E, jawaban benar berupa huruf (A,C)</li>
              <li><strong>Anki:</strong> Ekspor saja (.apkg); impor .apkg tidak didukung</li>
            </ul>
            <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-2);">
              Setiap baris divalidasi (maks. 2000 soal). Laporan kesalahan ditampilkan sebelum data ditulis.
            </p>
          </div>

          <div style="margin-top:var(--space-6);">
            <label class="form-label">${escapeHTML(t('import.mergeStrategy'))}</label>
            <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-2);">
              ${this.getMergeStrategyButtons()}
            </div>
            <p class="form-help" id="strategyHelp" style="margin-top:var(--space-2);">${escapeHTML(this.getMergeStrategyHelp())}</p>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    const dropZone = this.element.querySelector<HTMLElement>('#dropZone');
    const fileInput = this.element.querySelector<HTMLInputElement>('#fileInput');
    const selectBtn = this.element.querySelector<HTMLButtonElement>('#btnSelectFile');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, event => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => dropZone.classList.add('drag-over'));
    });
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
    });
    dropZone?.addEventListener('drop', event => {
      const files = (event as DragEvent).dataTransfer?.files;
      if (files?.length) void this.handleFile(files[0]!);
    });
    fileInput?.addEventListener('change', event => {
      const files = (event.target as HTMLInputElement).files;
      if (files?.length) void this.handleFile(files[0]!);
      (event.target as HTMLInputElement).value = '';
    });
    selectBtn?.addEventListener('click', () => fileInput?.click());

    this.element.querySelectorAll<HTMLButtonElement>('[data-strategy]').forEach(button => {
      button.addEventListener('click', () => {
        this.mergeStrategy = button.dataset.strategy as MergeStrategy;
        this.element?.querySelectorAll<HTMLButtonElement>('[data-strategy]').forEach(other => {
          const active = other.dataset.strategy === this.mergeStrategy;
          other.classList.toggle('btn-primary', active);
          other.classList.toggle('btn-secondary', !active);
          other.setAttribute('aria-pressed', String(active));
        });
        const help = this.element?.querySelector('#strategyHelp');
        if (help) help.textContent = this.getMergeStrategyHelp();
        this.refreshConflictChoices();
      });
    });
  }

  private async handleFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.json') && !name.endsWith('.csv')) {
      showToast('Format file tidak didukung. Gunakan .json atau .csv', 'error');
      return;
    }

    try {
      const parsed = parseImportText(await file.text(), file.name);
      this.previewData = parsed.questions;
      this.issues = parsed.issues;
      this.fullBackup = parsed.backup ?? null;
      this.conflictChoices.clear();
      const existing = await questionsRepo.getAll();
      this.conflicts = detectConflicts(this.previewData, existing);
      this.showPreviewModal();
    } catch (error) {
      showToast(`${t('error.importFailed', { error: error instanceof Error ? error.message : 'Unknown error' })}`, 'error');
    }
  }

  private getIssuesHTML(): string {
    if (this.issues.length === 0) return '';
    const shown = this.issues.slice(0, 25);
    return `
      <div style="padding:var(--space-4);background:var(--color-danger-light);border:1px solid var(--color-danger);border-radius:var(--radius-md);margin-bottom:var(--space-4);">
        <h3 style="font-size:var(--text-base);margin-bottom:var(--space-2);color:var(--color-danger);">
          ${escapeHTML(t('import.errors'))} (${this.issues.length})
        </h3>
        <ul style="font-size:var(--text-sm);line-height:var(--leading-relaxed);max-height:150px;overflow:auto;">
          ${shown.map(issue => `<li><strong>${escapeHTML(issue.path)}:</strong> ${escapeHTML(issue.message)}</li>`).join('')}
        </ul>
        ${this.issues.length > shown.length
          ? `<p style="font-size:var(--text-sm);color:var(--color-text-muted);">… dan ${this.issues.length - shown.length} kesalahan lainnya</p>`
          : ''}
      </div>
    `;
  }

  private getConflictsHTML(): string {
    if (this.conflicts.length === 0) return '';
    return `
      <div style="padding:var(--space-4);background:var(--color-warning-light);border:1px solid var(--color-warning);border-radius:var(--radius-md);margin-bottom:var(--space-4);">
        <h3 style="font-size:var(--text-base);margin-bottom:var(--space-2);color:var(--color-warning);">
          ⚠ ${this.conflicts.length} Konflik Terdeteksi
        </h3>
        <div style="max-height:240px;overflow:auto;">
          ${this.conflicts.map((conflict, index) => this.getConflictHTML(conflict, index)).join('')}
        </div>
      </div>
    `;
  }

  private getConflictHTML(conflict: ImportConflict, index: number): string {
    const id = conflict.incoming.id;
    const choice = this.conflictChoices.get(id);
    const action = (value: MergeStrategy, label: string): string => `
      <button type="button" class="btn btn-sm ${choice === value ? 'btn-primary' : 'btn-secondary'}"
        data-conflict-action="${value}" data-conflict-id="${escapeHTML(id)}">${escapeHTML(label)}</button>
    `;
    const kind = conflict.kind === 'id' ? 'ID sama' : `stem ${Math.round(conflict.similarity * 100)}% mirip`;
    return `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);">
        <div style="display:flex;justify-content:space-between;gap:var(--space-2);margin-bottom:var(--space-2);">
          <strong>${index + 1}. ${escapeHTML(kind)}</strong>
          <span style="font-size:var(--text-xs);color:var(--color-text-muted);">${escapeHTML(conflict.incoming.id.substring(0, 12))}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-2);">
          <div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${escapeHTML(t('import.incoming'))}</div>
            <div style="font-size:var(--text-sm);">${escapeHTML(conflict.incoming.stem.substring(0, 90))}</div>
          </div>
          <div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${escapeHTML(t('import.existing'))}</div>
            <div style="font-size:var(--text-sm);">${escapeHTML(conflict.existing.stem.substring(0, 90))}</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          ${action('overwrite', t('import.overwrite'))}
          ${action('skip', t('import.skip'))}
          ${action('duplicate', t('import.duplicate'))}
          <button type="button" class="btn btn-sm ${!choice ? 'btn-primary' : 'btn-secondary'}"
            data-conflict-action="auto" data-conflict-id="${escapeHTML(id)}">${escapeHTML(t('import.smart'))}</button>
        </div>
      </div>
    `;
  }

  private getPreviewTableHTML(): string {
    if (this.previewData.length === 0) return '<p style="color:var(--color-text-muted);">Tidak ada soal valid untuk ditampilkan.</p>';
    const rows = this.previewData.slice(0, 50).map(question => `
      <tr>
        <td style="font-family:monospace;font-size:var(--text-xs);">${escapeHTML(question.id.substring(0, 8))}…</td>
        <td>${escapeHTML(question.topicCode)}</td>
        <td style="max-width:300px;">${escapeHTML(question.stem.substring(0, 80))}${question.stem.length > 80 ? '…' : ''}</td>
        <td><span class="badge badge-difficulty-${question.difficulty}">${question.difficulty}</span></td>
        <td>${escapeHTML(question.source || '-')}</td>
      </tr>
    `).join('');
    const more = this.previewData.length > 50
      ? `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);">… dan ${this.previewData.length - 50} soal lainnya</td></tr>`
      : '';
    return `
      <div class="table-container" style="max-height:260px;overflow:auto;">
        <table class="table">
          <thead><tr><th>ID</th><th>Topik</th><th>Pertanyaan</th><th>Kesulitan</th><th>Sumber</th></tr></thead>
          <tbody>${rows}${more}</tbody>
        </table>
      </div>
    `;
  }

  private showPreviewModal(): void {
    closeModal(this.previewOverlay);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:900px;">
        <div class="modal-header">
          <h2 class="modal-title">${escapeHTML(t('import.preview'))}</h2>
          <button type="button" class="modal-close" id="importPreviewClose" aria-label="${escapeHTML(t('common.close'))}">×</button>
        </div>
        <div class="modal-body">
          <p style="margin-top:0;display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <span class="badge">${this.previewData.length} soal valid</span>
            <span class="badge">${this.issues.length} kesalahan</span>
            <span class="badge">${this.conflicts.length} konflik</span>
            <span class="badge">${escapeHTML(this.fullBackup ? 'Backup lengkap' : 'Soal saja')}</span>
          </p>
          ${this.getIssuesHTML()}
          ${this.getConflictsHTML()}
          <h3 style="font-size:var(--text-base);margin-bottom:var(--space-2);">${escapeHTML(t('import.preview'))}</h3>
          ${this.getPreviewTableHTML()}
        </div>
        <div class="modal-footer">
          <span style="font-size:var(--text-sm);color:var(--color-text-muted);flex:1;">${escapeHTML(this.getMergeStrategyHelp())}</span>
          <button type="button" class="btn btn-secondary" id="btnCancelImport">${escapeHTML(t('common.cancel'))}</button>
          <button type="button" class="btn btn-primary" id="btnApplyImport" ${this.issues.length || this.previewData.length === 0 ? 'disabled' : ''}>
            ${escapeHTML(t('import.apply'))}
          </button>
        </div>
      </div>
    `;
    this.previewOverlay = overlay;
    openModal(overlay);
    overlay.querySelector('#importPreviewClose')?.addEventListener('click', () => this.hidePreview());
    overlay.querySelector('#btnCancelImport')?.addEventListener('click', () => this.hidePreview());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.hidePreview();
    });
    overlay.addEventListener('keydown', event => {
      if ((event as KeyboardEvent).key === 'Escape') this.hidePreview();
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-conflict-action]').forEach(button => {
      button.addEventListener('click', () => this.selectConflictAction(button.dataset.conflictId ?? '', button.dataset.conflictAction));
    });
    overlay.querySelector('#btnApplyImport')?.addEventListener('click', () => void this.applyImport());
  }

  private selectConflictAction(id: string, action: string | undefined): void {
    if (!action) return;
    if (action === 'auto') this.conflictChoices.delete(id);
    else this.conflictChoices.set(id, action as MergeStrategy);
    this.refreshConflictChoices();
  }

  /** Reflect per-conflict overrides without rebuilding the whole modal. */
  private refreshConflictChoices(): void {
    if (!this.previewOverlay) return;
    this.previewOverlay.querySelectorAll<HTMLButtonElement>('[data-conflict-action]').forEach(button => {
      const id = button.dataset.conflictId ?? '';
      const choice = this.conflictChoices.get(id);
      const active = button.dataset.conflictAction === 'auto' ? !choice : choice === button.dataset.conflictAction;
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-secondary', !active);
    });
  }

  private hidePreview(): void {
    closeModal(this.previewOverlay);
    this.previewOverlay = null;
    this.previewData = [];
    this.issues = [];
    this.conflicts = [];
    this.conflictChoices.clear();
    this.fullBackup = null;
  }

  private async applyImport(): Promise<void> {
    if (this.applying || this.issues.length > 0 || this.previewData.length === 0) return;
    this.applying = true;
    const applyButton = this.previewOverlay?.querySelector<HTMLButtonElement>('#btnApplyImport');
    if (applyButton) applyButton.disabled = true;
    try {
      // A full backup restores every table explicitly present in the file;
      // CSV/array imports only carry `questions` so progress data is preserved.
      const backup: ExportData = this.fullBackup ?? {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: '1.0.0',
        data: { questions: this.previewData } as ExportData['data'],
      };
      const result = await backupRepo.restoreBackup(backup, {
        mergeStrategy: this.mergeStrategy,
        restoreSettings: !!this.fullBackup,
        strategyFor: question => this.conflictChoices.get(question.id),
      });

      if (result.restored) {
        const success = `${t('import.success', { count: result.counts.questions ?? 0 })}`;
        const details = result.warnings.length ? ` — ${result.warnings.join(', ')}` : '';
        showToast(`${success}${details}`, result.warnings.length ? 'warning' : 'success');
        this.hidePreview();
      } else {
        showToast(result.errors.join(', '), 'error');
        if (applyButton) applyButton.disabled = false;
      }
    } catch (error) {
      showToast(`${t('error.importFailed', { error: error instanceof Error ? error.message : 'Unknown error' })}`, 'error');
      if (applyButton) applyButton.disabled = false;
    } finally {
      this.applying = false;
    }
  }
}

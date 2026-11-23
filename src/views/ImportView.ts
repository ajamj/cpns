// Import View
import { backupRepo } from '../db/repositories/backup';
import { questionsRepo } from '../db/repositories/questions';
import { navigate, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import { generateId, nowISO } from '../core/utils';
import { parseCSV } from '../core/utils';
import type { Question } from '../shared/types';

export class ImportView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private mergeStrategy: 'skip' | 'overwrite' | 'duplicate' | 'smart' = 'smart';
  private previewData: Question[] = [];
  private conflicts: Array<{ incoming: Question; existing: Question }> = [];

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'import-view';
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    return this.element;
  }

  private getMergeStrategyButtons(): string {
    const strategies = ['smart', 'skip', 'overwrite', 'duplicate'];
    const icons: Record<string, string> = {
      smart: '🧠',
      skip: '⏭️',
      overwrite: '🔄',
      duplicate: '📋',
    };
    
    return strategies.map(s => `
      <button type="button" class="btn ${this.mergeStrategy === s ? 'btn-primary' : 'btn-secondary'}" data-strategy="${s}" style="flex:1;min-width:120px;">
        ${icons[s]} ${t('import.' + s)}
      </button>
    `).join('');
  }

  private getMergeStrategyHelp(): string {
    switch (this.mergeStrategy) {
      case 'smart':
        return 'ID sama → timpa; Stem 90% mirip → flag review; ID baru → insert. User review yang diflag.';
      case 'skip':
        return 'Lewati soal yang ID-nya sudah ada.';
      case 'overwrite':
        return 'Timpa soal yang ID-nya sudah ada.';
      case 'duplicate':
        return 'Buat duplikat dengan ID baru untuk semua soal.';
      default:
        return '';
    }
  }

  private getConflictsHTML(): string {
    if (this.conflicts.length === 0) return '';
    
    return `
      <div id="conflictsList" style="margin-bottom:var(--space-4);padding:var(--space-4);background:var(--color-warning-light);border:1px solid var(--color-warning);border-radius:var(--radius-md);">
        <h3 style="font-size:var(--text-base);margin-bottom:var(--space-2);color:var(--color-warning);">⚠ ${this.conflicts.length} Konflik Terdeteksi</h3>
        <div id="conflictsItems" style="max-height:200px;overflow:auto;">
          ${this.conflicts.map((c, i) => `
            <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);">
              <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-2);">
                <div style="flex:1;">
                  <strong>Masuk (${c.incoming.id.substring(0,8)}...)</strong>
                  <div style="font-size:var(--text-sm);color:var(--color-text-muted);">${c.incoming.stem.substring(0,100)}...</div>
                </div>
                <div style="flex:1;">
                  <strong>Ada (${c.existing.id.substring(0,8)}...)</strong>
                  <div style="font-size:var(--text-sm);color:var(--color-text-muted);">${c.existing.stem.substring(0,100)}...</div>
                </div>
              </div>
              <div style="display:flex;gap:var(--space-2);">
                <button class="btn btn-sm btn-secondary" data-action="skip" data-index="${i}">${t('import.skip')}</button>
                <button class="btn btn-sm btn-primary" data-action="overwrite" data-index="${i}">${t('import.overwrite')}</button>
                <button class="btn btn-sm btn-secondary" data-action="keep-both" data-index="${i}">${t('import.duplicate')}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private getPreviewTableHTML(): string {
    const rows = this.previewData.slice(0, 50).map(q => `
      <tr>
        <td style="font-family:monospace;font-size:var(--text-xs);">${q.id.substring(0,8)}...</td>
        <td><span class="badge badge-topic" style="--badge-topic-color:${this.getSubdomainColor(q.topicCode)};">${q.topicCode}</span></td>
        <td style="max-width:300px;">${q.stem.substring(0,80)}...</td>
        <td><span class="badge badge-difficulty-${q.difficulty}">${q.difficulty}</span></td>
        <td>${q.source || '-'}</td>
      </tr>
    `).join('');

    const moreRow = this.previewData.length > 50 
      ? `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);">... dan ${this.previewData.length - 50} soal lainnya</td></tr>`
      : '';

    return `
      <div class="table-container" style="max-height:300px;overflow:auto;">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Topik</th>
              <th>Pertanyaan</th>
              <th>Kesulitan</th>
              <th>Sumber</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${moreRow}
          </tbody>
        </table>
      </div>
    `;
  }

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('import.title')}</h1>
        <p class="page-subtitle">${t('import.dragDrop')}</p>
      </div>

      <div class="card" style="max-width:800px;">
        <div class="card-content">
          <!-- Drop Zone -->
          <div id="dropZone" class="drop-zone" style="
            border:2px dashed var(--color-border);
            border-radius:var(--radius-lg);
            padding:var(--space-12);
            text-align:center;
            cursor:pointer;
            transition:all var(--transition-fast);
          ">
            <input type="file" id="fileInput" accept=".json,.csv" hidden>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:var(--space-4);color:var(--color-text-muted);">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <h2 style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">${t('import.dragDrop')}</h2>
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);">Atau klik untuk memilih file JSON/CSV</p>
            <button class="btn btn-secondary" id="btnSelectFile">${t('common.import')}</button>
          </div>

          <!-- Format Info -->
          <div style="margin-top:var(--space-6);padding:var(--space-4);background:var(--color-bg);border-radius:var(--radius-md);">
            <h3 style="font-size:var(--text-base);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">Format yang Didukung</h3>
            <ul style="font-size:var(--text-sm);color:var(--color-text-muted);line-height:var(--leading-relaxed);">
              <li><strong>JSON:</strong> Full fidelity backup (soal + progress + flashcard + pengaturan)</li>
              <li><strong>CSV:</strong> Spreadsheet format (hanya soal, kolom: id,topicCode,stem,optionA-E,correctAnswer,explanation,difficulty,source,tags)</li>
            </ul>
          </div>

          <!-- Merge Strategy -->
          <div style="margin-top:var(--space-6);">
            <label class="form-label">${t('import.mergeStrategy')}</label>
            <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-2);">
              ${this.getMergeStrategyButtons()}
            </div>
            <p class="form-help" style="margin-top:var(--space-2);">
              ${this.getMergeStrategyHelp()}
            </p>
          </div>

          <!-- Preview Area -->
          <div id="previewArea" style="display:none;margin-top:var(--space-6);">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">${t('import.preview')}</h2>
                <span class="badge" id="previewCount">0 soal</span>
              </div>
              <div class="card-content" style="max-height:400px;overflow:auto;">
                ${this.getConflictsHTML()}
                <div id="previewTable"></div>
              </div>
              <div class="card-footer">
                <button class="btn btn-secondary" id="btnCancelImport">${t('common.cancel')}</button>
                <button class="btn btn-primary" id="btnApplyImport">${t('import.apply')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    const dropZone = this.element.querySelector('#dropZone') as HTMLElement;
    const fileInput = this.element.querySelector('#fileInput') as HTMLInputElement;
    const selectBtn = this.element.querySelector('#btnSelectFile') as HTMLButtonElement;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => dropZone.classList.add('drag-over'));
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone?.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
    });

    dropZone?.addEventListener('drop', (e) => {
      const files = (e as DragEvent).dataTransfer?.files;
      if (files?.length) this.handleFile(files[0]);
    });

    fileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) this.handleFile(files[0]);
    });

    selectBtn?.addEventListener('click', () => fileInput?.click());

    this.element.querySelectorAll('[data-strategy]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mergeStrategy = btn.dataset.strategy as any;
        this.element?.querySelectorAll('[data-strategy]').forEach(b => {
          b.classList.toggle('btn-primary', b === btn);
          b.classList.toggle('btn-secondary', b !== btn);
        });
        // Update help text
        const helpEl = this.element?.querySelector('.form-help');
        if (helpEl) helpEl.textContent = this.getMergeStrategyHelp();
        // Update button styles
        this.element?.querySelectorAll('[data-strategy]').forEach(b => {
          b.classList.toggle('btn-primary', b.dataset.strategy === this.mergeStrategy);
          b.classList.toggle('btn-secondary', b.dataset.strategy !== this.mergeStrategy);
        });
      });
    });

    this.element.querySelector('#btnCancelImport')?.addEventListener('click', () => this.hidePreview());
    this.element.querySelector('#btnApplyImport')?.addEventListener('click', () => this.applyImport());
  }

  private async handleFile(file: File): Promise<void> {
    if (!file.name.endsWith('.json') && !file.name.endsWith('.csv')) {
      showToast('Format file tidak didukung. Gunakan .json atau .csv', 'error');
      return;
    }

    try {
      const text = await file.text();
      let data: any;

      if (file.name.endsWith('.json')) {
        data = JSON.parse(text);
        if (data.schemaVersion && data.data) {
          this.previewData = data.data.questions || [];
        } else if (Array.isArray(data)) {
          this.previewData = data;
        } else {
          throw new Error('Format JSON tidak valid');
        }
      } else {
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error('CSV harus memiliki header dan minimal 1 baris data');
        this.previewData = await backupRepo.importFromCSV(text);
      }

      await this.detectConflicts();
      this.showPreview();
    } catch (error) {
      showToast(`${t('error.importFailed', { error: error instanceof Error ? error.message : 'Unknown error' })}`, 'error');
    }
  }

  private async detectConflicts(): Promise<void> {
    this.conflicts = [];
    
    for (const q of this.previewData) {
      const existing = await import('../db/repositories/questions').then(m => m.questionsRepo.getById(q.id));
      if (existing) {
        const similarity = this.calculateSimilarity(q.stem, existing.stem);
        if (similarity > 0.9) {
          this.conflicts.push({ incoming: q, existing });
        }
      }
    }
    this.showPreview();
  }

  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }

  private showPreview(): void {
    const previewArea = this.element?.querySelector('#previewArea') as HTMLElement;
    const previewCount = this.element?.querySelector('#previewCount') as HTMLElement;
    const conflictsList = this.element?.querySelector('#conflictsList') as HTMLElement;
    const conflictsItems = this.element?.querySelector('#conflictsItems') as HTMLElement;
    const previewTable = this.element?.querySelector('#previewTable') as HTMLElement;

    if (previewArea) previewArea.style.display = 'block';
    if (previewCount) previewCount.textContent = `${this.previewData.length} soal`;

    if (this.conflicts.length > 0) {
      if (conflictsList) conflictsList.style.display = 'block';
      if (conflictsItems) conflictsItems.innerHTML = this.getConflictsItemsHTML();
    } else {
      if (conflictsList) conflictsList.style.display = 'none';
    }

    if (previewTable) previewTable.innerHTML = this.getPreviewTableHTML();
    
    if (previewArea) previewArea.style.display = 'block';
  }

  private getConflictsItemsHTML(): string {
    return this.conflicts.map((c, i) => `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-2);">
        <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-2);">
          <div style="flex:1;">
            <strong>Masuk (${c.incoming.id.substring(0,8)}...)</strong>
            <div style="font-size:var(--text-sm);color:var(--color-text-muted);">${c.incoming.stem.substring(0,100)}...</div>
          </div>
          <div style="flex:1;">
            <strong>Ada (${c.existing.id.substring(0,8)}...)</strong>
            <div style="font-size:var(--text-sm);color:var(--color-text-muted);">${c.existing.stem.substring(0,100)}...</div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn-sm btn-secondary" data-action="skip" data-index="${i}">${t('import.skip')}</button>
          <button class="btn btn-sm btn-primary" data-action="overwrite" data-index="${i}">${t('import.overwrite')}</button>
          <button class="btn btn-sm btn-secondary" data-action="keep-both" data-index="${i}">${t('import.duplicate')}</button>
        </div>
      </div>
    `).join('');
  }

  private hidePreview(): void {
    const previewArea = this.element?.querySelector('#previewArea') as HTMLElement;
    if (previewArea) previewArea.style.display = 'none';
    this.previewData = [];
    this.conflicts = [];
  }

  private async applyImport(): Promise<void> {
    try {
      const result = await import('../db/repositories/backup').then(m => m.backupRepo.restoreBackup({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: '1.0.0',
        data: {
          questions: this.previewData,
          sessions: [],
          attempts: [],
          flashcards: [],
          settings: [],
          kisiKisi: [],
        }
      }, { mergeStrategy: this.mergeStrategy }));

      if (result.restored) {
        showToast(`${t('import.success', { count: result.counts.questions })}`, 'success');
        this.hidePreview();
        this.previewData = [];
        this.conflicts = [];
      } else {
        showToast(result.errors.join(', '), 'error');
      }
    } catch (error) {
      showToast(`${t('error.importFailed', { error: error instanceof Error ? error.message : 'Unknown error' })}`, 'error');
    }
  }

  private getSubdomainColor(code: string): string {
    if (code.startsWith('UM-')) return 'var(--subdomain-meteorology)';
    if (code.startsWith('KH-')) return 'var(--subdomain-climatology)';
    return 'var(--subdomain-default)';
  }
}
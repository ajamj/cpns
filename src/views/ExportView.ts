// Export View
import { backupRepo } from '../db/repositories/backup';
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { attemptsRepo } from '../db/repositories/attempts';
import { getKisiKisiSync } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import { downloadJSON } from '../core/utils';
import type { QuestionFilter, TopicCode } from '../shared/types';

/** CSV download with a UTF-8 BOM so spreadsheet apps read Indonesian text correctly. */
function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export class ExportView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private exportFormat: 'csv' | 'anki' = 'csv';
  private exportScope: 'all' | 'filtered' = 'all';
  private filter: QuestionFilter = {};

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  private getTopicOptionsHTML(): string {
    const topics = getKisiKisiSync();
    return topics.map(topic => `<option value="${topic.code}">${topic.code} - ${topic.title}</option>`).join('');
  }

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('export.title')}</h1>
        <p class="page-subtitle">${t('export.subtitle') || 'Ekspor data belajar Anda untuk backup atau analisis'}</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:var(--space-4);">
        <!-- Full Backup -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${t('export.json')}</h2>
          </div>
          <div class="card-content">
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);">Backup lengkap: soal, progress, flashcard, pengaturan, kisi-kisi</p>
            <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);">
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="includeProgress" checked>
                <span class="form-check-label">${t('export.includeProgress')}</span>
              </label>
            </div>
            <button class="btn btn-primary" id="btnExportFull" style="width:100%;">${t('export.download')}</button>
          </div>
        </div>

        <!-- Questions Export -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${t('export.csv')} / ${t('export.anki')}</h2>
          </div>
          <div class="card-content">
            <div class="form-group">
              <label class="form-label">${t('export.format')}</label>
              <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);">
                <button type="button" class="btn btn-primary" data-format="csv">${t('export.csv')}</button>
                <button type="button" class="btn btn-secondary" data-format="anki">${t('export.anki')}</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">${t('export.filtered')}</label>
              <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);">
                <button type="button" class="btn btn-primary" data-scope="all">${t('export.all')}</button>
                <button type="button" class="btn btn-secondary" data-scope="filtered">${t('export.filtered')}</button>
              </div>
            </div>

            <div id="filterSection" style="display:none;margin-top:var(--space-4);padding:var(--space-4);background:var(--color-bg);border-radius:var(--radius-md);">
              <h3 style="font-size:var(--text-base);margin-bottom:var(--space-3);">Filter Ekspor</h3>
              <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
                <select id="exportTopicFilter" class="form-select" style="min-width:200px;">
                  <option value="">${t('filter.all')}</option>
                  ${getKisiKisiSync().map(topic => `<option value="${topic.code}">${topic.code} - ${topic.title}</option>`).join('')}
                </select>
                <select id="exportDifficultyFilter" class="form-select" style="min-width:150px;">
                  <option value="">${t('filter.all')}</option>
                  <option value="1">${t('difficulty.1')}</option>
                  <option value="2">${t('difficulty.2')}</option>
                  <option value="3">${t('difficulty.3')}</option>
                </select>
                <select id="exportMasteryFilter" class="form-select" style="min-width:150px;" multiple>
                  <option value="0">${t('mastery.0')}</option>
                  <option value="1">${t('mastery.1')}</option>
                  <option value="2">${t('mastery.2')}</option>
                  <option value="3">${t('mastery.3')}</option>
                </select>
              </div>
            </div>

            <button class="btn btn-primary" id="btnExportQuestions" style="width:100%;margin-top:var(--space-4);">${t('export.download')}</button>
          </div>
        </div>

        <!-- All entities as separate CSV files -->
        <div class="card" style="grid-column:1/-1;">
          <div class="card-header">
            <h2 class="card-title">${t('export.csv.all')}</h2>
          </div>
          <div class="card-content">
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);">${t('export.csv.allDesc')}</p>
            <button class="btn btn-primary" id="btnExportAllCSV" style="width:100%;">${t('export.csv.all')}</button>
          </div>
        </div>

        <!-- Per-entity CSV / analytics export -->
        <div class="card" style="grid-column:1/-1;">
          <div class="card-header">
            <h2 class="card-title">Ekspor Data Lainnya</h2>
          </div>
          <div class="card-content">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:var(--space-4);">
              <div class="card" style="border:1px solid var(--color-border);">
                <div class="card-content" style="padding:var(--space-4);text-align:center;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.5" style="margin-bottom:var(--space-2);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <h3 style="font-size:var(--text-sm);margin-bottom:var(--space-1);">${t('export.csv.sessions')}</h3>
                  <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">${t('export.csv.sessionsDesc')}</p>
                  <button class="btn btn-secondary" id="btnExportSessions" style="width:100%;">${t('export.csv.button')}</button>
                </div>
              </div>
              <div class="card" style="border:1px solid var(--color-border);">
                <div class="card-content" style="padding:var(--space-4);text-align:center;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="1.5" style="margin-bottom:var(--space-2);"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/></svg>
                  <h3 style="font-size:var(--text-sm);margin-bottom:var(--space-1);">${t('export.csv.flashcards')}</h3>
                  <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">${t('export.csv.flashcardsDesc')}</p>
                  <button class="btn btn-secondary" id="btnExportFlashcards" style="width:100%;">${t('export.csv.button')}</button>
                </div>
              </div>
              <div class="card" style="border:1px solid var(--color-border);">
                <div class="card-content" style="padding:var(--space-4);text-align:center;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="1.5" style="margin-bottom:var(--space-2);"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  <h3 style="font-size:var(--text-sm);margin-bottom:var(--space-1);">${t('export.csv.attempts')}</h3>
                  <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">${t('export.csv.attemptsDesc')}</p>
                  <button class="btn btn-secondary" id="btnExportAttempts" style="width:100%;">${t('export.csv.button')}</button>
                </div>
              </div>
              <div class="card" style="border:1px solid var(--color-border);">
                <div class="card-content" style="padding:var(--space-4);text-align:center;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="1.5" style="margin-bottom:var(--space-2);"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  <h3 style="font-size:var(--text-sm);margin-bottom:var(--space-1);">${t('export.report.title')}</h3>
                  <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">${t('export.report.desc')}</p>
                  <button class="btn btn-secondary" id="btnExportReport" style="width:100%;">${t('export.report.generate')}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'export-view';
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    return this.element;
  }

  private bindEvents(): void {
    if (!this.element) return;

    this.element.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.exportFormat = btn.dataset.format === 'anki' ? 'anki' : 'csv';
        this.element?.querySelectorAll('[data-format]').forEach(b => {
          b.classList.toggle('btn-primary', b === btn);
          b.classList.toggle('btn-secondary', b !== btn);
        });
      });
    });

    this.element.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.exportScope = btn.dataset.scope === 'filtered' ? 'filtered' : 'all';
        this.element?.querySelectorAll('[data-scope]').forEach(b => {
          b.classList.toggle('btn-primary', b === btn);
          b.classList.toggle('btn-secondary', b !== btn);
        });
        const filterSection = this.element?.querySelector('#filterSection') as HTMLElement;
        if (filterSection) filterSection.style.display = this.exportScope === 'filtered' ? 'block' : 'none';
        if (this.exportScope === 'all') this.filter = {};
      });
    });

    this.element.querySelector('#btnExportFull')?.addEventListener('click', async () => {
      const includeProgress = (this.element?.querySelector('#includeProgress') as HTMLInputElement)?.checked ?? true;
      const backup = await import('../db/repositories/backup').then(m => m.backupRepo.createBackup());
      if (!includeProgress) {
        backup.data.sessions = [];
        backup.data.attempts = [];
        backup.data.flashcards = [];
      }
      downloadJSON(backup, `cpns-full-backup-${new Date().toISOString().split('T')[0]}.json`);
      showToast('Backup lengkap diunduh', 'success');
    });

    this.element.querySelector('#btnExportQuestions')?.addEventListener('click', async () => {
      try {
        if (this.exportFormat === 'csv') {
          await backupRepo.downloadQuestionsCSV(this.filter);
          showToast('CSV soal diunduh', 'success');
        } else {
          const count = await backupRepo.downloadQuestionsAnki(this.filter);
          showToast(`${count} soal diekspor ke Anki (.apkg)`, 'success');
        }
      } catch (error) {
        showToast(`Ekspor gagal: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });

    this.element.querySelector('#btnExportSessions')?.addEventListener('click', () => {
      void this.exportEntity('sessions', t('export.csv.sessions'));
    });

    this.element.querySelector('#btnExportFlashcards')?.addEventListener('click', () => {
      void this.exportEntity('flashcards', t('export.csv.flashcards'));
    });

    this.element.querySelector('#btnExportAttempts')?.addEventListener('click', () => {
      void this.exportEntity('attempts', t('export.csv.attempts'));
    });

    this.element.querySelector('#btnExportAllCSV')?.addEventListener('click', () => {
      void this.exportAllCSV();
    });

    this.element.querySelector('#btnExportReport')?.addEventListener('click', () => {
      navigate('analytics');
    });

    this.element.querySelector('#exportTopicFilter')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.filter.topicCodes = value ? [value as TopicCode] : undefined;
    });
    this.element.querySelector('#exportDifficultyFilter')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.filter.difficulty = value ? parseInt(value, 10) as 1 | 2 | 3 : undefined;
    });
    this.element.querySelector('#exportMasteryFilter')?.addEventListener('change', (e) => {
      this.filter.masteryLevels = Array.from((e.target as HTMLSelectElement).selectedOptions)
        .map(o => parseInt(o.value, 10) as 0 | 1 | 2 | 3);
    });
  }

  private getEntityCSV(entity: 'questions' | 'sessions' | 'attempts' | 'flashcards'): Promise<string> {
    switch (entity) {
      case 'questions': return questionsRepo.exportCSV();
      case 'sessions': return sessionsRepo.exportCSV();
      case 'attempts': return attemptsRepo.exportCSV();
      case 'flashcards': return flashcardsRepo.exportCSV();
    }
  }

  private async exportEntity(entity: 'questions' | 'sessions' | 'attempts' | 'flashcards', label: string): Promise<void> {
    try {
      const csv = await this.getEntityCSV(entity);
      if (csv.split('\n').length <= 1) {
        showToast(t('export.csv.empty'), 'error');
        return;
      }
      downloadCSV(csv, `cpns-${entity}-${new Date().toISOString().split('T')[0]}.csv`);
      showToast(t('export.csv.done', { entity: label }), 'success');
    } catch (error) {
      showToast(`Ekspor gagal: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /** Four sequential downloads from a single click; spacing avoids browser throttling. */
  private async exportAllCSV(): Promise<void> {
    const entities = [
      { key: 'questions', label: t('nav.questions') },
      { key: 'sessions', label: t('export.csv.sessions') },
      { key: 'flashcards', label: t('export.csv.flashcards') },
      { key: 'attempts', label: t('export.csv.attempts') },
    ] as const;

    try {
      const date = new Date().toISOString().split('T')[0];
      for (const [index, entity] of entities.entries()) {
        const csv = await this.getEntityCSV(entity.key);
        downloadCSV(csv, `cpns-${entity.key}-${date}.csv`);
        if (index < entities.length - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 150));
        }
      }
      showToast(t('export.csv.allDone'), 'success');
    } catch (error) {
      showToast(`Ekspor gagal: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
}
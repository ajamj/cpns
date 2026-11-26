// Trash View — soft-deleted questions with separate restore / purge bulk actions.
import { questionsRepo, TRASH_RETENTION_DAYS } from '../db/repositories/questions';
import { t } from '../core/i18n';
import { navigateToHash } from '../core/router';
import { showToast } from '../core/app-utils';
import type { Question } from '../shared/types';

/** Re-exported for callers/tests; the value is owned by the repository. */
export { TRASH_RETENTION_DAYS };
const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Question stems come from imports/user input: never inject them as HTML. */
function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function deletedAtMs(q: Question): number {
  return new Date(q.deletedAt ?? '').getTime();
}

function isExpired(q: Question): boolean {
  const deleted = deletedAtMs(q);
  return Number.isFinite(deleted) && deleted < Date.now() - RETENTION_MS;
}

function daysUntilPurge(q: Question): number {
  const deleted = deletedAtMs(q);
  return Math.max(0, Math.ceil((deleted + RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)));
}

export class TrashView {
  private element: HTMLElement | null = null;
  private questions: Question[] = [];
  private selectedIds: Set<string> = new Set();

  constructor(_params: Record<string, string>) {
    // Trash has no route params; the constructor signature matches other views.
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'trash-view';
    this.element.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${escapeHTML(t('qb.trash'))}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;

    void this.loadQuestions().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });

    return this.element;
  }

  private async loadQuestions(): Promise<void> {
    this.questions = await questionsRepo.getTrash();
    // Drop selections for rows that were purged (e.g. by the app-load purge).
    const available = new Set(this.questions.map(q => q.id));
    for (const id of this.selectedIds) {
      if (!available.has(id)) this.selectedIds.delete(id);
    }
  }

  private getHTML(): string {
    const expiredCount = this.questions.filter(isExpired).length;
    const allSelected = this.questions.length > 0 && this.selectedIds.size === this.questions.length;
    const selectedCount = this.selectedIds.size;

    return `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;">
        <div>
          <h1 class="page-title">${escapeHTML(t('qb.trash'))}</h1>
          <p class="page-subtitle">
            ${escapeHTML(t('qb.trashSubtitle', { count: this.questions.length }))}
            ${expiredCount > 0 ? ` • ${escapeHTML(t('qb.trashExpiredNote', { count: expiredCount }))}` : ''}
          </p>
        </div>
        <button class="btn btn-secondary btn-sm" id="btnBackToBank">${escapeHTML(t('qb.backToBank'))}</button>
      </div>

      ${selectedCount > 0 ? `
        <div class="card" style="margin-bottom:var(--space-4);background:var(--color-warning-light);border-color:var(--color-warning);">
          <div class="card-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="selectAllTrash" ${allSelected ? 'checked' : ''}>
                <span class="form-check-label">${escapeHTML(t('qb.selectAll'))} (${this.questions.length})</span>
              </label>
              <span style="color:var(--color-warning);font-weight:var(--font-medium);">${escapeHTML(t('qb.selectedCount', { count: selectedCount }))}</span>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-primary btn-sm" id="btnRestoreSelected">${escapeHTML(t('qb.restore'))}</button>
              <button class="btn btn-danger btn-sm" id="btnPurgeSelected">${escapeHTML(t('qb.purge'))}</button>
              <button class="btn btn-ghost btn-sm" id="btnClearSelectionTrash">${escapeHTML(t('qb.deselectAll'))}</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${expiredCount > 0 ? `
        <div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-danger);background:var(--color-danger-light);">
          <div class="card-content" style="display:flex;align-items:flex-start;gap:var(--space-3);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <strong style="color:var(--color-danger);">${escapeHTML(t('qb.autoPurge'))}</strong>
              <div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-1);">${escapeHTML(t('qb.autoPurgeImminent', { count: expiredCount }))}</div>
            </div>
          </div>
        </div>
      ` : ''}

      ${this.questions.length === 0 ? `
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-12);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64" style="margin-bottom:var(--space-4);opacity:0.5;">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <h2 style="font-size:var(--text-xl);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">${escapeHTML(t('qb.trashEmpty'))}</h2>
            <p style="color:var(--color-text-muted);">${escapeHTML(t('qb.trashEmptyDesc'))}</p>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th style="width:40px;"><input type="checkbox" class="form-check-input" id="selectAllTrashHeader" aria-label="${escapeHTML(t('qb.selectAll'))}" ${allSelected ? 'checked' : ''}></th>
                  <th>${escapeHTML(t('qb.topic'))}</th>
                  <th>${escapeHTML(t('qb.stem'))}</th>
                  <th>${escapeHTML(t('qb.deletedAt'))}</th>
                  <th>${escapeHTML(t('qb.autoPurge'))}</th>
                  <th style="width:120px;">${escapeHTML(t('common.actions'))}</th>
                </tr>
              </thead>
              <tbody>
                ${this.questions.map(q => {
                  const expired = isExpired(q);
                  const deleted = new Date(q.deletedAt!);
                  return `
                    <tr data-id="${escapeHTML(q.id)}" ${this.selectedIds.has(q.id) ? 'class="selected"' : ''} ${expired ? 'style="background:var(--color-danger-light);"' : ''}>
                      <td><input type="checkbox" class="form-check-input row-checkbox" value="${escapeHTML(q.id)}" aria-label="${escapeHTML(t('qb.selectAll'))} ${escapeHTML(q.id)}" ${this.selectedIds.has(q.id) ? 'checked' : ''}></td>
                      <td><span class="badge badge-topic" style="--badge-topic-color:${this.getSubdomainColor(q.topicCode)};">${escapeHTML(q.topicCode)}</span></td>
                      <td style="max-width:400px;">${escapeHTML(q.stem.substring(0, 100))}${q.stem.length > 100 ? '…' : ''}</td>
                      <td>${escapeHTML(deleted.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td>
                      <td>
                        ${expired
                          ? `<span class="badge badge-danger">${escapeHTML(t('qb.willPurge'))}</span>`
                          : `<span class="badge badge-warning">${escapeHTML(t('qb.daysLeft', { count: daysUntilPurge(q) }))}</span>`}
                      </td>
                      <td>
                        <div style="display:flex;gap:var(--space-1);">
                          <button class="btn btn-ghost btn-icon btn-sm" data-action="restore" data-id="${escapeHTML(q.id)}" aria-label="${escapeHTML(t('qb.restore'))}" title="${escapeHTML(t('qb.restore'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-5"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg></button>
                          <button class="btn btn-ghost btn-icon btn-sm" data-action="purge" data-id="${escapeHTML(q.id)}" aria-label="${escapeHTML(t('qb.purge'))}" title="${escapeHTML(t('qb.purge'))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    this.element.querySelector('#btnBackToBank')?.addEventListener('click', () => navigateToHash('#/questions'));

    const toggleAll = (checked: boolean): void => {
      this.selectedIds.clear();
      if (checked) this.questions.forEach(q => this.selectedIds.add(q.id));
      this.refreshView();
    };
    this.element.querySelector('#selectAllTrashHeader')?.addEventListener('change', (e) => {
      toggleAll((e.target as HTMLInputElement).checked);
    });
    this.element.querySelector('#selectAllTrash')?.addEventListener('change', (e) => {
      toggleAll((e.target as HTMLInputElement).checked);
    });

    this.element.querySelectorAll<HTMLInputElement>('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this.selectedIds.add(cb.value);
        else this.selectedIds.delete(cb.value);
        this.refreshView();
      });
    });

    this.element.querySelector('#btnClearSelectionTrash')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.refreshView();
    });

    this.element.querySelector('#btnRestoreSelected')?.addEventListener('click', () => void this.bulkRestore());
    this.element.querySelector('#btnPurgeSelected')?.addEventListener('click', () => void this.bulkPurge());

    this.element.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (btn.dataset.action === 'restore') void this.restoreQuestion(id);
        else if (btn.dataset.action === 'purge') void this.purgeQuestion(id);
      });
    });
  }

  private refreshView(): void {
    if (!this.element) return;
    const scrollPos = window.scrollY;
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    window.scrollTo(0, scrollPos);
  }

  private async bulkRestore(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    const restored = await questionsRepo.bulkRestore(ids);
    this.selectedIds.clear();
    await this.loadQuestions();
    this.refreshView();
    showToast(t('qb.restoreDone', { count: restored }), 'success');
  }

  private async bulkPurge(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    if (!confirm(t('qb.purgeConfirmBulk', { count: ids.length }))) return;
    // Hard delete: bulkDelete's default is soft, which would be a no-op here.
    await questionsRepo.bulkDelete(ids, false);
    this.selectedIds.clear();
    await this.loadQuestions();
    this.refreshView();
    showToast(t('qb.purgeDone', { count: ids.length }), 'success');
  }

  private async restoreQuestion(id: string): Promise<void> {
    await questionsRepo.restore(id);
    this.selectedIds.delete(id);
    await this.loadQuestions();
    this.refreshView();
    showToast(t('qb.restoreDone', { count: 1 }), 'success');
  }

  private async purgeQuestion(id: string): Promise<void> {
    if (!confirm(t('qb.purgeConfirm'))) return;
    await questionsRepo.purge(id);
    this.selectedIds.delete(id);
    await this.loadQuestions();
    this.refreshView();
    showToast(t('qb.purgeDone', { count: 1 }), 'success');
  }

  private getSubdomainColor(code: string): string {
    if (code.startsWith('UM-')) return 'var(--subdomain-meteorology)';
    if (code.startsWith('KH-')) return 'var(--subdomain-climatology)';
    return 'var(--subdomain-default)';
  }
}

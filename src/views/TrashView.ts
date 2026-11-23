// Trash View - Deleted Questions
import { questionsRepo } from '../db/repositories/questions';
import { navigate, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import { generateId, nowISO } from '../core/utils';

export class TrashView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private questions: any[] = [];
  private selectedIds: Set<string> = new Set();
  private selectAll = false;

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'trash-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadQuestions().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });

    return this.element;
  }

  private async loadQuestions(): Promise<void> {
    this.questions = await questionsRepo.getTrash();
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('qb.trash')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getHTML(): string {
    const autoPurgeCount = this.questions.filter(q => {
      const deleted = new Date(q.deletedAt!).getTime();
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return deleted < thirtyDaysAgo;
    }).length;

    return `
      <div class="page-header">
        <h1 class="page-title">${t('qb.trash')}</h1>
        <p class="page-subtitle">${this.questions.length} soal dihapus ${autoPurgeCount > 0 ? `• ${autoPurgeCount} akan dihapus permanen (>30 hari)` : ''}</p>
      </div>

      <!-- Bulk Actions -->
      ${this.selectedIds.size > 0 || this.selectAll ? `
        <div class="card" style="margin-bottom:var(--space-4);background:var(--color-warning-light);border-color:var(--color-warning);">
          <div class="card-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="selectAllTrash" ${this.selectAll ? 'checked' : ''}>
                <span class="form-check-label">${t('qb.selectAll')} (${this.questions.length})</span>
              </label>
              <span style="color:var(--color-warning);font-weight:var(--font-medium);">${this.selectedIds.size} ${t('qb.selectedCount', { count: this.selectedIds.size })}</span>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-primary btn-sm" id="btnRestoreSelected">${t('qb.restore')}</button>
              <button class="btn btn-danger btn-sm" id="btnPurgeSelected">${t('qb.purge')}</button>
              <button class="btn btn-ghost btn-sm" id="btnClearSelectionTrash">${t('qb.deselectAll')}</button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Auto Purge Warning -->
      ${this.questions.some(q => {
        const deleted = new Date(q.deletedAt!).getTime();
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        return deleted < thirtyDaysAgo;
      }) ? `
        <div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-danger);background:var(--color-danger-light);">
          <div class="card-content" style="display:flex;align-items:flex-start;gap:var(--space-3);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <strong style="color:var(--color-danger);">Auto-purge akan menghapus permanen</strong>
              <div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-1);">Soal di sampah lebih dari 30 hari akan dihapus permanen saat aplikasi dibuka. Pulihkan sekarang jika masih diperlukan.</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Empty State -->
      ${this.questions.length === 0 ? `
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-12);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64" style="margin-bottom:var(--space-4);opacity:0.5;">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <h2 style="font-size:var(--text-xl);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">Sampah Kosong</h2>
            <p style="color:var(--color-text-muted);">Tidak ada soal yang dihapus.</p>
          </div>
        </div>
      ` : `
        <!-- Trash Table -->
        <div class="card">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th style="width:40px;"><input type="checkbox" class="form-check-input" id="selectAllTrashHeader" ${this.selectAll ? 'checked' : ''}></th>
                  <th>${t('qb.topic')}</th>
                  <th>${t('qb.stem')}</th>
                  <th>Dihapus</th>
                  <th>Auto-purge</th>
                  <th style="width:120px;">${t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${this.questions.map(q => {
                  const deleted = new Date(q.deletedAt!).getTime();
                  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                  const willPurge = deleted < thirtyDaysAgo;
                  const daysLeft = willPurge ? 0 : Math.ceil((thirtyDaysAgo - deleted) / (24 * 60 * 60 * 1000));
                  return `
                    <tr data-id="${q.id}" ${this.selectedIds.has(q.id) ? 'class="selected"' : ''} ${willPurge ? 'style="background:var(--color-danger-light);"' : ''}>
                      <td><input type="checkbox" class="form-check-input row-checkbox" value="${q.id}" ${this.selectedIds.has(q.id) ? 'checked' : ''}></td>
                      <td><span class="badge badge-topic" style="--badge-topic-color:${this.getSubdomainColor(q.topicCode)};">${q.topicCode}</span></td>
                      <td style="max-width:400px;">${q.stem.substring(0, 100)}...</td>
                      <td>${new Date(q.deletedAt!).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        ${willPurge ? '<span class="badge badge-danger">Akan dihapus</span>' : `<span class="badge badge-warning">${daysLeft} hari lagi</span>`}
                      </td>
                      <td>
                        <div style="display:flex;gap:var(--space-1);">
                          <button class="btn btn-ghost btn-icon btn-sm" data-action="restore" data-id="${q.id}" title="${t('qb.restore')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-5"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg></button>
                          <button class="btn btn-ghost btn-icon btn-sm" data-action="purge" data-id="${q.id}" title="${t('qb.purge')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
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

    // Select all
    this.element.querySelector('#selectAllTrashHeader')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.selectAll = target.checked;
      this.refreshView();
    });
    this.element.querySelector('#selectAllTrash')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.selectAll = target.checked;
      this.refreshView();
    });

    // Row checkboxes
    this.element.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) this.selectedIds.add(target.value);
        else this.selectedIds.delete(target.value);
        this.selectAll = this.selectedIds.size === this.questions.length;
        this.refreshView();
      });
    });

    // Clear selection
    this.element.querySelector('#btnClearSelectionTrash')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.selectAll = false;
      this.refreshView();
    });

    // Bulk actions
    this.element.querySelector('#btnRestoreSelected')?.addEventListener('click', () => this.bulkRestore());
    this.element.querySelector('#btnPurgeSelected')?.addEventListener('click', () => this.bulkPurge());

    // Row actions
    this.element.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (action === 'restore') this.restoreQuestion(id!);
        else if (action === 'purge') this.purgeQuestion(id!);
      });
    });
  }

  private refreshView(): void {
    if (this.element) {
      const scrollPos = window.scrollY;
      this.element.innerHTML = this.getHTML();
      this.bindEvents();
      window.scrollTo(0, scrollPos);
    }
  }

  private async bulkRestore(): Promise<void> {
    for (const id of this.selectedIds) {
      await import('../db/repositories/questions').then(m => m.questionsRepo.restore(id));
    }
    this.selectedIds.clear();
    this.selectAll = false;
    await this.loadQuestions();
    this.refreshView();
    showToast(`${this.selectedIds.size} soal dipulihkan`, 'success');
  }

  private async bulkPurge(): Promise<void> {
    if (!confirm(`Hapus permanen ${this.selectedIds.size} soal? Tindakan ini tidak bisa dibatalkan.`)) return;
    
    await import('../db/repositories/questions').then(m => m.questionsRepo.bulkDelete(Array.from(this.selectedIds)));
    this.selectedIds.clear();
    this.selectAll = false;
    await this.loadQuestions();
    this.refreshView();
    showToast(`${this.selectedIds.size} soal dihapus permanen`, 'success');
  }

  private async restoreQuestion(id: string): Promise<void> {
    await import('../db/repositories/questions').then(m => m.questionsRepo.restore(id));
    await this.loadQuestions();
    this.refreshView();
    showToast('Soal dipulihkan', 'success');
  }

  private async purgeQuestion(id: string): Promise<void> {
    if (!confirm('Hapus permanen soal ini? Tidak bisa dibatalkan.')) return;
    await import('../db/repositories/questions').then(m => m.questionsRepo.purge(id));
    await this.loadQuestions();
    this.refreshView();
    showToast('Soal dihapus permanen', 'success');
  }

  private getSubdomainColor(code: string): string {
    if (code.startsWith('UM-')) return 'var(--subdomain-meteorology)';
    if (code.startsWith('KH-')) return 'var(--subdomain-climatology)';
    return 'var(--subdomain-default)';
  }
}
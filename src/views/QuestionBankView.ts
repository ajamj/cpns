// Question Bank View
import { questionsRepo } from '../db/repositories/questions';
import { backupRepo } from '../db/repositories/backup';
import { getSubdomainColor, loadKisiKisi, getTopicsByCategory } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, downloadJSON, parseCSV, toCSV } from '../core/utils';
import type { Question, QuestionFilter } from '../shared/types';
import * as Fuse from 'fuse.js';

export class QuestionBankView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private questions: any[] = [];
  private filteredQuestions: any[] = [];
  private currentPage = 0;
  private pageSize = 50;
  private filter: QuestionFilter = {};
  private searchQuery = '';
  private fuse: Fuse | null = null;
  private selectedIds: Set<string> = new Set();
  private selectAll = false;

  constructor(params: Record<string, string>) {
    this.params = params;
    this.parseFilterFromParams();
  }

  private parseFilterFromParams(): void {
    if (this.params.topic) this.filter.topicCodes = this.params.topic.split(',');
    if (this.params.difficulty) this.filter.difficulty = parseInt(this.params.difficulty) as any;
    if (this.params.mastery) this.filter.masteryLevels = this.params.mastery.split(',').map(Number) as any;
    if (this.params.flags) {
      const flags = this.params.flags.split(',');
      this.filter.flags = {};
      flags.forEach(f => { this.filter.flags![f as any] = true; });
    }
    if (this.params.search) this.searchQuery = this.params.search;
  }

  async loadQuestions(): Promise<void> {
    this.questions = await questionsRepo.getAll();
    
    // Initialize Fuse.js for search
    this.fuse = new Fuse(this.questions, {
      keys: [
        { name: 'stem', weight: 3 },
        { name: 'options.text', weight: 2 },
        { name: 'explanation', weight: 1.5 },
        { name: 'tags', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 2,
    });
    
    this.applyFilters();
  }

  private applyFilters(): void {
    let filtered = [...this.questions];

    // Text search
    if (this.searchQuery && this.fuse) {
      const results = this.fuse.search(this.searchQuery);
      const ids = new Set(results.map(r => r.item.id));
      filtered = filtered.filter(q => ids.has(q.id));
    }

    // Topic filter
    if (this.filter.topicCodes?.length) {
      filtered = filtered.filter(q => this.filter.topicCodes!.includes(q.topicCode));
    }

    // Difficulty filter
    if (this.filter.difficulty) {
      filtered = filtered.filter(q => q.difficulty === this.filter.difficulty);
    }

    // Mastery filter
    if (this.filter.masteryLevels?.length) {
      filtered = filtered.filter(q => this.filter.masteryLevels!.includes(q.statistics.masteryLevel));
    }

    // Flags filter
    if (this.filter.flags) {
      if (this.filter.flags.bookmarked) filtered = filtered.filter(q => q.flags.bookmarked);
      if (this.filter.flags.needsReview) filtered = filtered.filter(q => q.flags.needsReview);
      if (this.filter.flags.disputed) filtered = filtered.filter(q => q.flags.disputed);
    }

    // Source filter
    if (this.filter.source) {
      const src = this.filter.source.toLowerCase();
      filtered = filtered.filter(q => q.source?.toLowerCase().includes(src));
    }

    // Date range filter
    if (this.filter.dateRange) {
      const start = new Date(this.filter.dateRange.start).getTime();
      const end = new Date(this.filter.dateRange.end).getTime() + 86400000; // end of day
      filtered = filtered.filter(q => {
        const created = new Date(q.metadata.createdAt).getTime();
        return created >= start && created <= end;
      });
    }

    // Sort by createdAt desc
    filtered.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());

    this.filteredQuestions = filtered;
    this.currentPage = 0;
    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    if (this.selectAll) {
      this.selectedIds = new Set(this.filteredQuestions.map(q => q.id));
    } else {
      // Remove deselected from filtered
      for (const id of this.selectedIds) {
        if (!this.filteredQuestions.some(q => q.id === id)) {
          this.selectedIds.delete(id);
        }
      }
    }
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'question-bank-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadQuestions().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });

    return this.element;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('qb.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:500px;"></div>
    `;
  }

  private getHTML(): string {
    const start = this.currentPage * this.pageSize;
    const end = Math.min(start + this.pageSize, this.filteredQuestions.length);
    const pageQuestions = this.filteredQuestions.slice(start, end);
    const totalPages = Math.ceil(this.filteredQuestions.length / this.pageSize);

    return `
      <div class="page-header">
        <h1 class="page-title">${t('qb.title')}</h1>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnAddQuestion">${t('qb.addQuestion')}</button>
          <button class="btn btn-secondary" id="btnImport">${t('common.import')}</button>
          <button class="btn btn-secondary" id="btnExport">${t('common.export')}</button>
          <button class="btn btn-secondary" id="btnTrash">${t('qb.trash')} (${this.getTrashCount()})</button>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-content">
          <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;">
            <div style="flex:1;min-width:250px;">
              <label class="form-label">${t('common.search')}</label>
              <div style="position:relative;">
                <input type="search" id="searchInput" class="form-input" placeholder="${t('common.search')}..." value="${this.searchQuery}" style="padding-right:40px;">
                <button type="button" id="btnClearSearch" class="btn btn-ghost btn-icon" aria-label="${t('filter.clear')}" style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);" ${!this.searchQuery ? 'hidden' : ''}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            
            <div class="filter-dropdown">
              <button class="btn btn-secondary" id="btnTopicFilter" style="min-width:180px;">
                ${t('filter.topic')}: ${this.filter.topicCodes?.length ? this.filter.topicCodes.length + ' dipilih' : t('filter.all')}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:var(--space-1);"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="dropdown-menu" id="topicFilterMenu" style="max-height:300px;overflow:auto;min-width:250px;display:none;">
                <label class="dropdown-item"><input type="checkbox" value="" ${!this.filter.topicCodes?.length ? 'checked' : ''}> ${t('filter.all')}</label>
                <div class="dropdown-divider"></div>
                ${getTopicsByCategory('umum').map(cat => `
                  <div class="dropdown-divider"></div>
                  <div class="dropdown-item" style="font-weight:var(--font-semibold);color:var(--color-text-muted);padding:var(--space-2) var(--space-3);">${t('kisi-kisi.umum')}</div>
                  ${loadKisiKisi().then(({topics}) => topics.filter(t => t.category === 'umum').map(t => `
                    <label class="dropdown-item"><input type="checkbox" value="${t.code}" ${this.filter.topicCodes?.includes(t.code) ? 'checked' : ''}> ${t.code} - ${t.title}</label>
                  `).join(''))}
                `)}
                <div class="dropdown-divider"></div>
                <div class="dropdown-item" style="font-weight:var(--font-semibold);color:var(--color-text-muted);padding:var(--space-2) var(--space-3);">${t('kisi-kisi.khusus')}</div>
                ${loadKisiKisi().then(({topics}) => topics.filter(t => t.category === 'khusus').map(t => `
                  <label class="dropdown-item"><input type="checkbox" value="${t.code}" ${this.filter.topicCodes?.includes(t.code) ? 'checked' : ''}> ${t.code} - ${t.title}</label>
                `).join(''))}
              </div>
            </div>

            <select id="difficultyFilter" class="form-select" style="min-width:150px;">
              <option value="">${t('filter.all')}</option>
              <option value="1" ${this.filter.difficulty === 1 ? 'selected' : ''}>${t('difficulty.1')}</option>
              <option value="2" ${this.filter.difficulty === 2 ? 'selected' : ''}>${t('difficulty.2')}</option>
              <option value="3" ${this.filter.difficulty === 3 ? 'selected' : ''}>${t('difficulty.3')}</option>
            </select>

            <select id="masteryFilter" class="form-select" style="min-width:150px;" multiple>
              <option value="">${t('filter.all')}</option>
              <option value="0" ${this.filter.masteryLevels?.includes(0) ? 'selected' : ''}>${t('mastery.0')}</option>
              <option value="1" ${this.filter.masteryLevels?.includes(1) ? 'selected' : ''}>${t('mastery.1')}</option>
              <option value="2" ${this.filter.masteryLevels?.includes(2) ? 'selected' : ''}>${t('mastery.2')}</option>
              <option value="3" ${this.filter.masteryLevels?.includes(3) ? 'selected' : ''}>${t('mastery.3')}</option>
            </select>

            <select id="flagsFilter" class="form-select" style="min-width:150px;" multiple>
              <option value="">${t('filter.flags')}</option>
              <option value="bookmarked" ${this.filter.flags?.bookmarked ? 'selected' : ''}>${t('filter.bookmarked')}</option>
              <option value="needsReview" ${this.filter.flags?.needsReview ? 'selected' : ''}>${t('filter.needsReview')}</option>
              <option value="disputed" ${this.filter.flags?.disputed ? 'selected' : ''}>${t('filter.disputed')}</option>
            </select>

            <button class="btn btn-ghost" id="btnClearFilters">${t('filter.clear')}</button>
          </div>
        </div>
      </div>

      <!-- Bulk Actions Bar -->
      ${this.selectedIds.size > 0 ? `
        <div class="card" style="margin-bottom:var(--space-4);background:var(--color-primary-light);border-color:var(--color-primary);">
          <div class="card-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <label class="form-check">
                <input type="checkbox" class="form-check-input bulk-checkbox" id="selectAllFiltered" aria-label="${t('qb.selectAll')}" ${this.selectAll ? 'checked' : ''}>
                <span class="form-check-label">${t('qb.selectAll')} (${this.filteredQuestions.length})</span>
              </label>
              <span style="color:var(--color-primary);font-weight:var(--font-medium);">${this.selectedIds.size} ${t('qb.selectedCount', { count: this.selectedIds.size })}</span>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-primary btn-sm" id="btnBulkTag">${t('qb.tag')}</button>
              <button class="btn btn-primary btn-sm" id="btnBulkFlag">${t('qb.flag')}</button>
              <button class="btn btn-secondary btn-sm" id="btnBulkUnflag">${t('qb.unflag')}</button>
              <button class="btn btn-secondary btn-sm" id="btnBulkReview">${t('qb.moveToTrash')}</button>
              <button class="btn btn-danger btn-sm" id="btnBulkDelete">${t('common.delete')}</button>
              <button class="btn btn-ghost btn-sm" id="btnClearSelection">${t('qb.deselectAll')}</button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Question Table -->
      <div class="card">
        <div class="table-container">
          <table class="table" id="questionsTable">
            <thead>
              <tr>
                <th style="width:40px;">
                  <input type="checkbox" class="form-check-input bulk-checkbox" id="selectAllHeader" aria-label="${t('qb.selectAll')}" ${this.selectAll ? 'checked' : ''}>
                </th>
                <th>${t('qb.topic')}</th>
                <th>${t('qb.stem')}</th>
                <th>${t('qb.difficulty')}</th>
                <th>${t('qb.mastery') || 'Kemahiran'}</th>
                <th>${t('qb.flags') || 'Flag'}</th>
                <th style="width:120px;">${t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              ${pageQuestions.map(q => `
                <tr data-id="${q.id}" ${this.selectedIds.has(q.id) ? 'class="selected"' : ''}>
                  <td><input type="checkbox" class="form-check-input row-checkbox bulk-checkbox" aria-label="Pilih soal ${q.topicCode}" value="${q.id}" ${this.selectedIds.has(q.id) ? 'checked' : ''}></td>
                  <td>
                    <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(q.topicCode)};">${q.topicCode}</span>
                  </td>
                  <td style="max-width:400px;">
                    <div style="font-weight:var(--font-medium);">${q.stem.length > 100 ? q.stem.substring(0, 100) + '...' : q.stem}</div>
                    ${q.explanation ? `<div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">${q.explanation.substring(0, 80)}...</div>` : ''}
                  </td>
                  <td><span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span></td>
                  <td>
                    <span class="badge badge-mastery-${q.statistics.masteryLevel}">${t('mastery.' + q.statistics.masteryLevel)}</span>
                    <span style="font-size:var(--text-xs);color:var(--color-text-muted);margin-left:var(--space-1);">${q.statistics.totalAttempts} percobaan</span>
                  </td>
                  <td>
                    ${q.flags.bookmarked ? '<span class="badge badge-warning" title="Bookmark">★</span>' : ''}
                    ${q.flags.needsReview ? '<span class="badge badge-info" title="Perlu Ulang">↻</span>' : ''}
                    ${q.flags.disputed ? '<span class="badge badge-danger" title="Disput">⚠</span>' : ''}
                  </td>
                  <td>
                    <div style="display:flex;gap:var(--space-1);">
                      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-id="${q.id}" aria-label="${t('common.edit')}" title="${t('common.edit')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="duplicate" data-id="${q.id}" aria-label="Duplikat soal" title="Duplikat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      </button>
                      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="delete" data-id="${q.id}" aria-label="${t('common.delete')}" title="${t('common.delete')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        ${totalPages > 1 ? `
          <div class="card-footer" style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:var(--text-sm);color:var(--color-text-muted);">
              Menampilkan ${start + 1}-${end} dari ${this.filteredQuestions.length} soal
            </div>
            <div style="display:flex;gap:var(--space-1);">
              <button type="button" class="btn btn-ghost btn-sm" id="btnPrevPage" aria-label="${t('common.previous')}" ${this.currentPage === 0 ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              ${Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum = i;
                if (totalPages > 5) {
                  if (this.currentPage <= 2) pageNum = i;
                  else if (this.currentPage >= totalPages - 3) pageNum = totalPages - 5 + i;
                  else pageNum = this.currentPage - 2 + i;
                }
                return `<button class="btn btn-${pageNum === this.currentPage ? 'primary' : 'ghost'} btn-sm" data-page="${pageNum}">${pageNum + 1}</button>`;
              }).join('')}
              <button type="button" class="btn btn-ghost btn-sm" id="btnNextPage" aria-label="${t('common.next')}" ${this.currentPage === totalPages - 1 ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getTrashCount(): number {
    // This would need a separate call, simplified for now
    return 0;
  }

  private bindEvents(): void {
    if (!this.element) return;

    // Search
    const searchInput = this.element.querySelector('#searchInput') as HTMLInputElement;
    const clearSearch = this.element.querySelector('#btnClearSearch') as HTMLButtonElement;
    
    searchInput?.addEventListener('input', debounce((e) => {
      const target = e.target as HTMLInputElement;
      this.searchQuery = target.value;
      this.applyFilters();
      this.refreshView();
      if (clearSearch) clearSearch.hidden = !this.searchQuery;
    }, 150));

    clearSearch?.addEventListener('click', () => {
      this.searchQuery = '';
      if (searchInput) searchInput.value = '';
      this.applyFilters();
      this.refreshView();
      clearSearch.hidden = true;
    });

    // Topic filter dropdown
    const topicFilterBtn = this.element.querySelector('#btnTopicFilter');
    const topicFilterMenu = this.element.querySelector('#topicFilterMenu');
    
    topicFilterBtn?.addEventListener('click', () => {
      if (topicFilterMenu) topicFilterMenu.style.display = topicFilterMenu.style.display === 'block' ? 'none' : 'block';
    });

    topicFilterMenu?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.type === 'checkbox') {
        if (target.value === '') {
          this.filter.topicCodes = [];
          topicFilterMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            (cb as HTMLInputElement).checked = cb === target;
          });
        } else {
          const checked = topicFilterMenu.querySelectorAll('input[type="checkbox"]:checked');
          this.filter.topicCodes = Array.from(checked).map(c => (c as HTMLInputElement).value).filter(v => v !== '');
          const allCheckbox = topicFilterMenu.querySelector('input[value=""]') as HTMLInputElement;
          if (allCheckbox) allCheckbox.checked = this.filter.topicCodes.length === 0;
        }
        this.applyFilters();
        this.refreshView();
        if (topicFilterBtn) {
          topicFilterBtn.textContent = `${t('filter.topic')}: ${this.filter.topicCodes.length ? this.filter.topicCodes.length + ' dipilih' : t('filter.all')}`;
        }
      }
    });

    // Difficulty filter
    this.element.querySelector('#difficultyFilter')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.filter.difficulty = target.value ? parseInt(target.value) as any : undefined;
      this.applyFilters();
      this.refreshView();
    });

    // Mastery filter
    this.element.querySelector('#masteryFilter')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.filter.masteryLevels = Array.from(target.selectedOptions).map(o => parseInt(o.value) as any);
      this.applyFilters();
      this.refreshView();
    });

    // Flags filter
    this.element.querySelector('#flagsFilter')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.filter.flags = {};
      Array.from(target.selectedOptions).forEach(o => {
        this.filter.flags![o.value as any] = true;
      });
      this.applyFilters();
      this.refreshView();
    });

    // Clear filters
    this.element.querySelector('#btnClearFilters')?.addEventListener('click', () => {
      this.filter = {};
      this.searchQuery = '';
      this.applyFilters();
      this.refreshView();
    });

    // Selection
    this.element.querySelector('#selectAllHeader')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.selectAll = target.checked;
      this.updateSelectionState();
      this.refreshView();
    });

    this.element.querySelector('#selectAllFiltered')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.selectAll = target.checked;
      this.updateSelectionState();
      this.refreshView();
    });

    this.element.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) this.selectedIds.add(target.value);
        else this.selectedIds.delete(target.value);
        this.selectAll = this.selectedIds.size === this.filteredQuestions.length;
        this.refreshView();
      });
    });

    // Clear selection
    this.element.querySelector('#btnClearSelection')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.selectAll = false;
      this.refreshView();
    });

    // Bulk actions
    this.element.querySelector('#btnBulkTag')?.addEventListener('click', () => this.bulkTag());
    this.element.querySelector('#btnBulkFlag')?.addEventListener('click', () => this.bulkFlag());
    this.element.querySelector('#btnBulkUnflag')?.addEventListener('click', () => this.bulkUnflag());
    this.element.querySelector('#btnBulkReview')?.addEventListener('click', () => this.bulkReview());
    this.element.querySelector('#btnBulkDelete')?.addEventListener('click', () => this.bulkDelete());

    // Pagination
    this.element.querySelector('#btnPrevPage')?.addEventListener('click', () => {
      if (this.currentPage > 0) {
        this.currentPage--;
        this.refreshView();
      }
    });
    this.element.querySelector('#btnNextPage')?.addEventListener('click', () => {
      const totalPages = Math.ceil(this.filteredQuestions.length / this.pageSize);
      if (this.currentPage < totalPages - 1) {
        this.currentPage++;
        this.refreshView();
      }
    });
    this.element.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        this.currentPage = parseInt(target.dataset.page!);
        this.refreshView();
      });
    });

    // Row actions
    this.element.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (action === 'edit') this.editQuestion(id!);
        else if (action === 'duplicate') this.duplicateQuestion(id!);
        else if (action === 'delete') this.deleteQuestion(id!);
      });
    });

    // Header actions
    this.element.querySelector('#btnAddQuestion')?.addEventListener('click', () => this.editQuestion());
    this.element.querySelector('#btnImport')?.addEventListener('click', () => navigate('import'));
    this.element.querySelector('#btnExport')?.addEventListener('click', () => navigate('export'));
    this.element.querySelector('#btnTrash')?.addEventListener('click', () => navigate('trash'));
  }

  private refreshView(): void {
    if (this.element) {
      const scrollPos = window.scrollY;
      this.element.innerHTML = this.getHTML();
      this.bindEvents();
      window.scrollTo(0, scrollPos);
    }
  }

  private async editQuestion(id?: string): Promise<void> {
    // Navigate to question form modal or page
    // For now, show a simple prompt - in full implementation, open a modal
    const question = id ? await import('../db/repositories/questions').then(m => m.questionsRepo.getById(id)) : null;
    // TODO: Implement full question form modal
    alert('Question form modal - TODO');
  }

  private async duplicateQuestion(id: string): Promise<void> {
    const question = await import('../db/repositories/questions').then(m => m.questionsRepo.getById(id));
    if (question) {
      const newQuestion = {
        ...question,
        id: generateId(),
        metadata: { ...question.metadata, createdAt: nowISO(), updatedAt: nowISO(), version: 1 },
        statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
      };
      await import('../db/repositories/questions').then(m => m.questionsRepo.add(newQuestion));
      this.refreshView();
    }
  }

  private async deleteQuestion(id: string): Promise<void> {
    if (confirm('Hapus soal ini?')) {
      await import('../db/repositories/questions').then(m => m.questionsRepo.delete(id));
      this.refreshView();
    }
  }

  private bulkTag(): void {
    // TODO: Implement bulk tag modal
    alert('Bulk tag - TODO');
  }

  private bulkFlag(): void {
    this.selectedIds.forEach(async id => {
      const q = await import('../db/repositories/questions').then(m => m.questionsRepo.getById(id));
      if (q) {
        q.flags.bookmarked = true;
        await import('../db/repositories/questions').then(m => m.questionsRepo.put(q));
      }
    });
    this.refreshView();
  }

  private bulkUnflag(): void {
    this.selectedIds.forEach(async id => {
      const q = await import('../db/repositories/questions').then(m => m.questionsRepo.getById(id));
      if (q) {
        q.flags.bookmarked = false;
        q.flags.needsReview = false;
        q.flags.disputed = false;
        await import('../db/repositories/questions').then(m => m.questionsRepo.put(q));
      }
    });
    this.refreshView();
  }

  private bulkReview(): void {
    this.selectedIds.forEach(async id => {
      const q = await import('../db/repositories/questions').then(m => m.questionsRepo.getById(id));
      if (q) {
        q.flags.needsReview = true;
        await import('../db/repositories/questions').then(m => m.questionsRepo.put(q));
      }
    });
    this.refreshView();
  }

  private async bulkDelete(): Promise<void> {
    if (confirm(`Hapus ${this.selectedIds.size} soal?`)) {
      await import('../db/repositories/questions').then(m => m.questionsRepo.bulkDelete(Array.from(this.selectedIds)));
      this.selectedIds.clear();
      this.selectAll = false;
      this.refreshView();
    }
  }
}

import { debounce } from '../core/utils';
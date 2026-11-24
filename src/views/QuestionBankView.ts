// Question Bank View
import { questionsRepo } from '../db/repositories/questions';
import { backupRepo } from '../db/repositories/backup';
import {
  getAllTopicCodes,
  getSubdomainColor,
  getTopicsByCategory,
  loadKisiKisi,
} from '../features/kisi-kisi/registry';
import {
  correctIndices,
  createEmptyDraft,
  draftFromQuestion,
  draftToQuestion,
  parseTags,
  validateQuestionDraft,
  MAX_OPTIONS,
  MIN_OPTIONS,
  type QuestionFormDraft,
  type QuestionFormErrorCode,
  type QuestionFormField,
} from '../features/questions/question-form';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, downloadJSON, parseCSV, toCSV } from '../core/utils';
import { memoizeSelector, showToast } from '../core/app-utils';
import { closeModal, openModal } from '../core/modal';
import type EasyMDE from 'easymde';
import type { Difficulty, Question, QuestionFilter } from '../shared/types';
import Fuse from 'fuse.js';
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from '@tanstack/virtual-core';
import 'easymde/dist/easymde.min.css';

const ROW_HEIGHT = 76;
const OVERSCAN = 8;
// Small lists stay fully rendered (simpler keyboard traversal); virtualization
// kicks in for large banks where rendering every row would block the UI.
const VIRTUALIZE_THRESHOLD = 200;

type MarkdownEditor = EasyMDE;
type EditorConstructor = new (options: Record<string, unknown>) => MarkdownEditor;

/** Question text comes from imports and user input: never inject it as HTML. */
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

/** Normalised searchable text, built at most once per question object. */
const searchHaystacks = new WeakMap<object, string>();
function searchableText(question: any): string {
  const cached = searchHaystacks.get(question);
  if (cached !== undefined) return cached;
  const text = [
    question.stem ?? '',
    question.explanation ?? '',
    ...(question.options ?? []).map((option: any) => option.text ?? ''),
    ...(question.tags ?? []),
  ]
    .join('\n')
    .toLowerCase();
  searchHaystacks.set(question, text);
  return text;
}

/** Derives the visible question set once per distinct search/filter key. */
const selectFilteredQuestions = memoizeSelector(
  (
    questions: any[],
    searchQuery: string,
    filter: QuestionFilter,
    fuse: Fuse<any> | null
  ): any[] => {
    let filtered = [...questions];

    if (searchQuery && fuse) {
      // O(n) literal match first. Fuse's fuzzy pass over 2000 questions with
      // four weighted keys costs >1s; it is now only the fallback for queries
      // with no literal hit (e.g. a typo). Exact searches stay <200ms.
      const needle = searchQuery.toLowerCase();
      const exact = questions.filter((q) => searchableText(q).includes(needle));
      if (exact.length > 0) {
        const exactIds = new Set(exact.map((q) => q.id));
        filtered = filtered.filter((q) => exactIds.has(q.id));
      } else {
        const ids = new Set(fuse.search(searchQuery).map((r) => r.item.id));
        filtered = filtered.filter((q) => ids.has(q.id));
      }
    }
    if (filter.topicCodes?.length) {
      filtered = filtered.filter((q) => filter.topicCodes!.includes(q.topicCode));
    }
    if (filter.difficulty) {
      filtered = filtered.filter((q) => q.difficulty === filter.difficulty);
    }
    if (filter.masteryLevels?.length) {
      filtered = filtered.filter((q) => filter.masteryLevels!.includes(q.statistics.masteryLevel));
    }
    if (filter.flags) {
      if (filter.flags.bookmarked) filtered = filtered.filter((q) => q.flags.bookmarked);
      if (filter.flags.needsReview) filtered = filtered.filter((q) => q.flags.needsReview);
      if (filter.flags.disputed) filtered = filtered.filter((q) => q.flags.disputed);
    }
    if (filter.source) {
      const src = filter.source.toLowerCase();
      filtered = filtered.filter((q) => q.source?.toLowerCase().includes(src));
    }
    if (filter.dateRange) {
      const start = new Date(filter.dateRange.start).getTime();
      const end = new Date(filter.dateRange.end).getTime() + 86400000;
      filtered = filtered.filter((q) => {
        const created = new Date(q.metadata.createdAt).getTime();
        return created >= start && created <= end;
      });
    }

    filtered.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());
    return filtered;
  },
  (_questions, searchQuery, filter, fuse) =>
    `${fuse ? 'fuse' : 'plain'}|${searchQuery}|${JSON.stringify(filter)}`
);

export class QuestionBankView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private questions: any[] = [];
  private filteredQuestions: any[] = [];
  private filter: QuestionFilter = {};
  private searchQuery = '';
  private fuse: Fuse<any> | null = null;
  private selectedIds: Set<string> = new Set();
  private selectAll = false;
  private virtualizer: Virtualizer<HTMLElement, HTMLElement> | null = null;
  private virtualCleanup: (() => void) | null = null;
  private scrollElement: HTMLElement | null = null;
  private tbody: HTMLTableSectionElement | null = null;
  private resetScrollOnRefresh = false;

  // Question form modal state (Task 2). The draft is the single source of truth
  // while the dialog is open; inputs and the Markdown editors write into it.
  private formOverlay: HTMLElement | null = null;
  private formDraft: QuestionFormDraft | null = null;
  private formQuestion: Question | undefined;
  private formValidCodes: ReadonlySet<string> = new Set();
  private editors: { stem: MarkdownEditor | null; explanation: MarkdownEditor | null } = {
    stem: null,
    explanation: null,
  };

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
    // Underlying data changed: the memoized selector cache is no longer valid.
    selectFilteredQuestions.clear();
    // Build the searchable haystacks while the view is loading, so the first
    // keystroke only filters the already-normalised strings instead of walking
    // every option/tag of 2000 questions inside the interaction budget.
    this.questions.forEach(searchableText);

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
    this.filteredQuestions = selectFilteredQuestions(
      this.questions,
      this.searchQuery,
      this.filter,
      this.fuse
    );
    // A changed filter starts at the top of the virtual list again.
    this.resetScrollOnRefresh = true;
    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    const visibleIds = new Set(this.filteredQuestions.map((q) => q.id));
    if (this.selectAll) {
      this.selectedIds = visibleIds;
    } else {
      // Drop selections no longer present in the filtered result.
      for (const id of this.selectedIds) {
        if (!visibleIds.has(id)) this.selectedIds.delete(id);
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
        this.mountQuestionList();
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
                ${this.getTopicFilterHTML()}
              </div>
            </div>

            <select id="difficultyFilter" class="form-select" aria-label="${t('filter.difficulty')}" style="min-width:150px;">
              <option value="">${t('filter.all')}</option>
              <option value="1" ${this.filter.difficulty === 1 ? 'selected' : ''}>${t('difficulty.1')}</option>
              <option value="2" ${this.filter.difficulty === 2 ? 'selected' : ''}>${t('difficulty.2')}</option>
              <option value="3" ${this.filter.difficulty === 3 ? 'selected' : ''}>${t('difficulty.3')}</option>
            </select>

            <select id="masteryFilter" class="form-select" aria-label="${t('filter.mastery')}" style="min-width:150px;" multiple>
              <option value="">${t('filter.all')}</option>
              <option value="0" ${this.filter.masteryLevels?.includes(0) ? 'selected' : ''}>${t('mastery.0')}</option>
              <option value="1" ${this.filter.masteryLevels?.includes(1) ? 'selected' : ''}>${t('mastery.1')}</option>
              <option value="2" ${this.filter.masteryLevels?.includes(2) ? 'selected' : ''}>${t('mastery.2')}</option>
              <option value="3" ${this.filter.masteryLevels?.includes(3) ? 'selected' : ''}>${t('mastery.3')}</option>
            </select>

            <select id="flagsFilter" class="form-select" aria-label="${t('filter.flags')}" style="min-width:150px;" multiple>
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

      <!-- Question Table (virtualized: only visible rows are in the DOM) -->
      <div class="card">
        <div id="questionsScroll" class="table-container" style="max-height:min(70vh,720px);overflow:auto;">
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
            <tbody id="questionsBody"></tbody>
          </table>
        </div>
        <div class="card-footer" style="font-size:var(--text-sm);color:var(--color-text-muted);">
          ${t('qb.title')}: ${this.filteredQuestions.length} / ${this.questions.length}
        </div>
      </div>
    `;
  }

  /**
   * Topic checkboxes for the list filter. The registry is loaded before the
   * view renders (app.ts), so this stays synchronous — no Promise leaked into
   * the markup as happened with the old in-template loadKisiKisi() calls.
   */
  private getTopicFilterHTML(): string {
    const groups: Array<{ category: 'umum' | 'khusus'; label: string }> = [
      { category: 'umum', label: t('kisi-kisi.umum') },
      { category: 'khusus', label: t('kisi-kisi.khusus') },
    ];
    const registered = new Set(getAllTopicCodes());
    const legacyCodes = [...new Set(this.questions.map(q => q.topicCode))]
      .filter(code => !registered.has(code));

    const groupHTML = (label: string, codes: Array<{ code: string; title?: string }>): string => `
      <div class="dropdown-divider"></div>
      <div class="dropdown-item" style="font-weight:var(--font-semibold);color:var(--color-text-muted);padding:var(--space-2) var(--space-3);">${escapeHTML(label)}</div>
      ${codes.map(topic => `
        <label class="dropdown-item">
          <input type="checkbox" value="${escapeHTML(topic.code)}" ${this.filter.topicCodes?.includes(topic.code as any) ? 'checked' : ''}>
          ${escapeHTML(topic.code)} - ${escapeHTML(topic.title ?? '')}
        </label>
      `).join('')}
    `;

    return groups.map(group =>
      groupHTML(group.label, getTopicsByCategory(group.category))
    ).join('') + (legacyCodes.length
      ? groupHTML(t('qb.importedTopics'), legacyCodes.map(code => ({ code })))
      : '');
  }

  /** One fixed-height row, extracted from the old paged innerHTML template. */
  private getRowHTML(q: any): string {
    const stem = String(q.stem ?? '');
    const explanation = String(q.explanation ?? '');
    const flags = q.flags ?? {};
    const stats = q.statistics ?? {};
    const difficulty = q.difficulty as Difficulty;
    const mastery = stats.masteryLevel ?? 0;
    return `
      <tr data-id="${escapeHTML(q.id)}" style="height:${ROW_HEIGHT}px;" ${this.selectedIds.has(q.id) ? 'class="selected"' : ''}>
        <td><input type="checkbox" class="form-check-input row-checkbox bulk-checkbox" aria-label="Pilih soal ${escapeHTML(q.topicCode)}" value="${escapeHTML(q.id)}" ${this.selectedIds.has(q.id) ? 'checked' : ''}></td>
        <td>
          <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(q.topicCode)};">${escapeHTML(q.topicCode)}</span>
        </td>
        <td style="max-width:400px;">
          <div style="font-weight:var(--font-medium);">${escapeHTML(stem.length > 100 ? stem.substring(0, 100) + '...' : stem)}</div>
          ${explanation ? `<div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px;">${escapeHTML(explanation.substring(0, 80))}...</div>` : ''}
        </td>
        <td><span class="badge badge-difficulty-${difficulty}">${t('difficulty.' + difficulty)}</span></td>
        <td>
          <span class="badge badge-mastery-${mastery}">${t('mastery.' + mastery)}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-muted);margin-left:var(--space-1);">${escapeHTML(stats.totalAttempts ?? 0)} percobaan</span>
        </td>
        <td>
          ${flags.bookmarked ? '<span class="badge badge-warning" title="Bookmark">★</span>' : ''}
          ${flags.needsReview ? '<span class="badge badge-info" title="Perlu Ulang">↻</span>' : ''}
          ${flags.disputed ? '<span class="badge badge-danger" title="Disput">⚠</span>' : ''}
        </td>
        <td>
          <div style="display:flex;gap:var(--space-1);">
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-id="${escapeHTML(q.id)}" aria-label="${t('common.edit')}" title="${t('common.edit')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="duplicate" data-id="${escapeHTML(q.id)}" aria-label="Duplikat soal" title="Duplikat">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="delete" data-id="${escapeHTML(q.id)}" aria-label="${t('common.delete')}" title="${t('common.delete')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private disposeVirtualizer(): void {
    this.virtualCleanup?.();
    this.virtualCleanup = null;
    this.virtualizer = null;
    this.scrollElement = null;
    this.tbody = null;
  }

  /** Mount the list: full DOM for small banks, virtual window for large ones. */
  private mountQuestionList(): void {
    this.disposeVirtualizer();
    const scrollElement = this.element?.querySelector<HTMLElement>('#questionsScroll') ?? null;
    const tbody = this.element?.querySelector<HTMLTableSectionElement>('#questionsBody') ?? null;
    if (!scrollElement || !tbody) return;
    this.scrollElement = scrollElement;
    this.tbody = tbody;

    // Delegated listeners stay valid when rows are replaced as the user scrolls.
    tbody.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.matches('.row-checkbox')) return;
      if (target.checked) this.selectedIds.add(target.value);
      else this.selectedIds.delete(target.value);
      this.selectAll = this.selectedIds.size === this.filteredQuestions.length;
      this.refreshView();
    });
    tbody.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (!button || !tbody.contains(button)) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === 'edit') void this.editQuestion(id);
      else if (action === 'duplicate') void this.duplicateQuestion(id!);
      else if (action === 'delete') void this.deleteQuestion(id!);
    });

    if (this.filteredQuestions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="text-align:center;padding:var(--space-8);">${escapeHTML(t('qb.noQuestions'))}</td></tr>`;
      return;
    }

    if (this.filteredQuestions.length <= VIRTUALIZE_THRESHOLD) {
      tbody.innerHTML = this.filteredQuestions.map((q) => this.getRowHTML(q)).join('');
      return;
    }

    this.virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
      count: this.filteredQuestions.length,
      getScrollElement: () => this.scrollElement,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      onChange: () => this.renderVirtualRows(),
    });
    // The headless core expects the adapter to attach its observers on mount;
    // _willUpdate() binds the scroll element (and therefore the rect observer).
    this.virtualizer._willUpdate();
    this.virtualCleanup = this.virtualizer._didMount();
    this.renderVirtualRows();
  }

  /** Render just the visible window, bracketed by two spacer rows. */
  private renderVirtualRows(): void {
    const virtualizer = this.virtualizer;
    const tbody = this.tbody;
    if (!virtualizer || !tbody) return;
    const items = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const leading = items.length ? items[0]!.start : 0;
    const trailing = Math.max(0, totalSize - (items.length ? items[items.length - 1]!.end : 0));
    const spacer = (height: number): string =>
      height > 0
        ? `<tr class="virtual-spacer" aria-hidden="true" style="height:${height}px;"><td colspan="7" style="padding:0;border:0;"></td></tr>`
        : '';
    tbody.innerHTML =
      spacer(leading) + items.map((item) => this.getRowHTML(this.filteredQuestions[item.index])).join('') + spacer(trailing);
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
    }, 50));

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

    // Row checkbox/action listeners are delegated on the stable tbody in
    // mountQuestionList(), because rows are replaced as the user scrolls.

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

    // Header actions
    this.element.querySelector('#btnAddQuestion')?.addEventListener('click', () => this.editQuestion());
    this.element.querySelector('#btnImport')?.addEventListener('click', () => navigate('import'));
    this.element.querySelector('#btnExport')?.addEventListener('click', () => navigate('export'));
    this.element.querySelector('#btnTrash')?.addEventListener('click', () => navigate('trash'));
  }

  private refreshView(): void {
    if (!this.element) return;
    // Preserve the table's scroll position unless a filter changed (in which
    // case applyFilters() flags a reset to the top of the new result set).
    const scrollTop = this.resetScrollOnRefresh ? 0 : (this.scrollElement?.scrollTop ?? 0);
    this.resetScrollOnRefresh = false;
    this.disposeVirtualizer();
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    this.mountQuestionList();
    if (this.scrollElement) this.scrollElement.scrollTop = scrollTop;
  }

  // ---------------------------------------------------------------------------
  // Question CRUD modal (Task 2)
  // ---------------------------------------------------------------------------

  private async editQuestion(id?: string): Promise<void> {
    await loadKisiKisi();
    const existing = id ? await questionsRepo.getById(id) : undefined;
    if (id && !existing) {
      showToast(t('qb.questionNotFound'), 'error');
      return;
    }

    this.formQuestion = existing;
    this.formDraft = existing ? draftFromQuestion(existing) : createEmptyDraft();
    // Imported banks may use legacy codes (e.g. TK-01). They remain valid when
    // editing those rows; new questions must use a registered kisi-kisi code.
    this.formValidCodes = new Set([
      ...getAllTopicCodes(),
      ...this.questions.map(question => question.topicCode),
    ]);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay question-form-overlay';
    overlay.innerHTML = this.getFormHTML();
    document.body.appendChild(overlay);
    this.formOverlay = overlay;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModal(overlay, trigger);
    this.bindFormEvents(overlay);
    await this.initFormEditors(overlay);
  }

  private getFormHTML(): string {
    const draft = this.formDraft!;
    const isEdit = Boolean(this.formQuestion);
    const registered = new Set(getAllTopicCodes());
    const legacyCodes = [...new Set(this.questions.map(question => question.topicCode))]
      .filter(code => !registered.has(code));
    const topicOption = (code: string, title?: string): string => `
      <option value="${escapeHTML(code)}" ${draft.topicCode === code ? 'selected' : ''}>
        ${escapeHTML(code)}${title ? ' — ' + escapeHTML(title) : ''}
      </option>`;
    const topicGroups = (['umum', 'khusus'] as const).map(category => `
      <optgroup label="${escapeHTML(t(category === 'umum' ? 'kisi-kisi.umum' : 'kisi-kisi.khusus'))}">
        ${getTopicsByCategory(category).map(topic => topicOption(topic.code, topic.title)).join('')}
      </optgroup>`).join('');

    const flags: Array<{ key: keyof QuestionFormDraft['flags']; label: string }> = [
      { key: 'bookmarked', label: t('filter.bookmarked') },
      { key: 'needsReview', label: t('filter.needsReview') },
      { key: 'disputed', label: t('filter.disputed') },
    ];

    return `
      <div class="modal question-form-modal" style="max-width:860px;">
        <div class="modal-header">
          <h2 class="modal-title" id="questionFormTitle">${isEdit ? escapeHTML(t('qb.editQuestion')) : escapeHTML(t('qb.addQuestion'))}</h2>
          <button type="button" class="modal-close" id="btnCloseQuestionForm" aria-label="${escapeHTML(t('common.close'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-error question-form-summary" id="questionFormErrors" role="alert" hidden></div>
          <div class="tabs" role="tablist" aria-label="${escapeHTML(t('qb.title'))}">
            <button type="button" class="tab active" role="tab" id="qfTabStem" data-form-tab="stem" aria-controls="qfPanelStem" aria-selected="true">${escapeHTML(t('qb.tabs.stem'))}</button>
            <button type="button" class="tab" role="tab" id="qfTabOptions" data-form-tab="options" aria-controls="qfPanelOptions" aria-selected="false" tabindex="-1">${escapeHTML(t('qb.tabs.options'))}</button>
            <button type="button" class="tab" role="tab" id="qfTabExplanation" data-form-tab="explanation" aria-controls="qfPanelExplanation" aria-selected="false" tabindex="-1">${escapeHTML(t('qb.tabs.explanation'))}</button>
            <button type="button" class="tab" role="tab" id="qfTabMetadata" data-form-tab="metadata" aria-controls="qfPanelMetadata" aria-selected="false" tabindex="-1">${escapeHTML(t('qb.tabs.metadata'))}</button>
          </div>

          <section class="tab-panel" id="qfPanelStem" role="tabpanel" aria-labelledby="qfTabStem" data-form-panel="stem">
            <div class="form-group">
              <label class="form-label" for="qfTopic">${escapeHTML(t('qb.topic'))}</label>
              <select id="qfTopic" class="form-select" required>
                <option value="">— ${escapeHTML(t('filter.topic'))} —</option>
                ${topicGroups}
                ${legacyCodes.length ? `<optgroup label="${escapeHTML(t('qb.importedTopics'))}">${legacyCodes.map(code => topicOption(code)).join('')}</optgroup>` : ''}
              </select>
              <div class="form-error" data-error-for="topicCode" hidden></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="qfStem">${escapeHTML(t('qb.stem'))}</label>
              <textarea id="qfStem" class="form-textarea" rows="6">${escapeHTML(draft.stem)}</textarea>
              <p class="form-help">${escapeHTML(t('qb.markdownHelp'))}</p>
              <div class="form-error" data-error-for="stem" hidden></div>
            </div>
          </section>

          <section class="tab-panel" id="qfPanelOptions" role="tabpanel" aria-labelledby="qfTabOptions" data-form-panel="options" style="display:none;">
            <p class="form-help">${escapeHTML(t('qb.minOptions'))} · ${escapeHTML(t('qb.maxOptions'))} · ${escapeHTML(t('qb.requireCorrect'))}</p>
            <div id="qfOptions" class="question-options"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="qfAddOption">+ ${escapeHTML(t('qb.addOption'))}</button>
            <div class="form-error" data-error-for="options" hidden></div>
            <div class="form-error" data-error-for="correctAnswer" hidden></div>
          </section>

          <section class="tab-panel" id="qfPanelExplanation" role="tabpanel" aria-labelledby="qfTabExplanation" data-form-panel="explanation" style="display:none;">
            <div class="form-group">
              <label class="form-label" for="qfExplanation">${escapeHTML(t('qb.explanation'))}</label>
              <textarea id="qfExplanation" class="form-textarea" rows="8">${escapeHTML(draft.explanation)}</textarea>
              <p class="form-help">${escapeHTML(t('qb.markdownHelp'))}</p>
            </div>
          </section>

          <section class="tab-panel" id="qfPanelMetadata" role="tabpanel" aria-labelledby="qfTabMetadata" data-form-panel="metadata" style="display:none;">
            <div class="question-form-grid">
              <div class="form-group">
                <label class="form-label" for="qfDifficulty">${escapeHTML(t('qb.difficulty'))}</label>
                <select id="qfDifficulty" class="form-select">
                  ${([1, 2, 3] as Difficulty[]).map(level => `<option value="${level}" ${draft.difficulty === level ? 'selected' : ''}>${escapeHTML(t('difficulty.' + level))}</option>`).join('')}
                </select>
                <div class="form-error" data-error-for="difficulty" hidden></div>
              </div>
              <div class="form-group">
                <label class="form-label" for="qfSource">${escapeHTML(t('qb.source'))}</label>
                <input type="text" id="qfSource" class="form-input" value="${escapeHTML(draft.source)}" placeholder="BMKG 2024">
              </div>
              <div class="form-group">
                <label class="form-label" for="qfTags">${escapeHTML(t('qb.tags'))}</label>
                <input type="text" id="qfTags" class="form-input" value="${escapeHTML(draft.tags.join(', '))}" placeholder="meteorologi, cuaca">
                <p class="form-help">${escapeHTML(t('qb.tagsHelp'))}</p>
              </div>
              <fieldset class="form-group question-form-flags">
                <legend class="form-label">${escapeHTML(t('qb.flags'))}</legend>
                ${flags.map(flag => `
                  <label class="form-check">
                    <input type="checkbox" class="form-check-input" data-flag="${flag.key}" ${draft.flags[flag.key] ? 'checked' : ''}>
                    <span class="form-check-label">${escapeHTML(flag.label)}</span>
                  </label>`).join('')}
              </fieldset>
            </div>
          </section>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="qfCancel">${escapeHTML(t('common.cancel'))}</button>
          <button type="button" class="btn btn-primary" id="qfSave">${escapeHTML(isEdit ? t('common.save') : t('common.add'))}</button>
        </div>
      </div>
    `;
  }

  private bindFormEvents(overlay: HTMLElement): void {
    overlay.querySelectorAll<HTMLElement>('[data-form-tab]').forEach(button => {
      button.addEventListener('click', () => this.switchFormTab(overlay, button.dataset.formTab ?? 'stem'));
    });
    overlay.querySelector('#btnCloseQuestionForm')?.addEventListener('click', () => this.closeQuestionForm());
    overlay.querySelector('#qfCancel')?.addEventListener('click', () => this.closeQuestionForm());
    overlay.querySelector('#qfSave')?.addEventListener('click', () => void this.saveQuestionForm(overlay));
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.closeQuestionForm();
    });

    overlay.querySelector('#qfTopic')?.addEventListener('change', event => {
      if (this.formDraft) this.formDraft.topicCode = (event.target as HTMLSelectElement).value;
    });
    overlay.querySelector('#qfStem')?.addEventListener('input', event => {
      if (this.formDraft && !this.editors.stem) this.formDraft.stem = (event.target as HTMLTextAreaElement).value;
    });
    overlay.querySelector('#qfExplanation')?.addEventListener('input', event => {
      if (this.formDraft && !this.editors.explanation) this.formDraft.explanation = (event.target as HTMLTextAreaElement).value;
    });
    overlay.querySelector('#qfDifficulty')?.addEventListener('change', event => {
      if (this.formDraft) this.formDraft.difficulty = Number((event.target as HTMLSelectElement).value) as Difficulty;
    });
    overlay.querySelector('#qfSource')?.addEventListener('input', event => {
      if (this.formDraft) this.formDraft.source = (event.target as HTMLInputElement).value;
    });
    overlay.querySelector('#qfTags')?.addEventListener('input', event => {
      if (this.formDraft) this.formDraft.tags = parseTags((event.target as HTMLInputElement).value);
    });
    overlay.querySelectorAll<HTMLInputElement>('[data-flag]').forEach(input => {
      input.addEventListener('change', () => {
        const flag = input.dataset.flag as keyof QuestionFormDraft['flags'] | undefined;
        if (this.formDraft && flag) this.formDraft.flags[flag] = input.checked;
      });
    });

    overlay.querySelector('#qfAddOption')?.addEventListener('click', () => {
      const draft = this.formDraft;
      if (!draft || draft.options.length >= MAX_OPTIONS) return;
      draft.options.push({ id: generateId(), text: '', isCorrect: false });
      this.renderOptionRows(overlay);
      overlay.querySelector<HTMLInputElement>(`.option-text[data-index="${draft.options.length - 1}"]`)?.focus();
    });

    const options = overlay.querySelector<HTMLElement>('#qfOptions');
    options?.addEventListener('input', event => {
      const target = event.target as HTMLInputElement;
      if (!target.matches('.option-text') || !this.formDraft) return;
      const option = this.formDraft.options[Number(target.dataset.index)];
      if (option) option.text = target.value;
    });
    options?.addEventListener('change', event => {
      const target = event.target as HTMLInputElement;
      if (!target.matches('.option-correct') || !this.formDraft) return;
      const option = this.formDraft.options[Number(target.dataset.index)];
      if (!option) return;
      option.isCorrect = target.checked;
      target.closest('.question-option-row')?.classList.toggle('is-correct', target.checked);
    });
    options?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.option-remove');
      if (!button || !this.formDraft || this.formDraft.options.length <= MIN_OPTIONS) return;
      this.formDraft.options.splice(Number(button.dataset.index), 1);
      this.renderOptionRows(overlay);
    });

    this.renderOptionRows(overlay);
  }

  private async initFormEditors(overlay: HTMLElement): Promise<void> {
    if (this.formOverlay !== overlay || !this.formDraft) return;
    try {
      const { default: EditorCtor } = await import('easymde');
      const Editor = EditorCtor as unknown as EditorConstructor;
      const draft = this.formDraft;
      const create = (selector: string, value: string, key: 'stem' | 'explanation'): MarkdownEditor | null => {
        const element = overlay.querySelector<HTMLTextAreaElement>(selector);
        if (!element) return null;
        element.value = value;
        const editor = new Editor({
          element,
          initialValue: value,
          autoDownloadFontAwesome: false,
          spellChecker: false,
          status: false,
          toolbar: ['bold', 'italic', 'heading', '|', 'unordered-list', 'ordered-list', 'link', '|', 'preview', 'guide'],
          placeholder: t(key === 'stem' ? 'qb.stem' : 'qb.explanation'),
        });
        editor.codemirror.on('change', () => {
          if (this.formDraft && this.formOverlay === overlay) this.formDraft[key] = editor.value();
        });
        return editor;
      };
      this.editors.stem = create('#qfStem', draft.stem, 'stem');
      this.editors.explanation = create('#qfExplanation', draft.explanation, 'explanation');
    } catch (error) {
      // The plain textareas remain fully usable if the editor bundle fails.
      console.warn('Markdown editor unavailable, using plain textareas:', error);
    }
  }

  private readEditorValue(overlay: HTMLElement, key: 'stem' | 'explanation'): string {
    const editor = this.editors[key];
    if (editor) return editor.value();
    const selector = key === 'stem' ? '#qfStem' : '#qfExplanation';
    return overlay.querySelector<HTMLTextAreaElement>(selector)?.value ?? '';
  }

  private switchFormTab(overlay: HTMLElement, name: string): void {
    overlay.querySelectorAll<HTMLElement>('[data-form-tab]').forEach(button => {
      const active = button.dataset.formTab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    overlay.querySelectorAll<HTMLElement>('[data-form-panel]').forEach(panel => {
      panel.style.display = panel.dataset.formPanel === name ? 'block' : 'none';
    });
    // CodeMirror measures its container on init; refresh after a hidden panel
    // becomes visible so the editor is not stuck at zero width.
    if (name === 'stem') this.editors.stem?.codemirror.refresh();
    if (name === 'explanation') this.editors.explanation?.codemirror.refresh();
  }

  private renderOptionRows(overlay: HTMLElement): void {
    const draft = this.formDraft;
    const container = overlay.querySelector<HTMLElement>('#qfOptions');
    if (!draft || !container) return;
    container.innerHTML = draft.options.map((option, index) => {
      const letter = String.fromCharCode(65 + index);
      return `
        <div class="question-option-row ${option.isCorrect ? 'is-correct' : ''}" data-option-index="${index}">
          <span class="option-letter" aria-hidden="true">${letter}</span>
          <input type="checkbox" class="form-check-input option-correct" data-index="${index}" aria-label="${escapeHTML(t('qb.correctOption', { letter }))}" ${option.isCorrect ? 'checked' : ''}>
          <input type="text" class="form-input option-text" data-index="${index}" value="${escapeHTML(option.text)}" aria-label="${escapeHTML(t('qb.optionPlaceholder', { letter }))}" placeholder="${escapeHTML(t('qb.optionPlaceholder', { letter }))}">
          <button type="button" class="btn btn-ghost btn-icon btn-sm option-remove" data-index="${index}" aria-label="${escapeHTML(t('qb.removeOption'))} ${letter}" ${draft.options.length <= MIN_OPTIONS ? 'disabled' : ''}>×</button>
        </div>`;
    }).join('');
    const addButton = overlay.querySelector<HTMLButtonElement>('#qfAddOption');
    if (addButton) addButton.disabled = draft.options.length >= MAX_OPTIONS;
  }

  private syncFormDraftFromDOM(overlay: HTMLElement): void {
    const draft = this.formDraft;
    if (!draft) return;
    draft.topicCode = overlay.querySelector<HTMLSelectElement>('#qfTopic')?.value ?? '';
    draft.stem = this.readEditorValue(overlay, 'stem');
    draft.explanation = this.readEditorValue(overlay, 'explanation');
    draft.difficulty = Number(overlay.querySelector<HTMLSelectElement>('#qfDifficulty')?.value ?? 2) as Difficulty;
    draft.source = overlay.querySelector<HTMLInputElement>('#qfSource')?.value ?? '';
    draft.tags = parseTags(overlay.querySelector<HTMLInputElement>('#qfTags')?.value ?? '');
    overlay.querySelectorAll<HTMLInputElement>('[data-flag]').forEach(input => {
      const flag = input.dataset.flag as keyof QuestionFormDraft['flags'] | undefined;
      if (flag) draft.flags[flag] = input.checked;
    });
    // Rebuild from the rendered rows so option removals shift indices cleanly.
    draft.options = Array.from(overlay.querySelectorAll<HTMLElement>('.question-option-row')).map((row, index) => ({
      id: draft.options[index]?.id ?? generateId(),
      text: row.querySelector<HTMLInputElement>('.option-text')?.value ?? '',
      isCorrect: row.querySelector<HTMLInputElement>('.option-correct')?.checked ?? false,
    }));
  }

  private showFormErrors(overlay: HTMLElement, errors: Partial<Record<QuestionFormField, QuestionFormErrorCode>>): void {
    overlay.querySelectorAll<HTMLElement>('[data-error-for]').forEach(node => {
      node.hidden = true;
      node.textContent = '';
    });
    const messages: Record<QuestionFormErrorCode, string> = {
      required: t('qb.required'),
      invalidTopic: t('qb.validTopic'),
      invalidDifficulty: t('qb.difficulty'),
      minOptions: t('qb.minOptions'),
      maxOptions: t('qb.maxOptions'),
      optionTextRequired: t('qb.required'),
      requireCorrect: t('qb.requireCorrect'),
    };
    const fields: QuestionFormField[] = ['stem', 'topicCode', 'difficulty', 'options', 'correctAnswer'];
    let firstField: QuestionFormField | null = null;
    for (const field of fields) {
      const code = errors[field];
      if (!code) continue;
      if (!firstField) firstField = field;
      const target = overlay.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (target) {
        target.textContent = messages[code];
        target.hidden = false;
      }
    }
    if (!firstField) return;

    const summary = overlay.querySelector<HTMLElement>('#questionFormErrors');
    if (summary) {
      summary.textContent = t('qb.fixErrors');
      summary.hidden = false;
    }
    const tab = firstField === 'difficulty'
      ? 'metadata'
      : firstField === 'options' || firstField === 'correctAnswer'
        ? 'options'
        : 'stem';
    this.switchFormTab(overlay, tab);
    if (firstField === 'stem' && this.editors.stem) this.editors.stem.codemirror.focus();
    else {
      const selectors: Record<QuestionFormField, string> = {
        stem: '#qfStem',
        topicCode: '#qfTopic',
        difficulty: '#qfDifficulty',
        options: '.option-text',
        correctAnswer: '.option-correct',
      };
      overlay.querySelector<HTMLElement>(selectors[firstField])?.focus();
    }
  }

  private async saveQuestionForm(overlay: HTMLElement): Promise<void> {
    this.syncFormDraftFromDOM(overlay);
    const draft = this.formDraft;
    if (!draft) return;

    const errors = validateQuestionDraft(draft, this.formValidCodes);
    if (Object.keys(errors).length > 0) {
      this.showFormErrors(overlay, errors);
      return;
    }

    try {
      const wasEdit = Boolean(this.formQuestion);
      const question = draftToQuestion(draft, this.formQuestion);
      if (wasEdit) await questionsRepo.put(question);
      else await questionsRepo.add(question);
      this.closeQuestionForm();
      showToast(t(wasEdit ? 'qb.updated' : 'qb.created'), 'success');
      await this.reloadAfterMutation();
    } catch (error) {
      showToast(t('error.saveFailed', { error: String(error) }), 'error');
    }
  }

  private closeQuestionForm(): void {
    this.editors.stem?.cleanup();
    this.editors.explanation?.cleanup();
    this.editors = { stem: null, explanation: null };
    const overlay = this.formOverlay;
    this.formOverlay = null;
    this.formDraft = null;
    this.formQuestion = undefined;
    if (overlay) closeModal(overlay);
  }

  /** Small accessible confirmation dialog (no blocking window.confirm). */
  private confirmAction(message: string): Promise<boolean> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:440px;">
          <div class="modal-header"><h2 class="modal-title">${escapeHTML(t('common.confirm'))}</h2></div>
          <div class="modal-body"><p style="margin:0;">${escapeHTML(message)}</p></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="confirmCancel">${escapeHTML(t('common.cancel'))}</button>
            <button type="button" class="btn btn-danger" id="confirmYes">${escapeHTML(t('common.delete'))}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      openModal(overlay);
      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        closeModal(overlay);
        resolve(result);
      };
      overlay.querySelector('#confirmYes')?.addEventListener('click', () => finish(true));
      overlay.querySelector('#confirmCancel')?.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(false);
      });
    });
  }

  private async duplicateQuestion(id: string): Promise<void> {
    const { questionsRepo } = await import('../db/repositories/questions');
    const question = await questionsRepo.getById(id);
    if (question) {
      const newQuestion = {
        ...question,
        id: generateId(),
        metadata: { ...question.metadata, createdAt: nowISO(), updatedAt: nowISO(), version: 1 },
        statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
      };
      await questionsRepo.add(newQuestion);
      await this.reloadAfterMutation();
    }
  }

  private async deleteQuestion(id: string): Promise<void> {
    if (!(await this.confirmAction(t('qb.deleteConfirm')))) return;
    try {
      await questionsRepo.delete(id);
      this.selectedIds.delete(id);
      this.selectAll = false;
      showToast(t('qb.movedToTrash'), 'success');
      await this.reloadAfterMutation();
    } catch (error) {
      showToast(t('error.deleteFailed', { error: String(error) }), 'error');
    }
  }

  private bulkTag(): void {
    // TODO: Implement bulk tag modal
    alert('Bulk tag - TODO');
  }

  private async bulkFlag(): Promise<void> {
    const { questionsRepo } = await import('../db/repositories/questions');
    await Promise.all(Array.from(this.selectedIds, async (id) => {
      const q = await questionsRepo.getById(id);
      if (q) {
        q.flags.bookmarked = true;
        await questionsRepo.put(q);
      }
    }));
    await this.reloadAfterMutation();
  }

  private async bulkUnflag(): Promise<void> {
    const { questionsRepo } = await import('../db/repositories/questions');
    await Promise.all(Array.from(this.selectedIds, async (id) => {
      const q = await questionsRepo.getById(id);
      if (q) {
        q.flags.bookmarked = false;
        q.flags.needsReview = false;
        q.flags.disputed = false;
        await questionsRepo.put(q);
      }
    }));
    await this.reloadAfterMutation();
  }

  private async bulkReview(): Promise<void> {
    const { questionsRepo } = await import('../db/repositories/questions');
    await Promise.all(Array.from(this.selectedIds, async (id) => {
      const q = await questionsRepo.getById(id);
      if (q) {
        q.flags.needsReview = true;
        await questionsRepo.put(q);
      }
    }));
    await this.reloadAfterMutation();
  }

  private async bulkDelete(): Promise<void> {
    if (confirm(`Hapus ${this.selectedIds.size} soal?`)) {
      const { questionsRepo } = await import('../db/repositories/questions');
      await questionsRepo.bulkDelete(Array.from(this.selectedIds));
      this.selectedIds.clear();
      this.selectAll = false;
      await this.reloadAfterMutation();
    }
  }

  /** Re-read the source data, invalidate the memoized selector, re-render. */
  private async reloadAfterMutation(): Promise<void> {
    await this.loadQuestions();
    if (this.element) this.refreshView();
  }
}

import { debounce } from '../core/utils';
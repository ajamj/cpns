// Question Bank View
import { questionsRepo } from '../db/repositories/questions';
import {
  getAllTopicCodes,
  getSubdomainColor,
  getTopicsByCategory,
  getTopicsBySubdomain,
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
import { navigateToHash } from '../core/router';
import { generateId, nowISO, downloadJSON } from '../core/utils';
import { memoizeSelector, showProgressToast, showToast } from '../core/app-utils';
import {
  applyBulkUpdate,
  questionsToCSV,
  type BulkTagMode,
  type BulkUpdate,
} from '../features/questions/bulk-operations';
import { closeModal, openModal } from '../core/modal';
import type EasyMDE from 'easymde';
import type {
  Difficulty,
  KisiKisiTopic,
  MasteryLevel,
  Question,
  QuestionFilter,
  QuestionFlag,
  QuestionFlags,
  TopicCode,
} from '../shared/types';
import type Fuse from 'fuse.js';
import {
  createQuestionSearchIndex,
  rankQuestionMatches,
  searchableText,
} from '../features/questions/question-search';
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

const SUBDOMAIN_LABEL_KEYS: Record<KisiKisiTopic['subdomain'], string> = {
  meteorology: 'subdomain.meteorology',
  climatology: 'subdomain.climatology',
  geophysics: 'subdomain.geophysics',
  geology: 'subdomain.geology',
  instrumentation: 'subdomain.instrumentation',
};

function subdomainLabel(subdomain: KisiKisiTopic['subdomain']): string {
  const key = SUBDOMAIN_LABEL_KEYS[subdomain] ?? subdomain;
  const label = t(key);
  return label === key ? subdomain : label;
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
    // id → relevance score (lower is better). Fuse's includeScore results and
    // the weighted literal fast path share this single ranking channel.
    let searchScores: Map<string, number> | null = null;

    if (searchQuery && fuse) {
      searchScores = rankQuestionMatches(questions, searchQuery, fuse);
      const ids = new Set(searchScores?.keys() ?? []);
      filtered = filtered.filter((q) => ids.has(q.id));
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

    // Relevance first while searching; createdAt is the stable tie-breaker
    // (and the only ordering when there is no search query).
    filtered.sort((a, b) => {
      if (searchScores) {
        const scoreDiff = (searchScores.get(a.id) ?? 1) - (searchScores.get(b.id) ?? 1);
        if (scoreDiff !== 0) return scoreDiff;
      }
      return new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime();
    });
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
  private trashCount = 0;
  private filter: QuestionFilter = {};
  private searchQuery = '';
  private fuse: Fuse<any> | null = null;
  // Selection is keyed by ID, not by rendered row, so it survives virtualization.
  private selectedIds: Set<string> = new Set();
  private bulkOperationInProgress = false;
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
    if (this.params.topic) this.filter.topicCodes = this.params.topic.split(',') as TopicCode[];
    if (this.params.difficulty) this.filter.difficulty = parseInt(this.params.difficulty) as any;
    if (this.params.mastery) this.filter.masteryLevels = this.params.mastery.split(',').map(Number) as any;
    if (this.params.flags) {
      const flags = this.params.flags.split(',');
      this.filter.flags = {};
      flags.forEach(f => { this.filter.flags![f as QuestionFlag] = true; });
    }
    if (this.params.source) this.filter.source = this.params.source;
    if (this.params.startDate || this.params.endDate) {
      const start = this.params.startDate ?? this.params.endDate ?? '';
      const end = this.params.endDate ?? this.params.startDate ?? '';
      if (start <= end) this.filter.dateRange = { start, end };
    }
    if (this.params.search) this.searchQuery = this.params.search;
  }

  async loadQuestions(): Promise<void> {
    const [questions, trashCount] = await Promise.all([
      questionsRepo.getAll(),
      questionsRepo.getTrashCount(),
    ]);
    this.questions = questions;
    this.trashCount = trashCount;
    // Underlying data changed: the memoized selector cache is no longer valid.
    selectFilteredQuestions.clear();
    // Build the searchable haystacks while the view is loading, so the first
    // keystroke only filters the already-normalised strings instead of walking
    // every option/tag of 2000 questions inside the interaction budget.
    this.questions.forEach(searchableText);

    // Fuse index: stem 3x / options 2x / explanation 1.5x / tags 1x,
    // threshold 0.4, minMatchCharLength 2, includeScore for ranking.
    this.fuse = createQuestionSearchIndex(this.questions);

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

  /** Selection is scoped to the current result set: stale IDs are pruned. */
  private updateSelectionState(): void {
    const visibleIds = new Set(this.filteredQuestions.map((q) => q.id));
    for (const id of this.selectedIds) {
      if (!visibleIds.has(id)) this.selectedIds.delete(id);
    }
  }

  private get visibleSelectedCount(): number {
    return this.filteredQuestions.reduce((count, q) => count + (this.selectedIds.has(q.id) ? 1 : 0), 0);
  }

  private get allVisibleSelected(): boolean {
    return this.filteredQuestions.length > 0 && this.visibleSelectedCount === this.filteredQuestions.length;
  }

  private setAllVisibleSelected(checked: boolean): void {
    for (const q of this.filteredQuestions) {
      if (checked) this.selectedIds.add(q.id);
      else this.selectedIds.delete(q.id);
    }
    this.syncSelectionUI();
  }

  /** Update the bulk bar and checkbox states without re-rendering the table. */
  private syncSelectionUI(): void {
    if (!this.element) return;
    const main = this.element.querySelector<HTMLElement>('.question-bank-main');
    if (!main) return;

    const bar = main.querySelector<HTMLElement>('#bulkActionsBar');
    if (this.selectedIds.size > 0) {
      const markup = this.getBulkActionsHTML();
      if (bar) bar.outerHTML = markup;
      else main.insertAdjacentHTML('afterbegin', markup);
    } else {
      bar?.remove();
    }

    const allSelected = this.allVisibleSelected;
    const someSelected = this.visibleSelectedCount > 0;
    main.querySelectorAll<HTMLInputElement>('.select-all-checkbox').forEach(input => {
      input.checked = allSelected;
      input.indeterminate = someSelected && !allSelected;
      input.disabled = this.bulkOperationInProgress;
    });
    this.tbody?.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach(row => {
      const selected = this.selectedIds.has(row.dataset.id ?? '');
      row.classList.toggle('selected', selected);
      const checkbox = row.querySelector<HTMLInputElement>('.row-checkbox');
      if (checkbox) {
        checkbox.checked = selected;
        checkbox.disabled = this.bulkOperationInProgress;
      }
    });
    main.querySelectorAll<HTMLButtonElement>('.bulk-action-button').forEach(button => {
      button.disabled = this.bulkOperationInProgress;
    });
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

      <div class="question-bank-layout">
      <!-- Filter sidebar: all filter dimensions persist across re-renders -->
      <aside class="question-filter-sidebar card" id="filterSidebar" aria-label="${t('common.filter')}">
        <div class="filter-sidebar-inner">
          <div class="filter-sidebar-header">
            <h2 class="filter-sidebar-title">${t('common.filter')}</h2>
            <button type="button" class="btn btn-ghost btn-sm" id="btnClearFilters">${t('filter.clear')}</button>
          </div>

          <div class="filter-section">
            <label class="form-label" for="searchInput">${t('common.search')}</label>
            <div style="position:relative;">
              <input type="search" id="searchInput" class="form-input" placeholder="${t('common.search')}" value="${escapeHTML(this.searchQuery)}" style="padding-right:40px;">
              <button type="button" id="btnClearSearch" class="btn btn-ghost btn-icon" aria-label="${t('common.search')}: ${t('filter.clear')}" style="position:absolute;right:var(--space-2);top:50%;transform:translateY(-50%);" ${!this.searchQuery ? 'hidden' : ''}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <section class="filter-section">
            <h3 class="filter-section-title" id="topicFilterLabel">${t('filter.topic')}</h3>
            <div class="filter-tree" role="group" aria-labelledby="topicFilterLabel">
              ${this.getTopicTreeHTML()}
            </div>
          </section>

          <div class="filter-section">
            <label class="form-label" for="difficultyFilter">${t('filter.difficulty')}</label>
            <select id="difficultyFilter" class="form-select" aria-label="${t('filter.difficulty')}">
              <option value="">${t('filter.all')}</option>
              <option value="1" ${this.filter.difficulty === 1 ? 'selected' : ''}>${t('difficulty.1')}</option>
              <option value="2" ${this.filter.difficulty === 2 ? 'selected' : ''}>${t('difficulty.2')}</option>
              <option value="3" ${this.filter.difficulty === 3 ? 'selected' : ''}>${t('difficulty.3')}</option>
            </select>
          </div>

          <section class="filter-section">
            <fieldset class="filter-fieldset">
              <legend class="filter-section-title">${t('filter.flags')}</legend>
              ${([
                ['bookmarked', 'filter.bookmarked'],
                ['needsReview', 'filter.needsReview'],
                ['disputed', 'filter.disputed'],
              ] as Array<[QuestionFlag, string]>).map(([flag, label]) => `
                <label class="form-check filter-check">
                  <input type="checkbox" class="form-check-input" id="flagFilter-${flag}" name="filterFlag" value="${flag}" ${this.filter.flags?.[flag] ? 'checked' : ''}>
                  <span class="form-check-label">${t(label)}</span>
                </label>`).join('')}
            </fieldset>
          </section>

          <section class="filter-section">
            <fieldset class="filter-fieldset">
              <legend class="filter-section-title">${t('filter.mastery')}</legend>
              ${([0, 1, 2, 3] as MasteryLevel[]).map(level => `
                <label class="form-check filter-check">
                  <input type="checkbox" class="form-check-input" id="masteryFilter-${level}" name="filterMastery" value="${level}" ${this.filter.masteryLevels?.includes(level) ? 'checked' : ''}>
                  <span class="form-check-label">${t('mastery.' + level)}</span>
                </label>`).join('')}
            </fieldset>
          </section>

          <div class="filter-section">
            <label class="form-label" for="sourceFilter">${t('filter.source')}</label>
            <input type="text" id="sourceFilter" class="form-input" placeholder="${t('filter.source')}" value="${escapeHTML(this.filter.source ?? '')}" autocomplete="off">
          </div>

          <section class="filter-section">
            <h3 class="filter-section-title" id="dateRangeLabel">${t('filter.dateRange')}</h3>
            <div class="filter-date-range" role="group" aria-labelledby="dateRangeLabel">
              <div>
                <label class="filter-sublabel" for="dateStart">${t('filter.dateStart')}</label>
                <input type="date" id="dateStart" class="form-input" value="${escapeHTML(this.filter.dateRange?.start ?? '')}">
              </div>
              <div>
                <label class="filter-sublabel" for="dateEnd">${t('filter.dateEnd')}</label>
                <input type="date" id="dateEnd" class="form-input" value="${escapeHTML(this.filter.dateRange?.end ?? '')}">
              </div>
            </div>
          </section>
        </div>
      </aside>

      <div class="question-bank-main">
      <!-- Bulk Actions Bar -->
      ${this.getBulkActionsHTML()}

      <!-- Question Table (virtualized: only visible rows are in the DOM) -->
      <div class="card">
        <div id="questionsScroll" class="table-container" style="max-height:min(70vh,720px);overflow:auto;">
          <table class="table" id="questionsTable">
            <thead>
              <tr>
                <th style="width:40px;">
                  <input type="checkbox" class="form-check-input bulk-checkbox select-all-checkbox" id="selectAllHeader" aria-label="${t('qb.selectAll')}">
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
      </div>
    </div>
    `;
  }

  /** Bulk action bar; rendered only while at least one question is selected. */
  private getBulkActionsHTML(): string {
    if (this.selectedIds.size === 0) return '';
    const allSelected = this.allVisibleSelected;
    const count = this.selectedIds.size;
    return `
      <div class="card bulk-actions-bar" id="bulkActionsBar" style="margin-bottom:var(--space-4);background:var(--color-primary-light);border-color:var(--color-primary);">
        <div class="card-content" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <label class="form-check">
              <input type="checkbox" class="form-check-input bulk-checkbox select-all-checkbox" aria-label="${t('qb.selectAll')}" ${allSelected ? 'checked' : ''} ${this.bulkOperationInProgress ? 'disabled' : ''}>
              <span class="form-check-label">${t('qb.selectAll')} (${this.filteredQuestions.length})</span>
            </label>
            <span style="color:var(--color-primary);font-weight:var(--font-medium);">${t('qb.selectedCount', { count })}</span>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm bulk-action-button" id="btnBulkTag" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.tag')}</button>
            <button type="button" class="btn btn-primary btn-sm bulk-action-button" id="btnBulkRetag" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.bulkRetag')}</button>
            <button type="button" class="btn btn-secondary btn-sm bulk-action-button" id="btnBulkExport" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.bulkExport')}</button>
            <button type="button" class="btn btn-secondary btn-sm bulk-action-button" id="btnBulkFlag" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.flag')}</button>
            <button type="button" class="btn btn-secondary btn-sm bulk-action-button" id="btnBulkUnflag" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.unflag')}</button>
            <button type="button" class="btn btn-secondary btn-sm bulk-action-button" id="btnBulkReview" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.bulkNeedsReview')}</button>
            <button type="button" class="btn btn-danger btn-sm bulk-action-button" id="btnBulkDelete" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('common.delete')}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btnClearSelection" ${this.bulkOperationInProgress ? 'disabled' : ''}>${t('qb.deselectAll')}</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Multi-select topic tree: category → subdomain → topic. The registry is
   * loaded before the view renders (app.ts), so this stays synchronous.
   * Branch checkboxes carry their leaf codes in `data-topic-codes`, which lets
   * a single change handler add/remove whole subdomains or categories.
   */
  private getTopicTreeHTML(): string {
    const selected = new Set<string>(this.filter.topicCodes ?? []);
    const registered = new Set(getAllTopicCodes());
    const legacyCodes = [...new Set(this.questions.map(q => q.topicCode))]
      .filter(code => !registered.has(code));

    const topicHTML = (topic: { code: string; title?: string }): string => `
      <label class="filter-tree-leaf" for="filter-topic-${escapeHTML(topic.code)}">
        <input type="checkbox" class="form-check-input filter-topic" id="filter-topic-${escapeHTML(topic.code)}" value="${escapeHTML(topic.code)}" ${selected.has(topic.code) ? 'checked' : ''}>
        <span class="filter-topic-code">${escapeHTML(topic.code)}</span>
        ${topic.title ? `<span class="filter-topic-title">${escapeHTML(topic.title)}</span>` : ''}
      </label>`;

    const branchHTML = (
      id: string,
      label: string,
      codes: string[],
      className: string
    ): string => `
      <label class="filter-tree-branch ${className}" for="${escapeHTML(id)}">
        <input type="checkbox" class="form-check-input filter-topic-branch" id="${escapeHTML(id)}" data-topic-codes="${escapeHTML(codes.join(','))}" ${codes.length > 0 && codes.every(code => selected.has(code)) ? 'checked' : ''}>
        <span>${escapeHTML(label)}</span>
      </label>`;

    const categories: Array<{ id: 'umum' | 'khusus'; label: string }> = [
      { id: 'umum', label: t('kisi-kisi.umum') },
      { id: 'khusus', label: t('kisi-kisi.khusus') },
    ];

    const categoryHTML = ({ id, label }: { id: 'umum' | 'khusus'; label: string }): string => {
      const topics = getTopicsByCategory(id);
      const subdomains = [...new Set(topics.map(topic => topic.subdomain))];
      const subdomainHTML = subdomains.map(subdomain => {
        const subTopics = getTopicsBySubdomain(subdomain).filter(topic => topic.category === id);
        const codes = subTopics.map(topic => topic.code);
        return `
          <div class="filter-tree-subdomain">
            ${branchHTML(`filter-subdomain-${id}-${subdomain}`, subdomainLabel(subdomain), codes, 'filter-tree-subdomain-label')}
            <div class="filter-tree-children">${subTopics.map(topicHTML).join('')}</div>
          </div>`;
      }).join('');
      return `
        <div class="filter-tree-category">
          ${branchHTML(`filter-category-${id}`, label, topics.map(topic => topic.code), 'filter-tree-category-label')}
          ${subdomainHTML}
        </div>`;
    };

    return categories.map(categoryHTML).join('') + (legacyCodes.length
      ? `<div class="filter-tree-category">
           <div class="filter-tree-legacy-label">${escapeHTML(t('qb.importedTopics'))}</div>
           <div class="filter-tree-children">${legacyCodes.map(code => topicHTML({ code })).join('')}</div>
         </div>`
      : '');
  }

  /** Reflect partially selected branches (native checkboxes have no tri-state attribute). */
  private syncTopicTreeIndeterminate(): void {
    const selected = new Set<string>(this.filter.topicCodes ?? []);
    this.element?.querySelectorAll<HTMLInputElement>('.filter-topic-branch').forEach(input => {
      const codes = (input.dataset.topicCodes ?? '').split(',').filter(Boolean);
      const matched = codes.filter(code => selected.has(code)).length;
      input.indeterminate = matched > 0 && matched < codes.length;
    });
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
        <td><input type="checkbox" class="form-check-input row-checkbox bulk-checkbox" id="row-check-${escapeHTML(q.id)}" aria-label="${t('qb.selectAll')}: ${escapeHTML(q.topicCode)}" value="${escapeHTML(q.id)}" ${this.selectedIds.has(q.id) ? 'checked' : ''} ${this.bulkOperationInProgress ? 'disabled' : ''}></td>
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
      if (!target.matches('.row-checkbox') || this.bulkOperationInProgress) return;
      if (target.checked) this.selectedIds.add(target.value);
      else this.selectedIds.delete(target.value);
      // Rows stay mounted: only the bulk bar and checkbox states change. This
      // keeps selection stable across virtualized windows and scroll position.
      this.syncSelectionUI();
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
    return this.trashCount;
  }

  private bindEvents(): void {
    if (!this.element) return;

    // Search — debounced; refreshView() restores focus and caret afterwards.
    const searchInput = this.element.querySelector<HTMLInputElement>('#searchInput');
    const clearSearch = this.element.querySelector<HTMLButtonElement>('#btnClearSearch');

    searchInput?.addEventListener('input', debounce(() => {
      this.searchQuery = searchInput.value;
      this.applyFilters();
      this.refreshView();
    }, 50));

    clearSearch?.addEventListener('click', () => {
      this.searchQuery = '';
      this.applyFilters();
      this.refreshView();
    });

    const sidebar = this.element.querySelector<HTMLElement>('#filterSidebar');

    // Source is a substring match; debounce to avoid re-rendering mid-keystroke.
    const sourceInput = sidebar?.querySelector<HTMLInputElement>('#sourceFilter');
    sourceInput?.addEventListener('input', debounce(() => {
      const value = sourceInput.value.trim();
      this.filter.source = value || undefined;
      this.applyFilters();
      this.refreshView();
    }, 150));

    // One delegated handler covers every checkbox/select in the sidebar,
    // including the category and subdomain branch checkboxes.
    sidebar?.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      let changed = true;

      if (target instanceof HTMLInputElement && target.matches('.filter-topic')) {
        const codes = new Set<string>(this.filter.topicCodes ?? []);
        if (target.checked) codes.add(target.value);
        else codes.delete(target.value);
        this.filter.topicCodes = [...codes] as TopicCode[];
      } else if (target instanceof HTMLInputElement && target.matches('.filter-topic-branch')) {
        this.setTopicCodes((target.dataset.topicCodes ?? '').split(',').filter(Boolean), target.checked);
      } else if (target.id === 'difficultyFilter') {
        this.filter.difficulty = target.value ? Number(target.value) as Difficulty : undefined;
      } else if (target.name === 'filterFlag') {
        const flags: Partial<QuestionFlags> = {};
        sidebar.querySelectorAll<HTMLInputElement>('input[name="filterFlag"]:checked').forEach(cb => {
          flags[cb.value as QuestionFlag] = true;
        });
        this.filter.flags = flags;
      } else if (target.name === 'filterMastery') {
        this.filter.masteryLevels = Array.from(sidebar.querySelectorAll<HTMLInputElement>('input[name="filterMastery"]:checked'))
          .map(cb => Number(cb.value) as MasteryLevel);
      } else if (target.id === 'dateStart' || target.id === 'dateEnd') {
        changed = this.applyDateRange();
      } else {
        changed = false;
      }

      if (changed) {
        this.applyFilters();
        this.refreshView();
      }
    });

    // Clear filters
    this.element.querySelector('#btnClearFilters')?.addEventListener('click', () => {
      this.filter = {};
      this.searchQuery = '';
      this.applyFilters();
      this.refreshView();
    });

    this.syncTopicTreeIndeterminate();
    this.syncSelectionUI();

    // Bulk bar is inserted/removed dynamically, so its events are delegated on
    // the stable view root. Bind once: bindEvents() runs after every re-render.
    if (!this.element.dataset.bulkBound) {
      this.element.dataset.bulkBound = 'true';
      this.element.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement;
        if (target.matches('.select-all-checkbox') && !this.bulkOperationInProgress) {
          this.setAllVisibleSelected(target.checked);
        }
      });
      this.element.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '.bulk-action-button, #btnClearSelection'
        );
        if (!button || !this.element?.contains(button) || this.bulkOperationInProgress) return;
        switch (button.id) {
          case 'btnBulkTag': void this.bulkTag(); break;
          case 'btnBulkRetag': void this.bulkRetag(); break;
          case 'btnBulkExport': void this.bulkExport(); break;
          case 'btnBulkFlag': void this.bulkFlag(); break;
          case 'btnBulkUnflag': void this.bulkUnflag(); break;
          case 'btnBulkReview': void this.bulkReview(); break;
          case 'btnBulkDelete': void this.bulkDelete(); break;
          case 'btnClearSelection':
            this.selectedIds.clear();
            this.syncSelectionUI();
            break;
        }
      });
    }

    // Row checkbox/action listeners are delegated on the stable tbody in
    // mountQuestionList(), because rows are replaced as the user scrolls.

    // Header actions
    this.element.querySelector('#btnAddQuestion')?.addEventListener('click', () => this.editQuestion());
    this.element.querySelector('#btnImport')?.addEventListener('click', () => navigate('import'));
    this.element.querySelector('#btnExport')?.addEventListener('click', () => navigate('export'));
    this.element.querySelector('#btnTrash')?.addEventListener('click', () => navigateToHash('#/questions/trash'));
  }

  private setTopicCodes(codes: string[], checked: boolean): void {
    const selected = new Set<string>(this.filter.topicCodes ?? []);
    codes.forEach(code => checked ? selected.add(code) : selected.delete(code));
    this.filter.topicCodes = [...selected] as TopicCode[];
  }

  /** Validate the date pair before passing it to the repository filter. */
  private applyDateRange(): boolean {
    const sidebar = this.element?.querySelector<HTMLElement>('#filterSidebar');
    const startInput = sidebar?.querySelector<HTMLInputElement>('#dateStart');
    const endInput = sidebar?.querySelector<HTMLInputElement>('#dateEnd');
    const start = startInput?.value ?? '';
    const end = endInput?.value ?? '';

    if (start && end && start > end) {
      showToast(t('filter.invalidDateRange'), 'error');
      // Revert the invalid input so the UI keeps reflecting applied filters.
      if (startInput) startInput.value = this.filter.dateRange?.start ?? '';
      if (endInput) endInput.value = this.filter.dateRange?.end ?? '';
      return false;
    }
    // A single date filters that one day (inclusive) instead of excluding all.
    this.filter.dateRange = start || end ? { start: start || end, end: end || start } : undefined;
    return true;
  }

  private refreshView(): void {
    if (!this.element) return;
    // Preserve the table's scroll position unless a filter changed (in which
    // case applyFilters() flags a reset to the top of the new result set).
    const scrollTop = this.resetScrollOnRefresh ? 0 : (this.scrollElement?.scrollTop ?? 0);
    this.resetScrollOnRefresh = false;
    // Re-rendering replaces the sidebar too: keep its scroll and the focused
    // control (search/source typing must not lose focus after each keystroke).
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && this.element.contains(active) ? active.id : '';
    const focusStart =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && ['text', 'search', 'tel', 'url'].includes(active.type))
        ? active.selectionStart
        : null;
    const sidebarScrollTop = this.element.querySelector<HTMLElement>('#filterSidebar .filter-sidebar-inner')?.scrollTop ?? 0;
    this.disposeVirtualizer();
    this.element.innerHTML = this.getHTML();
    this.bindEvents();
    this.mountQuestionList();
    if (this.scrollElement) this.scrollElement.scrollTop = scrollTop;
    const sidebarInner = this.element.querySelector<HTMLElement>('#filterSidebar .filter-sidebar-inner');
    if (sidebarInner) sidebarInner.scrollTop = sidebarScrollTop;
    if (focusId) {
      const next = this.element.querySelector<HTMLElement>(`[id="${focusId}"]`);
      if (next) {
        next.focus({ preventScroll: true });
        if (focusStart !== null && next instanceof HTMLInputElement) {
          next.setSelectionRange(focusStart, focusStart);
        } else if (focusStart !== null && next instanceof HTMLTextAreaElement) {
          next.setSelectionRange(focusStart, focusStart);
        }
      }
    }
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
      showToast(t('qb.movedToTrash'), 'success');
      await this.reloadAfterMutation();
    } catch (error) {
      showToast(t('error.deleteFailed', { error: String(error) }), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk operations (Task 5)
  // ---------------------------------------------------------------------------

  private requireSelection(): string[] {
    const ids = [...this.selectedIds];
    if (ids.length === 0) showToast(t('qb.bulkNothingSelected'), 'warning');
    return ids;
  }

  private setBulkBusy(busy: boolean): void {
    this.bulkOperationInProgress = busy;
    this.syncSelectionUI();
  }

  /** Let the browser paint the progress bar between chunks of work. */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  private progressLabel(done: number, total: number): string {
    return t('qb.bulkApplying', { done, total });
  }

  /** Apply a tag/flag patch to every selected question with live progress. */
  private async applyBulkUpdateToSelection(update: BulkUpdate): Promise<void> {
    const ids = this.requireSelection();
    if (ids.length === 0) return;
    this.setBulkBusy(true);
    const progress = showProgressToast(this.progressLabel(0, ids.length), ids.length);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      for (const id of ids) {
        try {
          const question = await questionsRepo.getById(id);
          if (question && !question.deletedAt) {
            await questionsRepo.put(applyBulkUpdate(question, update));
            succeeded++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
        processed++;
        progress.update(processed, ids.length, this.progressLabel(processed, ids.length));
        if (processed % 20 === 0) await this.yieldToUI();
      }

      if (failed === 0) {
        progress.finish(t('qb.bulkCompleted', { count: succeeded }), 'success');
      } else if (succeeded > 0) {
        progress.finish(t('qb.bulkPartial', { done: succeeded, failed }), 'warning');
      } else {
        progress.finish(t('qb.bulkFailed', { failed }), 'error');
      }
    } finally {
      try {
        await this.reloadAfterMutation();
      } finally {
        this.setBulkBusy(false);
      }
    }
  }

  private async bulkTag(): Promise<void> {
    await this.promptBulkTags('add');
  }

  private async bulkRetag(): Promise<void> {
    await this.promptBulkTags('replace');
  }

  private async promptBulkTags(mode: BulkTagMode): Promise<void> {
    const ids = this.requireSelection();
    if (ids.length === 0) return;
    const selected = await questionsRepo.getByIds(ids);
    // Retag starts from the union of current tags so users can prune them;
    // plain tag starts empty so it reads as an additive operation.
    const existing = mode === 'replace'
      ? [...new Set(selected.flatMap(q => q.tags ?? []))]
      : [];
    const raw = await this.openBulkTagModal(mode, ids.length, existing.join(', '));
    if (raw === null) return;
    const tags = parseTags(raw);
    if (tags.length === 0) {
      showToast(t('qb.bulkTagsRequired'), 'warning');
      return;
    }
    await this.applyBulkUpdateToSelection({ kind: 'tags', mode, tags });
  }

  private openBulkTagModal(mode: BulkTagMode, count: number, initial: string): Promise<string | null> {
    return new Promise(resolve => {
      const isReplace = mode === 'replace';
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHTML(t(isReplace ? 'qb.bulkRetag' : 'qb.tag'))}</h2>
            <button type="button" class="modal-close" id="bulkTagClose" aria-label="${escapeHTML(t('common.close'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <p style="margin-top:0;">${escapeHTML(t(isReplace ? 'qb.bulkRetagPrompt' : 'qb.bulkTagPrompt', { count }))}</p>
            <label class="form-label" for="bulkTagsInput">${escapeHTML(t('qb.tags'))}</label>
            <textarea id="bulkTagsInput" class="form-textarea" rows="3" placeholder="${escapeHTML(t('qb.tagsHelp'))}">${escapeHTML(initial)}</textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="bulkTagCancel">${escapeHTML(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary" id="bulkTagApply">${escapeHTML(t('common.save'))}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      openModal(overlay);
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        closeModal(overlay);
        resolve(value);
      };
      overlay.querySelector('#bulkTagApply')?.addEventListener('click', () => {
        finish(overlay.querySelector<HTMLTextAreaElement>('#bulkTagsInput')?.value ?? '');
      });
      overlay.querySelector('#bulkTagCancel')?.addEventListener('click', () => finish(null));
      overlay.querySelector('#bulkTagClose')?.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });
      overlay.addEventListener('keydown', event => {
        if ((event as KeyboardEvent).key === 'Escape') finish(null);
      });
    });
  }

  private async bulkFlag(): Promise<void> {
    await this.applyBulkUpdateToSelection({
      kind: 'flags',
      patch: { bookmarked: true },
    });
  }

  private async bulkUnflag(): Promise<void> {
    // Only the bookmark flag is cleared; needsReview/disputed are separate
    // dimensions with their own bulk actions and must not be wiped here.
    await this.applyBulkUpdateToSelection({
      kind: 'flags',
      patch: { bookmarked: false },
    });
  }

  private async bulkReview(): Promise<void> {
    await this.applyBulkUpdateToSelection({
      kind: 'flags',
      patch: { needsReview: true },
    });
  }

  private async bulkExport(): Promise<void> {
    const ids = this.requireSelection();
    if (ids.length === 0) return;
    const format = await this.openBulkExportModal(ids.length);
    if (!format) return;

    this.setBulkBusy(true);
    const progress = showProgressToast(this.progressLabel(0, ids.length), ids.length);
    const questions: Question[] = [];
    const BATCH_SIZE = 100;
    try {
      for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
        const batch = await questionsRepo.getByIds(ids.slice(offset, offset + BATCH_SIZE));
        questions.push(...batch);
        const done = Math.min(offset + BATCH_SIZE, ids.length);
        progress.update(done, ids.length, this.progressLabel(done, ids.length));
        await this.yieldToUI();
      }
      const date = new Date().toISOString().split('T')[0];
      if (format === 'json') {
        downloadJSON(questions, `cpns-selected-questions-${date}.json`);
      } else {
        this.downloadText(
          questionsToCSV(questions),
          'text/csv;charset=utf-8',
          `cpns-selected-questions-${date}.csv`
        );
      }
      progress.finish(t('qb.bulkExported', { count: questions.length }), 'success');
    } catch (error) {
      progress.finish(t('error.exportFailed', { error: String(error) }), 'error');
    } finally {
      this.setBulkBusy(false);
    }
  }

  private openBulkExportModal(count: number): Promise<'json' | 'csv' | null> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:440px;">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHTML(t('qb.bulkExport'))}</h2>
            <button type="button" class="modal-close" id="bulkExportClose" aria-label="${escapeHTML(t('common.close'))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <p style="margin-top:0;">${escapeHTML(t('qb.bulkExportPrompt', { count }))}</p>
            <label class="form-check">
              <input type="radio" class="form-check-input" name="bulkExportFormat" value="json" checked>
              <span class="form-check-label">${escapeHTML(t('export.json'))}</span>
            </label>
            <label class="form-check">
              <input type="radio" class="form-check-input" name="bulkExportFormat" value="csv">
              <span class="form-check-label">${escapeHTML(t('export.csv'))}</span>
            </label>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="bulkExportCancel">${escapeHTML(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary" id="bulkExportApply">${escapeHTML(t('common.export'))}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      openModal(overlay);
      let settled = false;
      const finish = (value: 'json' | 'csv' | null): void => {
        if (settled) return;
        settled = true;
        closeModal(overlay);
        resolve(value);
      };
      overlay.querySelector('#bulkExportApply')?.addEventListener('click', () => {
        const selected = overlay.querySelector<HTMLInputElement>('input[name="bulkExportFormat"]:checked');
        finish(selected?.value === 'csv' ? 'csv' : 'json');
      });
      overlay.querySelector('#bulkExportCancel')?.addEventListener('click', () => finish(null));
      overlay.querySelector('#bulkExportClose')?.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });
      overlay.addEventListener('keydown', event => {
        if ((event as KeyboardEvent).key === 'Escape') finish(null);
      });
    });
  }

  private downloadText(content: string, mimeType: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async bulkDelete(): Promise<void> {
    const ids = this.requireSelection();
    if (ids.length === 0) return;
    if (!(await this.confirmAction(t('qb.bulkDeleteConfirm', { count: ids.length })))) return;

    this.setBulkBusy(true);
    const progress = showProgressToast(this.progressLabel(0, ids.length), ids.length);
    let deleted = 0;
    try {
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batch = ids.slice(offset, offset + 50);
        deleted += await questionsRepo.bulkDelete(batch, true);
        const done = Math.min(offset + 50, ids.length);
        progress.update(done, ids.length, this.progressLabel(done, ids.length));
        await this.yieldToUI();
      }
      progress.finish(t('qb.bulkCompleted', { count: deleted }), 'success');
    } catch (error) {
      progress.finish(t('error.deleteFailed', { error: String(error) }), 'error');
    } finally {
      this.selectedIds.clear();
      try {
        await this.reloadAfterMutation();
      } finally {
        this.setBulkBusy(false);
      }
    }
  }

  /** Re-read the source data, invalidate the memoized selector, re-render. */
  private async reloadAfterMutation(): Promise<void> {
    await this.loadQuestions();
    if (this.element) this.refreshView();
  }
}

import { debounce } from '../core/utils';
// Practice Mode View — untimed practice with instant per-question feedback.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { attemptsRepo } from '../db/repositories/attempts';
import { loadKisiKisi, getTopicsByCategory } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, formatDuration } from '../core/utils';
import type {
  Question,
  Session,
  Attempt,
  SessionConfig,
  SessionSummary,
  Difficulty,
  TopicCode,
} from '../shared/types';

/** Delay before moving to the next question after an answer is recorded. */
const AUTO_ADVANCE_DELAY_MS = 900;
const DIFFICULTIES: Difficulty[] = [1, 2, 3];
const DEFAULT_DIFFICULTY_MIX: Record<Difficulty, number> = { 1: 30, 2: 50, 3: 20 };

interface PracticeAnswer {
  userAnswer: number[];
  isCorrect: boolean;
  timeMs: number;
  flagged: boolean;
  markedReview: boolean;
}

interface QuestionMarks {
  flagged: boolean;
  markedReview: boolean;
}

interface PracticeConfig {
  topicCodes: string[];
  questionCount: number | 'all';
  difficultyMix: Record<Difficulty, number>;
  prioritizeWeak: boolean;
  includeFlagged: boolean;
  includeNeedsReview: boolean;
  randomOrder: boolean;
  showExplanationImmediately: boolean;
}

interface PracticeSession {
  id: string;
  config: PracticeConfig;
  questions: Question[];
  currentIndex: number;
  answers: Map<string, PracticeAnswer>;
  startTime: number;
  status: 'active' | 'paused' | 'review' | 'completed';
}

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

function masteryOf(question: Question): number {
  return Number(question.statistics?.masteryLevel ?? 0);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

/** Sanitise Markdown rendered from user/imported question text. */
function sanitizeHTML(html: string): string {
  const purifier = DOMPurify as unknown as { sanitize?: (value: string) => string };
  if (typeof purifier.sanitize === 'function') return purifier.sanitize(html);
  // Node (non-browser) builds expose a factory instead of an instance; the
  // practice view only renders in the browser, so this is a safe fallback.
  const factory = DOMPurify as unknown as (win: Window) => { sanitize: (value: string) => string };
  if (typeof factory === 'function' && typeof window !== 'undefined') {
    return factory(window).sanitize(html);
  }
  return escapeHTML(html.replace(/<[^>]*>/g, ''));
}

export class PracticeView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private session: PracticeSession | null = null;
  private allQuestions: Question[] = [];
  private questionStartTime = 0;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private advanceTimeout: ReturnType<typeof setTimeout> | null = null;
  private marks = new Map<string, QuestionMarks>();
  private initialConfig: Partial<PracticeConfig> = {};
  private shouldAutoStart = false;
  private routeHandler: ((route: { view: string }) => void) | null = null;

  constructor(params: Record<string, string>) {
    this.params = params;
    const parsed = this.parseParams(params);
    this.initialConfig = parsed.config;
    this.shouldAutoStart = parsed.autoStart;

    // The app does not call destroy() on navigation, so clean up listeners
    // when the router moves away from practice (otherwise stale key handlers
    // keep acting on an old session).
    this.routeHandler = route => {
      if (route.view !== 'practice') this.destroy();
    };
    eventBus.on('route:changed', this.routeHandler);
  }

  /** Route params can preselect the pool: #/practice?topic=UM-01&count=10. */
  private parseParams(params: Record<string, string>): {
    config: Partial<PracticeConfig>;
    autoStart: boolean;
  } {
    const config: Partial<PracticeConfig> = {};
    const rawTopics = params.topic ?? params.topics ?? params.topicCodes ?? '';
    if (rawTopics) {
      config.topicCodes = rawTopics.split(',').map(code => code.trim()).filter(Boolean);
    }

    const rawCount = params.count ?? params.questionCount;
    if (rawCount === 'all') config.questionCount = 'all';
    else if (rawCount && Number.isFinite(Number(rawCount)) && Number(rawCount) > 0) {
      config.questionCount = Math.floor(Number(rawCount));
    }

    const rawDifficulty = params.difficulty ?? params.difficulties;
    if (rawDifficulty) {
      const difficulties = rawDifficulty.split(',')
        .map(value => Number(value.trim()))
        .filter((value): value is Difficulty => DIFFICULTIES.includes(value as Difficulty));
      if (difficulties.length > 0) {
        const share = Math.round(100 / difficulties.length);
        config.difficultyMix = {
          1: difficulties.includes(1) ? share : 0,
          2: difficulties.includes(2) ? share : 0,
          3: difficulties.includes(3) ? share : 0,
        };
      }
    } else if (params.mix) {
      // Explicit mix: "1:30,2:50,3:20".
      const mix: Partial<Record<Difficulty, number>> = {};
      params.mix.split(',').forEach(part => {
        const [rawDifficulty, rawPercent] = part.split(':');
        const difficulty = Number(rawDifficulty);
        const percent = Number(rawPercent);
        if (DIFFICULTIES.includes(difficulty as Difficulty) && Number.isFinite(percent) && percent >= 0) {
          mix[difficulty as Difficulty] = percent;
        }
      });
      if (Object.keys(mix).length > 0) config.difficultyMix = mix as Record<Difficulty, number>;
    }

    const boolKeys: Array<[keyof PracticeConfig, string | undefined]> = [
      ['prioritizeWeak', params.prioritizeWeak],
      ['includeFlagged', params.includeFlagged],
      ['includeNeedsReview', params.includeNeedsReview],
      ['randomOrder', params.randomOrder ?? params.random],
      ['showExplanationImmediately', params.explain ?? params.showExplanation],
    ];
    boolKeys.forEach(([key, value]) => {
      const parsedValue = parseBoolean(value);
      if (parsedValue !== undefined) (config as Record<string, unknown>)[key] = parsedValue;
    });

    const autoStart =
      params.weak === 'true' ||
      Boolean(config.topicCodes?.length) ||
      config.questionCount !== undefined ||
      config.difficultyMix !== undefined;
    return { config, autoStart };
  }

  async loadQuestions(): Promise<void> {
    // Topic labels in the config form come from the kisi-kisi registry.
    await loadKisiKisi();
    this.allQuestions = await questionsRepo.getAll();
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'practice-view';
    this.element.innerHTML = this.getSkeletonHTML();
    document.addEventListener('keydown', this.handleKeys);

    void this.loadQuestions().then(() => {
      if (!this.element) return;
      if (this.shouldAutoStart) {
        if (this.params.weak === 'true') {
          void this.startWeakAreasPractice();
        } else {
          this.startSession(this.getDefaultConfig());
        }
        return;
      }
      this.element.innerHTML = this.getConfigHTML();
      this.bindConfigEvents();
    }).catch(error => {
      console.error('PracticeView failed to load questions:', error);
      if (this.element) {
        this.element.innerHTML = `
          <div class="page-header"><h1 class="page-title">${t('practice.title')}</h1></div>
          <div class="card" role="alert"><div class="card-content">${escapeHTML(t('qb.noQuestions'))}</div></div>
        `;
      }
    });

    return this.element;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getDefaultConfig(): PracticeConfig {
    const mix = this.initialConfig.difficultyMix;
    return {
      topicCodes: this.initialConfig.topicCodes ? [...this.initialConfig.topicCodes] : [],
      questionCount: this.initialConfig.questionCount ?? 20,
      difficultyMix: mix ? { ...DEFAULT_DIFFICULTY_MIX, ...mix } : { ...DEFAULT_DIFFICULTY_MIX },
      prioritizeWeak: this.initialConfig.prioritizeWeak ?? true,
      includeFlagged: this.initialConfig.includeFlagged ?? false,
      includeNeedsReview: this.initialConfig.includeNeedsReview ?? false,
      randomOrder: this.initialConfig.randomOrder ?? true,
      showExplanationImmediately: this.initialConfig.showExplanationImmediately ?? true,
    };
  }

  private getConfigHTML(): string {
    const config = this.getDefaultConfig();
    const selectedTopics = new Set(config.topicCodes);
    const registered = [...getTopicsByCategory('umum'), ...getTopicsByCategory('khusus')];
    const knownCodes = new Set(registered.map(topic => topic.code));
    const legacyCodes = [...new Set(this.allQuestions.map(q => String(q.topicCode)))]
      .filter(code => !knownCodes.has(code));
    const topicButton = (code: string): string => `
      <button type="button" class="btn ${selectedTopics.has(code) ? 'btn-primary' : 'btn-ghost'}"
        data-topic="${escapeHTML(code)}" aria-pressed="${selectedTopics.has(code) ? 'true' : 'false'}"
        style="min-width:100px;">${escapeHTML(code)}</button>`;

    const countOptions = [10, 20, 30, 50, 100];
    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.title')}</h1>
        <p class="page-subtitle">${t('practice.config')}</p>
      </div>

      <div class="card" style="max-width:600px;">
        <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);">
          <fieldset>
            <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Filter Soal</legend>

            <div class="form-group">
              <label class="form-label">${t('practice.topicFilter')}</label>
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
                <button type="button" class="btn ${selectedTopics.size === 0 ? 'btn-primary' : 'btn-secondary'}"
                  data-topic="all" aria-pressed="${selectedTopics.size === 0 ? 'true' : 'false'}"
                  style="min-width:100px;">${t('filter.all')}</button>
                ${registered.map(topic => topicButton(topic.code)).join('')}
                ${legacyCodes.map(code => topicButton(code)).join('')}
              </div>
              <input type="hidden" id="selectedTopics" value="${escapeHTML(config.topicCodes.join(','))}">
              <p class="form-help">Klik untuk memilih/membatalkan topik. Kosong = semua topik.</p>
            </div>

            <div class="form-group">
              <label class="form-label" for="questionCount">${t('practice.questionCount')}</label>
              <select id="questionCount" class="form-select">
                ${countOptions.map(count => `
                  <option value="${count}" ${config.questionCount === count ? 'selected' : ''}>${count}</option>
                `).join('')}
                <option value="all" ${config.questionCount === 'all' ? 'selected' : ''}>${t('practice.allQuestions')}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">${t('practice.difficultyMix')}</label>
              <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
                ${DIFFICULTIES.map(difficulty => `
                  <div style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="min-width:60px;">${t('difficulty.' + difficulty)}</span>
                    <input type="number" step="5" min="0" max="100" value="${config.difficultyMix[difficulty]}"
                      data-difficulty="${difficulty}" aria-label="${t('practice.difficultyMix')} — ${t('difficulty.' + difficulty)}"
                      class="form-input" style="width:80px;">
                    <span>%</span>
                  </div>
                `).join('')}
              </div>
              <p class="form-help" id="difficultyMixWarning" role="alert" hidden>Total harus 100%</p>
            </div>

            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="prioritizeWeak" ${config.prioritizeWeak ? 'checked' : ''}>
              <span class="form-check-label">${t('practice.prioritizeWeak')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="includeFlagged" ${config.includeFlagged ? 'checked' : ''}>
              <span class="form-check-label">${t('practice.includeFlagged')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="includeNeedsReview" ${config.includeNeedsReview ? 'checked' : ''}>
              <span class="form-check-label">${t('practice.includeNeedsReview')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="randomOrder" ${config.randomOrder ? 'checked' : ''}>
              <span class="form-check-label">${t('practice.randomOrder')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="showExplanation" ${config.showExplanationImmediately ? 'checked' : ''}>
              <span class="form-check-label">${t('practice.showExplanation')}</span>
            </label>
          </fieldset>

          <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button class="btn btn-secondary" id="btnCancelConfig">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="btnStartPractice">${t('practice.start')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private getCurrentQuestion(): Question | undefined {
    return this.session?.questions[this.session.currentIndex];
  }

  /** Answer state plus flags set before the question was answered. */
  private getAnswer(questionId: string): PracticeAnswer | undefined {
    const stored = this.session?.answers.get(questionId);
    const marks = this.marks.get(questionId);
    if (!stored && !marks) return undefined;
    return {
      userAnswer: stored?.userAnswer ?? [],
      isCorrect: stored?.isCorrect ?? false,
      timeMs: stored?.timeMs ?? 0,
      flagged: marks?.flagged ?? stored?.flagged ?? false,
      markedReview: marks?.markedReview ?? stored?.markedReview ?? false,
    };
  }

  private getSessionHTML(): string {
    const session = this.session;
    const q = this.getCurrentQuestion();
    if (!session || !q) return '';
    const answer = this.getAnswer(q.id);
    const isAnswered = session.answers.has(q.id);
    const progress = ((session.currentIndex + 1) / session.questions.length) * 100;
    const showResult = isAnswered && !!answer;

    return `
      <div class="page-header" style="position:sticky;top:0;z-index:var(--z-sticky);background:var(--color-bg);padding-bottom:var(--space-4);margin-bottom:var(--space-4);border-bottom:1px solid var(--color-border);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-4);">
          <div>
            <h1 class="page-title" style="font-size:var(--text-lg);">${t('practice.title')}</h1>
            <div class="practice-question-meta" style="display:flex;align-items:center;gap:var(--space-4);margin-top:var(--space-2);font-size:var(--text-sm);color:var(--color-text-muted);">
              <span data-question-counter>${t('practice.current', { current: session.currentIndex + 1, total: session.questions.length })}</span>
              <span class="badge badge-topic">${escapeHTML(q.topicCode)}</span>
              <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <div class="practice-progress" role="progressbar" aria-label="${t('practice.title')}"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"
              style="width:200px;height:6px;background:var(--color-border);border-radius:var(--radius-full);overflow:hidden;">
              <div style="width:${progress}%;height:100%;background:var(--color-primary);transition:width var(--transition-fast);"></div>
            </div>
            <span style="font-weight:var(--font-semibold);min-width:40px;text-align:right;">${Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-content">
          <div class="practice-stem" style="margin-bottom:var(--space-6);font-size:var(--text-lg);line-height:var(--leading-relaxed);font-weight:var(--font-medium);">
            ${this.renderMarkdown(q.stem)}
          </div>

          <div class="practice-options" style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-6);">
            ${(q.options ?? []).map((opt, index) => {
              const isSelected = !!answer?.userAnswer.includes(index);
              const isCorrect = (q.correctAnswer ?? []).includes(index);
              let optionClass = 'practice-option';
              if (showResult) {
                if (isCorrect) optionClass += ' correct';
                else if (isSelected) optionClass += ' incorrect';
              }
              if (isSelected) optionClass += ' selected';
              return `
                <button type="button" class="${optionClass}" data-option="${index}"
                  aria-pressed="${isSelected ? 'true' : 'false'}" ${isAnswered ? 'disabled' : ''}
                  style="display:flex;align-items:flex-start;gap:var(--space-3);min-height:44px;padding:var(--space-4);border:2px solid var(--color-border-strong);border-radius:var(--radius-lg);background:var(--color-bg-elevated);text-align:left;cursor:${isAnswered ? 'not-allowed' : 'pointer'};transition:all var(--transition-fast);
                  ${showResult && isCorrect ? 'border-color:var(--color-success);background:var(--color-success-light);' : ''}
                  ${showResult && isSelected && !isCorrect ? 'border-color:var(--color-danger);background:var(--color-danger-light);' : ''}
                  ${isSelected && !showResult ? 'border-color:var(--color-primary);background:var(--color-primary-light);' : ''}">
                  <span style="width:28px;height:28px;border:2px solid var(--color-border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);flex-shrink:0;${isSelected ? 'background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary);' : ''}">${String.fromCharCode(65 + index)}</span>
                  <div style="flex:1;font-size:var(--text-base);line-height:var(--leading-relaxed);">${this.renderMarkdown(opt.text)}</div>
                  ${showResult && isCorrect ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
                  ${showResult && isSelected && !isCorrect ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : ''}
                </button>
              `;
            }).join('')}
          </div>

          ${showResult ? `
            <div class="practice-feedback" role="status" aria-live="polite" style="font-weight:var(--font-semibold);margin-bottom:var(--space-3);color:${answer?.isCorrect ? 'var(--color-success)' : 'var(--color-danger)'};">
              ${answer?.isCorrect ? t('practice.correct') : t('practice.incorrect')}
            </div>
          ` : ''}

          ${showResult && q.explanation ? `
            <div class="card" style="background:var(--color-info-light);border-color:var(--color-info);margin-bottom:var(--space-6);">
              <div class="card-content">
                <div style="display:flex;align-items:flex-start;gap:var(--space-3);">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  <div style="flex:1;">
                    <div style="font-weight:var(--font-semibold);margin-bottom:var(--space-1);">${t('practice.explanation')}</div>
                    <div style="font-size:var(--text-sm);line-height:var(--leading-relaxed);">${this.renderMarkdown(q.explanation)}</div>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-ghost" id="btnFlag" data-flagged="${answer?.flagged ? 'true' : 'false'}" aria-pressed="${answer?.flagged ? 'true' : 'false'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${answer?.flagged ? 'stroke:var(--color-warning);fill:var(--color-warning);' : ''}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                ${t('practice.flag')}
              </button>
              <button class="btn btn-ghost" id="btnMarkReview" data-marked="${answer?.markedReview ? 'true' : 'false'}" aria-pressed="${answer?.markedReview ? 'true' : 'false'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${answer?.markedReview ? 'stroke:var(--color-info);fill:var(--color-info);' : ''}"><path d="M19 21l-7-7-7 7-7-7-7 7"/><path d="M2 19l7-7 7 7"/></svg>
                ${t('practice.markReview')}
              </button>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-secondary" id="btnPrev" ${session.currentIndex === 0 ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                ${t('common.previous')}
              </button>
              <button class="btn btn-primary" id="btnNext" ${session.currentIndex === session.questions.length - 1 ? 'disabled' : ''}>
                ${t('common.next')}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button class="btn btn-primary" id="btnFinish" style="display:${session.currentIndex === session.questions.length - 1 ? 'inline-flex' : 'none'};">
                ${t('practice.finish')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-4);">
        <div class="card-content" style="padding:var(--space-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
            <span style="font-weight:var(--font-medium);">Navigator</span>
            <span class="form-help" style="margin:0;">${t('practice.jump')}</span>
          </div>
          <div class="practice-navigator" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:4px;">
            ${session.questions.map((question, index) => {
              const ans = this.getAnswer(question.id);
              let cls = 'nav-btn';
              if (index === session.currentIndex) cls += ' current';
              else if (ans?.flagged) cls += ' flagged';
              else if (ans?.markedReview) cls += ' marked';
              else if (session.answers.has(question.id)) cls += ' answered';
              const status = index === session.currentIndex ? ', sedang dikerjakan' : ans?.flagged ? ', ditandai' : ans?.markedReview ? ', perlu ditinjau' : ans?.userAnswer.length ? ', sudah dijawab' : ', belum dijawab';
              return `<button type="button" class="${cls}" data-index="${index}" aria-label="Soal ${index + 1}${status}" aria-current="${index === session.currentIndex ? 'true' : 'false'}" style="width:44px;height:44px;min-width:44px;min-height:44px;border:1px solid var(--color-border-strong);border-radius:var(--radius-md);font-size:var(--text-xs);font-weight:var(--font-medium);${index === session.currentIndex ? 'background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary);' : ans?.flagged ? 'border-color:var(--color-warning);color:var(--color-warning);' : ans?.markedReview ? 'border-color:var(--color-info);color:var(--color-info);' : ans?.userAnswer.length ? 'background:var(--color-success);color:var(--color-on-success);border-color:var(--color-success);' : 'background:var(--color-bg);color:var(--color-text-muted);'}">${index + 1}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private getReviewHTML(): string {
    const session = this.session;
    if (!session || session.questions.length === 0) return '';
    const correctCount = Array.from(session.answers.values()).filter(answer => answer.isCorrect).length;
    const scorePercent = Math.round((correctCount / session.questions.length) * 100);

    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.sessionSummary')}</h1>
        <p class="page-subtitle">${t('practice.score', { correct: correctCount, total: session.questions.length, percent: scorePercent })}</p>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-content" style="text-align:center;padding:var(--space-8);">
          <div style="font-size:var(--text-4xl);font-weight:var(--font-bold);color:var(--color-primary);">${scorePercent}%</div>
          <div style="margin-top:var(--space-4);display:flex;justify-content:center;gap:var(--space-6);color:var(--color-text-muted);">
            <div>Benar: <strong style="color:var(--color-success);">${correctCount}</strong></div>
            <div>Salah: <strong style="color:var(--color-danger);">${session.questions.length - correctCount}</strong></div>
            <div>Waktu: <strong>${this.formatDuration(Date.now() - session.startTime)}</strong></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">${t('practice.reviewErrors')}</h2>
        </div>
        <div class="card-content">
          ${session.questions.map((question, index) => {
            const answer = session.answers.get(question.id);
            if (!answer || answer.isCorrect) return '';
            return `
              <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-4);">
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
                  <span class="badge badge-difficulty-${question.difficulty}">${t('difficulty.' + question.difficulty)}</span>
                  <span class="badge">${escapeHTML(question.topicCode)}</span>
                  <span style="font-weight:var(--font-medium);">Soal ${index + 1}</span>
                </div>
                <div style="font-weight:var(--font-medium);margin-bottom:var(--space-3);">${this.renderMarkdown(question.stem)}</div>
                <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-3);">
                  ${(question.options ?? []).map((opt, optionIndex) => `
                    <div style="padding:var(--space-2);border-radius:var(--radius-md);${(question.correctAnswer ?? []).includes(optionIndex) ? 'background:var(--color-success-light);border:1px solid var(--color-success);' : answer.userAnswer.includes(optionIndex) ? 'background:var(--color-danger-light);border:1px solid var(--color-danger);' : ''}">
                      <span style="font-weight:var(--font-bold);width:24px;display:inline-block;">${String.fromCharCode(65 + optionIndex)}</span>
                      ${this.renderMarkdown(opt.text)}
                      ${(question.correctAnswer ?? []).includes(optionIndex) ? ' <span class="badge badge-success">Benar</span>' : ''}
                      ${answer.userAnswer.includes(optionIndex) && !(question.correctAnswer ?? []).includes(optionIndex) ? ' <span class="badge badge-danger">Jawaban Anda</span>' : ''}
                    </div>
                  `).join('')}
                </div>
                ${question.explanation ? `
                  <div style="padding:var(--space-3);background:var(--color-info-light);border-radius:var(--radius-md);border:1px solid var(--color-info);">
                    <strong>${t('practice.explanation')}</strong>
                    <div style="margin-top:var(--space-1);">${this.renderMarkdown(question.explanation)}</div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-6);">
        <a href="#/practice" class="btn btn-primary">${t('practice.title')} Lagi</a>
        <a href="#/dashboard" class="btn btn-secondary">${t('nav.dashboard')}</a>
      </div>
    `;
  }

  private renderMarkdown(text: string): string {
    try {
      return sanitizeHTML(String(marked.parse(String(text ?? ''), { async: false, breaks: true })));
    } catch {
      return escapeHTML(text);
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}j ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}d`;
    return `${seconds}d`;
  }

  /**
   * Select `questionCount` questions from the configured topic pool. Each
   * difficulty bucket receives its proportional share; shortfalls are
   * redistributed to buckets with spare capacity so the requested count is
   * met whenever the pool is large enough.
   */
  private selectQuestions(config: PracticeConfig): Question[] {
    let pool = this.allQuestions.filter(question =>
      !question.deletedAt &&
      Array.isArray(question.options) && question.options.length > 0 &&
      Array.isArray(question.correctAnswer) && question.correctAnswer.length > 0
    );

    if (config.topicCodes.length > 0) {
      const topics = new Set(config.topicCodes.map(String));
      pool = pool.filter(question => topics.has(String(question.topicCode)));
    }
    if (!config.includeFlagged) pool = pool.filter(question => !question.flags?.bookmarked);
    if (!config.includeNeedsReview) pool = pool.filter(question => !question.flags?.needsReview);

    const buckets = new Map<Difficulty, Question[]>(DIFFICULTIES.map(difficulty => [difficulty, []]));
    pool.forEach(question => {
      const difficulty = DIFFICULTIES.includes(question.difficulty) ? question.difficulty : 2;
      buckets.get(difficulty)!.push(question);
    });

    if (config.prioritizeWeak) {
      // Weak questions win *selection*; randomOrder (when set) only shuffles
      // presentation, so prioritisation is not discarded by the shuffle.
      buckets.forEach(questions => questions.sort((a, b) => masteryOf(a) - masteryOf(b)));
    }

    const target = config.questionCount === 'all'
      ? pool.length
      : Math.max(0, Math.min(Math.floor(config.questionCount), pool.length));
    const selected = this.allocateByDifficultyMix(buckets, config.difficultyMix, target);

    if (config.prioritizeWeak && !config.randomOrder) {
      selected.sort((a, b) => masteryOf(a) - masteryOf(b));
    }
    return config.randomOrder ? this.shuffle(selected) : selected;
  }

  private allocateByDifficultyMix(
    buckets: Map<Difficulty, Question[]>,
    mix: Record<Difficulty, number>,
    target: number
  ): Question[] {
    if (target <= 0) return [];
    const weights = DIFFICULTIES.map(difficulty => Math.max(0, Number(mix?.[difficulty] ?? 0)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const ideal = weights.map(weight =>
      totalWeight > 0 ? (target * weight) / totalWeight : target / DIFFICULTIES.length
    );
    const counts = ideal.map((share, index) =>
      Math.min(Math.floor(share), buckets.get(DIFFICULTIES[index]!)!.length)
    );

    let remaining = target - counts.reduce((sum, count) => sum + count, 0);
    while (remaining > 0) {
      let bestIndex = -1;
      let bestRemainder = Number.NEGATIVE_INFINITY;
      DIFFICULTIES.forEach((difficulty, index) => {
        const capacity = buckets.get(difficulty)!.length;
        if (counts[index]! >= capacity) return;
        const remainder = ideal[index]! - counts[index]!;
        if (remainder > bestRemainder) {
          bestRemainder = remainder;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) break;
      counts[bestIndex]!++;
      remaining--;
    }

    const selected: Question[] = [];
    DIFFICULTIES.forEach((difficulty, index) => {
      selected.push(...buckets.get(difficulty)!.slice(0, counts[index]!));
    });
    return selected;
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      const current = shuffled[index]!;
      shuffled[index] = shuffled[other]!;
      shuffled[other] = current;
    }
    return shuffled;
  }

  private async getWeakTopics(limit = 5): Promise<string[]> {
    const stats = await questionsRepo.getStatsByTopic();
    return Object.entries(stats)
      .filter(([, value]) => value.total > 0)
      .sort(([, a], [, b]) => a.avgMastery - b.avgMastery)
      .slice(0, limit)
      .map(([topicCode]) => topicCode);
  }

  private async startWeakAreasPractice(): Promise<void> {
    if (!this.element) return;
    const weakTopics = await this.getWeakTopics();
    const config = this.getDefaultConfig();
    this.startSession({
      ...config,
      topicCodes: config.topicCodes.length > 0 ? config.topicCodes : weakTopics,
      questionCount: config.questionCount === 20 ? 20 : config.questionCount,
      prioritizeWeak: true,
      randomOrder: true,
      showExplanationImmediately: true,
    });
  }

  private startSession(config: PracticeConfig): void {
    const questions = this.selectQuestions(config);
    if (questions.length === 0) {
      this.element!.innerHTML = `
        <div class="page-header"><h1 class="page-title">${t('practice.title')}</h1></div>
        <div class="card" role="alert"><div class="card-content">Tidak ada soal yang sesuai filter. Ubah filter atau tambah soal.</div></div>
      `;
      return;
    }

    this.clearAutoAdvance();
    this.marks.clear();
    this.session = {
      id: generateId(),
      config,
      questions,
      currentIndex: 0,
      answers: new Map(),
      startTime: Date.now(),
      status: 'active',
    };

    this.questionStartTime = Date.now();
    this.renderSession();
    this.startAutoSave();
  }

  private renderSession(): void {
    if (!this.element || !this.session) return;
    this.element.innerHTML = this.session.status === 'review' || this.session.status === 'completed'
      ? this.getReviewHTML()
      : this.getSessionHTML();
    this.bindSessionEvents();
  }

  private bindConfigEvents(): void {
    if (!this.element) return;

    this.element.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.topic === 'all') {
          this.element!.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach(other => {
            const isAll = other.dataset.topic === 'all';
            other.classList.toggle('btn-primary', isAll);
            other.classList.toggle('btn-secondary', isAll);
            other.classList.remove('btn-ghost');
            other.setAttribute('aria-pressed', isAll ? 'true' : 'false');
          });
        } else {
          const selected = button.classList.toggle('btn-primary');
          button.classList.toggle('btn-ghost', !selected);
          button.setAttribute('aria-pressed', selected ? 'true' : 'false');
          const allButton = this.element!.querySelector<HTMLButtonElement>('[data-topic="all"]');
          if (allButton) {
            const anySelected = this.element!.querySelectorAll('[data-topic].btn-primary').length > 0;
            allButton.classList.toggle('btn-primary', !anySelected);
            allButton.classList.toggle('btn-secondary', anySelected);
            allButton.setAttribute('aria-pressed', (!anySelected).toString());
          }
        }
        this.updateSelectedTopics();
      });
    });

    this.element.querySelectorAll<HTMLInputElement>('[data-difficulty]').forEach(input => {
      input.addEventListener('change', () => this.validateDifficultyMix());
    });

    this.element.querySelector('#btnStartPractice')?.addEventListener('click', () => {
      const config = this.getConfigFromForm();
      this.startSession(config);
    });
    this.element.querySelector('#btnCancelConfig')?.addEventListener('click', () => navigate('dashboard'));
  }

  private updateSelectedTopics(): void {
    const selected = Array.from(this.element?.querySelectorAll('[data-topic].btn-primary') ?? [])
      .map(button => (button as HTMLElement).dataset.topic)
      .filter((topic): topic is string => Boolean(topic) && topic !== 'all');
    const input = this.element?.querySelector<HTMLInputElement>('#selectedTopics');
    if (input) input.value = selected.join(',');
  }

  private validateDifficultyMix(): boolean {
    const inputs = this.element?.querySelectorAll<HTMLInputElement>('[data-difficulty]') ?? [];
    const total = Array.from(inputs).reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const warning = this.element?.querySelector<HTMLElement>('#difficultyMixWarning');
    if (warning) warning.hidden = total === 100;
    return total === 100;
  }

  private getConfigFromForm(): PracticeConfig {
    const topicsInput = this.element?.querySelector<HTMLInputElement>('#selectedTopics');
    const topicCodes = topicsInput?.value ? topicsInput.value.split(',').filter(Boolean) : [];

    const rawMix: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0 };
    this.element?.querySelectorAll<HTMLInputElement>('[data-difficulty]').forEach(input => {
      const difficulty = Number(input.dataset.difficulty);
      if (DIFFICULTIES.includes(difficulty as Difficulty)) {
        rawMix[difficulty as Difficulty] = Math.max(0, Number(input.value) || 0);
      }
    });

    const rawCount = this.element?.querySelector<HTMLSelectElement>('#questionCount')?.value ?? '20';
    const checked = (id: string): boolean =>
      this.element?.querySelector<HTMLInputElement>(id)?.checked ?? false;

    return {
      topicCodes,
      questionCount: rawCount === 'all' ? 'all' : Math.max(1, Number(rawCount) || 20),
      difficultyMix: rawMix,
      prioritizeWeak: checked('#prioritizeWeak'),
      includeFlagged: checked('#includeFlagged'),
      includeNeedsReview: checked('#includeNeedsReview'),
      randomOrder: checked('#randomOrder'),
      showExplanationImmediately: checked('#showExplanation'),
    };
  }

  private bindSessionEvents(): void {
    if (!this.element || !this.session) return;

    this.element.querySelectorAll<HTMLButtonElement>('.practice-option:not(:disabled)').forEach(button => {
      button.addEventListener('click', () => {
        this.selectOption(Number(button.dataset.option));
      });
    });

    this.element.querySelector('#btnPrev')?.addEventListener('click', () => this.navigate(-1));
    this.element.querySelector('#btnNext')?.addEventListener('click', () => this.navigate(1));
    this.element.querySelector('#btnFinish')?.addEventListener('click', () => this.finishSession());

    this.element.querySelector('#btnFlag')?.addEventListener('click', event => {
      const button = event.currentTarget as HTMLButtonElement;
      this.toggleFlag(button.dataset.flagged !== 'true');
    });
    this.element.querySelector('#btnMarkReview')?.addEventListener('click', event => {
      const button = event.currentTarget as HTMLButtonElement;
      this.toggleMarkReview(button.dataset.marked !== 'true');
    });

    this.element.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach(button => {
      button.addEventListener('click', () => this.jumpToQuestion(Number(button.dataset.index)));
    });
  }

  private handleKeys = (event: KeyboardEvent): void => {
    if (!this.session || this.session.status !== 'active' || !this.element?.isConnected) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

    const question = this.getCurrentQuestion();
    if (!question) return;

    if (event.key >= '1' && event.key <= '5') {
      const index = Number(event.key) - 1;
      if (index < (question.options?.length ?? 0)) this.selectOption(index);
    } else if (event.key === 'ArrowLeft') {
      this.navigate(-1);
    } else if (event.key === 'ArrowRight') {
      this.navigate(1);
    } else if (event.key === 'f' || event.key === 'F') {
      this.toggleFlag();
    } else if (event.key === 'm' || event.key === 'M') {
      this.toggleMarkReview();
    }
  };

  private selectOption(optionIndex: number): void {
    const session = this.session;
    const question = this.getCurrentQuestion();
    if (!session || !question || session.status !== 'active') return;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= (question.options?.length ?? 0)) return;
    // One attempt per question: flag toggles and re-renders must not increment mastery twice.
    if (session.answers.has(question.id)) return;

    const timeMs = Math.max(0, Date.now() - this.questionStartTime);
    const isCorrect = (question.correctAnswer ?? []).includes(optionIndex);
    const marks = this.marks.get(question.id);
    const answer: PracticeAnswer = {
      userAnswer: [optionIndex],
      isCorrect,
      timeMs,
      flagged: marks?.flagged ?? false,
      markedReview: marks?.markedReview ?? false,
    };
    session.answers.set(question.id, answer);

    // Instant feedback: mastery and attempt persistence happen in parallel with
    // re-rendering so the UI never waits on IndexedDB.
    void questionsRepo.updateMastery(question.id, isCorrect)
      .catch(error => console.error('PracticeView: mastery update failed', error));
    const attempt: Attempt = {
      sessionId: session.id,
      questionId: question.id,
      userAnswer: [optionIndex],
      isCorrect,
      timeMs,
      timestamp: nowISO(),
      flagged: answer.flagged,
      markedForReview: answer.markedReview,
    };
    void attemptsRepo.add(attempt)
      .catch(error => console.error('PracticeView: attempt save failed', error));

    this.renderSession();
    this.questionStartTime = Date.now();

    if (session.currentIndex < session.questions.length - 1) {
      this.advanceTimeout = setTimeout(() => {
        this.advanceTimeout = null;
        if (this.session === session && session.status === 'active') this.navigate(1);
      }, AUTO_ADVANCE_DELAY_MS);
    }
  }

  private clearAutoAdvance(): void {
    if (this.advanceTimeout !== null) clearTimeout(this.advanceTimeout);
    this.advanceTimeout = null;
  }

  private navigate(direction: number): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const nextIndex = session.currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= session.questions.length) return;
    this.clearAutoAdvance();
    session.currentIndex = nextIndex;
    this.questionStartTime = Date.now();
    this.renderSession();
  }

  private jumpToQuestion(index: number): void {
    const session = this.session;
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.questions.length) return;
    this.clearAutoAdvance();
    session.currentIndex = index;
    this.questionStartTime = Date.now();
    this.renderSession();
  }

  private toggleFlag(flagged?: boolean): void {
    const question = this.getCurrentQuestion();
    if (!this.session || !question) return;
    this.clearAutoAdvance();
    const marks = this.marks.get(question.id) ?? { flagged: false, markedReview: false };
    marks.flagged = flagged ?? !marks.flagged;
    this.marks.set(question.id, marks);
    const answer = this.session.answers.get(question.id);
    if (answer) answer.flagged = marks.flagged;
    this.renderSession();
  }

  private toggleMarkReview(marked?: boolean): void {
    const question = this.getCurrentQuestion();
    if (!this.session || !question) return;
    this.clearAutoAdvance();
    const marks = this.marks.get(question.id) ?? { flagged: false, markedReview: false };
    marks.markedReview = marked ?? !marks.markedReview;
    this.marks.set(question.id, marks);
    const answer = this.session.answers.get(question.id);
    if (answer) answer.markedReview = marks.markedReview;
    this.renderSession();
  }

  private finishSession(): void {
    if (!this.session) return;
    this.clearAutoAdvance();
    this.session.status = 'review';
    this.stopAutoSave();
    void this.saveSession();
    this.renderSession();
  }

  private async saveSession(): Promise<void> {
    const session = this.session;
    if (!session || session.questions.length === 0) return;

    const correctCount = Array.from(session.answers.values()).filter(answer => answer.isCorrect).length;
    const summary: SessionSummary = {
      totalQuestions: session.questions.length,
      answeredQuestions: session.answers.size,
      correctAnswers: correctCount,
      scorePercent: Math.round((correctCount / session.questions.length) * 100),
      timeSpentMs: Math.max(0, Date.now() - session.startTime),
      perTopic: {},
    };

    session.questions.forEach(question => {
      const answer = session.answers.get(question.id);
      const key = String(question.topicCode);
      if (!summary.perTopic[key as TopicCode]) {
        summary.perTopic[key as TopicCode] = { attempted: 0, correct: 0, avgTimeMs: 0 };
      }
      const topicStats = summary.perTopic[key as TopicCode]!;
      if (answer) {
        topicStats.attempted++;
        if (answer.isCorrect) topicStats.correct++;
        topicStats.avgTimeMs += answer.timeMs;
      }
    });
    Object.values(summary.perTopic).forEach(stats => {
      if (stats.attempted > 0) stats.avgTimeMs = Math.round(stats.avgTimeMs / stats.attempted);
    });

    const config: SessionConfig = {
      questionCount: session.config.questionCount === 'all' ? session.questions.length : session.config.questionCount,
      filter: { topicCodes: session.config.topicCodes as TopicCode[] },
      showExplanationImmediately: session.config.showExplanationImmediately,
    };
    const record: Session = {
      id: session.id,
      mode: 'practice',
      startedAt: new Date(session.startTime).toISOString(),
      completedAt: nowISO(),
      config,
      topicCodes: [...new Set(session.questions.map(question => question.topicCode))],
      summary,
    };
    try {
      await sessionsRepo.put(record);
      this.updateStreak();
    } catch (error) {
      console.error('PracticeView: session save failed', error);
    }
  }

  private updateStreak(): void {
    const today = new Date().toISOString().split('T')[0];
    const streakData = localStorage.getItem('study-streak');
    let current = 0;
    let lastDate = '';

    if (streakData) {
      try {
        const parsed = JSON.parse(streakData);
        current = parsed.current || 0;
        lastDate = parsed.lastDate || '';
      } catch { /* ignore malformed local data */ }
    }
    if (lastDate === today) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    current = lastDate === yesterday ? current + 1 : 1;
    localStorage.setItem('study-streak', JSON.stringify({ current, lastDate: today }));
  }

  private startAutoSave(): void {
    if (this.autoSaveInterval !== null) clearInterval(this.autoSaveInterval);
    this.autoSaveInterval = setInterval(() => {
      if (this.session?.status === 'active') void this.saveSession();
    }, 5000);
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval !== null) clearInterval(this.autoSaveInterval);
    this.autoSaveInterval = null;
  }

  destroy(): void {
    this.clearAutoAdvance();
    this.stopAutoSave();
    document.removeEventListener('keydown', this.handleKeys);
    if (this.routeHandler) eventBus.off('route:changed', this.routeHandler);
    this.routeHandler = null;
    this.session = null;
  }
}

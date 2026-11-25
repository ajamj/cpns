// Mock Exam View (CAT Simulation)
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { questionsRepo, type MockExamSelectionConfig } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { attemptsRepo } from '../db/repositories/attempts';
import {
  getSubdomainColor,
  loadKisiKisi,
  getKisiKisiSync,
  getDefaultWeightsSync,
  getTopicWeight,
} from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, formatTime, downloadJSON } from '../core/utils';
import { APP_CONFIG } from '../core/config';
import type {
  Attempt,
  Difficulty,
  Question,
  Session,
  SessionSummary,
  TopicCode,
} from '../shared/types';

/** Exam form values; topicWeights is keyed by the topic codes shown in the form. */
interface MockExamConfig {
  durationMinutes: number;
  questionCount: number;
  topicCodes: TopicCode[];
  topicWeights: Record<TopicCode, number>;
  difficultyMix: Record<Difficulty, number>;
}

export interface MockExamAnswer {
  userAnswer: number[];
  isCorrect: boolean;
  timeMs: number;
  flagged: boolean;
  markedReview: boolean;
}

interface MockExamSession {
  id: string;
  config: MockExamConfig;
  questions: Question[];
  currentIndex: number;
  answers: Map<string, MockExamAnswer>;
  /** Flags live in the session even before a question has been answered. */
  flags: Set<string>;
  markedReview: Set<string>;
  startTime: number;
  /** Absolute deadline: elapsed time must not be accumulated from setInterval ticks. */
  endsAt: number;
  timeRemainingMs: number;
  timerId: ReturnType<typeof setInterval> | null;
  /** Question currently shown in results review; independent of exam position. */
  reviewIndex: number;
  status: 'config' | 'ready' | 'active' | 'paused' | 'confirming' | 'review';
}

const DEFAULT_DIFFICULTY_MIX: Record<Difficulty, number> = { 1: 30, 2: 50, 3: 20 };

export type TimerWarningLevel = 'normal' | 'warning' | 'danger' | 'critical';

/** 15 min → warning, 5 min → danger, 1 min → critical. */
export function getTimerWarningLevel(remainingMs: number): TimerWarningLevel {
  if (remainingMs <= 60_000) return 'critical';
  if (remainingMs <= 5 * 60_000) return 'danger';
  if (remainingMs <= 15 * 60_000) return 'warning';
  return 'normal';
}

export type NavigatorStatus = 'current' | 'flagged' | 'marked' | 'answered' | 'unvisited';

/** Visual priority for a navigator cell; flags stay visible on answered items. */
export function getNavigatorStatus(cell: {
  current: boolean;
  flagged: boolean;
  markedReview: boolean;
  answered: boolean;
}): NavigatorStatus {
  if (cell.current) return 'current';
  if (cell.flagged) return 'flagged';
  if (cell.markedReview) return 'marked';
  if (cell.answered) return 'answered';
  return 'unvisited';
}

export function calculateExamScore(correctAnswers: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return Math.round((correctAnswers / totalQuestions) * 100);
}

export interface ReviewTopicStats {
  attempted: number;
  correct: number;
  scorePercent: number;
}

/** Per-topic results: only answered questions count as attempted. */
export function getReviewTopicStats(
  questions: ReadonlyArray<Pick<Question, 'id' | 'topicCode'>>,
  answers: ReadonlyMap<string, { isCorrect: boolean } | undefined>
): Record<string, ReviewTopicStats> {
  const stats: Record<string, ReviewTopicStats> = {};
  questions.forEach(question => {
    const topic = stats[question.topicCode] ?? { attempted: 0, correct: 0, scorePercent: 0 };
    stats[question.topicCode] = topic;
    const answer = answers.get(question.id);
    if (!answer) return;
    topic.attempted++;
    if (answer.isCorrect) topic.correct++;
  });
  Object.values(stats).forEach(topic => {
    topic.scorePercent = calculateExamScore(topic.correct, topic.attempted);
  });
  return stats;
}

/** A→E option labels used in the review card and exported results. */
export function optionLetter(index: number): string {
  return Number.isInteger(index) && index >= 0 && index < 26 ? String.fromCharCode(65 + index) : '?';
}

export function answerLetters(indices: readonly number[] | undefined): string {
  if (!Array.isArray(indices) || indices.length === 0) return '—';
  return indices.map(optionLetter).join(', ');
}

/** Time spent is formatted as MM:SS (minutes may exceed 59 for long exams). */
export function formatTimeSpent(ms: number): string {
  return formatTime(Math.max(0, Number.isFinite(ms) ? ms : 0));
}

/** One row of the question-by-question review (also used by result export). */
export function buildReviewAnswer(question: Question, answer: MockExamAnswer | undefined) {
  return {
    questionId: question.id,
    userAnswer: answer?.userAnswer ?? [],
    userAnswerLetters: answerLetters(answer?.userAnswer),
    correctAnswer: question.correctAnswer ?? [],
    correctAnswerLetters: answerLetters(question.correctAnswer),
    isCorrect: answer?.isCorrect ?? false,
    answered: !!answer,
    timeMs: answer?.timeMs ?? 0,
  };
}

/** Countdown from the absolute deadline (never from accumulated tick counts). */
export function getRemainingMs(endsAt: number, now = Date.now()): number {
  return Math.max(0, endsAt - now);
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

/** Question text is user/import supplied: render Markdown but strip scripts. */
function renderRichText(text: unknown): string {
  const raw = String(text ?? '');
  try {
    const purifier = DOMPurify as unknown as { sanitize?: (value: string) => string };
    const html = String(marked.parse(raw, { async: false, breaks: true }));
    if (typeof purifier.sanitize === 'function') return purifier.sanitize(html);
    const factory = DOMPurify as unknown as (win: Window) => { sanitize: (value: string) => string };
    if (typeof factory === 'function' && typeof window !== 'undefined') return factory(window).sanitize(html);
  } catch {
    // Fall through to a plain, escaped rendering.
  }
  return escapeHTML(raw);
}

export class MockExamView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private session: MockExamSession | null = null;
  private questionStartTime = 0;
  private allQuestions: Question[] = [];
  private autoSubmitted = false;
  private routeHandler: ((route: { view: string }) => void) | null = null;

  constructor(params: Record<string, string>) {
    this.params = params;
    // The router does not call destroy() on navigation; without this guard a
    // stale view keeps ticking its timer and answering keyboard shortcuts.
    this.routeHandler = route => {
      if (route.view !== 'mock-exam') this.destroy();
    };
    eventBus.on('route:changed', this.routeHandler);
  }

  async loadQuestions(): Promise<void> {
    // Topic labels/weights come from the kisi-kisi registry; load it before
    // rendering the form so the weight inputs are populated synchronously.
    await loadKisiKisi();
    this.allQuestions = await questionsRepo.getAll();
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'mock-exam-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadQuestions().then(() => {
      if (this.element) {
        if (this.params.config === 'true') {
          this.element.innerHTML = this.getConfigHTML();
          this.bindConfigEvents();
        } else {
          this.element.innerHTML = this.getConfigHTML();
          this.bindConfigEvents();
        }
      }
    });

    return this.element;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('mock.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getConfigHTML(): string {
    const registered = getKisiKisiSync();
    const topics = registered.length > 0
      ? registered.map(topic => ({ code: topic.code, title: topic.title }))
      : [...new Set(this.allQuestions.map(question => String(question.topicCode)))]
        .map(code => ({ code, title: '' }));
    const registryWeights = getDefaultWeightsSync();
    const weights: Record<string, number> = Object.keys(registryWeights).length > 0
      ? registryWeights
      : APP_CONFIG.defaultTopicWeights as Record<string, number>;
    const difficultyMix: Record<Difficulty, number> = { ...DEFAULT_DIFFICULTY_MIX };

    return `
      <div class="page-header">
        <h1 class="page-title">${t('mock.title')}</h1>
        <p class="page-subtitle">${t('mock.config')}</p>
      </div>

      <div class="card" style="max-width:700px;">
        <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);">
          <fieldset>
            <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Konfigurasi Ujian</legend>

            <div class="form-group">
              <label class="form-label" for="mockDuration">${t('mock.duration')} (menit)</label>
              <input type="number" id="mockDuration" class="form-input" value="${APP_CONFIG.defaultMockDurationMinutes}"
                min="${APP_CONFIG.mockMinDurationMinutes}" max="${APP_CONFIG.mockMaxDurationMinutes}" step="15">
            </div>

            <div class="form-group">
              <label class="form-label" for="mockQuestionCount">${t('mock.questionCount')}</label>
              <input type="number" id="mockQuestionCount" class="form-input" value="${APP_CONFIG.defaultMockQuestionCount}"
                min="${APP_CONFIG.mockMinQuestions}" max="${APP_CONFIG.mockMaxQuestions}" step="5">
            </div>

            <div class="form-group">
              <label class="form-label">${t('mock.difficultyMix')}</label>
              <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
                ${([1, 2, 3] as Difficulty[]).map(difficulty => `
                  <div style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="min-width:60px;">${t('difficulty.' + difficulty)}</span>
                    <input type="number" step="5" min="0" max="100" value="${difficultyMix[difficulty]}"
                      data-difficulty="${difficulty}" aria-label="${t('mock.difficultyMix')} — ${t('difficulty.' + difficulty)}"
                      class="form-input" style="width:80px;">
                    <span>%</span>
                  </div>
                `).join('')}
              </div>
              <p class="form-help">Total harus 100%</p>
            </div>

            <div class="form-group">
              <label class="form-label">${t('settings.topicWeights')}</label>
              <p class="form-help">Bobot relatif pemilihan soal per topik (default: UM=1.0, KH=1.5). Kosongkan semua topik untuk menggunakan semua topik.</p>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--space-3);max-height:300px;overflow:auto;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);">
                ${topics.map(topic => {
                  const code = String(topic.code);
                  return `
                    <div style="display:flex;align-items:center;gap:var(--space-2);">
                      <input type="checkbox" data-topic-select="${escapeHTML(code)}" checked class="form-check-input"
                        aria-label="Sertakan topik ${escapeHTML(code)}">
                      <span style="font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--color-text-muted);min-width:60px;">${escapeHTML(code)}</span>
                      <input type="number" step="0.1" min="0" max="5" value="${getTopicWeight(code, weights)}"
                        data-weight="${escapeHTML(code)}" aria-label="Bobot topik ${escapeHTML(code)}"
                        class="form-input" style="width:70px;font-size:var(--text-sm);">
                    </div>
                  `;
                }).join('')}
              </div>
              <p class="form-help" id="mockTopicWeightHelp">Bobot 0 tidak akan diikutsertakan dalam pemilihan soal.</p>
            </div>

            <p class="form-help" id="mockConfigWarning" role="alert" hidden></p>
          </fieldset>

          <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="btnCancelConfig">${t('common.cancel')}</button>
            <button type="button" class="btn btn-primary" id="btnStartExam">${t('mock.start')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private getExamHTML(): string {
    if (!this.session) return '';
    const q = this.session.questions[this.session.currentIndex];
    if (!q) return '';
    const progress = ((this.session.currentIndex + 1) / this.session.questions.length) * 100;
    const answer = this.session.answers.get(q.id);
    const isAnswered = !!answer;
    const isFlagged = this.session.flags.has(q.id);
    const isMarked = this.session.markedReview.has(q.id);
    this.syncRemainingTime();
    const timeStr = formatTime(this.session.timeRemainingMs);
    const warningLevel = getTimerWarningLevel(this.session.timeRemainingMs);
    const warningClass = warningLevel === 'normal' ? '' : ` ${warningLevel}`;
    const warningStyle = this.timerStyle(warningLevel);

    return `
      <div class="exam-header" style="position:fixed;top:0;left:0;right:0;background:var(--color-bg-elevated);border-bottom:1px solid var(--color-border);padding:var(--space-3) var(--space-4);z-index:var(--z-sticky);box-shadow:var(--shadow-md);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
          <div style="display:flex;align-items:center;gap:var(--space-4);">
            <h1 class="page-title" style="font-size:var(--text-lg);">${t('mock.title')}</h1>
            <span class="badge badge-${isFlagged ? 'warning' : isMarked ? 'info' : 'muted'}">${isFlagged ? '⚑ Flagged' : isMarked ? '★ Review' : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="timer${warningClass}" data-warning-level="${warningLevel}" role="timer" aria-label="${t('mock.duration')}" aria-live="off" style="font-size:var(--text-2xl);font-weight:var(--font-bold);font-family:var(--font-mono);font-variant-numeric:tabular-nums;${warningStyle}">
              ${timeStr}
            </div>
            ${warningLevel === 'normal' ? '' : `<div class="timer-alert ${warningLevel}" data-timer-alert="${warningLevel}" role="presentation">${escapeHTML(this.getTimerWarning())}</div>`}
            <div class="timer-warning visually-hidden" role="status" aria-live="assertive" aria-atomic="true">${escapeHTML(this.getTimerWarning())}</div>
            <div style="display:flex;gap:var(--space-2);">
              <button type="button" class="btn btn-ghost btn-icon" id="btnFlagExam" aria-label="${t('mock.flag')}" aria-pressed="${this.session.flags.has(q.id)}" title="${t('mock.flag')}" style="${this.session.flags.has(q.id) ? 'color:var(--color-warning);' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></button>
              <button type="button" class="btn btn-ghost btn-icon" id="btnMarkReviewExam" aria-label="${t('mock.markReview')}" aria-pressed="${this.session.markedReview.has(q.id)}" title="${t('mock.markReview')}" style="${this.session.markedReview.has(q.id) ? 'color:var(--color-info);' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21l-7-7-7 7-7-7-7 7"/><path d="M2 19l7-7 7 7"/></svg></button>
              <button type="button" class="btn btn-ghost btn-icon" id="btnSubmitExam" aria-label="${t('mock.submit')}" title="${t('mock.submit')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            </div>
          </div>
        </div>

        <div style="padding-top:calc(var(--header-height) + 80px);">
          <div class="card" style="margin:var(--space-4);">
            <div class="card-content">
              <!-- Question -->
              <div style="margin-bottom:var(--space-6);">
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted);">
                  <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(q.topicCode)};">${q.topicCode}</span>
                  <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
                  <span>Soal ${this.session.currentIndex + 1} / ${this.session.questions.length}</span>
                </div>
                <div style="font-size:var(--text-lg);line-height:var(--leading-relaxed);font-weight:var(--font-medium);margin-bottom:var(--space-6);">${q.stem}</div>

                <!-- Options -->
                <div style="display:flex;flex-direction:column;gap:var(--space-3);">
                  ${q.options.map((opt: any, i: number) => {
                    const isSelected = answer?.userAnswer.includes(i);
                    const isCorrect = q.correctAnswer.includes(i);
                    const showResult = false; // Don't show during exam
                    let cls = 'exam-option';
                    if (isSelected) cls += ' selected';
                    return `
                      <button type="button" class="${cls}" data-option="${i}" style="
                        display:flex;align-items:flex-start;gap:var(--space-3);
                        min-height:44px;padding:var(--space-4);border:2px solid var(--color-border-strong);
                        border-radius:var(--radius-lg);background:var(--color-bg-elevated);
                        text-align:left;cursor:pointer;transition:all var(--transition-fast);
                        ${isSelected ? 'border-color:var(--color-primary);background:var(--color-primary-light);' : ''}
                      ">
                        <span style="width:32px;height:32px;border:2px solid var(--color-border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);font-size:var(--text-base);flex-shrink:0;${isSelected ? 'background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary);' : ''}">${String.fromCharCode(65 + i)}</span>
                        <div style="flex:1;font-size:var(--text-base);line-height:var(--leading-relaxed);">${opt.text}</div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Navigator Grid -->
              <div style="margin-top:var(--space-6);padding-top:var(--space-6);border-top:1px solid var(--color-border);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
                  <span style="font-weight:var(--font-semibold);">${t('mock.navigator')}</span>
                  <div style="display:flex;gap:var(--space-1);font-size:var(--text-xs);color:var(--color-text-muted);">
                    <span class="nav-legend answered" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:var(--color-success);border-radius:2px;"></span> Terjawab</span>
                    <span class="nav-legend flagged" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;border:2px solid var(--color-warning);border-radius:2px;"></span> Flag</span>
                    <span class="nav-legend marked" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;border:2px solid var(--color-info);border-radius:2px;"></span> Review</span>
                    <span class="nav-legend current" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:var(--color-primary);border-radius:2px;"></span> Sekarang</span>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:6px;">
                  ${this.session.questions.map((_, i) => this.getNavCellHTML(i)).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
  }

  /** Navigator cells: one per selected question, with an explicit status class. */
  private getNavCellHTML(index: number): string {
    const session = this.session;
    if (!session) return '';
    const question = session.questions[index];
    if (!question) return '';
    const isCurrent = index === session.currentIndex;
    const isAnswered = session.answers.has(question.id);
    const isFlagged = session.flags.has(question.id);
    const isMarked = session.markedReview.has(question.id);
    const status = getNavigatorStatus({ current: isCurrent, flagged: isFlagged, markedReview: isMarked, answered: isAnswered });
    const statusLabel = t(`mock.nav.${status}`);
    // An answered question that is also flagged keeps the green fill and gains
    // a warning border, so neither state is lost.
    const style = status === 'current'
      ? 'background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary);'
      : isFlagged && isAnswered
        ? 'background:var(--color-success);color:var(--color-on-success);border-color:var(--color-warning);'
        : isFlagged
          ? 'border-color:var(--color-warning);color:var(--color-warning);'
          : isMarked
            ? 'border-color:var(--color-info);color:var(--color-info);'
            : isAnswered
              ? 'background:var(--color-success);color:var(--color-on-success);border-color:var(--color-success);'
              : 'background:var(--color-bg);color:var(--color-text-muted);border-color:var(--color-border-strong);';
    const extraClass = isFlagged && isAnswered ? ' answered flagged' : '';
    return `<button type="button" class="nav-cell ${status}${extraClass}" data-index="${index}" data-status="${status}" aria-label="${escapeHTML(t('mock.navigator'))} ${index + 1}: ${escapeHTML(statusLabel)}" aria-current="${isCurrent ? 'true' : 'false'}" style="min-width:44px;min-height:44px;aspect-ratio:1;border:2px solid;border-radius:var(--radius-md);font-weight:var(--font-semibold);font-size:var(--text-sm);${style}">${index + 1}</button>`;
  }

  private timerStyle(level: TimerWarningLevel): string {
    if (level === 'critical') return 'color:var(--color-danger);animation:pulse 1s infinite;';
    if (level === 'danger') return 'color:var(--color-warning);';
    if (level === 'warning') return 'color:var(--color-info);';
    return '';
  }

  private getReviewHTML(): string {
    const session = this.session;
    if (!session || session.questions.length === 0) return '';
    const correctCount = Array.from(session.answers.values()).filter(a => a.isCorrect).length;
    const scorePercent = calculateExamScore(correctCount, session.questions.length);
    const totalTime = formatTimeSpent(Date.now() - session.startTime);
    // Keep the index in range even if a session was restored with stale state.
    session.reviewIndex = Number.isInteger(session.reviewIndex)
      ? Math.min(Math.max(session.reviewIndex, 0), session.questions.length - 1)
      : 0;

    return `
      <div class="page-header">
        <h1 class="page-title">${t('mock.results')}</h1>
        <p class="page-subtitle">${t('practice.score', { correct: correctCount, total: session.questions.length, percent: scorePercent })} • ${t('mock.timeAnalysis')}: ${totalTime}</p>
        ${this.autoSubmitted ? `<p class="badge badge-warning" role="status">${t('mock.autoSubmit')}</p>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-4);margin-bottom:var(--space-6);">
        <div class="card review-score-card">
          <div class="card-content" style="text-align:center;padding:var(--space-6);">
            <div class="review-score" style="font-size:var(--text-4xl);font-weight:var(--font-bold);color:${scorePercent >= 70 ? 'var(--color-success)' : 'var(--color-primary)'};">
              ${scorePercent}%
            </div>
            <div style="margin-top:var(--space-2);color:var(--color-text-muted);">${t('mock.overallScore')}</div>
            <div style="margin-top:var(--space-4);font-size:var(--text-sm);color:var(--color-text-muted);">
              Benar: <strong style="color:var(--color-success);">${correctCount}</strong> / ${session.questions.length}
            </div>
            <div style="margin-top:var(--space-1);font-size:var(--text-sm);color:var(--color-text-muted);">
              ${t('mock.timeAnalysis')}: <strong class="review-time">${totalTime}</strong>
            </div>
          </div>
        </div>
        <div class="card review-topics-card">
          <div class="card-content">
            <h2 style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-3);">${t('mock.perTopic')}</h2>
            ${this.getReviewTopicHTML()}
          </div>
        </div>
      </div>

      <div class="card review-card" id="reviewQuestionCard" data-question-index="${session.reviewIndex}" style="margin-bottom:var(--space-4);">
        <div class="card-header">
          <h2 class="card-title">${t('mock.reviewMode')}</h2>
          <span class="badge badge-muted review-position">${session.reviewIndex + 1} / ${session.questions.length}</span>
        </div>
        <div class="card-content">
          <div class="review-navigator" role="group" aria-label="${escapeHTML(t('mock.navigator'))}" style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-5);">
            ${session.questions.map((_, i) => this.getReviewNavCellHTML(i)).join('')}
          </div>
          <div id="reviewQuestionContent">${this.getReviewQuestionHTML(session.reviewIndex)}</div>
          <div class="review-controls" style="display:flex;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-5);border-top:1px solid var(--color-border);padding-top:var(--space-4);">
            <button type="button" class="btn btn-secondary" id="btnReviewPrev" ${session.reviewIndex === 0 ? 'disabled aria-disabled="true"' : ''}>← ${t('common.previous')}</button>
            <button type="button" class="btn btn-primary" id="btnReviewNext" ${session.reviewIndex === session.questions.length - 1 ? 'disabled aria-disabled="true"' : ''}>${t('common.next')} →</button>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;margin-top:var(--space-6);">
        <button class="btn btn-primary" id="btnReviewAgain">${t('mock.title')} Lagi</button>
        <button class="btn btn-secondary" id="btnExportResults">${t('mock.exportResults')}</button>
        <a href="#/dashboard" class="btn btn-secondary">${t('nav.dashboard')}</a>
        <a href="#/analytics" class="btn btn-secondary">${t('nav.analytics')}</a>
      </div>
    `;
  }

  /** Attempted/correct/percentage per topic code (attempted = answered only). */
  private getReviewTopicHTML(): string {
    const session = this.session;
    if (!session) return '';
    const stats = getReviewTopicStats(session.questions, session.answers);
    return Object.entries(stats).map(([code, topic]) => `
      <div class="review-topic-row" data-topic="${escapeHTML(code)}" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:var(--text-sm);">
        <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(code)};">${escapeHTML(code)}</span>
        <span class="review-topic-detail">
          Dijawab: <strong class="review-topic-attempted">${topic.attempted}</strong>
          • Benar: <strong class="review-topic-correct">${topic.correct}</strong>
          • <strong class="review-topic-score">${topic.scorePercent}%</strong>
        </span>
      </div>
    `).join('');
  }

  /** Review navigator: correctness status per question, current one highlighted. */
  private getReviewNavCellHTML(index: number): string {
    const session = this.session;
    const question = session?.questions[index];
    if (!session || !question) return '';
    const answer = session.answers.get(question.id);
    const isCurrent = index === session.reviewIndex;
    const status = !answer ? 'unanswered' : answer.isCorrect ? 'correct' : 'incorrect';
    const label = isCurrent ? 'Sedang ditinjau' : status === 'correct' ? 'Benar' : status === 'incorrect' ? 'Salah' : 'Belum dijawab';
    const style = isCurrent
      ? 'background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary);'
      : status === 'correct'
        ? 'background:var(--color-success);color:var(--color-on-success);border-color:var(--color-success);'
        : status === 'incorrect'
          ? 'background:var(--color-danger);color:var(--color-on-danger);border-color:var(--color-danger);'
          : 'background:var(--color-bg);color:var(--color-text-muted);border-color:var(--color-border-strong);';
    return `<button type="button" class="review-nav-cell ${status}${isCurrent ? ' current' : ''}" data-index="${index}" data-status="${status}" aria-label="${escapeHTML(t('mock.reviewMode'))} ${index + 1}: ${label}" aria-current="${isCurrent ? 'true' : 'false'}" style="min-width:40px;min-height:40px;border:2px solid;border-radius:var(--radius-md);font-size:var(--text-sm);font-weight:var(--font-semibold);${style}">${index + 1}</button>`;
  }

  /** One question card: stem, all options with answer keys, explanation. */
  private getReviewQuestionHTML(index: number): string {
    const session = this.session;
    const question = session?.questions[index];
    if (!session || !question) return '';
    const answer = session.answers.get(question.id);
    const review = buildReviewAnswer(question, answer);
    const correctAnswer = review.correctAnswer;
    const userAnswer = review.userAnswer;
    const isFlagged = session.flags.has(question.id);
    const isMarked = session.markedReview.has(question.id);
    const resultLabel = !answer ? 'Belum dijawab' : answer.isCorrect ? 'Benar' : 'Salah';
    const resultClass = !answer ? 'badge-muted' : answer.isCorrect ? 'badge-success' : 'badge-danger';

    return `
      <div class="review-question" data-question-index="${index}" data-result="${!answer ? 'unanswered' : answer.isCorrect ? 'correct' : 'incorrect'}">
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-3);">
          <span class="badge ${resultClass} review-result">${resultLabel}</span>
          <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(question.topicCode)};">${escapeHTML(question.topicCode)}</span>
          <span class="badge badge-difficulty-${question.difficulty}">${t('difficulty.' + question.difficulty)}</span>
          ${isFlagged ? `<span class="badge badge-warning">⚑ ${t('mock.flag')}</span>` : ''}
          ${isMarked ? `<span class="badge badge-info">★ ${t('mock.markReview')}</span>` : ''}
          <span style="font-weight:var(--font-medium);">Soal ${index + 1} / ${session.questions.length}</span>
        </div>
        <div class="review-stem" style="font-weight:var(--font-medium);line-height:var(--leading-relaxed);margin-bottom:var(--space-4);">${renderRichText(question.stem)}</div>
        <div class="review-options" style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-3);">
          ${question.options.map((opt, oi) => {
            const isCorrect = correctAnswer.includes(oi);
            const isUserWrong = userAnswer.includes(oi) && !isCorrect;
            const classes = ['review-option'];
            let style = 'padding:var(--space-2);border-radius:var(--radius-md);border:1px solid var(--color-border);';
            if (isCorrect) {
              classes.push('correct');
              style += 'background:var(--color-success-light);border-color:var(--color-success);';
            }
            if (isUserWrong) {
              classes.push('incorrect');
              style += 'background:var(--color-danger-light);border-color:var(--color-danger);';
            }
            return `
              <div class="${classes.join(' ')}" data-option="${oi}" style="${style}">
                <span class="review-option-letter" style="font-weight:var(--font-bold);width:24px;display:inline-block;">${optionLetter(oi)}</span>
                <span class="review-option-text">${renderRichText(opt.text)}</span>
                ${isCorrect ? ' <span class="badge badge-success">Kunci</span>' : ''}
                ${isUserWrong ? ' <span class="badge badge-danger">Jawaban Anda</span>' : ''}
              </div>
            `;
          }).join('')}
        </div>
        <div class="review-answer-summary" style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);">
          Jawaban Anda: <strong class="review-user-answer" style="color:var(--color-danger);">${review.userAnswerLetters}</strong>
          • Kunci: <strong class="review-correct-answer" style="color:var(--color-success);">${review.correctAnswerLetters}</strong>
          ${answer ? ` • Waktu: <strong>${formatTimeSpent(answer.timeMs)}</strong>` : ''}
        </div>
        ${question.explanation ? `
          <div class="review-explanation" style="padding:var(--space-3);background:var(--color-info-light);border-radius:var(--radius-md);border:1px solid var(--color-info);">
            <strong>${t('practice.explanation')}</strong>
            <div style="margin-top:var(--space-1);">${renderRichText(question.explanation)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private reviewNavigate(direction: number): void {
    const session = this.session;
    if (!session || session.status !== 'review' || session.questions.length === 0) return;
    const next = session.reviewIndex + direction;
    if (next < 0 || next >= session.questions.length) return;
    session.reviewIndex = next;
    this.renderReview();
  }

  private jumpToReviewQuestion(index: number): void {
    const session = this.session;
    if (!session || session.status !== 'review' || !Number.isInteger(index)) return;
    if (index < 0 || index >= session.questions.length) return;
    session.reviewIndex = index;
    this.renderReview();
  }

  /** Re-render only the review region so the summary cards stay in place. */
  private renderReview(): void {
    if (!this.element || !this.session) return;
    const card = this.element.querySelector<HTMLElement>('#reviewQuestionCard');
    const position = this.element.querySelector<HTMLElement>('.review-position');
    if (!card || !position) {
      this.renderExam();
      return;
    }
    const index = this.session.reviewIndex;
    card.dataset.questionIndex = String(index);
    position.textContent = `${index + 1} / ${this.session.questions.length}`;
    const nav = card.querySelector<HTMLElement>('.review-navigator');
    if (nav) nav.innerHTML = this.session.questions.map((_, i) => this.getReviewNavCellHTML(i)).join('');
    const content = card.querySelector<HTMLElement>('#reviewQuestionContent');
    if (content) content.innerHTML = this.getReviewQuestionHTML(index);
    const prev = card.querySelector<HTMLButtonElement>('#btnReviewPrev');
    const next = card.querySelector<HTMLButtonElement>('#btnReviewNext');
    if (prev) {
      prev.disabled = index === 0;
      if (prev.disabled) prev.setAttribute('aria-disabled', 'true');
      else prev.removeAttribute('aria-disabled');
    }
    if (next) {
      next.disabled = index === this.session.questions.length - 1;
      if (next.disabled) next.setAttribute('aria-disabled', 'true');
      else next.removeAttribute('aria-disabled');
    }
    this.bindReviewEvents(true);
  }

  /** Download the result summary plus every question's answer and explanation. */
  private exportResults(): void {
    const session = this.session;
    if (!session) return;
    const correctCount = Array.from(session.answers.values()).filter(a => a.isCorrect).length;
    const timeSpentMs = Math.max(0, Date.now() - session.startTime);
    downloadJSON({
      sessionId: session.id,
      startedAt: new Date(session.startTime).toISOString(),
      durationMinutes: session.config.durationMinutes,
      totalQuestions: session.questions.length,
      answeredQuestions: session.answers.size,
      correctAnswers: correctCount,
      scorePercent: calculateExamScore(correctCount, session.questions.length),
      timeSpentMs,
      timeSpent: formatTimeSpent(timeSpentMs),
      perTopic: getReviewTopicStats(session.questions, session.answers),
      questions: session.questions.map((question, index) => ({
        number: index + 1,
        topicCode: question.topicCode,
        stem: question.stem,
        ...buildReviewAnswer(question, session.answers.get(question.id)),
        explanation: question.explanation ?? '',
      })),
    }, `mock-exam-results-${session.id}.json`);
  }

  private async selectQuestions(config: MockExamSelectionConfig): Promise<Question[]> {
    return questionsRepo.selectForMockExam(config);
  }

  private async startExam(config: MockExamConfig): Promise<void> {
    const questions = await this.selectQuestions(config);
    if (questions.length === 0) {
      alert('Tidak ada soal yang sesuai konfigurasi. Periksa bobot topik dan kesulitan.');
      return;
    }

    const startedAt = Date.now();
    const durationMs = config.durationMinutes * 60 * 1000;
    this.session = {
      id: generateId(),
      config,
      questions,
      currentIndex: 0,
      answers: new Map(),
      flags: new Set(),
      markedReview: new Set(),
      startTime: startedAt,
      endsAt: startedAt + durationMs,
      timeRemainingMs: durationMs,
      timerId: null,
      reviewIndex: 0,
      status: 'active',
    };
    this.autoSubmitted = false;

    this.questionStartTime = startedAt;
    this.element?.setAttribute('data-exam-active', 'true');
    this.renderExam();
    this.startTimer();
    void this.enterFullscreen();
  }

  private startTimer(): void {
    this.stopTimer();
    const session = this.session;
    if (!session) return;
    session.timerId = setInterval(() => {
      // The session may have been replaced while a stale interval was pending.
      if (this.session !== session || session.status !== 'active') {
        this.stopTimer();
        return;
      }
      this.syncRemainingTime();
      if (session.timeRemainingMs <= 0) {
        this.autoSubmit();
        return;
      }
      this.updateTimerDisplay();
    }, 1000);
  }

  /** Derive the countdown from the deadline so background throttling cannot drift. */
  private syncRemainingTime(): void {
    if (!this.session) return;
    this.session.timeRemainingMs = getRemainingMs(this.session.endsAt);
  }

  private updateTimerDisplay(): void {
    if (!this.session || !this.element) return;
    const level = getTimerWarningLevel(this.session.timeRemainingMs);
    const timerEl = this.element.querySelector<HTMLElement>('.timer');
    if (timerEl) {
      timerEl.textContent = formatTime(this.session.timeRemainingMs);
      timerEl.className = `timer${level === 'normal' ? '' : ` ${level}`}`;
      timerEl.dataset.warningLevel = level;
      timerEl.style.cssText = 'font-size:var(--text-2xl);font-weight:var(--font-bold);font-family:var(--font-mono);font-variant-numeric:tabular-nums;' + this.timerStyle(level);
    }

    const warning = this.getTimerWarning();
    let alertEl = this.element.querySelector<HTMLElement>('.timer-alert');
    if (level === 'normal') {
      alertEl?.remove();
    } else {
      if (!alertEl) {
        alertEl = document.createElement('div');
        alertEl.className = 'timer-alert';
        alertEl.setAttribute('role', 'presentation');
        timerEl?.insertAdjacentElement('afterend', alertEl);
      }
      alertEl.className = `timer-alert ${level}`;
      alertEl.dataset.timerAlert = level;
      alertEl.textContent = warning;
    }

    // Only the warning is a live region; the ticking timer itself is silent so
    // screen readers are not interrupted every second.
    const warningEl = this.element.querySelector<HTMLElement>('.timer-warning');
    if (warningEl && warningEl.textContent !== warning) warningEl.textContent = warning;
  }

  /** Thresholds are announced once per level, never on every tick. */
  private getTimerWarning(): string {
    if (!this.session) return '';
    switch (getTimerWarningLevel(this.session.timeRemainingMs)) {
      case 'critical': return t('mock.warning1');
      case 'danger': return t('mock.warning5');
      case 'warning': return t('mock.warning15');
      default: return '';
    }
  }

  private autoSubmit(): void {
    if (!this.session || this.session.status === 'review') return;
    this.autoSubmitted = true;
    this.stopTimer();
    void this.finishExam();
  }

  private stopTimer(): void {
    const timerId = this.session?.timerId;
    if (timerId) {
      clearInterval(timerId);
      this.session!.timerId = null;
    }
  }

  private renderExam(): void {
    if (!this.element || !this.session) return;
    if (this.session.status === 'review') {
      this.element.innerHTML = this.getReviewHTML();
    } else {
      this.element.innerHTML = this.getExamHTML();
      this.updateTimerDisplay();
    }
    this.bindExamEvents();
  }

  /** Read the form into a config; returns null (with a visible warning) if invalid. */
  private getConfigFromForm(): MockExamConfig | null {
    const warning = this.element?.querySelector<HTMLElement>('#mockConfigWarning');
    const fail = (message: string): null => {
      if (warning) {
        warning.textContent = message;
        warning.hidden = false;
      }
      return null;
    };

    const numberValue = (selector: string, fallback: number): number => {
      const raw = Number(this.element?.querySelector<HTMLInputElement>(selector)?.value);
      return Number.isFinite(raw) ? raw : fallback;
    };
    const durationMinutes = Math.min(
      APP_CONFIG.mockMaxDurationMinutes,
      Math.max(APP_CONFIG.mockMinDurationMinutes, Math.round(numberValue('#mockDuration', APP_CONFIG.defaultMockDurationMinutes)))
    );
    const questionCount = Math.min(
      APP_CONFIG.mockMaxQuestions,
      Math.max(APP_CONFIG.mockMinQuestions, Math.round(numberValue('#mockQuestionCount', APP_CONFIG.defaultMockQuestionCount)))
    );

    const difficultyMix: Record<Difficulty, number> = { ...DEFAULT_DIFFICULTY_MIX };
    this.element?.querySelectorAll<HTMLInputElement>('[data-difficulty]').forEach(input => {
      const difficulty = Number(input.dataset.difficulty);
      if (!([1, 2, 3] as Difficulty[]).includes(difficulty as Difficulty)) return;
      const value = Number(input.value);
      difficultyMix[difficulty as Difficulty] = Number.isFinite(value) ? Math.max(0, value) : 0;
    });
    const mixTotal = (difficultyMix[1] ?? 0) + (difficultyMix[2] ?? 0) + (difficultyMix[3] ?? 0);
    if (mixTotal !== 100) return fail('Total campuran kesulitan harus 100%.');

    const topicWeights: Record<TopicCode, number> = {};
    this.element?.querySelectorAll<HTMLInputElement>('[data-weight]').forEach(input => {
      const code = input.dataset.weight;
      if (!code) return;
      const value = Number(input.value);
      topicWeights[code as TopicCode] = Number.isFinite(value) ? Math.max(0, value) : 1;
    });

    const topicCodes = Array.from(this.element?.querySelectorAll<HTMLInputElement>('[data-topic-select]') ?? [])
      .filter(input => input.checked && input.dataset.topicSelect)
      .map(input => input.dataset.topicSelect as TopicCode);
    if (topicCodes.length > 0 && !topicCodes.some(code => (topicWeights[code] ?? 0) > 0)) {
      return fail('Berikan bobot lebih dari 0 pada minimal satu topik yang dipilih.');
    }

    if (warning) warning.hidden = true;
    return { durationMinutes, questionCount, topicCodes, topicWeights, difficultyMix };
  }

  private async enterFullscreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen();
    } catch {}
  }

  private exitFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }

  private bindConfigEvents(): void {
    if (!this.element) return;

    this.element.querySelector('#btnStartExam')?.addEventListener('click', () => {
      const config = this.getConfigFromForm();
      if (config) void this.startExam(config);
    });

    this.element.querySelector('#btnCancelConfig')?.addEventListener('click', () => {
      navigate('dashboard');
    });
  }

  private bindExamEvents(): void {
    if (!this.element || !this.session) return;

    // Option selection (answers can be revised until submit).
    this.element.querySelectorAll<HTMLButtonElement>('.exam-option').forEach(btn => {
      btn.addEventListener('click', () => this.selectOption(Number(btn.dataset.option)));
    });

    // Navigator
    this.element.querySelectorAll<HTMLButtonElement>('.nav-cell').forEach(btn => {
      btn.addEventListener('click', () => this.jumpToQuestion(Number(btn.dataset.index)));
    });

    // Flag/Mark Review/Submit
    this.element.querySelector('#btnFlagExam')?.addEventListener('click', () => this.toggleFlag());
    this.element.querySelector('#btnMarkReviewExam')?.addEventListener('click', () => this.toggleMarkReview());
    this.element.querySelector('#btnSubmitExam')?.addEventListener('click', () => this.confirmSubmit());
    this.element.querySelector('#btnReviewAgain')?.addEventListener('click', () => this.showConfig());
    this.bindReviewEvents();

    // Keyboard (one listener; addEventListener dedupes the same handler).
    document.addEventListener('keydown', this.handleKeys);
  }

  /** Results review controls: navigator cells, prev/next, export. */
  private bindReviewEvents(navOnly = false): void {
    if (!this.element || !this.session) return;
    this.element.querySelectorAll<HTMLButtonElement>('.review-nav-cell').forEach(btn => {
      btn.addEventListener('click', () => this.jumpToReviewQuestion(Number(btn.dataset.index)));
    });
    // Prev/Next/Export survive a partial review re-render; rebinding them
    // would stack duplicate handlers on every navigation step.
    if (navOnly) return;
    this.element.querySelector('#btnReviewPrev')?.addEventListener('click', () => this.reviewNavigate(-1));
    this.element.querySelector('#btnReviewNext')?.addEventListener('click', () => this.reviewNavigate(1));
    this.element.querySelector('#btnExportResults')?.addEventListener('click', () => this.exportResults());
  }

  private handleKeys = (e: KeyboardEvent): void => {
    if (!this.session || !this.element?.isConnected) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Results review reuses the arrow keys to move between question cards.
    if (this.session.status === 'review') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.reviewNavigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.reviewNavigate(1);
      }
      return;
    }
    if (this.session.status !== 'active') return;
    if (e.altKey || e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter') this.confirmSubmit();
      return;
    }
    // Let native button/link activation handle Enter when one has focus.
    if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.closest('button, a, select')) return;
    const question = this.session.questions[this.session.currentIndex];
    if (!question) return;

    if (e.key >= '1' && e.key <= '5') {
      const index = Number(e.key) - 1;
      if (index < question.options.length) this.selectOption(index);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.navigate(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.navigate(1);
    } else if (e.key === 'f' || e.key === 'F') {
      this.toggleFlag();
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMarkReview();
    } else if (e.key === 'Enter') {
      this.confirmSubmit();
    }
  };

  private selectOption(optionIndex: number): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const q = session.questions[session.currentIndex];
    if (!q || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) return;

    const timeMs = Math.max(0, Date.now() - this.questionStartTime);
    session.answers.set(q.id, {
      userAnswer: [optionIndex],
      isCorrect: q.correctAnswer.includes(optionIndex),
      timeMs,
      flagged: session.flags.has(q.id),
      markedReview: session.markedReview.has(q.id),
    });

    // Answers are restored from the map on render, so changing an answer and
    // navigating back to a question both work without losing previous state.
    this.questionStartTime = Date.now();
    this.renderExam();
  }

  private navigate(direction: number): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const newIndex = session.currentIndex + direction;
    if (newIndex >= 0 && newIndex < session.questions.length) {
      session.currentIndex = newIndex;
      this.questionStartTime = Date.now();
      this.renderExam();
    }
  }

  private jumpToQuestion(index: number): void {
    const session = this.session;
    if (!session || session.status !== 'active' || !Number.isInteger(index)) return;
    if (index >= 0 && index < session.questions.length) {
      session.currentIndex = index;
      this.questionStartTime = Date.now();
      this.renderExam();
    }
  }

  private toggleFlag(): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const q = session.questions[session.currentIndex];
    if (!q) return;
    const flagged = !session.flags.has(q.id);
    if (flagged) session.flags.add(q.id);
    else session.flags.delete(q.id);
    // Keep an already-recorded answer in sync so the flag survives persistence.
    const answer = session.answers.get(q.id);
    if (answer) answer.flagged = flagged;
    this.renderExam();
  }

  private toggleMarkReview(): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const q = session.questions[session.currentIndex];
    if (!q) return;
    const marked = !session.markedReview.has(q.id);
    if (marked) session.markedReview.add(q.id);
    else session.markedReview.delete(q.id);
    const answer = session.answers.get(q.id);
    if (answer) answer.markedReview = marked;
    this.renderExam();
  }

  private confirmSubmit(): void {
    const session = this.session;
    if (!session || session.status !== 'active') return;
    const unanswered = session.questions.filter(q => !session.answers.has(q.id)).length;
    const flagged = session.flags.size;

    // Keep the native blocking dialog: during a CAT the countdown must not be
    // bypassed by a background modal, and the counts are shown before commit.
    const message = `${t('mock.confirmSubmit', { unanswered, flagged })}\nAre you sure you want to submit?`;
    if (!window.confirm(message)) return;
    void this.finishExam();
  }

  private async finishExam(): Promise<void> {
    const session = this.session;
    if (!session || session.status === 'review') return;
    this.stopTimer();
    this.exitFullscreen();
    this.element?.removeAttribute('data-exam-active');
    session.status = 'review';
    // Review always starts at question 1; the exam navigator stays where the
    // candidate left it and is not mutated by browsing results.
    session.reviewIndex = 0;
    this.syncRemainingTime();
    try {
      await this.saveSession();
    } catch (error) {
      console.error('MockExamView: could not save completed session', error);
    }
    this.renderExam();
  }

  private async saveSession(): Promise<void> {
    const session = this.session;
    if (!session) return;

    const correctCount = Array.from(session.answers.values()).filter(a => a.isCorrect).length;
    const summary: SessionSummary = {
      totalQuestions: session.questions.length,
      answeredQuestions: session.answers.size,
      correctAnswers: correctCount,
      scorePercent: calculateExamScore(correctCount, session.questions.length),
      timeSpentMs: Math.max(0, Date.now() - session.startTime),
      perTopic: {},
    };

    session.questions.forEach(q => {
      const ans = session.answers.get(q.id);
      const topic = summary.perTopic[q.topicCode] ?? { attempted: 0, correct: 0, avgTimeMs: 0 };
      summary.perTopic[q.topicCode] = topic;
      if (ans) {
        topic.attempted++;
        if (ans.isCorrect) topic.correct++;
        topic.avgTimeMs += ans.timeMs;
      }
    });
    Object.values(summary.perTopic).forEach(topic => {
      if (topic.attempted > 0) topic.avgTimeMs = Math.round(topic.avgTimeMs / topic.attempted);
    });

    const sessionRecord: Session = {
      id: session.id,
      mode: 'mock-exam',
      startedAt: new Date(session.startTime).toISOString(),
      completedAt: nowISO(),
      config: session.config,
      topicCodes: session.questions.map(q => q.topicCode),
      summary,
    };
    await sessionsRepo.put(sessionRecord);

    const attempts: Attempt[] = [];
    session.questions.forEach(q => {
      const ans = session.answers.get(q.id);
      if (!ans) return;
      attempts.push({
        sessionId: session.id,
        questionId: q.id,
        userAnswer: ans.userAnswer,
        isCorrect: ans.isCorrect,
        timeMs: ans.timeMs,
        timestamp: nowISO(),
        // Re-read the sets so flags toggled after answering are not lost.
        flagged: session.flags.has(q.id),
        markedForReview: session.markedReview.has(q.id),
      });
    });
    if (attempts.length > 0) await attemptsRepo.bulkAdd(attempts);

    // Task 8 owns mastery updates; mock answers feed the same repository.
    await Promise.all(
      Array.from(session.answers, ([questionId, answer]) =>
        questionsRepo.updateMastery(questionId, answer.isCorrect))
    );
  }

  /** Return from results to a fresh configuration form. */
  private showConfig(): void {
    this.stopTimer();
    this.session = null;
    this.autoSubmitted = false;
    if (!this.element) return;
    this.element.removeAttribute('data-exam-active');
    this.element.innerHTML = this.getConfigHTML();
    this.bindConfigEvents();
  }

  destroy(): void {
    this.stopTimer();
    this.exitFullscreen();
    this.element?.removeAttribute('data-exam-active');
    document.removeEventListener('keydown', this.handleKeys);
    if (this.routeHandler) eventBus.off('route:changed', this.routeHandler);
    this.routeHandler = null;
  }
}
// Flashcards View — SM-2 spaced-repetition study session.
import { questionsRepo } from '../db/repositories/questions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { settingsRepo } from '../db/repositories/settings';
import { t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, todayISO } from '../core/utils';
import {
  DEFAULT_SM2_PARAMS,
  FlashcardSession,
  reviewCard,
  type SM2Rating,
} from '../features/flashcards/sm2';
import type { Flashcard, SM2Params } from '../shared/types';

type FlashcardStats = {
  due: number;
  new: number;
  learning: number;
  review: number;
  mature: number;
};

const EMPTY_STATS: FlashcardStats = { due: 0, new: 0, learning: 0, review: 0, mature: 0 };
const DEFAULT_DAILY_LIMIT = 50;

/**
 * The four visible choices map onto the engine's 0-5 quality scale:
 * Again is a lapse (1), Hard is a penalised but successful recall (3),
 * Good is a standard recall (4) and Easy grants the ease bonus (5).
 * `data-quality` keeps the historic 0-3 button index; `data-rating` exposes
 * the SM-2 quality actually applied.
 */
const RATING_BY_BUTTON: readonly SM2Rating[] = [1, 3, 4, 5];

const RATING_BUTTONS = [
  {
    id: 'btnAgain',
    quality: 0,
    rating: 1,
    label: 'flash.rateAgain',
    tone: 'btn-danger',
    icon: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-5"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>',
  },
  {
    id: 'btnHard',
    quality: 1,
    rating: 3,
    label: 'flash.rateHard',
    tone: 'btn-warning',
    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  },
  {
    id: 'btnGood',
    quality: 2,
    rating: 4,
    label: 'flash.rateGood',
    tone: 'btn-primary',
    icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  },
  {
    id: 'btnEasy',
    quality: 3,
    rating: 5,
    label: 'flash.rateEasy',
    tone: 'btn-success',
    icon: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  },
] as const;

function sm2RatingForButton(quality: number): SM2Rating {
  if (!Number.isInteger(quality) || quality < 0 || quality >= RATING_BY_BUTTON.length) {
    return 4;
  }
  return RATING_BY_BUTTON[quality] ?? 4;
}

/**
 * Map an SM-2 rating onto question mastery. Good (4) and Easy (5) are
 * successful recalls; Again (1) and Hard (3) are lapses. Manual flashcards
 * have no questionId and are deliberately excluded from mastery updates.
 */
export function isCorrectRecall(rating: SM2Rating): boolean {
  return rating === 4 || rating === 5;
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

export class FlashcardsView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private session = new FlashcardSession([], { params: DEFAULT_SM2_PARAMS });
  private sm2Params: SM2Params = DEFAULT_SM2_PARAMS;
  private stats: FlashcardStats = EMPTY_STATS;
  private isRating = false;
  private disposed = false;
  private routeHandler: ((route: { view: string }) => void) | null = null;

  constructor(params: Record<string, string>) {
    this.params = params;
    // The app does not call destroy() on navigation; release the global key
    // handler when the router leaves flashcards (same pattern as practice).
    this.routeHandler = route => {
      if (route.view !== 'flashcards') this.destroy();
    };
    eventBus.on('route:changed', this.routeHandler);
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'flashcards-view';
    this.element.innerHTML = this.getShellHTML();
    this.bindEvents();
    void this.loadData();
    return this.element;
  }

  destroy(): void {
    this.disposed = true;
    document.removeEventListener('keydown', this.handleKeys);
    if (this.routeHandler) eventBus.off('route:changed', this.routeHandler);
    this.routeHandler = null;
  }

  private async loadData(): Promise<void> {
    try {
      const settings = await settingsRepo.getAllWithDefaults();
      const params = settings.flashcardParams ?? DEFAULT_SM2_PARAMS;
      // getDueCards() filters dueDate <= today and sorts oldest first.
      const [cards, stats] = await Promise.all([
        flashcardsRepo.getDueCards(params.dailyLimit ?? DEFAULT_DAILY_LIMIT),
        flashcardsRepo.getStats(),
      ]);
      if (this.disposed || !this.element) return;

      this.sm2Params = params;
      this.stats = stats;
      this.session = new FlashcardSession(cards, { params: this.sm2Params });
      this.element.innerHTML = this.getShellHTML();
      this.bindEvents();
      this.syncCardFace();
    } catch (error) {
      console.error('Failed to load flashcards session', error);
      if (!this.disposed && this.element) {
        const container = this.element.querySelector('#cardContainer');
        if (container) {
          container.innerHTML = `<div class="card"><div class="card-content">${escapeHTML(t('common.error'))}</div></div>`;
        }
      }
    }
  }

  private getShellHTML(): string {
    const buttons = RATING_BUTTONS.map(button => `
      <button type="button" class="btn btn-lg ${button.tone} flashcard-rating"
              id="${button.id}" data-quality="${button.quality}" data-rating="${button.rating}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${button.icon}</svg>
        <span>${escapeHTML(t(button.label))}</span>
        <kbd>${button.quality + 1}</kbd>
      </button>
    `).join('');

    return `
      <div class="page-header">
        <h1 class="page-title">${escapeHTML(t('flash.title'))}</h1>
        <p class="page-subtitle">${escapeHTML(t('flash.shortcuts'))}</p>
      </div>

      <div class="flashcard-stats" id="flashcardStats" role="group" aria-label="${escapeHTML(t('flash.stats'))}">
        ${this.getStatsHTML()}
      </div>

      <div id="cardContainer">${this.getBodyHTML()}</div>

      <div class="flashcard-ratings" id="cardControls" role="group"
           aria-label="${escapeHTML(t('flash.stats'))}" hidden>
        <div class="flashcard-rating-buttons">${buttons}</div>
      </div>

      <div class="flashcard-actions">
        <button type="button" class="btn btn-secondary" id="btnCreateFromQuestions">${escapeHTML(t('flash.createFromQuestion'))}</button>
        <button type="button" class="btn btn-secondary" id="btnCreateManual">${escapeHTML(t('flash.createManual'))}</button>
        <a href="#/settings" class="btn btn-secondary">${escapeHTML(t('settings.flashcardParams'))}</a>
      </div>
    `;
  }

  private getStatsHTML(): string {
    const cells: Array<[keyof FlashcardStats, string, string]> = [
      ['due', 'flash.dueToday', 'primary'],
      ['new', 'flash.newCards', 'info'],
      ['learning', 'flash.learning', 'warning'],
      ['review', 'flash.review', 'secondary'],
      ['mature', 'flash.mature', 'success'],
    ];
    return cells.map(([key, label, tone]) => `
      <div class="flashcard-stat flashcard-stat-${tone}" data-stat="${key}">
        <div class="flashcard-stat-value">${this.stats[key]}</div>
        <div class="flashcard-stat-label">${escapeHTML(t(label))}</div>
      </div>
    `).join('');
  }

  private getBodyHTML(): string {
    if (this.session.isComplete && this.session.total > 0) return this.getCompletionHTML();
    if (!this.session.currentCard) return this.getEmptyHTML();
    return this.getCardHTML(this.session.currentCard);
  }

  private getCardHTML(card: Flashcard): string {
    const current = this.session.currentIndex + 1;
    const total = this.session.total;
    const progress = total > 0 ? Math.round((current / total) * 100) : 0;
    const typeLabel = t(`flash.type.${card.type}`);

    return `
      <div class="card flashcard-card">
        <div class="card-header flashcard-card-header">
          <div class="flashcard-progress-group">
            <span class="flashcard-progress-text">${escapeHTML(t('flash.progress', { current, total }))}</span>
            <div class="flashcard-progress-track" role="progressbar" aria-valuemin="0"
                 aria-valuemax="${total}" aria-valuenow="${current}"
                 aria-label="${escapeHTML(t('flash.stats'))}">
              <div class="flashcard-progress-fill" style="--flashcard-progress:${progress}%"></div>
            </div>
          </div>
          <span class="badge badge-primary">${escapeHTML(typeLabel === `flash.type.${card.type}` ? card.type : typeLabel)}</span>
        </div>
        <div class="card-content flashcard-card-body">
          <div id="cardInner" class="flashcard-flipper" role="button" tabindex="0"
               aria-pressed="false" aria-label="${escapeHTML(t('flash.showAnswer'))}">
            <div id="flashcardView" class="flashcard-inner">
              <div class="flashcard-face flashcard-front" aria-hidden="false">
                <span class="flashcard-face-label">${escapeHTML(t('flash.front'))}</span>
                <div class="flashcard-text">${escapeHTML(card.front)}</div>
                <span class="flashcard-flip-hint">${escapeHTML(t('flash.showAnswer'))}</span>
              </div>
              <div class="flashcard-face flashcard-back" aria-hidden="true">
                <span class="flashcard-face-label">${escapeHTML(t('flash.back'))}</span>
                <div class="flashcard-text">${escapeHTML(card.back)}</div>
                ${card.questionId ? `<span class="flashcard-flip-hint">${escapeHTML(t('flash.relatedQuestion'))}</span>` : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="card-footer flashcard-card-footer">
          <span id="flashcardHint">${escapeHTML(t('flash.showAnswer'))}</span>
        </div>
      </div>
    `;
  }

  private getEmptyHTML(): string {
    return `
      <div class="card flashcard-empty" id="flashcardEmpty">
        <div class="card-content">
          <svg class="flashcard-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/></svg>
          <h2 class="flashcard-state-title">${escapeHTML(t('flash.noDueCards'))}</h2>
          <p class="flashcard-state-desc">${escapeHTML(t('flash.noDueCardsDesc'))}</p>
          <div class="flashcard-state-actions">
            <button type="button" class="btn btn-primary" id="btnCreateFromQuestionsEmpty">${escapeHTML(t('flash.createFromQuestion'))}</button>
            <button type="button" class="btn btn-secondary" id="btnCreateManualEmpty">${escapeHTML(t('flash.createManual'))}</button>
          </div>
        </div>
      </div>
    `;
  }

  private getCompletionHTML(): string {
    return `
      <div class="card flashcard-complete" id="flashcardComplete">
        <div class="card-content">
          <svg class="flashcard-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>
          <h2 class="flashcard-state-title">${escapeHTML(t('flash.sessionComplete'))}</h2>
          <p class="flashcard-state-desc">${escapeHTML(t('flash.sessionCompleteDesc', { count: this.session.reviewed }))}</p>
          <div class="flashcard-state-actions">
            <button type="button" class="btn btn-primary" id="btnRestart">${escapeHTML(t('flash.restart'))}</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    const root = this.element;
    if (!root) return;

    root.querySelector('#cardInner')?.addEventListener('click', () => this.toggleFlip());
    root.querySelector<HTMLElement>('#cardInner')?.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFlip();
      }
    });

    root.querySelector('#cardControls')?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-quality]');
      if (!button || button.disabled) return;
      void this.rateCard(sm2RatingForButton(Number(button.dataset.quality)));
    });

    root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      switch (button.id) {
        case 'btnRestart':
          void this.loadData();
          break;
        case 'btnCreateFromQuestions':
        case 'btnCreateFromQuestionsEmpty':
          void this.createFromQuestions();
          break;
        case 'btnCreateManual':
        case 'btnCreateManualEmpty':
          void this.createManual();
          break;
        default:
          break;
      }
    });

    document.addEventListener('keydown', this.handleKeys);
  }

  private toggleFlip(): void {
    if (!this.session.currentCard) return;
    this.session.toggleAnswer();
    this.syncCardFace();
  }

  /** Update the face, ARIA state and rating visibility without re-rendering. */
  private syncCardFace(): void {
    const flipper = this.element?.querySelector<HTMLElement>('#cardInner');
    const inner = this.element?.querySelector<HTMLElement>('#flashcardView');
    const front = this.element?.querySelector<HTMLElement>('.flashcard-front');
    const back = this.element?.querySelector<HTMLElement>('.flashcard-back');
    const hint = this.element?.querySelector<HTMLElement>('#flashcardHint');
    const shown = this.session.showAnswer;

    flipper?.classList.toggle('is-flipped', shown);
    inner?.classList.toggle('flipped', shown);
    flipper?.setAttribute('aria-pressed', String(shown));
    flipper?.setAttribute('aria-label', t(shown ? 'flash.hideAnswer' : 'flash.showAnswer'));
    front?.setAttribute('aria-hidden', String(shown));
    back?.setAttribute('aria-hidden', String(!shown));
    if (hint) hint.textContent = t(shown ? 'flash.hideAnswer' : 'flash.showAnswer');
    this.syncRatingControls();
  }

  private syncRatingControls(): void {
    const controls = this.element?.querySelector<HTMLElement>('#cardControls');
    if (!controls) return;
    controls.hidden = !this.session.showAnswer || !this.session.currentCard;
    controls.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(button => {
      button.disabled = this.isRating;
    });
  }

  private renderBody(): void {
    const container = this.element?.querySelector('#cardContainer');
    if (container) container.innerHTML = this.getBodyHTML();
    this.syncCardFace();
  }

  private renderStats(): void {
    const stats = this.element?.querySelector('#flashcardStats');
    if (stats) stats.innerHTML = this.getStatsHTML();
  }

  private async rateCard(rating: SM2Rating): Promise<void> {
    const card = this.session.currentCard;
    // Ratings are only meaningful once the answer has been revealed.
    if (!card || !this.session.showAnswer || this.isRating) return;

    this.isRating = true;
    this.syncRatingControls();
    try {
      const updated = reviewCard(card, rating, { params: this.sm2Params });
      await flashcardsRepo.put(updated);
      if (card.questionId) {
        await questionsRepo.updateMastery(card.questionId, isCorrectRecall(rating))
          .catch(error => console.error('FlashcardsView: mastery update failed', error));
      }
      if (this.disposed || !this.element) return;

      // Advance the in-memory queue only after the schedule is persisted.
      this.session.rate(rating);
      this.stats = await flashcardsRepo.getStats();
      if (this.disposed || !this.element) return;
      this.renderStats();
      this.renderBody();
    } catch (error) {
      console.error('Failed to rate flashcard', error);
    } finally {
      this.isRating = false;
      this.syncRatingControls();
    }
  }

  private handleKeys = (event: KeyboardEvent): void => {
    if (this.disposed || !this.session.currentCard || !this.element?.isConnected) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      // The flipper handles its own Space/Enter activation.
      if (target.closest('#cardInner')) return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.toggleFlip();
    } else if (/^[1-4]$/.test(event.key)) {
      if (!this.session.showAnswer || this.isRating) return;
      event.preventDefault();
      void this.rateCard(sm2RatingForButton(Number(event.key) - 1));
    }
  };

  private async createFromQuestions(): Promise<void> {
    const questions = await questionsRepo.getAll();
    const flagged = questions.filter(q => q.flags.needsReview || q.flags.bookmarked);

    if (flagged.length === 0) {
      alert(t('flash.createFromFlaggedMissing'));
      return;
    }

    let created = 0;
    for (const question of flagged) {
      const existing = await flashcardsRepo.getByQuestion(question.id);
      if (existing.length > 0) continue;
      const timestamp = nowISO();
      const card: Flashcard = {
        id: generateId(),
        questionId: question.id,
        front: question.stem,
        back: `${question.options[question.correctAnswer[0] ?? 0]?.text ?? ''}\n\n${question.explanation ?? ''}`,
        type: 'qa',
        dueDate: todayISO(),
        interval: 0,
        easeFactor: this.sm2Params.minEaseFactor,
        reps: 0,
        lapses: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await flashcardsRepo.add(card);
      created++;
    }

    alert(
      created > 0
        ? t('flash.createFromFlaggedDone', { count: created })
        : t('flash.allFlaggedHaveCards'),
    );
    if (created > 0) await this.loadData();
  }

  private async createManual(): Promise<void> {
    const front = prompt(t('flash.createManualFrontPrompt'));
    if (!front) return;
    const back = prompt(t('flash.createManualBackPrompt'));
    if (!back) return;

    const timestamp = nowISO();
    const card: Flashcard = {
      id: generateId(),
      front,
      back,
      type: 'qa',
      dueDate: todayISO(),
      interval: 0,
      easeFactor: this.sm2Params.minEaseFactor,
      reps: 0,
      lapses: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await flashcardsRepo.add(card);
    await this.loadData();
  }
}

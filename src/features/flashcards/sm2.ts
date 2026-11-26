// SM-2 spaced-repetition engine for flashcards (Phase 3, Task 6).
//
// Pure, framework-free implementation: the numeric scheduling lives here so it
// can be unit tested and shared by the flashcard view and the Dexie repository.
import type { Flashcard, SM2Params } from '../../shared/types';
import { todayISO } from '../../core/utils';

/** SM-2 quality response. 0-2 = lapse, 3-5 = successful recall. */
export type SM2Rating = 0 | 1 | 2 | 3 | 4 | 5;

export type SM2CardState = Pick<Flashcard, 'interval' | 'easeFactor' | 'reps' | 'lapses'>;

export interface SM2Schedule extends SM2CardState {
  /** YYYY-MM-DD date the card becomes due again. */
  dueDate: string;
}

export interface SM2Options {
  /** Parameter overrides from `settings.flashcardParams`. */
  params?: Partial<SM2Params>;
  /** Reference date (YYYY-MM-DD) used for the next due date. Defaults to today. */
  today?: string;
  /** Timestamp written to `lastReviewed` / `updatedAt` by {@link reviewCard}. */
  now?: string;
}

export const DEFAULT_SM2_PARAMS: SM2Params = {
  initialInterval: 1,
  secondInterval: 6,
  easyBonus: 1.3,
  hardPenalty: 1.2,
  minEaseFactor: 1.3,
  maxInterval: 36500,
  dailyLimit: 50,
};

/** SM-2 never allows the ease factor to drop below 1.3. */
export const ABSOLUTE_MIN_EASE_FACTOR = 1.3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Add whole days to a YYYY-MM-DD string without UTC/local date drift. */
function addDaysToDateString(dateString: string, days: number): string {
  const parts = dateString.split('-').map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculate the next SM-2 schedule for a card.
 *
 * - rating < 3  -> lapses, reps reset, one-day interval, ease penalty
 * - rating >= 3 -> 1 day / 6 days / interval * ease, reps increment, ease update
 */
export function calculateSM2(
  card: SM2CardState,
  rating: SM2Rating,
  options: SM2Options = {},
): SM2Schedule {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw new RangeError(`SM-2 rating must be an integer between 0 and 5, received ${rating}`);
  }

  const params = { ...DEFAULT_SM2_PARAMS, ...options.params };
  const minEaseFactor = Math.max(ABSOLUTE_MIN_EASE_FACTOR, params.minEaseFactor ?? ABSOLUTE_MIN_EASE_FACTOR);

  let { interval, easeFactor, reps, lapses } = card;

  if (rating < 3) {
    // Failed recall (Again/Hard): reset repetitions and re-show the card
    // sooner than a fresh card by applying the configured hard penalty.
    reps = 0;
    interval = params.initialInterval / Math.max(1, params.hardPenalty);
    lapses += 1;
    easeFactor = easeFactor - 0.2 - (2 - rating) * 0.1;
  } else {
    // Successful recall: graduating intervals 1 -> 6 -> interval * ease.
    if (reps === 0) interval = params.initialInterval;
    else if (reps === 1) interval = params.secondInterval;
    else interval = Math.max(1, Math.round(interval * easeFactor));

    // Easy (quality 5) gets the configurable bonus on top of the SM-2 interval.
    if (rating === 5) interval = Math.round(interval * params.easyBonus);

    easeFactor = easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
    reps += 1;
  }

  easeFactor = Math.max(minEaseFactor, round2(easeFactor));
  interval = Math.max(1, Math.min(Math.round(interval), params.maxInterval));

  const today = options.today ?? todayISO();
  return {
    interval,
    easeFactor,
    reps,
    lapses,
    dueDate: addDaysToDateString(today, interval),
  };
}

/** Return a copy of a full flashcard with its SM-2 schedule updated. */
export function reviewCard<T extends Flashcard>(
  card: T,
  rating: SM2Rating,
  options: SM2Options = {},
): T {
  const timestamp = options.now ?? new Date().toISOString();
  return {
    ...card,
    ...calculateSM2(card, rating, options),
    lastReviewed: timestamp,
    updatedAt: timestamp,
  };
}

/** A card is due when its due date is today or earlier (ISO dates sort lexically). */
export function isCardDue(card: Pick<Flashcard, 'dueDate'>, today: string = todayISO()): boolean {
  return card.dueDate <= today;
}

/** Sort cards by due date, oldest first. Does not mutate the input array. */
export function sortByDueDate<T extends Pick<Flashcard, 'dueDate'>>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Filter to due cards, oldest first, optionally capped by `limit`. */
export function selectDueCards<T extends Pick<Flashcard, 'dueDate'>>(
  cards: readonly T[],
  options: { today?: string; limit?: number } = {},
): T[] {
  const today = options.today ?? todayISO();
  const due = sortByDueDate(cards).filter(card => isCardDue(card, today));
  return options.limit === undefined ? due : due.slice(0, options.limit);
}

/**
 * In-memory state for one flashcard study session.
 *
 * Tracks the four fields the UI needs (`currentCard`, `showAnswer`,
 * `sessionCards`, `currentIndex`) and applies SM-2 ratings immutably.
 */
export class FlashcardSession {
  currentCard: Flashcard | null;
  showAnswer = false;
  sessionCards: Flashcard[];
  currentIndex = 0;
  private reviewedCount = 0;

  constructor(cards: Flashcard[] = [], private readonly options: SM2Options = {}) {
    this.sessionCards = sortByDueDate(cards);
    this.currentCard = this.sessionCards[0] ?? null;
  }

  get total(): number {
    return this.sessionCards.length;
  }

  get reviewed(): number {
    return this.reviewedCount;
  }

  get isComplete(): boolean {
    return this.currentIndex >= this.sessionCards.length;
  }

  /** Replace the queue and restart from the oldest due card. */
  load(cards: Flashcard[]): void {
    this.sessionCards = sortByDueDate(cards);
    this.currentIndex = 0;
    this.reviewedCount = 0;
    this.showAnswer = false;
    this.currentCard = this.sessionCards[0] ?? null;
  }

  revealAnswer(): void {
    if (this.currentCard) this.showAnswer = true;
  }

  hideAnswer(): void {
    this.showAnswer = false;
  }

  toggleAnswer(): void {
    if (this.showAnswer) this.hideAnswer();
    else this.revealAnswer();
  }

  /** Move to the next card without rating the current one. */
  next(): Flashcard | null {
    this.currentIndex += 1;
    this.currentCard = this.sessionCards[this.currentIndex] ?? null;
    this.showAnswer = false;
    return this.currentCard;
  }

  /**
   * Apply a rating to the current card, store the updated card back into the
   * queue and advance. Returns the reviewed card so callers can persist it.
   */
  rate(rating: SM2Rating): Flashcard | null {
    if (!this.currentCard) return null;
    const updated = reviewCard(this.currentCard, rating, this.options);
    this.sessionCards[this.currentIndex] = updated;
    this.reviewedCount += 1;
    this.next();
    return updated;
  }

  /** Restart the same queue from the beginning. */
  reset(): void {
    this.currentIndex = 0;
    this.reviewedCount = 0;
    this.showAnswer = false;
    this.currentCard = this.sessionCards[0] ?? null;
  }
}

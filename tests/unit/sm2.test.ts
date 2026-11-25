/**
 * Flashcards SM-2 engine contract (Phase 3, Task 6).
 * Pins the scheduling maths, ease-factor floor, due-card selection and the
 * in-memory session state independently of the DOM-heavy FlashcardsView.
 */
import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MIN_EASE_FACTOR,
  FlashcardSession,
  calculateSM2,
  isCardDue,
  reviewCard,
  selectDueCards,
  sortByDueDate,
  type SM2CardState,
} from '../../src/features/flashcards/sm2';
import type { Flashcard } from '../../src/shared/types';

const TODAY = '2026-01-10';

function state(overrides: Partial<SM2CardState> = {}): SM2CardState {
  return { interval: 0, easeFactor: 2.5, reps: 0, lapses: 0, ...overrides };
}

function card(id: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    front: `Front ${id}`,
    back: `Back ${id}`,
    type: 'qa',
    dueDate: TODAY,
    interval: 0,
    easeFactor: 2.5,
    reps: 0,
    lapses: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('calculateSM2', () => {
  it('schedules a new card one day out and increments reps on a good rating', () => {
    expect(calculateSM2(state(), 4, { today: TODAY })).toEqual({
      interval: 1,
      easeFactor: 2.5,
      reps: 1,
      lapses: 0,
      dueDate: '2026-01-11',
    });
  });

  it('uses the 6-day second interval for reps === 1', () => {
    expect(calculateSM2(state({ interval: 1, reps: 1 }), 4, { today: TODAY })).toEqual({
      interval: 6,
      easeFactor: 2.5,
      reps: 2,
      lapses: 0,
      dueDate: '2026-01-16',
    });
  });

  it('multiplies the interval by the ease factor for mature cards', () => {
    expect(calculateSM2(state({ interval: 6, easeFactor: 2.5, reps: 2 }), 4, { today: TODAY })).toEqual({
      interval: 15,
      easeFactor: 2.5,
      reps: 3,
      lapses: 0,
      dueDate: '2026-01-25',
    });
  });

  it.each([
    { rating: 3 as const, easeFactor: 2.36 },
    { rating: 4 as const, easeFactor: 2.5 },
    { rating: 5 as const, easeFactor: 2.6 },
  ])('updates the ease factor for rating $rating', ({ rating, easeFactor }) => {
    expect(calculateSM2(state(), rating, { today: TODAY }).easeFactor).toBe(easeFactor);
  });

  it.each([
    { rating: 0 as const, easeFactor: 2.1 },
    { rating: 1 as const, easeFactor: 2.2 },
    { rating: 2 as const, easeFactor: 2.3 },
  ])('penalizes, resets and logs a lapse for failing rating $rating', ({ rating, easeFactor }) => {
    const result = calculateSM2(state({ interval: 30, easeFactor: 2.5, reps: 7, lapses: 2 }), rating, {
      today: TODAY,
    });
    expect(result).toEqual({
      interval: 1,
      easeFactor,
      reps: 0,
      lapses: 3,
      dueDate: '2026-01-11',
    });
  });

  it('clamps the ease factor to the 1.3 floor', () => {
    const result = calculateSM2(state({ easeFactor: ABSOLUTE_MIN_EASE_FACTOR }), 0, { today: TODAY });
    expect(result.easeFactor).toBe(1.3);
    expect(ABSOLUTE_MIN_EASE_FACTOR).toBe(1.3);
  });

  it('respects a higher configured minimum ease factor', () => {
    expect(
      calculateSM2(state({ easeFactor: 1.6 }), 0, { today: TODAY, params: { minEaseFactor: 1.8 } })
        .easeFactor,
    ).toBe(1.8);
  });

  it('respects initial/second interval overrides and the max interval cap', () => {
    expect(
      calculateSM2(state(), 4, { today: TODAY, params: { initialInterval: 2, secondInterval: 4 } })
        .interval,
    ).toBe(2);
    expect(
      calculateSM2(state({ interval: 100, reps: 2 }), 4, { today: TODAY, params: { maxInterval: 10 } })
        .interval,
    ).toBe(10);
  });

  it('rejects ratings outside 0-5', () => {
    expect(() => calculateSM2(state(), -1 as 0, { today: TODAY })).toThrow(RangeError);
    expect(() => calculateSM2(state(), 6 as 5, { today: TODAY })).toThrow(RangeError);
    expect(() => calculateSM2(state(), 2.5 as 2, { today: TODAY })).toThrow(RangeError);
  });
});

describe('reviewCard', () => {
  it('returns a new full card with schedule and review timestamps', () => {
    const original = card('c1');
    const updated = reviewCard(original, 5, { today: TODAY, now: '2026-01-10T07:00:00.000Z' });
    expect(updated).not.toBe(original);
    expect(updated).toMatchObject({
      id: 'c1',
      front: 'Front c1',
      back: 'Back c1',
      interval: 1,
      easeFactor: 2.6,
      reps: 1,
      lapses: 0,
      dueDate: '2026-01-11',
      lastReviewed: '2026-01-10T07:00:00.000Z',
      updatedAt: '2026-01-10T07:00:00.000Z',
    });
    expect(original.reps).toBe(0);
  });
});

describe('due card selection', () => {
  const cards = [
    card('future', { dueDate: '2026-01-20' }),
    card('oldest', { dueDate: '2026-01-05' }),
    card('today', { dueDate: TODAY }),
    card('middle', { dueDate: '2026-01-08' }),
  ];

  it('treats today and earlier dates as due', () => {
    expect(isCardDue(cards[2]!, TODAY)).toBe(true);
    expect(isCardDue(cards[1]!, TODAY)).toBe(true);
    expect(isCardDue(cards[0]!, TODAY)).toBe(false);
  });

  it('sorts oldest first without mutating the input', () => {
    const sorted = sortByDueDate(cards);
    expect(sorted.map(c => c.id)).toEqual(['oldest', 'middle', 'today', 'future']);
    expect(cards.map(c => c.id)).toEqual(['future', 'oldest', 'today', 'middle']);
  });

  it('filters due cards oldest first and applies the limit', () => {
    expect(selectDueCards(cards, { today: TODAY }).map(c => c.id)).toEqual([
      'oldest',
      'middle',
      'today',
    ]);
    expect(selectDueCards(cards, { today: TODAY, limit: 2 }).map(c => c.id)).toEqual([
      'oldest',
      'middle',
    ]);
  });
});

describe('FlashcardSession', () => {
  const options = { today: TODAY, now: '2026-01-10T07:00:00.000Z' };
  const cards = [
    card('later', { dueDate: '2026-01-09' }),
    card('first', { dueDate: '2026-01-01' }),
    card('second', { dueDate: '2026-01-05' }),
  ];

  it('starts on the oldest due card with the answer hidden', () => {
    const session = new FlashcardSession(cards, options);
    expect(session.currentCard?.id).toBe('first');
    expect(session.sessionCards.map(c => c.id)).toEqual(['first', 'second', 'later']);
    expect(session.showAnswer).toBe(false);
    expect(session.currentIndex).toBe(0);
    expect(session.total).toBe(3);
    expect(session.isComplete).toBe(false);
  });

  it('toggles answer visibility', () => {
    const session = new FlashcardSession(cards, options);
    session.toggleAnswer();
    expect(session.showAnswer).toBe(true);
    session.hideAnswer();
    expect(session.showAnswer).toBe(false);
  });

  it('rates the current card, stores the update and advances', () => {
    const session = new FlashcardSession(cards, options);
    const reviewed = session.rate(4);
    expect(reviewed?.id).toBe('first');
    expect(reviewed).toMatchObject({ reps: 1, interval: 1, dueDate: '2026-01-11' });
    expect(session.sessionCards[0]?.reps).toBe(1);
    expect(session.currentCard?.id).toBe('second');
    expect(session.currentIndex).toBe(1);
    expect(session.reviewed).toBe(1);
    expect(session.showAnswer).toBe(false);
  });

  it('finishes the queue and can restart it', () => {
    const session = new FlashcardSession(cards, options);
    session.rate(5);
    session.rate(3);
    session.rate(2);
    expect(session.isComplete).toBe(true);
    expect(session.currentCard).toBeNull();
    expect(session.reviewed).toBe(3);
    expect(session.rate(4)).toBeNull();
    session.reset();
    expect(session.currentCard?.id).toBe('first');
    expect(session.reviewed).toBe(0);
  });
});

// Flashcards Repository
import { db } from '../schema';
import type { Flashcard, SM2Params } from '../../shared/types';
import {
  DEFAULT_SM2_PARAMS,
  reviewCard,
  sortByDueDate,
  type SM2Options,
  type SM2Rating,
} from '../../features/flashcards/sm2';
import { toCSV } from '../../core/utils';

/** Flashcards CSV for analytics exports (Phase 4, Task 8). */
export function flashcardsToCSV(cards: readonly Flashcard[]): string {
  const rows: string[][] = [[
    'id', 'questionId', 'front', 'back', 'type',
    'dueDate', 'interval', 'easeFactor', 'reps', 'lapses',
  ]];

  for (const c of cards) {
    rows.push([
      c.id,
      c.questionId ?? '',
      c.front ?? '',
      c.back ?? '',
      c.type,
      c.dueDate,
      String(c.interval),
      String(c.easeFactor),
      String(c.reps),
      String(c.lapses),
    ]);
  }

  return toCSV(rows);
}

function cardsForQuestion(questionId: string): Promise<Flashcard[]> {
  return db.flashcards.where('questionId').equals(questionId).toArray();
}

export const flashcardsRepo = {
  async getAll(): Promise<Flashcard[]> {
    return db.flashcards.orderBy('dueDate').toArray();
  },

  async getById(id: string): Promise<Flashcard | undefined> {
    return db.flashcards.get(id);
  },

  /** Analytics CSV of every flashcard, due-date order. */
  async exportCSV(): Promise<string> {
    return flashcardsToCSV(await this.getAll());
  },

  async add(card: Flashcard): Promise<string> {
    await db.flashcards.add(card);
    return card.id;
  },

  async put(card: Flashcard): Promise<string> {
    await db.flashcards.put(card);
    return card.id;
  },

  async delete(id: string): Promise<void> {
    await db.flashcards.delete(id);
  },

  async bulkPut(cards: Flashcard[]): Promise<Flashcard[]> {
    await db.flashcards.bulkPut(cards);
    return cards;
  },

  // Get due cards for study session — oldest due date first, capped by the
  // configured daily limit (50 unless the user overrides it in settings).
  async getDueCards(limit = DEFAULT_SM2_PARAMS.dailyLimit ?? 50): Promise<Flashcard[]> {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const due = await db.flashcards
      .where('dueDate')
      .belowOrEqual(today)
      .toArray();
    return sortByDueDate(due).slice(0, limit);
  },

  // Apply an SM-2 rating to a stored card and persist the new schedule
  async applyRating(
    id: string,
    rating: SM2Rating,
    options: SM2Options = {},
  ): Promise<Flashcard | undefined> {
    const card = await db.flashcards.get(id);
    if (!card) return undefined;
    const updated = reviewCard(card, rating, options);
    await db.flashcards.put(updated);
    return updated;
  },

  async getDueCount(): Promise<number> {
    const today = new Date().toISOString().split('T')[0] ?? '';
    return db.flashcards.where('dueDate').belowOrEqual(today).count();
  },

  async getNewCards(limit = 20): Promise<Flashcard[]> {
    return db.flashcards
      .where('reps')
      .equals(0)
      .limit(limit)
      .toArray();
  },

  async getLearningCards(limit = 50): Promise<Flashcard[]> {
    return db.flashcards
      .where('reps')
      .above(0)
      .and(c => c.interval < 21)
      .limit(limit)
      .toArray();
  },

  async getReviewCards(limit = 50): Promise<Flashcard[]> {
    const today = new Date().toISOString().split('T')[0] ?? '';
    return db.flashcards
      .where('dueDate')
      .belowOrEqual(today)
      .and(c => c.interval >= 21)
      .limit(limit)
      .toArray();
  },

  async getMatureCards(limit = 50): Promise<Flashcard[]> {
    return db.flashcards
      .where('interval')
      .above(21)
      .and(c => c.reps > 0)
      .limit(limit)
      .toArray();
  },

  async getStats(): Promise<{
    due: number;
    new: number;
    learning: number;
    review: number;
    mature: number;
  }> {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const all = await db.flashcards.toArray();
    
    return {
      due: all.filter(c => c.dueDate <= today).length,
      new: all.filter(c => c.reps === 0).length,
      learning: all.filter(c => c.reps > 0 && c.interval < 21).length,
      review: all.filter(c => c.interval >= 21 && c.reps <= 8).length,
      mature: all.filter(c => c.interval > 21 && c.reps > 8).length,
    };
  },

  async getByQuestion(questionId: string): Promise<Flashcard[]> {
    return cardsForQuestion(questionId);
  },

  /** Explicit alias for getByQuestion(), matching the repository naming convention. */
  async getByQuestionId(questionId: string): Promise<Flashcard[]> {
    return cardsForQuestion(questionId);
  },

  async getCount(): Promise<number> {
    return db.flashcards.count();
  },
};
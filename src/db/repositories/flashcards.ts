// Flashcards Repository
import { db } from '../schema';
import type { Flashcard, SM2Params } from '../../shared/types';

export const flashcardsRepo = {
  async getAll(): Promise<Flashcard[]> {
    return db.flashcards.orderBy('dueDate').toArray();
  },

  async getById(id: string): Promise<Flashcard | undefined> {
    return db.flashcards.get(id);
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

  // Get due cards for study session
  async getDueCards(limit = 50): Promise<Flashcard[]> {
    const today = new Date().toISOString().split('T')[0] ?? '';
    return db.flashcards
      .where('dueDate')
      .belowOrEqual(today)
      .limit(limit)
      .toArray();
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
    return db.flashcards.where('questionId').equals(questionId).toArray();
  },

  async getCount(): Promise<number> {
    return db.flashcards.count();
  },
};
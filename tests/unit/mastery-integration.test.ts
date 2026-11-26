/**
 * Mastery integration contract (Phase 3, Task 8).
 * The DOM-heavy views are not instantiated; the rating mapping and the
 * repository batch path they both rely on are exercised directly.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/schema', () => ({
  db: {
    questions: {
      add: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      toArray: vi.fn(),
      count: vi.fn(),
      bulkAdd: vi.fn(),
      bulkPut: vi.fn(),
      bulkDelete: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
    },
  },
}));

import { questionsRepo } from '../../src/db/repositories/questions';
import { isCorrectRecall, sm2RatingForButton } from '../../src/views/FlashcardsView';
import { masteryUpdatesFromAnswers } from '../../src/views/MockExamView';

describe('flashcard rating to mastery mapping', () => {
  it('counts Good/Easy as correct and Again/Hard as incorrect', () => {
    // Visible buttons: Again(1), Hard(2), Good(3), Easy(4). The SM-2 engine
    // stores them as quality 1, 2, 4 and 5 respectively.
    expect(isCorrectRecall(1)).toBe(false); // Again
    expect(isCorrectRecall(2)).toBe(false); // Hard
    expect(isCorrectRecall(3)).toBe(false); // unassigned lapse rating
    expect(isCorrectRecall(4)).toBe(true); // Good
    expect(isCorrectRecall(5)).toBe(true); // Easy
  });

  it('maps the four rating buttons to mastery outcomes', () => {
    const outcomes = [0, 1, 2, 3].map(button => isCorrectRecall(sm2RatingForButton(button)));
    expect(outcomes).toEqual([false, false, true, true]);
  });
});

describe('mock exam answers to mastery mapping', () => {
  it('emits one update per answered question, preserving correctness', () => {
    const answers = new Map([
      ['q-correct', { isCorrect: true }],
      ['q-wrong', { isCorrect: false }],
    ]);
    expect(masteryUpdatesFromAnswers(answers)).toEqual([
      { questionId: 'q-correct', isCorrect: true },
      { questionId: 'q-wrong', isCorrect: false },
    ]);
  });

  it('emits nothing when no question was answered', () => {
    expect(masteryUpdatesFromAnswers(new Map())).toEqual([]);
  });
});

describe('batch mastery updates', () => {
  it('updates every answered question even if one row fails', async () => {
    const update = vi.spyOn(questionsRepo, 'updateMastery');
    update.mockImplementation(async questionId => {
      if (questionId === 'bad') throw new Error('db failure');
    });

    await expect(questionsRepo.updateMasteryForAnswers([
      { questionId: 'good-1', isCorrect: true },
      { questionId: 'bad', isCorrect: false },
      { questionId: 'good-2', isCorrect: false },
    ])).rejects.toThrow('db failure');

    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenNthCalledWith(1, 'good-1', true);
    expect(update).toHaveBeenNthCalledWith(2, 'bad', false);
    expect(update).toHaveBeenNthCalledWith(3, 'good-2', false);
    update.mockRestore();
  });

  it('does nothing for an empty answer set', async () => {
    const update = vi.spyOn(questionsRepo, 'updateMastery');
    await questionsRepo.updateMasteryForAnswers([]);
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });
});

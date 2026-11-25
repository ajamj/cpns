/**
 * Mock-exam question selection: weighted topic allocation, difficulty mix,
 * shuffling and uniqueness. Dexie is replaced with an in-memory table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty, Question, TopicCode } from '../../src/shared/types';

const { store } = vi.hoisted(() => ({
  store: new Map<string, Question>(),
}));

vi.mock('../../src/db/schema', () => ({
  db: {
    questions: {
      async toArray(): Promise<Question[]> {
        return Array.from(store.values()).map(q => structuredClone(q));
      },
    },
  },
}));

import { questionsRepo, selectWeightedQuestions } from '../../src/db/repositories/questions';

function makeQuestion(id: string, topicCode: TopicCode, difficulty: Difficulty = 2): Question {
  return {
    id,
    topicCode,
    stem: `Soal ${id}`,
    options: [
      { id: `${id}-a`, text: 'A', isCorrect: true },
      { id: `${id}-b`, text: 'B', isCorrect: false },
    ],
    correctAnswer: [0],
    difficulty,
    tags: [],
    flags: { bookmarked: false, needsReview: false, disputed: false },
    metadata: { createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', version: 1, author: 'import' },
    statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
  };
}

async function seed(questions: Question[]): Promise<void> {
  store.clear();
  for (const q of questions) store.set(q.id, structuredClone(q));
}

const mixedDifficulty = (): Difficulty[] => [1, 1, 1, 2, 2, 2, 2, 3, 3, 3];

describe('mock exam weighted selection', () => {
  beforeEach(async () => {
    const questions: Question[] = [];
    for (let topic = 1; topic <= 9; topic++) {
      mixedDifficulty().forEach((difficulty, index) => {
        questions.push(makeQuestion(`um${topic}-${index}`, `UM-0${topic}` as TopicCode, difficulty));
      });
    }
    for (let topic = 1; topic <= 12; topic++) {
      mixedDifficulty().forEach((difficulty, index) => {
        questions.push(makeQuestion(`kh${topic}-${index}`, `KH-0${topic}` as TopicCode, difficulty));
      });
    }
    await seed(questions);
  });

  it('applies default topic weights (UM=1, KH=1.5) proportionally', async () => {
    const selected = await questionsRepo.selectForMockExam({
      questionCount: 60,
      topicCodes: [],
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
      topicWeights: {},
      random: () => 0.5,
    });

    expect(selected).toHaveLength(60);
    expect(selected.filter(q => q.topicCode.startsWith('UM-'))).toHaveLength(18);
    expect(selected.filter(q => q.topicCode.startsWith('KH-'))).toHaveLength(42);
    expect(new Set(selected.map(q => q.id)).size).toBe(60);
  });

  it('honours topicCodes and explicit weights, excluding zero-weight topics', async () => {
    const selected = await questionsRepo.selectForMockExam({
      questionCount: 7,
      topicCodes: ['UM-01', 'UM-02', 'KH-01'],
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
      topicWeights: { 'UM-01': 1, 'UM-02': 1, 'KH-01': 1.5 },
      random: () => 0.5,
    });

    expect(selected).toHaveLength(7);
    expect(selected.filter(q => q.topicCode === 'UM-01')).toHaveLength(2);
    expect(selected.filter(q => q.topicCode === 'UM-02')).toHaveLength(2);
    expect(selected.filter(q => q.topicCode === 'KH-01')).toHaveLength(3);
  });

  it('splits each topic by the requested difficulty mix', async () => {
    const pool: Question[] = [];
    for (let index = 0; index < 15; index++) pool.push(makeQuestion(`easy-${index}`, 'UM-01', 1));
    for (let index = 0; index < 15; index++) pool.push(makeQuestion(`medium-${index}`, 'UM-01', 2));
    for (let index = 0; index < 15; index++) pool.push(makeQuestion(`hard-${index}`, 'UM-01', 3));
    await seed(pool);

    const selected = await questionsRepo.selectForMockExam({
      questionCount: 20,
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
      random: () => 0.5,
    });

    expect(selected).toHaveLength(20);
    expect(selected.filter(q => q.difficulty === 1)).toHaveLength(6);
    expect(selected.filter(q => q.difficulty === 2)).toHaveLength(10);
    expect(selected.filter(q => q.difficulty === 3)).toHaveLength(4);
  });

  it('never returns duplicates and caps at the available pool size', async () => {
    await seed(Array.from({ length: 8 }, (_, index) => makeQuestion(`q-${index}`, 'UM-01', 2)));

    const selected = await questionsRepo.selectForMockExam({
      questionCount: 100,
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
      random: () => 0.5,
    });

    expect(selected).toHaveLength(8);
    expect(new Set(selected.map(q => q.id)).size).toBe(8);
  });

  it('skips soft-deleted and malformed rows', async () => {
    const invalid = makeQuestion('deleted', 'UM-01', 2);
    invalid.deletedAt = '2024-06-01T00:00:00.000Z';
    const noOptions = makeQuestion('no-options', 'UM-01', 2);
    noOptions.options = [];
    await seed([makeQuestion('ok-1', 'UM-01', 2), makeQuestion('ok-2', 'UM-01', 2), invalid, noOptions]);

    const selected = await questionsRepo.selectForMockExam({
      questionCount: 10,
      difficultyMix: { 1: 0, 2: 100, 3: 0 },
      random: () => 0.5,
    });

    expect(selected.map(q => q.id).sort()).toEqual(['ok-1', 'ok-2']);
  });

  it('randomises order within buckets and the final exam', () => {
    const pool = Array.from({ length: 6 }, (_, index) => makeQuestion(`q-${index}`, 'UM-01', 2));
    const selected = selectWeightedQuestions(pool, {
      questionCount: 6,
      difficultyMix: { 1: 0, 2: 100, 3: 0 },
      random: () => 0,
    });

    expect(new Set(selected.map(q => q.id)).size).toBe(6);
    expect(selected.map(q => q.id)).not.toEqual(pool.map(q => q.id));
  });
});

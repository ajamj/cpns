/**
 * Data export contracts (Phase 4, Task 8).
 * The four repository CSV transforms must stay round-trip safe with `parseCSV`
 * even when stems, explanations or card text contain commas, quotes and
 * newlines (risk R-3 / exit criterion EC-4).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Attempt, Flashcard, Question, Session } from '../../src/shared/types';
import { parseCSV } from '../../src/core/utils';

const { rows } = vi.hoisted(() => ({
  rows: {
    questions: [] as Question[],
    sessions: [] as Session[],
    flashcards: [] as Flashcard[],
    attempts: [] as Attempt[],
  },
}));

vi.mock('../../src/db/schema', () => ({
  db: {
    questions: {
      async toArray() { return rows.questions.map(q => structuredClone(q)); },
    },
    sessions: {
      orderBy() {
        return { reverse: () => ({ toArray: async () => rows.sessions.map(s => structuredClone(s)) }) };
      },
    },
    flashcards: {
      orderBy() {
        return { toArray: async () => rows.flashcards.map(c => structuredClone(c)) };
      },
    },
    attempts: {
      async toArray() { return rows.attempts.map(a => structuredClone(a)); },
    },
  },
}));

import { questionsToExportCSV, questionsRepo } from '../../src/db/repositories/questions';
import { sessionsToCSV, sessionsRepo } from '../../src/db/repositories/sessions';
import { flashcardsToCSV, flashcardsRepo } from '../../src/db/repositories/flashcards';
import { attemptsToCSV, attemptsRepo } from '../../src/db/repositories/attempts';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    topicCode: 'UM-01',
    stem: 'Apa ibukota Indonesia?',
    options: [
      { id: 'o-1', text: 'Jakarta', isCorrect: true },
      { id: 'o-2', text: 'Bandung', isCorrect: false },
    ],
    correctAnswer: [0],
    explanation: 'Jakarta adalah ibukota.',
    difficulty: 1,
    source: 'BMKG 2024',
    tags: ['geografi', 'ibukota'],
    flags: { bookmarked: false, needsReview: false, disputed: false },
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      version: 3,
      author: 'user',
    },
    statistics: {
      totalAttempts: 4,
      correctAttempts: 3,
      avgTimeMs: 12500,
      lastAttemptedAt: '2024-01-03T00:00:00.000Z',
      masteryLevel: 2,
    },
    ...overrides,
  };
}

describe('questions CSV export', () => {
  it('includes metadata and every statistic column', () => {
    const parsed = parseCSV(questionsToExportCSV([makeQuestion()]));
    const headers = parsed[0]!;
    for (const column of [
      'id', 'topicCode', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE',
      'correctAnswer', 'explanation', 'difficulty', 'source', 'tags',
      'metadata.createdAt', 'metadata.version',
      'statistics.totalAttempts', 'statistics.correctAttempts', 'statistics.avgTimeMs',
      'statistics.lastAttemptedAt', 'statistics.masteryLevel',
    ]) {
      expect(headers).toContain(column);
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, parsed[1]![index]]));
    expect(row['metadata.createdAt']).toBe('2024-01-01T00:00:00.000Z');
    expect(row['metadata.version']).toBe('3');
    expect(row['statistics.totalAttempts']).toBe('4');
    expect(row['statistics.correctAttempts']).toBe('3');
    expect(row['statistics.avgTimeMs']).toBe('12500');
    expect(row['statistics.masteryLevel']).toBe('2');
    expect(row['optionA']).toBe('Jakarta');
    expect(row['optionC']).toBe('');
  });

  it('round-trips commas, quotes and newlines in stems', () => {
    const stem = 'Suhu "panas", tekanan\nrendah?';
    const parsed = parseCSV(questionsToExportCSV([makeQuestion({ stem })]));
    expect(parsed[1]![2]).toBe(stem);
  });
});

describe('sessions CSV export', () => {
  const session: Session = {
    id: 's-1',
    mode: 'mock-exam',
    startedAt: '2024-02-01T10:00:00.000Z',
    completedAt: '2024-02-01T10:30:00.000Z',
    config: {},
    topicCodes: ['UM-01', 'KH-01'],
    summary: {
      totalQuestions: 20,
      answeredQuestions: 20,
      correctAnswers: 15,
      scorePercent: 75,
      timeSpentMs: 1500000,
      perTopic: {},
    },
  };

  it('exports the required columns with recorded duration in milliseconds', () => {
    const parsed = parseCSV(sessionsToCSV([session]));
    expect(parsed[0]).toEqual([
      'id', 'mode', 'startedAt', 'completedAt', 'duration',
      'totalQuestions', 'correctAnswers', 'scorePercent', 'topicCodes',
    ]);
    expect(parsed[1]![4]).toBe('1500000');
    expect(parsed[1]![5]).toBe('20');
    expect(parsed[1]![7]).toBe('75');
    expect(parsed[1]![8]).toBe('UM-01;KH-01');
  });

  it('falls back to timestamp elapsed time and never emits NaN', () => {
    const unfinished = parseCSV(sessionsToCSV([{ ...session, completedAt: undefined, summary: undefined }]));
    expect(unfinished[1]![4]).toBe('0');
  });
});

describe('flashcards CSV export', () => {
  it('round-trips quoted card text', () => {
    const card: Flashcard = {
      id: 'f-1',
      questionId: 'q-1',
      front: '"Apa", suhu udara?',
      back: 'Suhu\n24°C',
      type: 'qa',
      dueDate: '2024-03-01',
      interval: 3,
      easeFactor: 2.5,
      reps: 2,
      lapses: 1,
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
    };
    const parsed = parseCSV(flashcardsToCSV([card]));
    expect(parsed[0]).toEqual([
      'id', 'questionId', 'front', 'back', 'type', 'dueDate',
      'interval', 'easeFactor', 'reps', 'lapses',
    ]);
    expect(parsed[1]![2]).toBe('"Apa", suhu udara?');
    expect(parsed[1]![3]).toBe('Suhu\n24°C');
  });
});

describe('attempts CSV export', () => {
  it('exports answer letters and boolean flags', () => {
    const attempt: Attempt = {
      sessionId: 's-1',
      questionId: 'q-1',
      userAnswer: [0, 2],
      isCorrect: true,
      timeMs: 4321,
      timestamp: '2024-02-01T10:00:05.000Z',
      flagged: false,
      markedForReview: false,
    };
    const parsed = parseCSV(attemptsToCSV([attempt]));
    expect(parsed[0]).toEqual([
      'sessionId', 'questionId', 'userAnswer', 'isCorrect', 'timeMs', 'timestamp',
    ]);
    expect(parsed[1]).toEqual([
      's-1', 'q-1', 'A;C', 'true', '4321', '2024-02-01T10:00:05.000Z',
    ]);
  });
});

describe('repository export methods', () => {
  it('reads from the repositories and produces parseable CSV', async () => {
    rows.questions = [makeQuestion()];
    rows.attempts = [{
      sessionId: 's-1', questionId: 'q-1', userAnswer: [0], isCorrect: false,
      timeMs: 100, timestamp: '2024-02-01T10:00:05.000Z', flagged: false, markedForReview: false,
    }];
    rows.flashcards = [];
    rows.sessions = [];

    expect(parseCSV(await questionsRepo.exportCSV()).length).toBe(2);
    expect(parseCSV(await sessionsRepo.exportCSV()).length).toBe(1);
    expect(parseCSV(await flashcardsRepo.exportCSV()).length).toBe(1);
    expect(parseCSV(await attemptsRepo.exportCSV()).length).toBe(2);
  });
});

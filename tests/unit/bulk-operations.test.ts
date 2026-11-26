/**
 * Bulk operation contract tests (Phase 2, Task 5).
 * These pin the pure tag/flag/export transforms used by the bulk action bar:
 * add vs replace tags, flag patches that preserve unrelated flags, metadata
 * versioning, and CSV escaping for selected questions.
 */
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/shared/types';
import {
  applyBulkUpdate,
  applyFlagPatch,
  mergeTags,
  questionsToCSV,
} from '../../src/features/questions/bulk-operations';
import { eventBus, emitQuestionBulkUpdated } from '../../src/core/events';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    topicCode: 'UM-01',
    stem: 'Apa ibukota Indonesia?',
    options: [
      { id: 'o-1', text: 'Jakarta', isCorrect: true },
      { id: 'o-2', text: 'Bandung, Jawa Barat', isCorrect: false },
    ],
    correctAnswer: [0],
    explanation: 'Jakarta adalah ibukota.',
    difficulty: 1,
    source: 'BMKG 2024',
    tags: ['geografi', 'ibukota'],
    flags: { bookmarked: true, needsReview: false, disputed: false },
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 3,
      author: 'user',
    },
    statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
    versions: [],
    ...overrides,
  };
}

describe('bulk tag transforms', () => {
  it('adds unique tags without dropping existing ones', () => {
    expect(mergeTags(['geografi', 'ibukota'], ['  ibukota ', 'cuaca'], 'add'))
      .toEqual(['geografi', 'ibukota', 'cuaca']);
  });

  it('replaces all tags in retag mode', () => {
    expect(mergeTags(['geografi'], ['cuaca', 'cuaca', ''], 'replace')).toEqual(['cuaca']);
  });
});

describe('bulk flag transforms', () => {
  it('patches only the requested flag', () => {
    const flags = applyFlagPatch(
      { bookmarked: true, needsReview: false, disputed: true },
      { bookmarked: false }
    );
    expect(flags).toEqual({ bookmarked: false, needsReview: false, disputed: true });
  });

  it('clears needsReview without touching bookmark or disputed', () => {
    const flags = applyFlagPatch(
      { bookmarked: true, needsReview: true, disputed: true },
      { needsReview: false }
    );
    expect(flags).toEqual({ bookmarked: true, needsReview: false, disputed: true });
  });
});

describe('applyBulkUpdate', () => {
  const now = '2026-01-02T03:04:05.000Z';

  it('updates tags and metadata without mutating the original', () => {
    const original = makeQuestion();
    const next = applyBulkUpdate(original, { kind: 'tags', mode: 'add', tags: ['cuaca'] }, now);
    expect(next.tags).toEqual(['geografi', 'ibukota', 'cuaca']);
    expect(next.metadata.version).toBe(4);
    expect(next.metadata.updatedAt).toBe(now);
    expect(original.tags).toEqual(['geografi', 'ibukota']);
    expect(original.metadata.version).toBe(3);
  });

  it('keeps versions, statistics and unrelated flags intact', () => {
    const versions = [makeQuestion({ id: 'old' })];
    const next = applyBulkUpdate(
      makeQuestion({ versions, flags: { bookmarked: true, needsReview: true, disputed: false } }),
      { kind: 'flags', patch: { needsReview: false } },
      now
    );
    expect(next.versions).toBe(versions);
    expect(next.statistics).toEqual(makeQuestion().statistics);
    expect(next.flags).toEqual({ bookmarked: true, needsReview: false, disputed: false });
  });
});

describe('questionsToCSV', () => {
  it('quotes comma-containing cells and pads option columns A–E', () => {
    const csv = questionsToCSV([makeQuestion()]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('optionA,optionB');
    expect(lines[1]).toContain('"Bandung, Jawa Barat"');
    expect(lines[1]).toContain(',,,'); // unused options D/E stay empty
  });
});

describe('bulk completion event', () => {
  it('emits one question:bulkUpdated event with the whole batch', () => {
    const batches: Question[][] = [];
    const listener = (questions: Question[]): void => { batches.push(questions); };
    eventBus.on('question:bulkUpdated', listener);
    try {
      const questions = [makeQuestion(), makeQuestion({ id: 'q-2' })];
      emitQuestionBulkUpdated(questions);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toBe(questions);
      expect(batches[0]?.map(q => q.id)).toEqual(['q-1', 'q-2']);
    } finally {
      eventBus.off('question:bulkUpdated', listener);
    }
  });
});

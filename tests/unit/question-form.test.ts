/**
 * Question form contract tests (Phase 2, Task 2).
 * The DOM/markdown editor is covered by Playwright; these tests pin the pure
 * draft rules that back the CRUD modal: validation, option bounds, correct
 * answer indexing and metadata preservation on edit.
 */
import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/shared/types';
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  correctIndices,
  createEmptyDraft,
  draftFromQuestion,
  draftToQuestion,
  parseTags,
  validateQuestionDraft,
} from '../../src/features/questions/question-form';

const VALID_CODES = new Set(['UM-01', 'KH-03', 'TK-01']);

function validDraft() {
  const draft = createEmptyDraft();
  draft.topicCode = 'UM-01';
  draft.stem = 'Apa ibukota Indonesia?';
  draft.options[0]!.text = 'Jakarta';
  draft.options[0]!.isCorrect = true;
  draft.options[1]!.text = 'Bandung';
  return draft;
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    topicCode: 'UM-01',
    stem: '  Apa ibukota Indonesia?  ',
    options: [
      { id: 'o-1', text: 'Jakarta', isCorrect: true },
      { id: 'o-2', text: 'Bandung', isCorrect: false },
    ],
    correctAnswer: [0],
    explanation: ' Jakarta ',
    difficulty: 1,
    source: ' BMKG 2024 ',
    tags: ['geografi', ' ibukota ', 'geografi'],
    flags: { bookmarked: true, needsReview: false, disputed: false },
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 3,
      author: 'user',
    },
    statistics: { totalAttempts: 4, correctAttempts: 2, avgTimeMs: 800, masteryLevel: 1 },
    versions: [],
    deletedAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('question form draft', () => {
  it('starts with the minimum number of empty options and no correct answer', () => {
    const draft = createEmptyDraft();
    expect(draft.options).toHaveLength(MIN_OPTIONS);
    expect(draft.options.every(o => !o.text && !o.isCorrect)).toBe(true);
    expect(correctIndices(draft.options)).toEqual([]);
    expect(Object.keys(validateQuestionDraft(draft, VALID_CODES)).sort()).toEqual([
      'correctAnswer',
      'options',
      'stem',
      'topicCode',
    ]);
  });

  it('accepts a complete draft with one or more correct options', () => {
    expect(validateQuestionDraft(validDraft(), VALID_CODES)).toEqual({});
    const multi = validDraft();
    multi.options[1]!.isCorrect = true;
    expect(correctIndices(multi.options)).toEqual([0, 1]);
    expect(validateQuestionDraft(multi, VALID_CODES)).toEqual({});
  });

  it('rejects a missing stem, unknown topic code and invalid difficulty', () => {
    const draft = validDraft();
    draft.stem = '   ';
    draft.topicCode = 'BOGUS-99';
    draft.difficulty = 9 as 1;
    expect(validateQuestionDraft(draft, VALID_CODES)).toMatchObject({
      stem: 'required',
      topicCode: 'invalidTopic',
      difficulty: 'invalidDifficulty',
    });
  });

  it('enforces 2–6 non-empty options and at least one correct option', () => {
    const tooFew = validDraft();
    tooFew.options = tooFew.options.slice(0, MIN_OPTIONS - 1);
    expect(validateQuestionDraft(tooFew, VALID_CODES).options).toBe('minOptions');

    const tooMany = validDraft();
    tooMany.options = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({
      id: `o-${i}`,
      text: `Opsi ${i}`,
      isCorrect: i === 0,
    }));
    expect(validateQuestionDraft(tooMany, VALID_CODES).options).toBe('maxOptions');

    const emptyOption = validDraft();
    emptyOption.options[1]!.text = ' ';
    expect(validateQuestionDraft(emptyOption, VALID_CODES).options).toBe('optionTextRequired');

    const noCorrect = validDraft();
    noCorrect.options.forEach(o => (o.isCorrect = false));
    expect(validateQuestionDraft(noCorrect, VALID_CODES).correctAnswer).toBe('requireCorrect');
  });

  it('normalises comma-separated tags', () => {
    expect(parseTags(' hujan, , angin, hujan ,')).toEqual(['hujan', 'angin']);
  });
});

describe('question draft persistence mapping', () => {
  it('prefers correctAnswer over stale option flags when editing', () => {
    const draft = draftFromQuestion(
      makeQuestion({
        correctAnswer: [1],
        options: [
          { id: 'o-1', text: 'Jakarta', isCorrect: true },
          { id: 'o-2', text: 'Bandung', isCorrect: false },
        ],
      })
    );
    expect(draft.options.map(o => o.isCorrect)).toEqual([false, true]);

    const flaggedOnly = draftFromQuestion(
      makeQuestion({ correctAnswer: [], options: makeQuestion().options })
    );
    expect(flaggedOnly.options.map(o => o.isCorrect)).toEqual([true, false]);
  });

  it('creates a new question with trimmed fields and zeroed statistics', () => {
    const question = draftToQuestion(validDraft());
    expect(question.stem).toBe('Apa ibukota Indonesia?');
    expect(question.explanation).toBeUndefined();
    expect(question.correctAnswer).toEqual([0]);
    expect(question.options[0]!.isCorrect).toBe(true);
    expect(question.metadata.version).toBe(1);
    expect(question.metadata.author).toBe('user');
    expect(question.statistics.totalAttempts).toBe(0);
    expect('deletedAt' in question).toBe(false);
  });

  it('bumps version, preserves stats/versions and clears soft-delete on edit', () => {
    const existing = makeQuestion();
    const updated = draftToQuestion(draftFromQuestion(existing), existing);
    expect(updated.id).toBe(existing.id);
    expect(updated.metadata.version).toBe(4);
    expect(updated.metadata.createdAt).toBe(existing.metadata.createdAt);
    expect(updated.statistics).toEqual(existing.statistics);
    expect(updated.versions).toEqual(existing.versions);
    expect('deletedAt' in updated).toBe(false);
    expect(updated.tags).toEqual(['geografi', 'ibukota']);
    expect(updated.source).toBe('BMKG 2024');
  });
});

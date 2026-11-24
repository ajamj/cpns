// Question form draft model for Phase 2 Task 2.
//
// Keeping the draft/validation/persistence mapping separate from the DOM view
// makes the CRUD rules testable in the node-only unit-test environment and
// keeps QuestionBankView focused on rendering and event wiring.

import type {
  Difficulty,
  Question,
  QuestionFlags,
  QuestionOption,
  TopicCode,
} from '../../shared/types';
import { generateId, nowISO } from '../../core/utils';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export interface QuestionFormDraft {
  topicCode: string;
  stem: string;
  options: QuestionOption[];
  explanation: string;
  difficulty: Difficulty;
  source: string;
  tags: string[];
  flags: QuestionFlags;
}

export type QuestionFormField = 'stem' | 'topicCode' | 'difficulty' | 'options' | 'correctAnswer';

export type QuestionFormErrorCode =
  | 'required'
  | 'invalidTopic'
  | 'invalidDifficulty'
  | 'minOptions'
  | 'maxOptions'
  | 'optionTextRequired'
  | 'requireCorrect';

export type QuestionFormErrors = Partial<Record<QuestionFormField, QuestionFormErrorCode>>;

function defaultFlags(): QuestionFlags {
  return { bookmarked: false, needsReview: false, disputed: false };
}

/** Comma-separated free-text tags → unique, trimmed, non-empty tags. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(',').map(tag => tag.trim()).filter(Boolean))];
}

/** `correctAnswer` is a list of zero-based option indices (see SRS §3.2.3). */
export function correctIndices(options: QuestionOption[]): number[] {
  return options.flatMap((option, index) => (option.isCorrect ? [index] : []));
}

export function createEmptyDraft(): QuestionFormDraft {
  return {
    topicCode: '',
    stem: '',
    options: Array.from({ length: MIN_OPTIONS }, () => ({
      id: generateId(),
      text: '',
      isCorrect: false,
    })),
    explanation: '',
    difficulty: 2,
    source: '',
    tags: [],
    flags: defaultFlags(),
  };
}

/**
 * Imported questions may carry only `correctAnswer` or only `isCorrect` flags;
 * prefer the explicit index list, then fall back to the per-option flags.
 */
export function draftFromQuestion(question: Question): QuestionFormDraft {
  const declared = (question.correctAnswer ?? []).filter(
    index => Number.isInteger(index) && index >= 0 && index < question.options.length
  );
  const flagged = question.options.flatMap((option, index) => (option.isCorrect ? [index] : []));
  const correct = declared.length > 0 ? declared : flagged;

  return {
    topicCode: question.topicCode ?? '',
    stem: question.stem ?? '',
    options: question.options.map((option, index) => ({
      id: option.id || generateId(),
      text: option.text ?? '',
      isCorrect: correct.includes(index),
    })),
    explanation: question.explanation ?? '',
    difficulty: question.difficulty,
    source: question.source ?? '',
    tags: [...(question.tags ?? [])],
    flags: { ...defaultFlags(), ...(question.flags ?? {}) },
  };
}

/**
 * All form constraints in one place: required stem, registered topic code,
 * valid difficulty, 2–6 non-empty options and at least one correct option.
 */
export function validateQuestionDraft(
  draft: QuestionFormDraft,
  validTopicCodes: ReadonlySet<string>
): QuestionFormErrors {
  const errors: QuestionFormErrors = {};

  if (!draft.stem.trim()) errors.stem = 'required';
  if (!draft.topicCode || !validTopicCodes.has(draft.topicCode)) errors.topicCode = 'invalidTopic';
  if (!([1, 2, 3] as number[]).includes(draft.difficulty)) errors.difficulty = 'invalidDifficulty';

  if (draft.options.length < MIN_OPTIONS) errors.options = 'minOptions';
  else if (draft.options.length > MAX_OPTIONS) errors.options = 'maxOptions';
  else if (draft.options.some(option => !option.text.trim())) errors.options = 'optionTextRequired';

  const correct = correctIndices(draft.options);
  if (correct.length === 0 || correct.some(index => index < 0 || index >= draft.options.length)) {
    errors.correctAnswer = 'requireCorrect';
  }

  return errors;
}

/** Draft → persisted question. Existing metadata/statistics/versions are kept. */
export function draftToQuestion(draft: QuestionFormDraft, existing?: Question): Question {
  const now = nowISO();
  const correct = correctIndices(draft.options);
  const options: QuestionOption[] = draft.options.map((option, index) => ({
    id: option.id || generateId(),
    text: option.text.trim(),
    isCorrect: correct.includes(index),
  }));

  const question: Question = {
    id: existing?.id ?? generateId(),
    topicCode: draft.topicCode.trim() as TopicCode,
    stem: draft.stem.trim(),
    options,
    correctAnswer: correct,
    explanation: draft.explanation.trim() || undefined,
    difficulty: draft.difficulty,
    source: draft.source.trim() || undefined,
    tags: parseTags(draft.tags.join(',')),
    flags: { ...defaultFlags(), ...draft.flags },
    metadata: existing?.metadata
      ? {
          ...existing.metadata,
          updatedAt: now,
          version: (existing.metadata.version ?? 0) + 1,
          author: existing.metadata.author ?? 'user',
        }
      : { createdAt: now, updatedAt: now, version: 1, author: 'user' },
    statistics: existing?.statistics
      ? { ...existing.statistics }
      : { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
  };

  if (existing?.versions) question.versions = existing.versions;
  return question;
}

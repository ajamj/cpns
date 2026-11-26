// Pure transforms behind the Question Bank bulk actions (Phase 2, Task 5).
// Kept DOM-free so the tag/flag/export rules can be unit tested directly.
import { toCSV } from '../../core/utils';
import type { Question, QuestionFlags } from '../../shared/types';

export type BulkTagMode = 'add' | 'replace';

export type BulkUpdate =
  | { kind: 'tags'; mode: BulkTagMode; tags: readonly string[] }
  | { kind: 'flags'; patch: Partial<QuestionFlags> };

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

/** `add` preserves existing tags; `replace` (retag) discards them. */
export function mergeTags(
  current: readonly string[],
  incoming: readonly string[],
  mode: BulkTagMode
): string[] {
  return mode === 'replace'
    ? normalizeTags(incoming)
    : normalizeTags([...(current ?? []), ...incoming]);
}

export function applyFlagPatch(current: QuestionFlags, patch: Partial<QuestionFlags>): QuestionFlags {
  return {
    bookmarked: patch.bookmarked ?? Boolean(current?.bookmarked),
    needsReview: patch.needsReview ?? Boolean(current?.needsReview),
    disputed: patch.disputed ?? Boolean(current?.disputed),
  };
}

/**
 * Apply one bulk change to a question without mutating the stored object.
 * Metadata follows the same edit contract as the single-question form:
 * updatedAt changes, version increments, versions/history are preserved.
 */
export function applyBulkUpdate(
  question: Question,
  update: BulkUpdate,
  now: string = new Date().toISOString()
): Question {
  return {
    ...question,
    tags: update.kind === 'tags'
      ? mergeTags(question.tags ?? [], update.tags, update.mode)
      : [...(question.tags ?? [])],
    flags: update.kind === 'flags'
      ? applyFlagPatch(question.flags, update.patch)
      : { ...question.flags },
    metadata: {
      ...question.metadata,
      updatedAt: now,
      version: (question.metadata?.version ?? 0) + 1,
    },
  };
}

/**
 * One row per selected question, with options in columns A–E (SRS §3.2.3).
 * The trailing columns are optional on import: older CsvRow exports stay valid,
 * while exports from this app roundtrip with full field fidelity.
 */
export const QUESTIONS_CSV_HEADER = [
  'id', 'topicCode', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE',
  'correctAnswer', 'explanation', 'difficulty', 'source', 'tags',
  'bookmarked', 'needsReview', 'disputed',
  'metadata.createdAt', 'metadata.updatedAt', 'metadata.version', 'metadata.author',
  'statistics.totalAttempts', 'statistics.correctAttempts', 'statistics.avgTimeMs',
  'statistics.lastAttemptedAt', 'statistics.masteryLevel',
  'versions', 'deletedAt', 'optionIds',
] as const;

export function questionsToCSV(questions: readonly Question[]): string {
  const rows: string[][] = [[...QUESTIONS_CSV_HEADER]];

  for (const q of questions) {
    const options = (q.options ?? []).map(option => option?.text ?? '');
    const optionIds = (q.options ?? []).map(option => option?.id ?? '');
    while (options.length < 5) options.push('');
    while (optionIds.length < 5) optionIds.push('');
    const stats = q.statistics;
    const metadata = q.metadata;
    rows.push([
      q.id,
      q.topicCode,
      q.stem ?? '',
      options[0] ?? '',
      options[1] ?? '',
      options[2] ?? '',
      options[3] ?? '',
      options[4] ?? '',
      (q.correctAnswer ?? []).map(index => String.fromCharCode(65 + index)).join(','),
      q.explanation ?? '',
      String(q.difficulty),
      q.source ?? '',
      (q.tags ?? []).join(';'),
      String(Boolean(q.flags?.bookmarked)),
      String(Boolean(q.flags?.needsReview)),
      String(Boolean(q.flags?.disputed)),
      metadata?.createdAt ?? '',
      metadata?.updatedAt ?? '',
      String(metadata?.version ?? ''),
      metadata?.author ?? '',
      String(stats?.totalAttempts ?? 0),
      String(stats?.correctAttempts ?? 0),
      String(stats?.avgTimeMs ?? 0),
      stats?.lastAttemptedAt ?? '',
      String(stats?.masteryLevel ?? 0),
      q.versions?.length ? JSON.stringify(q.versions) : '',
      q.deletedAt ?? '',
      optionIds.join(';'),
    ]);
  }

  return toCSV(rows);
}

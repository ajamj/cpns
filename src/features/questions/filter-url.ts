/**
 * URL contract for the question-bank filter sidebar (Phase 2, Task 3).
 *
 * Kept free of DOM/router imports so the encode/decode rules can be unit tested
 * and shared by the view without pulling in CSS or a browser environment.
 */
import type {
  Difficulty,
  MasteryLevel,
  QuestionFilter,
  QuestionFlag,
  QuestionFlags,
  TopicCode,
} from '../../shared/types';

/** One debounce window for both the full-text and source text inputs. */
export const QUESTION_FILTER_DEBOUNCE_MS = 150;

/** Canonical query keys. `topics` is accepted on input as a legacy alias. */
export const QUESTION_FILTER_PARAM_KEYS = [
  'topic',
  'difficulty',
  'mastery',
  'flags',
  'source',
  'startDate',
  'endDate',
  'search',
] as const;

const QUESTION_FLAGS: readonly QuestionFlag[] = ['bookmarked', 'needsReview', 'disputed'];
const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3];
const MASTERY_LEVELS: readonly MasteryLevel[] = [0, 1, 2, 3];

export interface QuestionFilterURLState {
  filter: QuestionFilter;
  searchQuery: string;
}

function first(params: Record<string, string | undefined>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** Parse URL params defensively: malformed values must not break the view. */
export function parseQuestionFilterParams(
  params: Record<string, string | undefined>
): QuestionFilterURLState {
  const filter: QuestionFilter = {};

  const topicParam = first(params, 'topic', 'topics');
  if (topicParam) {
    const codes = topicParam.split(',').map(code => code.trim()).filter(Boolean);
    if (codes.length) filter.topicCodes = codes as TopicCode[];
  }

  const difficultyParam = first(params, 'difficulty');
  if (difficultyParam) {
    const difficulty = Number(difficultyParam);
    if (DIFFICULTIES.includes(difficulty as Difficulty)) filter.difficulty = difficulty as Difficulty;
  }

  const masteryParam = first(params, 'mastery');
  if (masteryParam) {
    const levels = masteryParam
      .split(',')
      .map(value => Number(value.trim()))
      .filter(level => MASTERY_LEVELS.includes(level as MasteryLevel));
    if (levels.length) filter.masteryLevels = levels as MasteryLevel[];
  }

  const flagsParam = first(params, 'flags');
  if (flagsParam) {
    const flags: Partial<QuestionFlags> = {};
    flagsParam.split(',').forEach(flag => {
      const key = flag.trim() as QuestionFlag;
      if (QUESTION_FLAGS.includes(key)) flags[key] = true;
    });
    if (Object.keys(flags).length) filter.flags = flags;
  }

  const source = first(params, 'source');
  if (source) filter.source = source;

  const startDate = first(params, 'startDate');
  const endDate = first(params, 'endDate');
  if (startDate || endDate) {
    const start = startDate ?? endDate!;
    const end = endDate ?? startDate!;
    // Reject inverted ranges the same way the interactive date inputs do.
    if (start <= end) filter.dateRange = { start, end };
  }

  const search = first(params, 'search', 'q');
  return {
    filter,
    searchQuery: search ?? '',
  };
}

/** Serialise only non-empty filter dimensions; unrelated params are untouched. */
export function toQuestionFilterParams(state: QuestionFilterURLState): Record<string, string> {
  const { filter, searchQuery } = state;
  const params: Record<string, string> = {};

  if (filter.topicCodes?.length) params.topic = filter.topicCodes.join(',');
  if (filter.difficulty !== undefined && DIFFICULTIES.includes(filter.difficulty)) {
    params.difficulty = String(filter.difficulty);
  }
  if (filter.masteryLevels?.length) {
    const levels = filter.masteryLevels.filter(level => MASTERY_LEVELS.includes(level));
    if (levels.length) params.mastery = levels.join(',');
  }
  const flags = QUESTION_FLAGS.filter(flag => filter.flags?.[flag]);
  if (flags.length) params.flags = flags.join(',');
  if (filter.source?.trim()) params.source = filter.source.trim();
  if (filter.dateRange?.start && filter.dateRange.end && filter.dateRange.start <= filter.dateRange.end) {
    params.startDate = filter.dateRange.start;
    params.endDate = filter.dateRange.end;
  }
  if (searchQuery.trim()) params.search = searchQuery.trim();

  return params;
}

/**
 * Replace filter keys in a hash without touching the route path (including the
 * `#/questions` leading slash) or unrelated query keys.
 */
export function replaceQuestionFilterHash(
  currentHash: string,
  state: QuestionFilterURLState
): string {
  const raw = currentHash.startsWith('#') ? currentHash.slice(1) : currentHash;
  const queryIndex = raw.indexOf('?');
  const path = (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw) || '/questions';
  const search = queryIndex >= 0 ? raw.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(search);

  QUESTION_FILTER_PARAM_KEYS.forEach(key => params.delete(key));
  // Also drop the legacy alias so a round-trip has exactly one topic key.
  params.delete('topics');
  params.delete('q');

  const next = toQuestionFilterParams(state);
  Object.entries(next).forEach(([key, value]) => params.set(key, value));

  const query = params.toString();
  return `#${path}${query ? `?${query}` : ''}`;
}

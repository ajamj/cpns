/**
 * Question-bank full-text search (Phase 2, Task 4).
 *
 * Fuse.js owns the fuzzy pass. Its `includeScore` results are lower-is-better
 * relevance scores; literal hits use a weighted fast path so a 2 000-question
 * bank doesn't pay for a full fuzzy scan on every keystroke. Both paths feed
 * the same id → score map, which the view uses for relevance ordering.
 */
import Fuse from 'fuse.js';

export interface SearchableQuestion {
  id: string;
  stem?: string | null;
  explanation?: string | null;
  options?: Array<{ text?: string | null }> | null;
  tags?: string[] | null;
}

/** Weights from the phase plan: R-1 mitigation for irrelevant search hits. */
export const QUESTION_SEARCH_KEYS = [
  { name: 'stem', weight: 3 },
  { name: 'options.text', weight: 2 },
  { name: 'explanation', weight: 1.5 },
  { name: 'tags', weight: 1 },
];

export const QUESTION_SEARCH_OPTIONS = {
  keys: QUESTION_SEARCH_KEYS,
  threshold: 0.4,
  minMatchCharLength: 2,
  includeScore: true,
};

export function createQuestionSearchIndex<T>(questions: T[]): Fuse<T> {
  return new Fuse(questions, QUESTION_SEARCH_OPTIONS);
}

/** Normalised text built at most once per question object. */
const searchHaystacks = new WeakMap<object, string>();
export function searchableText(question: SearchableQuestion): string {
  const cached = searchHaystacks.get(question);
  if (cached !== undefined) return cached;
  const text = [
    question.stem ?? '',
    question.explanation ?? '',
    ...(question.options ?? []).map(option => option.text ?? ''),
    ...(question.tags ?? []),
  ]
    .map(value => String(value))
    .join('\n')
    .toLowerCase();
  searchHaystacks.set(question, text);
  return text;
}

/**
 * A match spanning several fields (e.g. "ibukota indonesia" split between
 * stem and explanation) has no single weighted field to score. Keep it, but
 * rank it below every field-specific literal hit.
 */
export const CROSS_FIELD_MATCH_SCORE = 1.6;

function fieldMatchScore(text: string, needle: string, weight: number): number | null {
  const haystack = text.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  // Earlier matches in a field are more relevant; exact whole-field matches
  // get a small boost. The result stays inside [0.5/weight, 1.5/weight].
  const span = Math.max(1, haystack.length - needle.length);
  const position = Math.min(1, index / span);
  const exactness = haystack.trim() === needle ? 0.5 : 1;
  return (1 / weight) * (1 + 0.5 * position) * exactness;
}

/** Lower is better. Returns null when the literal query is absent. */
export function literalMatchScore(question: SearchableQuestion, needle: string): number | null {
  const fields: Array<{ weight: number; values: string[] }> = [
    { weight: 3, values: [String(question.stem ?? '')] },
    { weight: 2, values: (question.options ?? []).map(option => String(option.text ?? '')) },
    { weight: 1.5, values: [String(question.explanation ?? '')] },
    { weight: 1, values: (question.tags ?? []).map(tag => String(tag)) },
  ];

  let best: number | null = null;
  let matches = 0;
  for (const field of fields) {
    for (const value of field.values) {
      const score = fieldMatchScore(value, needle, field.weight);
      if (score === null) continue;
      matches += 1;
      if (best === null || score < best) best = score;
    }
  }
  if (best === null) return null;
  // Repeated matches across fields are a stronger signal than a single one.
  return best * Math.max(0.8, 1 - 0.05 * (matches - 1));
}

/** Tokens shorter than Fuse's `minMatchCharLength` cannot form a match. */
function searchTokens(needle: string): string[] {
  return needle.split(/\s+/).filter(token => token.length >= 2);
}

/**
 * Multi-word queries usually span fields ("siklon" in the stem, "tropis" in
 * the explanation). Every token must match; the combined score is the mean of
 * its weighted per-field scores so a stronger field still wins the tie.
 */
function multiTokenScore(question: SearchableQuestion, tokens: string[]): number | null {
  let total = 0;
  for (const token of tokens) {
    const score = literalMatchScore(question, token);
    if (score === null) return null;
    total += score;
  }
  return total / tokens.length;
}

/**
 * Rank all questions matching `query`, returning id → relevance score.
 * Literal hits bypass Fuse (performance); the fuzzy pass is the fallback for
 * typos and near-misses. `null` means "no query / query too short", not "no
 * results" (an empty map means no matches).
 */
export function rankQuestionMatches<T extends SearchableQuestion>(
  questions: T[],
  query: string,
  fuse: Fuse<T> | null
): Map<string, number> | null {
  const needle = query.trim().toLowerCase();
  // Fuse's minMatchCharLength applies to every path: a one-character query
  // must not return every question that happens to contain that letter.
  if (needle.length < 2) return null;

  const scores = new Map<string, number>();
  for (const question of questions) {
    if (!searchableText(question).includes(needle)) continue;
    scores.set(question.id, literalMatchScore(question, needle) ?? CROSS_FIELD_MATCH_SCORE);
  }

  const tokens = searchTokens(needle);
  if (tokens.length > 1) {
    for (const question of questions) {
      // An exact-phrase match is stronger than the same words spread out.
      if (scores.has(question.id)) continue;
      const score = multiTokenScore(question, tokens);
      if (score !== null) scores.set(question.id, score);
    }
  }
  if (scores.size > 0 || !fuse) return scores;

  for (const result of fuse.search(query)) {
    scores.set(result.item.id, result.score ?? 1);
  }
  return scores;
}

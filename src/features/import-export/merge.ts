/** Shared smart-merge helpers used by the repository and the import preview. */
import type { Question } from '../../shared/types';

export type MergeStrategy = 'skip' | 'overwrite' | 'duplicate' | 'smart';

export const SMART_SIMILARITY_THRESHOLD = 0.9;

/** Token-overlap similarity, matching the 90% rule in the phase plan. */
export function stemSimilarity(a: string, b: string): number {
  // Strip punctuation so "cerah?" and "cerah" compare as the same token.
  const tokens = (text: string): Set<string> => new Set(
    (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(word => word.length > 2)
  );
  const wordsA = tokens(a);
  const wordsB = tokens(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(word => wordsB.has(word)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

export type ConflictKind = 'id' | 'similar-stem';

export interface ImportConflict {
  incoming: Question;
  existing: Question;
  kind: ConflictKind;
  similarity: number;
}

/**
 * Preview-side detection: an exact ID match is overwritten, a >90% stem match
 * with a different ID is imported with `needsReview` flagged.
 */
export function detectConflicts(incoming: Question[], existing: Question[]): ImportConflict[] {
  const byId = new Map(existing.map(q => [q.id, q]));
  const conflicts: ImportConflict[] = [];

  for (const question of incoming) {
    const sameId = byId.get(question.id);
    if (sameId) {
      conflicts.push({
        incoming: question,
        existing: sameId,
        kind: 'id',
        similarity: stemSimilarity(question.stem, sameId.stem),
      });
      continue;
    }
    let best: { question: Question; similarity: number } | undefined;
    for (const candidate of existing) {
      const similarity = stemSimilarity(question.stem, candidate.stem);
      if (similarity > SMART_SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
        best = { question: candidate, similarity };
      }
    }
    if (best) {
      conflicts.push({
        incoming: question,
        existing: best.question,
        kind: 'similar-stem',
        similarity: best.similarity,
      });
    }
  }
  return conflicts;
}

/**
 * Question-bank full-text search contract (Phase 2, Task 4).
 * Pins the weighted field config, threshold and score-based relevance order
 * independently of the DOM-heavy QuestionBankView.
 */
import { describe, expect, it } from 'vitest';
import {
  CROSS_FIELD_MATCH_SCORE,
  QUESTION_SEARCH_OPTIONS,
  createQuestionSearchIndex,
  literalMatchScore,
  rankQuestionMatches,
  searchableText,
  type SearchableQuestion,
} from '../../src/features/questions/question-search';

function q(id: string, overrides: Partial<SearchableQuestion> = {}): SearchableQuestion {
  return {
    id,
    stem: 'Apa ibukota Indonesia?',
    options: [{ text: 'Jakarta' }, { text: 'Bandung' }],
    explanation: 'Jakarta adalah ibukota Indonesia.',
    tags: ['geografi'],
    ...overrides,
  };
}

describe('question search index', () => {
  const questions = [
    q('stem-hit', {
      stem: 'Siklon tropis terbentuk di samudra hangat',
      explanation: 'Cuaca ekstrem',
      tags: ['meteorologi'],
    }),
    q('option-hit', {
      stem: 'Pilih jawaban yang benar',
      options: [{ text: 'Siklon tropis' }, { text: 'Angin' }],
      explanation: 'Siklon terjadi di atmosfer',
      tags: ['meteorologi'],
    }),
    q('tag-hit', {
      stem: 'Proses evaporasi air laut',
      options: [{ text: 'Uap air' }, { text: 'Hujan' }],
      explanation: 'Energi matahari menguapkan air',
      tags: ['siklon'],
    }),
  ];
  const fuse = createQuestionSearchIndex(questions);

  it('uses the configured Fuse fields, threshold and minMatchCharLength', () => {
    expect(QUESTION_SEARCH_OPTIONS.keys).toEqual([
      { name: 'stem', weight: 3 },
      { name: 'options.text', weight: 2 },
      { name: 'explanation', weight: 1.5 },
      { name: 'tags', weight: 1 },
    ]);
    expect(QUESTION_SEARCH_OPTIONS.threshold).toBe(0.4);
    expect(QUESTION_SEARCH_OPTIONS.minMatchCharLength).toBe(2);
    expect(QUESTION_SEARCH_OPTIONS.includeScore).toBe(true);
  });

  it('indexes stem, options, explanation and tags', () => {
    expect(searchableText(questions[0]!)).toContain('siklon tropis');
    expect(searchableText(questions[1]!)).toContain('siklon tropis');
    expect(searchableText(questions[2]!)).toContain('siklon');
  });

  it('ranks literal stem matches above option, explanation and tag matches', () => {
    const scores = rankQuestionMatches(questions, 'siklon', fuse)!;
    expect([...scores.keys()]).toEqual(['stem-hit', 'option-hit', 'tag-hit']);
    expect(scores.get('stem-hit')!).toBeLessThan(scores.get('option-hit')!);
    expect(scores.get('option-hit')!).toBeLessThan(scores.get('tag-hit')!);
  });

  it('weights stem matches above tag matches even when the tag appears first', () => {
    const early = q('early', { stem: 'siklon di awal kalimat', tags: ['cuaca'] });
    const late = q('late', { stem: 'cuaca di awal kalimat', tags: ['siklon'] });
    expect(literalMatchScore(early, 'siklon')!).toBeLessThan(literalMatchScore(late, 'siklon')!);
  });

  it('keeps matches that span multiple fields and ranks them last', () => {
    const crossField = q('cross', {
      stem: 'Ibukota Indonesia adalah',
      explanation: ' Jakarta, kota terbesar.',
    });
    const scores = rankQuestionMatches([crossField], 'indonesia adalah\n jakarta', fuse)!;
    expect(scores.get('cross')).toBe(CROSS_FIELD_MATCH_SCORE);
  });

  it('falls back to Fuse scores for typo queries', () => {
    const typoQuestions = [q('right', { stem: 'Jakarta adalah ibukota' })];
    const typoFuse = createQuestionSearchIndex(typoQuestions);
    const scores = rankQuestionMatches(typoQuestions, 'jakarta', typoFuse)!;
    const fuzzy = rankQuestionMatches(typoQuestions, 'jakrta', typoFuse)!;
    expect(scores.get('right')).toBeDefined();
    expect(fuzzy.get('right')).toBeDefined();
    expect(fuzzy.get('right')!).toBeGreaterThan(0);
  });

  it('returns null for an empty query', () => {
    expect(rankQuestionMatches(questions, '   ', fuse)).toBeNull();
  });
});

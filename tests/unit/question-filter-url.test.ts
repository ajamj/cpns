/**
 * Question-bank filter URL contract (Phase 2, Task 3).
 * Filter state must survive a reload/share and must not disturb route params.
 */
import { describe, expect, it } from 'vitest';
import {
  parseQuestionFilterParams,
  QUESTION_FILTER_DEBOUNCE_MS,
  replaceQuestionFilterHash,
  toQuestionFilterParams,
} from '../../src/features/questions/filter-url';
import type { Difficulty, MasteryLevel, TopicCode } from '../../src/shared/types';

describe('question filter URL state', () => {
  it('uses one 150ms debounce for text inputs', () => {
    expect(QUESTION_FILTER_DEBOUNCE_MS).toBe(150);
  });

  it('parses every filter dimension from query params', () => {
    const { filter, searchQuery } = parseQuestionFilterParams({
      topic: 'UM-01, KH-03',
      difficulty: '2',
      mastery: '0,3',
      flags: 'bookmarked,disputed',
      source: 'BMKG 2024',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      search: 'siklon',
    });

    expect(filter.topicCodes).toEqual(['UM-01', 'KH-03']);
    expect(filter.difficulty).toBe(2);
    expect(filter.masteryLevels).toEqual([0, 3]);
    expect(filter.flags).toEqual({ bookmarked: true, disputed: true });
    expect(filter.source).toBe('BMKG 2024');
    expect(filter.dateRange).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(searchQuery).toBe('siklon');
  });

  it('ignores malformed values and inverted date ranges', () => {
    const { filter } = parseQuestionFilterParams({
      difficulty: '9',
      mastery: '7,x',
      flags: 'unknown,bookmarked',
      startDate: '2024-12-31',
      endDate: '2024-01-01',
    });

    expect(filter.difficulty).toBeUndefined();
    expect(filter.masteryLevels).toBeUndefined();
    expect(filter.flags).toEqual({ bookmarked: true });
    expect(filter.dateRange).toBeUndefined();
  });

  it('round-trips state through serialisation', () => {
    const state = {
      filter: {
        topicCodes: ['UM-01', 'KH-12'] as TopicCode[],
        difficulty: 3 as Difficulty,
        masteryLevels: [1, 2] as MasteryLevel[],
        flags: { needsReview: true },
        source: 'BMKG',
        dateRange: { start: '2024-01-01', end: '2024-01-31' },
        textSearch: 'angin',
      },
      searchQuery: 'angin',
    };
    const params = toQuestionFilterParams(state);
    expect(params).toEqual({
      topic: 'UM-01,KH-12',
      difficulty: '3',
      mastery: '1,2',
      flags: 'needsReview',
      source: 'BMKG',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      search: 'angin',
    });
    expect(parseQuestionFilterParams(params).filter.topicCodes).toEqual(state.filter.topicCodes);
  });

  it('preserves the leading slash and unrelated route params in the hash', () => {
    const state = {
      filter: { topicCodes: ['UM-02' as TopicCode], difficulty: 1 as Difficulty },
      searchQuery: 'cuaca',
    };
    const hash = replaceQuestionFilterHash('#/questions?mode=review&topic=OLD&difficulty=3', state);

    expect(hash).toBe('#/questions?mode=review&topic=UM-02&difficulty=1&search=cuaca');
    expect(parseQuestionFilterParams(Object.fromEntries(new URLSearchParams(hash.split('?')[1]))).filter.topicCodes)
      .toEqual(['UM-02']);
  });

  it('drops stale filter keys when everything is cleared', () => {
    const hash = replaceQuestionFilterHash(
      '#/questions?flags=bookmarked&source=BMKG&startDate=2024-01-01&endDate=2024-01-02&search=awan&tab=all',
      { filter: {}, searchQuery: '' }
    );
    expect(hash).toBe('#/questions?tab=all');
  });
});

/**
 * Mock exam session contract (Phase 3, Task 4): deadline-based countdown,
 * warning thresholds, navigator status priority and score calculation.
 * The DOM-heavy view is not instantiated here; its pure state helpers are.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateExamScore,
  getNavigatorStatus,
  getRemainingMs,
  getTimerWarningLevel,
} from '../../src/views/MockExamView';

describe('mock exam countdown', () => {
  const endsAt = 90 * 60_000;

  it('derives remaining time from the deadline, not tick count', () => {
    expect(getRemainingMs(endsAt, 0)).toBe(endsAt);
    // A delayed tick still reports the correct time: no accumulated drift.
    expect(getRemainingMs(endsAt, 45 * 60_000 + 137)).toBe(45 * 60_000 - 137);
    expect(getRemainingMs(endsAt, endsAt + 5_000)).toBe(0);
  });

  it('switches warning levels at 15, 5 and 1 minutes', () => {
    expect(getTimerWarningLevel(90 * 60_000)).toBe('normal');
    expect(getTimerWarningLevel(15 * 60_000 + 1)).toBe('normal');
    expect(getTimerWarningLevel(15 * 60_000)).toBe('warning');
    expect(getTimerWarningLevel(5 * 60_000 + 1)).toBe('warning');
    expect(getTimerWarningLevel(5 * 60_000)).toBe('danger');
    expect(getTimerWarningLevel(60_000 + 1)).toBe('danger');
    expect(getTimerWarningLevel(60_000)).toBe('critical');
    expect(getTimerWarningLevel(0)).toBe('critical');
  });
});

describe('mock exam navigator states', () => {
  it('prioritises current, then flags, review marks, answers, unvisited', () => {
    const base = { current: false, flagged: false, markedReview: false, answered: false };
    expect(getNavigatorStatus(base)).toBe('unvisited');
    expect(getNavigatorStatus({ ...base, answered: true })).toBe('answered');
    expect(getNavigatorStatus({ ...base, markedReview: true })).toBe('marked');
    expect(getNavigatorStatus({ ...base, flagged: true, answered: true })).toBe('flagged');
    expect(getNavigatorStatus({ ...base, current: true, flagged: true })).toBe('current');
  });
});

describe('mock exam scoring', () => {
  it('rounds raw correct counts to a percentage and handles empty exams', () => {
    expect(calculateExamScore(0, 0)).toBe(0);
    expect(calculateExamScore(3, 4)).toBe(75);
    expect(calculateExamScore(42, 60)).toBe(70);
  });
});

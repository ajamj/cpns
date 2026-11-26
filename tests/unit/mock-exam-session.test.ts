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
  getSubmitCounts,
  getTimerWarningLevel,
  timerWarningMessage,
} from '../../src/views/MockExamView';
import {
  eventBus,
  emitMockAutoSubmitted,
  emitMockTimerWarning,
} from '../../src/core/events';

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

describe('mock exam submit confirmation counts', () => {
  it('counts answered, unanswered and flagged questions from session state', () => {
    const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    const answers = new Map([['q1', { isCorrect: true }], ['q3', { isCorrect: false }]]);
    const flags = new Set(['q2', 'q3']);
    expect(getSubmitCounts(questions, answers, flags)).toEqual({
      answered: 2,
      unanswered: 1,
      flagged: 2,
    });
  });

  it('handles an unstarted exam', () => {
    expect(getSubmitCounts([{ id: 'q1' }], new Map(), new Set())).toEqual({
      answered: 0,
      unanswered: 1,
      flagged: 0,
    });
  });
});

describe('mock exam warning copy', () => {
  const key = (translationKey: string) => translationKey;

  it('maps each threshold to its translated warning key', () => {
    expect(timerWarningMessage(90 * 60_000, key)).toBe('');
    expect(timerWarningMessage(15 * 60_000, key)).toBe('mock.warning15');
    expect(timerWarningMessage(5 * 60_000, key)).toBe('mock.warning5');
    expect(timerWarningMessage(60_000, key)).toBe('mock.warning1');
  });
});

describe('mock exam events', () => {
  it('publishes timer thresholds and automatic submission', () => {
    const warnings: Array<{ sessionId: string; level: string; remainingMs: number }> = [];
    const auto: Array<{ sessionId: string; remainingMs: number }> = [];
    const onWarning = (payload: (typeof warnings)[number]) => warnings.push(payload);
    const onAuto = (payload: (typeof auto)[number]) => auto.push(payload);
    eventBus.on('mock:timer-warning', onWarning);
    eventBus.on('mock:auto-submitted', onAuto);

    emitMockTimerWarning('session-1', 'danger', 4 * 60_000);
    emitMockAutoSubmitted('session-1', 0);

    eventBus.off('mock:timer-warning', onWarning);
    eventBus.off('mock:auto-submitted', onAuto);

    expect(warnings).toEqual([{ sessionId: 'session-1', level: 'danger', remainingMs: 240_000 }]);
    expect(auto).toEqual([{ sessionId: 'session-1', remainingMs: 0 }]);
  });
});

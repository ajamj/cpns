/**
 * Analytics scoring contracts (Phase 4, Task 1).
 * The DOM-heavy views are not instantiated here; the pure calculations that
 * drive the mastery grid, readiness badge, weak-area panel and streak counters
 * are exercised directly.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateReadiness,
  calculateStreaks,
  calculateWeakAreas,
  getMasteryLevel,
  getMasteryPercent,
  type MasteryStats,
} from '../../src/features/analytics/metrics';

const topic = (code: string, title = code) => ({ code, title });

const stats = (entries: Record<string, number>): MasteryStats =>
  Object.fromEntries(
    Object.entries(entries).map(([code, level]) => [
      code,
      { total: 3, mastered: level === 3 ? 3 : 0, learning: level === 0 ? 0 : 3, new: 0, avgMastery: level / 3 },
    ])
  );

const ALL_CODES = [
  ...Array.from({ length: 9 }, (_, i) => `UM-0${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `KH-${String(i + 1).padStart(2, '0')}`),
];

describe('mastery level mapping', () => {
  it('maps 0-1 average mastery to discrete 0-3 levels', () => {
    expect(getMasteryLevel(undefined)).toBe(0);
    expect(getMasteryLevel(0)).toBe(0);
    expect(getMasteryLevel(1 / 3)).toBe(1);
    expect(getMasteryLevel(2 / 3)).toBe(2);
    expect(getMasteryLevel(1)).toBe(3);
    expect(getMasteryLevel(2)).toBe(3); // defensive clamp
  });

  it('renders level 3 as a full progress bar', () => {
    expect([0, 1, 2, 3].map(getMasteryPercent)).toEqual([0, 33, 67, 100]);
  });
});

describe('readiness score', () => {
  it('averages all 21 topic levels and divides by 3', () => {
    const result = calculateReadiness(ALL_CODES, stats(Object.fromEntries(ALL_CODES.map(c => [c, 3]))));
    expect(result.percent).toBe(100);
    expect(result.band).toBe(2);
    expect(result.totalTopics).toBe(21);
    expect(result.confidencePercent).toBe(100);
  });

  it('counts untouched topics as level 0', () => {
    const result = calculateReadiness(ALL_CODES, stats({ 'UM-01': 3 }));
    expect(result.percent).toBe(5); // 3 / (21 * 3)
    expect(result.coveredTopics).toBe(1);
    expect(result.confidencePercent).toBe(5);
  });

  it('uses the 33/66 thresholds for readiness bands', () => {
    const allLearning = calculateReadiness(ALL_CODES, stats(Object.fromEntries(ALL_CODES.map(c => [c, 1]))));
    expect(allLearning.percent).toBe(33);
    expect(allLearning.band).toBe(0); // Belum Siap

    const improved = stats(Object.fromEntries(ALL_CODES.map(c => [c, 1])));
    improved['UM-01'] = { total: 3, mastered: 3, learning: 0, new: 0, avgMastery: 2 / 3 };
    const mid = calculateReadiness(ALL_CODES, improved);
    expect(mid.percent).toBe(35);
    expect(mid.band).toBe(1); // Perlu Ulang

    const ready = calculateReadiness(ALL_CODES, stats(Object.fromEntries(ALL_CODES.map(c => [c, 2]))));
    expect(ready.percent).toBe(67);
    expect(ready.band).toBe(2); // Siap
  });

  it('weights the estimated CAT score towards KH topics', () => {
    const khOnly = calculateReadiness(['UM-01', 'KH-01'], stats({ 'KH-01': 3 }));
    const umOnly = calculateReadiness(['UM-01', 'KH-01'], stats({ 'UM-01': 3 }));
    expect(khOnly.estimatedCatScore).toBe(60); // 3*1.5 / ((1+1.5)*3)
    expect(umOnly.estimatedCatScore).toBe(40);
    expect(khOnly.percent).toBe(50); // unweighted readiness
  });
});

describe('weak areas', () => {
  const topics = [
    topic('UM-01'), topic('UM-02'), topic('UM-03'),
    topic('KH-01'), topic('KH-02'), topic('KH-03'),
  ];

  it('ranks unmastered high-weight topics first', () => {
    const areas = calculateWeakAreas(topics, stats({ 'UM-01': 2, 'KH-01': 0, 'KH-02': 1, 'UM-02': 3 }));
    expect(areas).toHaveLength(5);
    expect(areas[0]?.topicCode).toBe('KH-01');
    expect(areas[0]?.weaknessScore).toBe(1.5);
    expect(areas[0]?.masteryPercent).toBe(0);
    expect(areas.find(a => a.topicCode === 'KH-01')?.weight).toBe(1.5);
    expect(areas.find(a => a.topicCode === 'UM-01')?.weaknessScore).toBeCloseTo(0.333, 2);
  });

  it('returns mastered topics with zero weakness and respects the limit', () => {
    const mastered = stats(Object.fromEntries(topics.map(t => [t.code, 3])));
    const areas = calculateWeakAreas(topics, mastered, undefined, 2);
    expect(areas).toHaveLength(2);
    expect(areas.every(a => a.weaknessScore === 0)).toBe(true);
  });
});

describe('study streak', () => {
  const now = new Date(2026, 4, 15, 12, 0, 0); // 15 May 2026, local time
  const on = (day: number, hour = 9) => ({ startedAt: new Date(2026, 4, day, hour).toISOString() });

  it('counts consecutive days ending today and finds the longest run', () => {
    const result = calculateStreaks([on(15), on(14), on(13), on(12), on(11), on(9), on(8)], now);
    expect(result.current).toBe(5);
    expect(result.longest).toBe(5);
    expect(result.activeDays).toBe(7);
  });

  it('keeps a streak alive through yesterday', () => {
    const result = calculateStreaks([on(14), on(13)], now);
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it('resets a stale streak but preserves the historical longest run', () => {
    const result = calculateStreaks([on(10), on(9), on(8), on(2)], now);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(3);
  });

  it('ignores malformed timestamps and handles empty history', () => {
    expect(calculateStreaks([{ startedAt: 'not-a-date' }, {}], now)).toEqual({
      current: 0, longest: 0, activeDays: 0,
    });
    expect(calculateStreaks([], now).current).toBe(0);
  });
});

/**
 * Weekly Markdown report contracts (Phase 4, Task 6).
 * The report builder is pure: no DOM or IndexedDB is needed to assert that the
 * downloaded file contains the required analytics sections and data.
 */
import { describe, expect, it } from 'vitest';
import {
  buildWeeklyReport,
  weeklyReportFilename,
  type FlashcardStats,
  type WeeklyReportSession,
} from '../../src/features/analytics/weekly-report';
import type { MasteryStats } from '../../src/features/analytics/metrics';

const NOW = new Date(2026, 4, 15, 12, 0, 0);
const flashcards: FlashcardStats = { due: 2, new: 3, learning: 4, review: 5, mature: 6 };
const stats = (entries: Record<string, number>): MasteryStats =>
  Object.fromEntries(
    Object.entries(entries).map(([code, level]) => [
      code,
      { total: 3, mastered: level === 3 ? 3 : 0, learning: level > 0 ? 3 : 0, new: level === 0 ? 3 : 0, avgMastery: level / 3 },
    ])
  );
const session = (date: Date, mode: WeeklyReportSession['mode'] = 'practice', completed = true): WeeklyReportSession => ({
  startedAt: date.toISOString(),
  mode,
  completedAt: completed ? date.toISOString() : undefined,
});

describe('weekly report generation', () => {
  it('includes readiness, per-topic mastery, weak areas, streak and weekly sessions', () => {
    const topics = [
      { code: 'UM-01', title: 'Meteorologi' },
      { code: 'KH-01', title: 'Instrumen Meteorologi' },
      { code: 'UM-02', title: 'Klimatologi' },
    ];
    const result = buildWeeklyReport({
      generatedAt: NOW,
      topics,
      masteryStats: stats({ 'UM-01': 1, 'KH-01': 0, 'UM-02': 3 }),
      sessions: [
        session(new Date(2026, 4, 15, 9), 'practice'),
        session(new Date(2026, 4, 15, 10), 'mock-exam'),
        session(new Date(2026, 4, 15, 11), 'flashcard', false),
        session(new Date(2026, 4, 14, 9), 'practice'),
        session(new Date(2026, 4, 7, 9)), // exactly outside the 7-day window
        session(new Date(2026, 4, 16, 9)), // future session
      ],
      flashcardStats: flashcards,
    });

    expect(result.weeklySessions).toBe(4);
    expect(result.completedSessions).toBe(3);
    expect(result.streak.current).toBe(2);
    expect(result.weakAreas[0]?.topicCode).toBe('KH-01');

    const { markdown } = result;
    expect(markdown).toContain('# CPNS BMKG SKB Prep — Laporan Mingguan');
    expect(markdown).toContain('v1.0.0');
    expect(markdown).toContain('## Ringkasan Kesiapan');
    expect(markdown).toContain('## Ringkasan Data');
    expect(markdown).toContain('| Kode | Topik | Kemahiran | Level | Soal | Bobot |');
    expect(markdown).toContain('| UM-01 | Meteorologi | 33% | 1 (Belajar) | 3 | 1 |');
    expect(markdown).toContain('| KH-01 | Instrumen Meteorologi | 0% | 0 (Baru) | 3 | 1.5 |');
    expect(markdown).toContain('## Area Lemah Prioritas');
    expect(markdown).toContain('| 1 | KH-01 |');
    expect(markdown).toContain('## Aktivitas 7 Hari Terakhir');
    expect(markdown).toContain('- Total sesi: 4');
    expect(markdown).toContain('- Sesi selesai: 3');
    expect(markdown).toContain('Latihan: 2 • Ujian CAT: 1 • Flashcard: 1');
    expect(markdown).toContain('| Streak saat ini | 2 hari |');
    expect(markdown).toContain('| Streak terlama | 2 hari |');
    expect(markdown).toContain('- Jatuh tempo: 2');
  });

  it('escapes Markdown table delimiters in topic titles', () => {
    const result = buildWeeklyReport({
      generatedAt: NOW,
      topics: [{ code: 'UM-01', title: 'Kimia | Fisika\nAtmosfer' }],
      masteryStats: stats({ 'UM-01': 2 }),
      sessions: [],
      flashcardStats: flashcards,
    });

    expect(result.markdown).toContain('| UM-01 | Kimia \\| Fisika Atmosfer | 67% |');
  });

  it('handles an empty dataset without inventing activity', () => {
    const result = buildWeeklyReport({
      generatedAt: NOW,
      topics: [],
      masteryStats: {},
      sessions: [],
      flashcardStats: { due: 0, new: 0, learning: 0, review: 0, mature: 0 },
    });

    expect(result.readiness.percent).toBe(0);
    expect(result.streak.current).toBe(0);
    expect(result.weakAreas).toEqual([]);
    expect(result.markdown).toContain('Tidak ada area lemah signifikan.');
    expect(result.markdown).toContain('- Total sesi: 0');
  });

  it('builds a local-date .md filename', () => {
    expect(weeklyReportFilename(NOW)).toBe('weekly-report-2026-05-15.md');
  });
});

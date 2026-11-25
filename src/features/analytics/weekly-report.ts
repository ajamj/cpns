// Weekly report generation — pure Markdown builder for Phase 4 Task 6.
// Kept DOM-free so the report contents can be unit-tested and reused by the
// Analytics view (and later by any scheduled export).
import { APP_CONFIG } from '../../core/config';
import { getMasteryLabel } from '../kisi-kisi/registry';
import type { KisiKisiTopic, SessionMode } from '../../shared/types';
import {
  calculateReadiness,
  calculateStreaks,
  calculateWeakAreas,
  getMasteryLevel,
  getMasteryPercent,
  type MasteryStats,
  type ReadinessResult,
  type StreakResult,
  type TopicWeights,
  type WeakArea,
} from './metrics';

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const READINESS_LABELS = ['Belum Siap', 'Perlu Ulang', 'Siap'] as const;
const MODE_LABELS: Record<SessionMode, string> = {
  practice: 'Latihan',
  'mock-exam': 'Ujian CAT',
  flashcard: 'Flashcard',
};

export interface FlashcardStats {
  due: number;
  new: number;
  learning: number;
  review: number;
  mature: number;
}

export interface WeeklyReportSession {
  startedAt: string;
  mode: SessionMode;
  completedAt?: string;
}

export interface WeeklyReportInput {
  generatedAt?: Date;
  topics: readonly Pick<KisiKisiTopic, 'code' | 'title'>[];
  masteryStats: MasteryStats;
  weights?: TopicWeights;
  sessions: readonly WeeklyReportSession[];
  flashcardStats: FlashcardStats;
}

export interface WeeklyReportResult {
  markdown: string;
  readiness: ReadinessResult;
  weakAreas: WeakArea[];
  streak: StreakResult;
  /** Sessions started in the rolling 7-day window. */
  weeklySessions: number;
  /** Subset of weekly sessions with a completion timestamp. */
  completedSessions: number;
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateLabel(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('id-ID', options).format(date);
}

/** Escape values used in Markdown table cells (titles can come from imports). */
function cell(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

/**
 * Build a self-contained Markdown report from the same metrics used by the
 * dashboard. Session activity is a rolling 7-day window ending at generatedAt.
 */
export function buildWeeklyReport(input: WeeklyReportInput): WeeklyReportResult {
  const generatedAt = input.generatedAt && Number.isFinite(input.generatedAt.getTime())
    ? input.generatedAt
    : new Date();
  const weights: TopicWeights = input.weights ?? APP_CONFIG.defaultTopicWeights;
  const topicCodes = input.topics.map(topic => topic.code);
  const readiness = calculateReadiness(topicCodes, input.masteryStats, weights);
  const weakAreas = calculateWeakAreas(input.topics, input.masteryStats, weights, 5);
  // Future timestamps (e.g. a clock change) must not extend the reported streak.
  const history = input.sessions.filter(session => {
    const timestamp = new Date(session.startedAt).getTime();
    return Number.isFinite(timestamp) && timestamp <= generatedAt.getTime();
  });
  const streak = calculateStreaks(history, generatedAt);

  const windowStart = new Date(generatedAt.getTime() - WEEK_DAYS * DAY_MS);
  const weekly = history.filter(session => {
    const timestamp = new Date(session.startedAt).getTime();
    return timestamp >= windowStart.getTime();
  });
  const completedSessions = weekly.filter(session => Boolean(session.completedAt)).length;

  const totalQuestions = Object.values(input.masteryStats).reduce((sum, stat) => sum + stat.total, 0);
  const totalMastered = Object.values(input.masteryStats).reduce((sum, stat) => sum + stat.mastered, 0);
  const masteryRate = totalQuestions > 0 ? Math.round((totalMastered / totalQuestions) * 100) : 0;
  const flashcardTotal = Object.values(input.flashcardStats).reduce((sum, count) => sum + count, 0);
  const modeCounts = (Object.keys(MODE_LABELS) as SessionMode[]).map(mode =>
    `${MODE_LABELS[mode]}: ${weekly.filter(session => session.mode === mode).length}`
  ).join(' • ');

  const perTopicRows = input.topics.map(topic => {
    const stat = input.masteryStats[topic.code];
    const level = getMasteryLevel(stat?.avgMastery);
    return [topic.code, topic.title, `${getMasteryPercent(level)}%`, `${level} (${getMasteryLabel(level)})`, stat?.total ?? 0, weights[topic.code] ?? 1];
  });

  const weakAreaRows = weakAreas.map((area, index) => [
    index + 1,
    area.topicCode,
    area.title,
    `${area.masteryPercent}%`,
    area.weaknessScore.toFixed(3),
    area.weight,
  ]);

  const days = Array.from({ length: WEEK_DAYS }, (_, index) => {
    const date = new Date(
      generatedAt.getFullYear(),
      generatedAt.getMonth(),
      generatedAt.getDate() - (WEEK_DAYS - 1 - index)
    );
    const key = localDayKey(date);
    const sessionsOnDay = weekly.filter(session => localDayKey(new Date(session.startedAt)) === key);
    return [
      dateLabel(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
      sessionsOnDay.length,
      sessionsOnDay.filter(session => Boolean(session.completedAt)).length,
    ];
  });

  const recommendation = weakAreas.length > 0
    ? `Fokuskan latihan pada 3 prioritas teratas: ${weakAreas.slice(0, 3).map(area => `${area.topicCode} (${area.title})`).join(', ')}.`
    : 'Semua topik berada pada kemahiran maksimal. Validasi kesiapan dengan ujian CAT penuh.';

  const generatedLabel = dateLabel(generatedAt, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const shortDate = (date: Date): string => dateLabel(date, { day: 'numeric', month: 'long', year: 'numeric' });

  const markdown = [
    `# ${APP_CONFIG.name} — Laporan Mingguan`,
    '',
    `**Dibuat:** ${generatedLabel}  `,
    `**Periode aktivitas:** ${shortDate(windowStart)} – ${shortDate(generatedAt)} (7 hari terakhir)  `,
    `**Aplikasi:** ${APP_CONFIG.name} v${APP_CONFIG.version}`,
    '',
    '## Ringkasan Kesiapan',
    '',
    table(['Metrik', 'Nilai'], [
      ['Skor kesiapan keseluruhan', `${readiness.percent}%`],
      ['Tingkat kesiapan', READINESS_LABELS[readiness.band]],
      ['Estimasi skor CAT (berbobot)', `${readiness.estimatedCatScore}%`],
      ['Cakupan topik terlatih', `${readiness.coveredTopics}/${readiness.totalTopics} (${readiness.confidencePercent}%)`],
      ['Streak saat ini', `${streak.current} hari`],
      ['Streak terlama', `${streak.longest} hari`],
    ]),
    '',
    '## Ringkasan Data',
    '',
    table(['Sumber', 'Jumlah'], [
      ['Topik kisi-kisi', input.topics.length],
      ['Soal di bank', totalQuestions],
      ['Soal mahir', `${totalMastered} (${masteryRate}%)`],
      ['Sesi dibaca dari riwayat', history.length],
      ['Sesi minggu ini', `${weekly.length} (${completedSessions} selesai)`],
      ['Kartu flashcard', flashcardTotal],
    ]),
    '',
    '## Kemahiran per Topik',
    '',
    table(['Kode', 'Topik', 'Kemahiran', 'Level', 'Soal', 'Bobot'], perTopicRows),
    '',
    '## Area Lemah Prioritas',
    '',
    weakAreas.length > 0
      ? table(['#', 'Kode', 'Topik', 'Kemahiran', 'Skor prioritas', 'Bobot'], weakAreaRows)
      : 'Tidak ada area lemah signifikan.',
    '',
    '## Aktivitas 7 Hari Terakhir',
    '',
    `- Total sesi: ${weekly.length}`,
    `- Sesi selesai: ${completedSessions}`,
    `- Berdasarkan mode: ${modeCounts}`,
    '',
    table(['Tanggal', 'Sesi', 'Selesai'], days),
    '',
    '## Kartu Flashcard',
    '',
    `- Jatuh tempo: ${input.flashcardStats.due}`,
    `- Baru: ${input.flashcardStats.new}`,
    `- Belajar: ${input.flashcardStats.learning}`,
    `- Review: ${input.flashcardStats.review}`,
    `- Matang: ${input.flashcardStats.mature}`,
    '',
    '## Rekomendasi',
    '',
    recommendation,
    '',
    '---',
    `*Dibuat otomatis oleh ${APP_CONFIG.name} v${APP_CONFIG.version} pada ${generatedLabel}.*`,
    '',
  ].join('\n');

  return { markdown, readiness, weakAreas, streak, weeklySessions: weekly.length, completedSessions };
}

/** Stable, filesystem-safe filename for the generated Markdown file. */
export function weeklyReportFilename(generatedAt: Date = new Date()): string {
  const year = generatedAt.getFullYear();
  const month = String(generatedAt.getMonth() + 1).padStart(2, '0');
  const day = String(generatedAt.getDate()).padStart(2, '0');
  return `weekly-report-${year}-${month}-${day}.md`;
}

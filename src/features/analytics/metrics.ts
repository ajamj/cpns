// Pure analytics calculations shared by the dashboard and analytics views.
// Keep this module free of DOM/IndexedDB imports so the scoring rules can be
// unit-tested directly (and reused by report/certificate generators).
import { APP_CONFIG } from '../../core/config';
import type { KisiKisiTopic } from '../../shared/types';

export type MasteryLevelValue = 0 | 1 | 2 | 3;

export interface TopicMasteryStat {
  total: number;
  mastered: number;
  learning: number;
  new: number;
  avgMastery: number;
}

export type MasteryStats = Record<string, TopicMasteryStat>;
export type TopicWeights = Record<string, number>;

export interface ReadinessResult {
  /** Unweighted average topic level expressed as 0-100. */
  percent: number;
  /** 0 = Belum Siap, 1 = Perlu Ulang, 2 = Siap. */
  band: 0 | 1 | 2;
  /** Weighted estimate of the CAT score (0-100). */
  estimatedCatScore: number;
  coveredTopics: number;
  totalTopics: number;
  /** Percentage of topics that have at least one question. */
  confidencePercent: number;
}

export interface WeakArea {
  topicCode: string;
  title: string;
  masteryLevel: MasteryLevelValue;
  masteryPercent: number;
  /** (1 - level / 3) * topic weight — higher means higher priority. */
  weaknessScore: number;
  weight: number;
  total: number;
}

export interface StreakResult {
  current: number;
  longest: number;
  activeDays: number;
}

/**
 * One answer in the mastery history, already joined to its topic and to the
 * local calendar day of the session it belongs to. Keeping this shape free of
 * Dexie/DOM types lets the trend calculation be unit-tested directly.
 */
export interface MasteryTrendAnswer {
  questionId: string;
  topicCode: string;
  /** Local date key (YYYY-MM-DD) from the session's startedAt. */
  date: string;
  isCorrect: boolean;
  /** ISO timestamp used only to replay answers in chronological order. */
  timestamp: string;
}

export interface MasteryTrendPoint {
  date: string;
  /** Average 0-3 mastery of the distinct questions answered that day. */
  overall: number | null;
  /** Per-topic averages for the same day; absent topics are omitted. */
  topics: Record<string, number | null>;
  answered: number;
}

export interface TrendLine {
  start: number;
  end: number;
  slope: number;
}

/** Convert a topic's 0-1 average mastery into a discrete 0-3 level. */
export function getMasteryLevel(avgMastery: number | undefined): MasteryLevelValue {
  if (!avgMastery || !Number.isFinite(avgMastery)) return 0;
  const clamped = Math.min(1, Math.max(0, avgMastery));
  return Math.round(clamped * 3) as MasteryLevelValue;
}

/** Progress-bar percentage for a level (level 3 = 100%). */
export function getMasteryPercent(level: MasteryLevelValue): number {
  return Math.round((level / 3) * 100);
}

/**
 * Readiness over the full kisi-kisi topic list: average of the per-topic
 * mastery levels divided by 3. Topics without questions count as level 0, so
 * the score describes readiness for the whole exam rather than only the parts
 * the student happened to open.
 */
export function calculateReadiness(
  topicCodes: readonly string[],
  stats: MasteryStats,
  weights: TopicWeights = APP_CONFIG.defaultTopicWeights,
): ReadinessResult {
  if (topicCodes.length === 0) {
    return {
      percent: 0,
      band: 0,
      estimatedCatScore: 0,
      coveredTopics: 0,
      totalTopics: 0,
      confidencePercent: 0,
    };
  }

  let levelSum = 0;
  let weightedLevelSum = 0;
  let weightSum = 0;
  let coveredTopics = 0;

  for (const code of topicCodes) {
    const stat = stats[code];
    const level = getMasteryLevel(stat?.avgMastery);
    const weight = weights[code] ?? (code.startsWith('KH-') ? 1.5 : 1);
    levelSum += level;
    weightedLevelSum += level * weight;
    weightSum += weight;
    if ((stat?.total ?? 0) > 0) coveredTopics++;
  }

  const percent = Math.round((levelSum / (topicCodes.length * 3)) * 100);
  const estimatedCatScore = weightSum > 0
    ? Math.round((weightedLevelSum / (weightSum * 3)) * 100)
    : percent;

  return {
    percent,
    band: percent <= 33 ? 0 : percent <= 66 ? 1 : 2,
    estimatedCatScore,
    coveredTopics,
    totalTopics: topicCodes.length,
    confidencePercent: Math.round((coveredTopics / topicCodes.length) * 100),
  };
}

/**
 * Top-N topics to study next, ranked by (1 - mastery level / 3) * weight.
 * KH topics therefore outrank UM topics at equal mastery. Ties are broken by
 * weaker mastery, then code, so the panel is deterministic.
 */
export function calculateWeakAreas(
  topics: readonly Pick<KisiKisiTopic, 'code' | 'title'>[],
  stats: MasteryStats,
  weights: TopicWeights = APP_CONFIG.defaultTopicWeights,
  limit = 5,
): WeakArea[] {
  return topics
    .map((topic) => {
      const stat = stats[topic.code];
      const masteryLevel = getMasteryLevel(stat?.avgMastery);
      const weight = weights[topic.code] ?? (topic.code.startsWith('KH-') ? 1.5 : 1);
      return {
        topicCode: topic.code,
        title: topic.title,
        masteryLevel,
        masteryPercent: getMasteryPercent(masteryLevel),
        weaknessScore: Number((((3 - masteryLevel) / 3) * weight).toFixed(3)),
        weight,
        total: stat?.total ?? 0,
      };
    })
    .sort((a, b) =>
      b.weaknessScore - a.weaknessScore ||
      a.masteryLevel - b.masteryLevel ||
      a.topicCode.localeCompare(b.topicCode)
    )
    .slice(0, Math.max(0, limit));
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayKeyToUtcMs(key: string): number {
  const [year = 0, month = 0, day = 0] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(key: string, delta: number): string {
  const shifted = new Date(dayKeyToUtcMs(key) + delta * 86_400_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Consecutive study days from session start timestamps. A gap of one day is
 * still a live streak (today's session may not have happened yet), longer gaps
 * end it. Longest streak is measured over the whole supplied history.
 */
export function calculateStreaks(
  sessions: readonly { startedAt?: string | null }[],
  now: Date = new Date(),
): StreakResult {
  const activeDays = new Set<string>();
  for (const session of sessions) {
    if (!session.startedAt) continue;
    const timestamp = new Date(session.startedAt).getTime();
    if (!Number.isFinite(timestamp)) continue;
    activeDays.add(localDateKey(new Date(timestamp)));
  }

  if (activeDays.size === 0) {
    return { current: 0, longest: 0, activeDays: 0 };
  }

  let cursor = localDateKey(now);
  if (!activeDays.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!activeDays.has(cursor)) {
      cursor = '';
    }
  }

  let current = 0;
  while (cursor && activeDays.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of [...activeDays].sort()) {
    run = previous && dayKeyToUtcMs(day) - dayKeyToUtcMs(previous) === 86_400_000
      ? run + 1
      : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest, activeDays: activeDays.size };
}

function averageLevel(levels: ReadonlyMap<string, number>): number | null {
  if (levels.size === 0) return null;
  let sum = 0;
  for (const level of levels.values()) sum += level;
  return Number((sum / levels.size).toFixed(2));
}

/**
 * Reconstruct a 0-3 mastery timeline by replaying the answer log the same way
 * questionsRepo.updateMastery does (+1 for correct, -1 for wrong, clamped).
 * Answers before the requested window are replayed too, so the first visible
 * point already reflects the learner's actual level rather than starting at 0.
 * Days without activity are returned as `null` so the chart can break or span
 * gaps intentionally.
 */
export function calculateMasteryTrend(
  answers: readonly MasteryTrendAnswer[],
  windowDays = 30,
  now: Date = new Date(),
): MasteryTrendPoint[] {
  const days = Math.max(1, Math.floor(windowDays));
  const today = localDateKey(now);
  const firstDay = addDays(today, -(days - 1));

  const sorted = answers
    .filter(answer => Number.isFinite(new Date(answer.timestamp).getTime()))
    .slice()
    .sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() ||
      a.questionId.localeCompare(b.questionId)
    );

  const levels = new Map<string, number>();
  const byDate = new Map<string, {
    overall: Map<string, number>;
    topics: Map<string, Map<string, number>>;
  }>();

  for (const answer of sorted) {
    const current = levels.get(answer.questionId) ?? 0;
    const next = Math.max(0, Math.min(3, current + (answer.isCorrect ? 1 : -1)));
    levels.set(answer.questionId, next);

    if (answer.date < firstDay || answer.date > today) continue;

    let bucket = byDate.get(answer.date);
    if (!bucket) {
      bucket = { overall: new Map(), topics: new Map() };
      byDate.set(answer.date, bucket);
    }
    bucket.overall.set(answer.questionId, next);
    let topicLevels = bucket.topics.get(answer.topicCode);
    if (!topicLevels) {
      topicLevels = new Map();
      bucket.topics.set(answer.topicCode, topicLevels);
    }
    topicLevels.set(answer.questionId, next);
  }

  const points: MasteryTrendPoint[] = [];
  for (let index = 0; index < days; index++) {
    const date = addDays(firstDay, index);
    const bucket = byDate.get(date);
    const topics: Record<string, number | null> = {};
    for (const [topicCode, topicLevels] of bucket?.topics ?? []) {
      topics[topicCode] = averageLevel(topicLevels);
    }
    points.push({
      date,
      overall: bucket ? averageLevel(bucket.overall) : null,
      topics,
      answered: bucket?.overall.size ?? 0,
    });
  }
  return points;
}

/**
 * Least-squares line over the non-empty points of a trend. The first and last
 * values are endpoints across the whole window, which lets Chart.js draw the
 * line by putting them at index 0 and index N-1 with `spanGaps: true`.
 */
export function calculateTrendLine(values: readonly (number | null)[]): TrendLine | null {
  const known: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value !== null && Number.isFinite(value)) known.push({ x: index, y: value });
  });
  if (known.length === 0) return null;
  if (known.length === 1) return { start: known[0]!.y, end: known[0]!.y, slope: 0 };

  const meanX = known.reduce((sum, point) => sum + point.x, 0) / known.length;
  const meanY = known.reduce((sum, point) => sum + point.y, 0) / known.length;
  const denominator = known.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator === 0) return null;

  const slope = known.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0
  ) / denominator;
  const intercept = meanY - slope * meanX;
  const lastIndex = values.length - 1;
  return {
    start: Number(intercept.toFixed(3)),
    end: Number((intercept + slope * lastIndex).toFixed(3)),
    slope: Number(slope.toFixed(4)),
  };
}

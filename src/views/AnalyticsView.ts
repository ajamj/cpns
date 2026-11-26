// Analytics View — mastery dashboard, readiness score, weak areas, streak and trends.
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartConfigurationCustomTypesPerDataset,
} from 'chart.js';
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { db } from '../db/schema';
import {
  loadKisiKisi,
  getMasteryLabel,
  getMasteryColor,
  getSubdomainColor,
  getKisiKisiSync,
} from '../features/kisi-kisi/registry';
import {
  calculateReadiness,
  calculateStreaks,
  calculateWeakAreas,
  calculateMasteryTrend,
  calculateTrendLine,
  getMasteryLevel,
  getMasteryPercent,
  type MasteryStats,
  type MasteryTrendAnswer,
  type ReadinessResult,
  type StreakResult,
  type WeakArea,
} from '../features/analytics/metrics';
import {
  buildWeeklyReport,
  weeklyReportFilename,
  type FlashcardStats,
} from '../features/analytics/weekly-report';
import { APP_CONFIG } from '../core/config';
import { getLocale, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import type { KisiKisiTopic, Session } from '../shared/types';

/** Window of recent sessions used for the activity list, streaks and heatmap. */
const SESSION_WINDOW = 1000;
/** Window passed to sessionsRepo for the weekly report and certificate (Tasks 6/7). */
const REPORT_SESSION_WINDOW = 500;
/** A year of activity: 53 Monday-first weeks (the current week included). */
const HEATMAP_WEEKS = 53;
const DAYS_PER_WEEK = 7;
/** Trend answer log cap — enough for years of practice on an offline device. */
const MAX_TREND_ATTEMPTS = 10_000;
const TREND_WINDOWS = [30, 90] as const;
type TrendWindow = (typeof TREND_WINDOWS)[number];
/** Recent sessions read for the mock-exam score chart (Phase 4, Task 4). */
const MOCK_SCORE_SESSION_WINDOW = 200;
/** The mock-exam score chart always spans the last 30 local calendar days. */
const MOCK_SCORE_DAYS = 30;

// Tree-shaken Chart.js registration: only the pieces the charts need.
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

type HeatmapLevel = 0 | 1 | 2 | 3;

interface HeatmapDay {
  key: string;
  count: number;
  level: HeatmapLevel;
  future: boolean;
  tooltip: string;
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Topic titles in the Markdown preview must never be injected as HTML. */
function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function activityLevel(count: number): HeatmapLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

const READINESS_BAND_CLASSES = ['badge-danger', 'badge-warning', 'badge-success'] as const;
const READINESS_BAND_COLORS = [
  'var(--color-danger)',
  'var(--color-warning)',
  'var(--color-success)',
] as const;

export class AnalyticsView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private topics: KisiKisiTopic[] = [];
  private weights: Record<string, number> = { ...APP_CONFIG.defaultTopicWeights };
  private masteryStats: MasteryStats = {};
  private recentSessions: Session[] = [];
  private flashcardStats: FlashcardStats = { due: 0, new: 0, learning: 0, review: 0, mature: 0 };
  private reportSessions: Session[] = [];
  private reportMarkdown = '';
  private reportGeneratedAt = new Date();
  private certificateGeneratedAt = new Date();
  private weakAreas: WeakArea[] = [];
  private readiness: ReadinessResult = calculateReadiness([], {});
  private streaks: StreakResult = { current: 0, longest: 0, activeDays: 0 };
  private activityCounts: Map<string, number> = new Map();
  private masteryAnswers: MasteryTrendAnswer[] = [];
  private trendWindow: TrendWindow = 30;
  private trendTopic = 'all';
  private masteryChart: Chart | null = null;
  private mockScoreSessions: Session[] = [];
  private mockScoreChart: Chart | null = null;

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  private getReadinessHTML(): string {
    const { percent, band, estimatedCatScore, coveredTopics, totalTopics, confidencePercent } = this.readiness;
    const color = READINESS_BAND_COLORS[band];
    const badgeClass = READINESS_BAND_CLASSES[band];

    return `
      <div class="card readiness-card">
        <div class="card-header"><h2 class="card-title">${t('analytics.readiness')}</h2></div>
        <div class="card-content">
          <div class="readiness-layout">
            <div class="readiness-ring" style="--readiness-value:${percent}%;--readiness-color:${color};"
                 role="img" aria-label="${t('analytics.readiness')}: ${percent}%">
              <div class="readiness-ring-inner">
                <span class="readiness-ring-value">${percent}%</span>
                <span class="readiness-ring-label">${t('analytics.readiness')}</span>
              </div>
            </div>
            <div class="readiness-details">
              <span class="badge ${badgeClass} readiness-badge">${t(`analytics.readinessLevels.${band}`)}</span>
              <div class="readiness-estimate">${t('analytics.estimatedScore', { score: estimatedCatScore })}</div>
              <div class="readiness-confidence">
                <div class="readiness-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                     aria-valuenow="${confidencePercent}" aria-label="Cakupan topik terlatih">
                  <div class="readiness-meter-fill" style="width:${confidencePercent}%"></div>
                </div>
                <span>${coveredTopics}/${totalTopics} ${t('analytics.byTopic').toLowerCase()} terlatih</span>
              </div>
              <div class="readiness-actions">
                <a href="#/practice?weak=true" class="btn btn-primary">${t('practice.title')} Area Lemah</a>
                <a href="#/mock-exam" class="btn btn-secondary">${t('mock.title')}</a>
                <a href="#/flashcards" class="btn btn-secondary">${t('flash.title')}</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getStatsHTML(): string {
    const totalQuestions = Object.values(this.masteryStats).reduce((sum, s) => sum + s.total, 0);
    const totalMastered = Object.values(this.masteryStats).reduce((sum, s) => sum + s.mastered, 0);

    return `
      <div class="analytics-stats-grid">
        <div class="card"><div class="card-content stat-card">
          <div class="stat-icon stat-icon-blue"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg></div>
          <div><div class="stat-value">${totalQuestions}</div><div class="stat-label">Total Soal</div></div>
        </div></div>
        <div class="card"><div class="card-content stat-card">
          <div class="stat-icon stat-icon-green"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></div>
          <div><div class="stat-value">${totalMastered}</div><div class="stat-label">Soal Mahir</div></div>
        </div></div>
        <div class="card"><div class="card-content stat-card streak-card">
          <div class="stat-icon stat-icon-amber"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div>
            <div class="stat-value">${this.streaks.current} 🔥</div>
            <div class="stat-label">${t('analytics.currentStreak', { days: this.streaks.current })}</div>
            <div class="stat-hint">${t('analytics.longestStreak', { days: this.streaks.longest })}</div>
          </div>
        </div></div>
        <div class="card"><div class="card-content stat-card">
          <div class="stat-icon" style="background:var(--color-primary-light);color:var(--color-primary);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/></svg></div>
          <div><div class="stat-value">${this.recentSessions.length}</div><div class="stat-label">Sesi Terbaru</div></div>
        </div></div>
      </div>
    `;
  }

  /**
   * Build 53 Monday-first weeks ending with the current week. Counts come
   * from the same session window as the streak calculation, so the calendar
   * and the streak counters can never disagree.
   */
  private getHeatmapDays(): HeatmapDay[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mondayOffset = (today.getDay() + 6) % DAYS_PER_WEEK;
    const firstDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - mondayOffset - (HEATMAP_WEEKS - 1) * DAYS_PER_WEEK
    );
    const locale = getLocale() === 'en' ? 'en-US' : 'id-ID';
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const sessionWord = getLocale() === 'en' ? 'sessions' : 'sesi';
    const days: HeatmapDay[] = [];

    for (let index = 0; index < HEATMAP_WEEKS * DAYS_PER_WEEK; index++) {
      const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index);
      const future = date.getTime() > today.getTime();
      const count = future ? 0 : (this.activityCounts.get(localDateKey(date)) ?? 0);
      const dateLabel = dateFormatter.format(date);
      days.push({
        key: localDateKey(date),
        count,
        level: activityLevel(count),
        future,
        tooltip: `${dateLabel} — ${count} ${sessionWord}`,
      });
    }
    return days;
  }

  private getHeatmapHTML(): string {
    const days = this.getHeatmapDays();
    const isEnglish = getLocale() === 'en';
    const locale = isEnglish ? 'en-US' : 'id-ID';
    const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 1 Jan 2024 was a Monday — a stable anchor for short weekday labels.
    const weekdayLabels = Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
      weekdayFormatter.format(new Date(2024, 0, 1 + index))
    );
    const activeDaysThisYear = days.reduce((sum, day) => sum + (day.count > 0 ? 1 : 0), 0);
    const latestMonth = days[days.length - 1]?.key.slice(0, 7) ?? '';
    const earliestMonth = days[0]?.key.slice(0, 7) ?? '';

    return `
      <div class="streak-heatmap">
        <div class="streak-summary">
          <span class="streak-summary-item streak-summary-current">🔥 <strong>${this.streaks.current}</strong> ${isEnglish ? 'day streak' : 'hari berturut-turut'}</span>
          <span class="streak-summary-item">${isEnglish ? 'Best' : 'Rekor terbaik'}: <strong>${this.streaks.longest}</strong> ${isEnglish ? 'days' : 'hari'} 🏆</span>
          <span class="streak-summary-item">${activeDaysThisYear} ${isEnglish ? 'active days' : 'hari aktif'} (${earliestMonth} – ${latestMonth})</span>
        </div>
        <div class="streak-heatmap-body">
          <div class="streak-heatmap-weekdays" aria-hidden="true">${weekdayLabels.map(label => `<span>${label}</span>`).join('')}</div>
          <div class="streak-heatmap-grid" role="list" aria-label="${t('analytics.heatmap')}: ${activeDaysThisYear} ${isEnglish ? 'sessions' : 'sesi'}">
            ${days.map(day => day.future
              ? `<span class="streak-heatmap-cell is-future" aria-hidden="true"></span>`
              : `<span class="streak-heatmap-cell heatmap-level-${day.level}" role="listitem"${day.count > 0 ? ' tabindex="0"' : ''}
                    data-level="${day.level}" title="${day.tooltip}" aria-label="${day.tooltip}"></span>`
            ).join('')}
          </div>
        </div>
        <div class="streak-heatmap-legend" aria-hidden="true">
          <span>${isEnglish ? 'Less' : 'Sedikit'}</span>
          ${[0, 1, 2, 3].map(level => `<span class="streak-heatmap-cell heatmap-level-${level}"></span>`).join('')}
          <span>${isEnglish ? 'More' : 'Banyak'}</span>
        </div>
      </div>
    `;
  }

  private getWeakAreasHTML(): string {
    if (this.weakAreas.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><div class="empty-state-title">Tidak ada area lemah signifikan</div><div class="empty-state-description">Semua topik memiliki kemahiran yang baik. Lanjutkan belajar!</div></div>`;
    }

    return `<div class="weak-area-list">${this.weakAreas.map((weak, index) => `
      <a href="#/practice?topic=${encodeURIComponent(weak.topicCode)}"
         class="weak-area-item" style="--mastery-color:${getMasteryColor(weak.masteryLevel)};--topic-color:${getSubdomainColor(weak.topicCode)};--weak-progress:${weak.masteryPercent}%">
        <span class="weak-area-rank" aria-hidden="true">${index + 1}</span>
        <span class="weak-area-progress" role="img" aria-label="Kemahiran ${weak.masteryPercent}%">
          <span class="weak-area-progress-value">${weak.masteryPercent}%</span>
        </span>
        <span class="weak-area-info">
          <span class="weak-area-title">${weak.title}</span>
          <span class="weak-area-meta">${weak.topicCode} • ${t('analytics.byTopic')} • bobot ${weak.weight}x • prioritas ${weak.weaknessScore.toFixed(2)}</span>
          <span class="weak-area-bar"><span style="width:${weak.masteryPercent}%"></span></span>
        </span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    `).join('')}</div>`;
  }

  private getRecentSessionsHTML(): string {
    if (this.recentSessions.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/></svg><div class="empty-state-title">${t('practice.title')} Belum Ada Sesi</div><div class="empty-state-description">Mulai latihan atau ujian CAT pertama Anda untuk melihat riwayat di sini.</div></div>`;
    }
    return this.recentSessions.slice(0, 10).map(s => {
      const modeLabels: Record<string, string> = { practice: t('practice.title'), 'mock-exam': t('mock.title'), flashcard: t('flash.title') };
      const score = s.summary ? `${s.summary.scorePercent}%` : '-';
      const date = new Date(s.startedAt).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="session-row">
          <div class="session-row-main">
            <span class="badge badge-${s.mode === 'mock-exam' ? 'danger' : s.mode === 'practice' ? 'primary' : 'success'}">${modeLabels[s.mode] || s.mode}</span>
            <div><div style="font-weight:var(--font-medium);">${s.topicCodes.join(', ')}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${date}</div></div>
          </div>
          <div style="text-align:right;"><div style="font-weight:var(--font-bold);font-size:var(--text-lg);color:var(--color-primary);">${score}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${s.summary ? `${s.summary.correctAnswers}/${s.summary.totalQuestions}` : ''}</div></div>
        </div>
      `;
    }).join('');
  }

  private getMasteryGridHTML(): string {
    if (this.topics.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8);"><div class="empty-state-title">${t('analytics.masteryGrid')}</div><div class="empty-state-description">Data kisi-kisi belum tersedia.</div></div>`;
    }

    return `
      <div class="mastery-grid" role="list" aria-label="${t('analytics.masteryGrid')}">
        ${this.topics.map(topic => {
          const stats = this.masteryStats[topic.code];
          const level = getMasteryLevel(stats?.avgMastery);
          const percent = getMasteryPercent(level);
          const label = getMasteryLabel(level);
          const count = stats?.total ?? 0;
          return `
            <a href="#/practice?topic=${encodeURIComponent(topic.code)}"
               class="mastery-tile mastery-tile--level-${level}"
               style="--mastery-color:${getMasteryColor(level)};--topic-color:${getSubdomainColor(topic.code)}"
               role="listitem" title="${topic.title} (${topic.subdomain})"
               aria-label="${topic.code} ${topic.title}: ${label}, ${percent}%">
              <span class="mastery-tile-head">
                <span class="badge badge-topic">${topic.code}</span>
                <span class="mastery-tile-count">${count} soal</span>
              </span>
              <span class="mastery-tile-title">${topic.title}</span>
              <span class="mastery-tile-footer">
                <span class="badge badge-mastery-${level}">${label}</span>
                <span class="mastery-tile-percent">${percent}%</span>
              </span>
              <span class="mastery-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                    aria-valuenow="${percent}" aria-label="${topic.code} ${label}">
                <span class="mastery-progress-fill" style="width:${percent}%"></span>
              </span>
            </a>
          `;
        }).join('')}
      </div>
    `;
  }

  /** Topic options are taken from the 90-day history so 30/90 switching never loses a selection. */
  private getTrendTopicOptions(): string {
    const seen = new Set<string>();
    for (const point of calculateMasteryTrend(this.masteryAnswers, 90)) {
      for (const code of Object.keys(point.topics)) seen.add(code);
    }
    const label = getLocale() === 'en' ? 'All topics' : 'Semua topik';
    const options = [`<option value="all"${this.trendTopic === 'all' ? ' selected' : ''}>${label}</option>`];
    for (const code of [...seen].sort()) {
      const title = this.topics.find(topic => topic.code === code)?.title ?? code;
      options.push(
        `<option value="${code}"${this.trendTopic === code ? ' selected' : ''}>${code} — ${title}</option>`
      );
    }
    return options.join('');
  }

  private getMasteryTrendHTML(): string {
    const isEnglish = getLocale() === 'en';
    return `
      <section class="card mastery-trend-card" aria-labelledby="masteryTrendTitle">
        <div class="card-header mastery-trend-header">
          <h2 class="card-title" id="masteryTrendTitle">${isEnglish ? 'Mastery by Topic (30/90 days)' : 'Kemahiran per Topik (30/90 hari)'}</h2>
          <div class="mastery-trend-range" role="group" aria-label="${isEnglish ? 'Trend window' : 'Rentang tren'}">
            ${TREND_WINDOWS.map(days => `
              <button type="button" class="btn btn-sm ${this.trendWindow === days ? 'btn-primary is-active' : 'btn-secondary'}"
                      data-trend-range="${days}" aria-pressed="${this.trendWindow === days}">${days} ${isEnglish ? 'days' : 'hari'}</button>
            `).join('')}
          </div>
        </div>
        <div class="card-content">
          <div class="mastery-trend-toolbar">
            <label for="masteryTrendTopic">${isEnglish ? 'Topic' : 'Topik'}</label>
            <select id="masteryTrendTopic" class="form-select">${this.getTrendTopicOptions()}</select>
          </div>
          <div class="mastery-trend-canvas-wrap">
            <canvas id="masteryTrendChart" role="img"
              aria-label="${isEnglish ? 'Line chart of average mastery level (0-3) over recent days' : 'Grafik garis rata-rata tingkat kemahiran (0-3) beberapa hari terakhir'}">
              ${isEnglish ? 'Mastery trend chart' : 'Grafik tren kemahiran'}
            </canvas>
          </div>
          <p class="mastery-trend-empty" id="masteryTrendEmpty" hidden>
            ${isEnglish ? 'No answers in this period yet. Complete a practice session to see the trend.' : 'Belum ada jawaban pada periode ini. Selesaikan sesi latihan untuk melihat tren.'}
          </p>
          <p class="mastery-trend-caption" id="masteryTrendSummary" aria-live="polite"></p>
        </div>
      </section>
    `;
  }

  /**
   * Build (or rebuild) the Chart.js line chart. Called after data load and on
   * every range/topic change so the chart always reflects the current selection.
   */
  private renderMasteryChart(): void {
    const canvas = this.element?.querySelector<HTMLCanvasElement>('#masteryTrendChart');
    const empty = this.element?.querySelector<HTMLElement>('#masteryTrendEmpty');
    const summary = this.element?.querySelector<HTMLElement>('#masteryTrendSummary');
    if (!canvas || !empty || !summary) return;

    this.masteryChart?.destroy();
    this.masteryChart = null;

    const isEnglish = getLocale() === 'en';
    const points = calculateMasteryTrend(this.masteryAnswers, this.trendWindow);
    const relevant = points.filter(point => this.trendTopic === 'all'
      ? point.overall !== null
      : point.topics[this.trendTopic] != null);
    const selectedValues = relevant.map(point => this.trendTopic === 'all'
      ? point.overall
      : point.topics[this.trendTopic] ?? null);
    const trend = calculateTrendLine(selectedValues);

    if (relevant.length === 0) {
      empty.hidden = false;
      canvas.hidden = true;
      summary.textContent = isEnglish
        ? 'No mastery data for the selected topic and period.'
        : 'Belum ada data kemahiran untuk topik dan periode yang dipilih.';
      return;
    }
    empty.hidden = true;
    canvas.hidden = false;

    const locale = isEnglish ? 'en-US' : 'id-ID';
    const labels = points.map(point =>
      new Date(`${point.date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    );
    const label = this.trendTopic === 'all'
      ? (isEnglish ? 'Average mastery' : 'Rata-rata kemahiran')
      : (this.topics.find(topic => topic.code === this.trendTopic)?.title ?? this.trendTopic);
    const lineData: (number | null)[] = points.map(point => this.trendTopic === 'all'
      ? point.overall
      : point.topics[this.trendTopic] ?? null);
    const trendData: (number | null)[] = new Array(points.length).fill(null);
    if (trend) {
      trendData[0] = trend.start;
      if (points.length > 1) trendData[points.length - 1] = trend.end;
    }

    const config: ChartConfiguration<'line', (number | null)[], string> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label,
            data: lineData,
            borderColor: '#1e3a5f',
            backgroundColor: 'rgba(30, 58, 95, 0.12)',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: isEnglish ? 'Trend' : 'Tren',
            data: trendData,
            borderColor: '#0e7490',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            min: 0,
            max: 3,
            ticks: {
              stepSize: 1,
              color: '#55657a',
              callback: value => {
                const level = Number(value);
                if (level === 0) return isEnglish ? 'New' : 'Baru';
                if (level === 1) return isEnglish ? 'Learning' : 'Belajar';
                if (level === 2) return isEnglish ? 'Review' : 'Ulang';
                return isEnglish ? 'Mastered' : 'Mahir';
              },
            },
            grid: { color: '#e2e8f0' },
          },
          x: {
            ticks: { color: '#55657a', maxTicksLimit: 10, autoSkip: true },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#0f172a', boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: items => points[items[0]?.dataIndex ?? 0]?.date ?? '',
              label: item => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)} / 3`,
            },
          },
        },
      },
    };

    this.masteryChart = new Chart(canvas, config);

    const answered = relevant.reduce((sum, point) => sum + point.answered, 0);
    const latest = selectedValues[selectedValues.length - 1];
    const direction = trend && Math.abs(trend.slope) >= 0.001
      ? (trend.slope > 0 ? (isEnglish ? 'improving' : 'meningkat') : (isEnglish ? 'declining' : 'menurun'))
      : (isEnglish ? 'stable' : 'stabil');
    summary.textContent = isEnglish
      ? `${answered} answers on ${relevant.length} active days · latest ${Number(latest ?? 0).toFixed(2)}/3 · ${direction}`
      : `${answered} jawaban pada ${relevant.length} hari aktif · terakhir ${Number(latest ?? 0).toFixed(2)}/3 · ${direction}`;
  }

  /** One point per local calendar day; null means no mock exam that day. */
  private getMockScorePoints(): Array<{ date: string; score: number | null; count: number }> {
    const now = new Date();
    const firstDay = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() - (MOCK_SCORE_DAYS - 1)
    );
    const scoresByDate = new Map<string, number[]>();

    for (const session of this.mockScoreSessions) {
      if (session.mode !== 'mock-exam' || !session.startedAt || !session.summary) continue;
      const started = new Date(session.startedAt);
      const score = session.summary.scorePercent;
      if (!Number.isFinite(started.getTime()) || !Number.isFinite(score)) continue;
      const values = scoresByDate.get(localDateKey(started)) ?? [];
      values.push(Math.min(100, Math.max(0, score)));
      scoresByDate.set(localDateKey(started), values);
    }

    return Array.from({ length: MOCK_SCORE_DAYS }, (_, index) => {
      const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index);
      const key = localDateKey(date);
      const values = scoresByDate.get(key) ?? [];
      const average = values.length > 0
        ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
        : null;
      return { date: key, score: average, count: values.length };
    });
  }

  private getMockScoreChartHTML(): string {
    const isEnglish = getLocale() === 'en';
    return `
      <section class="card mock-score-card" aria-labelledby="mockScoreTitle">
        <div class="card-header">
          <h2 class="card-title" id="mockScoreTitle">${isEnglish ? 'Mock Exam Scores per Day' : 'Skor Ujian Mock per Hari'}</h2>
          <span class="badge badge-danger">${MOCK_SCORE_DAYS} ${isEnglish ? 'days' : 'hari'}</span>
        </div>
        <div class="card-content">
          <div class="mock-score-canvas-wrap">
            <canvas id="mockExamScoresChart" role="img"
              aria-label="${isEnglish ? 'Bar chart of average mock exam score (0-100) per day over the last 30 days' : 'Grafik batang rata-rata skor ujian mock (0-100) per hari pada 30 hari terakhir'}">
              ${isEnglish ? 'Mock exam score chart' : 'Grafik skor ujian mock'}
            </canvas>
          </div>
          <p class="mock-score-empty" id="mockExamScoresEmpty" hidden>
            ${isEnglish ? 'No mock exams in this period yet. Complete a mock exam to see your scores.' : 'Belum ada ujian mock pada periode ini. Selesaikan ujian mock untuk melihat skor Anda.'}
          </p>
          <p class="mock-score-caption" id="mockExamScoresSummary" aria-live="polite"></p>
        </div>
      </section>
    `;
  }

  /** Build (or rebuild) the mixed bar + trendline chart for mock exam scores. */
  private renderMockScoreChart(): void {
    const canvas = this.element?.querySelector<HTMLCanvasElement>('#mockExamScoresChart');
    const empty = this.element?.querySelector<HTMLElement>('#mockExamScoresEmpty');
    const summary = this.element?.querySelector<HTMLElement>('#mockExamScoresSummary');
    if (!canvas || !empty || !summary) return;

    this.mockScoreChart?.destroy();
    this.mockScoreChart = null;

    const isEnglish = getLocale() === 'en';
    const points = this.getMockScorePoints();
    const trend = calculateTrendLine(points.map(point => point.score));
    const active = points.filter(point => point.score !== null);

    if (active.length === 0) {
      empty.hidden = false;
      canvas.hidden = true;
      summary.textContent = isEnglish
        ? 'No mock exam scores in the last 30 days.'
        : 'Belum ada skor ujian mock dalam 30 hari terakhir.';
      return;
    }
    empty.hidden = true;
    canvas.hidden = false;

    const locale = isEnglish ? 'en-US' : 'id-ID';
    const labels = points.map(point =>
      new Date(`${point.date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    );
    const trendData: (number | null)[] = new Array(points.length).fill(null);
    if (trend) {
      trendData[0] = trend.start;
      if (points.length > 1) trendData[points.length - 1] = trend.end;
    }

    const config: ChartConfigurationCustomTypesPerDataset<'bar' | 'line', (number | null)[], string> = {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: isEnglish ? 'Average score' : 'Rata-rata skor',
            data: points.map(point => point.score),
            backgroundColor: 'rgba(30, 58, 95, 0.78)',
            hoverBackgroundColor: '#1e3a5f',
            borderRadius: 4,
            maxBarThickness: 18,
          },
          {
            type: 'line',
            label: isEnglish ? 'Trend' : 'Tren',
            data: trendData,
            borderColor: '#0e7490',
            backgroundColor: '#0e7490',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            spanGaps: true,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 25,
              color: '#55657a',
              callback: value => `${value}%`,
            },
            grid: { color: '#e2e8f0' },
          },
          x: {
            ticks: { color: '#55657a', maxTicksLimit: 10, autoSkip: true },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#0f172a', boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: items => points[items[0]?.dataIndex ?? 0]?.date ?? '',
              label: item => {
                const count = points[item.dataIndex]?.count ?? 0;
                const suffix = count > 1 ? ` (${count} ${isEnglish ? 'exams' : 'ujian'})` : '';
                return `${item.dataset.label}: ${Number(item.parsed.y)}%${suffix}`;
              },
            },
          },
        },
      },
    };

    this.mockScoreChart = new Chart(canvas, config);

    const exams = active.reduce((sum, point) => sum + point.count, 0);
    const average = Math.round(active.reduce((sum, point) => sum + (point.score ?? 0), 0) / active.length);
    const latest = active[active.length - 1]?.score ?? 0;
    const direction = trend && Math.abs(trend.slope) >= 0.1
      ? (trend.slope > 0 ? (isEnglish ? 'improving' : 'meningkat') : (isEnglish ? 'declining' : 'menurun'))
      : (isEnglish ? 'stable' : 'stabil');
    summary.textContent = isEnglish
      ? `${exams} mock exams on ${active.length} active days · average ${average}% · latest ${latest}% · ${direction}`
      : `${exams} ujian mock pada ${active.length} hari aktif · rata-rata ${average}% · terakhir ${latest}% · ${direction}`;
  }

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('nav.analytics')}</h1>
        <p class="page-subtitle">Pantau progress belajar dan identifikasi area lemah</p>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnWeeklyReport">${t('analytics.weeklyReport')}</button>
          <button class="btn btn-secondary" id="btnExportReport">${t('analytics.exportReport')}</button>
          <button class="btn btn-secondary btn-certificate" id="btnCertificate">${t('analytics.certificate')}</button>
        </div>
      </div>
      ${this.getReadinessHTML()}
      ${this.getMasteryTrendHTML()}
      ${this.getMockScoreChartHTML()}
      ${this.getStatsHTML()}
      <section class="card streak-heatmap-card">
        <div class="card-header"><h2 class="card-title">${t('analytics.heatmap')}</h2><span class="badge badge-warning">🔥 ${this.streaks.current} ${getLocale() === 'en' ? 'days' : 'hari'}</span></div>
        <div class="card-content">${this.getHeatmapHTML()}</div>
      </section>
      <div class="analytics-content-grid">
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('analytics.masteryGrid')}</h2></div>
          <div class="card-content">${this.getMasteryGridHTML()}</div>
        </section>
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('analytics.weakAreas')}</h2></div>
          <div class="card-content">${this.getWeakAreasHTML()}</div>
        </section>
      </div>
      <div class="analytics-content-grid">
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('analytics.recentSessions')}</h2><a href="#/analytics" class="btn btn-ghost btn-sm">${t('common.more')}</a></div>
          <div class="card-content">${this.getRecentSessionsHTML()}</div>
        </section>
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('flash.title')} Stats</h2></div>
          <div class="card-content"><div class="analytics-flashcard-stats">
            <div><span style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-primary);">${this.flashcardStats.due}</span><span style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.dueToday')}</span></div>
            <div><span style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-info);">${this.flashcardStats.new}</span><span style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.newCards')}</span></div>
            <div><span style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-warning);">${this.flashcardStats.learning}</span><span style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.learning')}</span></div>
            <div><span style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-success);">${this.flashcardStats.review + this.flashcardStats.mature}</span><span style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.review')} / ${t('flash.mature')}</span></div>
          </div><div style="margin-top:var(--space-4);"><a href="#/flashcards" class="btn btn-primary" style="width:100%;">${t('flash.title')}</a></div></div>
        </section>
      </div>
      ${this.getReportCardHTML()}
    `;
  }

  /** Markdown report card with a downloadable file and an inline preview. */
  private getReportCardHTML(): string {
    const generatedLabel = this.reportGeneratedAt.toLocaleString(getLocale() === 'en' ? 'en-US' : 'id-ID', {
      dateStyle: 'medium', timeStyle: 'short',
    });
    return `
      <section class="card report-card" aria-labelledby="report-heading">
        <div class="card-header">
          <h2 class="card-title" id="report-heading">${t('analytics.weeklyReport')}</h2>
          <span class="badge badge-info">.md</span>
        </div>
        <div class="card-content">
          <p class="report-description">${t('analytics.reportDescription')}</p>
          <div class="report-actions">
            <button class="btn btn-primary" id="btnGenerateReport">${t('analytics.weeklyReport')}</button>
            <button class="btn btn-secondary" id="btnDownloadReport">${t('analytics.exportReport')}</button>
            <button class="btn btn-ghost" id="btnExportCertificate">${t('analytics.certificate')}</button>
          </div>
          <p class="certificate-note">${getLocale() === 'en'
            ? 'The certificate is a self-contained HTML file and opens in print mode.'
            : 'Sertifikat adalah file HTML mandiri dan dibuka dalam mode cetak.'}</p>
          <details class="report-preview">
            <summary>${t('analytics.reportPreview')}</summary>
            <pre class="report-preview-code">${escapeHTML(this.reportPreviewText())}</pre>
          </details>
          <p class="report-meta">${escapeHTML(APP_CONFIG.name)} v${APP_CONFIG.version} • ${escapeHTML(generatedLabel)} • ${this.reportSessions.length} ${getLocale() === 'en' ? 'sessions in history' : 'sesi dalam riwayat'}</p>
        </div>
      </section>
    `;
  }

  private reportPreviewText(): string {
    const lines = this.reportMarkdown.split('\n').slice(0, 32);
    return lines.length < this.reportMarkdown.split('\n').length
      ? `${lines.join('\n')}\n…`
      : lines.join('\n');
  }

  private refreshReportPreview(): void {
    const preview = this.element?.querySelector<HTMLElement>('.report-preview-code');
    if (preview) preview.textContent = this.reportPreviewText();
    const meta = this.element?.querySelector<HTMLElement>('.report-meta');
    if (meta) {
      meta.textContent = `${APP_CONFIG.name} v${APP_CONFIG.version} • ${this.reportGeneratedAt.toLocaleString(getLocale() === 'en' ? 'en-US' : 'id-ID', { dateStyle: 'medium', timeStyle: 'short' })} • ${this.reportSessions.length} ${getLocale() === 'en' ? 'sessions in history' : 'sesi dalam riwayat'}`;
    }
  }

  private bindEvents(): void {
    if (!this.element) return;
    this.element.querySelector('#btnWeeklyReport')?.addEventListener('click', () => this.generateWeeklyReport());
    this.element.querySelector('#btnExportReport')?.addEventListener('click', () => this.exportReport());
    this.element.querySelector('#btnGenerateReport')?.addEventListener('click', () => this.generateWeeklyReport());
    this.element.querySelector('#btnDownloadReport')?.addEventListener('click', () => this.exportReport());
    this.element.querySelector('#btnExportCertificate')?.addEventListener('click', () => this.exportCertificate());
    this.element.querySelector('#btnCertificate')?.addEventListener('click', () => this.exportCertificate());
    this.element.querySelectorAll<HTMLButtonElement>('[data-trend-range]').forEach(button => {
      button.addEventListener('click', () => {
        const days = Number(button.dataset.trendRange);
        if (!TREND_WINDOWS.includes(days as TrendWindow) || days === this.trendWindow) return;
        this.trendWindow = days as TrendWindow;
        this.element?.querySelectorAll<HTMLButtonElement>('[data-trend-range]').forEach(candidate => {
          const active = Number(candidate.dataset.trendRange) === this.trendWindow;
          candidate.classList.toggle('btn-primary', active);
          candidate.classList.toggle('btn-secondary', !active);
          candidate.classList.toggle('is-active', active);
          candidate.setAttribute('aria-pressed', String(active));
        });
        this.renderMasteryChart();
      });
    });
    this.element.querySelector<HTMLSelectElement>('#masteryTrendTopic')?.addEventListener('change', (event) => {
      this.trendTopic = (event.target as HTMLSelectElement).value || 'all';
      this.renderMasteryChart();
    });
  }

  /** Regenerate the Markdown report from current data, then download it. */
  private generateWeeklyReport(): void {
    this.reportGeneratedAt = new Date();
    const report = buildWeeklyReport({
      generatedAt: this.reportGeneratedAt,
      topics: this.topics,
      masteryStats: this.masteryStats,
      weights: this.weights,
      sessions: this.reportSessions,
      flashcardStats: this.flashcardStats,
    });
    this.reportMarkdown = report.markdown;
    this.refreshReportPreview();

    const blob = new Blob([this.reportMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = weeklyReportFilename(this.reportGeneratedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(
      getLocale() === 'en' ? 'Weekly report downloaded' : 'Laporan mingguan diunduh',
      'success'
    );
  }

  private exportReport(): void { this.generateWeeklyReport(); }

  /** Local-date filename so it always matches the date printed on the certificate. */
  private certificateFilename(generatedAt: Date): string {
    return `sertifikat-kesiapan-${localDateKey(generatedAt)}.html`;
  }

  /**
   * Build a fully self-contained certificate. Readiness comes from the same
   * getStatsByTopic() snapshot the dashboard uses; calculateReadiness() applies
   * the topic weights to produce the weighted mastery score (×100) while the
   * unweighted percentage stays comparable with the dashboard and weekly report.
   */
  private buildCertificateHTML(generatedAt: Date): string {
    const { percent, estimatedCatScore, band, coveredTopics, totalTopics } = this.readiness;
    const topicStats = Object.values(this.masteryStats);
    const totalQuestions = topicStats.reduce((sum, stat) => sum + stat.total, 0);
    const masteredCount = topicStats.reduce((sum, stat) => sum + stat.mastered, 0);
    const learningCount = topicStats.reduce((sum, stat) => sum + stat.learning, 0);
    const levelLabel = t(`analytics.readinessLevels.${band}`);
    const bandColor = band === 0 ? '#991b1b' : band === 1 ? '#92400e' : '#047857';
    const generatedLabel = generatedAt.toLocaleDateString(getLocale() === 'en' ? 'en-US' : 'id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const topicBreakdown = this.topics.map(topic => {
      const level = getMasteryLevel(this.masteryStats[topic.code]?.avgMastery);
      return `<div class="cert-topic">
        <span class="cert-topic-code">${escapeHTML(topic.code)}</span>
        <span class="cert-topic-value">${getMasteryPercent(level)}%</span>
        <span class="cert-topic-label">${escapeHTML(getMasteryLabel(level))}</span>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sertifikat Kesiapan Ujian SKB BMKG</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #f8fafc; color: #0f172a;
         font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .cert { max-width: 900px; margin: 0 auto; padding: 40px; background: #fff;
          border: 5px double #1e3a5f; border-radius: 12px; text-align: center; }
  .cert-brand { color: #0e7490; font-size: 14px; font-weight: 600;
                letter-spacing: 0.08em; text-transform: uppercase; }
  .cert h1 { color: #1e3a5f; font-size: clamp(22px, 4vw, 34px); margin: 12px 0; }
  .cert-intro { color: #55657a; font-size: 14px; max-width: 62ch;
                margin: 0 auto 24px; line-height: 1.6; }
  .cert-score { color: #1e3a5f; font-size: clamp(56px, 10vw, 84px);
                font-weight: 700; line-height: 1; margin: 16px 0 8px; }
  .cert-score-label { color: #55657a; font-size: 13px; text-transform: uppercase;
                      letter-spacing: 0.1em; }
  .cert-level { font-size: 24px; font-weight: 700; margin: 16px 0 4px; }
  .cert-estimate { color: #55657a; font-size: 14px; margin: 0 0 24px; }
  .cert-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
                  gap: 12px; margin-bottom: 24px; }
  .cert-summary-item { padding: 16px 8px; background: #f8fafc; border-radius: 10px; }
  .cert-summary-value { display: block; color: #1e3a5f; font-size: 28px; font-weight: 700; }
  .cert-summary-label { display: block; color: #55657a; font-size: 13px; margin-top: 4px; }
  .cert-topics { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
                 gap: 8px; padding: 20px 0; border-top: 1px solid #e2e8f0;
                 border-bottom: 1px solid #e2e8f0; }
  .cert-topic { min-width: 0; }
  .cert-topic-code { display: block; color: #55657a; font-size: 11px; font-weight: 600; }
  .cert-topic-value { display: block; color: #1e3a5f; font-size: 18px; font-weight: 700; }
  .cert-topic-label { display: block; color: #55657a; font-size: 11px; }
  .cert-footer { margin-top: 24px; color: #55657a; font-size: 12px; line-height: 1.6; }
  .cert-footer p { margin: 0; }
  .cert-signature { display: inline-block; min-width: 220px; margin-top: 28px;
                    border-top: 1px solid #64748b; padding-top: 6px; }
  @media (max-width: 640px) {
    body { padding: 12px; }
    .cert { padding: 24px 16px; }
    .cert-topics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { padding: 0; background: #fff; }
    .cert { max-width: none; border: 5px double #1e3a5f; box-shadow: none; }
    .cert-topics, .cert-summary { break-inside: avoid; }
  }
</style></head><body>
<main class="cert">
  <p class="cert-brand">${escapeHTML(APP_CONFIG.name)}</p>
  <h1>SERTIFIKAT KESIAPAN UJIAN SKB BMKG</h1>
  <p class="cert-intro">Diberikan sebagai ringkasan penguasaan materi SKB BMKG berdasarkan latihan dan ujian CAT yang tercatat di aplikasi.</p>
  <div class="cert-score">${percent}%</div>
  <div class="cert-score-label">Skor Kesiapan Keseluruhan</div>
  <p class="cert-level" style="color:${bandColor}">${escapeHTML(levelLabel)}</p>
  <p class="cert-estimate">Estimasi skor CAT berbobot: <strong>${estimatedCatScore}%</strong> • Topik terlatih: ${coveredTopics}/${totalTopics} • Sesi riwayat: ${this.reportSessions.length}</p>
  <section class="cert-summary" aria-label="Ringkasan data">
    <div class="cert-summary-item"><span class="cert-summary-value">${totalQuestions}</span><span class="cert-summary-label">Total soal</span></div>
    <div class="cert-summary-item"><span class="cert-summary-value">${masteredCount}</span><span class="cert-summary-label">Soal mahir</span></div>
    <div class="cert-summary-item"><span class="cert-summary-value">${learningCount}</span><span class="cert-summary-label">Soal belajar</span></div>
  </section>
  <section class="cert-topics" aria-label="Kemahiran per topik">${topicBreakdown}</section>
  <footer class="cert-footer">
    <p>Dibuat pada ${escapeHTML(generatedLabel)}</p>
    <p>${escapeHTML(APP_CONFIG.name)} v${escapeHTML(APP_CONFIG.version)}</p>
    <div class="cert-signature">Tanda tangan peserta</div>
  </footer>
</main>
<script>window.addEventListener('load', function () { window.print(); });</script>
</body></html>`;
  }

  /**
   * Download the certificate and print the generated markup in an isolated
   * frame. Calling window.print() on the parent would print the dashboard
   * instead of the certificate, so the embedded script prints the frame/file.
   */
  private exportCertificate(): void {
    this.certificateGeneratedAt = new Date();
    const html = this.buildCertificateHTML(this.certificateGeneratedAt);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.certificateFilename(this.certificateGeneratedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    frame.srcdoc = html;
    frame.onload = () => window.setTimeout(() => frame.remove(), 1000);
    document.body.appendChild(frame);

    showToast(
      getLocale() === 'en' ? 'Readiness certificate downloaded' : 'Sertifikat kesiapan diunduh',
      'success'
    );
  }

  async loadData(): Promise<void> {
    const [
      { topics, defaultWeights },
      masteryStats,
      sessions,
      reportSessions,
      mockScoreSessions,
      flashcardStats,
      attempts,
      topicKeys,
      questionIds,
    ] = await Promise.all([
      loadKisiKisi(),
      questionsRepo.getStatsByTopic(),
      sessionsRepo.getRecent(SESSION_WINDOW),
      sessionsRepo.getRecent(REPORT_SESSION_WINDOW),
      sessionsRepo.getRecent(MOCK_SCORE_SESSION_WINDOW),
      flashcardsRepo.getStats(),
      // Sparse index reads keep the trend join cheap at the 1000-question envelope.
      db.attempts.orderBy('timestamp').reverse().limit(MAX_TREND_ATTEMPTS).toArray(),
      db.questions.orderBy('topicCode').keys(),
      db.questions.orderBy('topicCode').primaryKeys(),
    ]);

    this.topics = topics.length > 0 ? topics : getKisiKisiSync();
    this.weights = { ...APP_CONFIG.defaultTopicWeights, ...defaultWeights };
    this.masteryStats = masteryStats;
    this.recentSessions = sessions;
    this.reportSessions = reportSessions;
    this.mockScoreSessions = mockScoreSessions;
    this.flashcardStats = flashcardStats;
    this.reportGeneratedAt = new Date();
    this.reportMarkdown = buildWeeklyReport({
      generatedAt: this.reportGeneratedAt,
      topics: this.topics,
      masteryStats: this.masteryStats,
      weights: this.weights,
      sessions: this.reportSessions,
      flashcardStats: this.flashcardStats,
    }).markdown;

    const sessionById = new Map(sessions.map(session => [session.id, session]));
    const topicByQuestionId = new Map(
      questionIds.map((id, index) => [String(id), String(topicKeys[index] ?? '')])
    );
    this.masteryAnswers = attempts.flatMap((attempt) => {
      const session = sessionById.get(attempt.sessionId);
      const topicCode = topicByQuestionId.get(attempt.questionId);
      if (!session?.startedAt || !topicCode) return [];
      const started = new Date(session.startedAt);
      if (!Number.isFinite(started.getTime())) return [];
      // Group by the session's local calendar day, as the heatmap does.
      return [{
        questionId: attempt.questionId,
        topicCode,
        date: localDateKey(started),
        isCorrect: attempt.isCorrect,
        timestamp: attempt.timestamp,
      }];
    });

    const topicCodes = this.topics.map(topic => topic.code);
    this.readiness = calculateReadiness(topicCodes, masteryStats, this.weights);
    this.weakAreas = calculateWeakAreas(this.topics, masteryStats, this.weights, 5);
    this.streaks = calculateStreaks(sessions);
    this.activityCounts = new Map<string, number>();
    for (const session of sessions) {
      if (!session.startedAt) continue;
      const timestamp = new Date(session.startedAt).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const key = localDateKey(new Date(timestamp));
      this.activityCounts.set(key, (this.activityCounts.get(key) ?? 0) + 1);
    }
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'analytics-view';
    this.element.innerHTML = this.getSkeletonHTML();
    this.loadData().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
        this.renderMasteryChart();
        this.renderMockScoreChart();
      }
    }).catch((error) => {
      console.error('AnalyticsView loadData error:', error);
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
        this.renderMasteryChart();
        this.renderMockScoreChart();
      }
    });
    return this.element;
  }

  private getSkeletonHTML(): string {
    return `<div class="page-header"><h1 class="page-title">${t('nav.analytics')}</h1></div><div class="card skeleton" style="min-height:500px;"></div>`;
  }
}

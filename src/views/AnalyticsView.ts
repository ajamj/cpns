// Analytics View — mastery dashboard, readiness score, weak areas and streak.
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { flashcardsRepo } from '../db/repositories/flashcards';
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
  getMasteryLevel,
  getMasteryPercent,
  type MasteryStats,
  type ReadinessResult,
  type StreakResult,
  type WeakArea,
} from '../features/analytics/metrics';
import { APP_CONFIG } from '../core/config';
import { getLocale, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import type { KisiKisiTopic, Session } from '../shared/types';

/** Window of recent sessions used for the activity list, streaks and heatmap. */
const SESSION_WINDOW = 1000;
/** A year of activity: 53 Monday-first weeks (the current week included). */
const HEATMAP_WEEKS = 53;
const DAYS_PER_WEEK = 7;

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
  private flashcardStats = { due: 0, new: 0, learning: 0, review: 0, mature: 0 };
  private weakAreas: WeakArea[] = [];
  private readiness: ReadinessResult = calculateReadiness([], {});
  private streaks: StreakResult = { current: 0, longest: 0, activeDays: 0 };
  private activityCounts: Map<string, number> = new Map();

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

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('nav.analytics')}</h1>
        <p class="page-subtitle">Pantau progress belajar dan identifikasi area lemah</p>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnWeeklyReport">${t('analytics.weeklyReport')}</button>
          <button class="btn btn-secondary" id="btnExportReport">${t('analytics.exportReport')}</button>
        </div>
      </div>
      ${this.getReadinessHTML()}
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
      <div class="card" style="margin-top:var(--space-4);"><div class="card-header"><h2 class="card-title">${t('analytics.weeklyReport')}</h2></div><div class="card-content"><p style="color:var(--color-text-muted);margin-bottom:var(--space-4);">Generate laporan mingguan dalam format Markdown untuk review atau berbagi.</p><div style="display:flex;gap:var(--space-3);flex-wrap:wrap;"><button class="btn btn-primary" id="btnGenerateReport">${t('analytics.weeklyReport')}</button><button class="btn btn-secondary" id="btnExportCertificate">${t('analytics.certificate')}</button></div></div></div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;
    this.element.querySelector('#btnWeeklyReport')?.addEventListener('click', () => this.generateWeeklyReport());
    this.element.querySelector('#btnExportReport')?.addEventListener('click', () => this.exportReport());
    this.element.querySelector('#btnGenerateReport')?.addEventListener('click', () => this.generateWeeklyReport());
    this.element.querySelector('#btnExportCertificate')?.addEventListener('click', () => this.exportCertificate());
  }

  private generateWeeklyReport(): void {
    const { percent, estimatedCatScore, coveredTopics, totalTopics } = this.readiness;
    const readinessLabel = t(`analytics.readinessLevels.${this.readiness.band}`);
    const totalQuestions = Object.values(this.masteryStats).reduce((sum, s) => sum + s.total, 0);
    const totalMastered = Object.values(this.masteryStats).reduce((sum, s) => sum + s.mastered, 0);
    const perTopic = this.topics.map(topic => {
      const level = getMasteryLevel(this.masteryStats[topic.code]?.avgMastery);
      return `- **${topic.code}**: ${getMasteryPercent(level)}% (${getMasteryLabel(level)}) - ${this.masteryStats[topic.code]?.total ?? 0} soal`;
    }).join('\n');

    const report = `# Laporan Mingguan CPNS BMKG SKB Prep\n**Tanggal:** ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n## Ringkasan Kesiapan\n- **Kesiapan Keseluruhan:** ${percent}%\n- **Estimasi Skor Ujian:** ${estimatedCatScore}%\n- **Tingkat Kesiapan:** ${readinessLabel}\n- **Cakupan Topik:** ${coveredTopics}/${totalTopics}\n- **Streak Belajar:** ${this.streaks.current} hari (terlama ${this.streaks.longest} hari) 🔥\n- **Total Soal di Bank:** ${totalQuestions}\n- **Soal Mahir:** ${totalMastered} (${totalQuestions > 0 ? Math.round((totalMastered / totalQuestions) * 100) : 0}%)\n\n## Kemahiran per Topik\n${perTopic}\n\n## Area Lemah Prioritas\n${this.weakAreas.length === 0 ? 'Tidak ada area lemah signifikan.' : this.weakAreas.map(w => `- **${w.topicCode}**: ${w.masteryPercent}% mastery (bobot ${w.weight}x, prioritas ${w.weaknessScore.toFixed(2)})`).join('\n')}\n\n## Aktivitas Minggu Ini\n- Sesi Latihan: ${this.recentSessions.filter(s => s.mode === 'practice').length}\n- Ujian Mock: ${this.recentSessions.filter(s => s.mode === 'mock-exam').length}\n- Sesi Flashcard: ${this.recentSessions.filter(s => s.mode === 'flashcard').length}\n- Kartu Dipelajari: ${this.flashcardStats.due} kartu jatuh tempo\n\n## Rekomendasi\n${this.weakAreas.length > 0 ? `Fokus latihan pada: ${this.weakAreas.slice(0, 3).map(w => w.topicCode).join(', ')}` : 'Semua topik dalam kondisi baik. Pertimbangkan ujian mock penuh untuk validasi kesiapan.'}\n\n---\n*Dibuat otomatis oleh CPNS BMKG SKB Prep v1.0.0*`;

    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-report-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Laporan mingguan diunduh', 'success');
  }

  private exportReport(): void { this.generateWeeklyReport(); }

  private exportCertificate(): void {
    const { percent, estimatedCatScore } = this.readiness;
    const levelBreakdown = this.topics.map(topic => {
      const level = getMasteryLevel(this.masteryStats[topic.code]?.avgMastery);
      return `<div class="detail"><div class="detail-value">${getMasteryPercent(level)}%</div><div class="detail-label">${topic.code}</div></div>`;
    }).join('');

    const cert = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Sertifikat Kesiapan Ujian</title><style>
body { font-family: system-ui; margin: 0; padding: 40px; background: #f8fafc; }
.cert { max-width: 800px; margin: 0 auto; background: white; border: 4px solid #1e3a5f; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
.badge { display: inline-block; background: #1e3a5f; color: white; padding: 8px 24px; border-radius: 50px; font-weight: 600; margin-bottom: 24px; }
h1 { color: #1e3a5f; margin: 0 0 16px; font-size: 32px; }
.score { font-size: 72px; font-weight: 700; color: #1e3a5f; margin: 24px 0; }
.level { font-size: 24px; color: #059669; margin-bottom: 32px; font-weight: 600; }
.details { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; margin: 32px 0; padding: 24px; background: #f8fafc; border-radius: 12px; }
.detail { text-align: center; }
.detail-value { font-size: 20px; font-weight: 700; color: #1e3a5f; }
.detail-label { font-size: 12px; color: #64748b; margin-top: 4px; }
.footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 14px; }
@media print { body { padding: 0; background: white; } .cert { box-shadow: none; border: 4px solid #1e3a5f; } }
</style></head><body>
<div class="cert"><div class="badge">SERTIFIKAT KESIAPAN UJIAN SKB BMKG</div><h1>CPNS BMKG SKB Prep</h1><div class="score">${percent}%</div><div class="level">Estimasi Skor CAT: ${estimatedCatScore}% • ${t(`analytics.readinessLevels.${this.readiness.band}`)}</div><div class="details">${levelBreakdown}</div><div class="footer">Dibuat pada ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} • CPNS BMKG SKB Prep v1.0.0</div></div><script>window.onload = () => window.print();</script></body></html>`;

    const blob = new Blob([cert], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificate-readiness-${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sertifikat kesiapan digenerate (HTML)', 'success');
  }

  async loadData(): Promise<void> {
    const [{ topics, defaultWeights }, masteryStats, sessions, flashcardStats] = await Promise.all([
      loadKisiKisi(),
      questionsRepo.getStatsByTopic(),
      sessionsRepo.getRecent(SESSION_WINDOW),
      flashcardsRepo.getStats(),
    ]);

    this.topics = topics.length > 0 ? topics : getKisiKisiSync();
    this.weights = { ...APP_CONFIG.defaultTopicWeights, ...defaultWeights };
    this.masteryStats = masteryStats;
    this.recentSessions = sessions;
    this.flashcardStats = flashcardStats;

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
      }
    }).catch((error) => {
      console.error('AnalyticsView loadData error:', error);
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });
    return this.element;
  }

  private getSkeletonHTML(): string {
    return `<div class="page-header"><h1 class="page-title">${t('nav.analytics')}</h1></div><div class="card skeleton" style="min-height:500px;"></div>`;
  }
}

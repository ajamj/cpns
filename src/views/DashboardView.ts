// Dashboard View — at-a-glance readiness, mastery grid, weak areas and streak.
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
import { navigate, t } from '../core/i18n';
import { APP_CONFIG } from '../core/config';
import type { KisiKisiTopic, Session } from '../shared/types';

/** Enough recent sessions to cover several months of streak history. */
const SESSION_WINDOW = 500;

const READINESS_BAND_CLASSES = ['badge-danger', 'badge-warning', 'badge-success'] as const;
const READINESS_BAND_COLORS = [
  'var(--color-danger)',
  'var(--color-warning)',
  'var(--color-success)',
] as const;

interface DashboardData {
  totalQuestions: number;
  questionsByTopic: Record<string, number>;
  topics: KisiKisiTopic[];
  masteryStats: MasteryStats;
  recentSessions: Session[];
  flashcardStats: { due: number; new: number; learning: number; review: number; mature: number };
  weakAreas: WeakArea[];
  readiness: ReadinessResult;
  streaks: StreakResult;
}

export class DashboardView {
  private params: Record<string, string>;
  private data: DashboardData | null = null;
  private element: HTMLElement | null = null;

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  async loadData(): Promise<void> {
    const [totalQuestions, masteryStats, { topics, defaultWeights }, sessions, flashcardStats] = await Promise.all([
      questionsRepo.getTotalCount(),
      questionsRepo.getStatsByTopic(),
      loadKisiKisi(),
      sessionsRepo.getRecent(SESSION_WINDOW),
      flashcardsRepo.getStats(),
    ]);

    // getStatsByTopic already scans the sparse topic index; deriving the topic
    // counts from the same result avoids a second index walk at the 1000-question
    // stress envelope.
    const questionsByTopic = Object.fromEntries(
      Object.entries(masteryStats).map(([topicCode, stats]) => [topicCode, stats.total])
    );
    const resolvedTopics = topics.length > 0 ? topics : getKisiKisiSync();
    const weights = { ...APP_CONFIG.defaultTopicWeights, ...defaultWeights };
    const topicCodes = resolvedTopics.map(topic => topic.code);

    this.data = {
      totalQuestions,
      questionsByTopic,
      topics: resolvedTopics,
      masteryStats,
      recentSessions: sessions,
      flashcardStats,
      weakAreas: calculateWeakAreas(resolvedTopics, masteryStats, weights, 5),
      readiness: calculateReadiness(topicCodes, masteryStats, weights),
      streaks: calculateStreaks(sessions),
    };
  }

  private getStatsHTML(): string {
    if (!this.data) return '';
    const { totalQuestions, flashcardStats, readiness, streaks } = this.data;
    const band = readiness.band;

    return `
      <div class="analytics-stats-grid">
        <div class="card">
          <div class="card-content stat-card">
            <div class="stat-icon stat-icon-blue">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div><div class="stat-value">${totalQuestions}</div><div class="stat-label">${t('qb.title')}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-content stat-card">
            <div class="stat-icon stat-icon-green">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M6 8h12M6 12h12M6 16h8"/>
              </svg>
            </div>
            <div><div class="stat-value">${flashcardStats.due}</div><div class="stat-label">${t('flash.dueToday')}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-content stat-card streak-card">
            <div class="stat-icon stat-icon-amber">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${streaks.current} 🔥</div>
              <div class="stat-label">${t('analytics.currentStreak', { days: streaks.current })}</div>
              <div class="stat-hint">${t('analytics.longestStreak', { days: streaks.longest })}</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-content stat-card">
            <div class="stat-icon" style="background:var(--color-primary-light);color:var(--color-primary);">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${readiness.percent}%</div>
              <div class="stat-label">${t('analytics.readiness')}</div>
              <span class="badge ${READINESS_BAND_CLASSES[band]} readiness-badge readiness-badge--compact">${t(`analytics.readinessLevels.${band}`)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getWeakAreasHTML(): string {
    if (!this.data || this.data.weakAreas.length === 0) {
      return `
        <div class="empty-state" style="padding:var(--space-8);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="margin-bottom:var(--space-4);opacity:0.5;">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div class="empty-state-title">Tidak ada area lemah signifikan</div>
          <div class="empty-state-description">Semua topik memiliki kemahiran yang baik. Lanjutkan belajar!</div>
        </div>
      `;
    }

    return `<div class="weak-area-list">${this.data.weakAreas.map((weak, index) => `
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
    if (!this.data) return '';
    const { recentSessions } = this.data;

    if (recentSessions.length === 0) {
      return `
        <div class="empty-state" style="padding:var(--space-8);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/>
          </svg>
          <div class="empty-state-title">${t('practice.title')} Belum Ada Sesi</div>
          <div class="empty-state-description">Mulai latihan atau ujian CAT pertama Anda untuk melihat riwayat di sini.</div>
          <div style="display:flex;gap:var(--space-2);margin-top:var(--space-4);">
            <a href="#/practice" class="btn btn-primary">${t('practice.start')}</a>
            <a href="#/mock-exam" class="btn btn-secondary">${t('mock.start')}</a>
          </div>
        </div>
      `;
    }

    return recentSessions.slice(0, 5).map(s => {
      const modeLabels: Record<string, string> = { practice: t('practice.title'), 'mock-exam': t('mock.title'), flashcard: t('flash.title') };
      const score = s.summary ? `${s.summary.scorePercent}%` : '-';
      const date = new Date(s.startedAt).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="session-row">
          <div class="session-row-main">
            <span class="badge badge-${s.mode === 'mock-exam' ? 'danger' : s.mode === 'practice' ? 'primary' : 'success'}">${modeLabels[s.mode] || s.mode}</span>
            <div>
              <div style="font-weight:var(--font-medium);">${s.topicCodes.join(', ')}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${date}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:var(--font-bold);font-size:var(--text-lg);color:var(--color-primary);">${score}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${s.summary ? `${s.summary.correctAnswers}/${s.summary.totalQuestions}` : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  private getReadinessHTML(): string {
    if (!this.data) return '';
    const { percent, band, estimatedCatScore, coveredTopics, totalTopics, confidencePercent } = this.data.readiness;

    return `
      <div class="card readiness-card">
        <div class="card-header"><h2 class="card-title">${t('analytics.readiness')}</h2></div>
        <div class="card-content">
          <div class="readiness-layout">
            <div class="readiness-ring" style="--readiness-value:${percent}%;--readiness-color:${READINESS_BAND_COLORS[band]};"
                 role="img" aria-label="${t('analytics.readiness')}: ${percent}%">
              <div class="readiness-ring-inner">
                <span class="readiness-ring-value">${percent}%</span>
                <span class="readiness-ring-label">${t('analytics.readiness')}</span>
              </div>
            </div>
            <div class="readiness-details">
              <span class="badge ${READINESS_BAND_CLASSES[band]} readiness-badge">${t(`analytics.readinessLevels.${band}`)}</span>
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
                <a href="#/mock-exam" class="btn btn-secondary">${t('mock.start')}</a>
                <a href="#/flashcards" class="btn btn-secondary">${t('flash.title')}</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getMasteryGridHTML(): string {
    const topics = this.data?.topics ?? [];
    const masteryStats = this.data?.masteryStats ?? {};

    if (topics.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8);"><div class="empty-state-title">${t('analytics.masteryGrid')}</div><div class="empty-state-description">Data kisi-kisi belum tersedia.</div></div>`;
    }

    return `
      <div class="mastery-grid" role="list" aria-label="${t('analytics.masteryGrid')}">
        ${topics.map(topic => {
          const stats = masteryStats[topic.code];
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

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'dashboard-view';
    this.element.innerHTML = this.getSkeletonHTML();

    this.loadData().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    }).catch((error) => {
      console.error('DashboardView loadData error:', error);
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });

    return this.element;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('nav.dashboard')}</h1>
        <p class="page-subtitle">${t('app.tagline')}</p>
      </div>
      <div class="analytics-stats-grid">
        ${['totalQuestions', 'dueCards', 'studyStreak', 'readinessScore'].map(() => `
          <div class="card skeleton">
            <div class="card-content" style="padding:var(--space-5);">
              <div class="skeleton-loader" style="height:24px;width:60%;margin-bottom:var(--space-2);"></div>
              <div class="skeleton-loader" style="height:32px;width:40%;"></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="analytics-content-grid" style="margin-top:var(--space-4);">
        ${['weakAreas', 'recentSessions'].map(() => `
          <div class="card skeleton">
            <div class="card-header"><div class="skeleton-loader" style="height:20px;width:30%;"></div></div>
            <div class="card-content" style="padding:var(--space-5);min-height:200px;"></div>
          </div>
        `).join('')}
      </div>
      <div class="card skeleton" style="margin-top:var(--space-4);">
        <div class="card-header"><div class="skeleton-loader" style="height:20px;width:40%;"></div></div>
        <div class="card-content" style="padding:var(--space-5);min-height:300px;"></div>
      </div>
    `;
  }

  private getHTML(): string {
    if (!this.data) return this.getSkeletonHTML();

    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">${t('nav.dashboard')}</h1>
          <p class="page-subtitle">${t('app.tagline')}</p>
        </div>
        <div class="page-actions">
          <a href="#/mock-exam" class="btn btn-primary">${t('mock.start')}</a>
          <a href="#/practice?weak=true" class="btn btn-secondary">${t('practice.title')}</a>
          <a href="#/flashcards" class="btn btn-secondary">${t('flash.title')}</a>
        </div>
      </div>

      ${this.getStatsHTML()}

      <div class="analytics-content-grid" style="margin-top:var(--space-4);">
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('analytics.weakAreas')}</h2></div>
          <div class="card-content">${this.getWeakAreasHTML()}</div>
        </section>
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${t('analytics.recentSessions')}</h2>
            <a href="#/analytics" class="btn btn-ghost btn-sm">${t('common.more')}</a>
          </div>
          <div class="card-content">${this.getRecentSessionsHTML()}</div>
        </section>
      </div>

      <div class="analytics-content-grid" style="margin-top:var(--space-4);">
        ${this.getReadinessHTML()}
        <section class="card">
          <div class="card-header"><h2 class="card-title">${t('analytics.masteryGrid')}</h2></div>
          <div class="card-content">${this.getMasteryGridHTML()}</div>
        </section>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    this.element.addEventListener('click', (event) => {
      const tile = (event.target as HTMLElement).closest('.mastery-tile');
      if (tile) {
        const topicCode = tile.getAttribute('href')?.match(/topic=([^&]+)/)?.[1];
        if (topicCode) {
          event.preventDefault();
          navigate('practice', { topic: decodeURIComponent(topicCode) });
        }
      }
    });
  }
}

// Dashboard View
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { loadKisiKisi, getTopicsByCategory, getSubdomainColor, getMasteryLabel, getMasteryColor, getKisiKisiSync } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { APP_CONFIG } from '../core/config';
import { formatDuration } from '../core/utils';

interface DashboardData {
  totalQuestions: number;
  questionsByTopic: Record<string, number>;
  masteryStats: Record<string, { total: number; mastered: number; learning: number; new: number; avgMastery: number }>;
  recentSessions: any[];
  flashcardStats: { due: number; new: number; learning: number; review: number; mature: number };
  weakAreas: Array<{ topicCode: string; mastery: number; weight: number }>;
}

export class DashboardView {
  private params: Record<string, string>;
  private data: DashboardData | null = null;
  private element: HTMLElement | null = null;
  private weakAreas: Array<{ topicCode: string; mastery: number; weight: number }> = [];

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  async loadData(): Promise<void> {
    console.log('DashboardView.loadData: starting');
    const [totalQuestions, masteryStats, recentSessions, flashcardStats] = await Promise.all([
      questionsRepo.getTotalCount(),
      questionsRepo.getStatsByTopic(),
      sessionsRepo.getRecent(5),
      flashcardsRepo.getStats(),
    ]);
    // getStatsByTopic already scans the sparse topic index; deriving the topic
    // counts from the same result avoids a second 200ms index walk at the
    // 2000-question stress envelope.
    const questionsByTopic = Object.fromEntries(
      Object.entries(masteryStats).map(([topicCode, stats]) => [topicCode, stats.total])
    );
    console.log('DashboardView.loadData: got data', { totalQuestions, masteryStatsKeys: Object.keys(masteryStats).length, recentSessionsCount: recentSessions.length, flashcardStats });

    const topics = masteryStats;
    const weights = APP_CONFIG.defaultTopicWeights;

    this.weakAreas = Object.entries(topics)
      .map(([topicCode, stats]) => ({
        topicCode,
        mastery: stats.avgMastery,
        weight: weights[topicCode] || 1,
      }))
      .filter(w => w.mastery < 0.7 && w.weight > 0)
      .sort((a, b) => (a.mastery / a.weight) - (b.mastery / b.weight))
      .slice(0, 5);

    this.data = {
      totalQuestions,
      questionsByTopic,
      masteryStats: topics,
      recentSessions,
      flashcardStats,
      weakAreas: this.weakAreas,
    };
    console.log('DashboardView.loadData: data set, totalQuestions=', this.data.totalQuestions);
  }

  private getStatsHTML(): string {
    if (!this.data) return '';
    const { totalQuestions, masteryStats, flashcardStats } = this.data;
    const avgMastery = Object.values(masteryStats).length > 0
      ? Object.values(masteryStats).reduce((sum, s) => sum + s.avgMastery, 0) / Object.values(masteryStats).length
      : 0;
    const readinessPercent = Math.round(avgMastery * 100);
    const readinessLabels = ['Belum Siap', 'Perlu Ulang', 'Siap', 'Sangat Siap'];
    const readinessLevel = readinessPercent >= 80 ? 3 : readinessPercent >= 60 ? 2 : readinessPercent >= 40 ? 1 : 0;

    return `
      <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:var(--space-4);">
        <div class="card">
          <div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="stat-icon stat-icon-blue">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${totalQuestions}</div>
              <div class="stat-label">${t('qb.title')}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="stat-icon stat-icon-green">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M6 8h12M6 12h12M6 16h8"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${flashcardStats.due}</div>
              <div class="stat-label">${t('flash.dueToday')}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="stat-icon stat-icon-amber">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${this.getStreak()}</div>
              <div class="stat-label">${t('analytics.currentStreak', { days: this.getStreak() })}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="stat-icon" style="background:var(--color-primary-light);color:var(--color-primary);">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <div>
              <div class="stat-value">${readinessPercent}%</div>
              <div class="stat-label">${t('analytics.readiness')}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getWeakAreasHTML(): string {
    if (this.weakAreas.length === 0) {
      return `
        <div class="empty-state" style="padding:var(--space-8);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="margin-bottom:var(--space-4);opacity:0.5;">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div class="empty-state-title">Tidak ada area lemah signifikan</div>
          <div class="empty-state-description">Semua topik memiliki kemahiran yang baik. Lanjutkan belajar!</div>
        </div>
      `;
    }

    return this.weakAreas.map(w => {
      const stats = this.data?.masteryStats[w.topicCode];
      const topicTitle = 'Topic ' + w.topicCode; // Simplified to avoid Promise
      return `
        <a href="#/practice?topic=${w.topicCode}" class="weak-area-item" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);text-decoration:none;transition:all var(--transition-fast);" onmouseover="this.style.borderColor='var(--color-primary)';this.style.background='var(--color-primary-light)'" onmouseout="this.style.borderColor='var(--color-border)';this.style.background='transparent'">
          <div class="weak-area-mastery" style="width:56px;height:56px;border-radius:50%;background:conic-gradient(var(--color-primary) ${Math.round(w.mastery * 100)}%, var(--color-border) ${Math.round(w.mastery * 100)}%);display:flex;align-items:center;justify-content:center;position:relative;">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);font-size:var(--text-sm);color:var(--color-primary);">${Math.round(w.mastery * 100)}%</div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:var(--font-medium);color:var(--color-text);">${topicTitle}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('analytics.byTopic')}: ${w.topicCode} • ${t('analytics.readiness')}: ${Math.round(w.mastery * 100)}% • ${t('settings.topicWeights')}: ${w.weight}x</div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-text-muted);flex-shrink:0;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      `;
    }).join('');
  }

  private getRecentSessionsHTML(): string {
    if (!this.data) return '';
    const { recentSessions } = this.data;

    if (recentSessions.length === 0) {
      return `
        <div class="empty-state" style="padding:var(--space-8);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M6 8h12M6 12h12M6 16h8"/>
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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
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
    const { masteryStats } = this.data;
    const avgMastery = Object.values(masteryStats).length > 0
      ? Object.values(masteryStats).reduce((sum, s) => sum + s.avgMastery, 0) / Object.values(masteryStats).length
      : 0;
    const readinessPercent = Math.round(avgMastery * 100);
    const readinessLevel = readinessPercent >= 80 ? 3 : readinessPercent >= 60 ? 2 : readinessPercent >= 40 ? 1 : 0;
    const readinessLabels = ['Belum Siap', 'Perlu Ulang', 'Siap', 'Sangat Siap'];

    return `
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">${t('analytics.readiness')}</h2>
        </div>
        <div class="card-content">
          <div style="text-align:center;padding:var(--space-8);">
            <div style="width:120px;height:120px;border-radius:50%;background:conic-gradient(var(--color-primary) ${readinessPercent}%, var(--color-border) ${readinessPercent}%);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);position:relative;">
              <div style="width:90px;height:90px;border-radius:50%;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;flex-direction:column;">
                <div style="font-size:var(--text-3xl);font-weight:var(--font-bold);color:var(--color-primary);">${readinessPercent}%</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('analytics.readiness')}</div>
              </div>
            </div>
            <div style="font-size:var(--text-xl);font-weight:var(--font-bold);color:var(--color-primary);margin-bottom:var(--space-2);">${readinessLabels[readinessLevel]}</div>
            <div style="color:var(--color-text-muted);margin-bottom:var(--space-6);">${t('analytics.estimatedScore', { score: readinessPercent })}</div>
            <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
              <a href="#/practice?weak=true" class="btn btn-primary">${t('practice.title')} Area Lemah</a>
              <a href="#/mock-exam" class="btn btn-secondary">${t('mock.start')}</a>
              <a href="#/flashcards" class="btn btn-secondary">${t('flash.title')}</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getMasteryGridHTML(): string {
    const topics = getKisiKisiSync();
    const masteryStats = this.data?.masteryStats || {};

    return `
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">${t('analytics.masteryGrid')}</h2>
        </div>
        <div class="card-content">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:var(--space-3);">
            ${topics.map(topic => {
              const stats = masteryStats[topic.code];
              const mastery = stats?.avgMastery || 0;
              const masteryLevel = Math.round(mastery * 3);
              const count = stats?.total || 0;
              return `
                <a href="#/practice?topic=${topic.code}" class="mastery-tile" style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);background:var(--color-bg);transition:all var(--transition-fast);text-decoration:none;" onmouseover="this.style.borderColor='var(--color-primary)';this.style.boxShadow='var(--shadow-md)'" onmouseout="this.style.borderColor='var(--color-border)';this.style.boxShadow='none'" title="${topic.title} (${topic.subdomain})">
                  <div style="font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--color-text-muted);margin-bottom:var(--space-1);">${topic.code}</div>
                  <div style="font-size:var(--text-sm);font-weight:var(--font-semibold);color:var(--color-text);margin-bottom:var(--space-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${topic.title}</div>
                  <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span class="badge badge-mastery-${masteryLevel}" style="font-size:var(--text-xs);">${['Baru', 'Belajar', 'Ulang', 'Mahir'][masteryLevel]}</span>
                    <span style="font-size:var(--text-xs);color:var(--color-text-muted);">${count} soal</span>
                  </div>
                  <div style="height:4px;background:var(--color-border);border-radius:var(--radius-full);margin-top:var(--space-2);overflow:hidden;">
                    <div style="width:${Math.round(mastery * 100)}%;height:100%;background:var(--color-primary);border-radius:var(--radius-full);transition:width var(--transition-normal);"></div>
                  </div>
                </a>
              `;
            }).join('')}
          </div>
        </div>
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
    }).catch((err) => {
      console.error('DashboardView loadData error:', err);
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
      <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:var(--space-4);">
        ${['totalQuestions', 'dueCards', 'studyStreak', 'readinessScore'].map(() => `
          <div class="card skeleton">
            <div class="card-content" style="padding:var(--space-5);">
              <div class="skeleton-loader" style="height:24px;width:60%;margin-bottom:var(--space-2);"></div>
              <div class="skeleton-loader" style="height:32px;width:40%;"></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:var(--space-4);margin-top:var(--space-4);">
        ${['weakAreas', 'recentSessions'].map(() => `
          <div class="card skeleton">
            <div class="card-header"><div class="skeleton-loader" style="height:20px;width:30%;"></div></div>
            <div class="card-content" style="padding:var(--space-5);min-height:200px;"></div>
          </div>
        `).join('')}
      </div>
      <div class="card" style="margin-top:var(--space-4);">
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
        <div class="page_actions">
          <a href="#/mock-exam" class="btn btn_primary">${t('mock.start')}</a>
          <a href="#/practice?weak=true" class="btn btn_secondary">${t('practice.title')}</a>
          <a href="#/flashcards" class="btn btn_secondary">${t('flash.title')}</a>
        </div>
      </div>

      ${this.getStatsHTML()}

      <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:var(--space-4);margin-top:var(--space-4);">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">${t('analytics.weakAreas')}</h2>
          </div>
          <div class="card_content">
            ${this.getWeakAreasHTML()}
          </div>
        </div>

        <div class="card">
          <div class="card_header">
            <h2 class="card-title">${t('analytics.recentSessions')}</h2>
            <a href="#/analytics" class="btn btn_ghost btn_sm">${t('common.more')}</a>
          </div>
          <div class="card_content">
            ${this.getRecentSessionsHTML()}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(1,1fr);gap:var(--space-4);margin-top:var(--space-4);">
        ${this.getReadinessHTML()}
        ${this.getMasteryGridHTML()}
      </div>
    `;
  }

  private getStreak(): number {
    const streakData = localStorage.getItem('study-streak');
    if (streakData) {
      try {
        const { current, lastDate } = JSON.parse(streakData);
        const today = new Date().toISOString().split('T')[0];
        if (lastDate === today) return current;
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (lastDate === yesterday) return current;
        return 0;
      } catch {}
    }
    return 0;
  }

  private bindEvents(): void {
    if (!this.element) return;

    this.element.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest('.mastery-tile');
      if (tile) {
        const topicCode = tile.getAttribute('href')?.match(/topic=([^&]+)/)?.[1];
        if (topicCode) {
          navigate('practice', { topic: topicCode });
        }
      }
    });
  }
}
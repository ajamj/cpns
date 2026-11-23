// Analytics View - Simplified
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { loadKisiKisi, getMasteryLabel, getMasteryColor, getSubdomainColor, getKisiKisiSync } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { showToast } from '../core/app-utils';
import { eventBus } from '../core/events';
import { generateId, nowISO, formatDuration, formatTime } from '../core/utils';

export class AnalyticsView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private masteryStats: any = {};
  private recentSessions: any[] = [];
  private flashcardStats: any = {};
  private weakAreas: any[] = [];

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  private getReadinessHTML(): string {
    const avgMastery = Object.values(this.masteryStats).length > 0
      ? Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.avgMastery, 0) / Object.values(this.masteryStats).length
      : 0;
    const readinessPercent = Math.round(avgMastery * 100);
    const readinessLevel = readinessPercent >= 80 ? 3 : readinessPercent >= 60 ? 2 : readinessPercent >= 40 ? 1 : 0;
    const readinessLabels = ['Belum Siap', 'Perlu Ulang', 'Siap', 'Sangat Siap'];

    return `
      <div class="card">
        <div class="card-header"><h2 class="card-title">${t('analytics.readiness')}</h2></div>
        <div class="card-content">
          <div style="text-align:center;padding:var(--space-8);">
            <div style="width:160px;height:160px;border-radius:50%;background:conic-gradient(var(--color-primary) ${readinessPercent}%, var(--color-border) ${readinessPercent}%);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);position:relative;">
              <div style="width:120px;height:120px;border-radius:50%;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;flex-direction:column;">
                <div style="font-size:var(--text-4xl);font-weight:var(--font-bold);color:var(--color-primary);">${readinessPercent}%</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('analytics.readiness')}</div>
              </div>
            </div>
            <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-primary);margin-bottom:var(--space-2);">${readinessLabels[readinessLevel]}</div>
            <div style="color:var(--color-text-muted);margin-bottom:var(--space-6);">${t('analytics.estimatedScore', { score: readinessPercent })}</div>
            <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
              <a href="#/practice?weak=true" class="btn btn-primary">${t('practice.title')} Area Lemah</a>
              <a href="#/mock-exam" class="btn btn-secondary">${t('mock.title')}</a>
              <a href="#/flashcards" class="btn btn-secondary">${t('flash.title')}</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getStatsHTML(): string {
    const avgMastery = Object.values(this.masteryStats).length > 0
      ? Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.avgMastery, 0) / Object.values(this.masteryStats).length
      : 0;
    const totalQuestions = Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.total, 0);
    const totalMastered = Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.mastered, 0);
    const streak = this.getStreak();

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);margin-bottom:var(--space-4);">
        <div class="card"><div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4);"><div class="stat-icon stat-icon-blue"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg></div><div><div class="stat-value">${totalQuestions}</div><div class="stat-label">Total Soal</div></div></div></div>
        <div class="card"><div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4);"><div class="stat-icon stat-icon-green"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></div><div><div class="stat-value">${totalMastered}</div><div class="stat-label">Soal Mahir</div></div></div></div>
        <div class="card"><div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4);"><div class="stat-icon stat-icon-amber"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div><div class="stat-value">${streak}</div><div class="stat-label">Streak (hari)</div></div></div></div>
        <div class="card"><div class="card-content" style="display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4);"><div class="stat-icon" style="background:var(--color-primary-light);color:var(--color-primary);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h12M6 12h12M6 16h8"/></svg></div><div><div class="stat-value">${this.recentSessions.length}</div><div class="stat-label">Sesi Terbaru</div></div></div></div>
      </div>
    `;
  }

  private getWeakAreasHTML(): string {
    if (this.weakAreas.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><div class="empty-state-title">Tidak ada area lemah signifikan</div><div class="empty-state-description">Semua topik memiliki kemahiran yang baik. Lanjutkan belajar!</div></div>`;
    }
    return this.weakAreas.map(w => `
      <a href="#/practice?topic=${w.topicCode}" class="weak-area-item" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);text-decoration:none;transition:all var(--transition-fast);" onmouseover="this.style.borderColor='var(--color-primary)';this.style.background='var(--color-primary-light)'" onmouseout="this.style.borderColor='var(--color-border)';this.style.background='transparent'">
        <div class="weak-area-mastery" style="width:56px;height:56px;border-radius:50%;background:conic-gradient(var(--color-primary) ${Math.round(w.mastery * 100)}%, var(--color-border) ${Math.round(w.mastery * 100)}%);display:flex;align-items:center;justify-content:center;position:relative;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);font-size:var(--text-sm);color:var(--color-primary);">${Math.round(w.mastery * 100)}%</div>
        </div>
        <div style="flex:1;min-width:0;"><div style="font-weight:var(--font-medium);color:var(--color-text);">${w.topicCode}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('analytics.byTopic')}: ${w.topicCode} • ${t('analytics.readiness')}: ${Math.round(w.mastery * 100)}% • Bobot: ${w.weight}x</div></div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-text-muted);flex-shrink:0;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    `).join('');
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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <span class="badge badge-${s.mode === 'mock-exam' ? 'danger' : s.mode === 'practice' ? 'primary' : 'success'}">${modeLabels[s.mode] || s.mode}</span>
            <div><div style="font-weight:var(--font-medium);">${s.topicCodes.join(', ')}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${date}</div></div>
          </div>
          <div style="text-align:right;"><div style="font-weight:var(--font-bold);font-size:var(--text-lg);color:var(--color-primary);">${score}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${s.summary ? `${s.summary.correctAnswers}/${s.summary.totalQuestions}` : ''}</div></div>
        </div>
      `;
    }).join('');
  }

  private getMasteryGridHTML(): string {
    const topics = getKisiKisiSync();
    return `
      <div class="card">
        <div class="card-header"><h2 class="card-title">${t('analytics.masteryGrid')}</h2></div>
        <div class="card-content">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:var(--space-3);">
            ${topics.map(topic => {
              const stats = this.masteryStats[topic.code];
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

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('nav.analytics')}</h1>
        <p class="page-subtitle">${t('analytics.subtitle') || 'Pantau progress belajar dan identifikasi area lemah'}</p>
        <div class="page-actions">
          <button class="btn btn-primary" id="btnWeeklyReport">${t('analytics.weeklyReport')}</button>
          <button class="btn btn-secondary" id="btnExportReport">${t('analytics.exportReport')}</button>
        </div>
      </div>
      ${this.getReadinessHTML()}
      ${this.getStatsHTML()}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:var(--space-4);margin-bottom:var(--space-4);">
        <div class="card"><div class="card-header"><h2 class="card-title">${t('analytics.masteryGrid')}</h2></div><div class="card-content">${this.getMasteryGridHTML()}</div></div>
        <div class="card"><div class="card-header"><h2 class="card-title">${t('analytics.weakAreas')}</h2></div><div class="card-content">${this.getWeakAreasHTML()}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:var(--space-4);margin-bottom:var(--space-4);">
        <div class="card"><div class="card-header"><h2 class="card-title">${t('analytics.recentSessions')}</h2><a href="#/analytics" class="btn btn-ghost btn-sm">${t('common.more')}</a></div><div class="card-content">${this.getRecentSessionsHTML()}</div></div>
        <div class="card"><div class="card-header"><h2 class="card-title">${t('flash.title')} Stats</h2></div><div class="card-content"><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4);"><div style="text-align:center;padding:var(--space-4);background:var(--color-primary-light);border-radius:var(--radius-md);"><div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-primary);">${this.flashcardStats.due}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.dueToday')}</div></div><div style="text-align:center;padding:var(--space-4);background:var(--color-info-light);border-radius:var(--radius-md);"><div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-info);">${this.flashcardStats.new}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.newCards')}</div></div><div style="text-align:center;padding:var(--space-4);background:var(--color-warning-light);border-radius:var(--radius-md);"><div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-warning);">${this.flashcardStats.learning}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.learning')}</div></div><div style="text-align:center;padding:var(--space-4);background:var(--color-success-light);border-radius:var(--radius-md);"><div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-success);">${this.flashcardStats.review + this.flashcardStats.mature}</div><div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.review')} / ${t('flash.mature')}</div></div></div><div style="margin-top:var(--space-4);"><a href="#/flashcards" class="btn btn-primary" style="width:100%;">${t('flash.title')}</a></div></div></div>
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
    const avgMastery = Object.values(this.masteryStats).length > 0
      ? Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.avgMastery, 0) / Object.values(this.masteryStats).length
      : 0;
    const readinessPercent = Math.round(avgMastery * 100);
    const readinessLevel = readinessPercent >= 80 ? 3 : readinessPercent >= 60 ? 2 : readinessPercent >= 40 ? 1 : 0;
    const readinessLabels = ['Belum Siap', 'Perlu Ulang', 'Siap', 'Sangat Siap'];
    const totalQuestions = Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.total, 0);
    const totalMastered = Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.mastered, 0);
    const streak = this.getStreak();

    const report = `# Laporan Mingguan CPNS BMKG SKB Prep\n**Tanggal:** ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n\n## Ringkasan Kesiapan\n- **Estimasi Skor Ujian:** ${readinessPercent}%\n- **Tingkat Kesiapan:** ${readinessLabels[readinessPercent >= 80 ? 3 : readinessPercent >= 60 ? 2 : readinessPercent >= 40 ? 1 : 0]}\n- **Streak Belajar:** ${streak} hari\n- **Total Soal di Bank:** ${totalQuestions}\n- **Soal Mahir:** ${totalMastered} (${totalQuestions > 0 ? Math.round((totalMastered / totalQuestions) * 100) : 0}%)\n\n## Kemahiran per Topik\n${Object.entries(this.masteryStats).map(([code, stats]: [string, any]) => `- **${code}**: ${Math.round(stats.avgMastery * 100)}% (${['Baru', 'Belajar', 'Ulang', 'Mahir'][Math.round(stats.avgMastery * 3)]}) - ${stats.total} soal`).join('\n')}\n\n## Area Lemah Prioritas\n${this.weakAreas.length === 0 ? 'Tidak ada area lemah signifikan.' : this.weakAreas.map(w => `- **${w.topicCode}**: ${Math.round(w.mastery * 100)}% mastery (bobot ${w.weight}x)`).join('\n')}\n\n## Aktivitas Minggu Ini\n- Sesi Latihan: ${this.recentSessions.filter(s => s.mode === 'practice').length}\n- Ujian Mock: ${this.recentSessions.filter(s => s.mode === 'mock-exam').length}\n- Sesi Flashcard: ${this.recentSessions.filter(s => s.mode === 'flashcard').length}\n- Kartu Dipelajari: ${this.flashcardStats.due} kartu jatuh tempo\n\n## Rekomendasi\n${this.weakAreas.length > 0 ? `Fokus latihan pada: ${this.weakAreas.slice(0, 3).map(w => w.topicCode).join(', ')}` : 'Semua topik dalam kondisi baik. Pertimbangkan ujian mock penuh untuk validasi kesiapan.'}\n\n---\n*Dibuat otomatis oleh CPNS BMKG SKB Prep v1.0.0*`;

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
    const avgMastery = Object.values(this.masteryStats).length > 0
      ? Object.values(this.masteryStats).reduce((sum: number, s: any) => sum + s.avgMastery, 0) / Object.values(this.masteryStats).length
      : 0;
    const readinessPercent = Math.round(avgMastery * 100);

    const cert = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Sertifikat Kesiapan Ujian</title><style>
body { font-family: system-ui; margin: 0; padding: 40px; background: #f8fafc; }
.cert { max-width: 800px; margin: 0 auto; background: white; border: 4px solid #1e3a5f; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
.badge { display: inline-block; background: #1e3a5f; color: white; padding: 8px 24px; border-radius: 50px; font-weight: 600; margin-bottom: 24px; }
h1 { color: #1e3a5f; margin: 0 0 16px; font-size: 32px; }
.score { font-size: 72px; font-weight: 700; color: #1e3a5f; margin: 24px 0; }
.level { font-size: 24px; color: #059669; margin-bottom: 32px; font-weight: 600; }
.details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 32px 0; padding: 24px; background: #f8fafc; border-radius: 12px; }
.detail { text-align: center; }
.detail-value { font-size: 36px; font-weight: 700; color: #1e3a5f; }
.detail-label { font-size: 14px; color: #64748b; margin-top: 4px; }
.footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 14px; }
@media print { body { padding: 0; background: white; } .cert { box-shadow: none; border: 4px solid #1e3a5f; } }
</style></head><body>
<div class="cert"><div class="badge">SERTIFIKAT KESIAPAN UJIAN SKB BMKG</div><h1>CPNS BMKG SKB Prep</h1><div class="score">${Math.round(avgMastery * 100)}%</div><div class="level">Estimasi Skor: ${readinessPercent}%</div><div class="details"><div class="detail"><div class="detail-value">${Object.values(this.masteryStats).reduce((s: number, v: any) => s + v.total, 0)}</div><div class="detail-label">Total Soal</div></div><div class="detail"><div class="detail-value">${Math.round((Object.values(this.masteryStats).reduce((s: number, v: any) => s + v.mastered, 0) / Object.values(this.masteryStats).reduce((s: number, v: any) => s + v.total, 1)) * 100)}%</div><div class="detail-label">Mahir</div></div><div class="detail"><div class="detail-value">${Object.values(this.masteryStats).reduce((s: number, v: any) => s + v.learning, 0)}</div><div class="detail-label">Belajar</div></div></div><div class="footer">Dibuat pada ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} • CPNS BMKG SKB Prep v1.0.0</div></div><script>window.onload = () => window.print();</script></body></html>`;

    const blob = new Blob([cert], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificate-readiness-${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sertifikat kesiapan digenerate (HTML)', 'success');
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

  async loadData(): Promise<void> {
    const [masteryStats, recentSessions, flashcardStats] = await Promise.all([
      import('../db/repositories/questions').then(m => m.questionsRepo.getStatsByTopic()),
      import('../db/repositories/sessions').then(m => m.sessionsRepo.getRecent(20)),
      import('../db/repositories/flashcards').then(m => m.flashcardsRepo.getStats()),
    ]);
    this.masteryStats = masteryStats;
    this.recentSessions = recentSessions;
    this.flashcardStats = flashcardStats;
    const topics = masteryStats;
    const weights = { 'UM-01': 1, 'UM-02': 1, 'UM-03': 1, 'UM-04': 1, 'UM-05': 1, 'UM-06': 1, 'UM-07': 1, 'UM-08': 1, 'UM-09': 1, 'KH-01': 1.5, 'KH-02': 1.5, 'KH-03': 1.5, 'KH-04': 1.5, 'KH-05': 1.5, 'KH-06': 1.5, 'KH-07': 1.5, 'KH-08': 1.5, 'KH-09': 1.5, 'KH-10': 1.5, 'KH-11': 1.5, 'KH-12': 1.5 };
    this.weakAreas = Object.entries(topics).map(([topicCode, stats]: [string, any]) => ({ topicCode, mastery: stats.avgMastery, weight: weights[topicCode as keyof typeof weights] || 1, total: stats.total, mastered: stats.mastered })).filter(w => w.mastery < 0.7 && w.weight > 0).sort((a, b) => (a.mastery / a.weight) - (b.mastery / b.weight)).slice(0, 5);
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'analytics-view';
    this.element.innerHTML = this.getSkeletonHTML();
    this.loadData().then(() => { if (this.element) { this.element.innerHTML = this.getHTML(); this.bindEvents(); } });
    return this.element;
  }

  private getSkeletonHTML(): string {
    return `<div class="page-header"><h1 class="page-title">${t('nav.analytics')}</h1></div><div class="card skeleton" style="min-height:500px;"></div>`;
  }
}
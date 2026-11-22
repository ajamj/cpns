// Practice Mode View
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { attemptsRepo } from '../db/repositories/attempts';
import { loadKisiKisi, getTopicsByCategory } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, formatTime, debounce } from '../core/utils';
import type { Question, Session, Attempt, SessionConfig } from '../shared/types';

interface PracticeSession {
  id: string;
  config: SessionConfig;
  questions: Question[];
  currentIndex: number;
  answers: Map<string, { userAnswer: number[]; isCorrect: boolean; timeMs: number; flagged: boolean; markedReview: boolean }>;
  startTime: number;
  status: 'active' | 'paused' | 'review' | 'completed';
}

export class PracticeView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private session: PracticeSession | null = null;
  private questionStartTime = 0;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private allQuestions: any[] = [];

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  async loadQuestions(): Promise<void> {
    this.allQuestions = await questionsRepo.getAll();
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'practice-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadQuestions().then(() => {
      if (this.element) {
        if (this.params.weak === 'true') {
          this.startWeakAreasPractice();
        } else {
          this.element.innerHTML = this.getConfigHTML();
          this.bindConfigEvents();
        }
      }
    });

    return this.element;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getConfigHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.title')}</h1>
        <p class="page-subtitle">${t('practice.config')}</p>
      </div>

      <div class="card" style="max-width:600px;">
        <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);">
          <fieldset>
            <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Filter Soal</legend>
            
            <div class="form-group">
              <label class="form-label">${t('practice.topicFilter')}</label>
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary" data-topic="all" style="min-width:100px;">${t('filter.all')}</button>
                ${getTopicsByCategory('umum').map(cat => `
                  ${loadKisiKisi().then(({topics}) => topics.filter(t => t.category === 'umum').map(t => `
                    <button type="button" class="btn btn-ghost" data-topic="${t.code}">${t.code}</button>
                  `).join(''))}
                `)}
                ${loadKisiKisi().then(({topics}) => topics.filter(t => t.category === 'khusus').map(t => `
                  <button type="button" class="btn btn-ghost" data-topic="${t.code}">${t.code}</button>
                `).join(''))}
              </div>
              <input type="hidden" id="selectedTopics" value="">
              <p class="form-help">Klik untuk memilih/membatalkan topik. Kosong = semua topik.</p>
            </div>

            <div class="form-group">
              <label class="form-label" for="questionCount">${t('practice.questionCount')}</label>
              <select id="questionCount" class="form-select">
                <option value="10">10</option>
                <option value="20" selected>20</option>
                <option value="30">30</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">${t('practice.allQuestions')}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">${t('practice.difficultyMix')}</label>
              <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
                ${[1, 2, 3].map(d => `
                  <div style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="min-width:60px;">${t('difficulty.' + d)}</span>
                    <input type="number" step="5" min="0" max="100" value="${d===2?50:d===1?30:20}" data-difficulty="${d}" class="form-input" style="width:80px;">
                    <span>%</span>
                  </div>
                `).join('')}
              </div>
              <p class="form-help">Total harus 100%</p>
            </div>

            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="prioritizeWeak" checked>
              <span class="form-check-label">${t('practice.prioritizeWeak')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="includeFlagged">
              <span class="form-check-label">${t('practice.includeFlagged')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="includeNeedsReview">
              <span class="form-check-label">${t('practice.includeNeedsReview')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="randomOrder" checked>
              <span class="form-check-label">${t('practice.randomOrder')}</span>
            </label>
            <label class="form-check">
              <input type="checkbox" class="form-check-input" id="showExplanation" checked>
              <span class="form-check-label">${t('practice.showExplanationImmediately')}</span>
            </label>
          </fieldset>

          <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button class="btn btn-secondary" id="btnCancelConfig">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="btnStartPractice">${t('practice.start')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private getSessionHTML(): string {
    if (!this.session) return '';
    const q = this.session.questions[this.session.currentIndex];
    const progress = ((this.session.currentIndex + 1) / this.session.questions.length) * 100;
    const answer = this.session.answers.get(q.id);
    const isAnswered = !!answer;

    return `
      <div class="page-header" style="position:sticky;top:0;z-index:var(--z-sticky);background:var(--color-bg);padding-bottom:var(--space-4);margin-bottom:var(--space-4);border-bottom:1px solid var(--color-border);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-4);">
          <div>
            <h1 class="page-title" style="font-size:var(--text-lg);">${t('practice.title')}</h1>
            <div style="display:flex;align-items:center;gap:var(--space-4);margin-top:var(--space-2);font-size:var(--text-sm);color:var(--color-text-muted);">
              <span>Soal ${this.session.currentIndex + 1} / ${this.session.questions.length}</span>
              <span>${q.topicCode}</span>
              <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <div style="width:200px;height:6px;background:var(--color-border);border-radius:var(--radius-full);overflow:hidden;">
              <div style="width:${((this.session.currentIndex + 1) / this.session.questions.length) * 100}%;height:100%;background:var(--color-primary);transition:width var(--transition-fast);"></div>
            </div>
            <span style="font-weight:var(--font-semibold);min-width:40px;text-align:right;">${Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-content">
          <!-- Question Stem -->
          <div style="margin-bottom:var(--space-6);">
            <div style="font-size:var(--text-lg);line-height:var(--leading-relaxed);font-weight:var(--font-medium);">${this.renderMarkdown(q.stem)}</div>
          </div>

          <!-- Options -->
          <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-6);">
            ${q.options.map((opt: any, i: number) => {
              const isSelected = answer?.userAnswer.includes(i);
              const isCorrect = q.correctAnswer.includes(i);
              const showResult = isAnswered;
              let optionClass = 'practice-option';
              if (showResult) {
                if (isCorrect) optionClass += ' correct';
                else if (isSelected) optionClass += ' incorrect';
              }
              if (isSelected) optionClass += ' selected';
              return `
                <button type="button" class="${optionClass}" data-option="${i}" ${isAnswered ? 'disabled' : ''} style="
                  display:flex;align-items:flex-start;gap:var(--space-3);
                  padding:var(--space-4);border:2px solid var(--color-border);
                  border-radius:var(--radius-lg);background:var(--color-bg-elevated);
                  text-align:left;cursor:${isAnswered ? 'not-allowed' : 'pointer'};
                  transition:all var(--transition-fast);
                  ${showResult && isCorrect ? 'border-color:var(--color-success);background:var(--color-success-light);' : ''}
                  ${showResult && isSelected && !isCorrect ? 'border-color:var(--color-danger);background:var(--color-danger-light);' : ''}
                  ${isSelected && !showResult ? 'border-color:var(--color-primary);background:var(--color-primary-light);' : ''}
                ">
                  <span style="width:28px;height:28px;border:2px solid var(--color-border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);flex-shrink:0;${isSelected ? 'background:var(--color-primary);border-color:var(--color-primary);color:white;' : ''}">${String.fromCharCode(65 + i)}</span>
                  <div style="flex:1;font-size:var(--text-base);line-height:var(--leading-relaxed);">${this.renderMarkdown(opt.text)}</div>
                  ${showResult && isCorrect ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
                  ${showResult && isSelected && !isCorrect ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : ''}
                </button>
              `;
            }).join('')}
          </div>

          <!-- Explanation -->
          ${q.explanation && (this.session.config.showExplanationImmediately || isAnswered) ? `
            <div class="card" style="background:var(--color-info-light);border-color:var(--color-info);margin-bottom:var(--space-6);">
              <div class="card-content">
                <div style="display:flex;align-items:flex-start;gap:var(--space-3);">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="2" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  <div style="flex:1;">
                    <div style="font-weight:var(--font-semibold);margin-bottom:var(--space-1);">${t('practice.explanation')}</div>
                    <div style="font-size:var(--text-sm);line-height:var(--leading-relaxed);">${this.renderMarkdown(q.explanation)}</div>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Actions -->
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-ghost" id="btnFlag" data-flagged="${answer?.flagged ? 'true' : 'false'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${answer?.flagged ? 'stroke:var(--color-warning);fill:var(--color-warning);' : ''}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                ${t('practice.flag')}
              </button>
              <button class="btn btn-ghost" id="btnMarkReview" data-marked="${answer?.markedReview ? 'true' : 'false'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${answer?.markedReview ? 'stroke:var(--color-info);fill:var(--color-info);' : ''}"><path d="M19 21l-7-7-7 7-7-7-7 7"/><path d="M2 19l7-7 7 7"/></svg>
                ${t('practice.markReview')}
              </button>
            </div>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-secondary" id="btnPrev" ${this.session.currentIndex === 0 ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                ${t('common.previous')}
              </button>
              <button class="btn btn-primary" id="btnNext" ${this.session.currentIndex === this.session.questions.length - 1 ? 'disabled' : ''}>
                ${t('common.next')}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button class="btn btn-primary" id="btnFinish" style="display:${this.session.currentIndex === this.session.questions.length - 1 ? 'inline-flex' : 'none'};">
                ${t('practice.finish')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigator (compact) -->
      <div class="card" style="margin-top:var(--space-4);">
        <div class="card-content" style="padding:var(--space-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-2);">
            <span style="font-weight:var(--font-medium);">Navigator</span>
            <button class="btn btn-ghost btn-sm" id="btnJump">${t('practice.jump')}</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px;">
            ${this.session.questions.map((_, i) => {
              const ans = this.session.answers.get(this.session.questions[i].id);
              let cls = 'nav-btn';
              if (i === this.session.currentIndex) cls += ' current';
              else if (ans?.flagged) cls += ' flagged';
              else if (ans?.markedReview) cls += ' marked';
              else if (ans) cls += ' answered';
              return `<button class="${cls}" data-index="${i}" style="width:36px;height:36px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:var(--text-xs);font-weight:var(--font-medium);${i === this.session.currentIndex ? 'background:var(--color-primary);color:white;border-color:var(--color-primary);' : ans?.flagged ? 'border-color:var(--color-warning);color:var(--color-warning);' : ans?.markedReview ? 'border-color:var(--color-info);color:var(--color-info);' : ans ? 'background:var(--color-success);color:white;border-color:var(--color-success);' : 'background:var(--color-bg);color:var(--color-text-muted);'}">${i + 1}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private getReviewHTML(): string {
    if (!this.session) return '';
    const correctCount = Array.from(this.session.answers.values()).filter(a => a.isCorrect).length;
    const scorePercent = Math.round((correctCount / this.session.questions.length) * 100);

    return `
      <div class="page-header">
        <h1 class="page-title">${t('practice.sessionSummary')}</h1>
        <p class="page-subtitle">${t('practice.score', { correct: correctCount, total: this.session.questions.length, percent: scorePercent })}</p>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-content" style="text-align:center;padding:var(--space-8);">
          <div style="font-size:var(--text-4xl);font-weight:var(--font-bold);color:var(--color-primary);">${scorePercent}%</div>
          <div style="margin-top:var(--space-4);display:flex;justify-content:center;gap:var(--space-6);color:var(--color-text-muted);">
            <div>Benar: <strong style="color:var(--color-success);">${correctCount}</strong></div>
            <div>Salah: <strong style="color:var(--color-danger);">${this.session.questions.length - correctCount}</strong></div>
            <div>Waktu: <strong>${this.formatDuration(Date.now() - this.session.startTime)}</strong></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${t('practice.reviewErrors')}</h3>
        </div>
        <div class="card-content">
          ${this.session.questions.map((q, i) => {
            const ans = this.session.answers.get(q.id);
            if (!ans || ans.isCorrect) return '';
            return `
              <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-4);">
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
                  <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
                  <span class="badge">${q.topicCode}</span>
                  <span style="font-weight:var(--font-medium);">Soal ${i + 1}</span>
                </div>
                <div style="font-weight:var(--font-medium);margin-bottom:var(--space-3);">${this.renderMarkdown(q.stem)}</div>
                <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-3);">
                  ${q.options.map((opt: any, oi: number) => `
                    <div style="padding:var(--space-2);border-radius:var(--radius-md);${q.correctAnswer.includes(oi) ? 'background:var(--color-success-light);border:1px solid var(--color-success);' : ans.userAnswer.includes(oi) ? 'background:var(--color-danger-light);border:1px solid var(--color-danger);' : ''}">
                      <span style="font-weight:var(--font-bold);width:24px;display:inline-block;">${String.fromCharCode(65 + oi)}</span>
                      ${this.renderMarkdown(opt.text)}
                      ${q.correctAnswer.includes(oi) ? ' <span class="badge badge-success">Benar</span>' : ''}
                      ${ans.userAnswer.includes(oi) && !q.correctAnswer.includes(oi) ? ' <span class="badge badge-danger">Jawaban Anda</span>' : ''}
                    </div>
                  `).join('')}
                </div>
                ${q.explanation ? `
                  <div style="padding:var(--space-3);background:var(--color-info-light);border-radius:var(--radius-md);border:1px solid var(--color-info);">
                    <strong>${t('practice.explanation')}</strong>
                    <div style="margin-top:var(--space-1);">${this.renderMarkdown(q.explanation)}</div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-6);">
        <a href="#/practice" class="btn btn-primary">${t('practice.title')} Lagi</a>
        <a href="#/dashboard" class="btn btn-secondary">${t('nav.dashboard')}</a>
      </div>
    `;
  }

  private renderMarkdown(text: string): string {
    // Simple markdown rendering for basic formatting
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\$\$(.+?)\$\$/g, '<span class="math">$1</span>')
      .replace(/\$(.+?)\$/g, '<span class="math">$1</span>')
      .replace(/\n/g, '<br>');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}j ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}d`;
    return `${seconds}d`;
  }

  private selectQuestions(config: any): any[] {
    let pool = this.allQuestions.filter((q: any) => !q.deletedAt);
    
    if (config.topicCodes?.length) {
      pool = pool.filter((q: any) => config.topicCodes.includes(q.topicCode));
    }
    if (!config.includeFlagged) pool = pool.filter((q: any) => !q.flags.bookmarked);
    if (!config.includeNeedsReview) pool = pool.filter((q: any) => !q.flags.needsReview);
    
    if (config.prioritizeWeak) {
      pool.sort((a: any, b: any) => a.statistics.masteryLevel - b.statistics.masteryLevel);
    }
    
    if (config.difficultyMix) {
      const byDiff: Record<number, any[]> = { 1: [], 2: [], 3: [] };
      pool.forEach(q => byDiff[q.difficulty].push(q));
      const total = pool.length;
      pool = [];
      Object.entries(config.difficultyMix).forEach(([diff, pct]) => {
        const count = Math.round(total * (pct as number) / 100);
        pool.push(...(byDiff[parseInt(diff)] ?? []).slice(0, count));
      });
    }
    
    if (config.randomOrder) pool = pool.sort(() => Math.random() - 0.5);
    
    const count = config.questionCount === 'all' ? pool.length : Math.min(config.questionCount, pool.length);
    return pool.slice(0, count);
  }

  private startWeakAreasPractice(): void {
    const weakTopics = this.getWeakTopics();
    const config = {
      topicCodes: weakTopics,
      questionCount: 20,
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
      prioritizeWeak: true,
      includeFlagged: true,
      includeNeedsReview: true,
      randomOrder: true,
      showExplanationImmediately: true,
    };
    this.startSession(config);
  }

  private getWeakTopics(): string[] {
    // Simplified - would use actual mastery stats
    return ['UM-01', 'UM-02', 'KH-01', 'KH-03'];
  }

  private startSession(config: any): void {
    const questions = this.selectQuestions(config);
    if (questions.length === 0) {
      alert('Tidak ada soal yang sesuai filter. Ubah filter atau tambah soal.');
      return;
    }

    this.session = {
      id: generateId(),
      config,
      questions,
      currentIndex: 0,
      answers: new Map(),
      startTime: Date.now(),
      status: 'active',
    };

    this.questionStartTime = Date.now();
    this.renderSession();
    this.startAutoSave();
  }

  private renderSession(): void {
    if (!this.element || !this.session) return;
    if (this.session.status === 'review' || this.session.status === 'completed') {
      this.element.innerHTML = this.getReviewHTML();
    } else {
      this.element.innerHTML = this.getSessionHTML();
    }
    this.bindSessionEvents();
  }

  private bindConfigEvents(): void {
    if (!this.element) return;

    // Topic buttons
    this.element.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        const topic = btn.dataset.topic;
        if (topic === 'all') {
          this.element!.querySelectorAll('[data-topic]').forEach(b => b.classList.remove('btn-primary'));
          this.element!.querySelector('[data-topic="all"]')!.classList.add('btn-primary');
        } else {
          btn.classList.toggle('btn-primary');
          btn.classList.toggle('btn-ghost');
          const allBtn = this.element!.querySelector('[data-topic="all"]') as HTMLButtonElement;
          if (allBtn) allBtn.classList.remove('btn-primary');
        }
        this.updateSelectedTopics();
      });
    });

    // Difficulty mix
    this.element.querySelectorAll('[data-difficulty]').forEach(input => {
      (input as HTMLInputElement).addEventListener('change', () => this.validateDifficultyMix());
    });

    // Start button
    this.element.querySelector('#btnStartPractice')?.addEventListener('click', () => {
      const config = this.getConfigFromForm();
      this.startSession(config);
    });

    // Cancel
    this.element.querySelector('#btnCancelConfig')?.addEventListener('click', () => {
      navigate('dashboard');
    });
  }

  private updateSelectedTopics(): void {
    const selected = Array.from(this.element!.querySelectorAll('[data-topic].btn-primary'))
      .map(btn => btn.dataset.topic!)
      .filter(t => t !== 'all');
    const input = this.element!.querySelector('#selectedTopics') as HTMLInputElement;
    if (input) input.value = selected.join(',');
  }

  private validateDifficultyMix(): void {
    const inputs = this.element!.querySelectorAll('[data-difficulty]') as NodeListOf<HTMLInputElement>;
    let total = 0;
    inputs.forEach(input => { total += parseInt(input.value) || 0; });
    // Could show warning if total !== 100
  }

  private getConfigFromForm(): any {
    const topicsInput = this.element!.querySelector('#selectedTopics') as HTMLInputElement;
    const topicCodes = topicsInput?.value ? topicsInput.value.split(',') : [];
    
    const difficultyMix: Record<number, number> = {};
    this.element!.querySelectorAll('[data-difficulty]').forEach(input => {
      difficultyMix[parseInt((input as HTMLInputElement).dataset.difficulty!)] = parseInt((input as HTMLInputElement).value) || 0;
    });

    return {
      topicCodes,
      questionCount: parseInt((this.element!.querySelector('#questionCount') as HTMLSelectElement).value) || 20,
      difficultyMix,
      prioritizeWeak: (this.element!.querySelector('#prioritizeWeak') as HTMLInputElement).checked,
      includeFlagged: (this.element!.querySelector('#includeFlagged') as HTMLInputElement).checked,
      includeNeedsReview: (this.element!.querySelector('#includeNeedsReview') as HTMLInputElement).checked,
      randomOrder: (this.element!.querySelector('#randomOrder') as HTMLInputElement).checked,
      showExplanationImmediately: (this.element!.querySelector('#showExplanation') as HTMLInputElement).checked,
    };
  }

  private bindSessionEvents(): void {
    if (!this.element || !this.session) return;

    // Option selection
    this.element.querySelectorAll('.practice-option:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const optionIndex = parseInt(target.dataset.option!);
        this.selectOption(optionIndex);
      });
    });

    // Navigation
    this.element.querySelector('#btnPrev')?.addEventListener('click', () => this.navigate(-1));
    this.element.querySelector('#btnNext')?.addEventListener('click', () => this.navigate(1));
    this.element.querySelector('#btnFinish')?.addEventListener('click', () => this.finishSession());

    // Flag/Mark Review
    this.element.querySelector('#btnFlag')?.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const flagged = target.dataset.flagged === 'true';
      target.dataset.flagged = (!flagged).toString();
      this.toggleFlag(!flagged);
    });
    this.element.querySelector('#btnMarkReview')?.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const marked = target.dataset.marked === 'true';
      target.dataset.marked = (!marked).toString();
      this.toggleMarkReview(!marked);
    });

    // Navigator
    this.element.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        this.jumpToQuestion(parseInt(target.dataset.index!));
      });
    });
    this.element.querySelector('#btnJump')?.addEventListener('click', () => {
      // Could show a modal for jump
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeys);
  }

  private handleKeys = (e: KeyboardEvent): void => {
    if (!this.session || this.session.status !== 'active') return;
    
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    if (e.key >= '1' && e.key <= '5') {
      const idx = parseInt(e.key) - 1;
      const q = this.session!.questions[this.session!.currentIndex];
      if (idx < q.options.length) {
        this.selectOption(idx);
      }
    } else if (e.key === 'ArrowLeft') {
      this.navigate(-1);
    } else if (e.key === 'ArrowRight') {
      this.navigate(1);
    } else if (e.key === 'f' || e.key === 'F') {
      this.toggleFlag();
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMarkReview();
    } else if (e.key === ' ') {
      e.preventDefault();
      // Could toggle explanation
    }
  };

  private selectOption(optionIndex: number): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    const timeMs = Date.now() - this.questionStartTime;
    
    const isCorrect = q.correctAnswer.includes(optionIndex);
    const answer = {
      userAnswer: [optionIndex],
      isCorrect,
      timeMs,
      flagged: false,
      markedReview: false,
    };
    
    this.session.answers.set(q.id, answer);
    
    // Update mastery
    import('../db/repositories/questions').then(m => m.questionsRepo.updateMastery(q.id, isCorrect));
    
    // Record attempt
    const attempt = {
      sessionId: this.session.id,
      questionId: q.id,
      userAnswer: [optionIndex],
      isCorrect,
      timeMs,
      timestamp: nowISO(),
      flagged: false,
      markedReview: false,
    };
    import('../db/repositories/attempts').then(m => m.attemptsRepo.add(attempt));
    
    // Update UI immediately
    this.renderSession();
    this.questionStartTime = Date.now();
  }

  private navigate(direction: number): void {
    if (!this.session) return;
    const newIndex = this.session.currentIndex + direction;
    if (newIndex >= 0 && newIndex < this.session.questions.length) {
      this.session.currentIndex = newIndex;
      this.questionStartTime = Date.now();
      this.renderSession();
    }
  }

  private jumpToQuestion(index: number): void {
    if (!this.session) return;
    if (index >= 0 && index < this.session.questions.length) {
      this.session.currentIndex = index;
      this.questionStartTime = Date.now();
      this.renderSession();
    }
  }

  private toggleFlag(flagged?: boolean): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    const ans = this.session.answers.get(q.id);
    if (ans) {
      ans.flagged = flagged ?? !ans.flagged;
      this.session.answers.set(q.id, ans);
      this.renderSession();
    }
  }

  private toggleMarkReview(marked?: boolean): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    const ans = this.session.answers.get(q.id);
    if (ans) {
      ans.markedReview = marked ?? !ans.markedReview;
      this.session.answers.set(q.id, ans);
      this.renderSession();
    }
  }

  private finishSession(): void {
    if (!this.session) return;
    this.session.status = 'review';
    this.stopAutoSave();
    this.saveSession();
    this.renderSession();
  }

  private async saveSession(): Promise<void> {
    if (!this.session) return;
    
    const correctCount = Array.from(this.session.answers.values()).filter(a => a.isCorrect).length;
    const totalTime = Date.now() - this.session.startTime;
    
    const summary = {
      totalQuestions: this.session.questions.length,
      answeredQuestions: this.session.answers.size,
      correctAnswers: correctCount,
      scorePercent: Math.round((correctCount / this.session.questions.length) * 100),
      timeSpentMs: totalTime,
      perTopic: {} as any,
    };
    
    // Per topic stats
    this.session.questions.forEach(q => {
      const ans = this.session!.answers.get(q.id);
      if (!summary.perTopic[q.topicCode]) {
        summary.perTopic[q.topicCode] = { attempted: 0, correct: 0, avgTimeMs: 0 };
      }
      if (ans) {
        summary.perTopic[q.topicCode].attempted++;
        if (ans.isCorrect) summary.perTopic[q.topicCode].correct++;
        summary.perTopic[q.topicCode].avgTimeMs += ans.timeMs;
      }
    });
    
    Object.keys(summary.perTopic).forEach(topic => {
      if (summary.perTopic[topic].attempted > 0) {
        summary.perTopic[topic].avgTimeMs = Math.round(summary.perTopic[topic].avgTimeMs / summary.perTopic[topic].attempted);
      }
    });

    const sessionRecord = {
      id: this.session!.id,
      mode: 'practice' as const,
      startedAt: new Date(this.session!.startTime).toISOString(),
      completedAt: nowISO(),
      config: this.session!.config,
      topicCodes: this.session!.questions.map(q => q.topicCode),
      summary,
    };

    await import('../db/repositories/sessions').then(m => m.sessionsRepo.put(sessionRecord));
    
    // Update streak
    this.updateStreak();
  }

  private updateStreak(): void {
    const today = new Date().toISOString().split('T')[0];
    const streakData = localStorage.getItem('study-streak');
    let current = 0;
    let lastDate = '';
    
    if (streakData) {
      try {
        const parsed = JSON.parse(streakData);
        current = parsed.current || 0;
        lastDate = parsed.lastDate || '';
      } catch {}
    }
    
    if (lastDate === today) return;
    
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (lastDate === yesterday) {
      current++;
    } else {
      current = 1;
    }
    
    localStorage.setItem('study-streak', JSON.stringify({ current, lastDate: today }));
  }

  private startAutoSave(): void {
    this.autoSaveInterval = setInterval(() => {
      if (this.session) this.saveSession();
    }, 5000);
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    this.autoSaveInterval = null;
  }

  // Cleanup
  destroy(): void {
    this.stopAutoSave();
    document.removeEventListener('keydown', this.handleKeys);
  }
}
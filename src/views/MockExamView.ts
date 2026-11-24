// Mock Exam View (CAT Simulation)
import { questionsRepo } from '../db/repositories/questions';
import { sessionsRepo } from '../db/repositories/sessions';
import { attemptsRepo } from '../db/repositories/attempts';
import { getSubdomainColor, loadKisiKisi } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, formatTime, debounce } from '../core/utils';
import type { Question, Session, SessionConfig } from '../shared/types';

interface MockExamSession {
  id: string;
  config: SessionConfig;
  questions: Question[];
  currentIndex: number;
  answers: Map<string, { userAnswer: number[]; isCorrect: boolean; timeMs: number; flagged: boolean; markedReview: boolean }>;
  flags: Set<string>;
  markedReview: Set<string>;
  startTime: number;
  timeRemainingMs: number;
  timerId: ReturnType<typeof setInterval> | null;
  status: 'config' | 'ready' | 'active' | 'paused' | 'confirming' | 'review';
}

export class MockExamView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private session: MockExamSession | null = null;
  private questionStartTime = 0;
  private allQuestions: any[] = [];

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  async loadQuestions(): Promise<void> {
    this.allQuestions = await questionsRepo.getAll();
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'mock-exam-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadQuestions().then(() => {
      if (this.element) {
        if (this.params.config === 'true') {
          this.element.innerHTML = this.getConfigHTML();
          this.bindConfigEvents();
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
        <h1 class="page-title">${t('mock.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getConfigHTML(): string {
    const defaults = {
      durationMinutes: 90,
      questionCount: 60,
      topicWeights: {
        'UM-01': 1, 'UM-02': 1, 'UM-03': 1, 'UM-04': 1, 'UM-05': 1,
        'UM-06': 1, 'UM-07': 1, 'UM-08': 1, 'UM-09': 1,
        'KH-01': 1.5, 'KH-02': 1.5, 'KH-03': 1.5, 'KH-04': 1.5,
        'KH-05': 1.5, 'KH-06': 1.5, 'KH-07': 1.5, 'KH-08': 1.5,
        'KH-09': 1.5, 'KH-10': 1.5, 'KH-11': 1.5, 'KH-12': 1.5,
      },
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
    };

    return `
      <div class="page-header">
        <h1 class="page-title">${t('mock.title')}</h1>
        <p class="page-subtitle">${t('mock.config')}</p>
      </div>

      <div class="card" style="max-width:700px;">
        <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);">
          <fieldset>
            <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Konfigurasi Ujian</legend>
            
            <div class="form-group">
              <label class="form-label" for="mockDuration">${t('mock.duration')} (menit)</label>
              <input type="number" id="mockDuration" class="form-input" value="90" min="30" max="180" step="15">
            </div>

            <div class="form-group">
              <label class="form-label" for="mockQuestionCount">${t('mock.questionCount')}</label>
              <input type="number" id="mockQuestionCount" class="form-input" value="60" min="10" max="200" step="5">
            </div>

            <div class="form-group">
              <label class="form-label">${t('mock.difficultyMix')}</label>
              <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
                ${[1, 2, 3].map(d => `
                  <div style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="min-width:60px;">${t('difficulty.' + d)}</span>
                    <input type="number" step="5" min="0" max="100" value="${d===2?50:d===1?30:20}" data-difficulty="${d}" aria-label="${t('mock.difficultyMix')} — ${t('difficulty.' + d)}" class="form-input" style="width:80px;">
                    <span>%</span>
                  </div>
                `).join('')}
              </div>
              <p class="form-help">Total harus 100%</p>
            </div>

            <div class="form-group">
              <label class="form-label">${t('settings.topicWeights')}</label>
              <p class="form-help">Bobot relatif untuk pemilihan soal per topik (default: UM=1.0, KH=1.5)</p>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3);max-height:300px;overflow:auto;padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);">
                ${loadKisiKisi().then(({topics}) => topics.map(t => `
                  <div style="display:flex;align-items:center;gap:var(--space-2);">
                    <span style="font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--color-text-muted);min-width:60px;">${t.code}</span>
                    <input type="number" step="0.1" min="0" max="5" value="1" data-weight="${t.code}" class="form-input" style="width:70px;font-size:var(--text-sm);">
                  </div>
                `).join(''))}
              </div>
            </div>
          </fieldset>

          <div style="display:flex;gap:var(--space-3);justify-content:flex-end;">
            <button class="btn btn-secondary" id="btnCancelConfig">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="btnStartExam">${t('mock.start')}</button>
          </div>
        </div>
      </div>
    `;
  }

  private getExamHTML(): string {
    if (!this.session) return '';
    const q = this.session.questions[this.session.currentIndex];
    const progress = ((this.session.currentIndex + 1) / this.session.questions.length) * 100;
    const answer = this.session.answers.get(q.id);
    const isAnswered = !!answer;
    const isFlagged = this.session.flags.has(q.id);
    const isMarked = this.session.markedReview.has(q.id);
    const timeStr = formatTime(this.session.timeRemainingMs);
    const warningClass = this.session.timeRemainingMs <= 60000 ? 'danger' : this.session.timeRemainingMs <= 300000 ? 'warning' : this.session.timeRemainingMs <= 900000 ? 'info' : '';

    return `
      <div class="exam-header" style="position:fixed;top:0;left:0;right:0;background:var(--color-bg-elevated);border-bottom:1px solid var(--color-border);padding:var(--space-3) var(--space-4);z-index:var(--z-sticky);box-shadow:var(--shadow-md);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);">
          <div style="display:flex;align-items:center;gap:var(--space-4);">
            <h1 class="page-title" style="font-size:var(--text-lg);">${t('mock.title')}</h1>
            <span class="badge badge-${isFlagged ? 'warning' : isMarked ? 'info' : 'muted'}">${isFlagged ? '⚑ Flagged' : isMarked ? '★ Review' : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-4);">
            <div class="timer ${warningClass}" role="timer" aria-label="${t('mock.duration')}" aria-live="off" style="font-size:var(--text-2xl);font-weight:var(--font-bold);font-family:var(--font-mono);font-variant-numeric:tabular-nums;${this.session.timeRemainingMs <= 60000 ? 'color:var(--color-danger);animation:pulse 1s infinite;' : this.session.timeRemainingMs <= 300000 ? 'color:var(--color-warning);' : ''}">
              ${timeStr}
            </div>
            <div class="timer-warning visually-hidden" role="status" aria-live="assertive" aria-atomic="true">${this.getTimerWarning()}</div>
            <div style="display:flex;gap:var(--space-2);">
              <button type="button" class="btn btn-ghost btn-icon" id="btnFlagExam" aria-label="${t('mock.flag')}" aria-pressed="${this.session.flags.has(q.id)}" title="${t('mock.flag')}" style="${this.session.flags.has(q.id) ? 'color:var(--color-warning);' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></button>
              <button type="button" class="btn btn-ghost btn-icon" id="btnMarkReviewExam" aria-label="${t('mock.markReview')}" aria-pressed="${this.session.markedReview.has(q.id)}" title="${t('mock.markReview')}" style="${this.session.markedReview.has(q.id) ? 'color:var(--color-info);' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21l-7-7-7 7-7-7-7 7"/><path d="M2 19l7-7 7 7"/></svg></button>
              <button type="button" class="btn btn-ghost btn-icon" id="btnSubmitExam" aria-label="${t('mock.submit')}" title="${t('mock.submit')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            </div>
          </div>
        </div>

        <div style="padding-top:calc(var(--header-height) + 80px);">
          <div class="card" style="margin:var(--space-4);">
            <div class="card-content">
              <!-- Question -->
              <div style="margin-bottom:var(--space-6);">
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted);">
                  <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(q.topicCode)};">${q.topicCode}</span>
                  <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
                  <span>Soal ${this.session.currentIndex + 1} / ${this.session.questions.length}</span>
                </div>
                <div style="font-size:var(--text-lg);line-height:var(--leading-relaxed);font-weight:var(--font-medium);margin-bottom:var(--space-6);">${q.stem}</div>

                <!-- Options -->
                <div style="display:flex;flex-direction:column;gap:var(--space-3);">
                  ${q.options.map((opt: any, i: number) => {
                    const isSelected = answer?.userAnswer.includes(i);
                    const isCorrect = q.correctAnswer.includes(i);
                    const showResult = false; // Don't show during exam
                    let cls = 'exam-option';
                    if (isSelected) cls += ' selected';
                    return `
                      <button type="button" class="${cls}" data-option="${i}" style="
                        display:flex;align-items:flex-start;gap:var(--space-3);
                        min-height:44px;padding:var(--space-4);border:2px solid var(--color-border-strong);
                        border-radius:var(--radius-lg);background:var(--color-bg-elevated);
                        text-align:left;cursor:pointer;transition:all var(--transition-fast);
                        ${isSelected ? 'border-color:var(--color-primary);background:var(--color-primary-light);' : ''}
                      ">
                        <span style="width:32px;height:32px;border:2px solid var(--color-border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:var(--font-bold);font-size:var(--text-base);flex-shrink:0;${isSelected ? 'background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary);' : ''}">${String.fromCharCode(65 + i)}</span>
                        <div style="flex:1;font-size:var(--text-base);line-height:var(--leading-relaxed);">${opt.text}</div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Navigator Grid -->
              <div style="margin-top:var(--space-6);padding-top:var(--space-6);border-top:1px solid var(--color-border);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
                  <span style="font-weight:var(--font-semibold);">${t('mock.navigator')}</span>
                  <div style="display:flex;gap:var(--space-1);font-size:var(--text-xs);color:var(--color-text-muted);">
                    <span class="nav-legend answered" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:var(--color-success);border-radius:2px;"></span> Terjawab</span>
                    <span class="nav-legend flagged" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;border:2px solid var(--color-warning);border-radius:2px;"></span> Flag</span>
                    <span class="nav-legend marked" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;border:2px solid var(--color-info);border-radius:2px;"></span> Review</span>
                    <span class="nav-legend current" style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:var(--color-primary);border-radius:2px;"></span> Sekarang</span>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:6px;">
                  ${this.session.questions.map((_, i) => {
                    const isCurrent = i === this.session.currentIndex;
                    const isAnswered = this.session.answers.has(this.session.questions[i].id);
                    const isFlagged = this.session.flags.has(this.session.questions[i].id);
                    const isMarked = this.session.markedReview.has(this.session.questions[i].id);
                    let cls = 'nav-cell';
                    if (isCurrent) cls += ' current';
                    else if (isFlagged && isAnswered) cls += ' answered flagged';
                    else if (isFlagged) cls += ' flagged';
                    else if (isMarked) cls += ' marked';
                    else if (isAnswered) cls += ' answered';
                    const status = isCurrent ? ', sedang dikerjakan' : isFlagged ? ', ditandai' : isMarked ? ', perlu ditinjau' : isAnswered ? ', sudah dijawab' : ', belum dijawab';
                    return `<button type="button" class="${cls}" data-index="${i}" aria-label="Soal ${i + 1}${status}" aria-current="${isCurrent ? 'true' : 'false'}" style="min-width:44px;min-height:44px;aspect-ratio:1;border:2px solid;border-radius:var(--radius-md);font-weight:var(--font-semibold);font-size:var(--text-sm);${isCurrent ? `background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary);` : isFlagged && isAnswered ? `background:var(--color-success);color:var(--color-on-success);border-color:var(--color-warning);` : isFlagged ? 'border-color:var(--color-warning);color:var(--color-warning);' : isMarked ? 'border-color:var(--color-info);color:var(--color-info);' : isAnswered ? `background:var(--color-success);color:var(--color-on-success);border-color:var(--color-success);` : 'background:var(--color-bg);color:var(--color-text-muted);border-color:var(--color-border-strong);'}">${i + 1}</button>`;
                  }).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
  }

  private getReviewHTML(): string {
    if (!this.session) return '';
    const correctCount = Array.from(this.session.answers.values()).filter(a => a.isCorrect).length;
    const scorePercent = Math.round((correctCount / this.session.questions.length) * 100);
    const totalTime = Date.now() - this.session.startTime;

    return `
      <div class="page-header">
        <h1 class="page-title">${t('mock.results')}</h1>
        <p class="page-subtitle">${t('practice.score', { correct: correctCount, total: this.session.questions.length, percent: scorePercent })} • Waktu: ${formatTime(totalTime)}</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-4);margin-bottom:var(--space-6);">
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-6);">
            <div style="font-size:var(--text-4xl);font-weight:var(--font-bold);color:${scorePercent >= 70 ? 'var(--color-success)' : 'var(--color-primary)'};">${scorePercent}%</div>
            <div style="margin-top:var(--space-2);color:var(--color-text-muted);">${t('mock.overallScore')}</div>
            <div style="margin-top:var(--space-4);font-size:var(--text-sm);color:var(--color-text-muted);">
              Benar: <strong style="color:var(--color-success);">${correctCount}</strong> / ${this.session.questions.length}
            </div>
            <div style="margin-top:var(--space-1);font-size:var(--text-sm);color:var(--color-text-muted);">
              Waktu: <strong>${formatTime(totalTime)}</strong>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-content">
            <h2 style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-3);">${t('mock.perTopic')}</h2>
            ${this.getPerTopicHTML()}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-header">
          <h2 class="card-title">${t('mock.reviewMode')}</h2>
        </div>
        <div class="card-content">
          ${this.session.questions.map((q, i) => {
            const ans = this.session.answers.get(q.id);
            const isCorrect = ans?.isCorrect;
            const userAns = ans?.userAnswer[0];
            return `
              <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-4);">
                <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
                  <span class="badge ${isCorrect ? 'badge-success' : 'badge-danger'}">${isCorrect ? 'Benar' : 'Salah'}</span>
                  <span class="badge badge-difficulty-${q.difficulty}">${t('difficulty.' + q.difficulty)}</span>
                  <span class="badge">${q.topicCode}</span>
                  <span style="font-weight:var(--font-medium);">Soal ${i + 1}</span>
                </div>
                <div style="font-weight:var(--font-medium);margin-bottom:var(--space-3);">${q.stem}</div>
                <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-3);">
                  ${q.options.map((opt: any, oi: number) => `
                    <div style="padding:var(--space-2);border-radius:var(--radius-md);${q.correctAnswer.includes(oi) ? 'background:var(--color-success-light);border:1px solid var(--color-success);' : userAns === oi ? 'background:var(--color-danger-light);border:1px solid var(--color-danger);' : ''}">
                      <span style="font-weight:var(--font-bold);width:24px;display:inline-block;">${String.fromCharCode(65 + oi)}</span>
                      ${opt.text}
                      ${q.correctAnswer.includes(oi) ? ' <span class="badge badge-success">Kunci</span>' : ''}
                      ${userAns === oi && !q.correctAnswer.includes(oi) ? ' <span class="badge badge-danger">Jawaban Anda</span>' : ''}
                    </div>
                  `).join('')}
                </div>
                ${q.explanation ? `
                  <div style="padding:var(--space-3);background:var(--color-info-light);border-radius:var(--radius-md);border:1px solid var(--color-info);">
                    <strong>${t('practice.explanation')}</strong>
                    <div style="margin-top:var(--space-1);">${q.explanation}</div>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-6);">
        <button class="btn btn-primary" id="btnReviewAgain">${t('mock.title')} Lagi</button>
        <a href="#/dashboard" class="btn btn-secondary">${t('nav.dashboard')}</a>
        <a href="#/analytics" class="btn btn-secondary">${t('nav.analytics')}</a>
      </div>
    `;
  }

  private getPerTopicHTML(): string {
    if (!this.session) return '';
    const topicStats: Record<string, { total: number; correct: number }> = {};
    
    this.session.questions.forEach(q => {
      const ans = this.session!.answers.get(q.id);
      if (!topicStats[q.topicCode]) topicStats[q.topicCode] = { total: 0, correct: 0 };
      topicStats[q.topicCode].total++;
      if (ans?.isCorrect) topicStats[q.topicCode].correct++;
    });

    return Object.entries(topicStats).map(([code, stats]) => {
      const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);">
          <span class="badge badge-topic" style="--badge-topic-color:${getSubdomainColor(code)};">${code}</span>
          <span>${stats.correct}/${stats.total} (${pct}%)</span>
        </div>
      `;
    }).join('');
  }

  private selectQuestions(config: any): any[] {
    // Proportional selection by topic weights
    const byTopic: Record<string, any[]> = {};
    this.allQuestions.forEach(q => {
      if (!q.deletedAt) {
        if (!byTopic[q.topicCode]) byTopic[q.topicCode] = [];
        byTopic[q.topicCode].push(q);
      }
    });

    const selected: any[] = [];
    const totalWeight = Object.values(config.topicWeights || {}).reduce((a: number, b: number) => a + b, 0);

    for (const [topicCode, weight] of Object.entries(config.topicWeights || {})) {
      if ((weight as number) <= 0) continue;
      const topicQuestions = byTopic[topicCode] || [];
      if (topicQuestions.length === 0) continue;

      const target = Math.round(config.questionCount * (weight as number) / totalWeight);
      const byDiff: Record<number, any[]> = { 1: [], 2: [], 3: [] };
      topicQuestions.forEach(q => byDiff[q.difficulty].push(q));

      let topicSelected: any[] = [];
      for (const [diff, pct] of Object.entries(config.difficultyMix || {})) {
        const diffQuestions = byDiff[parseInt(diff)] || [];
        const diffTarget = Math.round(target * (pct as number) / 100);
        topicSelected.push(...diffQuestions.sort(() => Math.random() - 0.5).slice(0, diffTarget));
      }

      if (topicSelected.length < target) {
        const remaining = topicQuestions.filter(q => !topicSelected.includes(q));
        topicSelected.push(...remaining.sort(() => Math.random() - 0.5).slice(0, target - topicSelected.length));
      }

      selected.push(...topicSelected.slice(0, target));
    }

    return selected.sort(() => Math.random() - 0.5).slice(0, config.questionCount);
  }

  private startExam(config: any): void {
    const questions = this.selectQuestions(config);
    if (questions.length === 0) {
      alert('Tidak ada soal yang sesuai konfigurasi. Periksa bobot topik dan kesulitan.');
      return;
    }

    this.session = {
      id: generateId(),
      config,
      questions,
      currentIndex: 0,
      answers: new Map(),
      flags: new Set(),
      markedReview: new Set(),
      startTime: Date.now(),
      timeRemainingMs: config.durationMinutes * 60 * 1000,
      timerId: null,
      status: 'active',
    };

    this.questionStartTime = Date.now();
    this.element?.setAttribute('data-exam-active', 'true');
    this.startTimer();
    this.renderExam();
    this.enterFullscreen();
    this.bindExamEvents();
  }

  private startTimer(): void {
    if (!this.session) return;
    this.session.timerId = setInterval(() => {
      if (!this.session || this.session.status !== 'active') return;
      this.session.timeRemainingMs -= 1000;
      if (this.session.timeRemainingMs <= 0) {
        this.session.timeRemainingMs = 0;
        this.autoSubmit();
      }
      this.updateTimerDisplay();
    }, 1000);
  }

  private updateTimerDisplay(): void {
    if (!this.session || !this.element) return;
    const timerEl = this.element.querySelector('.timer');
    if (timerEl) {
      timerEl.textContent = formatTime(this.session.timeRemainingMs);
      timerEl.className = 'timer';
      if (this.session.timeRemainingMs <= 60000) timerEl.classList.add('danger');
      else if (this.session.timeRemainingMs <= 300000) timerEl.classList.add('warning');
      else if (this.session.timeRemainingMs <= 900000) timerEl.classList.add('info');
    }

    // Only the warning is a live region; the ticking timer itself is silent so
    // screen readers are not interrupted every second.
    const warningEl = this.element.querySelector<HTMLElement>('.timer-warning');
    const warning = this.getTimerWarning();
    if (warningEl && warningEl.textContent !== warning) warningEl.textContent = warning;
  }

  /** Announced only when a time threshold is crossed, never every second. */
  private getTimerWarning(): string {
    if (!this.session) return '';
    if (this.session.timeRemainingMs <= 60000) return 'Sisa waktu 1 menit. Segera selesaikan ujian.';
    if (this.session.timeRemainingMs <= 300000) return 'Sisa waktu 5 menit.';
    return '';
  }

  private autoSubmit(): void {
    if (!this.session) return;
    this.stopTimer();
    this.finishExam();
  }

  private stopTimer(): void {
    if (this.session?.timerId) {
      clearInterval(this.session.timerId);
      this.session.timerId = null;
    }
  }

  private renderExam(): void {
    if (!this.element || !this.session) return;
    if (this.session.status === 'review') {
      this.element.innerHTML = this.getReviewHTML();
    } else {
      this.element.innerHTML = this.getExamHTML();
      this.updateTimerDisplay();
    }
    this.bindExamEvents();
  }

  private getConfigFromForm(): any {
    // Simplified - would read from form in real implementation
    return {
      durationMinutes: 90,
      questionCount: 60,
      topicWeights: {
        'UM-01': 1, 'UM-02': 1, 'UM-03': 1, 'UM-04': 1, 'UM-05': 1,
        'UM-06': 1, 'UM-07': 1, 'UM-08': 1, 'UM-09': 1,
        'KH-01': 1.5, 'KH-02': 1.5, 'KH-03': 1.5, 'KH-04': 1.5,
        'KH-05': 1.5, 'KH-06': 1.5, 'KH-07': 1.5, 'KH-08': 1.5,
        'KH-09': 1.5, 'KH-10': 1.5, 'KH-11': 1.5, 'KH-12': 1.5,
      },
      difficultyMix: { 1: 30, 2: 50, 3: 20 },
    };
  }

  private async enterFullscreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen();
    } catch {}
  }

  private exitFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }

  private bindConfigEvents(): void {
    if (!this.element) return;

    this.element.querySelector('#btnStartExam')?.addEventListener('click', () => {
      const config = this.getConfigFromForm();
      this.startExam(config);
    });

    this.element.querySelector('#btnCancelConfig')?.addEventListener('click', () => {
      navigate('dashboard');
    });
  }

  private bindExamEvents(): void {
    if (!this.element || !this.session) return;

    // Option selection
    this.element.querySelectorAll('.exam-option:not(.selected)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        this.selectOption(parseInt(target.dataset.option!));
      });
    });

    // Navigator
    this.element.querySelectorAll('.nav-cell').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.jumpToQuestion(parseInt((e.currentTarget as HTMLButtonElement).dataset.index!));
      });
    });

    // Flag/Mark Review/Submit
    this.element.querySelector('#btnFlagExam')?.addEventListener('click', () => this.toggleFlag());
    this.element.querySelector('#btnMarkReviewExam')?.addEventListener('click', () => this.toggleMarkReview());
    this.element.querySelector('#btnSubmitExam')?.addEventListener('click', () => this.confirmSubmit());

    // Keyboard
    document.addEventListener('keydown', this.handleKeys);
  }

  private handleKeys = (e: KeyboardEvent): void => {
    if (!this.session || this.session.status !== 'active') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key >= '1' && e.key <= '5') {
      this.selectOption(parseInt(e.key) - 1);
    } else if (e.key === 'ArrowLeft') {
      this.navigate(-1);
    } else if (e.key === 'ArrowRight') {
      this.navigate(1);
    } else if (e.key === 'f' || e.key === 'F') {
      this.toggleFlag();
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMarkReview();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      this.confirmSubmit();
    }
  };

  private selectOption(optionIndex: number): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    const timeMs = Date.now() - this.questionStartTime;
    const isCorrect = q.correctAnswer.includes(optionIndex);

    this.session.answers.set(q.id, {
      userAnswer: [optionIndex],
      isCorrect,
      timeMs,
      flagged: this.session.flags.has(q.id),
      markedReview: this.session.markedReview.has(q.id),
    });

    this.questionStartTime = Date.now();
    this.renderExam();
  }

  private navigate(direction: number): void {
    if (!this.session) return;
    const newIndex = this.session.currentIndex + direction;
    if (newIndex >= 0 && newIndex < this.session.questions.length) {
      this.session.currentIndex = newIndex;
      this.renderExam();
    }
  }

  private jumpToQuestion(index: number): void {
    if (!this.session) return;
    if (index >= 0 && index < this.session.questions.length) {
      this.session.currentIndex = index;
      this.renderExam();
    }
  }

  private toggleFlag(): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    if (this.session.flags.has(q.id)) this.session.flags.delete(q.id);
    else this.session.flags.add(q.id);
    this.renderExam();
  }

  private toggleMarkReview(): void {
    if (!this.session) return;
    const q = this.session.questions[this.session.currentIndex];
    if (this.session.markedReview.has(q.id)) this.session.markedReview.delete(q.id);
    else this.session.markedReview.add(q.id);
    this.renderExam();
  }

  private confirmSubmit(): void {
    if (!this.session) return;
    const unanswered = this.session.questions.filter(q => !this.session!.answers.has(q.id)).length;
    const flagged = this.session.flags.size;
    
    if (unanswered > 0 || flagged > 0) {
      if (!confirm(`${t('mock.confirmSubmit', { unanswered, flagged })}`)) return;
    }
    this.finishExam();
  }

  private finishExam(): void {
    if (!this.session) return;
    this.stopTimer();
    this.exitFullscreen();
    this.element?.removeAttribute('data-exam-active');
    this.session.status = 'review';
    this.saveSession();
    this.renderExam();
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
      mode: 'mock-exam' as const,
      startedAt: new Date(this.session!.startTime).toISOString(),
      completedAt: nowISO(),
      config: this.session!.config,
      topicCodes: this.session!.questions.map(q => q.topicCode),
      summary,
    };

    await import('../db/repositories/sessions').then(m => m.sessionsRepo.put(sessionRecord));

    // Record attempts
    const attempts: any[] = [];
    this.session.questions.forEach(q => {
      const ans = this.session!.answers.get(q.id);
      if (ans) {
        attempts.push({
          sessionId: this.session!.id,
          questionId: q.id,
          userAnswer: ans.userAnswer,
          isCorrect: ans.isCorrect,
          timeMs: ans.timeMs,
          timestamp: nowISO(),
          flagged: ans.flagged,
          markedForReview: ans.markedReview,
        });
      }
    });
    await import('../db/repositories/attempts').then(m => m.attemptsRepo.bulkAdd(attempts));

    // Update mastery
    for (const [qId, ans] of this.session.answers) {
      await import('../db/repositories/questions').then(m => m.questionsRepo.updateMastery(qId, ans.isCorrect));
    }
  }

  destroy(): void {
    this.stopTimer();
    this.exitFullscreen();
    this.element?.removeAttribute('data-exam-active');
    document.removeEventListener('keydown', this.handleKeys);
  }
}
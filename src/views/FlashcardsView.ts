// Flashcards View (SM-2 Spaced Repetition)
import { questionsRepo } from '../db/repositories/questions';
import { flashcardsRepo } from '../db/repositories/flashcards';
import { loadKisiKisi } from '../features/kisi-kisi/registry';
import { navigate, t } from '../core/i18n';
import { eventBus } from '../core/events';
import { generateId, nowISO, todayISO, addDays } from '../core/utils';
import type { Flashcard, SM2Params } from '../shared/types';

const SM2_DEFAULTS: SM2Params = {
  initialInterval: 1,
  secondInterval: 6,
  easyBonus: 1.3,
  hardPenalty: 1.2,
  minEaseFactor: 1.3,
  maxInterval: 36500,
};

function sm2(card: Flashcard, quality: 0 | 1 | 2 | 3 | 4 | 5, params: SM2Params): Partial<Flashcard> {
  let { easeFactor, interval, reps, lapses } = card;
  const q = quality;

  if (q >= 3) { // Good (3) or Easy (4,5)
    if (reps === 0) interval = params.initialInterval;
    else if (reps === 1) interval = params.secondInterval;
    else interval = Math.round(interval * easeFactor);

    if (q === 5) interval = Math.round(interval * params.easyBonus);
    reps++;
  } else { // Again (0,1) or Hard (2)
    reps = 0;
    interval = params.initialInterval;
    lapses++;
  }

  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < params.minEaseFactor) easeFactor = params.minEaseFactor;
  if (interval > params.maxInterval) interval = params.maxInterval;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + interval);

  return {
    interval,
    easeFactor,
    reps,
    lapses,
    dueDate: dueDate.toISOString().split('T')[0],
    lastReviewed: nowISO(),
    updatedAt: nowISO(),
  };
}

export class FlashcardsView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private currentCard: Flashcard | null = null;
  private showAnswer = false;
  private sessionCards: Flashcard[] = [];
  private currentIndex = 0;
  private stats = { due: 0, new: 0, learning: 0, review: 0, mature: 0 };
  private params_s: SM2Params = SM2_DEFAULTS;

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'flashcards-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadData().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
        this.loadNextCard();
      }
    });

    return this.element;
  }

  private async loadData(): Promise<void> {
    const settings = await import('../db/repositories/settings').then(m => m.settingsRepo.getAllWithDefaults());
    this.params_s = settings.flashcardParams || SM2_DEFAULTS;
    
    this.sessionCards = await flashcardsRepo.getDueCards(this.params_s.dailyLimit || 50);
    this.stats = await flashcardsRepo.getStats();
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('flash.title')}</h1>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('flash.title')}</h1>
        <p class="page-subtitle">${t('flash.shortcuts')}</p>
      </div>

      <!-- Stats Bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--space-3);margin-bottom:var(--space-4);">
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-4);">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-primary);">${this.stats.due}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.dueToday')}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-4);">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-info);">${this.stats.new}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.newCards')}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-4);">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-warning);">${this.stats.learning}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.learning')}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-content" style="text-align:center;padding:var(--space-4);">
            <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:var(--color-success);">${this.stats.review + this.stats.mature}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.review')} / ${t('flash.mature')}</div>
          </div>
        </div>
      </div>

      <!-- Card Container -->
      <div id="cardContainer">
        ${this.getEmptyStateHTML()}
      </div>

      <!-- Controls -->
      <div id="cardControls" style="display:none;margin-top:var(--space-6);">
        <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-danger btn-lg" id="btnAgain" data-quality="0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-5"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
            <span>${t('flash.rateAgain')}</span>
            <kbd>1</kbd>
          </button>
          <button class="btn btn-warning btn-lg" id="btnHard" data-quality="1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${t('flash.rateHard')}</span>
            <kbd>2</kbd>
          </button>
          <button class="btn btn-primary btn-lg" id="btnGood" data-quality="2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>${t('flash.rateGood')}</span>
            <kbd>3</kbd>
          </button>
          <button class="btn btn-success btn-lg" id="btnEasy" data-quality="3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-7-7 7-7-7-7 7"/><path d="M2 19l7-7 7 7"/></svg>
            <span>${t('flash.rateEasy')}</span>
            <kbd>4</kbd>
          </button>
        </div>
        <div style="text-align:center;margin-top:var(--space-3);color:var(--color-text-muted);font-size:var(--text-xs);">
          ${t('flash.shortcuts')}
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-6);flex-wrap:wrap;">
        <a href="#/flashcards?new=true" class="btn btn-secondary">${t('flash.createFromQuestion')}</a>
        <a href="#/settings" class="btn btn-secondary">${t('settings.flashcardParams')}</a>
        <button class="btn btn-secondary" id="btnCreateManual">${t('flash.createManual')}</button>
      </div>
    `;
  }

  private getEmptyStateHTML(): string {
    if (this.sessionCards.length === 0) {
      return `
        <div class="card" style="max-width:600px;margin:0 auto;">
          <div class="card-content" style="text-align:center;padding:var(--space-12);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64" style="margin-bottom:var(--space-4);opacity:0.5;">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M6 8h12M6 12h12M6 16h8"/>
            </svg>
            <h2 style="font-size:var(--text-xl);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">${t('flash.dueToday')}: 0</h2>
            <p style="color:var(--color-text-muted);margin-bottom:var(--space-6);">Tidak ada kartu yang jatuh tempo hari ini. Semua tertib!</p>
            <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
              <button class="btn btn-primary" id="btnCreateFromQuestions">${t('flash.createFromQuestion')}</button>
              <button class="btn btn-secondary" id="btnCreateManualEmpty">${t('flash.createManual')}</button>
              <a href="#/settings" class="btn btn-secondary">${t('settings.flashcardParams')}</a>
            </div>
          </div>
        </div>
      `;
    }
    return this.getCardHTML();
  }

  private getCardHTML(): string {
    if (!this.currentCard) return '';
    const card = this.currentCard;
    const progress = this.sessionCards.length > 0 ? ((this.currentIndex + 1) / this.sessionCards.length) * 100 : 0;

    return `
      <div class="card" style="max-width:700px;margin:0 auto;">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <span style="font-size:var(--text-sm);color:var(--color-text-muted);">${this.currentIndex + 1} / ${this.sessionCards.length}</span>
            <div style="width:100px;height:4px;background:var(--color-border);border-radius:var(--radius-full);overflow:hidden;">
              <div style="width:${((this.currentIndex + 1) / this.sessionCards.length) * 100}%;height:100%;background:var(--color-primary);transition:width var(--transition-fast);"></div>
            </div>
          </div>
          <span class="badge badge-${card.type}">${card.type.toUpperCase()}</span>
        </div>
        <div class="card-content" style="min-height:200px;display:flex;flex-direction:column;justify-content:center;">
          <div id="cardInner" role="button" tabindex="0" aria-label="${t('flash.showAnswer')}" style="width:100%;aspect-ratio:4/3;perspective:1000px;cursor:pointer;" onclick="this.querySelector('#flashcardView')?.classList.toggle('flipped')">
            <div id="flashcardView" class="flashcard-3d" style="width:100%;height:100%;position:relative;transform-style:preserve-3d;transition:transform 0.6s;${this.showAnswer ? 'transform:rotateY(180deg);' : ''}">
              <!-- Front -->
              <div class="flashcard-face flashcard-front" style="position:absolute;width:100%;height:100%;backface-visibility:hidden;display:flex;align-items:center;justify-content:center;padding:var(--space-8);background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:var(--radius-lg);">
                <div style="max-width:100%;text-align:center;font-size:var(--text-xl);line-height:var(--leading-relaxed);font-weight:var(--font-medium);">${card.front}</div>
                <div style="position:absolute;bottom:var(--space-4);left:50%;transform:translateX(-50%);font-size:var(--text-xs);color:var(--color-text-muted);">${t('flash.showAnswer')}</div>
              </div>
              <!-- Back -->
              <div class="flashcard-face flashcard-back" style="position:absolute;width:100%;height:100%;backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-8);background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:var(--radius-lg);transform:rotateY(180deg);">
                <div style="max-width:100%;text-align:center;font-size:var(--text-lg);line-height:var(--leading-relaxed);">${card.back}</div>
                <div style="margin-top:var(--space-4);font-size:var(--text-xs);color:var(--color-text-muted);">${card.type === 'qa' ? 'Q&A' : card.type === 'cloze' ? 'Cloze' : 'Konsep'}${card.questionId ? ' • Terkait soal' : ''}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    // Card click / keyboard activation to flip
    const flipCard = () => {
      this.showAnswer = !this.showAnswer;
      this.refreshCard();
    };
    this.element.querySelector('#cardInner')?.addEventListener('click', flipCard);
    this.element.querySelector<HTMLElement>('#cardInner')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flipCard();
      }
    });

    // Rating buttons
    this.element.querySelectorAll('[data-quality]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const quality = parseInt((e.currentTarget as HTMLButtonElement).dataset.quality!);
        this.rateCard(quality);
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeys);

    // Create buttons
    this.element.querySelector('#btnCreateFromQuestions')?.addEventListener('click', () => this.createFromQuestions());
    this.element.querySelector('#btnCreateManualEmpty')?.addEventListener('click', () => this.createManual());
    this.element.querySelector('#btnCreateManualEmpty')?.addEventListener('click', () => this.createManual());
  }

  private refreshCard(): void {
    const container = this.element?.querySelector('#cardContainer');
    if (container) container.innerHTML = this.getEmptyStateHTML();
    
    const controls = this.element?.querySelector('#cardControls');
    if (controls) {
      (controls as HTMLElement).style.display = this.currentCard ? 'block' : 'none';
    }
  }

  private loadNextCard(): void {
    if (this.currentIndex >= this.sessionCards.length) {
      this.currentCard = null;
      this.showAnswer = false;
    } else {
      this.currentCard = this.sessionCards[this.currentIndex];
      this.showAnswer = false;
    }
    this.refreshCard();
  }

  private async rateCard(quality: 0 | 1 | 2 | 3): Promise<void> {
    if (!this.currentCard) return;

    const updated = sm2(this.currentCard, quality as any, this.params_s);
    Object.assign(this.currentCard, updated);
    await flashcardsRepo.put(this.currentCard);

    this.currentIndex++;
    this.loadNextCard();
    this.refreshCard();
  }

  private handleKeys = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // The card handles its own Enter/Space activation when focused.
    if (e.target instanceof HTMLElement && e.target.id === 'cardInner') return;
    if (!this.currentCard) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.showAnswer = !this.showAnswer;
      this.refreshCard();
    } else if (e.key >= '1' && e.key <= '4') {
      this.rateCard(parseInt(e.key) - 1);
    }
  };

  private async createFromQuestions(): Promise<void> {
    // Get flagged questions
    const questions = await import('../db/repositories/questions').then(m => m.questionsRepo.getAll());
    const flagged = questions.filter(q => q.flags.needsReview || q.flags.bookmarked);
    
    if (flagged.length === 0) {
      alert('Tidak ada soal yang diflag untuk dijadikan flashcard.');
      return;
    }

    let created = 0;
    for (const q of flagged) {
      const existing = await flashcardsRepo.getByQuestion(q.id);
      if (existing.length === 0) {
        const card: Flashcard = {
          id: generateId(),
          questionId: q.id,
          front: q.stem,
          back: `${q.options[q.correctAnswer[0]]?.text || ''}\n\n${q.explanation || ''}`,
          type: 'qa',
          dueDate: todayISO(),
          interval: 0,
          easeFactor: this.params_s.minEaseFactor || 2.5,
          reps: 0,
          lapses: 0,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        await flashcardsRepo.add(card);
        created++;
      }
    }

    if (created > 0) {
      alert(`Berhasil membuat ${created} flashcard dari soal yang diflag.`);
      await this.loadData();
      this.refreshCard();
    } else {
      alert('Semua soal diflag sudah memiliki flashcard.');
    }
  }

  private async createManual(): Promise<void> {
    const front = prompt('Masukkan pertanyaan (Front):');
    if (!front) return;
    const back = prompt('Masukkan jawaban (Back):');
    if (!back) return;

    const card: Flashcard = {
      id: generateId(),
      front,
      back,
      type: 'qa',
      dueDate: todayISO(),
      interval: 0,
      easeFactor: this.params_s.minEaseFactor || 2.5,
      reps: 0,
      lapses: 0,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await flashcardsRepo.add(card);
    await this.loadData();
    this.refreshCard();
  }
}
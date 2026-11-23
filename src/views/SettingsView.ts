// Settings View
import { settingsRepo } from '../db/repositories/settings';
import { backupRepo } from '../db/repositories/backup';
import { loadKisiKisi, getAllTopicCodes } from '../features/kisi-kisi/registry';
import { navigate, t, setLocale, getLocale } from '../core/i18n';
import { eventBus } from '../core/events';
import { APP_CONFIG } from '../core/config';
import { downloadJSON } from '../core/utils';
import { requestPersistentStorage, checkStorageBudget } from '../core/pwa';

export class SettingsView {
  private params: Record<string, string>;
  private element: HTMLElement | null = null;
  private settings: Record<string, any> = {};

  constructor(params: Record<string, string>) {
    this.params = params;
  }

  async loadSettings(): Promise<void> {
    this.settings = await settingsRepo.getAllWithDefaults();
  }

  render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'settings-view';
    this.element.innerHTML = this.getSkeletonHTML();
    
    this.loadSettings().then(() => {
      if (this.element) {
        this.element.innerHTML = this.getHTML();
        this.bindEvents();
      }
    });

    return this.element;
  }

  /** Refresh usage/quota readout and re-run the 80% budget check. */
  private async refreshStorageInfo(): Promise<void> {
    const budget = await checkStorageBudget();
    const el = this.element?.querySelector('#storageUsage');
    if (!el || !budget) return;
    const usageMB = (budget.usage / (1024 * 1024)).toFixed(1);
    const quotaMB = (budget.quota / (1024 * 1024)).toFixed(1);
    el.textContent = `Digunakan ${usageMB} MB dari ${quotaMB} MB (${Math.round(budget.ratio * 100)}%)`;
  }

  private getSkeletonHTML(): string {
    return `
      <div class="page-header">
        <h1 class="page-title">${t('settings.title')}</h1>
        <p class="page-subtitle">${t('settings.subtitle') || 'Kelola pengaturan aplikasi'}</p>
      </div>
      <div class="card skeleton" style="min-height:400px;"></div>
    `;
  }

  private getHTML(): string {
    const locale = getLocale();
    const theme = this.settings.theme || 'system';
    const language = this.settings.language || 'id';
    const mockDefaults = this.settings.mockExamDefaults || {};
    const flashcardParams = this.settings.flashcardParams || {};
    const topicWeights = this.settings.topicWeights || {};

    return `
      <div class="page-header">
        <h1 class="page-title">${t('settings.title')}</h1>
        <p class="page-subtitle">Kelola preferensi aplikasi, default ujian, parameter flashcard, dan data</p>
      </div>

      <div class="tabs" role="tablist">
        <button class="tab active" data-tab="general" role="tab">${t('settings.general')}</button>
        <button class="tab" data-tab="mockExam" role="tab">${t('settings.mockExam')}</button>
        <button class="tab" data-tab="flashcards" role="tab">${t('settings.flashcards')}</button>
        <button class="tab" data-tab="data" role="tab">${t('settings.data')}</button>
        <button class="tab" data-tab="accessibility" role="tab">${t('settings.accessibility')}</button>
        <button class="tab" data-tab="about" role="tab">${t('settings.about')}</button>
      </div>

      <!-- General Tab -->
      <div class="tab-panel" data-tab-panel="general" style="display:block;">
        <div class="card">
          <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);max-width:600px;">
            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">${t('settings.theme')}</legend>
              <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
                ${['light', 'dark', 'system'].map(t => `
                  <button type="button" class="btn ${theme === t ? 'btn-primary' : 'btn-secondary'}" data-theme="${t}" style="flex:1;min-width:100px;">
                    ${t === 'light' ? '☀️' : t === 'dark' ? '🌙' : '💻'} ${t('settings.theme.' + t)}
                  </button>
                `).join('')}
              </div>
            </fieldset>

            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">${t('settings.language')}</legend>
              <div class="btn-group" role="radiogroup" style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
                ${['id', 'en'].map(l => `
                  <button type="button" class="btn ${language === l ? 'btn-primary' : 'btn-secondary'}" data-language="${l}" style="flex:1;min-width:100px;">
                    ${l === 'id' ? '🇮🇩' : '🇺🇸'} ${t('settings.language.' + l)}
                  </button>
                `).join('')}
              </div>
            </fieldset>

            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">${t('settings.topicWeights')}</legend>
              <p class="form-help" style="margin-bottom:var(--space-4);">Bobot topik untuk pemilihan soal ujian mock (Kemampuan Khusus default 1.5x)</p>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3);">
                ${getAllTopicCodes().map(code => {
                  const topic = loadKisiKisi().then(({topics}) => topics.find(t => t.code === code));
                  return `
                    <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);background:var(--color-bg);border-radius:var(--radius-md);">
                      <span style="font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--color-text-muted);min-width:60px;">${code}</span>
                      <input type="number" step="0.1" min="0.1" max="5" value="${topicWeights[code] || 1}" data-weight="${code}" class="form-input" style="width:80px;font-size:var(--text-sm);padding:var(--space-1) var(--space-2);">
                    </div>
                  `;
                }).join('')}
              </div>
            </fieldset>

            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Notifikasi</legend>
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="notificationsEnabled" ${this.settings.notificationsEnabled ? 'checked' : ''}>
                <span class="form-check-label">${t('settings.notifications')}</span>
              </label>
            </fieldset>
          </div>
        </div>

      <!-- Mock Exam Tab -->
      <div class="tab-panel" data-tab-panel="mockExam" style="display:none;">
        <div class="card">
          <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);max-width:600px;">
            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Default Ujian CAT</legend>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);">
                <div class="form-group">
                  <label class="form-label" for="mockDuration">${t('settings.mockDefaults')}: ${t('mock.duration')} (menit)</label>
                  <input type="number" id="mockDuration" class="form-input" value="${mockDefaults.durationMinutes || 90}" min="30" max="180" step="15">
                </div>
                <div class="form-group">
                  <label class="form-label" for="mockQuestionCount">${t('settings.mockDefaults')}: ${t('mock.questionCount')}</label>
                  <input type="number" id="mockQuestionCount" class="form-input" value="${mockDefaults.questionCount || 60}" min="10" max="200" step="10">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">${t('settings.mockDefaults')}: ${t('mock.difficultyMix')}</label>
                <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;">
                  ${[1, 2, 3].map(d => `
                    <div style="display:flex;align-items:center;gap:var(--space-2);">
                      <span style="min-width:60px;font-size:var(--text-sm);">${t('difficulty.' + d)}</span>
                      <input type="number" step="5" min="0" max="100" value="${mockDefaults.difficultyMix?.[d] || (d===2?50:d===1?30:20)}" data-difficulty="${d}" class="form-input" style="width:80px;">
                      <span>%</span>
                    </div>
                  `).join('')}
                </div>
                <p class="form-help">Total harus 100%</p>
              </div>
            </fieldset>
          </div>
        </div>

      <!-- Flashcards Tab -->
      <div class="tab-panel" data-tab-panel="flashcards" style="display:none;">
        <div class="card">
          <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);max-width:600px;">
            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">${t('settings.flashcardParams')}</legend>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);">
                <div class="form-group">
                  <label class="form-label" for="fcInitial">${t('settings.initialInterval')} (hari)</label>
                  <input type="number" id="fcInitial" class="form-input" value="${flashcardParams.initialInterval || 1}" min="1" max="30">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcSecond">${t('settings.secondInterval')} (hari)</label>
                  <input type="number" id="fcSecond" class="form-input" value="${flashcardParams.secondInterval || 6}" min="1" max="90">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcEasy">${t('settings.easyBonus')}</label>
                  <input type="number" id="fcEasy" class="form-input" value="${flashcardParams.easyBonus || 1.3}" step="0.1" min="1" max="2">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcHard">${t('settings.hardPenalty')}</label>
                  <input type="number" id="fcHard" class="form-input" value="${flashcardParams.hardPenalty || 1.2}" step="0.1" min="1" max="2">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcMinEase">${t('settings.minEaseFactor')}</label>
                  <input type="number" id="fcMinEase" class="form-input" value="${flashcardParams.minEaseFactor || 1.3}" step="0.1" min="1.1" max="2">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcMaxInterval">${t('settings.maxInterval')} (hari)</label>
                  <input type="number" id="fcMaxInterval" class="form-input" value="${flashcardParams.maxInterval || 36500}" min="365" max="36500">
                </div>
                <div class="form-group">
                  <label class="form-label" for="fcDailyLimit">${t('settings.dailyLimit')}</label>
                  <input type="number" id="fcDailyLimit" class="form-input" value="${flashcardParams.dailyLimit || 50}" min="10" max="500">
                </div>
              </div>
            </fieldset>
          </div>
        </div>

      <!-- Data Tab -->
      <div class="tab-panel" data-tab-panel="data" style="display:none;">
        <div class="card">
          <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);max-width:600px;">
            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Backup & Restore</legend>
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
                <button class="btn btn-primary" id="btnExportAll">${t('settings.exportData')}</button>
                <button class="btn btn-secondary" id="btnImportData">${t('settings.importData')}</button>
                <button class="btn btn-secondary" id="btnExportCSV">${t('common.export')} CSV</button>
              </div>
              <p class="form-help">Ekspor menyimpan semua soal, progress, flashcard, dan pengaturan ke file JSON. CSV hanya untuk soal.</p>
            </fieldset>

            <fieldset class="storage-fieldset">
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Penyimpanan / Storage</legend>
              <p class="storage-stat" id="storageUsage">Mengukur penggunaan penyimpanan...</p>
              <p class="storage-stat">Persistent: <strong id="storagePersistedValue">${this.settings.storagePersisted ? 'yes' : 'no'}</strong></p>
              <button type="button" class="btn btn-secondary" id="btnRequestPersist">Request persistent storage</button>
              <p class="form-help">Izin persistents hanya diminta sekali saat aplikasi pertama terpasang. Tombol ini mengulang permintaan jika browser menolak.</p>
            </fieldset>

            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Auto Backup</legend>
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="autoBackupEnabled" ${this.settings.autoBackupEnabled ? 'checked' : ''}>
                <span class="form-check-label">${t('settings.autoBackup')}</span>
              </label>
              <div class="form-group" style="margin-top:var(--space-4);">
                <label class="form-label" for="backupInterval">${t('settings.backupInterval')} (hari)</label>
                <input type="number" id="backupInterval" class="form-input" value="${this.settings.autoBackupIntervalDays || 7}" min="1" max="30">
              </div>
            </fieldset>

            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Reset Data</legend>
              <p class="form-help" style="color:var(--color-danger);">Tindakan ini akan menghapus SEMUA data (soal, progress, flashcard, pengaturan). Tidak bisa dibatalkan.</p>
              <button class="btn btn-danger" id="btnResetData">${t('settings.resetData')}</button>
            </fieldset>
          </div>
        </div>

      <!-- Accessibility Tab -->
      <div class="tab-panel" data-tab-panel="accessibility" style="display:none;">
        <div class="card">
          <div class="card-content" style="display:flex;flex-direction:column;gap:var(--space-6);max-width:600px;">
            <fieldset>
              <legend class="form-label" style="font-size:var(--text-lg);font-weight:var(--font-semibold);margin-bottom:var(--space-4);">Tampilan</legend>
              <div class="form-group">
                <label class="form-label" for="fontScale">${t('settings.fontScale')}: <span id="fontScaleValue">${this.settings.fontScale || 1.0}x</span></label>
                <input type="range" id="fontScale" class="form-input" min="0.8" max="1.5" step="0.1" value="${this.settings.fontScale || 1.0}">
              </div>
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="reducedMotion" ${this.settings.reducedMotion ? 'checked' : ''}>
                <span class="form-check-label">${t('settings.reducedMotion')}</span>
              </label>
              <label class="form-check">
                <input type="checkbox" class="form-check-input" id="highContrast" ${this.settings.highContrast ? 'checked' : ''}>
                <span class="form-check-label">${t('settings.highContrast')}</span>
              </label>
            </fieldset>
          </div>
        </div>

      <!-- About Tab -->
      <div class="tab-panel" data-tab-panel="about" style="display:none;">
        <div class="card">
          <div class="card-content" style="max-width:600px;">
            <div style="text-align:center;padding:var(--space-8);">
              <div style="width:80px;height:80px;border-radius:var(--radius-xl);background:var(--color-primary);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);color:white;font-size:2rem;">☁</div>
              <h2 style="font-size:var(--text-2xl);font-weight:var(--font-bold);margin-bottom:var(--space-2);">${APP_CONFIG.name}</h2>
              <p style="color:var(--color-text-muted);margin-bottom:var(--space-6);">Versi ${APP_CONFIG.version}</p>
              <p style="max-width:400px;margin:0 auto var(--space-6);color:var(--color-text-muted);">Aplikasi offline untuk persiapan SKB CAT CPNS BMKG formasi Pengamat Meteorologi dan Geofisika Ahli Pertama.</p>
              <div style="display:flex;justify-content:center;gap:var(--space-4);flex-wrap:wrap;">
                <a href="https://bmkg.go.id" target="_blank" class="btn btn-secondary">Website BMKG</a>
                <a href="https://sscasn.bkn.go.id" target="_blank" class="btn btn-secondary">SSCASN BKN</a>
              </div>
            </div>
            <hr style="margin:var(--space-6) 0;border-color:var(--color-border);">
            <div style="font-size:var(--text-sm);color:var(--color-text-muted);">
              <p><strong>Kisi-Kisi:</b> BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I</p>
              <p><strong>21 Topik:</b> 9 Kemampuan Umum + 12 Kemampuan Khusus</p>
              <p><strong>Teknologi:</b> Vanilla TypeScript, Vite, Dexie.js, Workbox, Chart.js</p>
              <p><strong>Lisensi:</b> MIT</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.element) return;

    // Tab switching
    this.element.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.element?.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        this.element?.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        const panel = this.element?.querySelector(`.tab-panel[data-tab-panel="${tabName}"]`);
        if (panel) panel.style.display = 'block';
      });
    });

    // Theme buttons
    this.element.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.theme!);
      });
    });

    // Language buttons
    this.element.querySelectorAll('[data-language]').forEach(btn => {
      btn.addEventListener('click', () => {
        setLocale(btn.dataset.language!);
        window.location.reload();
      });
    });

    // Topic weight inputs
    this.element.querySelectorAll('[data-weight]').forEach(input => {
      (input as HTMLInputElement).addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        updateTopicWeight(target.dataset.weight!, parseFloat(target.value));
      });
    });

    // Mock exam inputs
    this.element.querySelector('#mockDuration')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      updateMockSetting('durationMinutes', parseInt(target.value));
    });
    this.element.querySelector('#mockQuestionCount')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      updateMockSetting('questionCount', parseInt(target.value));
    });
    this.element.querySelectorAll('[data-difficulty]').forEach(input => {
      (input as HTMLInputElement).addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        updateMockDifficulty(target.dataset.difficulty!, parseInt(target.value));
      });
    });

    // Flashcard inputs
    const fcInputs = ['fcInitial', 'fcSecond', 'fcEasy', 'fcHard', 'fcMinEase', 'fcMaxInterval', 'fcDailyLimit'];
    fcInputs.forEach(id => {
      this.element.querySelector(`#${id}`)?.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        updateFlashcardSetting(id.replace('fc', '').toLowerCase(), parseFloat(target.value));
      });
    });

    // Data buttons
    this.element.querySelector('#btnExportAll')?.addEventListener('click', async () => {
      await backupRepo.downloadBackup();
    });
    this.element.querySelector('#btnExportCSV')?.addEventListener('click', async () => {
      await backupRepo.downloadQuestionsCSV();
    });
    this.element.querySelector('#btnImportData')?.addEventListener('click', () => {
      navigate('import');
    });
    this.element.querySelector('#btnRequestPersist')?.addEventListener('click', () => {
      void requestPersistentStorage().then((granted) => {
        const el = this.element?.querySelector('#storagePersistedValue');
        if (el) el.textContent = granted ? 'yes' : 'no';
        void this.refreshStorageInfo();
      });
    });
    void this.refreshStorageInfo();
    this.element.querySelector('#btnResetData')?.addEventListener('click', async () => {
      if (confirm(t('settings.resetConfirm'))) {
        await settingsRepo.resetToDefaults();
        window.location.reload();
      }
    });

    // Auto backup
    this.element.querySelector('#autoBackupEnabled')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('autoBackupEnabled', target.checked);
    });
    this.element.querySelector('#backupInterval')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('autoBackupIntervalDays', parseInt(target.value));
    });

    // Accessibility
    this.element.querySelector('#fontScale')?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseFloat(target.value);
      document.documentElement.style.fontSize = `${16 * value}px`;
      document.documentElement.setAttribute('data-font-scale', value.toString());
      this.element!.querySelector('#fontScaleValue')!.textContent = `${value}x`;
    });
    this.element.querySelector('#fontScale')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('fontScale', parseFloat(target.value));
    });
    this.element.querySelector('#reducedMotion')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('reducedMotion', target.checked);
      document.documentElement.setAttribute('data-reduced-motion', target.checked.toString());
    });
    this.element.querySelector('#highContrast')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('highContrast', target.checked);
      document.documentElement.setAttribute('data-high-contrast', target.checked.toString());
    });

    // Notifications
    this.element.querySelector('#notificationsEnabled')?.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      settingsRepo.set('notificationsEnabled', target.checked);
    });
  }
}

// Helper functions
async function setTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
  await settingsRepo.set('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  window.location.reload();
}

async function updateTopicWeight(code: string, weight: number): Promise<void> {
  const weights = await settingsRepo.get('topicWeights') || {};
  weights[code] = weight;
  await settingsRepo.set('topicWeights', weights);
}

async function updateMockSetting(key: string, value: number): Promise<void> {
  const defaults = await settingsRepo.get('mockExamDefaults') || {};
  defaults[key] = value;
  await settingsRepo.set('mockExamDefaults', defaults);
}

async function updateMockDifficulty(difficulty: string, value: number): Promise<void> {
  const defaults = await settingsRepo.get('mockExamDefaults') || {};
  if (!defaults.difficultyMix) defaults.difficultyMix = { 1: 30, 2: 50, 3: 20 };
  defaults.difficultyMix[parseInt(difficulty) as any] = value;
  // Normalize to 100%
  const total = Object.values(defaults.difficultyMix).reduce((a, b) => a + b, 0);
  if (total > 0) {
    Object.keys(defaults.difficultyMix).forEach(k => {
      defaults.difficultyMix[parseInt(k) as any] = Math.round(defaults.difficultyMix[parseInt(k) as any] * 100 / total);
    });
  }
  await settingsRepo.set('mockExamDefaults', defaults);
}

async function updateFlashcardSetting(key: string, value: number): Promise<void> {
  const params = await settingsRepo.get('flashcardParams') || {};
  const mappedKey = key === 'initial' ? 'initialInterval' :
                    key === 'second' ? 'secondInterval' :
                    key === 'easy' ? 'easyBonus' :
                    key === 'hard' ? 'hardPenalty' :
                    key === 'minease' ? 'minEaseFactor' :
                    key === 'maxinterval' ? 'maxInterval' :
                    key === 'dailylimit' ? 'dailyLimit' : key;
  params[mappedKey] = value;
  await settingsRepo.set('flashcardParams', params);
}
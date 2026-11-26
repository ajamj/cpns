// Main Application Entry Point
import { initRouter, navigate, onRouteChange, getCurrentRoute } from './core/router';
import { initLocale, setLocale, getLocale, t } from './core/i18n';
import { applyAccessibilitySettings } from './core/a11y';
import { settingsRepo } from './db/repositories/settings';
import { backupRepo } from './db/repositories/backup';
import { db } from './db/schema';
import { loadKisiKisi } from './features/kisi-kisi/registry';
import { eventBus } from './core/events';
import { APP_CONFIG } from './core/config';
import { setShowToast } from './core/app-utils';
import type { Question } from './shared/types';
import { initModalFocusManagement, restoreFocus } from './core/modal';
import {
  initPwaLifecycle,
  checkStorageBudget,
  requestPersistentStorage,
  getServiceWorkerRegistration,
} from './core/pwa';
import './shared/styles/main.css';

// Import views
import { DashboardView } from './views/DashboardView';
import { QuestionBankView } from './views/QuestionBankView';
import { PracticeView } from './views/PracticeView';
import { MockExamView } from './views/MockExamView';
import { FlashcardsView } from './views/FlashcardsView';

// Views outside the first paint are loaded on demand. Each import() becomes a
// separate hashed chunk that the service worker precaches at install time, so
// lazy loading does not compromise offline navigation.
type ViewParams = Record<string, string>;
const lazyViews: Partial<Record<string, (params: ViewParams) => Promise<HTMLElement>>> = {
  analytics: async (params) => new (await import('./views/AnalyticsView')).AnalyticsView(params).render(),
  settings: async (params) => new (await import('./views/SettingsView')).SettingsView(params).render(),
  import: async (params) => new (await import('./views/ImportView')).ImportView(params).render(),
  export: async (params) => new (await import('./views/ExportView')).ExportView(params).render(),
  trash: async (params) => new (await import('./views/TrashView')).TrashView(params).render(),
};

// Type for PWA install prompt
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Global state
let currentView: HTMLElement | null = null;
let installPromptEvent: BeforeInstallPromptEvent | null = null;

/** Ask the worker to import the seed questions; false means use the fallback. */
function seedFromWorker(): Promise<boolean> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // Vite bundles this as a separate hashed chunk that the SW precaches.
      worker = new Worker(new URL('./workers/seed-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (success: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(success);
    };
    const timer = setTimeout(() => finish(false), 8000);
    worker.onmessage = (event: MessageEvent<{ type: string }>) => finish(event.data.type === 'done');
    worker.onerror = () => finish(false);
    worker.postMessage({ type: 'seed' });
  });
}

// Auto-import seed questions on first run
async function importSeedQuestionsIfEmpty(): Promise<void> {
  try {
    const { questionsRepo } = await import('@db/repositories/questions');
    const count = await questionsRepo.getTotalCount();
    if (count === 0) {
      console.log('Database empty, importing seed questions...');
      if (await seedFromWorker()) {
        console.log('Seed questions imported in background worker');
        return;
      }

      // Fallback for runtimes without module workers: the database is empty,
      // so bulkAdd is equivalent to a restore of the (empty) other seed tables.
      const response = await fetch('/seed-questions.json');
      const data = await response.json();
      if (data.data?.questions?.length) {
        await db.questions.bulkAdd(data.data.questions as Question[]);
        console.log(`Imported ${data.data.questions.length} seed questions`);
      }
    }
  } catch (error) {
    console.error('Failed to import seed questions:', error);
  }
}

/**
 * Trash retention: permanently remove soft-deleted questions older than 30
 * days on every app load, before any view (including TrashView) reads them.
 */
async function purgeExpiredTrash(): Promise<void> {
  try {
    const { questionsRepo, TRASH_RETENTION_DAYS } = await import('@db/repositories/questions');
    const purged = await questionsRepo.purgeOlderThan(TRASH_RETENTION_DAYS);
    if (purged > 0) {
      console.log(`Auto-purged ${purged} trashed questions older than 30 days`);
      showToast(t('qb.autoPurgeDone', { count: purged }), 'info');
    }
  } catch (error) {
    console.error('Failed to auto-purge trash:', error);
  }
}

// Initialize app
async function initApp(): Promise<void> {
  // Initialize locale
  initLocale();

  // Register the real toast implementation before any startup work can emit
  // one (notably the app-load trash purge below).
  setShowToast(showToast);

  // Project the persisted WCAG preferences (font scale, reduced motion,
  // high contrast) onto <html> before the first view is rendered.
  applyAccessibilitySettings();
  eventBus.on('settings:changed', ({ key }) => {
    if (key === 'fontScale' || key === 'reducedMotion' || key === 'highContrast') {
      applyAccessibilitySettings();
    }
  });
  
  // Initialize database
  try {
    await db.open();
    console.log('Database opened successfully');
  } catch (error) {
    console.error('Failed to open database:', error);
    showToast(t('error.dbNotReady'), 'error');
    return;
  }
  
  // Initialize settings mirror
  await settingsRepo.initLocalStorageMirror();
  
  // Load kisi-kisi
  await loadKisiKisi();
  
  // Auto-import seed questions on first run
  await importSeedQuestionsIfEmpty();

  // Enforce the 30-day trash retention window on every load.
  await purgeExpiredTrash();
  
  // Initialize router
  initRouter();
  
  // Register the service worker and install update / storage policies.
  await initPwaLifecycle();
  
  // Handle PWA install prompt
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    installPromptEvent = e as BeforeInstallPromptEvent;
    showInstallButton();
  });
  
  window.addEventListener('appinstalled', () => {
    installPromptEvent = null;
    hideInstallButton();
    showToast(t('pwa.install'), 'success');
  });
  
  // Online/offline detection
  window.addEventListener('online', () => {
    eventBus.emit('offline:status', false);
    showToast(t('pwa.online'), 'success');
  });
  
  window.addEventListener('offline', () => {
    eventBus.emit('offline:status', true);
    showToast(t('pwa.offline'), 'warning');
  });
  
  // Auto backup check
  setInterval(async () => {
    if (await backupRepo.shouldAutoBackup()) {
      await backupRepo.createBackup();
      void checkStorageBudget();
      showToast('Backup otomatis dibuat', 'info');
    }
  }, 60 * 60 * 1000); // Check every hour
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeys);
  
  // Watch view-created dialogs for focus trapping.
  initModalFocusManagement();

  // Start route listener (onRouteChange also renders the initial route).
  onRouteChange(renderRoute);
  
  console.log(`${APP_CONFIG.name} v${APP_CONFIG.version} initialized`);
}

// Incremented on every route render so a late-arriving lazy chunk cannot
// replace a view the user has already navigated away from.
let renderToken = 0;

/** Lightweight, accessible placeholder shown while a lazy view chunk loads. */
function createLoadingPlaceholder(): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'view-loading';
  placeholder.setAttribute('role', 'status');
  placeholder.setAttribute('aria-live', 'polite');
  placeholder.innerHTML = `
    <div class="page-header"><h1 class="page-title">${t('common.loading')}</h1></div>
    <div class="card skeleton" style="min-height:320px;"></div>
  `;
  return placeholder;
}

// Render route
function renderRoute(route: ReturnType<typeof getCurrentRoute>): void {
  // Re-read preferences before every render: a backup restore or a settings
  // change may have replaced them since the previous view was mounted.
  applyAccessibilitySettings();

  // The router outlet is the <main> landmark so skip links and screen readers
  // land directly on the view content.
  const app = document.getElementById('main-content') ?? document.getElementById('app');
  if (!app) return;
  // The static boot shell is only there to paint before this bundle runs.
  document.getElementById('boot-splash')?.remove();
  const token = ++renderToken;
  
  // Clean up previous view
  if (currentView) {
    currentView.remove();
    currentView = null;
  }
  
  const params = route.params as Record<string, string>;
  const loadView = lazyViews[route.view];
  if (loadView) {
    const placeholder = createLoadingPlaceholder();
    currentView = placeholder;
    app.appendChild(placeholder);
    updateActiveNav(route.view);
    window.scrollTo(0, 0);
    void loadView(params)
      .then((viewElement) => {
        if (token !== renderToken || !placeholder.isConnected) return;
        placeholder.replaceWith(viewElement);
        currentView = viewElement;
      })
      .catch((error: unknown) => {
        console.error(`Failed to load ${route.view} view:`, error);
        if (token !== renderToken || !placeholder.isConnected) return;
        placeholder.innerHTML = `
          <div class="page-header"><h1 class="page-title">${route.view}</h1></div>
          <div class="card"><div class="card-content">Gagal memuat halaman. Silakan muat ulang.</div></div>
        `;
      });
    return;
  }
  
  // First-paint views stay synchronous.
  let viewElement: HTMLElement;
  switch (route.view) {
    case 'dashboard':
      viewElement = new DashboardView(params).render();
      break;
    case 'question-bank':
      viewElement = new QuestionBankView(params).render();
      break;
    case 'practice':
      viewElement = new PracticeView(params).render();
      break;
    case 'mock-exam':
      viewElement = new MockExamView(params).render();
      break;
    case 'flashcards':
      viewElement = new FlashcardsView(params).render();
      break;
    default:
      viewElement = new DashboardView(params).render();
  }
  
  currentView = viewElement;
  app.appendChild(viewElement);
  
  // Update active nav
  updateActiveNav(route.view);
  
  // Scroll to top
  window.scrollTo(0, 0);
}

// Navigation
function updateActiveNav(activeView: string): void {
  document.querySelectorAll<HTMLElement>('.nav-tab').forEach(tab => {
    const href = tab.getAttribute('href');
    const view = href?.replace(/^#\/?/, '') || '';
    const isActive = view === activeView;
    tab.classList.toggle('active', isActive);
    if (isActive) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

// Global keyboard shortcuts
function handleGlobalKeys(e: KeyboardEvent): void {
  // Ctrl/Cmd + K: Focus search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
    searchInput?.focus();
  }
  
  // Escape: Close modals
  if (e.key === 'Escape') {
    closeAllModals();
  }
}

// Toast notifications
function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', actionText?: string, actionCallback?: () => void): void {
  const container = getOrCreateToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    ${actionText && actionCallback ? `<button class="toast-action">${actionText}</button>` : ''}
    <button class="toast-close" aria-label="Close">&times;</button>
  `;
  
  if (actionText && actionCallback) {
    toast.querySelector('.toast-action')?.addEventListener('click', () => {
      actionCallback();
      toast.remove();
    });
  }
  
  toast.querySelector('.toast-close')?.addEventListener('click', () => toast.remove());
  
  container.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => toast.remove(), 5000);
}

function getOrCreateToastContainer(): HTMLElement {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }
  return container;
}

// Install button
function showInstallButton(): void {
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'inline-flex';
}

function hideInstallButton(): void {
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
}

async function handleInstallClick(): Promise<void> {
  if (!installPromptEvent) return;
  
  await installPromptEvent.prompt();
  const { outcome } = await installPromptEvent.userChoice;
  
  if (outcome === 'accepted') {
    console.log('User accepted install');
  }
  installPromptEvent = null;
  hideInstallButton();
}

// Close all modals and hand focus back to their trigger
function closeAllModals(): void {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  document.body.style.overflow = '';
  restoreFocus();
}

// Export for debugging
(window as any).app = {
  navigate,
  getCurrentRoute,
  t,
  showToast,
  checkStorageBudget,
  requestPersistentStorage,
  pwa: {
    getRegistration: getServiceWorkerRegistration,
  },
};

// Start app when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
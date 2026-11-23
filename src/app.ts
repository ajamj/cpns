// Main Application Entry Point
import { initRouter, navigate, onRouteChange, getCurrentRoute } from './core/router';
import { initLocale, setLocale, getLocale, t } from './core/i18n';
import { settingsRepo } from './db/repositories/settings';
import { backupRepo } from './db/repositories/backup';
import { db } from './db/schema';
import { loadKisiKisi } from './features/kisi-kisi/registry';
import { eventBus } from './core/events';
import { APP_CONFIG } from './core/config';
import { setShowToast } from './core/app-utils';
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
import { AnalyticsView } from './views/AnalyticsView';
import { SettingsView } from './views/SettingsView';
import { ImportView } from './views/ImportView';
import { ExportView } from './views/ExportView';
import { TrashView } from './views/TrashView';

// Type for PWA install prompt
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Global state
let currentView: HTMLElement | null = null;
let installPromptEvent: BeforeInstallPromptEvent | null = null;

// Auto-import seed questions on first run
async function importSeedQuestionsIfEmpty(): Promise<void> {
  try {
    const { questionsRepo } = await import('@db/repositories/questions');
    const count = await questionsRepo.getTotalCount();
    if (count === 0) {
      console.log('Database empty, importing seed questions...');
      const response = await fetch('/seed-questions.json');
      const data = await response.json();
      if (data.data?.questions?.length) {
        const { backupRepo } = await import('@db/repositories/backup');
        await backupRepo.restoreBackup({
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          appVersion: '1.0.0',
          data: data.data
        }, { mergeStrategy: 'smart', restoreSettings: false });
        console.log(`Imported ${data.data.questions.length} seed questions`);
      }
    }
  } catch (error) {
    console.error('Failed to import seed questions:', error);
  }
}

// Initialize app
async function initApp(): Promise<void> {
  // Initialize locale
  initLocale();
  
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
  
  // Initialize router
  initRouter();
  
  // Register the real toast implementation with the shared helper. The
  // implementation below is DOM-only, so no i18n <-> app-utils cycle remains.
  setShowToast(showToast);

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

// Render route
function renderRoute(route: ReturnType<typeof getCurrentRoute>): void {
  // The router outlet is the <main> landmark so skip links and screen readers
  // land directly on the view content.
  const app = document.getElementById('main-content') ?? document.getElementById('app');
  if (!app) return;
  
  // Clean up previous view
  if (currentView) {
    currentView.remove();
    currentView = null;
  }
  
  // Create new view
  let viewElement: HTMLElement;
  
  const params = route.params as Record<string, string>;
  
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
    case 'analytics':
      viewElement = new AnalyticsView(params).render();
      break;
    case 'settings':
      viewElement = new SettingsView(params).render();
      break;
    case 'import':
      viewElement = new ImportView(params).render();
      break;
    case 'export':
      viewElement = new ExportView(params).render();
      break;
    case 'trash':
      viewElement = new TrashView(params).render();
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
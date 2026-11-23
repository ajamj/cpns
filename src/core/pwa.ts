// PWA lifecycle: service-worker registration/updates and storage health.
// Extracted from app.ts so the update, persistence and quota policies live in
// one place and can be exercised independently by the e2e suite.
import { t } from './i18n';
import { showToast } from './app-utils';
import { eventBus } from './events';
import { settingsRepo } from '../db/repositories/settings';

export const STORAGE_WARNING_THRESHOLD = 0.8;
const QUOTA_WARNING_SESSION_KEY = 'cpns:quotaWarningShown';

export interface StorageBudget {
  usage: number;
  quota: number;
  ratio: number;
}

let activeRegistration: ServiceWorkerRegistration | null = null;
let persistenceRequested = false;
let updatePrompted = false;
let lifecycleInitialised = false;
let quotaWarningShown = false;

function isSkipWaitingMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return typeof type === 'string' && type.toLowerCase() === 'skipwaiting';
}

function promptUpdate(): void {
  // One prompt per installed update: never stack refresh toasts.
  if (updatePrompted) return;
  updatePrompted = true;
  showToast(t('pwa.updateAvailable'), 'info', t('pwa.refresh'), () => {
    window.location.reload();
  });
}

function quotaWarningAlreadyShown(): boolean {
  if (quotaWarningShown) return true;
  try {
    return sessionStorage.getItem(QUOTA_WARNING_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markQuotaWarningShown(): void {
  quotaWarningShown = true;
  try {
    sessionStorage.setItem(QUOTA_WARNING_SESSION_KEY, '1');
  } catch {
    // sessionStorage can be unavailable in strict privacy modes; the module
    // flag still suppresses duplicates for this page load.
  }
}

/**
 * Ask the browser to keep this origin's storage across eviction pressure.
 * The boolean result is persisted in the settings repository so Settings can
 * display it and the automatic request is never repeated on every start.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  let granted = false;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      granted = await navigator.storage.persist();
    }
  } catch (error) {
    console.warn('Persistent storage request failed:', error);
  }

  try {
    await settingsRepo.set('storagePersisted', granted);
  } catch (error) {
    console.warn('Could not persist storage status:', error);
  }

  if (granted) showToast(t('pwa.storagePersisted'), 'success');
  return granted;
}

/**
 * Read the current usage/quota and raise a single, session-scoped warning
 * when the origin has used >= 80% of its quota. Called on init and after
 * each backup creation.
 */
export async function checkStorageBudget(): Promise<StorageBudget | null> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    const ratio = quota > 0 ? usage / quota : 0;

    if (ratio >= STORAGE_WARNING_THRESHOLD && !quotaWarningAlreadyShown()) {
      markQuotaWarningShown();
      eventBus.emit('pwa:storageWarning', { usage, quota });
    }

    return { usage, quota, ratio };
  } catch (error) {
    console.warn('Storage estimate failed:', error);
    return null;
  }
}

/** The registration this module registered, exposed for update simulations. */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return activeRegistration;
}

/** Register the SW and wire update/persistence/quota policies. */
export async function initPwaLifecycle(): Promise<void> {
  if (lifecycleInitialised) return;
  lifecycleInitialised = true;

  // The warning toast goes through the shared eventBus -> app-utils ->
  // app.ts toast container chain, so it looks and behaves like every other toast.
  eventBus.on('pwa:storageWarning', () => {
    showToast(t('pwa.storageWarning'), 'warning');
  });
  eventBus.on('backup:created', () => {
    void checkStorageBudget();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
      // A generated/custom SW may post { type: 'SKIP_WAITING' }; handle that
      // exactly like a local updatefound transition.
      if (isSkipWaitingMessage(event.data)) promptUpdate();
    });

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      activeRegistration = registration;
      console.log('SW registered:', registration.scope);

      // First successful registration only — never prompt for persistence on
      // every page load. The result lands in settings for SettingsView.
      if (!persistenceRequested) {
        persistenceRequested = true;
        const stored = await settingsRepo.get('storagePersisted');
        if (stored === undefined) await requestPersistentStorage();
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state !== 'installed' || !navigator.serviceWorker.controller) return;
          try {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          } catch (error) {
            console.warn('Could not message the waiting worker:', error);
          }
          promptUpdate();
        });
      });
    } catch (error) {
      console.error('SW registration failed:', error);
    }
  }

  void checkStorageBudget();
}

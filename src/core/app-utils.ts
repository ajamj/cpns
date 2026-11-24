// Shared app utilities - navigate, toast, etc.
import { navigate, onRouteChange, getCurrentRoute } from './router';

// Re-export navigate for views
export { navigate, onRouteChange, getCurrentRoute };

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastFunction = (
  message: string,
  type?: ToastType,
  actionText?: string,
  actionCallback?: () => void
) => void;

// The real toast implementation is registered by app.ts (which owns the DOM
// container and styling). app-utils never imports i18n, so the old
// i18n -> app-utils -> i18n -> showToast recursion cannot happen.
let _showToast: ToastFunction | null = null;

export function setShowToast(fn: ToastFunction): void {
  _showToast = fn;
}

/**
 * Show a toast through the shared toast container. When no implementation has
 * been registered yet (early startup, isolated unit test) a minimal DOM-only
 * fallback is used so a notification is never silently dropped.
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  actionText?: string,
  actionCallback?: () => void
): void {
  if (_showToast) {
    _showToast(message, type, actionText, actionCallback);
    return;
  }

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

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const messageEl = document.createElement('span');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;
  toast.appendChild(messageEl);

  if (actionText && actionCallback) {
    const action = document.createElement('button');
    action.className = 'toast-action';
    action.textContent = actionText;
    action.addEventListener('click', () => {
      actionCallback();
      toast.remove();
    });
    toast.appendChild(action);
  }

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// Global event handlers
export function closeAllModals(): void {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
  document.body.style.overflow = '';
}

// Debounce helper - fixed return type
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Small LRU selector cache for derived data that is expensive to recompute
 * (e.g. filtering thousands of questions). Callers pass a serialized cache key
 * so repeated renders with the same filter object/value skip the work, and
 * call `clear()` whenever the underlying source data changes.
 */
export function memoizeSelector<TArgs extends unknown[], TResult>(
  compute: (...args: TArgs) => TResult,
  keyOf: (...args: TArgs) => string,
  maxEntries = 8
): ((...args: TArgs) => TResult) & { clear(): void } {
  const cache = new Map<string, TResult>();

  const memoized = (...args: TArgs): TResult => {
    const key = keyOf(...args);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const result = compute(...args);
    cache.set(key, result);
    if (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return result;
  };

  memoized.clear = (): void => cache.clear();
  return memoized;
}

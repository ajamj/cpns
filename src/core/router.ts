// Hash-based router for SPA
import type { RouteParams } from '../shared/types';
import { eventBus } from './events';
import { applyAccessibilitySettings } from './a11y';

export type ViewName = 
  | 'dashboard'
  | 'question-bank'
  | 'practice'
  | 'mock-exam'
  | 'flashcards'
  | 'analytics'
  | 'settings'
  | 'import'
  | 'export'
  | 'trash';

export type Route = {
  view: ViewName;
  params: RouteParams;
  rawHash: string;
};

type RouteHandler = (route: Route) => void;

const routeMap: Record<string, ViewName> = {
  '': 'dashboard',
  'dashboard': 'dashboard',
  'questions': 'question-bank',
  // Views navigate with the view name (`#question-bank`); keep the legacy
  // `#questions` alias above working too.
  'question-bank': 'question-bank',
  'practice': 'practice',
  'mock-exam': 'mock-exam',
  'flashcards': 'flashcards',
  'analytics': 'analytics',
  'settings': 'settings',
  'import': 'import',
  'export': 'export',
  'trash': 'trash',
};

const APP_TITLE = 'CPNS BMKG SKB Prep';

const VIEW_TITLES: Record<ViewName, string> = {
  dashboard: 'Dasbor',
  'question-bank': 'Bank Soal',
  practice: 'Latihan',
  'mock-exam': 'Ujian Mock CAT',
  flashcards: 'Kartu Hafalan',
  analytics: 'Analitik',
  settings: 'Pengaturan',
  import: 'Impor',
  export: 'Ekspor',
  trash: 'Tempat Sampah',
};

let currentRoute: Route = { view: 'dashboard', params: {}, rawHash: '' };
let isFirstPaint = true;
const handlers: Set<RouteHandler> = new Set();

export function parseHash(hash: string = window.location.hash.slice(1)): Route {
  const [path = '', search] = hash.split('?');
  // Accept both `#/practice` (used by in-app links/manifest shortcuts) and
  // `#practice`; the leading slash must not be treated as an empty route key.
  const routeKey = (path.replace(/^\/+/, '').split('/')[0] ?? '') as string;
  const view = routeMap[routeKey] || 'dashboard';
  
  const params: Record<string, string> = {};
  if (search) {
    new URLSearchParams(search).forEach((value, key) => {
      params[key] = value;
    });
  }
  
  return { view, params, rawHash: hash };
}

export function getCurrentRoute(): Route {
  return currentRoute;
}

export function navigate(view: ViewName, params: Record<string, string> = {}): void {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  });
  const queryString = search.toString();
  const hash = queryString ? `#${view}?${queryString}` : `#${view}`;
  window.location.hash = hash;
}

export function navigateToHash(hash: string): void {
  window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
}

export function onRouteChange(handler: RouteHandler): () => void {
  handlers.add(handler);
  // Call immediately with current route
  handler(currentRoute);
  return () => handlers.delete(handler);
}

/**
 * A running mock exam owns the focus (including its timer live region).
 * Never pull focus back to the page container while the exam is in progress.
 */
function examOwnsFocus(route: Route): boolean {
  if (route.view !== 'mock-exam') return false;
  const mount = document.querySelector('.mock-exam-view');
  return (
    mount?.getAttribute('data-exam-active') === 'true' ||
    (Boolean(document.fullscreenElement) && document.contains(mount))
  );
}

/** Publish route metadata once the view has been rendered. */
function announceRoute(route: Route): void {
  document.title = `${VIEW_TITLES[route.view] ?? VIEW_TITLES.dashboard} — ${APP_TITLE}`;

  const firstPaint = isFirstPaint;
  isFirstPaint = false;
  eventBus.emit('route:changed', {
    view: route.view,
    params: { ...route.params },
    rawHash: route.rawHash,
    isFirstPaint: firstPaint,
  });

  if (firstPaint || examOwnsFocus(route)) return;
  document.getElementById('main-content')?.focus({ preventScroll: true });
}

function notifyHandlers(route: Route): void {
  // WCAG preferences must be in place before the new view's DOM is created so
  // CSS sees the correct font scale / motion / contrast tokens on first paint.
  applyAccessibilitySettings();
  handlers.forEach(h => h(route));
  announceRoute(route);
}

function handleHashChange(): void {
  const newRoute = parseHash();
  if (newRoute.rawHash !== currentRoute.rawHash) {
    currentRoute = newRoute;
    notifyHandlers(newRoute);
  }
}

// Initialize
export function initRouter(): void {
  window.addEventListener('hashchange', handleHashChange);
  // Handle initial load. announceRoute runs once here so the very first paint
  // sets the document title without moving focus away from the page.
  currentRoute = parseHash();
  notifyHandlers(currentRoute);
}

export function destroyRouter(): void {
  window.removeEventListener('hashchange', handleHashChange);
  handlers.clear();
}
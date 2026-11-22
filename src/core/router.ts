// Hash-based router for SPA
import type { RouteParams } from '../shared/types';

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
  'practice': 'practice',
  'mock-exam': 'mock-exam',
  'flashcards': 'flashcards',
  'analytics': 'analytics',
  'settings': 'settings',
  'import': 'import',
  'export': 'export',
  'trash': 'trash',
};

let currentRoute: Route = { view: 'dashboard', params: {}, rawHash: '' };
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

function handleHashChange(): void {
  const newRoute = parseHash();
  if (newRoute.rawHash !== currentRoute.rawHash) {
    currentRoute = newRoute;
    handlers.forEach(h => h(newRoute));
  }
}

// Initialize
export function initRouter(): void {
  window.addEventListener('hashchange', handleHashChange);
  // Handle initial load
  currentRoute = parseHash();
  handlers.forEach(h => h(currentRoute));
}

export function destroyRouter(): void {
  window.removeEventListener('hashchange', handleHashChange);
  handlers.clear();
}
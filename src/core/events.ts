// Event bus for cross-module communication
import mitt from 'mitt';
import type {
  Question,
  Session,
  Attempt,
  MasteryLevel,
  SettingKey,
  KisiKisiTopic,
  BackupMeta,
  ExportData,
  RouteParams,
} from '../shared/types';

export type AppEvents = {
  'question:created': Question;
  'question:updated': Question;
  'question:deleted': string;
  'question:bulkUpdated': Question[];
  'session:started': Session;
  'session:completed': Session;
  'session:paused': Session;
  'session:resumed': Session;
  'mock:timer-warning': {
    sessionId: string;
    level: 'warning' | 'danger' | 'critical';
    remainingMs: number;
  };
  'mock:auto-submitted': { sessionId: string; remainingMs: number };
  'attempt:recorded': Attempt;
  'mastery:updated': { questionId: string; oldLevel: MasteryLevel; newLevel: MasteryLevel };
  'settings:changed': { key: SettingKey; value: unknown };
  'backup:created': BackupMeta;
  'backup:restored': ExportData;
  'theme:changed': 'light' | 'dark' | 'system';
  'language:changed': 'id' | 'en';
  'kisiKisi:loaded': KisiKisiTopic[];
  'db:ready': void;
  'pwa:installPrompt': Event;
  'pwa:installed': void;
  'offline:status': boolean;
  'pwa:storageWarning': { usage: number; quota: number };
  'route:changed': {
    view: string;
    params: RouteParams;
    rawHash: string;
    isFirstPaint: boolean;
  };
};

const eventBus = mitt<AppEvents>();

export { eventBus };

// Helper functions for common event patterns
export function emitQuestionCreated(question: Question): void {
  eventBus.emit('question:created', question);
}

export function emitQuestionUpdated(question: Question): void {
  eventBus.emit('question:updated', question);
}

export function emitQuestionDeleted(id: string): void {
  eventBus.emit('question:deleted', id);
}

/** One event per completed bulk edit, carrying the whole updated batch. */
export function emitQuestionBulkUpdated(questions: Question[]): void {
  eventBus.emit('question:bulkUpdated', questions);
}

export function emitSessionCompleted(session: Session): void {
  eventBus.emit('session:completed', session);
}

/** Fired once per countdown threshold (15/5/1 minutes) during a mock exam. */
export function emitMockTimerWarning(
  sessionId: string,
  level: 'warning' | 'danger' | 'critical',
  remainingMs: number
): void {
  eventBus.emit('mock:timer-warning', { sessionId, level, remainingMs });
}

/** Fired when the countdown reaches zero and the exam is submitted automatically. */
export function emitMockAutoSubmitted(sessionId: string, remainingMs: number): void {
  eventBus.emit('mock:auto-submitted', { sessionId, remainingMs });
}

export function emitAttemptRecorded(attempt: Attempt): void {
  eventBus.emit('attempt:recorded', attempt);
}

export function emitMasteryUpdated(
  questionId: string,
  oldLevel: MasteryLevel,
  newLevel: MasteryLevel
): void {
  eventBus.emit('mastery:updated', { questionId, oldLevel, newLevel });
}

export function emitSettingsChanged(key: SettingKey, value: unknown): void {
  eventBus.emit('settings:changed', { key, value });
}

export function emitThemeChanged(theme: 'light' | 'dark' | 'system'): void {
  eventBus.emit('theme:changed', theme);
}

export function emitOfflineStatus(isOffline: boolean): void {
  eventBus.emit('offline:status', isOffline);
}

// Re-export types for convenience
export type {
  Question,
  Session,
  Attempt,
  MasteryLevel,
  SettingKey,
  KisiKisiTopic,
  BackupMeta,
  ExportData,
} from '../shared/types';
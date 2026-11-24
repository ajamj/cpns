// Dexie database schema
import Dexie, { type Table } from 'dexie';
import type {
  Question,
  Session,
  Attempt,
  Flashcard,
  Settings,
  BackupMeta,
  ExportData,
} from '../shared/types';

export class AppDatabase extends Dexie {
  questions!: Table<Question, string>;
  sessions!: Table<Session, string>;
  attempts!: Table<Attempt, [string, string]>;
  flashcards!: Table<Flashcard, string>;
  settings!: Table<Settings, string>;
  backups!: Table<BackupMeta, number>;

  constructor() {
    super('cpns-bmgk-db');
    this.version(1).stores({
      questions: 'id, topicCode, difficulty, source, createdAt, *tags, masteryLevel, deletedAt',
      sessions: 'id, mode, startedAt, completedAt, topicCodes',
      attempts: '[sessionId+questionId], sessionId, questionId, isCorrect, timestamp',
      flashcards: 'id, questionId, dueDate, interval, easeFactor, reps, lapses',
      settings: 'key',
      backups: '++id, createdAt, schemaVersion',
    });
  }
}

export const db = new AppDatabase();

// Migration helpers (for future versions)
// db.version(2).stores({
//   questions: 'id, topicCode, difficulty, source, createdAt, *tags, masteryLevel, deletedAt, sourceUrl',
//   sessions: 'id, mode, startedAt, completedAt, topicCodes, deviceId',
// }).upgrade(tx => {
//   return tx.table('questions').toCollection().modify(q => { q.sourceUrl = ''; });
// });
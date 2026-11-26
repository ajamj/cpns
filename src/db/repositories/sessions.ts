// Sessions Repository
import { db } from '../schema';
import type { Session, SessionConfig, SessionSummary } from '../../shared/types';
import { toCSV } from '../../core/utils';

/**
 * Sessions CSV for analytics exports (Phase 4, Task 8). `duration` is the
 * recorded time spent in milliseconds; for an unfinished session with no
 * summary it falls back to completedAt - startedAt, or 0 when still unknown.
 */
export function sessionsToCSV(sessions: readonly Session[]): string {
  const rows: string[][] = [[
    'id', 'mode', 'startedAt', 'completedAt', 'duration',
    'totalQuestions', 'correctAnswers', 'scorePercent', 'topicCodes',
  ]];

  for (const s of sessions) {
    const summary = s.summary;
    const started = new Date(s.startedAt).getTime();
    const completed = s.completedAt ? new Date(s.completedAt).getTime() : NaN;
    const elapsed = Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : 0;
    const duration = summary?.timeSpentMs ?? elapsed;

    rows.push([
      s.id,
      s.mode,
      s.startedAt,
      s.completedAt ?? '',
      String(Math.round(duration)),
      String(summary?.totalQuestions ?? 0),
      String(summary?.correctAnswers ?? 0),
      String(summary?.scorePercent ?? 0),
      (s.topicCodes ?? []).join(';'),
    ]);
  }

  return toCSV(rows);
}

export const sessionsRepo = {
  async getAll(): Promise<Session[]> {
    return db.sessions.orderBy('startedAt').reverse().toArray();
  },

  async getById(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
  },

  /** Analytics CSV of all sessions, newest first. */
  async exportCSV(): Promise<string> {
    return sessionsToCSV(await this.getAll());
  },

  async add(session: Session): Promise<string> {
    await db.sessions.add(session);
    return session.id;
  },

  async put(session: Session): Promise<string> {
    await db.sessions.put(session);
    return session.id;
  },

  async delete(id: string): Promise<void> {
    await db.sessions.delete(id);
  },

  async getByMode(mode: Session['mode']): Promise<Session[]> {
    return db.sessions.where('mode').equals(mode).reverse().toArray();
  },

  async getRecent(limit = 10): Promise<Session[]> {
    return db.sessions.orderBy('startedAt').reverse().limit(limit).toArray();
  },

  async getCompleted(): Promise<Session[]> {
    return db.sessions
      .where('completedAt')
      .notEqual(null as any)
      .reverse()
      .toArray();
  },

  async updateSummary(sessionId: string, summary: SessionSummary): Promise<void> {
    const session = await db.sessions.get(sessionId);
    if (session) {
      session.summary = summary;
      session.completedAt = new Date().toISOString();
      await db.sessions.put(session);
    }
  },

  async getCount(): Promise<number> {
    return db.sessions.count();
  },

  async getCountByMode(): Promise<Record<string, number>> {
    const all = await this.getAll();
    return all.reduce((acc, s) => {
      acc[s.mode] = (acc[s.mode] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  },
};
// Sessions Repository
import { db } from '../schema';
import type { Session, SessionConfig, SessionSummary } from '../../shared/types';

export const sessionsRepo = {
  async getAll(): Promise<Session[]> {
    return db.sessions.orderBy('startedAt').reverse().toArray();
  },

  async getById(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
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
// Attempts Repository
import { db } from '../schema';
import type { Attempt } from '../../shared/types';
import { toCSV } from '../../core/utils';

/** Attempts CSV for analytics exports (Phase 4, Task 8). */
export function attemptsToCSV(attempts: readonly Attempt[]): string {
  const rows: string[][] = [[
    'sessionId', 'questionId', 'userAnswer', 'isCorrect', 'timeMs', 'timestamp',
  ]];

  for (const a of attempts) {
    rows.push([
      a.sessionId,
      a.questionId,
      (a.userAnswer ?? []).map(index => String.fromCharCode(65 + index)).join(';'),
      String(Boolean(a.isCorrect)),
      String(a.timeMs),
      a.timestamp,
    ]);
  }

  return toCSV(rows);
}

export const attemptsRepo = {
  async getAll(): Promise<Attempt[]> {
    return db.attempts.toArray();
  },

  /** Analytics CSV of every recorded answer attempt. */
  async exportCSV(): Promise<string> {
    return attemptsToCSV(await this.getAll());
  },

  async add(attempt: Attempt): Promise<void> {
    await db.attempts.add(attempt);
  },

  async bulkAdd(attempts: Attempt[]): Promise<void> {
    await db.attempts.bulkAdd(attempts);
  },

  async getBySession(sessionId: string): Promise<Attempt[]> {
    return db.attempts.where('sessionId').equals(sessionId).toArray();
  },

  async getByQuestion(questionId: string): Promise<Attempt[]> {
    return db.attempts.where('questionId').equals(questionId).toArray();
  },

  async getForSessionQuestion(sessionId: string, questionId: string): Promise<Attempt | undefined> {
    return db.attempts.get([sessionId, questionId]);
  },

  async getRecentByQuestion(questionId: string, limit = 10): Promise<Attempt[]> {
    return db.attempts
      .where('questionId')
      .equals(questionId)
      .reverse()
      .limit(limit)
      .toArray();
  },

  async getStatsForQuestion(questionId: string): Promise<{
    totalAttempts: number;
    correctAttempts: number;
    avgTimeMs: number;
    lastAttemptedAt?: string;
  }> {
    const attempts = await this.getByQuestion(questionId);
    if (attempts.length === 0) {
      return { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0 };
    }
    const total = attempts.length;
    const correct = attempts.filter(a => a.isCorrect).length;
    const avgTime = attempts.reduce((sum, a) => sum + a.timeMs, 0) / total;
    const last = attempts.reduce((latest, a) => 
      new Date(a.timestamp) > new Date(latest.timestamp) ? a : latest
    );
    return {
      totalAttempts: total,
      correctAttempts: correct,
      avgTimeMs: avgTime,
      lastAttemptedAt: last.timestamp,
    };
  },
};
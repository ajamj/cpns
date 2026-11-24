// Attempts Repository
import { db } from '../schema';
import type { Attempt } from '../../shared/types';

export const attemptsRepo = {
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
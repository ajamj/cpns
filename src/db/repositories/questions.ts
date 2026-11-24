// Questions Repository
import { db } from '../schema';
import type { Question, QuestionFilter, QuestionStatistics, MasteryLevel, TopicCode, Difficulty } from '../../shared/types';
import { eventBus, emitQuestionCreated, emitQuestionUpdated, emitQuestionDeleted, emitMasteryUpdated } from '../../core/events';

// Helper: filter out soft-deleted questions (deletedAt is undefined or null)
function isNotDeleted(q: Question): boolean {
  return q.deletedAt === undefined || q.deletedAt === null;
}

function isDeleted(q: Question): boolean {
  return q.deletedAt !== undefined && q.deletedAt !== null;
}

export const questionsRepo = {
  // CRUD
  async getAll(): Promise<Question[]> {
    return (await db.questions.toArray()).filter(isNotDeleted);
  },

  async getAllWithDeleted(): Promise<Question[]> {
    return db.questions.toArray();
  },

  async getById(id: string): Promise<Question | undefined> {
    return db.questions.get(id);
  },

  async add(question: Question): Promise<string> {
    await db.questions.add(question);
    emitQuestionCreated(question);
    return question.id;
  },

  async put(question: Question): Promise<string> {
    // Keep version history (last 5)
    if (!question.versions) question.versions = [];
    const existing = await db.questions.get(question.id);
    if (existing) {
      question.versions.unshift({
        ...existing,
        versions: undefined, // Don't nest versions
      });
      if (question.versions.length > 5) question.versions.pop();
    }
    await db.questions.put(question);
    emitQuestionUpdated(question);
    return question.id;
  },

  async delete(id: string, soft = true): Promise<void> {
    if (soft) {
      const question = await db.questions.get(id);
      if (question) {
        question.deletedAt = new Date().toISOString();
        await db.questions.put(question);
        emitQuestionDeleted(id);
      }
    } else {
      await db.questions.delete(id);
      emitQuestionDeleted(id);
    }
  },

  async bulkAdd(questions: Question[]): Promise<string[]> {
    await db.questions.bulkAdd(questions);
    questions.forEach(q => emitQuestionCreated(q));
    return questions.map(q => q.id);
  },

  async bulkPut(questions: Question[]): Promise<number> {
    await db.questions.bulkPut(questions);
    questions.forEach(q => emitQuestionUpdated(q));
    return questions.length;
  },

  async bulkDelete(ids: string[], soft = true): Promise<number> {
    if (soft) {
      const now = new Date().toISOString();
      let count = 0;
      for (const id of ids) {
        const q = await db.questions.get(id);
        if (q) {
          q.deletedAt = now;
          await db.questions.put(q);
          count++;
          emitQuestionDeleted(id);
        }
      }
      return count;
    } else {
      await db.questions.bulkDelete(ids);
      ids.forEach(id => emitQuestionDeleted(id));
      return ids.length;
    }
  },

  // Query
  async getByTopic(topicCode: TopicCode): Promise<Question[]> {
    return (await db.questions.where('topicCode').equals(topicCode).toArray()).filter(isNotDeleted);
  },

  async getByIds(ids: string[]): Promise<Question[]> {
    return (await db.questions.where('id').anyOf(ids).toArray()).filter(isNotDeleted);
  },

  async search(query: string): Promise<Question[]> {
    const lowerQuery = query.toLowerCase();
    return (await db.questions.toArray())
      .filter(isNotDeleted)
      .filter(q => 
        q.stem.toLowerCase().includes(lowerQuery) ||
        q.options.some(o => o.text.toLowerCase().includes(lowerQuery)) ||
        q.explanation?.toLowerCase().includes(lowerQuery) ||
        q.tags.some(t => t.toLowerCase().includes(lowerQuery))
      );
  },

  async getFiltered(
    filter: QuestionFilter,
    limit = 50,
    offset = 0
  ): Promise<Question[]> {
    const all = await db.questions.toArray();
    
    let filtered = all.filter(isNotDeleted).filter(q => {
      if (filter.topicCodes?.length && !filter.topicCodes.includes(q.topicCode)) return false;
      if (filter.difficulty && q.difficulty !== filter.difficulty) return false;
      if (filter.flags?.bookmarked && !q.flags.bookmarked) return false;
      if (filter.flags?.needsReview && !q.flags.needsReview) return false;
      if (filter.masteryLevels?.length && !filter.masteryLevels.includes(q.statistics.masteryLevel)) return false;
      if (filter.source && !q.source?.toLowerCase().includes(filter.source.toLowerCase())) return false;
      if (filter.dateRange) {
        const created = new Date(q.metadata.createdAt).getTime();
        const start = new Date(filter.dateRange.start).getTime();
        const end = new Date(filter.dateRange.end).getTime() + 86400000;
        if (created < start || created > end) return false;
      }
      if (filter.textSearch) {
        const search = filter.textSearch.toLowerCase();
        if (!q.stem.toLowerCase().includes(search) &&
            !q.options.some(o => o.text.toLowerCase().includes(search)) &&
            !q.explanation?.toLowerCase().includes(search) &&
            !q.tags.some(t => t.toLowerCase().includes(search))) {
          return false;
        }
      }
      return true;
    });

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());

    return filtered.slice(offset, offset + limit);
  },

  async getFilteredCount(filter: QuestionFilter): Promise<number> {
    const all = await db.questions.toArray();
    return all.filter(isNotDeleted).filter(q => {
      if (filter.topicCodes?.length && !filter.topicCodes.includes(q.topicCode)) return false;
      if (filter.difficulty && q.difficulty !== filter.difficulty) return false;
      if (filter.flags?.bookmarked && !q.flags.bookmarked) return false;
      if (filter.flags?.needsReview && !q.flags.needsReview) return false;
      if (filter.masteryLevels?.length && !filter.masteryLevels.includes(q.statistics.masteryLevel)) return false;
      if (filter.source && !q.source?.toLowerCase().includes(filter.source.toLowerCase())) return false;
      if (filter.dateRange) {
        const created = new Date(q.metadata.createdAt).getTime();
        const start = new Date(filter.dateRange.start).getTime();
        const end = new Date(filter.dateRange.end).getTime() + 86400000;
        if (created < start || created > end) return false;
      }
      if (filter.textSearch) {
        const search = filter.textSearch.toLowerCase();
        if (!q.stem.toLowerCase().includes(search) &&
            !q.options.some(o => o.text.toLowerCase().includes(search)) &&
            !q.explanation?.toLowerCase().includes(search) &&
            !q.tags.some(t => t.toLowerCase().includes(search))) {
          return false;
        }
      }
      return true;
    }).length;
  },

  // Trash
  async getTrash(): Promise<Question[]> {
    return (await db.questions.toArray()).filter(isDeleted).sort((a, b) => 
      new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime()
    );
  },

  async restore(id: string): Promise<void> {
    const question = await db.questions.get(id);
    if (question) {
      delete question.deletedAt;
      question.metadata.updatedAt = new Date().toISOString();
      question.metadata.version++;
      await db.questions.put(question);
      emitQuestionUpdated(question);
    }
  },

  async purge(id: string): Promise<void> {
    await db.questions.delete(id);
    emitQuestionDeleted(id);
  },

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();
    
    const all = await db.questions.toArray();
    const oldItems = all.filter(q => isDeleted(q) && new Date(q.deletedAt!).getTime() < new Date(cutoffISO).getTime());
    
    if (oldItems.length > 0) {
      await db.questions.bulkDelete(oldItems.map(q => q.id));
      oldItems.forEach(q => emitQuestionDeleted(q.id));
    }
    return oldItems.length;
  },

  // Statistics
  //
  // The dashboard used to call getAll() three times, deserialising every full
  // question record (including options/explanations) from IndexedDB. At the
  // 2000-question stress envelope that alone cost >1s. These helpers read the
  // existing sparse indexes (topicCode, masteryLevel, deletedAt) as primitive
  // keys instead, which keeps the dashboard within the REQUIREMENTS §4.1 budget.
  async getStatsByTopic(): Promise<Record<string, { total: number; mastered: number; learning: number; new: number; avgMastery: number }>> {
    const [topicKeys, topicPks, levelKeys, levelPks, deletedPks] = await Promise.all([
      db.questions.orderBy('topicCode').keys(),
      db.questions.orderBy('topicCode').primaryKeys(),
      db.questions.orderBy('masteryLevel').keys(),
      db.questions.orderBy('masteryLevel').primaryKeys(),
      db.questions.where('deletedAt').above('').primaryKeys(),
    ]);

    const topicByPk = new Map<string, string>();
    for (let i = 0; i < topicPks.length; i++) {
      topicByPk.set(String(topicPks[i]), String(topicKeys[i]));
    }
    const levelByPk = new Map<string, number>();
    for (let i = 0; i < levelPks.length; i++) {
      levelByPk.set(String(levelPks[i]), Number(levelKeys[i]));
    }
    const deleted = new Set(deletedPks.map(String));

    type TopicStat = { total: number; mastered: number; learning: number; new: number; sum: number };
    const stats: Record<string, TopicStat> = {};
    for (const [primaryKey, topicCode] of topicByPk) {
      if (deleted.has(primaryKey)) continue;
      const level = levelByPk.get(primaryKey) ?? 0;
      if (!stats[topicCode]) {
        stats[topicCode] = { total: 0, mastered: 0, learning: 0, new: 0, sum: 0 };
      }
      const stat = stats[topicCode]!;
      stat.total++;
      stat.sum += level;
      if (level === 3) stat.mastered++;
      else if (level >= 1) stat.learning++;
      else stat.new++;
    }

    const result: Record<string, { total: number; mastered: number; learning: number; new: number; avgMastery: number }> = {};
    for (const [topicCode, stat] of Object.entries(stats)) {
      result[topicCode] = {
        total: stat.total,
        mastered: stat.mastered,
        learning: stat.learning,
        new: stat.new,
        avgMastery: stat.total > 0 ? stat.sum / (stat.total * 3) : 0,
      };
    }
    return result;
  },

  async getTotalCount(): Promise<number> {
    const [total, deleted] = await Promise.all([
      db.questions.count(),
      db.questions.where('deletedAt').above('').count(),
    ]);
    return total - deleted;
  },

  async getCountByTopic(): Promise<Record<string, number>> {
    const [topicKeys, primaryKeys, deletedPks] = await Promise.all([
      db.questions.orderBy('topicCode').keys(),
      db.questions.orderBy('topicCode').primaryKeys(),
      db.questions.where('deletedAt').above('').primaryKeys(),
    ]);
    const deleted = new Set(deletedPks.map(String));
    const counts: Record<string, number> = {};
    for (let i = 0; i < primaryKeys.length; i++) {
      if (deleted.has(String(primaryKeys[i]))) continue;
      const topicCode = String(topicKeys[i]);
      counts[topicCode] = (counts[topicCode] ?? 0) + 1;
    }
    return counts;
  },

  // Mastery update
  async updateMastery(questionId: string, isCorrect: boolean): Promise<void> {
    const question = await db.questions.get(questionId);
    if (!question) return;

    const oldLevel = question.statistics.masteryLevel;
    const stats = question.statistics;
    
    stats.totalAttempts++;
    if (isCorrect) stats.correctAttempts++;
    
    if (isCorrect) {
      stats.masteryLevel = Math.min(3, stats.masteryLevel + 1) as MasteryLevel;
    } else {
      stats.masteryLevel = Math.max(1, stats.masteryLevel - 1) as MasteryLevel;
    }
    
    question.metadata.updatedAt = new Date().toISOString();
    question.metadata.version++;
    
    await db.questions.put(question);
    
    if (oldLevel !== stats.masteryLevel) {
      emitMasteryUpdated(questionId, oldLevel, stats.masteryLevel);
    }
  },

  async updateMasteryLevel(questionId: string, level: MasteryLevel): Promise<void> {
    const question = await db.questions.get(questionId);
    if (!question) return;
    
    const oldLevel = question.statistics.masteryLevel;
    question.statistics.masteryLevel = level;
    question.metadata.updatedAt = new Date().toISOString();
    question.metadata.version++;
    
    await db.questions.put(question);
    
    if (oldLevel !== level) {
      emitMasteryUpdated(questionId, oldLevel, level);
    }
  },

  // Import/Export helpers
  async importQuestions(
    questions: Question[],
    strategy: 'skip' | 'overwrite' | 'duplicate' | 'smart' = 'smart'
  ): Promise<{ imported: number; skipped: number; conflicts: number }> {
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    for (const q of questions) {
      const existing = await db.questions.get(q.id);
      
      if (!existing) {
        await db.questions.add(q);
        emitQuestionCreated(q);
        imported++;
      } else if (strategy === 'overwrite' || strategy === 'smart') {
        q.metadata.version = existing.metadata.version + 1;
        q.versions = existing.versions || [];
        q.versions.unshift({ ...existing, versions: undefined });
        if (q.versions.length > 5) q.versions.pop();
        await db.questions.put(q);
        emitQuestionUpdated(q);
        imported++;
        if (strategy === 'smart') conflicts++;
      } else if (strategy === 'duplicate') {
        const newQuestion = { ...q, id: crypto.randomUUID() };
        await db.questions.add(newQuestion);
        emitQuestionCreated(newQuestion);
        imported++;
      } else {
        skipped++;
      }
    }

    return { imported, skipped, conflicts };
  },

  async exportAll(): Promise<Question[]> {
    return this.getAllWithDeleted();
  },

  async exportFiltered(filter: QuestionFilter): Promise<Question[]> {
    const all = await this.getFiltered(filter, 10000, 0);
    return all;
  },
};
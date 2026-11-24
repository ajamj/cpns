// Questions Repository
import { db } from '../schema';
import type {
  Question,
  QuestionFilter,
  QuestionFlags,
  QuestionMetadata,
  QuestionStatistics,
  MasteryLevel,
  TopicCode,
  Difficulty,
} from '../../shared/types';
import { eventBus, emitQuestionCreated, emitQuestionUpdated, emitQuestionDeleted, emitMasteryUpdated } from '../../core/events';
import { generateId, nowISO } from '../../core/utils';
import { stemSimilarity, SMART_SIMILARITY_THRESHOLD, type MergeStrategy } from '../../features/import-export/merge';

const MAX_VERSION_SNAPSHOTS = 5;

// Helper: filter out soft-deleted questions (deletedAt is undefined or null)
function isNotDeleted(q: Question): boolean {
  return q.deletedAt === undefined || q.deletedAt === null;
}

function isDeleted(q: Question): boolean {
  return q.deletedAt !== undefined && q.deletedAt !== null;
}

/** Full-text match across every searchable question field (shared by search + filter). */
function matchesText(q: Question, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return (q.stem ?? '').toLowerCase().includes(needle) ||
    (q.options ?? []).some(o => (o.text ?? '').toLowerCase().includes(needle)) ||
    (q.explanation ?? '').toLowerCase().includes(needle) ||
    (q.tags ?? []).some(t => t.toLowerCase().includes(needle));
}

/** Single source of truth for every QuestionFilter dimension. */
function matchesFilter(q: Question, filter: QuestionFilter): boolean {
  if (filter.topicCodes?.length && !filter.topicCodes.includes(q.topicCode)) return false;
  if (filter.difficulty !== undefined && q.difficulty !== filter.difficulty) return false;
  if (filter.flags) {
    if (filter.flags.bookmarked && !q.flags?.bookmarked) return false;
    if (filter.flags.needsReview && !q.flags?.needsReview) return false;
    if (filter.flags.disputed && !q.flags?.disputed) return false;
  }
  if (filter.masteryLevels?.length && !filter.masteryLevels.includes(q.statistics?.masteryLevel)) return false;
  if (filter.source && !(q.source ?? '').toLowerCase().includes(filter.source.toLowerCase())) return false;
  if (filter.dateRange) {
    const created = new Date(q.metadata?.createdAt ?? '').getTime();
    const start = new Date(filter.dateRange.start).getTime();
    const end = new Date(filter.dateRange.end).getTime() + 86400000;
    if (Number.isFinite(start) && Number.isFinite(end) && (created < start || created > end)) return false;
  }
  if (filter.textSearch?.trim() && !matchesText(q, filter.textSearch)) return false;
  return true;
}

/** Snapshot of the previous state, with nested versions/deletedAt stripped. */
function createVersionSnapshot(question: Question): Question {
  const snapshot = structuredClone(question);
  delete snapshot.versions;
  delete snapshot.deletedAt;
  return snapshot;
}

/** Keep at most the last 5 snapshots, newest first. */
function appendVersionSnapshot(next: Question, previous?: Question): void {
  if (!previous) return;
  const versions = Array.isArray(next.versions) ? next.versions.slice() : [];
  versions.unshift(createVersionSnapshot(previous));
  next.versions = versions.slice(0, MAX_VERSION_SNAPSHOTS);
}

/**
 * Every persisted edit follows one rule: version = previous version + 1, and
 * the pre-edit row becomes the newest snapshot (capped at 5). Callers may send
 * an already-incremented version (the form does); we accept it only when it is
 * exactly the expected value so bulk/import paths cannot skip or duplicate it.
 */
function prepareVersionedUpdate(next: Question, previous?: Question): void {
  if (!previous) return;
  // Callers may build a patch without re-sending `versions`; never drop history.
  if (!Array.isArray(next.versions) && Array.isArray(previous.versions)) {
    next.versions = previous.versions.map(cloneQuestion);
  }
  const previousVersion = previous.metadata?.version ?? 0;
  const incomingVersion = next.metadata?.version ?? 0;
  if (incomingVersion !== previousVersion + 1) {
    next.metadata = {
      ...next.metadata,
      createdAt: next.metadata?.createdAt ?? previous.metadata?.createdAt ?? nowISO(),
      updatedAt: nowISO(),
      author: next.metadata?.author ?? previous.metadata?.author ?? 'user',
      version: previousVersion + 1,
    };
  }
  appendVersionSnapshot(next, previous);
}

function cloneQuestion(q: Question): Question {
  return structuredClone(q);
}

/** Fill optional fields so imported records cannot break later queries. */
function normalizeImported(q: Question): Question {
  const timestamp = nowISO();
  const defaultFlags: QuestionFlags = { bookmarked: false, needsReview: false, disputed: false };
  const defaultMetadata: QuestionMetadata = { createdAt: timestamp, updatedAt: timestamp, version: 1, author: 'import' };
  const defaultStatistics: QuestionStatistics = { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 };
  return {
    ...q,
    tags: Array.isArray(q.tags) ? q.tags : [],
    options: Array.isArray(q.options) ? q.options : [],
    correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer : [],
    flags: Object.assign(defaultFlags, q.flags),
    metadata: Object.assign(defaultMetadata, q.metadata),
    statistics: Object.assign(defaultStatistics, q.statistics),
  };
}

function isImportable(q: Question): q is Question {
  return !!q && typeof q.id === 'string' && q.id.length > 0 &&
    typeof q.stem === 'string' && q.stem.trim().length > 0 &&
    Array.isArray(q.options) && q.options.length > 0;
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

  /** Newest-first pre-edit snapshots (max 5), safe to render/export. */
  async getVersions(id: string): Promise<Question[]> {
    const question = await db.questions.get(id);
    if (!question || !Array.isArray(question.versions)) return [];
    return question.versions.map(cloneQuestion);
  },

  /**
   * Replace a question with a stored snapshot. The current state is snapshotted
   * first, so a restore is itself reversible and visible in the history.
   */
  async restoreVersion(id: string, version: number): Promise<Question | undefined> {
    const current = await db.questions.get(id);
    const snapshot = current?.versions?.find(v => Number(v.metadata?.version) === version);
    if (!current || !snapshot) return undefined;

    const restored = cloneQuestion(snapshot);
    restored.id = current.id;
    delete restored.deletedAt;
    delete restored.versions;
    prepareVersionedUpdate(restored, current);
    await db.questions.put(restored);
    emitQuestionUpdated(restored);
    return restored;
  },

  async add(question: Question): Promise<string> {
    await db.questions.add(question);
    emitQuestionCreated(question);
    return question.id;
  },

  async put(question: Question): Promise<string> {
    // Every edit bumps the version and stores the pre-edit snapshot.
    const existing = await db.questions.get(question.id);
    prepareVersionedUpdate(question, existing);
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

  /** Batch fetch by ID, preserving the caller's order and dropping duplicates. */
  async getByIds(ids: string[]): Promise<Question[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];
    const rows = await db.questions.where('id').anyOf(uniqueIds).toArray();
    const byId = new Map(rows.map(q => [q.id, q]));
    return uniqueIds
      .map(id => byId.get(id))
      .filter((q): q is Question => q !== undefined && isNotDeleted(q));
  },

  async search(query: string): Promise<Question[]> {
    if (!query?.trim()) return [];
    return (await db.questions.toArray())
      .filter(isNotDeleted)
      .filter(q => matchesText(q, query));
  },

  async getFiltered(
    filter: QuestionFilter,
    limit = 50,
    offset = 0
  ): Promise<Question[]> {
    const filtered = (await db.questions.toArray())
      .filter(isNotDeleted)
      .filter(q => matchesFilter(q, filter));

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());

    return filtered.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
  },

  async getFilteredCount(filter: QuestionFilter): Promise<number> {
    const all = await db.questions.toArray();
    return all.filter(isNotDeleted).filter(q => matchesFilter(q, filter)).length;
  },

  // Trash
  async getTrash(): Promise<Question[]> {
    return (await db.questions.toArray()).filter(isDeleted).sort((a, b) => 
      new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime()
    );
  },

  /** Count soft-deleted rows without materialising every question field. */
  async getTrashCount(): Promise<number> {
    return db.questions.where('deletedAt').above('').count();
  },

  async restore(id: string): Promise<void> {
    const question = await db.questions.get(id);
    if (question && isDeleted(question)) {
      delete question.deletedAt;
      question.metadata.updatedAt = new Date().toISOString();
      question.metadata.version++;
      await db.questions.put(question);
      emitQuestionUpdated(question);
    }
  },

  /** Restore many soft-deleted rows in one pass; returns the number restored. */
  async bulkRestore(ids: string[]): Promise<number> {
    let restored = 0;
    const now = new Date().toISOString();
    for (const id of [...new Set(ids)]) {
      const question = await db.questions.get(id);
      if (!question || !isDeleted(question)) continue;
      delete question.deletedAt;
      question.metadata.updatedAt = now;
      question.metadata.version++;
      await db.questions.put(question);
      emitQuestionUpdated(question);
      restored++;
    }
    return restored;
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
    strategy: MergeStrategy = 'smart',
    /** Optional per-question override chosen in the import preview modal. */
    strategyFor?: (question: Question) => MergeStrategy | undefined
  ): Promise<{ imported: number; skipped: number; conflicts: number }> {
    const incoming = Array.isArray(questions) ? questions : [];
    let imported = 0;
    let skipped = incoming.length;
    let conflicts = 0;

    // Load once: needed both for ID lookups and for smart stem-similarity checks.
    const existingAll = (await db.questions.toArray()).map(normalizeImported);
    const byId = new Map(existingAll.map(q => [q.id, q]));
    const toAdd: Question[] = [];
    const toPut: Question[] = [];

    for (const raw of incoming) {
      if (!isImportable(raw)) continue; // malformed row -> skip, do not abort the batch
      const q = normalizeImported(cloneQuestion(raw));
      const effectiveStrategy = strategyFor?.(q) ?? strategy;
      skipped--;

      const existing = byId.get(q.id);
      if (!existing) {
        let candidate = q;
        if (effectiveStrategy === 'smart') {
          const nearDuplicate = existingAll.find(e => stemSimilarity(q.stem, e.stem) > SMART_SIMILARITY_THRESHOLD);
          if (nearDuplicate) {
            conflicts++;
            candidate = { ...candidate, flags: { ...candidate.flags, needsReview: true } };
          }
        }
        toAdd.push(candidate);
        existingAll.push(candidate);
        byId.set(candidate.id, candidate);
        imported++;
      } else if (effectiveStrategy === 'skip') {
        skipped++;
      } else if (effectiveStrategy === 'duplicate') {
        const duplicate: Question = {
          ...cloneQuestion(q),
          id: generateId(),
          versions: [],
          metadata: { ...q.metadata, createdAt: nowISO(), updatedAt: nowISO(), version: 1 },
          statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
        };
        delete duplicate.deletedAt;
        toAdd.push(duplicate);
        existingAll.push(duplicate);
        byId.set(duplicate.id, duplicate);
        imported++;
      } else {
        // overwrite | smart: same ID updates in place and keeps version history.
        const merged = cloneQuestion(q);
        merged.metadata = {
          ...existing.metadata,
          ...q.metadata,
          version: (existing.metadata?.version ?? 0) + 1,
          updatedAt: nowISO(),
        };
        prepareVersionedUpdate(merged, existing);
        toPut.push(merged);
        const index = existingAll.indexOf(existing);
        if (index >= 0) existingAll[index] = merged;
        byId.set(merged.id, merged);
        imported++;
        if (effectiveStrategy === 'smart') conflicts++;
      }
    }

    if (toAdd.length) await db.questions.bulkAdd(toAdd);
    if (toPut.length) await db.questions.bulkPut(toPut);
    toAdd.forEach(q => emitQuestionCreated(q));
    toPut.forEach(q => emitQuestionUpdated(q));

    return { imported, skipped, conflicts };
  },

  async exportAll(): Promise<Question[]> {
    return db.questions.toArray();
  },

  /** Uncapped export of every non-deleted question matching the filter. */
  async exportFiltered(filter: QuestionFilter): Promise<Question[]> {
    return (await db.questions.toArray()).filter(isNotDeleted).filter(q => matchesFilter(q, filter));
  },
};
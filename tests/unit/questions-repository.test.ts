/**
 * Question repository contract tests (Phase 2, Task 1).
 * Dexie is replaced with an in-memory table so the query/import/export logic
 * can be exercised in the node-only vitest environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty, MasteryLevel, Question, QuestionFilter } from '../../src/shared/types';

const { store } = vi.hoisted(() => ({
  store: new Map<string, Question>(),
}));

vi.mock('../../src/db/schema', () => {
  function collection(rows: Question[]) {
    return {
      async toArray(): Promise<Question[]> {
        return rows.map(q => structuredClone(q));
      },
      async count(): Promise<number> {
        return rows.length;
      },
    };
  }

  const questions = {
    async toArray(): Promise<Question[]> {
      return Array.from(store.values()).map(q => structuredClone(q));
    },
    async get(id: string): Promise<Question | undefined> {
      const q = store.get(id);
      return q ? structuredClone(q) : undefined;
    },
    async add(q: Question): Promise<string> {
      if (store.has(q.id)) throw new Error(`duplicate key: ${q.id}`);
      store.set(q.id, structuredClone(q));
      return q.id;
    },
    async bulkAdd(qs: Question[]): Promise<void> {
      for (const q of qs) await questions.add(q);
    },
    async put(q: Question): Promise<string> {
      store.set(q.id, structuredClone(q));
      return q.id;
    },
    async bulkPut(qs: Question[]): Promise<void> {
      for (const q of qs) await questions.put(q);
    },
    async delete(id: string): Promise<void> {
      store.delete(id);
    },
    async bulkDelete(ids: string[]): Promise<void> {
      ids.forEach(id => store.delete(id));
    },
    where(index: string) {
      return {
        equals(value: unknown) {
          return collection(Array.from(store.values()).filter(q => (q as unknown as Record<string, unknown>)[index] === value));
        },
        anyOf(values: unknown[]) {
          return collection(Array.from(store.values()).filter(q => values.includes((q as unknown as Record<string, unknown>)[index])));
        },
        above(value: unknown) {
          return collection(Array.from(store.values()).filter(q => {
            const key = (q as unknown as Record<string, unknown>)[index];
            return typeof key === 'string' && typeof value === 'string' && key > value;
          }));
        },
      };
    },
  };

  return { db: { questions } };
});

import { questionsRepo, TRASH_RETENTION_DAYS } from '../../src/db/repositories/questions';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    topicCode: 'UM-01',
    stem: 'Apa ibukota Indonesia?',
    options: [
      { id: 'o-1', text: 'Jakarta', isCorrect: true },
      { id: 'o-2', text: 'Bandung', isCorrect: false },
    ],
    correctAnswer: [0],
    explanation: 'Jakarta adalah ibukota Indonesia.',
    difficulty: 1,
    source: 'BMKG 2024',
    tags: ['geografi', 'ibukota'],
    flags: { bookmarked: false, needsReview: false, disputed: false },
    metadata: { createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', version: 1, author: 'import' },
    statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 0 },
    ...overrides,
  };
}

async function seed(questions: Question[]): Promise<void> {
  store.clear();
  for (const q of questions) store.set(q.id, structuredClone(q));
}

describe('questionsRepo query methods', () => {
  beforeEach(async () => {
    await seed([
      makeQuestion({ id: 'q-1', topicCode: 'UM-01', stem: 'IBUKOTA Indonesia?' }),
      makeQuestion({ id: 'q-2', topicCode: 'KH-03', stem: 'Siklon tropis', difficulty: 2, explanation: 'Siklon tropis menghasilkan angin kencang.' }),
      makeQuestion({ id: 'q-3', topicCode: 'UM-01', stem: 'Cuaca jakarta', explanation: 'Prakiraan cuaca harian.', flags: { bookmarked: true, needsReview: true, disputed: true } }),
      makeQuestion({ id: 'q-4', topicCode: 'UM-02', stem: 'Deleted question', deletedAt: '2024-06-01T00:00:00.000Z' }),
    ]);
  });

  it('getByTopic filters by index and hides soft-deleted rows', async () => {
    const result = await questionsRepo.getByTopic('UM-01');
    expect(result.map(q => q.id).sort()).toEqual(['q-1', 'q-3']);
  });

  it('getByDifficulty filters by difficulty and hides soft-deleted rows', async () => {
    expect((await questionsRepo.getByDifficulty(1)).map(q => q.id)).toEqual(['q-1', 'q-3']);
    expect((await questionsRepo.getByDifficulty(2)).map(q => q.id)).toEqual(['q-2']);
    expect(await questionsRepo.getByDifficulty(3)).toEqual([]);
  });

  it('update replaces a question with version history like put', async () => {
    const current = await questionsRepo.getById('q-1');
    await questionsRepo.update(makeQuestion({ ...current!, stem: 'Updated stem' }));
    const saved = await questionsRepo.getById('q-1');
    expect(saved?.stem).toBe('Updated stem');
    expect(saved?.metadata.version).toBe(2);
    expect(saved?.versions?.[0]?.stem).toBe('IBUKOTA Indonesia?');
  });

  it('getByIds preserves input order, dedupes IDs and hides deleted rows', async () => {
    const result = await questionsRepo.getByIds(['q-3', 'q-4', 'q-1', 'q-3', 'missing']);
    expect(result.map(q => q.id)).toEqual(['q-3', 'q-1']);
    expect(await questionsRepo.getByIds([])).toEqual([]);
  });

  it('search matches stem, options, explanation and tags case-insensitively', async () => {
    expect((await questionsRepo.search('jakarta')).map(q => q.id).sort()).toEqual(['q-1', 'q-2', 'q-3']);
    expect((await questionsRepo.search('siklon')).map(q => q.id)).toEqual(['q-2']);
    expect((await questionsRepo.search('GEOGRAFI')).map(q => q.id).sort()).toEqual(['q-1', 'q-2', 'q-3']);
    expect((await questionsRepo.search('ibukota indonesia')).map(q => q.id)).toEqual(['q-1']);
    expect(await questionsRepo.search('   ')).toEqual([]);
  });

  it('getFiltered honours every filter dimension including disputed', async () => {
    const filter: QuestionFilter = {
      topicCodes: ['UM-01'],
      flags: { disputed: true },
      masteryLevels: [0],
      source: 'bmkg',
      textSearch: 'cuaca',
      dateRange: { start: '2024-01-01', end: '2024-01-31' },
    };
    const result = await questionsRepo.getFiltered(filter, 10, 0);
    expect(result.map(q => q.id)).toEqual(['q-3']);

    // A non-matching flag must exclude the row (previously ignored disputed).
    expect(await questionsRepo.getFiltered({ flags: { disputed: true } })).toHaveLength(1);
    expect(await questionsRepo.getFiltered({ difficulty: 2 as Difficulty })).toHaveLength(1);
    expect(await questionsRepo.getFiltered({ flags: { bookmarked: true, needsReview: true } })).toHaveLength(1);
    expect(await questionsRepo.getFilteredCount(filter)).toBe(1);
  });

  it('getFiltered applies offset/limit after sorting newest-first', async () => {
    const result = await questionsRepo.getFiltered({}, 1, 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).not.toBe('q-1'); // newest rows come first
  });
});

describe('questionsRepo version history', () => {
  beforeEach(async () => {
    await seed([makeQuestion()]);
  });

  it('put keeps the last 5 snapshots without nesting versions', async () => {
    for (let i = 2; i <= 7; i++) {
      const q = await questionsRepo.getById('q-1');
      expect(q).toBeDefined();
      await questionsRepo.put(makeQuestion({ ...q!, stem: `Revision ${i}`, metadata: { ...q!.metadata, version: i } }));
    }
    const saved = await questionsRepo.getById('q-1');
    expect(saved?.stem).toBe('Revision 7');
    expect(saved?.versions).toHaveLength(5);
    expect(saved?.versions?.map(v => v.stem)).toEqual([
      'Revision 6', 'Revision 5', 'Revision 4', 'Revision 3', 'Revision 2',
    ]);
    for (const snapshot of saved?.versions ?? []) {
      expect(snapshot.versions).toBeUndefined();
      expect(snapshot.deletedAt).toBeUndefined();
    }
  });

  it('add does not create a version snapshot', async () => {
    await questionsRepo.add(makeQuestion({ id: 'q-new' }));
    expect((await questionsRepo.getById('q-new'))?.versions).toBeUndefined();
  });

  it('put increments the version even when the caller does not', async () => {
    await questionsRepo.put(makeQuestion({ stem: 'Direct edit' }));
    const saved = await questionsRepo.getById('q-1');
    expect(saved?.metadata.version).toBe(2);
    expect(saved?.versions?.[0]?.stem).toBe('Apa ibukota Indonesia?');
  });

  it('getVersions returns newest-first clones capped at five', async () => {
    for (let version = 2; version <= 8; version++) {
      await questionsRepo.put(makeQuestion({
        stem: `Revision ${version}`,
        metadata: { ...makeQuestion().metadata, version },
      }));
    }
    const versions = await questionsRepo.getVersions('q-1');
    expect(versions.map(v => v.stem)).toEqual([
      'Revision 7', 'Revision 6', 'Revision 5', 'Revision 4', 'Revision 3',
    ]);
    versions[0]!.stem = 'tampered';
    expect((await questionsRepo.getVersions('q-1'))[0]?.stem).toBe('Revision 7');
    expect(await questionsRepo.getVersions('missing')).toEqual([]);
  });

  it('restoreVersion applies an old snapshot and records the reversal', async () => {
    await questionsRepo.put(makeQuestion({ stem: 'Revision 2', metadata: { ...makeQuestion().metadata, version: 2 } }));
    await questionsRepo.put(makeQuestion({ stem: 'Revision 3', metadata: { ...makeQuestion().metadata, version: 3 } }));

    const restored = await questionsRepo.restoreVersion('q-1', 1);
    expect(restored?.stem).toBe('Apa ibukota Indonesia?');
    expect(restored?.metadata.version).toBe(4);

    const saved = await questionsRepo.getById('q-1');
    expect(saved?.stem).toBe('Apa ibukota Indonesia?');
    expect(saved?.metadata.version).toBe(4);
    expect(saved?.versions?.map(v => v.stem)).toEqual([
      'Revision 3', 'Revision 2', 'Apa ibukota Indonesia?',
    ]);
    for (const snapshot of saved?.versions ?? []) expect(snapshot.versions).toBeUndefined();
  });

  it('restoreVersion ignores unknown versions without changing the question', async () => {
    await questionsRepo.put(makeQuestion({ stem: 'Revision 2', metadata: { ...makeQuestion().metadata, version: 2 } }));
    expect(await questionsRepo.restoreVersion('q-1', 99)).toBeUndefined();
    expect((await questionsRepo.getById('q-1'))?.stem).toBe('Revision 2');
    expect(await questionsRepo.restoreVersion('missing', 1)).toBeUndefined();
  });
});

describe('questionsRepo import/export', () => {
  beforeEach(async () => {
    await seed([makeQuestion({ id: 'q-1', stem: 'Siklon tropis di Indonesia' })]);
  });

  it('skip leaves existing rows untouched and imports new ones', async () => {
    const result = await questionsRepo.importQuestions([
      makeQuestion({ id: 'q-1', stem: 'Updated stem' }),
      makeQuestion({ id: 'q-2' }),
    ], 'skip');
    expect(result).toEqual({ imported: 1, skipped: 1, conflicts: 0 });
    expect((await questionsRepo.getById('q-1'))?.stem).toBe('Siklon tropis di Indonesia');
  });

  it('overwrite updates in place, increments version and stores a snapshot', async () => {
    const result = await questionsRepo.importQuestions([
      makeQuestion({ id: 'q-1', stem: 'Siklon tropis updated', metadata: { ...makeQuestion().metadata, version: 3 } }),
    ], 'overwrite');
    expect(result).toEqual({ imported: 1, skipped: 0, conflicts: 0 });
    const saved = await questionsRepo.getById('q-1');
    expect(saved?.stem).toBe('Siklon tropis updated');
    expect(saved?.metadata.version).toBe(2);
    expect(saved?.versions?.[0]?.stem).toBe('Siklon tropis di Indonesia');
  });

  it('duplicate creates an independent copy with a fresh ID', async () => {
    const result = await questionsRepo.importQuestions([makeQuestion({ id: 'q-1', stem: 'Siklon tropis di Indonesia' })], 'duplicate');
    expect(result.imported).toBe(1);
    const all = await questionsRepo.exportAll();
    expect(all).toHaveLength(2);
    const copy = all.find(q => q.id !== 'q-1');
    expect(copy?.stem).toBe('Siklon tropis di Indonesia');
    expect(copy?.deletedAt).toBeUndefined();
    expect(copy?.metadata.version).toBe(1);
  });

  it('smart flags >90% stem-similar new questions for review and counts ID conflicts', async () => {
    const result = await questionsRepo.importQuestions([
      makeQuestion({ id: 'q-1', stem: 'Siklon tropis di Indonesia' }),
      makeQuestion({ id: 'q-near', stem: 'Siklon tropis di indonesia' }),
    ], 'smart');
    expect(result).toEqual({ imported: 2, skipped: 0, conflicts: 2 });
    expect((await questionsRepo.getById('q-near'))?.flags.needsReview).toBe(true);
  });

  it('skips malformed rows instead of aborting the batch', async () => {
    const result = await questionsRepo.importQuestions([
      makeQuestion({ id: '', stem: 'No ID' }),
      makeQuestion({ id: 'q-ok', stem: 'Valid', options: [] }),
      makeQuestion({ id: 'q-ok2', stem: 'Also valid' }),
    ], 'skip');
    expect(result).toEqual({ imported: 1, skipped: 2, conflicts: 0 });
    expect(await questionsRepo.getById('q-ok2')).toBeDefined();
  });

  it('exportAll includes deleted rows; exportFiltered is uncapped and excludes them', async () => {
    const extras = Array.from({ length: 60 }, (_, i) => makeQuestion({
      id: `bulk-${i}`,
      stem: `Bulk question ${i}`,
      metadata: { ...makeQuestion().metadata, createdAt: new Date(Date.UTC(2024, 1, 1, 0, 0, i)).toISOString() },
    }));
    await seed([makeQuestion({ id: 'q-1' }), makeQuestion({ id: 'q-deleted', deletedAt: '2024-05-01T00:00:00.000Z' }), ...extras]);
    expect(await questionsRepo.exportAll()).toHaveLength(62);
    expect(await questionsRepo.exportFiltered({})).toHaveLength(61);
    expect(await questionsRepo.exportFiltered({ topicCodes: ['UM-01'], textSearch: 'bulk question' })).toHaveLength(60);
  });
});

describe('questionsRepo soft delete and trash (Task 7)', () => {
  it('delete() marks deletedAt and hides the row from normal queries', async () => {
    await seed([makeQuestion({ id: 'q-1' }), makeQuestion({ id: 'q-2' })]);
    await questionsRepo.delete('q-1');

    expect(store.get('q-1')?.deletedAt).toEqual(expect.any(String));
    expect((await questionsRepo.getAll()).map(q => q.id)).toEqual(['q-2']);
    expect((await questionsRepo.getAllWithDeleted())).toHaveLength(2);
    expect((await questionsRepo.getTrash()).map(q => q.id)).toEqual(['q-1']);
    expect(await questionsRepo.getTrashCount()).toBe(1);
  });

  it('delete(id, false) and purge() remove rows permanently', async () => {
    await seed([makeQuestion({ id: 'q-1' }), makeQuestion({ id: 'q-2', deletedAt: '2024-01-02T00:00:00.000Z' })]);
    await questionsRepo.delete('q-1', false);
    expect(store.has('q-1')).toBe(false);

    await questionsRepo.purge('q-2');
    expect(store.has('q-2')).toBe(false);
    expect(await questionsRepo.getTrashCount()).toBe(0);
  });

  it('restore() and bulkRestore() return trashed rows to the bank', async () => {
    await seed([
      makeQuestion({ id: 'q-1', deletedAt: '2024-01-01T00:00:00.000Z' }),
      makeQuestion({ id: 'q-2', deletedAt: '2024-01-02T00:00:00.000Z' }),
      makeQuestion({ id: 'q-3' }),
    ]);

    await questionsRepo.restore('q-1');
    expect(store.get('q-1')?.deletedAt).toBeUndefined();
    expect(store.get('q-1')?.metadata.version).toBe(2);

    const count = await questionsRepo.bulkRestore(['q-2', 'q-3', 'q-2', 'missing']);
    expect(count).toBe(1); // q-3 was never deleted; deduped/repeated q-2
    expect((await questionsRepo.getAll()).map(q => q.id).sort()).toEqual(['q-1', 'q-2', 'q-3']);
    expect(await questionsRepo.getTrashCount()).toBe(0);
  });

  it('bulkDelete(ids, false) permanently purges only the requested rows', async () => {
    await seed([
      makeQuestion({ id: 'q-1', deletedAt: '2024-01-01T00:00:00.000Z' }),
      makeQuestion({ id: 'q-2', deletedAt: '2024-01-02T00:00:00.000Z' }),
      makeQuestion({ id: 'q-3' }),
    ]);
    expect(await questionsRepo.bulkDelete(['q-1', 'q-2'], false)).toBe(2);
    expect([...store.keys()].sort()).toEqual(['q-3']);
  });

  it('purgeOlderThan(30) only removes trashed rows past the retention window', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed([
      makeQuestion({ id: 'old', deletedAt: new Date(now - 31 * day).toISOString() }),
      makeQuestion({ id: 'fresh', deletedAt: new Date(now - 2 * day).toISOString() }),
      makeQuestion({ id: 'active' }),
    ]);

    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(await questionsRepo.purgeOlderThan(TRASH_RETENTION_DAYS)).toBe(1);
    expect([...store.keys()].sort()).toEqual(['active', 'fresh']);
    expect(await questionsRepo.getTrashCount()).toBe(1);
  });

  it('purgeOlderThan() defaults to the shared retention window', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed([
      makeQuestion({ id: 'old', deletedAt: new Date(now - (TRASH_RETENTION_DAYS + 1) * day).toISOString() }),
      makeQuestion({ id: 'fresh', deletedAt: new Date(now - (TRASH_RETENTION_DAYS - 1) * day).toISOString() }),
    ]);

    expect(await questionsRepo.purgeOlderThan()).toBe(1);
    expect([...store.keys()]).toEqual(['fresh']);
  });
});

describe('questionsRepo mastery updates (phase 3 task 2)', () => {
  it('increases mastery on a correct answer and caps at level 3', async () => {
    await seed([makeQuestion({ statistics: { totalAttempts: 0, correctAttempts: 0, avgTimeMs: 0, masteryLevel: 2 } })]);

    await questionsRepo.updateMastery('q-1', true);
    expect((await questionsRepo.getById('q-1'))?.statistics.masteryLevel).toBe(3);
    await questionsRepo.updateMastery('q-1', true);
    expect((await questionsRepo.getById('q-1'))?.statistics.masteryLevel).toBe(3);
  });

  it('decreases mastery on a wrong answer and never drops below level 0', async () => {
    await seed([makeQuestion()]);

    await questionsRepo.updateMastery('q-1', false);
    const saved = (await questionsRepo.getById('q-1'))?.statistics;
    expect(saved?.masteryLevel).toBe(0);
    expect(saved?.totalAttempts).toBe(1);
    expect(saved?.correctAttempts).toBe(0);
  });
});

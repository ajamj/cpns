/**
 * Phase 2, Task 6 — validated JSON/CSV import, smart merge and Anki export.
 * Dexie is replaced with in-memory tables so repository paths can be tested in
 * the node-only vitest environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportData, Question } from '../../src/shared/types';
import { questionsToCSV } from '../../src/features/questions/bulk-operations';

const { store, sessions, attempts, flashcards } = vi.hoisted(() => ({
  store: new Map<string, Question>(),
  sessions: [] as unknown[],
  attempts: [] as unknown[],
  flashcards: [] as unknown[],
}));

vi.mock('../../src/db/schema', () => {
  function collection(rows: Question[]) {
    return { toArray: async () => rows.map(row => structuredClone(row)) };
  }
  const questions = {
    async toArray(): Promise<Question[]> { return Array.from(store.values()).map(q => structuredClone(q)); },
    async get(id: string): Promise<Question | undefined> {
      const q = store.get(id);
      return q ? structuredClone(q) : undefined;
    },
    async add(q: Question): Promise<string> {
      if (store.has(q.id)) throw new Error(`duplicate key: ${q.id}`);
      store.set(q.id, structuredClone(q));
      return q.id;
    },
    async bulkAdd(qs: Question[]): Promise<void> { for (const q of qs) await questions.add(q); },
    async put(q: Question): Promise<string> { store.set(q.id, structuredClone(q)); return q.id; },
    async bulkPut(qs: Question[]): Promise<void> { for (const q of qs) await questions.put(q); },
    async delete(id: string): Promise<void> { store.delete(id); },
    async bulkDelete(ids: string[]): Promise<void> { ids.forEach(id => store.delete(id)); },
    where(index: string) {
      return {
        equals(value: unknown) {
          return collection(Array.from(store.values()).filter(q =>
            (q as unknown as Record<string, unknown>)[index] === value));
        },
        anyOf(values: unknown[]) {
          return collection(Array.from(store.values()).filter(q =>
            values.includes((q as unknown as Record<string, unknown>)[index])));
        },
      };
    },
  };
  const bulkTable = (rows: unknown[]) => ({
    clear: async () => { rows.length = 0; },
    bulkAdd: async (items: unknown[]) => { rows.push(...items); },
    toArray: async () => [...rows],
  });
  return {
    db: {
      questions,
      sessions: bulkTable(sessions),
      attempts: bulkTable(attempts),
      flashcards: bulkTable(flashcards),
      settings: bulkTable([]),
      backups: { add: async () => 1, orderBy: () => ({ last: async () => undefined }) },
    },
  };
});

import { backupRepo } from '../../src/db/repositories/backup';
import { questionsRepo } from '../../src/db/repositories/questions';
import { generateApkg } from '../../src/features/import-export/anki';
import { detectConflicts } from '../../src/features/import-export/merge';
import { parseImportText, validateBackup } from '../../src/features/import-export/schema';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    topicCode: 'UM-01',
    stem: 'Apakah cuaca hari ini cerah?',
    options: [
      { id: 'o-a', text: 'Cerah', isCorrect: true },
      { id: 'o-b', text: 'Hujan', isCorrect: false },
      { id: 'o-c', text: 'Berkabut', isCorrect: false },
      { id: 'o-d', text: 'Badai', isCorrect: false },
      { id: 'o-e', text: 'Angin', isCorrect: false },
    ],
    correctAnswer: [0],
    explanation: 'Prakiraan BMKG menyatakan cerah.',
    difficulty: 2,
    source: 'BMKG 2024',
    tags: ['cuaca', 'prakiraan'],
    flags: { bookmarked: true, needsReview: false, disputed: false },
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
      version: 3,
      author: 'user',
    },
    statistics: { totalAttempts: 4, correctAttempts: 3, avgTimeMs: 1200, masteryLevel: 2 },
    ...overrides,
  };
}

function makeBackup(questions: Question[]): ExportData {
  return {
    schemaVersion: 1,
    exportedAt: '2024-03-01T00:00:00.000Z',
    appVersion: '1.0.0',
    data: { questions, sessions: [], attempts: [], flashcards: [], settings: [], kisiKisi: [] },
  };
}

beforeEach(() => {
  store.clear();
  sessions.length = 0;
  attempts.length = 0;
  flashcards.length = 0;
});

describe('import schema validation', () => {
  it('keeps full JSON fidelity including versions, flags and statistics', () => {
    const original = makeQuestion({
      versions: [makeQuestion({ stem: 'Versi lama', versions: undefined })],
    });
    const parsed = parseImportText(JSON.stringify(makeBackup([original])), 'backup.json');
    expect(parsed.issues).toEqual([]);
    expect(parsed.backup).toBeDefined();
    expect(parsed.questions[0]).toEqual(original);
  });

  it('reports invalid records with their location and refuses newer schema versions', () => {
    const invalid = makeQuestion({ id: '', stem: '', difficulty: 9 as unknown as Question['difficulty'] });
    const parsed = parseImportText(JSON.stringify([invalid]), 'questions.json');
    expect(parsed.questions).toHaveLength(0);
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.issues[0]?.path).toContain('questions[0]');

    const future = makeBackup([]);
    expect(validateBackup({ ...future, schemaVersion: 99 }).issues[0]?.path)
      .toBe('backup.schemaVersion');
  });

  it('caps oversized arrays and rejects malformed CSV headers', () => {
    const many = Array.from({ length: 2001 }, (_, index) => makeQuestion({ id: `q-${index}` }));
    expect(parseImportText(JSON.stringify(many), 'many.json').issues[0]?.message)
      .toContain('2000');
    expect(parseImportText('foo,bar\n1,2', 'bad.csv').issues[0]?.message)
      .toContain('kolom wajib hilang');
  });

  it('accepts bundled seed files with their legacy topic and author codes', () => {
    const result = parseImportText(
      JSON.stringify({ questions: [makeQuestion({ topicCode: 'TK-01' as unknown as Question['topicCode'] })] }),
      'seed.json'
    );
    expect(result.issues).toEqual([]);
    expect(result.questions).toHaveLength(1);
  });
});

describe('CSV roundtrip', () => {
  it('preserves option E as the correct answer and flag columns', async () => {
    const question = makeQuestion({
      id: 'csv-e',
      correctAnswer: [4],
      stem: 'Pilih jawaban kelima, dengan koma,\ndan tanda kutip "A".',
      options: makeQuestion().options.map((option, index) => ({ ...option, isCorrect: index === 4 })),
    });
    const csv = questionsToCSV([question]);
    const parsed = parseImportText(csv, 'questions.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.questions[0]).toMatchObject({
      id: 'csv-e',
      stem: question.stem,
      correctAnswer: [4],
      difficulty: 2,
      source: 'BMKG 2024',
      tags: ['cuaca', 'prakiraan'],
      explanation: question.explanation,
      flags: question.flags,
    });
    expect(parsed.questions[0]?.options.map(option => option.isCorrect))
      .toEqual([false, false, false, false, true]);

    // The repository wrapper uses the same validated parser.
    expect(await backupRepo.importFromCSV(csv)).toHaveLength(1);
  });

  it('roundtrips metadata, statistics, version snapshots and option ids', () => {
    const original = makeQuestion({
      statistics: {
        totalAttempts: 4,
        correctAttempts: 3,
        avgTimeMs: 1250.5,
        lastAttemptedAt: '2024-02-02T00:00:00.000Z',
        masteryLevel: 2,
      },
      versions: [makeQuestion({ id: 'q-1-prev', stem: 'Versi lama', versions: undefined })],
      deletedAt: '2024-04-01T00:00:00.000Z',
    });
    const parsed = parseImportText(questionsToCSV([original]), 'questions.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.questions[0]).toEqual(original);
  });

  it('accepts semicolon-separated multi-select answers from the analytics CSV', () => {
    const csv = [
      'id,topicCode,stem,optionA,optionB,correctAnswer,difficulty',
      'multi,UM-01,Pilih dua,A,B,"A;B",2',
    ].join('\n');
    const parsed = parseImportText(csv, 'answers.csv');
    expect(parsed.issues).toEqual([]);
    expect(parsed.questions[0]?.correctAnswer).toEqual([0, 1]);
  });
});

describe('smart merge preview', () => {
  it('detects exact-ID and >90% stem conflicts separately', () => {
    const existing = [makeQuestion()];
    const incoming = [
      makeQuestion({ stem: 'Versi baru dari soal yang sama' }),
      makeQuestion({ id: 'q-near', stem: 'Apakah cuaca hari ini cerah??' }),
    ];
    const conflicts = detectConflicts(incoming, existing);
    expect(conflicts.map(conflict => conflict.kind)).toEqual(['id', 'similar-stem']);
    expect(conflicts[1]?.similarity).toBeGreaterThan(0.9);
  });

  it('applies per-question strategy overrides chosen in the preview modal', async () => {
    store.set('q-1', makeQuestion({ stem: 'Stem lama' }));
    const incoming = [
      makeQuestion({ stem: 'Stem baru' }),
      makeQuestion({ id: 'q-2', stem: 'Soal baru' }),
    ];
    const result = await questionsRepo.importQuestions(incoming, 'skip', question =>
      question.id === 'q-1' ? 'overwrite' : undefined);
    expect(result).toMatchObject({ imported: 2, skipped: 0 });
    expect((await questionsRepo.getById('q-1'))?.stem).toBe('Stem baru');
    expect(await questionsRepo.getById('q-2')).toBeDefined();
  });

  it('reports skips and smart-merge conflicts as warnings rather than errors', async () => {
    store.set('q-1', makeQuestion());
    const result = await backupRepo.restoreBackup(
      makeBackup([makeQuestion({ stem: 'Stem baru' }), makeQuestion({ id: 'q-2' })]),
      { mergeStrategy: 'smart' }
    );
    expect(result.restored).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('konflik');
  });

  it('does not clear progress tables when importing questions only', async () => {
    sessions.push({ id: 'session-1' });
    const questionOnly = {
      ...makeBackup([makeQuestion()]),
      data: { questions: [makeQuestion()] },
    } as unknown as ExportData;
    await backupRepo.restoreBackup(questionOnly, { mergeStrategy: 'smart' });
    expect(sessions).toHaveLength(1);
  });
});

describe('Anki package', () => {
  it('writes an uncompressed ZIP with a SQLite collection and media map', () => {
    const apkg = generateApkg([makeQuestion(), makeQuestion({ id: 'q-2', topicCode: 'KH-03' })]);
    const view = new DataView(apkg.buffer, apkg.byteOffset, apkg.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
    const text = new TextDecoder().decode(apkg);
    expect(text).toContain('collection.anki2');
    expect(text).toContain('media');
    const dataOffset = 30 + 'collection.anki2'.length;
    const sqliteHeader = new TextDecoder().decode(apkg.subarray(dataOffset, dataOffset + 16));
    expect(sqliteHeader).toBe('SQLite format 3\0');
    const end = apkg.subarray(apkg.length - 22);
    expect(new DataView(end.buffer, end.byteOffset, end.byteLength).getUint32(0, true))
      .toBe(0x06054b50); // end of central directory
  });

  it('refuses an empty export', () => {
    expect(() => generateApkg([])).toThrow(/Tidak ada soal/);
  });
});

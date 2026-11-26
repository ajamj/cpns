/**
 * Import validation (Phase 2, Task 6 / threat T-05-01).
 *
 * Every externally supplied record is checked with Zod before anything is
 * written to IndexedDB. Array lengths are capped at the documented stress
 * envelope so a hostile file cannot exhaust browser memory.
 */
import { z } from 'zod';
import { APP_CONFIG } from '../../core/config';
import { parseCSV } from '../../core/utils';
import type { ExportData, Question, TopicCode } from '../../shared/types';

export const IMPORT_LIMITS = {
  questions: 2000,
  sessions: 500,
  attempts: 10000,
  flashcards: 2000,
  settings: 200,
  kisiKisi: 100,
  versions: 5,
} as const;

export interface ImportIssue {
  /** Human-readable location, e.g. `questions[3].stem` or `CSV baris 4`. */
  path: string;
  message: string;
}

export interface ImportParseResult {
  format: 'json' | 'csv';
  questions: Question[];
  /** Present for a full JSON backup; used by ImportView to restore other tables. */
  backup?: ExportData;
  issues: ImportIssue[];
}

const optionSchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().max(20000),
  isCorrect: z.boolean(),
});

const flagsSchema = z.object({
  bookmarked: z.boolean(),
  needsReview: z.boolean(),
  disputed: z.boolean(),
});

const metadataSchema = z.object({
  createdAt: z.string().min(1).max(100),
  updatedAt: z.string().min(1).max(100),
  version: z.number().int().min(0).max(100000),
  // Seed files use `curriculum`; older exports use `user`/`import`.
  author: z.string().max(100),
});

const statisticsSchema = z.object({
  totalAttempts: z.number().int().min(0),
  correctAttempts: z.number().int().min(0),
  avgTimeMs: z.number().min(0),
  lastAttemptedAt: z.string().max(100).optional(),
  masteryLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  // Optional aggregate fields (total/mastered/...) survive a JSON roundtrip.
}).passthrough();

/** Recursive because every question may carry up to five version snapshots. */
const questionSchema: z.ZodTypeAny = z.lazy(() => z.object({
  id: z.string().min(1, 'id wajib diisi').max(200),
  // UM-/KH- are BMKG topics; TK-/TIU-/TKP- come from bundled seed files.
  topicCode: z.string().regex(/^[A-Z]{2,5}-\d{2,3}$/, 'kode topik tidak valid'),
  stem: z.string().min(1, 'stem wajib diisi').max(20000),
  options: z.array(optionSchema).min(2, 'minimal 2 opsi').max(6, 'maksimal 6 opsi'),
  correctAnswer: z.array(z.number().int().min(0).max(5)).min(1, 'minimal 1 jawaban benar').max(6),
  explanation: z.string().max(50000).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  source: z.string().max(500).optional(),
  tags: z.array(z.string().max(200)).max(50).default([]),
  flags: flagsSchema.default({ bookmarked: false, needsReview: false, disputed: false }),
  metadata: metadataSchema.default({
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    author: 'import',
  }),
  statistics: statisticsSchema.default({
    totalAttempts: 0,
    correctAttempts: 0,
    avgTimeMs: 0,
    masteryLevel: 0,
  }),
  versions: z.array(questionSchema).max(IMPORT_LIMITS.versions).optional(),
  deletedAt: z.string().max(100).optional(),
}).superRefine((question, ctx) => {
  const indices = new Set<number>();
  for (const index of question.correctAnswer as number[]) {
    if (index >= (question.options as unknown[]).length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correctAnswer'], message: 'indeks jawaban di luar rentang opsi' });
    }
    if (indices.has(index)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correctAnswer'], message: 'indeks jawaban duplikat' });
    }
    indices.add(index);
  }
  const marked = (question.options as Array<{ isCorrect: boolean }>)
    .map((option, index) => option.isCorrect ? index : -1)
    .filter(index => index >= 0);
  if (marked.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'minimal 1 opsi ditandai benar' });
  }
}));

// Other tables keep their original shape (`.passthrough`) but critical fields
// are still type-checked before any bulk write.
const sessionSchema = z.object({
  id: z.string().min(1),
  mode: z.string(),
  startedAt: z.string().min(1),
  topicCodes: z.array(z.string()).default([]),
}).passthrough();

const attemptSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  isCorrect: z.boolean(),
  timestamp: z.string().min(1),
}).passthrough();

const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string(),
  back: z.string(),
}).passthrough();

const settingSchema = z.object({ key: z.string().min(1) }).passthrough();
const kisiKisiSchema = z.object({ code: z.string().min(1), title: z.string().optional() }).passthrough();

const backupShapeSchema = z.object({
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string().min(1).max(100),
  appVersion: z.string().max(100).default('1.0.0'),
  data: z.object({
    questions: z.array(z.unknown()).max(IMPORT_LIMITS.questions).default([]),
    sessions: z.array(sessionSchema).max(IMPORT_LIMITS.sessions).default([]),
    attempts: z.array(attemptSchema).max(IMPORT_LIMITS.attempts).default([]),
    flashcards: z.array(flashcardSchema).max(IMPORT_LIMITS.flashcards).default([]),
    settings: z.array(settingSchema).max(IMPORT_LIMITS.settings).default([]),
    kisiKisi: z.array(kisiKisiSchema).max(IMPORT_LIMITS.kisiKisi).default([]),
  }),
});

function zodIssues(error: z.ZodError, prefix: string): ImportIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.length ? `${prefix}.${issue.path.join('.')}` : prefix,
    message: issue.message,
  }));
}

/** Validate a whole backup envelope before restoreBackup writes anything. */
export function validateBackup(value: unknown): { backup?: ExportData; issues: ImportIssue[] } {
  const envelope = backupShapeSchema.safeParse(value);
  if (!envelope.success) return { issues: zodIssues(envelope.error, 'backup') };

  if (envelope.data.schemaVersion > APP_CONFIG.schemaVersion) {
    return { issues: [{ path: 'backup.schemaVersion', message: `versi skema ${envelope.data.schemaVersion} lebih baru dari aplikasi (${APP_CONFIG.schemaVersion})` }] };
  }

  const questions: Question[] = [];
  const issues: ImportIssue[] = [];
  envelope.data.data.questions.forEach((raw, index) => {
    const parsed = questionSchema.safeParse(raw);
    if (parsed.success) questions.push(parsed.data as Question);
    else issues.push(...zodIssues(parsed.error, `questions[${index}]`));
  });

  if (issues.length) return { issues };

  return {
    backup: {
      ...(value as ExportData),
      ...envelope.data,
      data: { ...envelope.data.data, questions },
    } as unknown as ExportData,
    issues: [],
  };
}

/** Read an optional CSV number; malformed values fail the row instead of silently resetting it. */
function csvNumber(
  raw: string | undefined,
  location: string,
  field: string,
  fallback: number,
  min: number,
  max: number,
  integer = true
): number {
  const text = (raw ?? '').trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new Error(`${location}: ${field} tidak valid`);
  }
  return value;
}

/** Convert one CSV row into a Question, preserving option letters A–E. */
export function csvRowToQuestion(row: Record<string, string>, location: string): Question {
  // Map letters against the five raw columns *before* empty options are
  // dropped, otherwise an answer in column E would shift to another index.
  const rawOptions = ['A', 'B', 'C', 'D', 'E']
    .map(letter => (row[`option${letter}`] ?? '').trim());
  const rawOptionIds = (row.optionIds ?? '').split(';').map(id => id.trim());
  // Both separators occur in the wild: the SRS uses commas, the analytics CSV
  // export uses semicolons for multi-select answers.
  const correctLetters = (row.correctAnswer ?? '')
    .split(/[,;]/)
    .map(letter => letter.trim().toUpperCase())
    .filter(Boolean);
  const correctAnswer = correctLetters.map(letter => letter.charCodeAt(0) - 65);

  const timestamp = new Date().toISOString();
  const candidate: Question = {
    id: (row.id ?? '').trim() || crypto.randomUUID(),
    topicCode: (row.topicCode ?? '').trim() as TopicCode,
    stem: (row.stem ?? '').trim(),
    options: rawOptions
      .map((text, index) => ({
        id: rawOptionIds[index] || `csv-${index}`,
        text,
        isCorrect: correctAnswer.includes(index),
      }))
      .filter(option => option.text.length > 0),
    correctAnswer,
    explanation: row.explanation?.trim() || undefined,
    difficulty: csvNumber(row.difficulty, location, 'difficulty', 2, 1, 3) as Question['difficulty'],
    source: row.source?.trim() || undefined,
    tags: (row.tags ?? '').split(';').map(tag => tag.trim()).filter(Boolean),
    flags: {
      bookmarked: row.bookmarked === 'true',
      needsReview: row.needsReview === 'true',
      disputed: row.disputed === 'true',
    },
    metadata: {
      createdAt: row['metadata.createdAt']?.trim() || timestamp,
      updatedAt: row['metadata.updatedAt']?.trim() || timestamp,
      version: csvNumber(row['metadata.version'], location, 'metadata.version', 1, 0, 100000),
      author: (row['metadata.author']?.trim() || 'import') as Question['metadata']['author'],
    },
    statistics: {
      totalAttempts: csvNumber(row['statistics.totalAttempts'], location, 'statistics.totalAttempts', 0, 0, Number.MAX_SAFE_INTEGER),
      correctAttempts: csvNumber(row['statistics.correctAttempts'], location, 'statistics.correctAttempts', 0, 0, Number.MAX_SAFE_INTEGER),
      avgTimeMs: csvNumber(row['statistics.avgTimeMs'], location, 'statistics.avgTimeMs', 0, 0, Number.MAX_SAFE_INTEGER, false),
      lastAttemptedAt: row['statistics.lastAttemptedAt']?.trim() || undefined,
      masteryLevel: csvNumber(row['statistics.masteryLevel'], location, 'statistics.masteryLevel', 0, 0, 3) as Question['statistics']['masteryLevel'],
    },
  };

  const rawVersions = (row.versions ?? '').trim();
  if (rawVersions) {
    let snapshots: unknown;
    try {
      snapshots = JSON.parse(rawVersions);
    } catch {
      throw new Error(`${location}: versions bukan JSON yang valid`);
    }
    if (!Array.isArray(snapshots)) throw new Error(`${location}: versions harus berupa array`);
    candidate.versions = snapshots as Question[];
  }
  const deletedAt = (row.deletedAt ?? '').trim();
  if (deletedAt) candidate.deletedAt = deletedAt;

  const parsed = questionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`${location}: ${zodIssues(parsed.error, 'soal').map(i => i.message).join('; ')}`);
  }
  return parsed.data as Question;
}

function parseCSVImport(text: string): ImportParseResult {
  const rows = parseCSV(text).filter(row => row.some(cell => cell.trim() !== ''));
  if (rows.length < 2) {
    return { format: 'csv', questions: [], issues: [{ path: 'CSV', message: 'CSV harus memiliki header dan minimal 1 baris data' }] };
  }
  const headers = (rows[0] ?? []).map(header => header.trim());
  const required = ['id', 'topicCode', 'stem', 'optionA', 'optionB', 'correctAnswer'];
  const missing = required.filter(column => !headers.includes(column));
  if (missing.length) {
    return { format: 'csv', questions: [], issues: [{ path: 'CSV header', message: `kolom wajib hilang: ${missing.join(', ')}` }] };
  }
  if (rows.length - 1 > IMPORT_LIMITS.questions) {
    return { format: 'csv', questions: [], issues: [{ path: 'CSV', message: `maksimal ${IMPORT_LIMITS.questions} soal per impor` }] };
  }

  const questions: Question[] = [];
  const issues: ImportIssue[] = [];
  rows.slice(1).forEach((row, index) => {
    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) record[header] = (row[column] ?? '').trim();
    });
    try {
      questions.push(csvRowToQuestion(record, `CSV baris ${index + 2}`));
    } catch (error) {
      issues.push({ path: `CSV baris ${index + 2}`, message: error instanceof Error ? error.message : 'baris tidak valid' });
    }
  });
  return { format: 'csv', questions, issues };
}

/** Detect JSON vs CSV and validate every record before the caller writes. */
export function parseImportText(text: string, fileName = ''): ImportParseResult {
  const trimmed = text.trim();
  const looksLikeJSON = fileName.toLowerCase().endsWith('.json') ||
    trimmed.startsWith('{') || trimmed.startsWith('[');

  if (!looksLikeJSON) return parseCSVImport(text);
  if (!trimmed) {
    return { format: 'json', questions: [], issues: [{ path: 'file', message: 'file JSON kosong' }] };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    return { format: 'json', questions: [], issues: [{ path: 'JSON', message: error instanceof Error ? error.message : 'JSON tidak valid' }] };
  }

  const isBackup = !!value && typeof value === 'object' && !Array.isArray(value) &&
    'data' in value && !!((value as { data?: unknown }).data);
  if (isBackup) {
    const result = validateBackup(value);
    if (result.issues.length) return { format: 'json', questions: [], issues: result.issues };
    return { format: 'json', questions: result.backup!.data.questions, backup: result.backup, issues: [] };
  }

  const questionsRaw = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && 'questions' in value
        ? (value as { questions?: unknown }).questions
        : undefined);
  if (!Array.isArray(questionsRaw)) {
    return { format: 'json', questions: [], issues: [{ path: 'JSON', message: 'format JSON tidak dikenali (array soal atau backup)' }] };
  }
  if (questionsRaw.length > IMPORT_LIMITS.questions) {
    return { format: 'json', questions: [], issues: [{ path: 'questions', message: `maksimal ${IMPORT_LIMITS.questions} soal per impor` }] };
  }

  const questions: Question[] = [];
  const issues: ImportIssue[] = [];
  questionsRaw.forEach((raw, index) => {
    const parsed = questionSchema.safeParse(raw);
    if (parsed.success) questions.push(parsed.data as Question);
    else issues.push(...zodIssues(parsed.error, `questions[${index}]`));
  });
  return { format: 'json', questions, issues };
}

#!/usr/bin/env node
/**
 * Deterministic bulk-data seeder for Phase 5 final QA (REQUIREMENTS §4.1).
 *
 * The spec in tests/e2e/final-qa.spec.ts imports these helpers and injects the
 * *real* src/db/repositories modules into the running page (bundled with the
 * esbuild copy that ships with Vite), so the 2000/500/10000 stress envelope is
 * written through the same Dexie repositories the application uses. No new npm
 * dependency and no production debug hook are needed.
 *
 * Usage from Playwright:
 *   import { bulkSeed, createStressFixture } from '../../scripts/stress-seed.mjs';
 *   await bulkSeed(page, createStressFixture());
 *
 * Running this file directly prints the generated fixture shape.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const STRESS_COUNTS = Object.freeze({
  questions: 2000,
  sessions: 500,
  attempts: 10000,
  flashcards: 0,
  settings: 0,
});

const TOPIC_CODES = [
  'UM-01', 'UM-02', 'UM-03', 'UM-04', 'UM-05',
  'UM-06', 'UM-07', 'UM-08', 'UM-09',
  'KH-01', 'KH-02', 'KH-03', 'KH-04', 'KH-05',
  'KH-06', 'KH-07', 'KH-08', 'KH-09', 'KH-10',
  'KH-11', 'KH-12',
];

const FIXTURE_TIME = '2024-06-01T00:00:00.000Z';
const ATTEMPTS_PER_SESSION = STRESS_COUNTS.attempts / STRESS_COUNTS.sessions; // 20

let repositoryBundlePromise;

/** Bundle the existing Dexie repository barrel once for all injected pages. */
function repositoryBundle() {
  if (!repositoryBundlePromise) {
    repositoryBundlePromise = build({
      entryPoints: [path.join(ROOT, 'src/db/repositories/index.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__CPNS_REPOS__',
      platform: 'browser',
      target: 'es2022',
      alias: {
        '@': path.join(ROOT, 'src'),
        '@shared': path.join(ROOT, 'src/shared'),
        '@features': path.join(ROOT, 'src/features'),
        '@core': path.join(ROOT, 'src/core'),
        '@db': path.join(ROOT, 'src/db'),
      },
      logLevel: 'silent',
    }).then((result) => {
      const output = result.outputFiles?.[0];
      if (!output) throw new Error('esbuild produced no repository bundle');
      return output.text;
    });
  }
  return repositoryBundlePromise;
}

/** Make the application's repositories available inside a Playwright page. */
export async function injectRepositories(page) {
  await page.addScriptTag({ content: await repositoryBundle() });
  await page.waitForFunction(() => Boolean(window.__CPNS_REPOS__?.db), null, { timeout: 20_000 });
}

/**
 * Build the deterministic stress fixture. Every id and timestamp is derived
 * from an index, so repeated runs produce byte-identical records.
 */
export function createStressFixture() {
  const questions = Array.from({ length: STRESS_COUNTS.questions }, (_, index) => {
    const n = index + 1;
    const correctIndex = n % 5;
    return {
      id: `stress-q-${String(n).padStart(4, '0')}`,
      topicCode: TOPIC_CODES[index % TOPIC_CODES.length],
      stem:
        n === 1235
          ? 'STRESS-PROBE-1234: soal penanda untuk pengukuran latency pencarian.'
          : `Soal stress ${n}: jelaskan konsep meteorologi dasar nomor ${n}?`,
      options: Array.from({ length: 5 }, (_, optionIndex) => ({
        id: `stress-q-${n}-o${optionIndex}`,
        text: `Opsi ${optionIndex + 1} untuk soal ${n}`,
        isCorrect: optionIndex === correctIndex,
      })),
      correctAnswer: [correctIndex],
      explanation: `Penjelasan deterministik untuk soal stress ${n}.`,
      difficulty: (index % 3) + 1,
      source: 'stress-seed',
      tags: ['stress', `batch-${n % 10}`],
      flags: { bookmarked: false, needsReview: false, disputed: false },
      metadata: {
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
        version: 1,
        author: 'import',
      },
      statistics: {
        totalAttempts: 0,
        correctAttempts: 0,
        avgTimeMs: 0,
        masteryLevel: 0,
      },
    };
  });

  const sessions = Array.from({ length: STRESS_COUNTS.sessions }, (_, index) => {
    const n = index + 1;
    return {
      id: `stress-s-${String(n).padStart(4, '0')}`,
      mode: index % 5 === 0 ? 'mock-exam' : 'practice',
      startedAt: FIXTURE_TIME,
      completedAt: FIXTURE_TIME,
      config: { questionCount: ATTEMPTS_PER_SESSION, showExplanationImmediately: true },
      topicCodes: [TOPIC_CODES[index % TOPIC_CODES.length]],
      summary: {
        totalQuestions: ATTEMPTS_PER_SESSION,
        answeredQuestions: ATTEMPTS_PER_SESSION,
        correctAnswers: ATTEMPTS_PER_SESSION / 2,
        scorePercent: 50,
        timeSpentMs: 600000,
        perTopic: {},
      },
    };
  });

  // attempts has a composite primary key [sessionId, questionId]; 500 x 20
  // distinct pairs gives exactly 10000 rows without collisions.
  const attempts = Array.from({ length: STRESS_COUNTS.attempts }, (_, index) => {
    const sessionIndex = Math.floor(index / ATTEMPTS_PER_SESSION);
    const questionIndex = (sessionIndex * ATTEMPTS_PER_SESSION + (index % ATTEMPTS_PER_SESSION)) % STRESS_COUNTS.questions;
    return {
      sessionId: `stress-s-${String(sessionIndex + 1).padStart(4, '0')}`,
      questionId: `stress-q-${String(questionIndex + 1).padStart(4, '0')}`,
      userAnswer: [index % 5],
      isCorrect: index % 2 === 0,
      timeMs: 1000 + (index % 5000),
      timestamp: FIXTURE_TIME,
      flagged: false,
      markedForReview: false,
    };
  });

  return { questions, sessions, attempts, flashcards: [], settings: [] };
}

/**
 * Clear the study tables and write a fixture through the real repositories.
 * The returned counts are read back from Dexie so callers can assert them.
 */
export async function bulkSeed(page, fixture) {
  await injectRepositories(page);
  return page.evaluate(async (data) => {
    const repos = window.__CPNS_REPOS__;
    const { db, questionsRepo, attemptsRepo, flashcardsRepo } = repos;
    if (!db || !questionsRepo || !attemptsRepo || !flashcardsRepo) {
      throw new Error('Dexie repositories were not injected into the page');
    }

    await Promise.all([
      db.questions.clear(),
      db.sessions.clear(),
      db.attempts.clear(),
      db.flashcards.clear(),
      db.settings.clear(),
      db.backups.clear(),
    ]);

    if (data.questions?.length) await questionsRepo.bulkAdd(data.questions);
    if (data.sessions?.length) await db.sessions.bulkAdd(data.sessions);
    if (data.attempts?.length) await attemptsRepo.bulkAdd(data.attempts);
    if (data.flashcards?.length) await flashcardsRepo.bulkPut(data.flashcards);
    if (data.settings?.length) await db.settings.bulkPut(data.settings);

    return {
      questions: await db.questions.count(),
      sessions: await db.sessions.count(),
      attempts: await db.attempts.count(),
      flashcards: await db.flashcards.count(),
      settings: await db.settings.count(),
    };
  }, fixture);
}

/** Empty every Dexie table plus the localStorage settings mirror. */
export async function clearStudyData(page) {
  await injectRepositories(page);
  return page.evaluate(async () => {
    const db = window.__CPNS_REPOS__?.db;
    if (!db) throw new Error('Dexie repositories were not injected into the page');
    await Promise.all([
      db.questions.clear(),
      db.sessions.clear(),
      db.attempts.clear(),
      db.flashcards.clear(),
      db.settings.clear(),
      db.backups.clear(),
    ]);
    localStorage.clear();
    return {
      questions: await db.questions.count(),
      sessions: await db.sessions.count(),
      attempts: await db.attempts.count(),
      flashcards: await db.flashcards.count(),
      settings: await db.settings.count(),
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = createStressFixture();
  console.log(
    `Stress fixture: ${fixture.questions.length} questions, ${fixture.sessions.length} sessions, ` +
      `${fixture.attempts.length} attempts (${new Set(fixture.attempts.map((a) => `${a.sessionId}:${a.questionId}`)).size} unique keys).`
  );
}

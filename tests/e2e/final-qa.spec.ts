import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from 'playwright/test';
import {
  STRESS_COUNTS,
  bulkSeed,
  clearStudyData,
  createStressFixture,
} from '../../scripts/stress-seed.mjs';

const ORIGIN = 'http://127.0.0.1:4173';
const DB_NAME = 'cpns-bmgk-db';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

type RecordLike = Record<string, any>;
type RequestFailure = { url: string; error: string };
type NetworkLog = { requests: string[]; failures: RequestFailure[] };

type ExportedBackup = {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: {
    questions: RecordLike[];
    sessions: RecordLike[];
    attempts: RecordLike[];
    flashcards: RecordLike[];
    settings: RecordLike[];
    kisiKisi: RecordLike[];
  };
};

type StressMetrics = {
  questions: number;
  sessions: number;
  attempts: number;
  dashboardMs: number;
  searchMs: number;
  examStartMs: number;
  unhandledErrors: string[];
};

/** Browser-initiated connectivity probes are expected while offline. */
function isExpectedOfflineProbe(url: string): boolean {
  const pathname = new URL(url).pathname;
  return pathname === '/favicon.ico' || pathname === '/sw.js';
}

function trackNetwork(page: Page): NetworkLog {
  const log: NetworkLog = { requests: [], failures: [] };
  page.on('request', (request) => log.requests.push(request.url()));
  page.on('requestfailed', (request) => {
    log.failures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' });
  });
  return log;
}

function externalRequests(requests: string[]): string[] {
  return requests.filter((url) => {
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !LOCAL_HOSTS.has(parsed.hostname)
      );
    } catch {
      return false;
    }
  });
}

function assertLocalOnly(log: NetworkLog, offlineFailures: RequestFailure[] = []): void {
  expect(externalRequests(log.requests), `external requests: ${externalRequests(log.requests).join(', ')}`).toEqual([]);
  const unexpected = offlineFailures.filter((failure) => !isExpectedOfflineProbe(failure.url));
  expect(unexpected, `unexpected offline request failures: ${JSON.stringify(unexpected)}`).toEqual([]);
}

/** Read a Dexie table through raw IndexedDB so assertions stay app-agnostic. */
async function readTable<T extends RecordLike = RecordLike>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains(storeName)) {
            database.close();
            resolve([]);
            return;
          }
          const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = () => {
            resolve(request.result as T[]);
            database.close();
          };
          request.onerror = () => reject(request.error);
        };
      }),
    { dbName: DB_NAME, storeName: store }
  );
}

async function tableCount(page: Page, store: string): Promise<number> {
  return (await readTable(page, store)).length;
}

async function translate(page: Page, key: string): Promise<string> {
  return page.evaluate(
    (translationKey) => (window as any).app.t(translationKey) as string,
    key
  );
}

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = (window as any).app;
      return typeof app === 'object' && app !== null && (document.getElementById('app')?.children.length ?? 0) > 0;
    },
    null,
    { timeout: 30_000 }
  );
  // The router sets the document title once initApp has finished booting.
  await page.waitForFunction(() => document.title !== 'CPNS BMKG SKB Prep', null, { timeout: 30_000 });
}

async function waitForSeededQuestions(page: Page, minimum = 1): Promise<void> {
  await expect
    .poll(() => tableCount(page, 'questions'), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(minimum);
}

async function waitForInstalledApp(page: Page): Promise<void> {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 25_000 });
  const precached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.includes('workbox-precache'));
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  expect(precached).toContain('/index.html');
  expect(precached).toContain('/seed-questions.json');
  expect(precached).toContain('/kisi-kisi.json');
}

async function goToHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
}

async function downloadBackup(page: Page): Promise<ExportedBackup> {
  await goToHash(page, '#/export');
  await expect(page.locator('#btnExportFull')).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('#btnExportFull').click(),
  ]);
  const filePath = await download.path();
  expect(filePath, 'full backup must produce a download').toBeTruthy();
  return JSON.parse(await readFile(filePath!, 'utf8')) as ExportedBackup;
}

function sorted(rows: RecordLike[]): RecordLike[] {
  const keyOf = (row: RecordLike): string =>
    String(row.id ?? row.key ?? `${row.sessionId}:${row.questionId}`);
  return rows.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** Deterministic, hand-checked fixture for the export → clear → import path. */
function createIntegrityFixture() {
  const stamp = (seconds: number) => new Date(Date.UTC(2024, 0, 1, 0, 0, seconds)).toISOString();
  const questions = [1, 2, 3].map((n) => ({
    id: `fx-q-${n}`,
    topicCode: n === 2 ? 'KH-03' : 'UM-01',
    stem: `Integrity fixture question ${n}`,
    options: [0, 1, 2, 3].map((i) => ({
      id: `fx-q-${n}-o${i}`,
      text: `Option ${i} of fixture question ${n}`,
      isCorrect: i === n % 4,
    })),
    correctAnswer: [n % 4],
    explanation: `Deterministic explanation ${n}`,
    difficulty: n,
    source: 'final-qa-fixture',
    tags: ['fixture', `set-${n}`],
    flags: { bookmarked: n === 1, needsReview: false, disputed: false },
    metadata: { createdAt: stamp(n), updatedAt: stamp(n), version: 1, author: 'import' },
    statistics: { totalAttempts: n, correctAttempts: 1, avgTimeMs: n * 100, masteryLevel: n - 1 },
  }));
  const sessions = [1, 2].map((n) => ({
    id: `fx-s-${n}`,
    mode: n === 1 ? 'practice' : 'mock-exam',
    startedAt: stamp(100 + n),
    completedAt: stamp(200 + n),
    config: { questionCount: 2, showExplanationImmediately: true },
    topicCodes: [n === 2 ? 'KH-03' : 'UM-01'],
    summary: {
      totalQuestions: 2,
      answeredQuestions: 2,
      correctAnswers: 1,
      scorePercent: 50,
      timeSpentMs: 60000,
      perTopic: {},
    },
  }));
  const attempts = [
    { sessionId: 'fx-s-1', questionId: 'fx-q-1', userAnswer: [1], isCorrect: true, timeMs: 1200, timestamp: stamp(301), flagged: false, markedForReview: false },
    { sessionId: 'fx-s-1', questionId: 'fx-q-2', userAnswer: [2], isCorrect: false, timeMs: 2400, timestamp: stamp(302), flagged: true, markedForReview: false },
    { sessionId: 'fx-s-2', questionId: 'fx-q-2', userAnswer: [2], isCorrect: false, timeMs: 3000, timestamp: stamp(303), flagged: false, markedForReview: true },
    { sessionId: 'fx-s-2', questionId: 'fx-q-3', userAnswer: [3], isCorrect: true, timeMs: 4200, timestamp: stamp(304), flagged: false, markedForReview: false },
  ];
  const flashcards = [1, 2].map((n) => ({
    id: `fx-f-${n}`,
    questionId: `fx-q-${n}`,
    front: `Fixture front ${n}`,
    back: `Fixture back ${n}`,
    type: 'qa',
    dueDate: '2024-06-01',
    interval: n * 6,
    easeFactor: 2.5,
    reps: n,
    lapses: 0,
    createdAt: stamp(400 + n),
    updatedAt: stamp(400 + n),
  }));
  const settings = [
    { key: 'language', value: 'en' },
    { key: 'fontScale', value: 1.2 },
    { key: 'reducedMotion', value: true },
    { key: 'highContrast', value: false },
  ];
  return { questions, sessions, attempts, flashcards, settings };
}

async function waitForRendered(page: Page, selector: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    ({ css }) => {
      const element = document.querySelector(css);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    { css: selector },
    { timeout }
  );
}

test.describe('Phase 5 final QA', () => {
  test.describe.configure({ timeout: 240_000 });

  test('offline full session: install, answer 10, review and export locally', async ({ page, context }) => {
    const network = trackNetwork(page);

    // ---- Online: install the precaching service worker -------------------
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
    await waitForBoot(page);
    const swReady = await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready.then((registration) => ({ ok: true, scope: registration.scope })),
        new Promise<{ ok: boolean; scope: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, scope: '' }), 10_000)
        ),
      ])
    );
    expect(swReady.ok, 'navigator.serviceWorker.ready must resolve').toBe(true);
    expect(swReady.scope).toContain(ORIGIN);
    await waitForInstalledApp(page);
    await waitForSeededQuestions(page, 10);

    // ---- Offline: complete the whole study session ----------------------
    const failuresBeforeOffline = network.failures.length;
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);

    await goToHash(page, '#/practice');
    await expect(page.locator('#btnStartPractice')).toBeVisible({ timeout: 30_000 });
    await page.locator('#questionCount').selectOption('10');
    await page.locator('#btnStartPractice').click();
    await expect(page.locator('.practice-option:not([disabled])').first()).toBeVisible({ timeout: 30_000 });

    for (let answered = 0; answered < 10; answered += 1) {
      await page.locator('.practice-option:not([disabled])').first().click();
      await expect.poll(() => tableCount(page, 'attempts'), { timeout: 15_000 }).toBe(answered + 1);
      if (answered < 9) await page.locator('#btnNext').click();
    }

    await expect(page.locator('#btnFinish')).toBeVisible();
    await page.locator('#btnFinish').click();
    await expect(page.locator('.practice-view .page-title')).toHaveText(
      await translate(page, 'practice.sessionSummary')
    );
    await expect
      .poll(() => tableCount(page, 'sessions'), { timeout: 15_000 })
      .toBe(1);

    const attemptsInDb = await readTable(page, 'attempts');
    const sessionsInDb = await readTable(page, 'sessions');
    expect(attemptsInDb).toHaveLength(10);
    expect(new Set(attemptsInDb.map((a) => a.questionId)).size).toBe(10);
    expect(new Set(attemptsInDb.map((a) => a.sessionId)).size).toBe(1);
    expect(sessionsInDb[0]?.mode).toBe('practice');
    expect(sessionsInDb[0]?.summary?.totalQuestions).toBe(10);

    // ---- Review screen is reachable and the export still works offline --
    await expect(page.locator('.practice-view')).toContainText(
      await translate(page, 'practice.reviewErrors')
    );

    const exported = await downloadBackup(page);
    expect(exported.data.attempts).toHaveLength(10);
    expect(sorted(exported.data.attempts)).toEqual(sorted(attemptsInDb));
    expect(exported.data.sessions).toHaveLength(1);
    expect(exported.data.sessions[0]?.id).toBe(sessionsInDb[0]?.id);

    assertLocalOnly(network, network.failures.slice(failuresBeforeOffline));
  });

  test('export → clear site data → import restores the fixture byte-for-byte', async ({ page, context }) => {
    const fixture = createIntegrityFixture();
    // Track every IDB connection opened by the app and by the injected Dexie
    // bundle so all of them can be closed before deleting the database.
    await page.addInitScript(() => {
      const originalOpen = indexedDB.open.bind(indexedDB);
      (window as any).__openDatabases = new Set<IDBDatabase>();
      indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
        const request = originalOpen(...args);
        request.addEventListener('success', () => {
          if (request.result?.name === 'cpns-bmgk-db') {
            (window as any).__openDatabases.add(request.result);
          }
        });
        return request;
      }) as typeof indexedDB.open;
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
    await waitForBoot(page);
    await waitForSeededQuestions(page);

    const seeded = await bulkSeed(page, fixture);
    expect(seeded).toEqual({
      questions: fixture.questions.length,
      sessions: fixture.sessions.length,
      attempts: fixture.attempts.length,
      flashcards: fixture.flashcards.length,
      settings: fixture.settings.length,
    });

    // ---- Export through ExportView --------------------------------------
    const exported = await downloadBackup(page);
    expect(exported.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(exported.data.kisiKisi.length, 'export must carry kisiKisi for self-contained restore').toBeGreaterThan(0);
    const expectedKisiKisi = await page.evaluate(async () => {
      const response = await fetch('/kisi-kisi.json');
      const json = await response.json();
      return json.categories.flatMap((category: any) => category.topics);
    });
    expect(exported.data.kisiKisi).toEqual(expectedKisiKisi);
    expect(sorted(exported.data.questions)).toEqual(sorted(fixture.questions as RecordLike[]));
    expect(sorted(exported.data.attempts)).toEqual(sorted(fixture.attempts as RecordLike[]));

    // ---- Clear *all* origin data, then reload ---------------------------
    // The service worker would answer the next navigation from its offline
    // fallback while we are rebuilding storage, so unregister it and drop its
    // caches first. Close every tracked IDB connection before deleting the
    // database, then boot a fresh document from the real app URL.
    await context.clearCookies();
    const clearedDatabase = await page.evaluate(async (dbName) => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      for (const cacheName of await caches.keys()) await caches.delete(cacheName);

      const connections: IDBDatabase[] = Array.from((window as any).__openDatabases ?? []);
      connections.forEach((connection) => {
        try {
          connection.close();
        } catch {
          // already closed
        }
      });
      localStorage.clear();
      sessionStorage.clear();
      return new Promise<boolean>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
        request.onblocked = () => resolve(false);
      });
    }, DB_NAME);
    expect(clearedDatabase, 'IndexedDB must be deleted before the restore').toBe(true);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0);

    await page.goto(`${ORIGIN}/?fresh=1#/import`, { waitUntil: 'load' });
    await waitForBoot(page);
    // First run auto-imports the 42 seed questions; remove them before the
    // restore so the roundtrip can be compared against the fixture alone.
    await waitForSeededQuestions(page);
    const cleared = await clearStudyData(page);
    expect(cleared).toEqual({ questions: 0, sessions: 0, attempts: 0, flashcards: 0, settings: 0 });

    // ---- Import through ImportView --------------------------------------
    await expect(page.locator('#fileInput')).toBeAttached({ timeout: 30_000 });
    await page.locator('#fileInput').setInputFiles({
      name: 'final-qa-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect(page.locator('#previewArea')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#previewCount')).toContainText(`${fixture.questions.length} soal`);
    await page.locator('[data-strategy="overwrite"]').click();
    await page.locator('#btnApplyImport').click();

    await expect.poll(() => tableCount(page, 'questions'), { timeout: 30_000 }).toBe(fixture.questions.length);
    await expect.poll(() => tableCount(page, 'sessions'), { timeout: 30_000 }).toBe(fixture.sessions.length);
    await expect.poll(() => tableCount(page, 'attempts'), { timeout: 30_000 }).toBe(fixture.attempts.length);
    await expect.poll(() => tableCount(page, 'flashcards'), { timeout: 30_000 }).toBe(fixture.flashcards.length);
    await expect.poll(() => tableCount(page, 'settings'), { timeout: 30_000 }).toBe(fixture.settings.length);

    const roundtrip = {
      questions: sorted(await readTable(page, 'questions')),
      sessions: sorted(await readTable(page, 'sessions')),
      attempts: sorted(await readTable(page, 'attempts')),
      flashcards: sorted(await readTable(page, 'flashcards')),
      settings: sorted(await readTable(page, 'settings')),
    };
    expect(roundtrip.questions).toEqual(sorted(fixture.questions as RecordLike[]));
    expect(roundtrip.sessions).toEqual(sorted(fixture.sessions as RecordLike[]));
    expect(roundtrip.attempts).toEqual(sorted(fixture.attempts as RecordLike[]));
    expect(roundtrip.flashcards).toEqual(sorted(fixture.flashcards as RecordLike[]));
    expect(roundtrip.settings).toEqual(sorted(fixture.settings as RecordLike[]));
  });

  test('stress envelope: 2000 questions / 500 sessions / 10000 attempts', async ({
    page,
    browserName,
  }, testInfo) => {
    // REQUIREMENTS §4.1 stress envelope is measured on the reference Chromium
    // engine; the other browser projects run the functional specs only.
    test.skip(browserName !== 'chromium', 'stress envelope runs on Chromium only');
    test.setTimeout(240_000);

    const unhandledErrors: string[] = [];
    page.on('pageerror', (error) => unhandledErrors.push(error.message));

    await page.goto(`${ORIGIN}/#/dashboard`, { waitUntil: 'load' });
    await waitForBoot(page);
    await waitForSeededQuestions(page);

    const counts = await bulkSeed(page, createStressFixture());
    expect(counts.questions).toBe(STRESS_COUNTS.questions);
    expect(counts.sessions).toBe(STRESS_COUNTS.sessions);
    expect(counts.attempts).toBe(STRESS_COUNTS.attempts);

    // ---- Question bank: Fuse search across the full 2000-row index -------
    await goToHash(page, '#/question-bank');
    await expect(page.locator('#searchInput')).toBeVisible({ timeout: 30_000 });
    await waitForRendered(page, '#questionsBody tr');

    const searchMs = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('#searchInput');
      if (!input) throw new Error('search input missing');
      const start = performance.now();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'STRESS-PROBE-1234');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('search render timeout')), 20_000);
        const check = () => {
          const footer = document.querySelector('.question-bank-view .card-footer')?.textContent ?? '';
          if (/1\s*\/\s*2000/.test(footer)) {
            clearTimeout(timeout);
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
      return performance.now() - start;
    });

    // ---- Dashboard with 10000 attempts and 500 sessions ------------------
    await goToHash(page, '#/question-bank');
    await waitForRendered(page, '#questionsBody tr');
    const dashboardMs = await page.evaluate(async () => {
      window.location.hash = '#/dashboard';
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('dashboard render timeout')), 20_000);
        const check = () => {
          const value = document.querySelector('.dashboard-view .stat-value')?.textContent?.trim();
          if (value === '2000') {
            clearTimeout(timeout);
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
      return performance.now() - start;
    });

    // ---- Mock exam selection and first render ----------------------------
    await goToHash(page, '#/mock-exam');
    await expect(page.locator('#btnStartExam')).toBeVisible({ timeout: 30_000 });
    const examStartMs = await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector<HTMLButtonElement>('#btnStartExam')?.click();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('exam render timeout')), 20_000);
        const check = () => {
          const option = document.querySelector('.exam-option');
          if (option) {
            clearTimeout(timeout);
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
      return performance.now() - start;
    });

    const metrics: StressMetrics = {
      questions: counts.questions,
      sessions: counts.sessions,
      attempts: counts.attempts,
      dashboardMs: Math.round(dashboardMs * 10) / 10,
      searchMs: Math.round(searchMs * 10) / 10,
      examStartMs: Math.round(examStartMs * 10) / 10,
      unhandledErrors,
    };
    console.info(`[final-qa stress] ${JSON.stringify(metrics)}`);
    await testInfo.attach('stress-metrics', {
      body: JSON.stringify(metrics, null, 2),
      contentType: 'application/json',
    });

    // Guidance thresholds from REQUIREMENTS §4.1. Actual numbers are always
    // recorded above; a miss is a real regression, not a reason to relax them.
    expect(metrics.dashboardMs, `dashboard load took ${metrics.dashboardMs}ms`).toBeLessThan(500);
    expect(metrics.searchMs, `search took ${metrics.searchMs}ms`).toBeLessThan(200);
    expect(metrics.examStartMs, `mock exam start took ${metrics.examStartMs}ms`).toBeLessThan(500);
    expect(unhandledErrors, `unhandled errors: ${unhandledErrors.join(' | ')}`).toEqual([]);
  });
});

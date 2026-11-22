import { expect, test, type Page } from 'playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

type RequestFailure = { url: string; error: string };

/** Failures the browser itself probes for while the network is disconnected. */
function isExpectedOfflineProbe(url: string): boolean {
  const pathname = new URL(url).pathname;
  return pathname === '/favicon.ico' || pathname === '/sw.js';
}

function readAttemptsFromDexieDb(page: Page): Promise<Array<{ sessionId: string; questionId: string; isCorrect: boolean }>> {
  // `cpns-bmgk-db` is the Dexie database created by src/db/schema.ts. Reading it
  // through the raw IndexedDB API keeps the assertion independent of app internals.
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('cpns-bmgk-db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database.transaction('attempts', 'readonly').objectStore('attempts').getAll();
          request.onsuccess = () => {
            resolve(request.result);
            database.close();
          };
          request.onerror = () => reject(request.error);
        };
      })
  );
}

test('install → disconnect → answer one practice question offline', async ({ page, context }) => {
  const requests: string[] = [];
  const failures: RequestFailure[] = [];

  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) => {
    failures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' });
  });

  // ---- Online: install ---------------------------------------------------
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });

  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.json');
    return { ok: response.ok, name: response.ok ? ((await response.json()) as { name?: string }).name : null };
  });
  expect(manifest.ok, 'manifest.json must be fetchable').toBe(true);
  expect(manifest.name).toBe('CPNS BMKG SKB Prep');

  const swReady = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then((registration) => ({ ok: true, scope: registration.scope })),
      new Promise<{ ok: boolean; scope: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, scope: '' }), 10000)
      ),
    ])
  );
  expect(swReady.ok, 'navigator.serviceWorker.ready must resolve').toBe(true);
  expect(swReady.scope).toContain(ORIGIN);
  // The SW must control this page before we disconnect, otherwise the offline
  // reload would go straight to the network instead of the precache.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });

  // The generated Workbox SW precaches every hashed build asset on install.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const names = (await caches.keys()).filter((name) => name.includes('workbox-precache'));
          let count = 0;
          for (const name of names) {
            const cache = await caches.open(name);
            count += (await cache.keys()).length;
          }
          return count;
        }),
      { timeout: 20000 }
    )
    .toBeGreaterThan(0);

  const precache = await page.evaluate(async () => {
    const names = await caches.keys();
    const workboxNames = names.filter((name) => name.includes('workbox-precache'));
    const entries: Array<{ cache: string; url: string; stored: boolean }> = [];
    for (const name of workboxNames) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        entries.push({
          cache: name,
          url: new URL(request.url).pathname,
          stored: !!(await cache.match(request)),
        });
      }
    }
    return { names, entries };
  });

  expect(precache.names.some((name) => name.includes('workbox-precache'))).toBe(true);
  expect(precache.entries.length).toBeGreaterThan(0);
  // Every URL Workbox advertised in its precache manifest must have a response.
  expect(precache.entries.filter((entry) => !entry.stored)).toEqual([]);
  const precachedUrls = precache.entries.map((entry) => entry.url);
  expect(precachedUrls.some((url) => /\/assets\/index-[\w-]+\.js$/.test(url))).toBe(true);
  expect(precachedUrls.some((url) => /\/assets\/[\w-]+\.css$/.test(url))).toBe(true);
  expect(precachedUrls).toContain('/index.html');
  expect(precachedUrls).toContain('/seed-questions.json');
  expect(precachedUrls).toContain('/manifest.json');

  // Seed data must be present before disconnecting so practice can start offline.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open('cpns-bmgk-db');
              open.onerror = () => resolve(0);
              open.onsuccess = () => {
                const request = open.result.transaction('questions', 'readonly').objectStore('questions').count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(0);
              };
            })
        ),
      { timeout: 20000 }
    )
    .toBeGreaterThan(0);

  // ---- Offline: reload and study ----------------------------------------
  const failuresBeforeOffline = failures.length;
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => (document.getElementById('app')?.children.length ?? 0) > 0, null, {
    timeout: 20000,
  });
  expect(await page.evaluate(() => typeof (window as unknown as { app?: unknown }).app)).toBe('object');

  await page.evaluate(() => {
    window.location.hash = '#/practice';
  });
  await expect(page.locator('#btnStartPractice')).toBeVisible({ timeout: 20000 });
  await page.locator('#btnStartPractice').click();

  await expect(page.locator('.practice-option:not([disabled])').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.practice-option:not([disabled])').first().click();

  await expect
    .poll(async () => (await readAttemptsFromDexieDb(page)).length, { timeout: 20000 })
    .toBeGreaterThan(0);

  const attempts = await readAttemptsFromDexieDb(page);
  expect(attempts[0].sessionId).toBeTruthy();
  expect(attempts[0].questionId).toBeTruthy();
  expect(typeof attempts[0].isCorrect).toBe('boolean');

  // ---- Network assertions ------------------------------------------------
  const offlineFailures = failures.slice(failuresBeforeOffline);
  const unexpectedFailures = offlineFailures.filter((failure) => !isExpectedOfflineProbe(failure.url));
  expect(unexpectedFailures, `unexpected offline request failures: ${JSON.stringify(offlineFailures)}`).toEqual([]);

  const externalRequests = requests.filter((url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !LOCAL_HOSTS.has(parsed.hostname);
  });
  expect(externalRequests, `external requests detected: ${externalRequests.join(', ')}`).toEqual([]);
});

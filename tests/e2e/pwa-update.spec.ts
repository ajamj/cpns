import { expect, test, type Page } from 'playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

function translate(page: Page, key: string): Promise<string> {
  // Functions are not serialisable across the Playwright boundary, so resolve
  // translations inside the page and return only the resulting string.
  return page.evaluate(
    (translationKey) => (window as unknown as { app: { t: (key: string) => string } }).app.t(translationKey),
    key
  );
}

async function openInstalledApp(page: Page): Promise<void> {
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof (window as unknown as { app?: unknown }).app === 'object' &&
      (document.getElementById('app')?.children.length ?? 0) > 0,
    null,
    { timeout: 20000 }
  );
  // Wait until the generated Workbox SW controls this document.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
}

function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (settingKey) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('cpns-bmgk-db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database
            .transaction('settings', 'readonly')
            .objectStore('settings')
            .get(settingKey);
          request.onsuccess = () => {
            const row = request.result as { value?: unknown } | undefined;
            resolve(row?.value);
            database.close();
          };
          request.onerror = () => reject(request.error);
        };
      }),
    key
  );
}

async function countWarningToasts(page: Page, message: string): Promise<number> {
  return page.evaluate(
    (expected) =>
      Array.from(document.querySelectorAll('#toast-container .toast-warning')).filter((toast) =>
        (toast.textContent ?? '').includes(expected)
      ).length,
    message
  );
}

test('updatefound on an installed waiting worker posts skipWaiting and offers refresh', async ({ page }) => {
  await openInstalledApp(page);

  const result = await page.evaluate(async () => {
    const registration = (window as unknown as {
      app: { pwa: { getRegistration: () => ServiceWorkerRegistration | null } };
    }).app.pwa.getRegistration();
    if (!registration) throw new Error('service worker registration missing');

    const posted: Array<{ type?: string }> = [];
    const waitingWorker = new EventTarget() as EventTarget & {
      state: string;
      postMessage: (message: unknown) => void;
    };
    Object.defineProperty(waitingWorker, 'state', { value: 'installed', configurable: true });
    waitingWorker.postMessage = (message: unknown) => {
      posted.push(message as { type?: string });
    };
    Object.defineProperty(registration, 'installing', { value: waitingWorker, configurable: true });

    registration.dispatchEvent(new Event('updatefound'));
    waitingWorker.dispatchEvent(new Event('statechange'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const expectedMessage = (window as unknown as { app: { t: (key: string) => string } }).app.t(
      'pwa.updateAvailable'
    );
    const toast = Array.from(document.querySelectorAll('#toast-container .toast')).find((node) =>
      (node.textContent ?? '').includes(expectedMessage)
    );
    return {
      posted,
      toastFound: !!toast,
      toastText: toast?.textContent ?? '',
      actionText: toast?.querySelector('.toast-action')?.textContent ?? '',
      expectedMessage,
      expectedAction: (window as unknown as { app: { t: (key: string) => string } }).app.t('pwa.refresh'),
    };
  });

  expect(
    result.posted.some(
      (message) =>
        typeof message.type === 'string' && message.type.toLowerCase().replace(/_/g, '') === 'skipwaiting'
    ),
    `expected a skipWaiting message, got ${JSON.stringify(result.posted)}`
  ).toBe(true);
  expect(result.toastFound).toBe(true);
  expect(result.toastText).toContain(result.expectedMessage);
  expect(result.actionText).toBe(result.expectedAction);

  // Accepting the toast action reloads the running document.
  await page.evaluate(() => {
    (window as unknown as { __pwaReloadMarker: string }).__pwaReloadMarker = 'before-reload';
  });
  await Promise.all([
    page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 10000,
    }),
    page.locator('#toast-container .toast-action', { hasText: result.expectedAction }).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
    timeout: 20000,
  });
  expect(await page.evaluate(() => (window as unknown as { __pwaReloadMarker?: string }).__pwaReloadMarker)).toBeUndefined();
});

test('persist() is requested once on first registration and its result is saved to settings', async ({ page }) => {
  await page.addInitScript(() => {
    const counterKey = 'cpns:e2e-persist-calls';
    const previous = Number(sessionStorage.getItem(counterKey) ?? '0');
    (window as unknown as { __persistCalls: number }).__persistCalls = previous;

    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: () => {
        const next = previous + 1;
        sessionStorage.setItem(counterKey, String(next));
        (window as unknown as { __persistCalls: number }).__persistCalls = next;
        return Promise.resolve(true);
      },
    });
  });

  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
    timeout: 20000,
  });

  await expect.poll(() => readSetting(page, 'storagePersisted'), { timeout: 10000 }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls)).toBe(1);

  // A reload in the same install must not prompt persistence again.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
    timeout: 20000,
  });
  expect(
    await page.evaluate(() => Number(sessionStorage.getItem('cpns:e2e-persist-calls') ?? '0'))
  ).toBe(1);
});

test('a >=80% storage estimate emits exactly one warning toast per session', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'estimate', {
      configurable: true,
      value: () => Promise.resolve({ usage: 80, quota: 100, usageDetails: {}, quotaDetails: {} }),
    });
  });

  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
    timeout: 20000,
  });
  const warning = await translate(page, 'pwa.storageWarning');

  await expect.poll(() => countWarningToasts(page, warning), { timeout: 10000 }).toBe(1);

  // Repeating the check (as a backup creation does) must not warn again.
  await page.evaluate(async () => {
    const app = (window as unknown as { app: { checkStorageBudget: () => Promise<unknown> } }).app;
    await app.checkStorageBudget();
    await app.checkStorageBudget();
  });
  expect(await countWarningToasts(page, warning)).toBe(1);
});

test('a navigation that misses network and cache renders the offline page with a retry control', async ({
  page,
  context,
}) => {
  await openInstalledApp(page);

  const offlinePrecached = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname === '/offline.html') return true;
      }
    }
    return false;
  });
  expect(offlinePrecached, 'offline.html must be precached by Workbox').toBe(true);

  await context.setOffline(true);
  const response = await page.goto(`${ORIGIN}/__pwa_offline_probe`, { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);

  const retry = page.locator('#retry-offline');
  await expect(retry).toBeVisible();
  expect((await retry.textContent())?.trim()).toMatch(/Kembali|Retry/);
  expect(await retry.evaluate((button: HTMLButtonElement) => button.onclick?.toString().includes('reload') ?? false)).toBe(true);
});

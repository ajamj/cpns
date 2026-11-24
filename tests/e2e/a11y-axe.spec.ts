import { createRequire } from 'node:module';
import { expect, test, type Page } from 'playwright/test';

// axe-core is installed transitively (Deque's official package). Resolve it
// from disk instead of fetching from a CDN so the audit stays offline-safe.
const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

const ORIGIN = 'http://127.0.0.1:4173';
const TITLE_SUFFIX = ' — CPNS BMKG SKB Prep';

type Route = { name: string; hash: string; title: string };

const ROUTES: Route[] = [
  { name: 'dashboard', hash: '#/dashboard', title: 'Dasbor' },
  { name: 'question-bank', hash: '#/question-bank', title: 'Bank Soal' },
  { name: 'practice', hash: '#/practice', title: 'Latihan' },
  { name: 'mock-exam', hash: '#/mock-exam', title: 'Ujian Mock CAT' },
  { name: 'flashcards', hash: '#/flashcards', title: 'Kartu Hafalan' },
  { name: 'analytics', hash: '#/analytics', title: 'Analitik' },
  { name: 'settings', hash: '#/settings', title: 'Pengaturan' },
  { name: 'import', hash: '#/import', title: 'Impor' },
  { name: 'export', hash: '#/export', title: 'Ekspor' },
  { name: 'trash', hash: '#/trash', title: 'Tempat Sampah' },
];

const OVERFLOW_ROUTES = ROUTES.filter((route) =>
  ['dashboard', 'question-bank', 'mock-exam', 'settings'].includes(route.name)
);

type AxeViolation = {
  id: string;
  impact?: string;
  help?: string;
  nodes: Array<{ target?: string[]; failureSummary?: string }>;
};

type FocusSnapshot = {
  key: string | null;
  tabIndex: number;
  tag: string;
  isSkipLink: boolean;
  label: string;
};

test.describe('WCAG 2.1 AA audit', () => {
  test.describe.configure({ timeout: 180_000 });

  async function openApp(page: Page): Promise<void> {
    await page.goto(`${ORIGIN}/${ROUTES[0]!.hash}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
      timeout: 30_000,
    });
    // window.app is assigned at module evaluation, before initApp finishes;
    // the router changes the title only once it is ready to render routes.
    await page.waitForFunction(
      () => document.title !== 'CPNS BMKG SKB Prep',
      null,
      { timeout: 30_000 }
    );
    await expect(page.locator('#main-content > *').first()).toBeVisible({ timeout: 30_000 });
  }

  async function goToRoute(page: Page, route: Route): Promise<void> {
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route.hash);
    const expectedTitle = `${route.title}${TITLE_SUFFIX}`;
    try {
      await page.waitForFunction(
        (title) => document.title === title,
        expectedTitle,
        { timeout: 30_000 }
      );
    } catch (error) {
      const state = await page.evaluate(() => ({
        title: document.title,
        hash: window.location.hash,
        children: document.getElementById('main-content')?.children.length ?? -1,
      }));
      throw new Error(`${route.name}: expected title ${JSON.stringify(expectedTitle)}, got ${JSON.stringify(state)}`, { cause: error });
    }
    await expect(page.locator('#main-content > *').first()).toBeVisible({ timeout: 30_000 });
  }

  test('axe-core reports no serious or critical violation on any of the 10 routes', async ({ page }) => {
    await openApp(page);
    await page.addScriptTag({ path: AXE_PATH });
    await page.waitForFunction(() => typeof (window as any).axe?.run === 'function');

    const failures: string[] = [];
    for (const route of ROUTES) {
      await goToRoute(page, route);
      const results = await page.evaluate(async () => {
        const axe = (window as any).axe as {
          run: (
            context: Document,
            options: { runOnly: { type: string; values: string[] } }
          ) => Promise<{ violations: AxeViolation[] }>;
        };
        return axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
          },
        });
      });

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      );
      if (blocking.length) {
        failures.push(
          `${route.name}: ${blocking
            .map(
              (violation) =>
                `${violation.id} (${violation.impact}) ${violation.nodes
                  .map((node) => (node.target ?? []).join(' '))
                  .join(', ')}`
            )
            .join(' | ')}`
        );
      }
    }
    expect(failures, `axe violations:\n${failures.join('\n')}`).toEqual([]);
  });

  test('every route is keyboard-reachable from the skip link without focusing tabindex=-1 containers', async ({
    page,
  }) => {
    await openApp(page);

    for (const route of ROUTES) {
      await goToRoute(page, route);

      // Label all focusable controls so we can compare them with the real Tab
      // order. Hidden tab panels and disabled controls are not expected stops.
      const expected = await page.evaluate(() => {
        const isVisible = (element: HTMLElement): boolean => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
          );
        };
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]'
          )
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.hasAttribute('disabled') &&
            !element.closest('[inert]') &&
            isVisible(element)
        );
        const labelOf = (element: HTMLElement): string =>
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
            element.classList.contains('skip-link') ? '.skip-link' : ''
          }`;
        controls.forEach((element, index) =>
          element.setAttribute('data-a11y-tab-index', String(index))
        );
        return controls.map((element, index) => ({ index, label: labelOf(element) }));
      });

      expect(expected.length, `${route.name}: no focusable controls rendered`).toBeGreaterThan(0);
      expect(expected[0]?.label, `${route.name}: skip link must be first in DOM order`).toBe(
        'a.skip-link'
      );

      // Record real browser focus events instead of polling after every Tab:
      // one listener + one read keeps the traversal fast even on dense routes.
      await page.evaluate(() => {
        const log = ((window as any).__a11yFocusLog = [] as FocusSnapshot[]);
        document.addEventListener(
          'focusin',
          (event) => {
            const active = event.target as HTMLElement;
            log.push({
              key: active.getAttribute('data-a11y-tab-index'),
              tabIndex: active.tabIndex,
              tag: active.tagName.toLowerCase(),
              isSkipLink: active.classList.contains('skip-link'),
              label: `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${
                active.classList.contains('skip-link') ? '.skip-link' : ''
              }`,
            });
          },
          true
        );
        // The router focuses <main tabindex="-1"> after a route change, and
        // Chromium keeps that as the sequential-navigation starting point.
        // Start the traversal from the skip link (the first DOM focusable).
        document.querySelector<HTMLElement>('.skip-link')?.focus();
      });

      for (let step = 0; step < expected.length + 2; step += 1) {
        await page.keyboard.press('Tab');
      }

      const log = await page.evaluate(
        () => (window as any).__a11yFocusLog as FocusSnapshot[]
      );
      expect(
        log[0]?.isSkipLink,
        `${route.name}: traversal must start at the skip link; got ${JSON.stringify(log.slice(0, 4))}`
      ).toBe(true);

      const visited = new Set<number>();
      const forbidden: string[] = [];
      const order: string[] = [];
      for (const snapshot of log) {
        order.push(snapshot.label || '(none)');
        if (snapshot.key !== null) visited.add(Number(snapshot.key));
        if (snapshot.tabIndex === -1 && snapshot.tag !== 'body' && snapshot.tag !== '') {
          forbidden.push(snapshot.label);
        }
      }

      expect(
        forbidden,
        `${route.name}: focus landed on a tabindex="-1" container`
      ).toEqual([]);
      const missed = expected.filter((control) => !visited.has(control.index));
      expect(
        missed,
        `${route.name}: unreachable controls ${JSON.stringify(missed)}; order: ${order.join(' → ')}`
      ).toEqual([]);
    }
  });

  test('runtime accessibility preferences are applied from settings', async ({ page }) => {
    // The user toggle must win even when the OS asks for dark mode.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await page.evaluate(() => {
      localStorage.setItem('setting:fontScale', JSON.stringify(1.2));
      localStorage.setItem('setting:reducedMotion', JSON.stringify(true));
      localStorage.setItem('setting:highContrast', JSON.stringify(true));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { app?: unknown }).app === 'object', null, {
      timeout: 30_000,
    });

    const applied = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        fontScale: root.dataset.fontScale,
        reducedMotion: root.dataset.reducedMotion,
        highContrast: root.dataset.highContrast,
        rootFontSize: window.getComputedStyle(root).fontSize,
        background: window.getComputedStyle(document.body).backgroundColor,
      };
    });
    expect(applied.fontScale).toBe('1.2');
    expect(applied.reducedMotion).toBe('true');
    expect(applied.highContrast).toBe('true');
    expect(applied.rootFontSize).toBe('19.2px');
    expect(applied.background).toBe('rgb(0, 0, 0)');

    // Toggling the real control emits settings:changed; the app must re-apply
    // the token block without requiring a reload. The mirror was seeded in
    // localStorage but IndexedDB still holds the default, so click once to
    // persist `true` through the UI, then once more to turn it off.
    const settingsRoute = ROUTES.find((route) => route.name === 'settings')!;
    await goToRoute(page, settingsRoute);
    await expect(page.locator('#tab-accessibility')).toBeVisible({ timeout: 30_000 });
    await page.locator('#tab-accessibility').click();
    const highContrast = page.locator('#highContrast');
    await expect(highContrast).toBeVisible({ timeout: 10_000 });
    await highContrast.check();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('setting:highContrast')), {
        timeout: 10_000,
      })
      .toBe('true');
    await highContrast.uncheck();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.highContrast), {
        timeout: 10_000,
      })
      .toBe('false');
  });

  test('80%/100%/150% font scale has no horizontal overflow', async ({ page }) => {
    await openApp(page);
    for (const scale of [0.8, 1.0, 1.5]) {
      for (const route of OVERFLOW_ROUTES) {
        await goToRoute(page, route);
        // Apply the scale after render: the router intentionally re-reads the
        // persisted preference before each route and would overwrite it.
        await page.evaluate((value) => {
          document.documentElement.dataset.fontScale = value.toFixed(1);
        }, scale);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          fontSize: window.getComputedStyle(document.documentElement).fontSize,
        }));
        expect(
          metrics.scrollWidth,
          `${route.name} at ${scale}x: html scrollWidth ${metrics.scrollWidth} > ${metrics.innerWidth}`
        ).toBeLessThanOrEqual(metrics.innerWidth);
        expect(
          metrics.bodyWidth,
          `${route.name} at ${scale}x: body scrollWidth ${metrics.bodyWidth} > ${metrics.innerWidth}`
        ).toBeLessThanOrEqual(metrics.innerWidth);
        expect(metrics.fontSize).toBe(`${(16 * scale).toFixed(1).replace(/\.0$/, '')}px`);
      }
    }
  });
});

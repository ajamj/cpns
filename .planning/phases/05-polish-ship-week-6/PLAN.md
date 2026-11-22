---
phase: 05-polish-ship-week-6
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - index.html
  - package.json
  - vite.config.ts
  - vitest.config.js
  - public/manifest.json
  - public/sw.js
  - public/offline.html
  - src/app.ts
  - src/core/pwa.ts
  - src/core/router.ts
  - src/core/i18n.ts
  - src/core/app-utils.ts
  - src/shared/styles/main.css
  - src/views/SettingsView.ts
  - src/views/QuestionBankView.ts
  - src/views/AnalyticsView.ts
  - scripts/serve.mjs
  - scripts/check-bundle-size.mjs
  - scripts/lighthouse-check.mjs
  - scripts/release.mjs
  - playwright.config.ts
  - tests/e2e/offline-session.spec.ts
  - tests/e2e/pwa-update.spec.ts
  - tests/e2e/a11y-axe.spec.ts
  - tests/e2e/final-qa.spec.ts
  - tests/unit/contrast.test.ts
  - .github/workflows/deploy.yml
  - README.md
  - USER_GUIDE.md
  - DEVELOPER_GUIDE.md
  - CHANGELOG.md
autonomous: false
requirements:
  - FR-OP-01
  - FR-OP-02
  - FR-OP-03
  - FR-SE-02
  - FR-QB-03
  - FR-QB-04
  - FR-SM-01
  - FR-SM-02
  - FR-SM-03
  - FR-PA-01
  - FR-PA-04
estimate:
  tokens: 78000
  raw_tokens: 39000
  tasks: 11
  confidence: low
must_haves:
  truths:
    - "A user can install the app on desktop and mobile and complete a full study session with the network disconnected."
    - "A deployed update activates automatically and the running app offers a refresh without swallowing the user's work."
    - "Keyboard-only and screen-reader users can reach and operate all routes; axe-core reports zero serious or critical violations."
    - "Production bundle is under 5MB gzipped and Lighthouse meets Performance ≥90, Accessibility ≥95, Best Practices ≥90, PWA ≥90."
    - "An exported backup restores into a cleared browser profile with byte-for-byte equivalence of questions, sessions, attempts and settings."
    - "README, USER_GUIDE, DEVELOPER_GUIDE and CHANGELOG describe the shipped app, GitHub Pages deploys from main, and tag v1.0.0 exists."
  artifacts:
    - dist/ (production build with hashed, fully precached assets)
    - public/offline.html
    - scripts/serve.mjs
    - scripts/check-bundle-size.mjs
    - scripts/lighthouse-check.mjs
    - scripts/release.mjs
    - playwright.config.ts
    - tests/e2e/offline-session.spec.ts
    - tests/e2e/pwa-update.spec.ts
    - tests/e2e/a11y-axe.spec.ts
    - tests/e2e/final-qa.spec.ts
    - .github/workflows/deploy.yml
    - README.md
    - USER_GUIDE.md
    - DEVELOPER_GUIDE.md
    - CHANGELOG.md
  key_links:
    - from: "src/app.ts"
      to: "public/sw.js"
      via: "navigator.serviceWorker.register('/sw.js') + updatefound -> skipWaiting -> toast"
    - from: "vite.config.ts"
      to: "dist/sw.js"
      via: "VitePWA generateSW precache manifest covering hashed JS/CSS/JSON/PNG"
    - from: "index.html"
      to: "src/shared/styles/main.css"
      via: "skip link target #main-content and data-* accessibility attributes on <html>"
    - from: "src/db/repositories/settings.ts"
      to: "src/shared/styles/main.css"
      via: "fontScale / reducedMotion / highContrast settings -> documentElement dataset -> CSS token overrides"
    - from: ".github/workflows/deploy.yml"
      to: "dist/"
      via: "actions/upload-pages-artifact + actions/deploy-pages on tag v*"
    - from: "scripts/release.mjs"
      to: "package.json, CHANGELOG.md, git tag"
      via: "version bump -> build -> bundle check -> tag v1.0.0"
---

# Phase 5 Plan: Polish & Ship (v1.0)

## Phase Objective and Boundary

**Goal:** Ship a production-hardened, accessible, offline-capable v1.0 release with complete documentation and a repeatable GitHub Pages + tag release path.

**Purpose:** Phases 1–4 delivered working features; this phase converts them into a release a user can install on a laptop or phone, use with no network, navigate with a keyboard or screen reader, and recover from data loss. It is the last gate before the `v1.0.0` tag.

**Boundary (in scope):** PWA/offline hardening (5.1), WCAG 2.1 AA accessibility (5.2), performance/bundle optimization (5.3), documentation and distribution (5.4), final QA (5.5).

**Boundary (out of scope — do not implement here):** any new study feature, cloud sync, Anki polish, 2025 kisi-kisi migration, content authoring beyond the existing 42 seed questions. Those remain in ROADMAP "Future Phases". Nothing in this plan may reduce a Phase 1–4 capability to a static/label-only substitute; all hardening must preserve full behavior.

**Locked constraints carried from STATE.md decision log (non-negotiable):** Vanilla TypeScript + Vite (no framework), Dexie.js storage, Workbox via Vite PWA plugin, hash-based routing, SM-2 flashcards, Chart.js for charts, Indonesian primary language, single user with no backend. Where current code diverges from a locked decision (notably the hand-written `public/sw.js` instead of the Vite PWA plugin), this plan reconciles toward the decision, not away from it.

<objective>
Harden the existing app into a releasable v1.0: prove the install → offline → study path end-to-end, close the WCAG 2.1 AA and performance gaps, write the four operator/developer documents, automate GitHub Pages deployment and release tagging, and run the final QA matrix. Output is a tagged, deployed release plus reproducible verification artifacts (Playwright specs, axe report, Lighthouse report, bundle-size report).
</objective>

<execution_context>
@/home/ajam/.config/opencode/gsd-core/workflows/execute-plan.md
@/home/ajam/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@vite.config.ts
@index.html
@public/sw.js
@public/manifest.json
@src/app.ts
@src/core/router.ts
@src/db/repositories/settings.ts
@src/shared/styles/main.css
@src/views/SettingsView.ts
@src/views/QuestionBankView.ts
</context>

## Task Breakdown with Dependencies

| # | Workstream | Task | Depends on | Wave | File conflict notes |
|---|-----------|------|-----------|------|---------------------|
| 1 | 5.1 PWA | Tracer: install → offline → one practice answer | — | 1 | Owns `vite.config.ts`, `index.html`, `public/sw.js`, `package.json`, `playwright.config.ts` |
| 2 | 5.1 PWA | Update flow, persistent storage, quota, offline fallback | 1 | 2 | Extends `src/app.ts`, `public/sw.js` after tracer frees them |
| 3 | Gate | Tooling legitimacy gate (blocking human) | — | 2 | No source files; gates tasks 5 and 9 |
| 4 | 5.2 A11y | Semantics, skip link, focus order, contrast, touch targets | 1 | 2 | Owns `index.html`, `src/core/router.ts`, `src/shared/styles/main.css` |
| 5 | 5.2 A11y | Runtime a11y prefs + axe-core audit + font-scale matrix | 3, 4 | 3 | Reuses CSS from task 4; adds axe spec |
| 6 | 5.3 Perf | Bundle budget, code splitting, chart audit, virtual list, debounce/memo | 1 | 2 | Touches `vite.config.ts` (after task 1), `QuestionBankView.ts`, `AnalyticsView.ts` |
| 7 | 5.4 Docs | README / USER_GUIDE / DEVELOPER_GUIDE / CHANGELOG | 1, 2, 6 | 3 | Docs-only; describe final measured values |
| 8 | 5.4 Dist | GitHub Pages workflow + release script | 6 | 3 | Owns `.github/workflows/deploy.yml`, `scripts/release.mjs` |
| 9 | 5.3/5.1 | Lighthouse + bundle gate and fix loop | 3, 5, 6, 8 | 4 | Reads all builds; writes only report/fix files |
| 10 | 5.5 QA | Final QA: offline session, integrity roundtrip, browser/mobile/stress | 2, 5, 9 | 5 | Adds `tests/e2e/final-qa.spec.ts` + human-check matrix |
| 11 | Ship | Tag `v1.0.0`, deploy, milestone handoff | 7, 8, 10 | 6 | One-way action; requires all gates green |

**Parallelism note (ROADMAP line 314):** with more than one developer, workstreams 5.1 (tasks 1–2), 5.2 (tasks 4–5) and 5.3 (task 6) can run concurrently *only after* task 1 lands, because `vite.config.ts`, `src/app.ts`, `index.html` and `src/shared/styles/main.css` are shared. Task 1 is therefore the required first merge in every scheduling variant.

<tasks>

<task type="tracer">
  <name>Task 1 (5.1, Wave 1): Tracer — install → disconnect → answer one practice question</name>
  <files>index.html, vite.config.ts, vitest.config.js, public/sw.js, public/manifest.json, scripts/serve.mjs, playwright.config.ts, package.json, tests/e2e/offline-session.spec.ts</files>
  <action>
    Prove the single release-critical path end-to-end before any expansion work.

    1. Enable the Vite PWA plugin already declared in devDependencies (locked decision: Workbox via Vite PWA plugin). In `vite.config.ts`, add `VitePWA({ registerType: 'autoUpdate', injectRegister: null, manifest: false, workbox: { globPatterns: ['**/*.{js,css,html,json,png,svg,woff2}'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/sw\.js$/], maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 } })` using the existing `public/manifest.json`. Delete `public/sw.js` (it is a stale fallback whose precache list contains no hashed JS/CSS, so a fresh install cannot work offline); the plugin emits `dist/sw.js` with all hashed build assets. Keep `src/app.ts`'s explicit registration intact (task 2 extends it).
    2. Remove the two Google Fonts `<link>` tags and the inline `onload=` handler from `index.html`; they create runtime network requests (violating FR-OP-01 and "zero external requests"), break a strict CSP, and are the main reason an offline reload renders with fallback font anyway. The existing `--font-sans` stack in `src/shared/styles/main.css` already includes system UI fonts.
    3. Add `scripts/serve.mjs`: a zero-dependency Node static file server for `dist/` with correct MIME types (`text/html`, `application/javascript`, `text/css`, `application/json`, `image/png`, `image/svg+xml`) and hash-route fallback to `index.html`. Add npm scripts `serve` (`node scripts/serve.mjs dist 4173`) and `test:e2e` (`playwright test`). Add `playwright.config.ts` with a `webServer` that runs `npm run serve`, `url: http://127.0.0.1:4173`, `reuseExistingServer: !process.env.CI`, Chromium project, and a `trace: retain-on-failure` setting.
    4. Delete the duplicate `vitest.config.js` (byte-identical to `vitest.config.ts`) so test tooling resolves one config.
    5. Write `tests/e2e/offline-session.spec.ts`: launch Chromium, load the app, assert the manifest is fetchable and `navigator.serviceWorker.ready` resolves, assert every precached URL from `workbox` is present in `caches.keys()`, call `context.setOffline(true)`, reload, navigate to `#/practice`, answer one question, and assert (a) the attempt appears in IndexedDB via `window.app`/Dexie read, (b) the page renders with no `requestfailed` events other than expected offline probes, (c) zero requests to any non-localhost origin.
    Do not add persistent-storage or quota logic here — that is task 2. Do not add a second router or framework.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/offline-session.spec.ts --reporter=line && npm run test:run</automated>
  </verify>
  <done>One install → offline → practice-answer path passes end-to-end in CI, the built SW precaches hashed assets, `npm run serve` serves `dist/` locally, and the external font requests are gone.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (5.1, Wave 2): PWA update flow, persistent storage, quota warnings, offline page</name>
  <files>src/app.ts, src/core/pwa.ts, public/offline.html, public/sw.js, src/core/i18n.ts, src/views/SettingsView.ts, src/shared/styles/main.css, tests/e2e/pwa-update.spec.ts</files>
  <behavior>
    - Test: an `updatefound` event with an installed waiting worker posts `skipWaiting`, emits a toast using `pwa.updateAvailable`, and the toast action calls `window.location.reload()`.
    - Test: `navigator.storage.persist()` is requested exactly once per install and its boolean result is written to settings.
    - Test: `navigator.storage.estimate()` reporting usage/quota &gt;= 0.8 emits exactly one warning toast and does not repeat within the same session.
    - Test: a navigation fetch that fails both network and cache returns `public/offline.html` with a retry control.
  </behavior>
  <action>
    Create `src/core/pwa.ts` exporting `initPwaLifecycle()` and `checkStorageBudget()`; move the SW registration/update listener out of `src/app.ts#initApp` into that module and call it from `initApp`. Add a `message` handler in the generated SW (via `workbox.additionalManifestEntries` is insufficient — instead add a small `injectManifest`-style custom snippet using the plugin's `workbox.plugins` hook, or keep a minimal `public/sw.js` only if it can be proven to include all hashed assets; prefer the plugin's generated SW with `registerType: 'autoUpdate'` which already calls `skipWaiting`+`clients.claim`). The update toast must use existing i18n keys `pwa.updateAvailable` / `pwa.refresh` in both `id` and `en`; add new keys `pwa.storagePersisted`, `pwa.storageWarning`, `pwa.retryOffline` in both locales.
    Request `navigator.storage.persist()` once on first successful registration, store the result in a new settings key `storagePersisted` (add to `SettingKey`, `SettingsDict`, and `SETTINGS_DEFAULTS` in `src/shared/types/index.ts` and `src/db/repositories/settings.ts`). In `SettingsView.ts` Data section, display "Persistent: yes/no" and current usage/quota from `navigator.storage.estimate()`, with a manual "Request persistent storage" button for browsers that denied the first prompt. Check the 80% threshold in `checkStorageBudget()` on init and after every backup creation; emit a single warning toast via `eventBus` so it uses the shared toast container (`src/core/app-utils.ts#setShowToast`).
    Add self-contained `public/offline.html` (inline CSS only, no external assets, BMKG-styled, "Kembali / Retry" button calling `location.reload()`), and configure it as the navigation fallback via the SW plugin's `navigateFallback`. Ensure `public/offline.html` is also precached.
    Document the `file://` limitation in the README in task 7 (SW registration requires a secure context: `http://localhost` or HTTPS; `npm run serve` is the supported offline-dev path) — do not claim `file://` PWA support.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/pwa-update.spec.ts --reporter=line && npm run lint</automated>
  </verify>
  <done>Update toast appears and refreshes on accept, persistence is requested once and shown in Settings, an 80% quota warning fires once, and a simulated total network failure renders the offline page with a working retry button.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 3 (Gate, Wave 2): Package legitimacy gate before adding QA tooling</name>
  <what-built>No source changes. REQUIREMENTS/ROADMAP require axe-core and Lighthouse evidence, but no `## Package Legitimacy Audit` table exists in a RESEARCH.md for this project, so every new npm package is `[ASSUMED]` under the planner fallback policy.</what-built>
  <how-to-verify>
    1. Confirm at https://www.npmjs.com/package/lighthouse that `lighthouse` is the official Google Chrome Lighthouse package (publisher `google`, not a lookalike) and note the exact version to pin.
    2. Confirm `axe-core` at https://www.npmjs.com/package/axe-core is the official Deque Systems package. It is already present transitively in `node_modules`; pin it as an explicit devDependency at the exact installed version rather than fetching a new one if possible.
    3. Confirm nothing new must be installed for `@tanstack/virtual-core` (already a dependency) or `playwright` (already a devDependency).
    4. Reject any `[SLOP]` or `[SUS]` package; choose a different verifier if the legitimacy check fails.
  </how-to-verify>
  <resume-signal>Type "approved" with the pinned versions, or name the package to reject.</resume-signal>
</task>

<task type="auto">
  <name>Task 4 (5.2, Wave 2): Accessibility foundations — semantics, focus order, contrast, touch targets</name>
  <files>index.html, src/core/router.ts, src/shared/styles/main.css, src/views/SettingsView.ts, src/views/QuestionBankView.ts, src/views/MockExamView.ts, src/views/PracticeView.ts, src/views/FlashcardsView.ts, tests/unit/contrast.test.ts</files>
  <action>
    Fix the structural WCAG 2.1 AA issues across all 10 views without changing behavior.
    1. `index.html`: add a visually-hidden "Lewati ke konten utama" skip link as the first focusable element with a visible `:focus` state, and wrap the router outlet in `<main id="main-content" tabindex="-1">` inside `<div id="app">`.
    2. `src/core/router.ts`: after each route render, set `document.title` to `${view title} — CPNS BMKG SKB Prep` and move focus to `#main-content` (use `{ preventScroll: true }`), except on first paint; emit a `route:changed` event on `eventBus` for downstream a11y tooling. The mock-exam fullscreen route must retain focus inside the exam view and must not steal focus from the timer's live region.
    3. Heading hierarchy: exactly one `<h1>` per view, then sequential `<h2>`/`<h3>`; no heading level skips. Add `aria-current="page"` to the active `.nav-tab` and keep `aria-label` on icon-only controls. Add `role="status" aria-live="polite"` to the toast container and `aria-live="assertive"` to the mock-exam timer warning only (not the whole timer, which would spam screen readers).
    4. Contrast: audit the `:root` tokens in `src/shared/styles/main.css` and fix any pair below 4.5:1 (text) or 3:1 (large text/UI borders), especially `--color-text-light` on `--color-bg`, badge colors on tinted backgrounds, and `.stat-label`. Add `tests/unit/contrast.test.ts` with a pure WCAG relative-luminance helper asserting every documented text/background token pair meets AA; keep the test in `src/**/*.{test,spec}.ts` so Vitest discovers it.
    5. Focus: replace any `outline: none` with `:focus-visible` rings using `--color-focus` at ≥3:1 against adjacent colors; ensure modal open traps focus and close restores it to the trigger (the existing `closeAllModals` in `src/app.ts` should call a `restoreFocus()` exported from the modal helper). Touch targets on nav tabs, navigator grid cells, flashcard rating buttons and bulk checkboxes must be ≥44×44 CSS px.
  </action>
  <verify>
    <automated>npm run test:run -- tests/unit/contrast.test.ts && npm run build && npm run lint</automated>
  </verify>
  <done>Every route has one h1 and sequential headings, a working skip link, visible focus for all controls, ≥44px touch targets, and all token contrast pairs pass the unit test.</done>
</task>

<task type="auto">
  <name>Task 5 (5.2, Wave 3): Wire runtime a11y preferences and run axe-core audit</name>
  <files>src/app.ts, src/core/router.ts, src/shared/styles/main.css, src/views/SettingsView.ts, tests/e2e/a11y-axe.spec.ts</files>
  <action>
    The settings UI already exposes `fontScale`, `reducedMotion` and `highContrast` (`src/views/SettingsView.ts` lines ~237–246, 370–389) but nothing applies them. Wire the three settings to `document.documentElement.dataset` (e.g. `data-font-scale="1.2"`, `data-reduced-motion="true"`, `data-high-contrast="true"`) in a `applyAccessibilitySettings()` helper called on `initApp`, on `settings:changed`, and immediately before each route render. In `src/shared/styles/main.css`, add `html[data-font-scale] { font-size: calc(16px * attr(...)) }` implemented via a small set of explicit CSS custom-property overrides (CSS `attr()` is not universally supported for non-string values — use `[data-font-scale='0.8']`, `'0.9'`, ... `'1.5']` rules setting `--text-*` / `html { font-size }`), a `html[data-reduced-motion='true'] *` rule mirroring the existing `@media (prefers-reduced-motion: reduce)` block, and a `html[data-high-contrast='true']` token block forcing black/white/yellow with ≥7:1 contrast and `forced-colors: active` compatibility. Both user setting and OS media query must be honored (user `true` OR OS prefers reduced motion).
    Add `tests/e2e/a11y-axe.spec.ts`: inject the already-present `node_modules/axe-core/axe.min.js` with `page.addScriptTag({ path })`, run `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } })` on each of the 10 routes, and assert zero `critical` and zero `serious` violations. Add a Playwright-only keyboard traversal assertion: starting at the skip link, Tab through each route and assert every interactive element is reachable and no focus lands on a `tabindex="-1"` container. Add a font-scale matrix assertion at 0.8, 1.0 and 1.5 that checks `document.documentElement.scrollWidth <= window.innerWidth` on dashboard, question bank, mock exam and settings (no horizontal overflow / layout break).
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/a11y-axe.spec.ts --reporter=line</automated>
    <human-check expected="pass">
      Run NVDA + Firefox and VoiceOver + Safari through: install prompt, question bank search, one practice session, one mock-exam question with timer, flashcard rating, export. Confirm no unlabeled control, no focus trap, timer warnings announced once, and 80%/150% font scale readable.
    </human-check>
  </verify>
  <done>axe-core reports zero serious/critical violations on all 10 routes, all flows are keyboard-complete, OS and app reduced-motion settings both work, high-contrast token set is applied, and 80–150% font scale causes no horizontal overflow.</done>
</task>

<task type="auto">
  <name>Task 6 (5.3, Wave 2): Performance — bundle budget, splitting, chart audit, virtualization, memoization</name>
  <files>vite.config.ts, scripts/check-bundle-size.mjs, src/views/QuestionBankView.ts, src/views/AnalyticsView.ts, src/core/app-utils.ts, package.json</files>
  <action>
    1. Add `scripts/check-bundle-size.mjs`: after `npm run build`, walk `dist/**`, compute per-file and total gzip size (Node `zlib.gzipSync`), fail if total gzipped &gt; 5 * 1024 * 1024, and print a table. Exclude `.map` files from both the budget and the shipped build by setting `build.sourcemap: false` in `vite.config.ts` (source maps are currently the largest files in `dist/` and are not needed by end users). Wire it as `npm run check:size` and make `npm run build` call it.
    2. Keep the existing `manualChunks` vendor split and add lazy loading for views that are not on the first paint: in `src/app.ts#renderRoute`, replace static view imports for `AnalyticsView`, `ImportView`, `ExportView`, `TrashView`, `SettingsView` with `import()` calls and a lightweight loading placeholder; preserve the synchronous `switch` behavior and route params. Do not lazy-load Dashboard (first paint) or the SW registration path.
    3. Chart.js audit: the current `src/views/AnalyticsView.ts` renders hand-written inline SVG and does not import `chart.js` at all, while `vite.config.ts` declares a `vendor-charts` chunk. Verify with a grep/build check; if there is truly no import, remove the `vendor-charts` manual chunk and remove `chart.js` from `dependencies` (do not add it back). If a chart import is found, register only the needed controller/element/scale modules (`Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)` etc.) instead of `registerables`. Never ship the full `registerables` bundle.
    4. Virtualize the question list: `src/views/QuestionBankView.ts#renderList` currently slices a page of rows into innerHTML. Use the already-installed `@tanstack/virtual-core` to render only visible rows for 1000+ questions with a fixed row height and a spacer element, replacing the current pagination-only approach while keeping filter/search/select-all behavior intact. Keep `debounce(..., 150)` for search; add a memoized selector for the derived `filteredQuestions` (cache by filter object identity/serialized key in `src/core/app-utils.ts`).
    5. Assert no runtime network requests beyond same-origin asset fetches (this overlaps task 1's test and must remain green).
  </action>
  <verify>
    <automated>npm run build && npm run check:size && npm run test:run && npm run test:e2e -- tests/e2e/offline-session.spec.ts --reporter=line</automated>
  </verify>
  <done>Total gzipped bundle &lt; 5MB reported by `npm run check:size`, no unused chart chunk, non-critical views lazy-load, and the question list renders 2000 rows without rendering all of them at once.</done>
</task>

<task type="auto">
  <name>Task 7 (5.4, Wave 3): Documentation set — README, USER_GUIDE, DEVELOPER_GUIDE, CHANGELOG</name>
  <files>README.md, USER_GUIDE.md, DEVELOPER_GUIDE.md, CHANGELOG.md</files>
  <action>
    Write all four documents in Indonesian with short English summaries where helpful, matching the actual shipped code (use measured bundle/Lighthouse numbers from tasks 6 and 9; leave a `TBD` only if a gate has not run, and replace it before task 11).
    - `README.md`: what the app is, the 21-topic BMKG 2024 kisi-kisi, screenshot/marketing-free description, requirements (Node 20+, modern browser), `npm ci && npm run dev`, `npm run build && npm run serve` (explain `file://` cannot register a service worker), PWA install steps for Chrome/Edge/Safari/iOS/Android, architecture diagram (Vite → hash router → views → Dexie repositories → Workbox SW), offline/privacy guarantees (zero telemetry), link to the other three docs, license/contributing pointer.
    - `USER_GUIDE.md`: first-run seed import, question CRUD/import/export, the three study workflows (Practice, Mock Exam CAT, Flashcards SM-2) with keyboard shortcuts, dashboard interpretation, backup/restore and 80%-quota troubleshooting, "data lives only in this browser" warning, PWA update behavior, offline FAQ.
    - `DEVELOPER_GUIDE.md`: repo layout, path aliases, adding a view + route, adding a Dexie migration (schema version bump), adding a setting key (types + defaults + SettingsView), running `npm run lint`, `npm run test:run`, `npm run test:e2e`, `npm run check:size`, Lighthouse procedure, CSS token/a11y conventions, GitHub Pages deployment and `npm run release` flow.
    - `CHANGELOG.md`: Keep-a-Changelog format with `## [1.0.0] - <date>` summarizing Phases 1–5 (foundation, question bank, three study modes, analytics, PWA/a11y/perf/docs). No "Unreleased" features that are not shipped.
    Do not document features that are not present (e.g. cloud sync, native app, 2025 kisi-kisi).
  </action>
  <verify>
    <automated>test -f README.md && test -f USER_GUIDE.md && test -f DEVELOPER_GUIDE.md && test -f CHANGELOG.md && npm run lint && node -e "for (const f of ['README.md','USER_GUIDE.md','DEVELOPER_GUIDE.md','CHANGELOG.md']) { const s=require('fs').readFileSync(f,'utf8'); if (!s.includes('CPNS') && f!=='CHANGELOG.md') process.exit(1); }"</automated>
  </verify>
  <done>Four documents exist, describe only shipped behavior, include the `npm run serve` workaround, and all commands they list resolve to real npm scripts or files.</done>
</task>

<task type="auto">
  <name>Task 8 (5.4, Wave 3): GitHub Pages deployment workflow + release script</name>
  <files>.github/workflows/deploy.yml, scripts/release.mjs, package.json, CHANGELOG.md</files>
  <action>
    Create `.github/workflows/deploy.yml` triggered on push to `main` and on `push tags: ['v*']`, with least-privilege `permissions: contents: read, pages: write, id-token: write` and `concurrency: { group: pages, cancel-in-progress: true }`. Jobs: (1) `build` on `ubuntu-latest` with `actions/checkout@v4`, `actions/setup-node@v4` (node 20, cache npm), `npm ci`, `npm run lint`, `npm run test:run`, `npm run build`, `npm run check:size`, then `actions/upload-pages-artifact@v3` with `path: dist`; (2) `deploy` with `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`, `needs: build`, `actions/deploy-pages@v4`. Add a `base` value to `vite.config.ts` only if a project-scope Pages URL requires it — do not hardcode `/cpns/` when the custom domain is used; make it configurable via `VITE_BASE` env var and document it in DEVELOPER_GUIDE.md. Add a `404.html` copy of `index.html` in `dist` via a small build plugin so hash routes deep-link correctly.
    Create `scripts/release.mjs`: refuse to run on a dirty worktree or a non-`main` branch; read the requested version from argv, require semver greater than `package.json#version`; write the new version to `package.json` and `package-lock.json` (`npm version --no-git-tag-version`); ensure `CHANGELOG.md` has a matching `## [x.y.z]` heading; run `npm run lint`, `npm run test:run`, `npm run build`, `npm run check:size`; then create annotated tag `vX.Y.Z` with message referencing the changelog section and print (do not auto-push unless `--push` is passed) `git push origin main --follow-tags`. Register as `npm run release`. For v1.0.0 specifically, the script must accept `1.0.0` given the existing package version is already `1.0.0` (detect equal version and proceed to tag if no `v1.0.0` tag exists).
    Threat note: never bake secrets into the workflow; GitHub Pages deploy uses `id-token: write`, not a PAT.
  </action>
  <verify>
    <automated>node --check scripts/release.mjs && node -e "const y=require('fs').readFileSync('.github/workflows/deploy.yml','utf8'); for (const s of ['actions/checkout@v4','actions/setup-node@v4','actions/upload-pages-artifact@v3','actions/deploy-pages@v4','permissions:']) if(!y.includes(s)) process.exit(1)" && npm run build</automated>
  </verify>
  <done>Workflow file is valid YAML with least-privilege permissions and pinned actions, `npm run release -- 1.0.0 --dry-run` completes all checks without creating a tag, and the build output contains `404.html`.</done>
</task>

<task type="auto">
  <name>Task 9 (5.1/5.3, Wave 4): Lighthouse + bundle score gate and fix loop</name>
  <files>scripts/lighthouse-check.mjs, package.json, reports/lighthouse.json, vite.config.ts, index.html, src/shared/styles/main.css</files>
  <action>
    After the human in task 3 approves the pinned `lighthouse` devDependency, add it and write `scripts/lighthouse-check.mjs` which starts the production server (`node scripts/serve.mjs dist 4173`), runs Lighthouse CLI headless against `http://127.0.0.1:4173/` with `--preset=desktop` and a mobile run (`--form-factor=mobile`), writes JSON to `reports/lighthouse.json`, and exits non-zero unless **all** thresholds hold: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 90, PWA ≥ 90. Register as `npm run check:lighthouse`.
    Iterate on concrete failures only: if PWA score is low, re-check installability (manifest icons 192/512, `start_url`, SW fetch handler, HTTPS/localhost); if Best Practices is low, remove any remaining console errors, mixed content or insecure links; if Accessibility is low, feed the specific axe rule IDs back into task 5's spec and fix the source; if Performance is low, revisit task 6's chunking. Do not lower the thresholds or skip categories to make the gate green. Record both desktop and mobile scores in README/CHANGELOG before task 11.
  </action>
  <verify>
    <automated>npm run build && npm run check:size && npm run check:lighthouse</automated>
  </verify>
  <done>`reports/lighthouse.json` exists for both desktop and mobile and all four category scores meet or exceed the thresholds with no disabled audit.</done>
</task>

<task type="auto">
  <name>Task 10 (5.5, Wave 5): Final QA — offline session, integrity roundtrip, cross-browser, mobile, stress</name>
  <files>tests/e2e/final-qa.spec.ts, tests/e2e/offline-session.spec.ts, scripts/stress-seed.mjs</files>
  <action>
    Build `tests/e2e/final-qa.spec.ts` with three automated scenarios:
    1. **Offline full session:** install → disconnect → open `#/dashboard` → practice 10 questions → review → export JSON → assert all writes landed in Dexie and no external network calls occurred.
    2. **Data integrity roundtrip:** seed a deterministic fixture (known questions/sessions/attempts/flashcards/settings), export via ExportView, clear all origin data (`context.clearCookies()` + IndexedDB + localStorage delete through `page.evaluate`), reload, import the JSON via ImportView, then deep-compare counts and field values to the fixture. Assert `schemaVersion` and `kisiKisi` are present in the export (self-contained restore per STATE.md note).
    3. **Stress test:** use `scripts/stress-seed.mjs` to bulk-insert 2000 questions, 500 sessions and 10000 attempts directly through the existing Dexie repositories in a browser context; assert dashboard load &lt; 500ms, search &lt; 200ms, mock-exam start &lt; 500ms, and no unhandled errors. These are guidance thresholds from REQUIREMENTS §4.1 — record actual numbers even if a threshold is missed, then fix the cause rather than weakening the assertion.
    Add Chromium, Firefox and WebKit projects to `playwright.config.ts` for the non-stress specs (closest available automation for Chrome/Firefox/Safari/Edge latest-2). Edge is Chromium-based: note in the report that Edge is covered by the Chromium project plus the manual matrix.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/final-qa.spec.ts --reporter=line</automated>
    <human-check expected="pass">
      Manual matrix (record results in the phase SUMMARY): (a) NVDA + Firefox and VoiceOver + Safari complete a practice session, mock exam and flashcard review; (b) keyboard-only completes all flows; (c) PWA installs and runs offline on iOS Safari and Android Chrome with ≥44px touch targets; (d) Chrome, Firefox, Safari, Edge latest-2 render every route without layout break; (e) install → disconnect → study on a real device; (f) export → clear site data → import on a real device.
    </human-check>
  </verify>
  <done>All three automated scenarios pass, stress numbers are recorded, and the manual browser/device matrix is complete with zero critical findings.</done>
</task>

<task type="auto">
  <name>Task 11 (Ship, Wave 6): Tag v1.0.0, deploy to GitHub Pages, hand off milestone</name>
  <files>CHANGELOG.md, README.md, .planning/STATE.md, .planning/phases/05-polish-ship-week-6/05-01-SUMMARY.md</files>
  <action>
    Gate: refuse to proceed unless `npm run lint`, `npm run test:run`, `npm run check:size`, `npm run check:lighthouse`, `npm run test:e2e` and the manual QA matrix are all green. Then run `npm run release -- 1.0.0 --push` from a clean `main` (the release script from task 8 handles the equal-version case), verify the annotated `v1.0.0` tag exists locally and on the remote, confirm the GitHub Actions `build` → `deploy` run triggered by the tag completes, and fetch the Pages URL to assert HTTP 200 with a valid manifest and a registered SW. Optionally set the custom domain via a `CNAME` file in `dist/` and repository Pages settings only if the user supplied a domain — do not invent one. Update `CHANGELOG.md` with the release date, replace any `TBD` values in README/DEVELOPER_GUIDE with measured numbers, and write the phase SUMMARY capturing Lighthouse scores, bundle size, stress numbers and manual QA results. Mark Phase 5 complete in `.planning/STATE.md` and note `/gsd-complete-milestone` as the next action.
  </action>
  <verify>
    <automated>git rev-parse v1.0.0 && git log -1 --format=%D | grep -q 'tag: v1.0.0' && npm run check:size && npm run check:lighthouse && curl -fsS -o /dev/null -w '%{http_code}' "$PAGES_URL" | grep -q 200</automated>
  </verify>
  <done>Tag `v1.0.0` exists on `main`, GitHub Pages serves the tagged build with a working service worker, docs contain final measured values, and Phase 5 is marked complete.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → service worker | Cached responses can be poisoned or serve stale code after a deploy; SW has unlimited interception power over same-origin fetches. |
| browser → Backup JSON import | User-supplied file crosses into Dexie writes and DOM rendering; markdown explanations are rendered as HTML. |
| app → browser storage API | `navigator.storage.persist()`/`estimate()` and quota exhaustion affect availability of all study data. |
| CI → GitHub Pages | Workflow runs with `id-token: write` and publishes whatever is in `dist/`; a compromised dependency or over-broad permission publishes attacker code. |
| npm registry → dev toolchain | New dev dependencies (Lighthouse, pinned axe-core) enter the build/test path; supply-chain legitimacy must be confirmed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-01 | Tampering | `src/views/ImportView.ts` / `backupRepo.restoreBackup` | high | mitigate | Zod-validate `schemaVersion` and every imported record before writes; keep DOMPurify sanitization on all Markdown fields; cap imported array lengths to the stress envelope (2000/500/10000) to block memory exhaustion. |
| T-05-02 | Information disclosure | `index.html` external font links | medium | mitigate | Remove Google Fonts links and inline `onload` handlers in task 1; add a strict CSP meta/header (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`) and assert zero cross-origin requests in the offline e2e test. |
| T-05-03 | Tampering | generated SW / precache manifest | high | mitigate | Use plugin-generated hashed asset names and a build-derived cache version; delete stale `public/sw.js`; activate handler removes old caches; registration only on secure contexts; e2e asserts precache completeness. |
| T-05-04 | Denial of service | IndexedDB quota with 10k attempts | medium | mitigate | `checkStorageBudget()` at 80% usage, persistent-storage request + Settings display, transactional bulk writes via Dexie, graceful toast (not crash) on `QuotaExceededError`; verify in stress test. |
| T-05-05 | Elevation of privilege | `.github/workflows/deploy.yml` | high | mitigate | `permissions: contents: read, pages: write, id-token: write` only; pinned action majors; `npm ci` from committed lockfile; no third-party actions; no secrets in build env. |
| T-05-06 | Spoofing | release tag `v1.0.0` | medium | mitigate | `scripts/release.mjs` refuses a dirty tree or non-main branch, verifies semver and changelog heading, creates an annotated tag; CI rebuilds from the tag rather than reusing a local `dist/`. |
| T-05-07 | Repudiation | manual QA evidence | low | accept | Single-user local tool with no server-side audit log; phase SUMMARY records device/browser matrix and Lighthouse JSON as sufficient evidence for v1.0. |
| T-05-SC | Tampering | npm/pip/cargo installs | high | mitigate | Task 3 blocking-human checkpoint: verify `lighthouse` and `axe-core` publisher/legitimacy on npmjs.com before adding; reject `[SLOP]`/`[SUS]`; pin exact versions in `package-lock.json`. |
</threat_model>

## Source Coverage Audit

Every source item for Phase 5 is mapped to a task; no items are unplanned.

| Source | Item | Covered by |
|--------|------|-----------|
| GOAL (ROADMAP 208–209) | "Production-hardened v1.0 release with documentation" | Tasks 1–11 |
| REQ 5.1 | file:// limitations + `serve` script | T1 (`scripts/serve.mjs`), T7 (README) |
| REQ 5.1 | SW auto-update + toast | T2 |
| REQ 5.1 | persistent storage + quota warnings | T2 |
| REQ 5.1 | offline fallback page | T2 |
| REQ 5.1 | Lighthouse PWA ≥ 90 | T9 |
| REQ 5.2 | contrast / focus order / ARIA / headings audit | T4, T5 (axe) |
| REQ 5.2 | NVDA+Firefox, VoiceOver+Safari | T5 + T10 `<human-check>` |
| REQ 5.2 | keyboard-only all flows | T4, T5 |
| REQ 5.2 | reduced motion | T5 |
| REQ 5.2 | high contrast toggle | T5 |
| REQ 5.2 | font scale 80–150% | T5 |
| REQ 5.3 | bundle < 5MB gzipped | T6, T9 |
| REQ 5.3 | code splitting / lazy views | T6 |
| REQ 5.3 | Chart.js tree-shaking | T6 (audit: register minimal modules or remove unused dep) |
| REQ 5.3 | virtualized 1000+ lists | T6 |
| REQ 5.3 | debounced search / memoized selectors | T6 |
| REQ 5.4 | README / USER_GUIDE / DEVELOPER_GUIDE / CHANGELOG | T7 |
| REQ 5.4 | GitHub Pages workflow | T8 |
| REQ 5.4 | release script | T8, T11 |
| REQ 5.5 | offline install → study session | T1, T10 |
| REQ 5.5 | export → clear → import integrity | T10 |
| REQ 5.5 | cross-browser latest-2 | T10 (Playwright Chromium/Firefox/WebKit + manual matrix) |
| REQ 5.5 | mobile iOS Safari / Android Chrome | T10 `<human-check>` |
| REQ 5.5 | 2000 q / 500 sessions / 10000 attempts | T10 |
| EXIT (250–258) | all eight release criteria | EC-1 … EC-10 |
| RESEARCH | none (`has_research=false`) | N/A — no research constraints to map |
| CONTEXT | none (`has_context=false`) | Locked decisions from STATE.md decision log honoured by the Boundary section and every task's implementation choice; no deferred ideas introduced |

## Exit Criteria (Measurable)

| # | Criterion | Measurement | Gate task |
|---|-----------|-------------|-----------|
| EC-1 | All Phase 1–4 features still work | `npm run test:run` + `npm run test:e2e` green; all 10 routes render with zero console errors | 1, 6, 10 |
| EC-2 | PWA installs and works offline on desktop + mobile | offline-session + final-QA e2e pass on Chromium/Firefox/WebKit; manual iOS Safari + Android Chrome matrix recorded | 1, 10 |
| EC-3 | Accessibility passes manual + axe-core | zero serious/critical axe violations on 10 routes; NVDA/Firefox and VoiceOver/Safari checklists complete | 4, 5, 10 |
| EC-4 | Bundle &lt; 5MB gzipped | `npm run check:size` exit 0, printed total &lt; 5,242,880 bytes | 6, 9 |
| EC-5 | Lighthouse Perf ≥90, A11y ≥95, BP ≥90, PWA ≥90 | `reports/lighthouse.json` desktop + mobile, no category disabled | 9 |
| EC-6 | Documentation complete | four files exist, all npm commands they cite resolve, no `TBD` left | 7, 11 |
| EC-7 | Deployed to GitHub Pages | Actions run on `v1.0.0` succeeds; `curl` of Pages URL returns 200 with valid manifest + SW | 8, 11 |
| EC-8 | Tagged `v1.0.0` on main | `git rev-parse v1.0.0` resolves to a commit on `main` with annotated message | 11 |
| EC-9 | Data integrity roundtrip | export → clear site data → import deep-compare equals fixture | 10 |
| EC-10 | Stress envelope | 2000 questions / 500 sessions / 10000 attempts seeded; dashboard &lt;500ms, search &lt;200ms, exam start &lt;500ms | 10 |

## Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner task |
|----|------|-------------|--------|------------|-----------|
| R-1 | `file://` users expect PWA install; SW cannot register there | High | Medium | Document `npm run serve` prominently in README/USER_GUIDE; never claim file:// PWA support; e2e runs only over HTTP | 1, 7 |
| R-2 | Generated SW misses a hashed asset → broken offline | Medium | High | `globPatterns` covers all emitted extensions; e2e asserts every precached URL; delete stale fallback SW | 1, 2 |
| R-3 | Update toast fires while a mock exam is in progress → lost work | Medium | High | Defer `location.reload()` until the user confirms; persist session every 5s (existing behavior) and re-check resume on reload; e2e covers update with active session | 2, 10 |
| R-4 | axe-core / Lighthouse toolchain supply chain | Low | High | Task 3 blocking-human legitimacy checkpoint; pinned exact versions | 3, 9 |
| R-5 | A11y fixes change visual layout late in phase | Medium | Medium | Do structural/contrast work (task 4) before axe + font-scale verification (task 5); re-run visual regression via screenshots in the a11y spec | 4, 5 |
| R-6 | Virtualization breaks bulk-select or filtered export | Medium | High | Preserve `selectedIds` semantics and export from the full filtered set, not the rendered window; add regression assertion in final-qa spec | 6, 10 |
| R-7 | GitHub Pages base path wrong for project scope | Medium | Medium | `VITE_BASE` env var, documented; validate Pages URL in task 11 | 8, 11 |
| R-8 | Stress thresholds missed at 10k attempts | Medium | Medium | Record actual numbers, optimize indexes/selectors, do not lower thresholds; escalate as a known limitation before tagging | 6, 10 |
| R-9 | Manual device matrix unavailable (no Safari/iOS hardware) | Medium | Medium | Use Playwright WebKit as automation proxy, record the gap explicitly in SUMMARY and flag to human before tag | 10, 11 |
| R-10 | Scope creep into v1.1 features during polish | High | Medium | Enforce boundary section; defer Anki polish/cloud sync/2025 kisi-kisi to ROADMAP future phases | all |

## Success Metrics

| Metric | Baseline | Target | Source |
|--------|----------|--------|--------|
| Release quality (ROADMAP Phase 5 key metric) | Not measured | Lighthouse PWA ≥90, Bundle &lt;5MB, zero critical bugs | ROADMAP "Success Metrics per Phase" |
| Total gzipped `dist/` | ~1.5MB on disk incl. maps | &lt;5MB gzipped, maps excluded | `npm run check:size` |
| Lighthouse Performance / Accessibility / Best Practices / PWA | Not measured | ≥90 / ≥95 / ≥90 / ≥90 | ROADMAP exit criteria |
| axe-core serious+critical violations | Not measured | 0 on all 10 routes | `tests/e2e/a11y-axe.spec.ts` |
| Offline study completion | Not measured | 1 full session with zero external requests | `tests/e2e/offline-session.spec.ts` |
| Backup roundtrip fidelity | Not verified | 100% field equality after clear-site-data | `tests/e2e/final-qa.spec.ts` |
| Stress envelope | 42 seed questions | 2000 q / 500 sessions / 10000 attempts, thresholds met | `scripts/stress-seed.mjs` |
| Documentation coverage | 0 of 4 docs | 4 of 4 with verified commands | file existence + lint check |
| Release automation | no workflow, no script | 1 deploy workflow + 1 release script, tag v1.0.0 | task 8, 11 |

## Dependency Graph References

Source: ROADMAP.md "Dependency Graph" (lines 296–315) — Phase 5 depends on Phase 4, which depends on Phase 3 and Phase 2, which depend on Phase 1. `STATE.md` marks Phases 1–4 complete, so all upstream inputs (Dexie schema, repositories, three study modes, analytics views, 42 seed questions) are available to this plan.

Within this plan:
```
T1 (tracer: SW + serve + offline e2e)
 ├── T2 (update/storage/fallback) ──────────┐
 ├── T4 (a11y foundations) ── T5 (axe) ─────┤
 ├── T6 (perf: chunks + virtualization) ────┤
 │        └── T8 (deploy + release script) ─┤
 T3 (package legitimacy gate) ──────────────┤
                                            ├── T9 (Lighthouse + size gate)
                                            ├── T7 (docs, uses measured numbers)
                                            └── T10 (final QA, incl. human matrix)
                                                     └── T11 (tag + deploy)
```

ROADMAP parallelization note line 314 says 5.1 + 5.2 + 5.3 can run in parallel by different developers; that holds **only after T1 merges**, because T1 owns `vite.config.ts`, `index.html`, `package.json` and `public/sw.js`. T7 must run after T6/T9 so documentation quotes real numbers. T11 is the single release gate and must not be parallelized.

<verification>
Overall phase verification (run in order before tagging):
1. `npm run lint && npm run test:run && npm run build`
2. `npm run check:size`
3. `npm run test:e2e -- tests/e2e/offline-session.spec.ts tests/e2e/pwa-update.spec.ts tests/e2e/a11y-axe.spec.ts tests/e2e/final-qa.spec.ts --reporter=line`
4. `npm run check:lighthouse` (desktop + mobile, all four categories)
5. Manual matrix from task 10 recorded in the phase SUMMARY
6. `git status --short` clean after all commits; tag `v1.0.0` resolves to `main`
</verification>

<success_criteria>
Phase 5 is complete when EC-1 through EC-10 above are all satisfied, every locked decision from STATE.md is preserved, no deferred/future-phase feature leaked into the release, the four documents are accurate, GitHub Pages serves the tagged build, and the phase SUMMARY records Lighthouse scores, bundle size, stress numbers and manual QA results.
</success_criteria>

<output>
Create `.planning/phases/05-polish-ship-week-6/05-01-SUMMARY.md` when done.
</output>

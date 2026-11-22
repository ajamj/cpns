# Phase 1: Foundation (Week 1) - Context

**Gathered:** 2025-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the complete offline-capable application shell with routing, database, and kisi-kisi registry. This phase delivers: a working Vite + TypeScript project with PWA configured, IndexedDB (Dexie) schema with repositories, kisi-kisi registry module with all 21 topics, hash-based routing with app shell layout, theme system, settings framework, and CI/CD for GitHub Pages deployment. All features must work 100% offline.

</domain>

<decisions>
## Implementation Decisions

### Project Setup & Tooling
- **D-01:** Vanilla TypeScript + Vite (no React/Vue) — **Reversibility:** one-way — Changing framework later requires full rewrite; chosen for minimal bundle, max offline reliability, no framework churn
- **D-02:** ESLint strict TypeScript config + Prettier — **Reversibility:** reversible — Config files can be adjusted without code changes
- **D-03:** Vitest for unit tests, Playwright for e2e — **Reversibility:** reversible — Test runners can be swapped; test files would need migration
- **D-04:** GitHub Actions CI with lint, typecheck, test, build jobs — **Reversibility:** reversible — Workflow YAML can be modified; no code impact

### PWA & Deployment
- **D-05:** Deployment target: GitHub Pages — **Reversibility:** costly — Changing deployment target requires updating GitHub Actions workflow, manifest `start_url`/`scope`, and potentially base path in Vite config; but code itself is portable
- **D-06:** PWA local testing via `npx serve dist` (HTTP) with Chrome flag `--unsafely-treat-insecure-origin-as-secure` for file:// fallback — **Reversibility:** reversible — Dev script only; no production impact
- **D-07:** Workbox via Vite PWA plugin with precache: app shell, kisi-kisi.json, seed-questions.json, all icons — **Reversibility:** reversible — Workbox config in vite.config.ts; can adjust caching strategies

### CSS & Styling
- **D-08:** CSS Custom Properties for design tokens + minimal utility classes (spacing, typography, layout helpers only — no framework) — **Reversibility:** reversible — CSS can be refactored; utility classes are internal
- **D-09:** Light/Dark/System theme via CSS custom properties, persisted in settings (IDB + localStorage mirror) — **Reversibility:** reversible — Theme logic is isolated in settings/hooks

### Database Layer
- **D-10:** Dexie.js for IndexedDB with repository pattern per entity — **Reversibility:** costly — Schema changes require Dexie migrations; repository interfaces are stable but implementation ties to Dexie
- **D-11:** Schema: questions, sessions, attempts, flashcards, settings, backups tables with indexes for common queries — **Reversibility:** one-way — Schema changes need versioned migrations; data migration required for existing users
- **D-12:** Composite key `[sessionId+questionId]` for attempts table — **Reversibility:** one-way — Changing key structure requires migration and data transformation

### Kisi-Kisi Registry
- **D-13:** Static JSON (`public/kisi-kisi.json`) loaded at build time, 21 topics from BMKG official document — **Reversibility:** reversible — JSON can be updated; registry module handles versioning
- **D-14:** Default topic weights: UM=1.0, KH=1.5 (Kemampuan Khusus weighted higher) — **Reversibility:** reversible — Weights are user-configurable in settings
- **D-15:** Registry module provides lookup, validation, grouping by subdomain/category — **Reversibility:** reversible — Pure functions; easy to extend

### Routing & App Shell
- **D-16:** Hash-based router (custom implementation, ~50 lines) — **Reversibility:** reversible — Router is isolated; can swap for library if needed
- **D-17:** Routes: `#/` (dashboard), `#/questions`, `#/practice`, `#/mock-exam`, `#/flashcards`, `#/analytics`, `#/settings`, `#/import`, `#/export` — **Reversibility:** reversible — Route map in single file
- **D-18:** Layout: Header (nav tabs), Main (view outlet), Footer (mobile quick actions) — **Reversibility:** reversible — CSS/HTML structure; no logic coupling

### Settings Framework
- **D-19:** Settings repository with dual persistence: IndexedDB (primary) + localStorage (mirror for instant sync read) — **Reversibility:** reversible — Repository pattern isolates storage
- **D-20:** Phase 1 settings: theme, language, mock exam defaults (duration, question count, topic weights, difficulty mix), flashcard params (SM-2 intervals, daily limit, ease factor), topic weights — **Reversibility:** reversible — Settings schema extensible

### Seed Data
- **D-21:** Create minimal seed set (~50 questions covering all 21 topics) from public BMKG sources (regulations, SOPs, technical guidelines) — **Reversibility:** reversible — Seed is optional import; users can replace
- **D-22:** Seed bundled as `public/seed-questions.json`, auto-import prompt on first run if DB empty — **Reversibility:** reversible — Import logic in onboarding flow

### the agent's Discretion
- **A-01:** Exact Vite/TypeScript/ESLint/Prettier config details — follow modern best practices
- **A-02:** Specific utility class set (spacing scale, typography scale, layout helpers) — keep minimal
- **A-03:** Dexie migration strategy details (versioned upgrades with `upgrade` hooks) — implement standard pattern
- **A-04:** GitHub Actions workflow matrix (Node versions, cache strategy) — use sensible defaults
- **A-05:** PWA manifest details (icons, shortcuts, theme colors) — follow PRD/SRS specs
- **A-06:** Onboarding wizard UX (3-step: kisi-kisi review → import seed → configure mock exam) — implement per PRD flow

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context & Requirements
- `.planning/PROJECT.md` — Project overview, competency map (21 topics), architecture, tech stack, milestones
- `.planning/REQUIREMENTS.md` — PRD with functional requirements (FR-KF-01, FR-KF-02, FR-QB-01..04, FR-SM-01..03, FR-PA-01..04, FR-OP-01..03, FR-SE-01..02), non-functional requirements, acceptance criteria
- `.planning/SRS.md` — Technical specification: DB schema (§3), kisi-kisi registry (§4.1), PWA/Workbox config (§4.7), UI design system (§5), build/deploy (§8)
- `.planning/ROADMAP.md` — Phase 1 tasks (§1.1-1.5), exit criteria, dependency graph, risk register
- `.planning/STATE.md` — Decision log, open questions (OQ-01..08), research summary

### External References (for question authoring in later phases)
- BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I — Official kisi-kisi (21 topics)
- Peraturan BMKG No. 11/2019 — Air quality observation & data management
- Peraturan BMKG No. 4/2022 — Data access policy
- Peraturan Kepala BMKG No. 2/2024 — Competency standards for instrumentation/calibration
- PP No. 46/2012 — MKG observation & data management framework
- UU No. 31/2009 — Meteorology, Climatology, Geofisika law

### Technology References
- Vite PWA Plugin docs: https://vite-pwa-org.netlify.app/
- Workbox strategies: https://developer.chrome.com/docs/workbox/
- Dexie.js docs: https://dexie.org/
- Chart.js tree-shaking: https://www.chartjs.org/docs/latest/getting-started/integration.html

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — this is a greenfield project. All code will be written in Phase 1.

### Established Patterns
- None — no existing codebase patterns to follow.

### Integration Points
- Phase 1 output feeds directly into Phase 2 (Question Bank CRUD uses DB repositories and kisi-kisi registry)
- Settings framework used by all subsequent phases
- Routing and app shell used by all view-level features
- PWA/offline foundation required for all phases

</code_context>

<specifics>
## Specific Ideas

- **Onboarding Wizard**: 3-step flow per PRD §6.1: (1) Review Kisi-Kisi → (2) Import/Seed Questions → (3) Configure Mock Exam → Dashboard
- **PWA Install Prompt**: Custom "Install App" button in header when `beforeinstallprompt` fires; hide after install
- **Theme Toggle**: In header next to install button; cycles Light → Dark → System
- **Mobile Footer Quick Actions**: Floating action buttons for +Question, Mock Exam, Flashcards (PRD §5.2)
- **Offline Verification**: Console log "App ready offline" on successful SW registration + precache complete

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
None — discussion stayed within phase scope.

### Scope Creep Redirects
- **Question CRUD UI** → Phase 2 (Question Bank)
- **Practice/Mock Exam/Flashcard modes** → Phase 3 (Study Modes)
- **Analytics dashboard/charts** → Phase 4 (Analytics)
- **CSV import/export, Anki .apkg export** → Phase 2 (Should Have) / Phase 6
- **Accessibility audit, Lighthouse optimization** → Phase 5 (Polish & Ship)
- **Auto-backup (File System Access API)** → Phase 5 / Phase 6

</deferred>

---

*Phase: 01-Foundation (Week 1)*
*Context gathered: 2025-01-22*
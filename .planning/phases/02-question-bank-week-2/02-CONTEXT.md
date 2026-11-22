# Phase 2: Question Bank (Week 2) - Context

**Gathered:** 2025-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Full-featured question management: create, edit, organize, import, export, search. Builds on Phase 1 foundation (Dexie DB, kisi-kisi registry, routing, settings, app shell). Delivers: question list view with virtualized table, question form modal with Markdown editor, filtering/search sidebar, bulk operations, JSON/CSV/Anki import-export with merge strategies, soft delete with trash view, version history, and ~50 seeded questions from public BMKG sources.

</domain>

<decisions>
## Implementation Decisions

### Carried Forward from Phase 1
- **Vanilla TypeScript + Vite** (D-01) — no React/Vue
- **Dexie.js repositories** (D-10, D-11, D-12) — questions, sessions, attempts, flashcards, settings, backups tables
- **Kisi-kisi registry** (D-13, D-14, D-15) — 21 topics, default weights UM=1.0/KH=1.5
- **Hash-based router** (D-16, D-17) — routes include `#/questions`, `#/import`, `#/export`
- **CSS Custom Properties + minimal utilities** (D-08, D-09)
- **Settings framework** (D-19, D-20) — dual persistence IDB + localStorage
- **Seed data** (D-21, D-22) — ~50 questions from public BMKG sources, auto-import on first run

### Question CRUD UI
- **D-23:** Markdown editor: **SimpleMDE / EasyMDE** — **Reversibility:** costly — Adds ~7KB gzipped dependency; toolbar/preview built-in; CSS customization needed to match design system; replacing later requires rewriting form component
- **D-24:** Virtualized list: **@tanstack/virtual (vanilla)** — **Reversibility:** reversible — 2KB dep; isolates virtualization logic in list component; can swap for custom implementation
- **D-25:** Question form modal with dynamic options (min 2, max 6), Markdown for stem/options/explanation, validation (required fields, ≥1 correct option, valid topic code) — **Reversibility:** reversible — Form logic isolated
- **D-26:** Soft delete with separate Trash view, 30-day auto-purge on app load — **Reversibility:** reversible — Trash is separate view; purge logic in onboarding/app init; can change retention period
- **D-27:** Version history: store last 5 full snapshots per question in `versions` array on question object — **Reversibility:** reversible — Schema change only; versions array can be migrated to separate table later

### Filtering & Search
- **D-28:** Filter sidebar: topic (multi-select tree by category/subdomain), difficulty (1/2/3), flags (bookmarked, needs-review, disputed), mastery (0-3), source, date range — **Reversibility:** reversible — Filter state in URL for shareability
- **D-29:** Full-text search: **Fuse.js (8KB)** — **Reversibility:** costly — Adds dependency; indexes stem, options, explanation, tags; supports fuzzy/prefix/boost; <200ms target on 1000 questions; replacing requires re-implementing search index
- **D-30:** Saved filter presets (user-named), URL sync for shareable filter states — **Reversibility:** reversible — Presets stored in settings

### Bulk Operations
- **D-31:** Multi-select with checkbox column, bulk actions: tag, retag, delete, export, flag/unflag, set needs-review — **Reversibility:** reversible — Operations use existing repository bulk methods
- **D-32:** Progress toast for bulk operations (show count processed) — **Reversibility:** reversible — UI only

### Import/Export
- **D-33:** CSV format: **One row per question, options as columns A-E** — **Reversibility:** one-way — Changing format breaks existing exports/imports; columns: id, topicCode, stem, optionA-E, correctAnswer (A or A,C), explanation, difficulty, source, tags; multi-select as comma-separated letters
- **D-34:** Export: JSON (full fidelity), CSV (spreadsheet), filtered selection — **Reversibility:** reversible — Export uses repository queries + serializers
- **D-35:** Import: drag-drop, format detection (JSON vs CSV), preview modal, **merge strategy: smart default + override** — **Reversibility:** reversible — Auto-match by ID → overwrite; stem similarity >90% → flag for review; new IDs → insert; user reviews flagged items only
- **D-36:** Schema validation (Zod) on import with detailed error report — **Reversibility:** reversible — Zod schemas defined per entity
- **D-37:** Anki .apkg export: **Include in Phase 2 (stretch)** — **Reversibility:** reversible — Minimal .apkg generator (no external dep); zip with collection.anki2 (SQLite) containing notes/cards; topic as deck; ~200 lines

### Seed Data
- **D-38:** Create ~50 curated questions covering all 21 topics from public BMKG sources (regulations, SOPs, technical guidelines) — **Reversibility:** reversible — Seed bundled as `public/seed-questions.json`
- **D-39:** Varied difficulties (1/2/3), sources (BMKG 2024, Self-created, Book references), explanations — **Reversibility:** reversible — Seed is optional import

### the agent's Discretion
- **A-07:** SimpleMDE configuration (toolbar buttons, preview render, image paste handling) — match design system colors/spacing
- **A-08:** @tanstack/virtual integration details (row height, overscan, scroll container) — fixed row height for simplicity
- **A-09:** Fuse.js index fields and weights (stem: 3x, options: 2x, explanation: 1.5x, tags: 1x) — tune for relevance
- **A-10:** Smart merge similarity threshold (90% stem similarity) — adjustable in settings later
- **A-11:** Trash auto-purge trigger (on app load vs daily cron via setTimeout) — app load is simpler
- **A-12:** Anki .apkg SQLite schema (notes, cards, decks, models tables) — follow Anki 2.1 format
- **A-13:** Question form validation UX (inline errors, submit disable, toast on success) — consistent with app patterns

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context & Requirements
- `.planning/PROJECT.md` — Project overview, competency map (21 topics), architecture, tech stack, milestones
- `.planning/REQUIREMENTS.md` — PRD: FR-QB-01..04 (Question Bank), FR-KF-01..02 (Kisi-Kisi), non-functional requirements, acceptance criteria
- `.planning/SRS.md` — Technical spec: DB schema (§3.1-3.4), Question Bank feature (§4.2), Import/Export formats (§4.2.3), UI components (§5.4)
- `.planning/ROADMAP.md` — Phase 2 tasks (§2.1-2.5), exit criteria
- `.planning/STATE.md` — Decision log, open questions
- `.planning/phases/01-foundation-week-1/01-CONTEXT.md` — Phase 1 decisions (D-01..D-22, A-01..A-06)

### External References
- BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I — Official kisi-kisi (21 topics)
- SimpleMDE/EasyMDE docs: https://simplemde.com/ / https://github.com/Ionaru/easy-markdown-editor
- @tanstack/virtual docs: https://tanstack.com/virtual/v8
- Fuse.js docs: https://fusejs.io/
- Zod docs: https://zod.dev/
- Anki .apkg format: https://github.com/ankitects/anki/wiki/Apkg-Format

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- **Dexie repositories** (`src/db/repositories/`) — questionsRepo with CRUD, filters, stats
- **Kisi-kisi registry** (`src/features/kisi-kisi/registry.ts`) — topic lookup, validation, weights
- **Settings repository** (`src/db/repositories/settings.ts`) — dual persistence pattern
- **Router** (`src/core/router.ts`) — hash-based, route map
- **Theme system** (`src/shared/styles/design-tokens.css`, `src/features/settings/`) — CSS custom properties, light/dark/system
- **App shell layout** (`src/views/`, `src/shared/components/`) — Header, Main, Footer, Modal, Toast

### Established Patterns
- **Repository pattern** per entity — isolates DB logic, enables testing
- **Hook-based feature logic** — `useQuestions`, `useQuestionFilters`, etc.
- **Component composition** — small reusable components (Button, Input, Badge, Table, Modal)
- **Event bus** (`src/core/events.ts`) — cross-module communication (question:created, mastery:updated)
- **Type-safe schema** — Zod for runtime validation, TypeScript for compile-time

### Integration Points
- Question list view mounts at `#/questions` route
- Import/Export views at `#/import`, `#/export`
- Question form modal used by list view (create/edit)
- Kisi-kisi registry provides topic options for form select
- Settings repository provides topic weights, user preferences
- Event bus emits `question:created/updated/deleted` for analytics/dashboard updates

</code_context>

<specifics>
## Specific Ideas

- **Question Form Modal**: Large centered modal (max-w-3xl), tabs for Stem/Options/Explanation/Metadata. SimpleMDE for each Markdown field. Live preview toggle. Validation on blur + submit.
- **Question List Table**: Columns: Topic (badge), Stem (truncated, tooltip full), Difficulty (badge), Flags (icons), Mastery (color dot), Actions (edit, duplicate, delete). @tanstack/virtual with fixed 56px row height.
- **Filter Sidebar**: Collapsible on mobile (drawer). Topic tree: Kemampuan Umum → 9 topics, Kemampuan Khusus → 12 topics. Checkbox multi-select. URL sync: `?topics=UM-01,UM-02&difficulty=2&mastery=0,1`.
- **Import Preview Modal**: Two-column diff: Incoming (left) vs Existing (right). Highlight differences. Checkboxes per row with smart default pre-selected. "Apply merge" button.
- **Trash View**: Separate route `#/questions/trash`. Same table but with "Restore" and "Purge" actions. Auto-purge badge showing count of items >30 days.
- **Anki Export**: Settings section "Export to Anki". Options: include explanations as back-of-card, topic as deck name, tags as Anki tags. Generates .apkg download.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
None — discussion stayed within phase scope.

### Scope Creep Redirects
- **Practice/Mock Exam/Flashcard modes** → Phase 3 (Study Modes)
- **Analytics dashboard/charts** → Phase 4 (Analytics)
- **Advanced analytics (forgetting curve, IRT)** → Phase 4 stretch / Phase 7
- **Cloze deletion card generator** → Phase 7
- **Question similarity detection (dedup helper)** → Phase 7
- **Auto-backup (File System Access API)** → Phase 5 / Phase 6
- **Cloud sync** → Phase 8 (v2.0)

</deferred>

---

*Phase: 02-Question Bank (Week 2)*
*Context gathered: 2025-01-22*
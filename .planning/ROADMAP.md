# Roadmap: CPNS BMKG SKB Offline Prep Webapp

**Version**: 1.0  
**Status**: Draft  
**Project**: CPNS BMKG Meteorology & Geophysics Observer Exam Prep  
**Methodology**: GSD (Getting Shit Done) — phased, vertical slices

---

## Phase Overview

| Phase | Name | Duration | Focus | Deliverable |
|-------|------|----------|-------|-------------|
| 1 | Foundation | 1 week | PWA shell, DB, kisi-kisi, routing | Working offline app skeleton |
| 2 | Question Bank | 1 week | CRUD, import/export, tagging, search | Full question management |
| 3 | Study Modes | 1.5 weeks | Practice, Mock Exam (CAT), Flashcards | Three functional study modes |
| 4 | Analytics | 1 week | Dashboard, mastery, trends, export | Progress tracking & insights |
| 5 | Polish & Ship | 1 week | PWA install, accessibility, docs, v1.0 | Production-ready release |

**Total Estimated**: 5.5 weeks (part-time) / 3 weeks (full-time)

---

## Phase 1: Foundation (Week 1)

### Objective
Establish the complete offline-capable application shell with routing, database, and kisi-kisi registry.

### Tasks

#### 1.1 Project Setup & Tooling
- [ ] Initialize Vite + TypeScript project
- [ ] Configure ESLint (strict), Prettier, Vitest, Playwright
- [ ] Set up Vite PWA plugin with Workbox
- [ ] Configure path aliases (`@/`, `@shared/`, `@features/`, etc.)
- [ ] Add GitHub Actions CI (lint, typecheck, test, build)
- [ ] Create `public/` assets: icons (72-512px), manifest.json, seed data files

#### 1.2 Database Layer
- [ ] Define Dexie schema (questions, sessions, attempts, flashcards, settings, backups)
- [ ] Implement repository pattern for each entity
- [ ] Add migration framework (versioned upgrades)
- [ ] Write unit tests for repositories (CRUD, filters, bulk ops)
- [ ] Verify IndexedDB persistence across reloads

#### 1.3 Kisi-Kisi Registry
- [ ] Create `kisi-kisi.json` with all 21 topics (from BMKG official document)
- [ ] Build registry module: lookup, validation, weights, subdomain grouping
- [ ] Add default topic weights (UM=1.0, KH=1.5)
- [ ] Unit tests for registry functions

#### 1.4 Routing & App Shell
- [ ] Hash-based router (`#/`, `#/questions`, `#/practice`, `#/mock-exam`, `#/flashcards`, `#/analytics`, `#/settings`)
- [ ] Layout: Header (nav tabs), Main (view outlet), Footer (mobile quick actions)
- [ ] Theme system: CSS custom properties, light/dark/system, persist in settings
- [ ] Service Worker registration + offline verification
- [ ] PWA install prompt handling

#### 1.5 Settings Framework
- [ ] Settings repository (IDB + localStorage mirror)
- [ ] Settings view with sections: General, Mock Exam, Flashcards, Data, Accessibility
- [ ] Persist: theme, language, mock defaults, flashcard params, topic weights

### Exit Criteria
- [ ] `npm run build` produces working `dist/` with SW precaching all assets
- [ ] App loads and functions 100% offline (file:// or `npx serve dist`)
- [ ] PWA installs on desktop and mobile
- [ ] Database opens, stores/retrieves data correctly
- [ ] Kisi-kisi registry loads, all 21 topics accessible
- [ ] Routing works, theme persists, settings save
- [ ] Zero TypeScript errors, zero lint warnings, all unit tests pass

---

## Phase 2: Question Bank (Week 2)

### Objective
Full-featured question management: create, edit, organize, import, export, search.

### Tasks

#### 2.1 Question CRUD UI
- [ ] Question list view: virtualized table, inline topic/difficulty badges, row actions
- [ ] Question form modal: stem (Markdown), options (dynamic), explanation, metadata
- [ ] Markdown editor with toolbar + live preview (stem, options, explanation)
- [ ] Validation: required fields, at least one correct option, topic code valid
- [ ] Soft delete with trash view + 30-day recovery
- [ ] Version history (last 5 edits) per question

#### 2.2 Filtering & Search
- [ ] Filter sidebar: topic (multi-select tree), difficulty, flags, mastery, source, date range
- [ ] Full-text search: stem, options, explanation, tags (debounced 150ms)
- [ ] Saved filter presets (user-named)
- [ ] URL sync for shareable filter states

#### 2.3 Bulk Operations
- [ ] Multi-select with checkbox column
- [ ] Bulk actions: tag, retag, delete, export, flag/unflag, set needs-review
- [ ] Progress toast for bulk operations

#### 2.4 Import/Export
- [ ] Export: JSON (full fidelity), CSV (spreadsheet), filtered selection
- [ ] Import: drag-drop, format detection, preview modal, merge strategy (skip/overwrite/duplicate)
- [ ] Schema validation (Zod) on import with detailed error report
- [ ] Anki .apkg export (stretch: using `genanki` port or manual generation)

#### 2.5 Seed Data
- [ ] Create ~50 curated starter questions covering all 21 topics
- [ ] Include varied difficulties, sources, explanations
- [ ] Bundle as `public/seed-questions.json` for first-run auto-import

### Exit Criteria
- [ ] Can create/edit/delete 1000+ questions smoothly
- [ ] Import/export roundtrip preserves all data (JSON + CSV)
- [ ] Search returns results in <200ms for 1000 questions
- [ ] Filter combinations work correctly
- [ ] Bulk operations complete without errors
- [ ] Seed data loads on first run (optional user prompt)

---

## Phase 3: Study Modes (Weeks 3-4)

### Objective
Three fully functional study modes matching PRD specifications.

### 3.1 Practice Mode (Week 3, Days 1-3)
- [ ] Configuration modal: topic filter, question count, difficulty mix, prioritize weak
- [ ] Question selection engine (weighted by mastery, difficulty mix)
- [ ] Session view: question card, immediate feedback, explanation toggle
- [ ] Navigation: next/prev, jump-to, flag, mark review
- [ ] Auto-save session state every 5s (survives refresh)
- [ ] Session summary: score, time, per-topic breakdown, weak areas identified
- [ ] Resume incomplete session on app launch

### 3.2 Mock Exam Mode — CAT Simulation (Week 3, Days 4-5 + Week 4, Days 1-2)
- [ ] Configuration: duration (default 90min), question count (50-100), topic weights, difficulty mix
- [ ] Proportional question selection algorithm (validated with unit tests)
- [ ] Full-screen exam view: timer, navigator grid, question card
- [ ] Timer: MM:SS, warnings at 15/5/1 min, auto-submit at 0:00
- [ ] Navigator grid: 10-col responsive, color-coded states, click/keyboard nav
- [ ] Flag + Mark Review distinct actions
- [ ] Submit confirmation with unanswered/flagged count
- [ ] Results view: overall score, per-topic breakdown, time analysis, trend vs previous
- [ ] Review mode: paginated review of all questions with user/correct answers, explanations
- [ ] Export results (JSON + printable HTML)

### 3.3 Flashcard Mode — SM-2 Spaced Repetition (Week 4, Days 3-5)
- [ ] SM-2 engine: ease factor, interval, reps, lapses, due date computation
- [ ] Card types: Q&A, Cloze, Concept
- [ ] Due card query (IndexedDB index on dueDate)
- [ ] Session: daily limit, rating buttons (Again/Hard/Good/Easy), keyboard shortcuts
- [ ] Auto-create cards from questions flagged "needs review"
- [ ] Manual card creation from any text
- [ ] Stats: due today, new, learning, review, mature
- [ ] Parameter tuning UI (initial interval, ease factor bounds, max interval)

### Exit Criteria
- [ ] Practice mode: configurable, instant feedback, session persistence
- [ ] Mock exam: 90-min timer, navigator grid, flag/review, results + review mode
- [ ] Flashcards: SM-2 scheduling correct, due cards query works, daily limit enforced
- [ ] All three modes update question mastery statistics correctly
- [ ] Unit tests cover selection algorithms, timer, SM-2 math

---

## Phase 4: Analytics & Dashboard (Week 5)

### Objective
Comprehensive progress tracking with actionable insights.

### Tasks

#### 4.1 Mastery Dashboard
- [ ] 21-topic mastery grid (color-coded 0-3)
- [ ] Weak areas panel: top 5 topics by (low mastery × high weight)
- [ ] Overall readiness score (weighted mastery) with confidence indicator
- [ ] Study streak: current, longest, heatmap calendar (GitHub style)

#### 4.2 Trend Visualizations
- [ ] Mastery over time: line chart per topic (30d/90d)
- [ ] Mock exam scores: bar chart with trendline
- [ ] Time distribution: donut charts (by mode, topic, difficulty)
- [ ] Question-level: most missed, never attempted, mastered

#### 4.3 Export & Reporting
- [ ] Weekly report: auto-generated Markdown/HTML (template)
- [ ] Exam readiness certificate: shareable image (html2canvas)
- [ ] Data export: CSV per entity (questions, sessions, attempts, flashcards)
- [ ] Dashboard screenshot: PNG capture

#### 4.4 Advanced Analytics (Stretch)
- [ ] Forgetting curve visualization per topic
- [ ] Optimal study time recommendation
- [ ] Question difficulty calibration (IRT-inspired)

### Exit Criteria
- [ ] Dashboard loads in <500ms with 1000 questions
- [ ] All charts render correctly, responsive, accessible
- [ ] Weak area identification matches manual review
- [ ] Exports produce valid, usable files
- [ ] Readiness score correlates with mock exam performance

---

## Phase 5: Polish & Ship (Week 6)

### Objective
Production-hardened v1.0 release with documentation.

### Tasks

#### 5.1 PWA & Offline Hardening
- [ ] Test file:// protocol (document limitations, provide `serve` script)
- [ ] Verify SW update flow: auto-update + toast notification
- [ ] Request persistent storage; handle quota warnings
- [ ] Offline fallback page (though full precache should make it unnecessary)
- [ ] Lighthouse PWA score ≥ 90

#### 5.2 Accessibility (WCAG 2.1 AA)
- [ ] Audit: color contrast, focus order, ARIA labels, heading hierarchy
- [ ] Screen reader testing (NVDA + Firefox, VoiceOver + Safari)
- [ ] Keyboard-only navigation for all flows
- [ ] Reduced motion setting respected
- [ ] High contrast mode toggle
- [ ] Font scale 80%-150% without layout break

#### 5.3 Performance Optimization
- [ ] Bundle analysis: target <5MB gzipped total
- [ ] Code splitting: vendor chunks, lazy-load views
- [ ] Chart.js tree-shaking (only needed controllers)
- [ ] Virtualized lists for 1000+ questions
- [ ] Debounced search, memoized selectors

#### 5.4 Documentation & Distribution
- [ ] README.md: install, usage, architecture, contributing
- [ ] USER_GUIDE.md: study workflows, tips, troubleshooting
- [ ] DEVELOPER_GUIDE.md: adding features, testing, deployment
- [ ] CHANGELOG.md
- [ ] GitHub Pages deployment workflow
- [ ] Release script: version bump, tag, build, deploy

#### 5.5 Final QA
- [ ] Full offline test: install → disconnect → complete study session
- [ ] Data integrity: export → clear site data → import → verify
- [ ] Cross-browser: Chrome, Firefox, Safari, Edge (latest 2)
- [ ] Mobile: iOS Safari, Android Chrome (PWA install, touch targets)
- [ ] Stress test: 2000 questions, 500 sessions, 10000 attempts

### Exit Criteria (v1.0 Release)
- [ ] All Phase 1-4 features working reliably
- [ ] PWA installs and works offline on desktop + mobile
- [ ] Accessibility audit passes (manual + axe-core)
- [ ] Bundle < 5MB gzipped
- [ ] Lighthouse: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 90, PWA ≥ 90
- [ ] Documentation complete
- [ ] Deployed to GitHub Pages with custom domain (optional)
- [ ] Tagged `v1.0.0` on main branch

### Phase 6: 1

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 6 to break down)

---

## Future Phases (Post-v1.0)

### Phase 6: Enhanced Content (v1.1)
- [ ] CSV import/export polish
- [ ] Anki .apkg export
- [ ] Auto-backup (File System Access API)
- [ ] Question version history UI
- [ ] Keyboard shortcuts cheat sheet

### Phase 7: Advanced Learning (v1.2)
- [ ] Cloze deletion card generator
- [ ] Concept extraction from explanations
- [ ] Mock exam PDF report generator
- [ ] Spaced repetition parameter tuning UI
- [ ] Question similarity detection

### Phase 8: Optional Cloud Sync (v2.0)
- [ ] User-hosted sync (WebDAV, S3, GitHub Gist)
- [ ] Conflict resolution (last-write-wins + manual merge)
- [ ] Multi-device progress merge
- [ ] Encrypted backup option

---

## Dependency Graph

```
Phase 1 (Foundation)
    │
    ├──→ Phase 2 (Question Bank) ──→ Phase 3 (Study Modes)
    │                                    │
    │                                    ├──→ Phase 4 (Analytics)
    │                                    │
    └────────────────────────────────────┘
                                         │
                                         → Phase 5 (Polish & Ship)
```

**Parallelization Opportunities**:
- Phase 1.1 (Tooling) + 1.2 (DB) can start simultaneously
- Phase 3.1 (Practice) and 3.2 (Mock Exam) share question selection engine — build engine first
- Phase 4 (Analytics) can begin once Practice + Mock Exam produce session data
- Phase 5.1 (PWA) + 5.2 (A11y) + 5.3 (Perf) can run in parallel by different developers

---

## Risk Register

| Risk | Phase | Probability | Impact | Mitigation |
|------|-------|-------------|--------|------------|
| IndexedDB quota issues | 1,2 | Medium | High | Monitor usage, compress old sessions, warn at 80% |
| CAT interface fidelity gap | 3 | Medium | Medium | Study BKN CAT screenshots early; user acceptance test |
| SM-2 algorithm bugs | 3 | Low | High | Exhaustive unit tests; compare with Anki reference |
| PWA install fails on file:// | 1,5 | High | Medium | Document `npx serve` workaround; test thoroughly |
| Question bank too small | 2 | High | High | Seed 50 questions; easy import; community sharing doc |
| Scope creep | All | High | Medium | Strict phase gates; ROADMAP.md for future |

---

## Success Metrics per Phase

| Phase | Key Metric | Target |
|-------|------------|--------|
| 1 | Offline functionality | 100% features work offline |
| 2 | Question management | CRUD + import/export < 1s for 500 q |
| 3 | Study mode completion | Practice session, Mock exam, Flashcard session all functional |
| 4 | Dashboard utility | Weak areas identified match manual review |
| 5 | Release quality | Lighthouse PWA ≥ 90, Bundle < 5MB, Zero critical bugs |

---

*Next: `/gsd-plan-phase 1` to create detailed task breakdown for Phase 1.*
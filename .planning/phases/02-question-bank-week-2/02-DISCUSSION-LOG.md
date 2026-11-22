# Phase 2: Question Bank (Week 2) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2025-01-22
**Phase:** 2-Question Bank (Week 2)
**Areas discussed:** Markdown Editor, Virtualized List, CSV Format, Search Engine, Merge Strategy UI, Trash & History, Anki Export

---

## Markdown Editor

| Option | Description | Selected |
|--------|-------------|----------|
| Custom lightweight editor | Build our own textarea + toolbar (bold, italic, code, math $$, image paste) + live preview pane. ~200 lines, zero deps, full control. Matches our vanilla TS approach. | |
| SimpleMDE / EasyMDE | Lightweight Markdown editor (7KB gzipped). Built-in toolbar, preview, autosave. But adds a dependency and may need CSS customization to match our design system. | ✓ |
| Plain textarea + keyboard shortcuts | No toolbar, no preview. Just keyboard shortcuts (Ctrl+B, Ctrl+I, etc.) and user types Markdown directly. Minimalist, zero deps, but less discoverable. | |

**User's choice:** SimpleMDE / EasyMDE
**Notes:** Chose SimpleMDE/EasyMDE for built-in toolbar and preview. Accept the ~7KB cost for better UX. Will customize CSS to match design system.

---

## Virtualized List

| Option | Description | Selected |
|--------|-------------|----------|
| @tanstack/virtual (vanilla) | 2KB, framework-agnostic, battle-tested. Handles variable row heights, overscan, smooth scrolling. Need to integrate with our vanilla TS. | ✓ |
| Custom simple virtualization | Build our own: render only visible rows + buffer. ~100 lines. Good enough for fixed-height rows (our table rows are uniform). Simpler, no dep. | |
| No virtualization (render all) | Just render all rows. 1000 questions × ~100px = 100KB DOM. Modern browsers handle this fine. Simplest. Add virtualization only if performance issues. | |

**User's choice:** @tanstack/virtual (vanilla)
**Notes:** Chose @tanstack/virtual for robustness and future-proofing. 2KB is negligible. Fixed row height (56px) simplifies integration.

---

## CSV Format

| Option | Description | Selected |
|--------|-------------|----------|
| One row per question, options as columns A-E | Columns: id, topicCode, stem, optionA, optionB, optionC, optionD, optionE, correctAnswer (A or A,C), explanation, difficulty, source, tags. Matches PRD §3.2.3 CsvRow interface. Multi-select answers as comma-separated letters. | ✓ |
| Normalized: separate rows for options | Two sheets or CSV sections: Questions (id, topicCode, stem, explanation, difficulty, source, tags) + Options (questionId, optionIndex, text, isCorrect). Cleaner for multi-select but more complex import/export. | |
| Support both formats | Auto-detect format on import. Export both formats (user chooses). More flexible but double the implementation effort. | |

**User's choice:** One row per question, options as columns A-E
**Notes:** Matches PRD CsvRow interface. Simple for spreadsheet users. Multi-select as comma-separated letters (e.g., "A,C").

---

## Search Engine

| Option | Description | Selected |
|--------|-------------|----------|
| MiniSearch (2KB) | Tiny full-text search library for client-side. Indexes stem, options, explanation, tags. Supports fuzzy, prefix, boost. Perfect for <200ms target on 1000 questions. | |
| Fuse.js (8KB) | More features (fuzzy, weighted keys, threshold). Larger but more powerful. Good if we want typo tolerance. | ✓ |
| Custom inverted index + Dexie | Build our own: tokenize on write, store inverted index in Dexie, query by token intersection. Zero deps, fully integrated with DB. More code to maintain. | |
| Dexie full-text search extension | Use `dexie-fulltext-search` addon. Leverages DB indexes. But adds dependency and may not support all our fields (options, explanation). | |

**User's choice:** Fuse.js (8KB)
**Notes:** Chose Fuse.js for typo tolerance and weighted keys. Will configure weights: stem 3x, options 2x, explanation 1.5x, tags 1x. 8KB acceptable.

---

## Merge Strategy UI for Import

| Option | Description | Selected |
|--------|-------------|----------|
| Simple radio buttons: Skip / Overwrite / Duplicate | Global choice applied to all conflicts. Fast, simple. User picks once before import. No per-question conflict resolution. | |
| Preview modal with per-question conflict list | Show table: incoming question vs existing (by ID or stem similarity). User can choose per-row: skip, overwrite, keep both. More control but complex UI. | |
| Smart default + override | Auto-match by ID → overwrite; by stem similarity >90% → flag for review; new IDs → insert. User reviews flagged items only. Balances automation and control. | ✓ |

**User's choice:** Smart default + override
**Notes:** Best balance. Auto-match by ID (exact) → overwrite. Stem similarity >90% → flag for review. New IDs → insert. User only reviews flagged items.

---

## Trash & History

| Option | Description | Selected |
|--------|-------------|----------|
| Separate Trash view with 30-day auto-purge | Deleted questions move to trash table/view. UI shows 'Trash' tab. Auto-purge job runs on app load (delete >30 days). Version history: store last 5 full snapshots per question in a versions array. | ✓ |
| Inline deleted flag + filter | No separate trash. Questions have `deletedAt` timestamp. Filter sidebar includes 'Show deleted' toggle. 30-day purge same. Version history: separate versions table linked by questionId. | |
| Minimal: just soft delete flag, no trash UI in Phase 2 | Add `deletedAt` field. Filter shows deleted. Defer trash UI and version history to Phase 2 'Should Have' or Phase 6. Focus on core CRUD first. | |

**User's choice:** Separate Trash view with 30-day auto-purge
**Notes:** Full feature in Phase 2. Trash as separate route `#/questions/trash`. Version history as last 5 snapshots in `versions` array on question object. Auto-purge on app load.

---

## Anki Export

| Option | Description | Selected |
|--------|-------------|----------|
| Include in Phase 2 (stretch) | Use `genanki` logic ported to TS or manual .apkg generation (it's a zip with SQLite + media). Export Q&A cards with topic as deck. Effort: ~1 day. | ✓ |
| Defer to Phase 6 (v1.1) | ROADMAP lists as 'Should Have (v1.1)'. Focus Phase 2 on JSON/CSV. Anki export is niche; most users will use JSON/CSV. | |
| Build minimal .apkg generator (no external dep) | Write our own minimal .apkg creator: zip containing collection.anki2 (SQLite) with notes/cards. ~200 lines. No `genanki` dependency. Good learning exercise. | |

**User's choice:** Include in Phase 2 (stretch)
**Notes:** Build minimal .apkg generator (no external dep). Zip with collection.anki2 (SQLite). Topic as deck. ~200 lines. Stretch goal — if time runs short, defer to Phase 6.

---

## the agent's Discretion

- **A-07:** SimpleMDE configuration (toolbar buttons, preview render, image paste handling) — match design system colors/spacing
- **A-08:** @tanstack/virtual integration details (row height, overscan, scroll container) — fixed row height for simplicity
- **A-09:** Fuse.js index fields and weights (stem: 3x, options: 2x, explanation: 1.5x, tags: 1x) — tune for relevance
- **A-10:** Smart merge similarity threshold (90% stem similarity) — adjustable in settings later
- **A-11:** Trash auto-purge trigger (on app load vs daily cron via setTimeout) — app load is simpler
- **A-12:** Anki .apkg SQLite schema (notes, cards, decks, models tables) — follow Anki 2.1 format
- **A-13:** Question form validation UX (inline errors, submit disable, toast on success) — consistent with app patterns

## Deferred Ideas

- **Practice/Mock Exam/Flashcard modes** → Phase 3 (Study Modes)
- **Analytics dashboard/charts** → Phase 4 (Analytics)
- **Advanced analytics (forgetting curve, IRT)** → Phase 4 stretch / Phase 7
- **Cloze deletion card generator** → Phase 7
- **Question similarity detection (dedup helper)** → Phase 7
- **Auto-backup (File System Access API)** → Phase 5 / Phase 6
- **Cloud sync** → Phase 8 (v2.0)
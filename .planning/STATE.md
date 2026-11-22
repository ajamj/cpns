---
gsd_state_version: "1.0"
milestone: v1.0
milestone_name: Release)
status: unknown
stopped_at: Phase 2 context gathered
last_updated: "2026-11-22T07:32:10.161Z"
state_head: d38d504c484629debeab1eaf50efb12c19f8165c
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State: CPNS BMKG SKB Offline Prep Webapp

**Last Updated**: 2025-01-22  
**Current Phase**: 0 (Planning/Requirements Complete)  
**Next Action**: `/gsd-discuss-phase 1` → `/gsd-plan-phase 1`

---

## Decision Log

| Date | Decision | Rationale | Alternatives Considered |
|------|----------|-----------|------------------------|
| 2025-01-22 | Vanilla TypeScript + Vite (no React/Vue) | Minimal bundle, max offline reliability, no framework churn | React, Preact, Svelte, Solid |
| 2025-01-22 | Dexie.js for IndexedDB | Type-safe, reactive queries, migration support | Raw IndexedDB, idb, localForage |
| 2025-01-22 | Workbox via Vite PWA plugin | Zero-config SW, proven offline strategies | Custom SW, sw-precache |
| 2025-01-22 | Hash-based routing | Works file:// without server | History API (requires server) |
| 2025-01-22 | SM-2 for flashcards | Anki-compatible, well-understood, effective | Leitner, custom, FSRS |
| 2025-01-22 | Chart.js for analytics | Tree-shakeable, accessible, responsive | D3, ApexCharts, Recharts, custom SVG |
| 2025-01-22 | Indonesian primary language | Target exam is in Indonesian | English-only, bilingual UI |
| 2025-01-22 | Single-user, no backend | Personal tool, privacy, simplicity | Multi-user, cloud sync, Firebase |
| 2025-01-22 | 21-topic kisi-kisi from BMKG 2024 | Official source, matches user's list | Custom topics, older syllabus |

---

## Open Questions (Requiring User Input)

| ID | Question | Context | Priority | Status |
|----|----------|---------|----------|--------|
| OQ-01 | Initial question bank: will you provide questions, or should I create a minimal seed set from public sources? | Phase 2 needs starter content | High | Pending |
| OQ-02 | Question format: multiple choice only (A-E), or include multiple-select, true/false, numeric entry? | Affects schema, UI, CAT simulation | High | Pending |
| OQ-03 | Explanations: rich text (HTML/Markdown) or plain text? | Affects editor, rendering, export | Medium | Pending |
| OQ-04 | Spaced repetition: SM-2 (Anki-style) or simpler Leitner box? | SM-2 more complex but more effective | Medium | Pending |
| OQ-05 | Exam simulation fidelity: exact BKN CAT layout clone, or functional equivalent? | Affects UI effort significantly | Medium | Pending |
| OQ-06 | Data export format: JSON only, or also Anki .apkg, CSV for spreadsheet review? | Phase 2 scope | Low | Pending |
| OQ-07 | Target exam cycle: 2025 or 2026? Affects urgency and kisi-kisi version | Timeline planning | Medium | Pending |
| OQ-08 | Preferred deployment: GitHub Pages, Netlify, local file:// only? | Affects PWA testing strategy | Low | Pending |

---

## Research Summary

### Official Sources Confirmed
- **Kisi-kisi**: Lampiran I Pengumuman BMKG No. B/KP.01.00/016/SU/XI/2024 — matches user's 21 topics exactly
- **Exam format**: CAT (Computer Assisted Test), 90 minutes, multiple choice
- **Weighting**: SKB = 60% final (50% CAT technical + 50% LGD/Psikotes/Presentasi)
- **Position**: Pengamat Meteorologi dan Geofisika Ahli Pertama (JF0016503)
- **Formations**: 171 slots across 93 formations, 10 locations (2024 data)

### Key BMKG References for Question Authoring
| Document | Topic Coverage |
|----------|----------------|
| Peraturan BMKG No. 11/2019 | Air quality observation & data management |
| Peraturan BMKG No. 4/2022 | Data access policy |
| Peraturan Kepala BMKG No. 2/2024 | Competency standards for instrumentation/calibration |
| PP No. 46/2012 | MKG observation & data management framework |
| UU No. 31/2009 | Meteorology, Climatology, Geofisika law |
| BMKG SOPs | Nowcasting, verification, calibration procedures |

### CAT Interface Observations (from public info)
- Full-screen browser-based
- Timer prominent top-center
- Question navigator grid (numbered boxes)
- Flag/mark for review per question
- No pause (real exam)
- Auto-submit at time expiry
- Multiple choice A-E format

---

## Technical Decisions Pending Validation

| Area | Decision | Validation Needed |
|------|----------|-------------------|
| Bundle size | Target <5MB gzipped | Measure after Phase 1 build |
| IndexedDB performance | Dexie handles 10k+ records | Load test in Phase 2 |
| SW precache completeness | All assets + kisi-kisi + seed | Verify offline in Phase 1 |
| Chart.js bundle impact | Tree-shake to ~50KB | Analyze in Phase 4 |
| file:// PWA limitations | Service Worker may not register | Test early; document workaround |

---

## Current Artifacts

| File | Status | Description |
|------|--------|-------------|
| `.planning/PROJECT.md` | ✅ Complete | Project context, architecture, competency map |
| `.planning/REQUIREMENTS.md` | ✅ Complete | PRD with 21 topics, 3 study modes, offline specs |
| `.planning/SRS.md` | ✅ Complete | Technical spec: DB, engines, UI, PWA, testing |
| `.planning/ROADMAP.md` | ✅ Complete | 5-phase plan, 5.5 weeks, task breakdown |
| `.planning/STATE.md` | 📝 This file | Project memory, decisions, open questions |

---

## Next Steps

1. **User Review**: Confirm PRD/SRS alignment; answer Open Questions (OQ-01 to OQ-08)
2. **Phase 1 Kickoff**: `/gsd-discuss-phase 1` to clarify any ambiguities
3. **Detailed Planning**: `/gsd-plan-phase 1` to create `tasks/todo.md` with atomic tasks
4. **Execution**: `/gsd-execute-phase 1` to build Foundation

---

## Notes for Future Sessions

- **Kisi-kisi version**: Lock to BMKG 2024 (2024.1). If 2025 cycle publishes new kisi-kisi, create migration.
- **Question schema extensibility**: Designed for multi-select (correctAnswer: number[]). If true/false or numeric added, extend Option type.
- **Mock exam question selection**: Algorithm in SRS §4.4.2 is deterministic given seed — useful for reproducible practice exams.
- **Mastery computation**: Simple heuristic in SRS §4.6.1. Can upgrade to Elo/IRT later without schema change.
- **Backup schema versioning**: Export includes `schemaVersion` and `kisiKisi` for self-contained restore across versions.

---

*This state file is the project's long-term memory. Update it at each phase gate and major decision point.*

## Session

**Last session:** 2026-11-22T07:32:09.615Z
**Stopped at:** Phase 2 context gathered
**Resume file:** .planning/phases/02-question-bank-week-2/02-CONTEXT.md

# Project: CPNS BMKG Meteorology & Geophysics Observer Exam Prep Webapp

## Project Overview
An offline-first web application for self-study and practice for the **Seleksi Kompetensi Bidang (SKB)** CPNS examination for the position of **Pengamat Meteorologi dan Geofisika Ahli Pertama** at Badan Meteorologi, Klimatologi, dan Geofisika (BMKG).

## Target User
- **Primary**: Self (single user) preparing for CPNS BMKG 2025/2026 SKB exam
- **Role**: Aspiring Pengamat Meteorologi dan Geofisika Ahli Pertama
- **Context**: Offline usage, self-paced learning, exam simulation

## Problem Statement
The CPNS BMKG SKB exam for Pengamat Meteorologi dan Geofisika covers 21 competency topics (9 General + 12 Specialized) across meteorology, climatology, air quality, and geophysics. Current study materials are scattered across PDFs, regulations, and textbooks. No dedicated offline practice tool exists that:
- Maps questions to the official kisi-kisi
- Provides CAT-style exam simulation
- Tracks progress per competency area
- Works completely offline

## Success Criteria
1. **Complete kisi-kisi coverage**: All 21 topics represented with tagged questions
2. **CAT simulation**: Timed, randomized exam mode mimicking BKN CAT interface
3. **Offline-first**: Full functionality without internet (PWA + IndexedDB)
4. **Progress tracking**: Per-topic mastery scores, weak area identification
5. **Study modes**: Flashcards, practice questions, mock exams, review sessions
6. **Data persistence**: Local storage survives browser restarts, export/import backup

## Scope (MVP)
### In Scope
- Question bank management (CRUD, import/export JSON/CSV)
- 3 study modes: Practice, Mock Exam, Flashcard
- Per-topic analytics dashboard
- PWA with service worker for offline use
- Export/import study data (JSON)
- Dark/light theme, Indonesian language

### Out of Scope (Future Phases)
- Multi-user/cloud sync
- AI-generated explanations
- Community features
- Mobile app (native)
- SKD (TWK/TIU/TKP) practice — separate exam

## Technical Constraints
- **Offline-only**: No backend, no authentication, no external API calls at runtime
- **Browser target**: Modern Chrome/Edge/Firefox (last 2 versions)
- **Storage**: IndexedDB (via Dexie.js or idb) for question bank + progress
- **Bundle size**: < 5MB gzipped for fast offline load
- **No build step required for distribution**: Single HTML file or static folder deployable to GitHub Pages, file://, or local server

## Key References
- **Official Kisi-kisi**: BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I
- **Exam Format**: CAT (Computer Assisted Test), 90 minutes, multiple choice
- **Weighting**: SKB = 60% of final score (50% CAT technical + 50% LGD/Psikotes/Presentasi)
- **Regulations**: 
  - Peraturan BMKG No. 11/2019 (Pengamatan & Pengelolaan Data Kualitas Udara)
  - Peraturan BMKG No. 4/2022 (Kebijakan Pengaksesan Data MKG)
  - Peraturan Kepala BMKG No. 2/2024 (Standar Kompetensi Kerja Khusus)
  - PP No. 46/2012 (Penyelenggaraan Pengamatan & Pengelolaan Data MKG)
  - UU No. 31/2009 (Meteorologi, Klimatologi, dan Geofisika)

## Competency Map (21 Topics)

### Kemampuan Umum (9)
| Code | Topic | Sub-domain |
|------|-------|------------|
| UM-01 | Pengenalan ilmu meteorologi dasar | Meteorology |
| UM-02 | Pengolahan data meteorologi | Meteorology |
| UM-03 | Prediksi cuaca | Meteorology |
| UM-04 | Pengertian ilmu klimatologi-kualitas udara dasar | Climatology/Air Quality |
| UM-05 | Prakiraan iklim ekstrim | Climatology |
| UM-06 | Pengenalan ilmu geofisika dasar | Geophysics |
| UM-07 | Sedimentologi dan stratigrafi | Geophysics/Geology |
| UM-08 | Peralatan teknologi MKG | Instrumentation |
| UM-09 | Kalibrasi peralatan teknologi MKG | Instrumentation |

### Kemampuan Khusus (12)
| Code | Topic | Sub-domain |
|------|-------|------------|
| KH-01 | Model prakiraan meteorologi | Meteorology |
| KH-02 | Peralatan operasional meteorologi | Meteorology |
| KH-03 | Analisis meteorologi kompleks | Meteorology |
| KH-04 | Pengolahan data klimatologi tingkat lanjutan | Climatology |
| KH-05 | Analisis klimatologi kompleks | Climatology |
| KH-06 | Iklim ekstrim | Climatology |
| KH-07 | Teknis operasional geofisika | Geophysics |
| KH-08 | Pengolahan data geofisika | Geophysics |
| KH-09 | Analisis geofisika kompleks | Geophysics |
| KH-10 | Pengoperasian peralatan teknologi canggih/modern | Instrumentation |
| KH-11 | Pengujian peralatan teknologi MKG | Instrumentation |
| KH-12 | Kalibrasi peralatan teknologi canggih/modern | Instrumentation |

## Project Structure (Planned)
```
/cpns
├── .planning/
│   ├── PROJECT.md          # This file
│   ├── REQUIREMENTS.md     # PRD
│   ├── SRS.md              # Software Requirements Specification
│   ├── ROADMAP.md          # Phase breakdown
│   └── STATE.md            # Project memory
├── public/
│   ├── index.html          # Main entry (PWA)
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service worker
│   └── icons/              # PWA icons
├── src/
│   ├── app.ts              # Main app bootstrap
│   ├── db/                 # IndexedDB schema & ops
│   ├── features/
│   │   ├── question-bank/  # CRUD, import/export
│   │   ├── practice/       # Practice mode
│   │   ├── mock-exam/      # CAT simulation
│   │   ├── flashcards/     # Spaced repetition
│   │   └── analytics/      # Progress dashboard
│   ├── shared/
│   │   ├── components/     # Reusable UI
│   │   ├── hooks/          # Shared logic
│   │   └── utils/          # Helpers
│   └── styles/             # CSS/Design system
├── data/
│   ├── kisi-kisi.json      # Competency definitions
│   └── sample-questions/   # Starter question sets
├── package.json
├── tsconfig.json
├── vite.config.ts          # Build config
└── README.md
```

## Technology Stack
- **Framework**: Vanilla TypeScript + Vite (no React/Vue — minimal bundle, max offline reliability)
- **Storage**: Dexie.js (IndexedDB wrapper)
- **PWA**: Workbox (via Vite PWA plugin)
- **Styling**: CSS Custom Properties + minimal utility classes
- **Charts**: Chart.js (treemap for topic mastery) or custom SVG
- **Testing**: Vitest (unit), Playwright (e2e)
- **Lint/Format**: ESLint + Prettier

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Question bank quality/quantity | High | High | Seed with curated questions; import from user's own notes; community sharing via JSON |
| CAT interface fidelity | Medium | Medium | Study BKN CAT screenshots; replicate key behaviors (timer, nav, flag, submit) |
| Offline PWA installation issues | Low | High | Test file:// protocol; provide simple HTTP server script; clear install instructions |
| Data loss on browser clear | Medium | High | Prominent export/backup UI; auto-export reminder; IndexedDB persistence best practices |
| Scope creep | High | Medium | Strict MVP gate; future phases in ROADMAP.md |

## Milestones
| Milestone | Target | Deliverable |
|-----------|--------|-------------|
| M1: Foundation | Week 1 | PWA shell, DB schema, kisi-kisi data, basic routing |
| M2: Question Bank | Week 2 | CRUD, import/export, tagging, search/filter |
| M3: Study Modes | Week 3 | Practice, Mock Exam (CAT), Flashcards |
| M4: Analytics | Week 4 | Dashboard, progress tracking, weak areas |
| M5: Polish & Ship | Week 5 | PWA install, offline testing, docs, v1.0 release |

## Acceptance Criteria (Project Level)
- [ ] App loads and works fully offline (file:// or GitHub Pages)
- [ ] All 21 competency topics selectable for study/exam
- [ ] Mock exam: 90 min timer, 50-100 questions, random per topic, flag/review, submit with score breakdown
- [ ] Practice mode: instant feedback, explanation field, topic-filtered
- [ ] Progress persisted across sessions (IndexedDB)
- [ ] Export/import full study data (questions + progress)
- [ ] PWA installable on desktop/mobile
- [ ] Bundle < 5MB gzipped
- [ ] Zero console errors in production build

## Open Questions
1. **Initial question bank**: Will you provide questions, or should I create a minimal seed set from public sources?
2. **Question format**: Multiple choice only (A-E), or include multiple-select, true/false, numeric entry?
3. **Explanations**: Rich text (HTML/Markdown) or plain text?
4. **Spaced repetition algorithm**: SM-2 (Anki-style) or simpler Leitner box?
5. **Exam simulation fidelity**: Exact BKN CAT layout clone, or functional equivalent?
6. **Data export format**: JSON only, or also Anki .apkg, CSV for spreadsheet review?

---
*Generated via GSD new-project workflow. Next: `/gsd-discuss-phase 1` to clarify approach, then `/gsd-plan-phase 1` for detailed planning.*
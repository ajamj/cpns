# Software Requirements Specification (SRS)
## CPNS BMKG Meteorology & Geophysics Observer Exam Prep Webapp

**Version**: 1.0  
**Status**: Draft for Review  
**Date**: 2025-01-22  
**Project**: CPNS BMKG SKB Offline Prep Tool  
**Related**: REQUIREMENTS.md (PRD), PROJECT.md

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the technical implementation requirements for the CPNS BMKG SKB offline preparation webapp. It translates the product requirements (PRD) into actionable technical specifications for development.

### 1.2 Scope
- **System**: Client-side Progressive Web Application (PWA)
- **Platform**: Modern web browsers (Chrome/Edge/Firefox/Safari latest 2 versions)
- **Architecture**: Single-page application (SPA) with offline-first design
- **Data**: Local-only (IndexedDB), no backend services

### 1.3 Definitions & Acronyms
| Acronym | Definition |
|---------|------------|
| SRS | Software Requirements Specification |
| PRD | Product Requirements Document |
| PWA | Progressive Web App |
| SW | Service Worker |
| IDB | IndexedDB |
| CAT | Computer Assisted Test |
| SKB | Seleksi Kompetensi Bidang |
| BMKG | Badan Meteorologi, Klimatologi, dan Geofisika |
| UUID | Universally Unique Identifier (v4) |
| SM-2 | SuperMemo 2 Spaced Repetition Algorithm |

### 1.4 References
- [PRD](./REQUIREMENTS.md) — Product requirements
- [PROJECT.md](./PROJECT.md) — Project context & architecture
- BMKG Kisi-Kisi Official: Lampiran I Pengumuman No. B/KP.01.00/016/SU/XI/2024
- W3C PWA Guidelines: https://web.dev/progressive-web-apps/
- IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Workbox: https://developer.chrome.com/docs/workbox/

---

## 2. System Architecture

### 2.1 High-Level Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Runtime                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Service    │  │   IndexedDB │  │   App Shell (HTML/  │  │
│  │  Worker     │◄─┤  (Dexie.js) │  │   CSS/JS Modules)   │  │
│  │  (Workbox)  │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                    │              │
│         ▼                ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Application Layer (TypeScript)         │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
│  │  │ Routing  │ │ State    │ │ Features │ │ Shared │  │    │
│  │  │ (hash)   │ │ (signals)│ │ Modules  │ │ Utils  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Module Structure
```
src/
├── app.ts                    # Entry point, SW registration, routing init
├── core/
│   ├── config.ts             # App constants, feature flags
│   ├── events.ts             # Event bus (mitt) for cross-module comm
│   ├── i18n.ts               # Indonesian/English translations
│   └── utils.ts              # Pure helpers (date, id, validation)
├── db/
│   ├── schema.ts             # Dexie schema definition
│   ├── dexie.ts              # Database instance + migrations
│   ├── repositories/         # Repository pattern per entity
│   │   ├── questions.ts
│   │   ├── sessions.ts
│   │   ├── attempts.ts
│   │   ├── flashcards.ts
│   │   └── settings.ts
│   └── backup.ts             # Export/import logic
├── features/
│   ├── kisi-kisi/            # Static topic registry
│   │   ├── data/kisi-kisi.json
│   │   ├── registry.ts       # Topic lookup, weights, validation
│   │   └── types.ts
│   ├── question-bank/
│   │   ├── components/       # QuestionForm, QuestionList, ImportExport
│   │   ├── hooks/            # useQuestions, useQuestionFilters
│   │   ├── services/         # CRUD, search, stats computation
│   │   └── types.ts
│   ├── practice/
│   │   ├── components/       # PracticeView, QuestionCard, Navigator
│   │   ├── hooks/            # usePracticeSession
│   │   ├── engine/           # Session logic, scoring
│   │   └── types.ts
│   ├── mock-exam/
│   │   ├── components/       # ExamView, Timer, NavigatorGrid, Results
│   │   ├── hooks/            # useMockExam
│   │   ├── engine/           # CAT simulation logic, question selection
│   │   └── types.ts
│   ├── flashcards/
│   │   ├── components/       # FlashcardView, Card, RatingButtons
│   │   ├── hooks/            # useFlashcardSession
│   │   ├── engine/           # SM-2 algorithm, scheduling
│   │   └── types.ts
│   ├── analytics/
│   │   ├── components/       # Dashboard, Charts, WeakAreas, Trends
│   │   ├── hooks/            # useMastery, useTrends
│   │   ├── engine/           # Mastery computation, projections
│   │   └── types.ts
│   └── settings/
│       ├── components/       # SettingsPanel, ThemeToggle, etc.
│       ├── hooks/            # useSettings
│       └── types.ts
├── shared/
│   ├── components/           # Button, Input, Modal, Toast, Table, Tabs
│   ├── hooks/                # useLocalStorage, useDebounce, useMediaQuery
│   ├── styles/               # design-tokens.css, components.css, utilities.css
│   └── types/                # Shared type definitions
└── views/                    # Page-level components (Dashboard, Study, Exam, etc.)
    ├── DashboardView.ts
    ├── QuestionBankView.ts
    ├── PracticeView.ts
    ├── MockExamView.ts
    ├── FlashcardView.ts
    ├── AnalyticsView.ts
    └── SettingsView.ts
```

### 2.3 Technology Stack Details
| Layer | Technology | Version | Rationale |
|-------|------------|---------|-----------|
| Build | Vite | 5.x | Fast dev, optimized production build, PWA plugin |
| Language | TypeScript | 5.x | Strict typing, zero `any`, exhaustive checks |
| Runtime | Vanilla TS | — | No framework overhead; minimal bundle |
| Storage | Dexie.js | 4.x | Type-safe IndexedDB wrapper, migrations |
| PWA | Vite PWA Plugin + Workbox | 0.20+ / 7.x | Zero-config SW, precaching, runtime strategies |
| Charts | Chart.js | 4.x | Tree-shakeable, responsive, accessible |
| Date | date-fns | 3.x | Modular, tree-shakeable, locale support |
| UUID | crypto.randomUUID() | Native | No dependency, crypto-secure |
| Testing | Vitest + Playwright | Latest | Unit + E2E, fast, TypeScript native |
| Lint | ESLint + @typescript-eslint | 8.x | Strict rules, type-aware |
| Format | Prettier | 3.x | Consistent formatting |

### 2.4 Data Flow Patterns

#### 2.4.1 Unidirectional Data Flow (Features)
```
User Action → Hook/Service → Repository → Dexie → IndexedDB
                ↓
           Event Bus → Other Hooks → UI Update (Signals)
```

#### 2.4.2 State Management
- **Global**: Settings, current user preferences (Signals via `@preact/signals` or custom tiny signal)
- **Feature-scoped**: Each feature owns its state via hooks
- **Derived**: Computed values (mastery, stats) via memoized selectors
- **Persistence**: Auto-save via repository `subscribe` → debounced write

---

## 3. Database Specification (IndexedDB via Dexie)

### 3.1 Schema Definition
```typescript
// src/db/schema.ts
import { Dexie, type Table } from 'dexie';
import type { Question, Session, Attempt, Flashcard, Settings, BackupMeta } from '../shared/types';

export class AppDatabase extends Dexie {
  questions!: Table<Question, string>;
  sessions!: Table<Session, string>;
  attempts!: Table<Attempt, [string, string]>; // composite: [sessionId, questionId]
  flashcards!: Table<Flashcard, string>;
  settings!: Table<Settings, string>;
  backups!: Table<BackupMeta, number>; // auto-increment timestamp

  constructor() {
    super('cpns-bmgk-db');
    this.version(1).stores({
      questions: 'id, topicCode, difficulty, source, createdAt, *tags, masteryLevel',
      sessions: 'id, mode, startedAt, completedAt, topicCodes',
      attempts: '[sessionId+questionId], sessionId, questionId, isCorrect, timestamp',
      flashcards: 'id, questionId, dueDate, interval, easeFactor, reps, lapses',
      settings: 'key',
      backups: '++id, createdAt, schemaVersion',
    });
  }
}

export const db = new AppDatabase();
```

### 3.2 Entity Types (Shared)
```typescript
// src/shared/types/entities.ts

export interface Question {
  id: string;
  topicCode: TopicCode;           // 'UM-01' | 'UM-02' | ... | 'KH-12'
  stem: string;                   // Markdown
  options: QuestionOption[];
  correctAnswer: number[];        // Indices of correct options
  explanation?: string;           // Markdown
  difficulty: Difficulty;         // 1 | 2 | 3
  source?: string;
  tags: string[];
  flags: QuestionFlags;
  metadata: QuestionMetadata;
  statistics: QuestionStatistics;
}

export interface QuestionOption {
  id: string;
  text: string;                   // Markdown
  isCorrect: boolean;
}

export interface QuestionFlags {
  bookmarked: boolean;
  needsReview: boolean;
  disputed: boolean;
}

export interface QuestionMetadata {
  createdAt: string;              // ISO 8601
  updatedAt: string;
  version: number;
  author: 'user' | 'import';
}

export interface QuestionStatistics {
  totalAttempts: number;
  correctAttempts: number;
  avgTimeMs: number;
  lastAttemptedAt?: string;
  masteryLevel: MasteryLevel;     // 0 | 1 | 2 | 3
}

export type MasteryLevel = 0 | 1 | 2 | 3; // New, Learning, Review, Mastered
export type Difficulty = 1 | 2 | 3;
export type TopicCode = `UM-${string}` | `KH-${string}`;

export interface Session {
  id: string;
  mode: SessionMode;              // 'practice' | 'mock-exam' | 'flashcard'
  startedAt: string;
  completedAt?: string;
  config: SessionConfig;
  topicCodes: TopicCode[];
  summary?: SessionSummary;
}

export type SessionMode = 'practice' | 'mock-exam' | 'flashcard';

export interface SessionConfig {
  // Practice
  questionCount?: number;
  filter?: QuestionFilter;
  // Mock Exam
  durationMinutes?: number;
  questionSelection?: 'weighted' | 'proportional' | 'custom';
  topicWeights?: Record<TopicCode, number>;
  // Flashcard
  dailyLimit?: number;
  algorithmParams?: SM2Params;
}

export interface SessionSummary {
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  scorePercent: number;
  timeSpentMs: number;
  perTopic: Record<TopicCode, TopicSessionStats>;
}

export interface TopicSessionStats {
  attempted: number;
  correct: number;
  avgTimeMs: number;
}

export interface Attempt {
  sessionId: string;
  questionId: string;
  userAnswer: number[];           // Selected option indices
  isCorrect: boolean;
  timeMs: number;
  timestamp: string;
  flagged: boolean;
  markedForReview: boolean;
}

export interface Flashcard {
  id: string;
  questionId?: string;            // Link to source question (optional)
  front: string;                  // Markdown
  back: string;                   // Markdown
  type: 'qa' | 'cloze' | 'concept';
  // SM-2 fields
  dueDate: string;                // ISO date (YYYY-MM-DD)
  interval: number;               // Days
  easeFactor: number;             // Default 2.5
  reps: number;                   // Successful repetitions
  lapses: number;                 // Times failed
  lastReviewed?: string;          // ISO 8601
  createdAt: string;
  updatedAt: string;
}

export interface SM2Params {
  initialInterval: number;        // Days (default 1)
  secondInterval: number;         // Days (default 6)
  easyBonus: number;              // Multiplier (default 1.3)
  hardPenalty: number;            // Multiplier (default 1.2)
  minEaseFactor: number;          // Default 1.3
  maxInterval: number;            // Days (default 36500)
}

export interface Settings {
  key: string;
  value: unknown;
}

// Known setting keys
export type SettingKey = 
  | 'theme'                      // 'light' | 'dark' | 'system'
  | 'language'                   // 'id' | 'en'
  | 'mockExamDefaults'           // MockExamDefaults
  | 'flashcardParams'            // SM2Params
  | 'notificationsEnabled'       // boolean
  | 'autoBackupEnabled'          // boolean
  | 'autoBackupIntervalDays'     // number
  | 'fontScale'                  // number (0.8-1.5)
  | 'reducedMotion'              // boolean
  | 'highContrast'               // boolean
  | 'topicWeights';              // Record<TopicCode, number>

export interface MockExamDefaults {
  durationMinutes: number;
  questionCount: number;
  topicWeights: Record<TopicCode, number>;
  difficultyMix: Record<Difficulty, number>; // percentages summing to 100
}

export interface BackupMeta {
  id?: number;
  createdAt: string;
  schemaVersion: number;
  appVersion: string;
  fileName: string;
  sizeBytes: number;
  recordCounts: {
    questions: number;
    sessions: number;
    flashcards: number;
  };
}

export interface ExportData {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: {
    questions: Question[];
    sessions: Session[];
    attempts: Attempt[];
    flashcards: Flashcard[];
    settings: Settings[];
    kisiKisi: KisiKisiTopic[];
  };
}
```

### 3.3 Migration Strategy
```typescript
// src/db/migrations.ts
// Version 1: Initial schema (as above)
// Version 2+: Add new indexes, fields, or tables
// Example v2: Add 'sourceUrl' to Question, 'deviceId' to Session
db.version(2).stores({
  questions: 'id, topicCode, difficulty, source, createdAt, *tags, masteryLevel, sourceUrl',
  sessions: 'id, mode, startedAt, completedAt, topicCodes, deviceId',
  // ... other stores unchanged
}).upgrade(tx => {
  // Migrate existing questions: sourceUrl = ''
  return tx.table('questions').toCollection().modify(q => { q.sourceUrl = ''; });
});
```

### 3.4 Repository Pattern
```typescript
// src/db/repositories/questions.ts
import { db } from '../dexie';
import type { Question, QuestionFilter, QuestionStatistics } from '../../shared/types';

export const questionsRepo = {
  // CRUD
  getAll: () => db.questions.toArray(),
  getById: (id: string) => db.questions.get(id),
  add: (q: Question) => db.questions.add(q),
  put: (q: Question) => db.questions.put(q),
  delete: (id: string) => db.questions.delete(id),
  bulkAdd: (qs: Question[]) => db.questions.bulkAdd(qs),
  bulkPut: (qs: Question[]) => db.questions.bulkPut(qs),
  bulkDelete: (ids: string[]) => db.questions.bulkDelete(ids),

  // Query
  getByTopic: (topicCode: string) => db.questions.where('topicCode').equals(topicCode).toArray(),
  getByIds: (ids: string[]) => db.questions.where('id').anyOf(ids).toArray(),
  search: (query: string) => db.questions
    .filter(q => q.stem.includes(query) || q.options.some(o => o.text.includes(query)) || q.tags.some(t => t.includes(query)))
    .toArray(),
  
  // Filtered list with pagination
  getFiltered: (filter: QuestionFilter, limit = 50, offset = 0) => {
    let coll = db.questions.orderBy('createdAt').reverse();
    if (filter.topicCodes?.length) coll = coll.filter(q => filter.topicCodes!.includes(q.topicCode));
    if (filter.difficulty) coll = coll.filter(q => q.difficulty === filter.difficulty);
    if (filter.flags?.bookmarked) coll = coll.filter(q => q.flags.bookmarked);
    if (filter.flags?.needsReview) coll = coll.filter(q => q.flags.needsReview);
    if (filter.masteryLevels?.length) coll = coll.filter(q => filter.masteryLevels!.includes(q.statistics.masteryLevel));
    return coll.offset(offset).limit(limit).toArray();
  },

  // Statistics
  getStatsByTopic: async (): Promise<Record<string, QuestionStatistics>> => {
    const all = await db.questions.toArray();
    return all.reduce((acc, q) => {
      if (!acc[q.topicCode]) acc[q.topicCode] = { total: 0, mastered: 0, learning: 0, new: 0, avgMastery: 0 };
      acc[q.topicCode].total++;
      if (q.statistics.masteryLevel === 3) acc[q.topicCode].mastered++;
      else if (q.statistics.masteryLevel >= 1) acc[q.topicCode].learning++;
      else acc[q.topicCode].new++;
      return acc;
    }, {} as Record<string, QuestionStatistics>);
  },

  // Mastery update (called after each attempt)
  updateMastery: async (questionId: string, isCorrect: boolean) => {
    const q = await db.questions.get(questionId);
    if (!q) return;
    const stats = q.statistics;
    stats.totalAttempts++;
    if (isCorrect) stats.correctAttempts++;
    // Simple mastery: 3+ correct in a row → mastered; wrong → reset to learning
    // More sophisticated: use SM-2-like logic or Elo rating
    if (isCorrect) {
      stats.masteryLevel = Math.min(3, stats.masteryLevel + 1);
    } else {
      stats.masteryLevel = Math.max(1, stats.masteryLevel - 1);
    }
    q.metadata.updatedAt = new Date().toISOString();
    q.metadata.version++;
    await db.questions.put(q);
  },
};
```

---

## 4. Feature Specifications

### 4.1 Kisi-Kisi Registry (Static Data)

#### 4.1.1 Data File: `src/features/kisi-kisi/data/kisi-kisi.json`
```json
{
  "version": "2024.1",
  "source": "BMKG Pengumuman No. B/KP.01.00/016/SU/XI/2024 Lampiran I",
  "position": "Pengamat Meteorologi dan Geofisika Ahli Pertama (JF0016503)",
  "categories": [
    {
      "id": "umum",
      "label": "Kemampuan Umum",
      "topics": [
        {"code": "UM-01", "title": "Pengenalan ilmu meteorologi dasar", "subdomain": "meteorology", "description": "Dasar-dasar meteorologi: composisi atmosfer, lapisan atmosfer, tekanan, suhu, kelembaban, angin, awan, curah hujan, gelombang laut"},
        {"code": "UM-02", "title": "Pengolahan data meteorologi", "subdomain": "meteorology", "description": "Pengumpulan, validasi, kualitas data, homogenisasi, analisis statistik data observasi cuaca"},
        {"code": "UM-03", "title": "Prediksi cuaca", "subdomain": "meteorology", "description": "Metode prediksi: numerik (NWP), statistik, nowcasting, ensemble, verifikasi prediksi"},
        {"code": "UM-04", "title": "Pengertian ilmu klimatologi-kualitas udara dasar", "subdomain": "climatology", "description": "Unsur iklim, klasifikasi iklim, parameter kualitas udara (PM2.5, PM10, SO2, NO2, O3, CO), standar baku mutu udara"},
        {"code": "UM-05", "title": "Prakiraan iklim ekstrim", "subdomain": "climatology", "description": "El Nino/La Nina, IOD, MJO, iklim ekstrem: kekeringan, banjir, gelombang panas, hujan ekstrem"},
        {"code": "UM-06", "title": "Pengenalan ilmu geofisika dasar", "subdomain": "geophysics", "description": "Gempabumi, tsunami, gravitasi, magnet bumi, kelistrikan udara, tanda waktu (hilal, gerhana)"},
        {"code": "UM-07", "title": "Sedimentologi dan stratigrafi", "subdomain": "geology", "description": "Proses sedimen, batuan sedimen, prinsip stratigrafi, korelasi stratigrafik, lingkungan sedimentasi"},
        {"code": "UM-08", "title": "Peralatan teknologi MKG", "subdomain": "instrumentation", "description": "AWS, radar cuaca, radiosonde, seismograf, akselerograf, GNSS, lidar, ceilometer, radiometer"},
        {"code": "UM-09", "title": "Kalibrasi peralatan teknologi MKG", "subdomain": "instrumentation", "description": "Standar kalibrasi, rastreabilitas, prosedur kalibrasi sensor suhu, tekanan, kelembaban, angin, curah hujan, seismik"}
      ]
    },
    {
      "id": "khusus",
      "label": "Kemampuan Khusus",
      "topics": [
        {"code": "KH-01", "title": "Model prakiraan meteorologi", "subdomain": "meteorology", "description": "Model NWP: GFS, ECMWF, ICON, WRF; data asimilasi, parameterisasi fisika, output post-processing"},
        {"code": "KH-02", "title": "Peralatan operasional meteorologi", "subdomain": "meteorology", "description": "Operasional stasiun: pengamatan manual/otomatis, pengkodean SYNOP/CLIMAT, transmission GTS"},
        {"code": "KH-03", "title": "Analisis meteorologi kompleks", "subdomain": "meteorology", "description": "Analisis sinoptik: carta tekanan, frontogenesis, siklon tropis, konvergensi, divergensi, vortisitas, omega"},
        {"code": "KH-04", "title": "Pengolahan data klimatologi tingkat lanjutan", "subdomain": "climatology", "description": "Homogenisasi data, analisis tren, normal iklim 30-tahun, indeks iklim standar (SPI, SPEI), kualitas data"},
        {"code": "KH-05", "title": "Analisis klimatologi kompleks", "subdomain": "climatology", "description": "Variabilitas iklim: ENSO, IOD, MJO, QBO; telekoneksi; analisis komposit; downscaling statistik/dinamis"},
        {"code": "KH-06", "title": "Iklim ekstrim", "subdomain": "climatology", "description": "Definisi ekstrim: percentil 90/95/99; heatwave, coldwave, extreme rainfall, drought indices; impact-based forecasting"},
        {"code": "KH-07", "title": "Teknis operasional geofisika", "subdomain": "geophysics", "description": "Operasional seismik: lokasi gempa, magnitudo, kedalaman; tsunami early warning; gravitasi/magnet survey"},
        {"code": "KH-08", "title": "Pengolahan data geofisika", "subdomain": "geophysics", "description": "Pemrosesan waveform: filtering, picking, lokasi (hypocenter), magnitudo; noise analysis; array processing"},
        {"code": "KH-09", "title": "Analisis geofisika kompleks", "subdomain": "geophysics", "description": "Seismotektonik: zona subduksi, patahan aktif, deformasi tanah (InSAR/GNSS), hazard assessment, PSHA"},
        {"code": "KH-10", "title": "Pengoperasian peralatan teknologi canggih/modern", "subdomain": "instrumentation", "description": "Radar dual-pol, wind profiler, microwave radiometer, GNSS meteorology, Doppler lidar, UAV/Drone observasi"},
        {"code": "KH-11", "title": "Pengujian peralatan teknologi MKG", "subdomain": "instrumentation", "description": "FAT/SAT, performance testing, environmental testing, EMI/EMC, reliability testing, acceptance criteria"},
        {"code": "KH-12", "title": "Kalibrasi peralatan teknologi canggih/modern", "subdomain": "instrumentation", "description": "Kalibrasi radar (Z, Zdr, Kdp, ρhv), lidar, radiometer, GNSS; uncertainty budget; ISO 17025, traceability"}
      ]
    }
  ],
  "defaultWeights": {
    "UM-01": 1, "UM-02": 1, "UM-03": 1, "UM-04": 1, "UM-05": 1,
    "UM-06": 1, "UM-07": 1, "UM-08": 1, "UM-09": 1,
    "KH-01": 1.5, "KH-02": 1.5, "KH-03": 1.5, "KH-04": 1.5,
    "KH-05": 1.5, "KH-06": 1.5, "KH-07": 1.5, "KH-08": 1.5,
    "KH-09": 1.5, "KH-10": 1.5, "KH-11": 1.5, "KH-12": 1.5
  }
}
```

#### 4.1.2 Registry API
```typescript
// src/features/kisi-kisi/registry.ts
import kisiKisiData from './data/kisi-kisi.json';

export interface KisiKisiTopic {
  code: string;
  title: string;
  subdomain: 'meteorology' | 'climatology' | 'geophysics' | 'geology' | 'instrumentation';
  description: string;
  category: 'umum' | 'khusus';
  weight: number;
}

export const kisiKisiRegistry = {
  topics: kisiKisiData.categories.flatMap(c => c.topics) as KisiKisiTopic[],
  defaultWeights: kisiKisiData.defaultWeights,
  
  getByCode(code: string): KisiKisiTopic | undefined {
    return this.topics.find(t => t.code === code);
  },
  
  getByCategory(cat: 'umum' | 'khusus'): KisiKisiTopic[] {
    return this.topics.filter(t => t.category === cat);
  },
  
  getBySubdomain(sub: KisiKisiTopic['subdomain']): KisiKisiTopic[] {
    return this.topics.filter(t => t.subdomain === sub);
  },
  
  getAllCodes(): string[] {
    return this.topics.map(t => t.code);
  },
  
  validateCode(code: string): boolean {
    return this.topics.some(t => t.code === code);
  },
  
  getWeight(code: string, userWeights?: Record<string, number>): number {
    return userWeights?.[code] ?? this.defaultWeights[code] ?? 1;
  },
};
```

---

### 4.2 Question Bank Feature

#### 4.2.1 Components
| Component | Responsibility |
|-----------|----------------|
| `QuestionBankView` | Main page: toolbar, filter sidebar, question list, bulk actions |
| `QuestionForm` | Modal for create/edit: stem, options (dynamic), explanation, metadata |
| `QuestionList` | Virtualized list (tanstack/virtual or custom) with row actions |
| `ImportExportPanel` | Drag-drop zone, format selector, preview, merge strategy |
| `QuestionFilterBar` | Multi-select topic, difficulty, flags, mastery, text search |

#### 4.2.2 Question Editor Specification
- **Stem**: Markdown textarea with preview toggle; toolbar (bold, italic, code, math, image paste)
- **Options**: Dynamic array (min 2, max 6); each with text (Markdown) + correct checkbox
- **Validation**: At least one correct; max 5 options for single-choice, multiple for multi-select
- **Explanation**: Markdown with LaTeX math support (`$...$`, `$$...$$`)
- **Metadata**: Topic (required, select), Difficulty (required), Source (optional), Tags (chips input)

#### 4.2.3 Import/Export Formats
```typescript
// JSON (full fidelity)
interface JsonExport { schemaVersion: 1; questions: Question[]; }

// CSV (spreadsheet)
interface CsvRow {
  id: string;
  topicCode: string;
  stem: string;           // Plain text (MD stripped or kept)
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: string;  // "A" or "A,C" for multi
  explanation: string;
  difficulty: number;
  source: string;
  tags: string;           // Semicolon-separated
}

// Anki .apkg (optional) - uses genanki or similar
```

---

### 4.3 Practice Mode Engine

#### 4.3.1 Session Configuration
```typescript
interface PracticeConfig {
  mode: 'practice';
  questionCount: number;           // 10-200, or 'all'
  topicCodes: TopicCode[];         // Empty = all
  difficultyMix?: Record<Difficulty, number>; // % per difficulty
  prioritizeWeak: boolean;         // Weight by mastery (low first)
  includeFlagged: boolean;
  includeNeedsReview: boolean;
  randomOrder: boolean;
  showExplanationImmediately: boolean;
}
```

#### 4.3.2 Question Selection Algorithm
```typescript
function selectPracticeQuestions(config: PracticeConfig, allQuestions: Question[]): Question[] {
  let pool = allQuestions.filter(q => 
    (config.topicCodes.length === 0 || config.topicCodes.includes(q.topicCode))
  );
  
  // Apply filters
  if (!config.includeFlagged) pool = pool.filter(q => !q.flags.bookmarked);
  if (!config.includeNeedsReview) pool = pool.filter(q => !q.flags.needsReview);
  
  // Weight by mastery if prioritizeWeak
  if (config.prioritizeWeak) {
    pool.sort((a, b) => a.statistics.masteryLevel - b.statistics.masteryLevel);
  }
  
  // Difficulty mix
  if (config.difficultyMix) {
    const byDiff = groupBy(pool, q => q.difficulty);
    pool = Object.entries(config.difficultyMix).flatMap(([diff, pct]) => {
      const count = Math.round(pool.length * pct / 100);
      return shuffle(byDiff[Number(diff)] || []).slice(0, count);
    });
  }
  
  // Randomize if needed
  if (config.randomOrder) pool = shuffle(pool);
  
  return config.questionCount === 'all' ? pool : pool.slice(0, config.questionCount);
}
```

#### 4.3.3 Session State Machine
```typescript
type PracticeState = 
  | { status: 'configuring' }
  | { status: 'active'; currentIndex: number; questions: Question[]; answers: Map<string, Attempt>; startTime: number }
  | { status: 'paused'; snapshot: PracticeStateActive }
  | { status: 'reviewing'; questions: Question[]; answers: Map<string, Attempt> }
  | { status: 'completed'; summary: SessionSummary };
```

---

### 4.4 Mock Exam Engine (CAT Simulation)

#### 4.4.1 Exam Configuration
```typescript
interface MockExamConfig {
  mode: 'mock-exam';
  durationMinutes: number;         // Default 90
  questionCount: number;           // 50-100
  topicWeights: Record<TopicCode, number>; // Must sum > 0
  difficultyMix: Record<Difficulty, number>; // % summing to 100
  allowPause: boolean;             // Default false (real CAT)
  showNavigator: boolean;          // Default true
  confirmSubmit: boolean;          // Default true
}
```

#### 4.4.2 Question Selection (Proportional to Weights)
```typescript
function selectMockExamQuestions(config: MockExamConfig, allQuestions: Question[]): Question[] {
  // Group by topic
  const byTopic = groupBy(allQuestions, q => q.topicCode);
  const selected: Question[] = [];
  
  for (const [topicCode, weight] of Object.entries(config.topicWeights)) {
    if (weight <= 0) continue;
    const topicQuestions = byTopic[topicCode] || [];
    if (topicQuestions.length === 0) continue;
    
    // Calculate target count for this topic
    const totalWeight = Object.values(config.topicWeights).reduce((a,b) => a+b, 0);
    const target = Math.round(config.questionCount * weight / totalWeight);
    
    // Further split by difficulty mix
    const byDiff = groupBy(topicQuestions, q => q.difficulty);
    let topicSelected: Question[] = [];
    
    for (const [diff, pct] of Object.entries(config.difficultyMix)) {
      const diffQuestions = byDiff[Number(diff)] || [];
      const diffTarget = Math.round(target * pct / 100);
      topicSelected.push(...shuffle(diffQuestions).slice(0, diffTarget));
    }
    
    // If not enough, fill from other difficulties
    if (topicSelected.length < target) {
      const remaining = topicQuestions.filter(q => !topicSelected.includes(q));
      topicSelected.push(...shuffle(remaining).slice(0, target - topicSelected.length));
    }
    
    selected.push(...topicSelected.slice(0, target));
  }
  
  // Shuffle final order
  return shuffle(selected).slice(0, config.questionCount);
}
```

#### 4.4.3 Timer Specification
- **Display**: MM:SS format, large, top-center
- **Warnings**: 
  - 15 min remaining → yellow background
  - 5 min remaining → orange, pulse animation
  - 1 min remaining → red, persistent pulse, browser notification
- **Auto-submit**: At 0:00, force submit with confirmation
- **Persistence**: Timer state saved to sessionStorage every second (survives accidental refresh)

#### 4.4.4 Navigator Grid
- **Layout**: 10 columns × N rows (responsive: 5-15 cols based on width)
- **Cell states**:
  - `unvisited`: Gray border, empty
  - `current`: Blue border, highlight
  - `answered`: Green fill
  - `flagged`: Orange border + flag icon
  - `marked-review`: Purple border + bookmark icon
  - `answered+flagged`: Green fill + orange border
- **Interaction**: Click → jump to question; Right-click → context menu (flag, mark review)
- **Keyboard**: Arrow keys navigate, Enter selects, F flags, M marks review

#### 4.4.5 Exam State Machine
```typescript
type MockExamState = 
  | { status: 'configuring' }
  | { status: 'ready'; questions: Question[]; config: MockExamConfig }
  | { status: 'active'; 
      currentIndex: number; 
      questions: Question[]; 
      answers: Map<string, Attempt>; 
      flags: Set<string>;           // questionId
      markedReview: Set<string>;
      startTime: number; 
      timeRemainingMs: number;
      timerId: number;
    }
  | { status: 'paused'; snapshot: MockExamStateActive; pauseTime: number }
  | { status: 'confirming'; unansweredCount: number; flaggedCount: number }
  | { status: 'completed'; results: ExamResults; reviewMode: boolean };
```

#### 4.4.6 Results Computation
```typescript
interface ExamResults {
  sessionId: string;
  config: MockExamConfig;
  startedAt: string;
  submittedAt: string;
  durationMs: number;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  scorePercent: number;
  perTopic: Record<TopicCode, {
    total: number;
    attempted: number;
    correct: number;
    scorePercent: number;
    avgTimeMs: number;
  }>;
  timeAnalysis: {
    avgTimePerQuestionMs: number;
    timeDistribution: number[]; // histogram buckets
    slowestQuestions: Array<{questionId: string; timeMs: number}>;
    fastestQuestions: Array<{questionId: string; timeMs: number}>;
  };
  masteryDeltas: Record<TopicCode, number>; // Change in mastery level
}
```

---

### 4.5 Flashcard Engine (SM-2 Algorithm)

#### 4.5.1 SM-2 Implementation
```typescript
// src/features/flashcards/engine/sm2.ts
interface SM2Input {
  easeFactor: number;      // 1.3 - 2.5+
  interval: number;        // Days since last review
  reps: number;            // Successful repetitions
  quality: 0 | 1 | 2 | 3 | 4 | 5; // 0=Again, 1=Hard, 2=Good, 3=Easy (Anki: 1,2,3,4)
}

interface SM2Output {
  easeFactor: number;
  interval: number;        // Next interval in days
  reps: number;
  dueDate: string;         // ISO date
  lapses?: number;         // Incremented on quality < 3
}

function sm2(input: SM2Input, params: SM2Params): SM2Output {
  let { easeFactor, interval, reps } = input;
  const quality = input.quality;
  
  // Quality mapping: Anki 1-4 → SM-2 0-5
  // Again=0, Hard=1, Good=2, Easy=3 (or use 0-5 directly)
  const q = quality; // Assume 0-5 input
  
  if (q >= 3) { // Good or Easy
    if (reps === 0) interval = params.initialInterval;
    else if (reps === 1) interval = params.secondInterval;
    else interval = Math.round(interval * easeFactor);
    
    if (q === 5) interval = Math.round(interval * params.easyBonus); // Easy bonus
    reps++;
  } else { // Again or Hard
    reps = 0;
    interval = params.initialInterval;
    // Lapse handling
  }
  
  // Ease factor adjustment
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < params.minEaseFactor) easeFactor = params.minEaseFactor;
  
  // Cap interval
  if (interval > params.maxInterval) interval = params.maxInterval;
  
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + interval);
  
  return {
    easeFactor,
    interval,
    reps,
    dueDate: dueDate.toISOString().split('T')[0],
    lapses: q < 3 ? 1 : 0,
  };
}
```

#### 4.5.2 Card Types & Rendering
| Type | Front | Back | Use Case |
|------|-------|------|----------|
| `qa` | Question stem | Correct answer + explanation | Standard recall |
| `cloze` | Explanation with `{{c1::blank}}` | Filled explanation | Key fact memorization |
| `concept` | Term/Concept | Definition + context | Terminology |

#### 4.5.3 Session Flow
- **Due cards query**: `WHERE dueDate <= today ORDER BY dueDate LIMIT dailyLimit`
- **Rating buttons**: Again (1) / Hard (2) / Good (3) / Easy (4) — keyboard 1-4
- **Stats**: Due today, New, Learning, Review, Mature (interval > 21 days)

---

### 4.6 Analytics Engine

#### 4.6.1 Mastery Computation
```typescript
// Per-question mastery (0-3)
function computeMastery(stats: QuestionStatistics): MasteryLevel {
  if (stats.totalAttempts === 0) return 0;
  const accuracy = stats.correctAttempts / stats.totalAttempts;
  if (accuracy >= 0.9 && stats.totalAttempts >= 3) return 3; // Mastered
  if (accuracy >= 0.7 && stats.totalAttempts >= 2) return 2; // Review
  if (accuracy >= 0.5) return 1; // Learning
  return 0; // New/Struggling
}

// Per-topic mastery (weighted average)
function computeTopicMastery(questions: Question[]): number {
  if (questions.length === 0) return 0;
  const sum = questions.reduce((acc, q) => acc + q.statistics.masteryLevel, 0);
  return sum / (questions.length * 3); // Normalize to 0-1
}

// Overall readiness (weighted by topic weights)
function computeReadiness(topics: KisiKisiTopic[], topicMastery: Record<string, number>, weights: Record<string, number>): number {
  let weightedSum = 0, totalWeight = 0;
  for (const topic of topics) {
    const w = weights[topic.code] ?? 1;
    const m = topicMastery[topic.code] ?? 0;
    weightedSum += w * m;
    totalWeight += w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
```

#### 4.6.2 Chart Specifications
| Chart | Type | Data | Library |
|-------|------|------|---------|
| Topic Mastery Grid | Heatmap (21 cells) | mastery 0-1 per topic | Custom SVG/Canvas |
| Weak Areas | Horizontal bar | Top 5 lowest mastery × weight | Chart.js bar |
| Mastery Trend | Line (multi) | Daily topic mastery (30d) | Chart.js line |
| Mock Exam Scores | Bar + trendline | Session scores over time | Chart.js bar/line |
| Study Heatmap | Calendar grid | Sessions per day (GitHub style) | Custom |
| Time Distribution | Donut | Time by mode/topic/difficulty | Chart.js doughnut |

#### 4.6.3 Export Formats
- **Dashboard PNG**: `html2canvas` capture
- **Weekly Report**: Markdown template → HTML → PDF (print)
- **Data CSV**: Questions, Sessions, Attempts, Flashcards separate files

---

### 4.7 PWA & Offline Specification

#### 4.7.1 Service Worker Strategy (Workbox)
```typescript
// vite.config.ts - PWA plugin config
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'CPNS BMKG SKB Prep',
        short_name: 'BMKG Prep',
        description: 'Offline practice for CPNS BMKG Meteorology & Geophysics Observer SKB',
        theme_color: '#1e3a5f',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-72.png', sizes: '72x72', type: 'image/png' },
          { src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png' },
          { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-144.png', sizes: '144x144', type: 'image/png' },
          { src: 'icons/icon-152.png', sizes: '152x152', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-384.png', sizes: '384x384', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Mock Exam', short_name: 'Exam', url: '/#/mock-exam', icons: [{ src: 'icons/exam-96.png', sizes: '96x96' }] },
          { name: 'Practice Weak Areas', short_name: 'Practice', url: '/#/practice?weak=true', icons: [{ src: 'icons/practice-96.png', sizes: '96x96' }] },
          { name: 'Flashcards', short_name: 'Cards', url: '/#/flashcards', icons: [{ src: 'icons/cards-96.png', sizes: '96x96' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60*60*24*365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60*60*24*365 } },
          },
        ],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
});
```

#### 4.7.2 Offline-First Guarantees
- **Precache**: All app shell assets (HTML, JS, CSS, icons, kisi-kisi.json, seed questions)
- **Runtime**: No network requests at runtime (except optional font preload)
- **Navigation fallback**: `navigateFallback: '/index.html'` for SPA routing
- **Storage**: Request persistent storage on first load
```typescript
// In app.ts
if ('storage' in navigator && 'persist' in navigator.storage) {
  const persisted = await navigator.storage.persisted();
  if (!persisted) {
    const granted = await navigator.storage.persist();
    console.log('Persistent storage:', granted);
  }
}
```

#### 4.7.3 File Handling (Optional)
```json
// In manifest.json
"file_handlers": [
  {
    "action": "/#/import",
    "accept": {
      "application/json": [".cpns-backup.json"],
      "text/csv": [".csv"]
    }
  }
]
```

---

### 4.8 Settings & Persistence

#### 4.8.1 Settings Schema
```typescript
interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'id' | 'en';
  mockExamDefaults: MockExamDefaults;
  flashcardParams: SM2Params;
  notificationsEnabled: boolean;
  autoBackupEnabled: boolean;
  autoBackupIntervalDays: number;
  fontScale: number;        // 0.8 - 1.5
  reducedMotion: boolean;
  highContrast: boolean;
  topicWeights: Record<TopicCode, number>;
}
```

#### 4.8.2 Settings Persistence
- **Primary**: IndexedDB `settings` table (key-value)
- **Backup**: `localStorage` mirror for instant synchronous read on boot
- **Sync**: On change, write to both; on load, prefer IDB, fallback to localStorage

---

## 5. User Interface Specification

### 5.1 Design System

#### 5.1.1 Color Palette (CSS Custom Properties)
```css
:root {
  /* Light theme (default) */
  --color-bg: #f8fafc;
  --color-bg-elevated: #ffffff;
  --color-bg-hover: #f1f5f9;
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-primary: #1e3a5f;      /* BMKG navy */
  --color-primary-hover: #155e90;
  --color-primary-light: #dbeafe;
  --color-secondary: #0891b2;    /* Cyan-600 */
  --color-success: #059669;      /* Emerald-600 */
  --color-warning: #d97706;      /* Amber-600 */
  --color-danger: #dc2626;       /* Red-600 */
  --color-border: #e2e8f0;
  --color-focus: #3b82f6;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #0f172a;
    --color-bg-elevated: #1e293b;
    --color-bg-hover: #334155;
    --color-text: #f8fafc;
    --color-text-muted: #94a3b8;
    --color-primary: #60a5fa;
    --color-primary-hover: #93c5fd;
    --color-primary-light: #1e3a5f;
    --color-border: #334155;
    --color-focus: #60a5fa;
  }
}

[data-theme="light"] { /* force light */ }
[data-theme="dark"] { /* force dark */ }
```

#### 5.1.2 Typography Scale
```css
:root {
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.875rem;   /* 14px */
  --text-base: 1rem;     /* 16px */
  --text-lg: 1.125rem;   /* 18px */
  --text-xl: 1.25rem;    /* 20px */
  --text-2xl: 1.5rem;    /* 24px */
  --text-3xl: 1.875rem;  /* 30px */
  --text-4xl: 2.25rem;   /* 36px */
  
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
}
```

#### 5.1.3 Spacing Scale
```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
}
```

### 5.2 Layout Structure
```
App Shell (min-h-screen flex flex-col)
├── Header (fixed top, z-40)
│   ├── Logo + Title
│   ├── Nav Tabs: Dashboard | Question Bank | Practice | Mock Exam | Flashcards | Analytics | Settings
│   └── Theme Toggle / Install Button
├── Main (flex-1, pt-16, pb-8)
│   └── <View /> (routed by hash)
└── Footer (fixed bottom, mobile only)
    └── Quick Actions: +Question, Mock Exam, Flashcards
```

### 5.3 Responsive Breakpoints
```css
/* Mobile-first */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg - sidebar nav */ }
@media (min-width: 1280px) { /* xl */ }
@media (min-width: 1536px) { /* 2xl */ }
```

### 5.4 Key Component Specifications

#### 5.4.1 Question Card (Practice/Mock)
```
┌─────────────────────────────────────────────────────┐
│ [Topic Badge]                    [Difficulty Badge] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Question stem (Markdown rendered)                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ○ Option A text                                    │
│  ○ Option B text                                    │
│  ○ Option C text                                    │
│  ○ Option D text                                    │
│  ○ Option E text (if exists)                        │
├─────────────────────────────────────────────────────┤
│  [Flag] [Mark Review]                    [Next >]   │
└─────────────────────────────────────────────────────┘
```

#### 5.4.2 Mock Exam Navigator Grid
- CSS Grid: `grid-template-columns: repeat(auto-fill, minmax(40px, 1fr))`
- Gap: 4px; Cell aspect-ratio: 1/1
- Min 5 cols (mobile), max 15 cols (desktop)

#### 5.4.3 Flashcard View
```
┌─────────────────────────────────────────────────────┐
│  Due: 12  |  New: 3  |  Learning: 5  |  Review: 8  │
├─────────────────────────────────────────────────────┤
│                                                     │
│           QUESTION SIDE (front)                     │
│                                                     │
│           [Tap or Space to flip]                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [Again]  [Hard]  [Good]  [Easy]                    │
│   (1)      (2)      (3)      (4)                    │
└─────────────────────────────────────────────────────┘
```

---

## 6. API & Integration Specifications

### 6.1 Internal Module APIs

#### 6.1.1 Event Bus (Cross-module Communication)
```typescript
// src/core/events.ts
import mitt from 'mitt';

export type AppEvents = {
  'question:created': Question;
  'question:updated': Question;
  'question:deleted': string; // id
  'session:started': Session;
  'session:completed': Session;
  'attempt:recorded': Attempt;
  'mastery:updated': { questionId: string; oldLevel: MasteryLevel; newLevel: MasteryLevel };
  'settings:changed': { key: SettingKey; value: unknown };
  'backup:created': BackupMeta;
  'backup:restored': ExportData;
};

export const eventBus = mitt<AppEvents>();
```

#### 6.1.2 Routing (Hash-based SPA)
```typescript
// src/core/router.ts
type Route = 
  | { path: '/'; view: 'dashboard' }
  | { path: '/questions'; view: 'question-bank' }
  | { path: '/practice'; view: 'practice'; params: PracticeParams }
  | { path: '/mock-exam'; view: 'mock-exam'; params: MockExamParams }
  | { path: '/flashcards'; view: 'flashcards' }
  | { path: '/analytics'; view: 'analytics' }
  | { path: '/settings'; view: 'settings' }
  | { path: '/import'; view: 'import' }
  | { path: '/export'; view: 'export' };

function parseHash(): Route { /* ... */ }
function navigate(route: Route) { location.hash = serialize(route); }
window.addEventListener('hashchange', () => render(parseHash()));
```

### 6.2 External Integrations (None Required)
- **No backend API**
- **No third-party auth**
- **No analytics/tracking**
- **Optional**: Font preload from Google Fonts (cached by SW)

---

## 7. Testing Requirements

### 7.1 Unit Tests (Vitest)
| Module | Coverage Target | Key Test Cases |
|--------|-----------------|----------------|
| `db/repositories/*` | 90% | CRUD, filters, transactions, migrations |
| `features/kisi-kisi/registry` | 100% | Lookup, validation, weights |
| `features/mock-exam/engine/selection` | 95% | Proportional selection, edge cases |
| `features/mock-exam/engine/timer` | 95% | Countdown, warnings, auto-submit |
| `features/flashcards/engine/sm2` | 100% | All quality ratings, ease factor bounds, interval caps |
| `features/analytics/engine/mastery` | 90% | Question/topic/overall computation |
| `features/question-bank/services/import-export` | 90% | JSON/CSV roundtrip, schema validation, merge strategies |

### 7.2 Integration Tests
- **DB + Repository**: Full CRUD cycles with realistic data volumes (1000 questions)
- **Mock Exam Flow**: Config → Start → Answer → Navigate → Submit → Results → Review
- **Flashcard Scheduling**: Due query → Review → Rate → Next due date correct
- **Import/Export**: Full backup → Clear DB → Restore → Verify integrity
- **PWA**: SW registration, precache, offline navigation, install prompt

### 7.3 E2E Tests (Playwright)
| Scenario | Steps | Assertions |
|----------|-------|------------|
| First launch | Open → Install PWA → Onboarding → Seed questions → First mock | App installs, DB seeded, mock runs |
| Daily study | Open → Dashboard shows weak areas → Practice weak → Flashcards due → Mock exam | Weak areas identified, progress saved |
| Data portability | Add questions → Export JSON → Clear site data → Import JSON → Verify | All data restored exactly |
| Offline mode | Open online → Go offline (DevTools) → Full study session → Go online | No network errors, all features work |
| Accessibility | Tab through all views → Screen reader (NVDA) → High contrast mode | No keyboard traps, ARIA labels present |

### 7.4 Performance Benchmarks
```typescript
// vitest benchmarks
import { bench, describe } from 'vitest';

describe('DB Performance', () => {
  bench('insert 1000 questions', () => repo.bulkAdd(questions));
  bench('query by topic (500 q)', () => repo.getByTopic('UM-01'));
  bench('filtered list (1000 q, 5 filters)', () => repo.getFiltered(filters));
  bench('export 1000 questions JSON', () => backup.exportAll());
});
```

---

## 8. Build & Deployment

### 8.1 Build Configuration (Vite)
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import typescript from '@rollup/plugin-typescript';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2022',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-db': ['dexie'],
          'vendor-charts': ['chart.js'],
          'vendor-utils': ['date-fns', 'mitt'],
        },
      },
    },
  },
  plugins: [
    typescript({ tsconfig: './tsconfig.json' }),
    VitePWA({ /* config from 4.7.1 */ }),
  ],
  server: {
    port: 5173,
    https: false,
  },
});
```

### 8.2 TypeScript Configuration
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["src/shared/*"],
      "@features/*": ["src/features/*"],
      "@core/*": ["src/core/*"],
      "@db/*": ["src/db/*"]
    }
  },
  "include": ["src/**/*", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 8.3 Deployment Targets
| Target | Command | Notes |
|--------|---------|-------|
| GitHub Pages | `npm run build && npx gh-pages -d dist` | HTTPS, PWA works |
| Netlify/Vercel | Connect repo, build command: `npm run build` | Auto HTTPS, headers |
| Local file:// | `npm run build` → open `dist/index.html` | SW may not register; use `npx serve dist` |
| Local HTTP | `npx serve dist` or `python -m http.server -d dist` | Full PWA support |

### 8.4 Distribution Package
```
dist/
├── index.html
├── manifest.json
├── sw.js
├── icons/
│   └── *.png
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   ├── vendor-db-[hash].js
│   ├── vendor-charts-[hash].js
│   └── vendor-utils-[hash].js
├── kisi-kisi.json          # Copied from public/
└── seed-questions.json     # Copied from public/
```

---

## 9. Security Considerations

### 9.1 Content Security Policy
```html
<!-- In index.html -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';  /* Chart.js uses eval for formatters */
  style-src 'self' 'unsafe-inline';      /* CSS-in-JS or inline styles */
  font-src 'self' data: https://fonts.gstatic.com;
  img-src 'self' data: blob:;
  connect-src 'self';                    /* No external connections */
  worker-src 'self' blob:;               /* Service Worker */
  frame-ancestors 'none';
  form-action 'none';
  base-uri 'self';
">
```

### 9.2 Data Sanitization
- **Markdown rendering**: Use `marked` with `sanitize: true` or DOMPurify
- **User input**: Validate all question fields on client (Zod schemas)
- **Import validation**: Strict schema check before DB write

### 9.3 Privacy
- **Zero telemetry**: No analytics, no error reporting to external services
- **Local-only**: All data stays in browser IndexedDB
- **No cookies**: No tracking, no session cookies

---

## 10. Accessibility (WCAG 2.1 AA)

### 10.1 Requirements Checklist
- [ ] **Color contrast**: 4.5:1 normal text, 3:1 large text/UI components
- [ ] **Focus indicators**: Visible outline on all interactive elements
- [ ] **Keyboard navigation**: All features operable via keyboard
- [ ] **ARIA labels**: Buttons, icons, form fields, live regions
- [ ] **Heading hierarchy**: h1 → h2 → h3 logical structure
- [ ] **Landmarks**: `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`
- [ ] **Live regions**: Timer announcements, toast notifications
- [ ] **Reduced motion**: Respect `prefers-reduced-motion` for animations
- [ ] **High contrast mode**: Optional forced contrast via setting
- [ ] **Font scaling**: Support up to 200% zoom without horizontal scroll
- [ ] **Language**: `lang="id"` on `<html>`, `lang="en"` for technical terms

### 10.2 Screen Reader Testing
- **NVDA** (Windows) + Firefox/Chrome
- **VoiceOver** (macOS/iOS) + Safari
- **Orca** (Linux) + Firefox

---

## 11. Maintenance & Operations

### 11.1 Versioning Scheme
- **SemVer**: MAJOR.MINOR.PATCH (e.g., 1.0.0)
- **Schema version**: Separate from app version (export data compatibility)
- **Kisi-kisi version**: Track BMKG document version (e.g., 2024.1)

### 11.2 Update Strategy
- **PWA auto-update**: `registerType: 'autoUpdate'` + `skipWaiting: true`
- **User notification**: Toast when new version ready, prompt refresh
- **Data migration**: Automatic on DB open (Dexie migrations)

### 11.3 Backup & Recovery
- **User-triggered**: Export button in Settings/Export page
- **Auto-backup**: Daily/weekly (configurable) via File System Access API
- **Recovery**: Import page with drag-drop, validation, preview

### 11.4 Monitoring (Self-Diagnostics)
- **Console health check**: On load, verify DB opens, SW registered, all stores accessible
- **Storage quota**: Warn at 80%, critical at 95%
- **Error boundary**: Catch unhandled errors, log to console, show friendly toast

---

## 12. Appendix

### 12.1 File Structure Summary
```
/cpns
├── .planning/
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── SRS.md          (this file)
│   ├── ROADMAP.md
│   └── STATE.md
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js (generated)
│   ├── icons/
│   ├── kisi-kisi.json
│   └── seed-questions.json
├── src/
│   ├── app.ts
│   ├── core/
│   ├── db/
│   ├── features/
│   ├── shared/
│   └── views/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .eslintrc.json
├── .prettierrc
├── vitest.config.ts
├── playwright.config.ts
└── README.md
```

### 12.2 Key Dependencies (package.json)
```json
{
  "dependencies": {
    "dexie": "^4.0.0",
    "chart.js": "^4.4.0",
    "date-fns": "^3.6.0",
    "mitt": "^3.0.0",
    "marked": "^12.0.0",
    "dompurify": "^3.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-pwa": "^0.20.0",
    "typescript": "^5.3.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "vitest": "^1.0.0",
    "@playwright/test": "^1.40.0",
    "eslint": "^8.50.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "prettier": "^3.0.0",
    "html2canvas": "^1.4.0"
  }
}
```

### 12.3 Glossary of Technical Terms
| Term | Definition |
|------|------------|
| Dexie.js | TypeScript wrapper for IndexedDB with reactive queries |
| Workbox | Google's service worker toolkit for PWA offline support |
| SM-2 | SuperMemo 2 spaced repetition algorithm (Anki-compatible) |
| CAT | Computer Assisted Test — BKN's digital exam platform |
| SKB | Seleksi Kompetensi Bidang — Field competency selection (60% weight) |
| SKD | Seleksi Kompetensi Dasar — Basic competency selection (40% weight) |
| BMKG | Badan Meteorologi, Klimatologi, dan Geofisika |
| MKG | Meteorologi, Klimatologi, Geofisika |
| NWP | Numerical Weather Prediction |
| AWS | Automatic Weather Station |
| SYNOP | Surface Synoptic Observations (WMO code) |
| GTS | Global Telecommunication System (WMO) |
| PSHA | Probabilistic Seismic Hazard Analysis |
| InSAR | Interferometric Synthetic Aperture Radar |

---

*End of SRS. This document should be reviewed alongside REQUIREMENTS.md (PRD) and PROJECT.md before implementation begins. Next step: `/gsd-plan-phase 1` to create detailed implementation plan.*
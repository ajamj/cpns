// App configuration constants

export const APP_CONFIG = {
  name: 'CPNS BMKG SKB Prep',
  shortName: 'BMKG Prep',
  version: '1.0.0',
  schemaVersion: 1,
  
  // Storage
  dbName: 'cpns-bmgk-db',
  dbVersion: 1,
  
  // PWA
  pwaScope: '/',
  pwaStartUrl: '/',
  
  // Limits
  maxQuestions: 10000,
  maxSessions: 5000,
  maxFlashcards: 5000,
  maxVersionsPerQuestion: 5,
  trashRetentionDays: 30,
  autoSaveIntervalMs: 5000,
  searchDebounceMs: 150,
  
  // Mock Exam
  defaultMockDurationMinutes: 90,
  defaultMockQuestionCount: 60,
  mockMinDurationMinutes: 30,
  mockMaxDurationMinutes: 180,
  mockMinQuestions: 10,
  mockMaxQuestions: 200,
  
  // Flashcards
  defaultDailyLimit: 50,
  defaultInitialInterval: 1,
  defaultSecondInterval: 6,
  defaultEasyBonus: 1.3,
  defaultHardPenalty: 1.2,
  defaultMinEaseFactor: 1.3,
  defaultMaxInterval: 36500,
  
  // Theme
  defaultTheme: 'system' as const,
  defaultLanguage: 'id' as const,
  
  // Topic weights (UM=1.0, KH=1.5)
  defaultTopicWeights: {
    'UM-01': 1, 'UM-02': 1, 'UM-03': 1, 'UM-04': 1, 'UM-05': 1,
    'UM-06': 1, 'UM-07': 1, 'UM-08': 1, 'UM-09': 1,
    'KH-01': 1.5, 'KH-02': 1.5, 'KH-03': 1.5, 'KH-04': 1.5,
    'KH-05': 1.5, 'KH-06': 1.5, 'KH-07': 1.5, 'KH-08': 1.5,
    'KH-09': 1.5, 'KH-10': 1.5, 'KH-11': 1.5, 'KH-12': 1.5,
  },
  
  // Difficulty labels
  difficultyLabels: {
    1: 'Mudah',
    2: 'Sedang',
    3: 'Sulit',
  },
  
  // Mastery labels
  masteryLabels: {
    0: 'Baru',
    1: 'Belajar',
    2: 'Ulang',
    3: 'Mahir',
  },
  
  // Mastery colors
  masteryColors: {
    0: '#94a3b8', // slate-400
    1: '#fbbf24', // amber-400
    2: '#60a5fa', // blue-400
    3: '#34d399', // emerald-400
  },
  
  // Subdomain colors
  subdomainColors: {
    meteorology: '#3b82f6',    // blue
    climatology: '#10b981',    // emerald
    geophysics: '#f59e0b',     // amber
    geology: '#8b5cf6',        // violet
    instrumentation: '#ef4444', // red
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
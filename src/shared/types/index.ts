// Shared type definitions

export type TopicCode = `UM-${string}` | `KH-${string}`;

export type Difficulty = 1 | 2 | 3;

export type MasteryLevel = 0 | 1 | 2 | 3; // 0=New, 1=Learning, 2=Review, 3=Mastered

export type SessionMode = 'practice' | 'mock-exam' | 'flashcard';

export type QuestionFlag = 'bookmarked' | 'needsReview' | 'disputed';

export type SettingKey =
  | 'theme'
  | 'language'
  | 'mockExamDefaults'
  | 'flashcardParams'
  | 'notificationsEnabled'
  | 'autoBackupEnabled'
  | 'autoBackupIntervalDays'
  | 'fontScale'
  | 'reducedMotion'
  | 'highContrast'
  | 'topicWeights'
  | 'storagePersisted';

export interface KisiKisiTopic {
  code: string;
  title: string;
  subdomain: 'meteorology' | 'climatology' | 'geophysics' | 'geology' | 'instrumentation';
  description: string;
  category: 'umum' | 'khusus';
  weight: number;
}

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuestionFlags {
  bookmarked: boolean;
  needsReview: boolean;
  disputed: boolean;
}

export interface QuestionMetadata {
  createdAt: string;
  updatedAt: string;
  version: number;
  author: 'user' | 'import';
}

export interface QuestionStatistics {
  totalAttempts: number;
  correctAttempts: number;
  avgTimeMs: number;
  lastAttemptedAt?: string;
  masteryLevel: MasteryLevel;
  total?: number;
  mastered?: number;
  learning?: number;
  new?: number;
  avgMastery?: number;
}

export interface Question {
  id: string;
  topicCode: TopicCode;
  stem: string;
  options: QuestionOption[];
  correctAnswer: number[];
  explanation?: string;
  difficulty: Difficulty;
  source?: string;
  tags: string[];
  flags: QuestionFlags;
  metadata: QuestionMetadata;
  statistics: QuestionStatistics;
  versions?: Question[];
  deletedAt?: string;
}

export interface SessionConfig {
  questionCount?: number;
  filter?: QuestionFilter;
  durationMinutes?: number;
  questionSelection?: 'weighted' | 'proportional' | 'custom';
  topicWeights?: Record<TopicCode, number>;
  difficultyMix?: Record<Difficulty, number>;
  dailyLimit?: number;
  algorithmParams?: SM2Params;
  showExplanationImmediately?: boolean;
}

export interface Session {
  id: string;
  mode: SessionMode;
  startedAt: string;
  completedAt?: string;
  config: SessionConfig;
  topicCodes: TopicCode[];
  summary?: SessionSummary;
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
  userAnswer: number[];
  isCorrect: boolean;
  timeMs: number;
  timestamp: string;
  flagged: boolean;
  markedForReview: boolean;
}

export interface Flashcard {
  id: string;
  questionId?: string;
  front: string;
  back: string;
  type: 'qa' | 'cloze' | 'concept';
  dueDate: string;
  interval: number;
  easeFactor: number;
  reps: number;
  lapses: number;
  lastReviewed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SM2Params {
  initialInterval: number;
  secondInterval: number;
  easyBonus: number;
  hardPenalty: number;
  minEaseFactor: number;
  maxInterval: number;
  dailyLimit?: number;
}

export interface QuestionFilter {
  topicCodes?: TopicCode[];
  difficulty?: Difficulty;
  flags?: Partial<QuestionFlags>;
  masteryLevels?: MasteryLevel[];
  source?: string;
  dateRange?: { start: string; end: string };
  textSearch?: string;
}

export interface Settings {
  key: string;
  value: unknown;
}

export interface SettingsDict {
  theme: 'light' | 'dark' | 'system';
  language: 'id' | 'en';
  mockExamDefaults: MockExamDefaults;
  flashcardParams: SM2Params;
  notificationsEnabled: boolean;
  autoBackupEnabled: boolean;
  autoBackupIntervalDays: number;
  fontScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  topicWeights: Record<TopicCode, number>;
  storagePersisted: boolean;
}

export interface MockExamDefaults {
  durationMinutes: number;
  questionCount: number;
  topicWeights: Record<TopicCode, number>;
  difficultyMix: Record<Difficulty, number>;
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

// For router
export interface RouteParams {
  [key: string]: string | undefined;
}
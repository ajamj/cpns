// Backup Repository - Import/Export
import { db } from '../schema';
import { questionsRepo } from './questions';
import { sessionsRepo } from './sessions';
import { attemptsRepo } from './attempts';
import { flashcardsRepo } from './flashcards';
import { settingsRepo } from './settings';
import type { ExportData, BackupMeta, Question, QuestionFilter } from '../../shared/types';
import { APP_CONFIG } from '../../core/config';
import { eventBus } from '../../core/events';
import { downloadJSON, nowISO } from '../../core/utils';
import { questionsToCSV } from '../../features/questions/bulk-operations';
import { generateApkg } from '../../features/import-export/anki';
import { parseImportText, validateBackup } from '../../features/import-export/schema';
import type { MergeStrategy } from '../../features/import-export/merge';

export { parseImportText } from '../../features/import-export/schema';
export type { ImportParseResult, ImportIssue } from '../../features/import-export/schema';

function downloadTextFile(data: string | Uint8Array, mimeType: string, filename: string): void {
  const blob = data instanceof Uint8Array
    ? new Blob([data as BlobPart], { type: mimeType })
    : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const backupRepo = {
  // Create full backup
  async createBackup(): Promise<ExportData> {
    const [
      questions,
      sessions,
      attempts,
      flashcards,
      settings,
    ] = await Promise.all([
      questionsRepo.getAllWithDeleted(),
      sessionsRepo.getAll(),
      db.attempts.toArray(),
      flashcardsRepo.getAll(),
      settingsRepo.getAll(),
    ]);

    // Include kisi-kisi for self-contained restore; offline backups still work.
    let kisiKisi: any[] = [];
    try {
      const response = await fetch('/kisi-kisi.json');
      if (response.ok) {
        const payload = await response.json();
        kisiKisi = payload?.categories?.flatMap((category: any) => category.topics) ?? [];
      }
    } catch {
      kisiKisi = [];
    }

    const exportData: ExportData = {
      schemaVersion: APP_CONFIG.schemaVersion,
      exportedAt: nowISO(),
      appVersion: APP_CONFIG.version,
      data: {
        questions,
        sessions,
        attempts,
        flashcards,
        settings,
        kisiKisi,
      },
    };

    // Save backup metadata
    const jsonString = JSON.stringify(exportData);
    const sizeBytes = new Blob([jsonString]).size;
    
    const meta: BackupMeta = {
      createdAt: nowISO(),
      schemaVersion: APP_CONFIG.schemaVersion,
      appVersion: APP_CONFIG.version,
      fileName: `cpns-backup-${new Date().toISOString().split('T')[0]}.json`,
      sizeBytes,
      recordCounts: {
        questions: questions.length,
        sessions: sessions.length,
        flashcards: flashcards.length,
      },
    };

    await db.backups.add(meta);
    eventBus.emit('backup:created', meta);

    return exportData;
  },

  // Download backup as file
  async downloadBackup(): Promise<void> {
    const exportData = await this.createBackup();
    const meta = await db.backups.orderBy('id').last();
    downloadJSON(exportData, meta?.fileName || `cpns-backup-${new Date().toISOString().split('T')[0]}.json`);
  },

  // Validate every record with Zod before any write (threat T-05-01)
  async restoreBackup(exportData: ExportData, options: {
    mergeStrategy?: MergeStrategy;
    restoreSettings?: boolean;
    /** Per-question overrides selected in the import preview modal. */
    strategyFor?: (question: Question) => MergeStrategy | undefined;
  } = {}): Promise<{ restored: boolean; counts: Record<string, number>; errors: string[] }> {
    const errors: string[] = [];
    const counts: Record<string, number> = {};

    try {
      const validation = validateBackup(exportData);
      if (!validation.backup) {
        return { restored: false, counts: {}, errors: validation.issues.map(i => `${i.path}: ${i.message}`) };
      }
      const backup = validation.backup;
      // Only tables explicitly present in the file may be replaced. A plain
      // question import must never clear the user's sessions or flashcards.
      const hasTable = (name: 'sessions' | 'attempts' | 'flashcards' | 'settings'): boolean =>
        !!exportData?.data && Array.isArray((exportData.data as Record<string, unknown>)[name]);

      // Restore questions
      if (backup.data.questions) {
        const result = await questionsRepo.importQuestions(
          backup.data.questions,
          options.mergeStrategy || 'smart',
          options.strategyFor
        );
        counts.questions = result.imported;
        if (result.skipped > 0) errors.push(`${result.skipped} soal dilewati`);
        if (result.conflicts > 0) errors.push(`${result.conflicts} konflik (smart merge diterapkan)`);
      }

      // Restore sessions
      if (hasTable('sessions')) {
        await db.sessions.clear();
        await db.sessions.bulkAdd(backup.data.sessions);
        counts.sessions = backup.data.sessions.length;
      }

      // Restore attempts
      if (hasTable('attempts')) {
        await db.attempts.clear();
        await db.attempts.bulkAdd(backup.data.attempts);
        counts.attempts = backup.data.attempts.length;
      }

      // Restore flashcards
      if (hasTable('flashcards')) {
        await db.flashcards.clear();
        await db.flashcards.bulkAdd(backup.data.flashcards);
        counts.flashcards = backup.data.flashcards.length;
      }

      // Restore settings (optional)
      if (options.restoreSettings && hasTable('settings')) {
        await db.settings.clear();
        await db.settings.bulkAdd(backup.data.settings);
        // Re-init localStorage mirror
        await settingsRepo.initLocalStorageMirror();
        counts.settings = backup.data.settings.length;
      }

      eventBus.emit('backup:restored', backup);
      return { restored: true, counts, errors };
    } catch (error) {
      errors.push(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { restored: false, counts: {}, errors };
    }
  },

  // Import a validated JSON backup from file
  async importFromFile(file: File): Promise<ExportData> {
    const result = parseImportText(await file.text(), file.name);
    if (result.issues.length) {
      throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    }
    if (!result.backup) throw new Error('File bukan backup JSON lengkap');
    return result.backup;
  },

  // Export to CSV (one row per question, options in columns A–E)
  async exportQuestionsCSV(filter: QuestionFilter = {}): Promise<string> {
    const questions = await questionsRepo.exportFiltered(filter);
    return questionsToCSV(questions);
  },

  // Download CSV
  async downloadQuestionsCSV(filter: QuestionFilter = {}): Promise<void> {
    const csv = await this.exportQuestionsCSV(filter);
    downloadTextFile(csv, 'text/csv;charset=utf-8', `cpns-questions-${new Date().toISOString().split('T')[0]}.csv`);
  },

  // Export questions as an Anki 2.1 package (one basic card per question)
  async exportQuestionsAnki(filter: QuestionFilter = {}): Promise<Uint8Array> {
    return generateApkg(await questionsRepo.exportFiltered(filter));
  },

  async downloadQuestionsAnki(filter: QuestionFilter = {}): Promise<number> {
    const questions = await questionsRepo.exportFiltered(filter);
    const apkg = generateApkg(questions);
    downloadTextFile(apkg, 'application/octet-stream', `cpns-questions-${new Date().toISOString().split('T')[0]}.apkg`);
    return questions.length;
  },

  // Import from CSV with Zod validation and a detailed error report
  async importFromCSV(text: string): Promise<Question[]> {
    const result = parseImportText(text, 'import.csv');
    if (result.issues.length) {
      throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    }
    return result.questions;
  },

  // Get backup history
  async getBackupHistory(): Promise<BackupMeta[]> {
    return db.backups.orderBy('createdAt').reverse().toArray();
  },

  // Auto backup check
  async shouldAutoBackup(): Promise<boolean> {
    const settings = await settingsRepo.getAllWithDefaults();
    const autoBackupEnabled = settings.autoBackupEnabled as boolean ?? false;
    if (!autoBackupEnabled) return false;
    
    const intervalDays = (settings.autoBackupIntervalDays as number) ?? 7;
    const lastBackup = await db.backups.orderBy('createdAt').last();
    
    if (!lastBackup) return true;
    
    const lastBackupDate = new Date(lastBackup.createdAt);
    const now = new Date();
    const diffDays = (now.getTime() - lastBackupDate.getTime()) / (1000 * 60 * 60 * 24);
    
    return diffDays >= intervalDays;
  },
};
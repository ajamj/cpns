// Backup Repository - Import/Export
import { db } from '../schema';
import { questionsRepo } from './questions';
import { sessionsRepo } from './sessions';
import { attemptsRepo } from './attempts';
import { flashcardsRepo } from './flashcards';
import { settingsRepo } from './settings';
import type { ExportData, BackupMeta, Question, Difficulty } from '../../shared/types';
import { APP_CONFIG } from '../../core/config';
import { eventBus } from '../../core/events';
import { parseCSV, toCSV, downloadJSON, nowISO } from '../../core/utils';

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

    // Include kisi-kisi for self-contained restore
    const kisiKisiResponse = await fetch('/kisi-kisi.json');
    const kisiKisi = await kisiKisiResponse.json();

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
        kisiKisi: kisiKisi.categories.flatMap((c: any) => c.topics),
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

  // Validate and restore backup
  async restoreBackup(exportData: ExportData, options: {
    mergeStrategy?: 'skip' | 'overwrite' | 'duplicate' | 'smart';
    restoreSettings?: boolean;
  } = {}): Promise<{ restored: boolean; counts: Record<string, number>; errors: string[] }> {
    const errors: string[] = [];
    const counts: Record<string, number> = {};

    try {
      // Validate schema version
      if (exportData.schemaVersion > APP_CONFIG.schemaVersion) {
        errors.push(`Backup schema version ${exportData.schemaVersion} is newer than app version ${APP_CONFIG.schemaVersion}`);
        return { restored: false, counts: {}, errors };
      }

      // Restore questions
      if (exportData.data.questions) {
        const result = await questionsRepo.importQuestions(
          exportData.data.questions,
          options.mergeStrategy || 'smart'
        );
        counts.questions = result.imported;
        if (result.skipped > 0) errors.push(`${result.skipped} questions skipped`);
        if (result.conflicts > 0) errors.push(`${result.conflicts} questions had conflicts (smart merge applied)`);
      }

      // Restore sessions
      if (exportData.data.sessions) {
        await db.sessions.clear();
        await db.sessions.bulkAdd(exportData.data.sessions);
        counts.sessions = exportData.data.sessions.length;
      }

      // Restore attempts
      if (exportData.data.attempts) {
        await db.attempts.clear();
        await db.attempts.bulkAdd(exportData.data.attempts);
        counts.attempts = exportData.data.attempts.length;
      }

      // Restore flashcards
      if (exportData.data.flashcards) {
        await db.flashcards.clear();
        await db.flashcards.bulkAdd(exportData.data.flashcards);
        counts.flashcards = exportData.data.flashcards.length;
      }

      // Restore settings (optional)
      if (options.restoreSettings && exportData.data.settings) {
        await db.settings.clear();
        await db.settings.bulkAdd(exportData.data.settings);
        // Re-init localStorage mirror
        await settingsRepo.initLocalStorageMirror();
        counts.settings = exportData.data.settings.length;
      }

      eventBus.emit('backup:restored', exportData);
      return { restored: true, counts, errors };
    } catch (error) {
      errors.push(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { restored: false, counts: {}, errors };
    }
  },

  // Import from file
  async importFromFile(file: File): Promise<ExportData> {
    const text = await file.text();
    const data = JSON.parse(text) as ExportData;
    
    // Basic validation
    if (!data.schemaVersion || !data.data) {
      throw new Error('Invalid backup file format');
    }
    
    return data;
  },

  // Export to CSV
  async exportQuestionsCSV(filter?: { topicCodes?: string[] }): Promise<string> {
    const questions = filter?.topicCodes?.length
      ? (await Promise.all(filter.topicCodes.map(tc => questionsRepo.getByTopic(tc as any)))).flat()
      : await questionsRepo.getAll();

    const headers = [
      'id', 'topicCode', 'stem', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE',
      'correctAnswer', 'explanation', 'difficulty', 'source', 'tags'
    ];

    const rows = [headers];
    
    for (const q of questions) {
      const options = q.options.map(o => o.text);
      while (options.length < 5) options.push('');
      
      const correctLetters = q.correctAnswer.map(i => String.fromCharCode(65 + i)).join(',');
      
      const opt0 = options[0] ?? '';
      const opt1 = options[1] ?? '';
      const opt2 = options[2] ?? '';
      const opt3 = options[3] ?? '';
      const opt4 = options[4] ?? '';
      
      rows.push([
        q.id,
        q.topicCode,
        q.stem,
        opt0, opt1, opt2, opt3, opt4,
        correctLetters,
        q.explanation || '',
        q.difficulty.toString(),
        q.source || '',
        q.tags.join(';'),
      ]);
    }

    return toCSV(rows);
  },

  // Download CSV
  async downloadQuestionsCSV(filter?: { topicCodes?: string[] }): Promise<void> {
    const csv = await this.exportQuestionsCSV(filter);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpns-questions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Import from CSV
  async importFromCSV(text: string): Promise<Question[]> {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV must have header and at least one data row');
    
    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1);
    
    const questions: Question[] = [];
    
    for (const row of dataRows) {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      
      const options = [
        { id: crypto.randomUUID(), text: obj.optionA || '', isCorrect: false },
        { id: crypto.randomUUID(), text: obj.optionB || '', isCorrect: false },
        { id: crypto.randomUUID(), text: obj.optionC || '', isCorrect: false },
        { id: crypto.randomUUID(), text: obj.optionD || '', isCorrect: false },
        { id: crypto.randomUUID(), text: obj.optionE || '', isCorrect: false },
      ].filter(o => o.text.trim() !== '');
      
      const correctLetters = (obj.correctAnswer || '').split(',').map(l => l.trim().toUpperCase());
      const correctIndices = correctLetters
        .map(l => l.charCodeAt(0) - 65)
        .filter(i => i >= 0 && i < options.length);
      
      // Fix: check array bounds before accessing
      correctIndices.forEach(i => {
        if (options[i]) options[i].isCorrect = true;
      });
      
      if (correctIndices.length === 0 && options.length > 0) {
        if (options[0]) options[0].isCorrect = true; // default first
      }
      
      const q: Question = {
        id: obj.id || crypto.randomUUID(),
        topicCode: obj.topicCode as any,
        stem: obj.stem || '',
        options,
        correctAnswer: correctIndices.length > 0 ? correctIndices : [0],
        difficulty: (parseInt(obj.difficulty ?? '2', 10) || 2) as Difficulty,
        tags: (obj.tags || '').split(';').map(t => t.trim()).filter(Boolean),
        flags: { bookmarked: false, needsReview: false, disputed: false },
        metadata: {
          createdAt: nowISO(),
          updatedAt: nowISO(),
          version: 1,
          author: 'import',
        },
        statistics: {
          totalAttempts: 0,
          correctAttempts: 0,
          avgTimeMs: 0,
          masteryLevel: 0,
        },
      };
      if (obj.explanation) q.explanation = obj.explanation;
      if (obj.source) q.source = obj.source;
      
      questions.push(q);
    }
    
    return questions;
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
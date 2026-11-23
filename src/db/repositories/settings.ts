// Settings Repository (dual persistence: IndexedDB + localStorage mirror)
import { db } from '../schema';
import type { Settings, SettingKey, MockExamDefaults, SM2Params, SettingsDict } from '../../shared/types';
import { APP_CONFIG } from '../../core/config';
import { eventBus } from '../../core/events';

const SETTINGS_DEFAULTS: SettingsDict = {
  theme: 'system',
  language: 'id',
  mockExamDefaults: {
    durationMinutes: 90,
    questionCount: 60,
    topicWeights: APP_CONFIG.defaultTopicWeights,
    difficultyMix: { 1: 30, 2: 50, 3: 20 },
  } as MockExamDefaults,
  flashcardParams: {
    initialInterval: 1,
    secondInterval: 6,
    easyBonus: 1.3,
    hardPenalty: 1.2,
    minEaseFactor: 1.3,
    maxInterval: 36500,
  } as SM2Params,
  notificationsEnabled: false,
  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  fontScale: 1.0,
  reducedMotion: false,
  highContrast: false,
  topicWeights: APP_CONFIG.defaultTopicWeights,
  storagePersisted: false,
};

export const settingsRepo = {
  async getAll(): Promise<Settings[]> {
    return db.settings.toArray();
  },

  async get<K extends SettingKey>(key: K): Promise<SettingsDict[K] | undefined> {
    const setting = await db.settings.get(key);
    return setting?.value as SettingsDict[K] | undefined;
  },

  async getWithDefault<K extends SettingKey>(key: K): Promise<SettingsDict[K]> {
    const setting = await db.settings.get(key);
    if (setting) return setting.value as SettingsDict[K];
    return SETTINGS_DEFAULTS[key];
  },

  async set<K extends SettingKey>(key: K, value: SettingsDict[K]): Promise<void> {
    await db.settings.put({ key, value });
    // Mirror to localStorage for instant sync read
    try {
      localStorage.setItem(`setting:${key}`, JSON.stringify(value));
    } catch {}
    eventBus.emit('settings:changed', { key, value });
  },

  async setMultiple(settings: Partial<SettingsDict>): Promise<void> {
    await db.settings.bulkPut(
      Object.entries(settings).map(([key, value]) => ({ key, value }))
    );
    Object.entries(settings).forEach(([key, value]) => {
      try {
        localStorage.setItem(`setting:${key}`, JSON.stringify(value));
      } catch {}
      eventBus.emit('settings:changed', { key: key as SettingKey, value });
    });
  },

  async getAllWithDefaults(): Promise<SettingsDict> {
    const stored = await this.getAll();
    const result: SettingsDict = { ...SETTINGS_DEFAULTS };
    
    for (const setting of stored) {
      result[setting.key as SettingKey] = setting.value as SettingsDict[SettingKey];
    }
    
    return result;
  },

  async resetToDefaults(): Promise<void> {
    await db.settings.clear();
    Object.entries(SETTINGS_DEFAULTS).forEach(([key, value]) => {
      try {
        localStorage.setItem(`setting:${key}`, JSON.stringify(value));
      } catch {}
      eventBus.emit('settings:changed', { key: key as SettingKey, value });
    });
  },

  // Initialize localStorage mirror from IDB
  async initLocalStorageMirror(): Promise<void> {
    const all = await this.getAll();
    for (const setting of all) {
      try {
        localStorage.setItem(`setting:${setting.key}`, JSON.stringify(setting.value));
      } catch {}
    }
    // Fill missing with defaults
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      if (!localStorage.getItem(`setting:${key}`)) {
        try {
          localStorage.setItem(`setting:${key}`, JSON.stringify(value));
        } catch {}
      }
    }
  },

  // Get from localStorage mirror (instant, synchronous)
  getLocal<K extends SettingKey>(key: K): SettingsDict[K] | undefined {
    try {
      const item = localStorage.getItem(`setting:${key}`);
      if (item) return JSON.parse(item) as SettingsDict[K];
    } catch {}
    return SETTINGS_DEFAULTS[key];
  },
};
// Runtime accessibility preferences.
//
// The three WCAG-related settings live in the settings repository; this module
// is the single place that projects them onto <html data-*>. CSS then owns all
// visual overrides. Keeping the projection here avoids a cycle between the
// router, the app entry point and SettingsView.
import { settingsRepo } from '../db/repositories/settings';

export type AccessibilitySettings = {
  fontScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
};

const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.5;

/** Clamp to the slider's 0.8–1.5 range and to its 0.1 steps. */
export function normalizeFontScale(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const stepped = Math.round(parsed * 10) / 10;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped));
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Apply persisted preferences (plus any live, not-yet-persisted override from
 * the Settings slider) to the document root. Safe to call on every render.
 */
export function applyAccessibilitySettings(
  overrides: Partial<AccessibilitySettings> = {}
): AccessibilitySettings {
  const fontScale = normalizeFontScale(
    overrides.fontScale ?? settingsRepo.getLocal('fontScale') ?? 1
  );
  const reducedMotion = asBoolean(
    overrides.reducedMotion ?? settingsRepo.getLocal('reducedMotion') ?? false
  );
  const highContrast = asBoolean(
    overrides.highContrast ?? settingsRepo.getLocal('highContrast') ?? false
  );

  const root = document.documentElement;
  // Keep two decimals of precision-free formatting so the value always matches
  // the explicit [data-font-scale="1.0"] CSS selectors.
  root.dataset.fontScale = fontScale.toFixed(1);
  root.dataset.reducedMotion = String(reducedMotion);
  root.dataset.highContrast = String(highContrast);

  return { fontScale, reducedMotion, highContrast };
}

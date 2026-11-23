/**
 * WCAG 2.1 AA contrast guard for the design tokens in main.css.
 * The helpers are pure functions — no DOM or browser APIs are required.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/shared/styles/main.css');
const css = readFileSync(cssPath, 'utf8');

/** Relative luminance per WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Invalid hex colour: ${hex}`);
  const channels = [0, 2, 4].map(offset => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio (1–21) between two opaque colours. */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Composite a hex colour at `alpha` opacity over an opaque hex background. */
export function tint(foreground: string, background: string, alpha: number): string {
  const fg = foreground.replace('#', '');
  const bg = background.replace('#', '');
  return '#' + [0, 2, 4].map(offset => {
    const channel = Math.round(
      parseInt(fg.slice(offset, offset + 2), 16) * alpha +
      parseInt(bg.slice(offset, offset + 2), 16) * (1 - alpha)
    );
    return channel.toString(16).padStart(2, '0');
  }).join('');
}

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`CSS block not found: ${selector}`);
  return match[1];
}

const rootBlock = block(':root');
const darkBlock = block('[data-theme="dark"]');

function token(name: string, source = rootBlock): string {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} not found or not a hex colour`);
  return match[1];
}

type Pair = readonly [foreground: string, background: string, label?: string];

/** Documented text/surface pairs. Colours are resolved from main.css tokens. */
const lightTextPairs: Pair[] = [
  [token('color-text'), token('color-bg'), 'body text on page'],
  [token('color-text'), token('color-bg-elevated'), 'body text on card'],
  [token('color-text'), token('color-primary-light'), 'body text on tint'],
  [token('color-text-muted'), token('color-bg'), 'muted text on page'],
  [token('color-text-muted'), token('color-bg-hover'), 'muted text on hover'],
  [token('color-text-muted'), token('color-bg-elevated'), 'stat-label on card'],
  [token('color-text-light'), token('color-bg'), 'light text on page'],
  [token('color-text-light'), token('color-bg-hover'), 'light text on hover'],
  [token('color-text-light'), token('color-bg-elevated'), 'light text on card'],
  [token('color-primary'), token('color-bg'), 'primary link on page'],
  [token('color-primary'), token('color-bg-elevated'), 'primary link on card'],
  [token('color-primary'), token('color-primary-light'), 'badge-primary'],
  [token('color-on-primary'), token('color-primary'), 'btn-primary label'],
  [token('color-secondary'), token('color-bg-elevated'), 'secondary text'],
  [token('color-success'), token('color-success-light'), 'badge-success'],
  [token('color-on-success'), token('color-success'), 'btn-success label'],
  [token('color-warning'), token('color-warning-light'), 'badge-warning'],
  [token('color-on-warning'), token('color-warning'), 'btn-warning label'],
  [token('color-danger'), token('color-danger-light'), 'badge-danger'],
  [token('color-on-danger'), token('color-danger'), 'btn-danger label'],
  [token('color-info'), token('color-info-light'), 'badge-info'],
  [token('color-on-info'), token('color-info'), 'btn-info label'],
];

const darkTextPairs: Pair[] = [
  [token('color-text', darkBlock), token('color-bg', darkBlock), 'dark body text'],
  [token('color-text-muted', darkBlock), token('color-bg', darkBlock), 'dark muted text'],
  [token('color-text-muted', darkBlock), token('color-bg-hover', darkBlock), 'dark muted on hover'],
  [token('color-text-light', darkBlock), token('color-bg-hover', darkBlock), 'dark light on hover'],
  [token('color-primary', darkBlock), token('color-primary-light', darkBlock), 'dark badge-primary'],
  [token('color-on-primary', darkBlock), token('color-primary', darkBlock), 'dark btn-primary label'],
  [token('color-success', darkBlock), token('color-success-light', darkBlock), 'dark badge-success'],
  [token('color-warning', darkBlock), token('color-warning-light', darkBlock), 'dark badge-warning'],
  [token('color-danger', darkBlock), token('color-danger-light', darkBlock), 'dark badge-danger'],
  [token('color-info', darkBlock), token('color-info-light', darkBlock), 'dark badge-info'],
];

/** Non-text UI boundaries and focus rings need at least 3:1 (WCAG 1.4.11). */
const uiPairs: Pair[] = [
  [token('color-border-strong'), token('color-bg'), 'input border on page'],
  [token('color-border-strong'), token('color-bg-elevated'), 'input border on card'],
  [token('color-focus'), token('color-bg'), 'focus ring on page'],
  [token('color-focus'), token('color-bg-elevated'), 'focus ring on card'],
  [token('color-border-strong', darkBlock), token('color-bg', darkBlock), 'dark input border'],
  [token('color-focus', darkBlock), token('color-bg', darkBlock), 'dark focus ring'],
];

/** Hard-coded badge colours that are not driven by CSS variables. */
const badgePairs: Pair[] = [
  ['#065f46', '#d1fae5', 'difficulty easy'],
  ['#92400e', '#fef3c7', 'difficulty medium'],
  ['#991b1b', '#fee2e2', 'difficulty hard'],
  ['#1e40af', '#dbeafe', 'mastery level 2'],
  ['#55657a', '#f1f5f9', 'mastery level 0 / stat label'],
];

const subdomainTokens = [
  'subdomain-meteorology',
  'subdomain-climatology',
  'subdomain-geophysics',
  'subdomain-geology',
  'subdomain-instrumentation',
  'subdomain-default',
] as const;

describe('WCAG 2.1 AA token contrast', () => {
  it.each(lightTextPairs)('%s on %s (%s) is at least 4.5:1', (foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(darkTextPairs)('%s on %s (%s) is at least 4.5:1', (foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(badgePairs)('%s on %s (%s) is at least 4.5:1', (foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(uiPairs)('%s on %s (%s) is at least 3:1', (foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
  });

  it.each(subdomainTokens)('--%s stays legible on its 12%% tint (light)', name => {
    const colour = token(name);
    expect(contrastRatio(colour, tint(colour, token('color-bg-elevated'), 0.12))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(subdomainTokens)('--%s stays legible on its 12%% tint (dark)', name => {
    const colour = token(name, darkBlock);
    expect(
      contrastRatio(colour, tint(colour, token('color-bg-elevated', darkBlock), 0.12))
    ).toBeGreaterThanOrEqual(4.5);
  });
});

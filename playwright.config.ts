import { existsSync } from 'node:fs';
import { defineConfig, devices, type Project } from 'playwright/test';
import { firefox, webkit } from 'playwright';

/**
 * Cross-browser matrix for the non-stress specs. Chromium covers both Chrome
 * and Edge (Edge is Chromium-based); Firefox and WebKit are the closest
 * automation proxies for Firefox and Safari, with iOS Safari / Android Chrome
 * and Edge recorded in the manual matrix. A browser project is only enabled
 * when its binary is installed locally, so `npm run test:e2e` works on a
 * machine that downloaded just Chromium while CI with all three browsers
 * automatically exercises the full matrix.
 */
function isInstalled(browser: { executablePath: () => string }): boolean {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
}

const projects: Project[] = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
];

if (isInstalled(firefox)) {
  projects.push({
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  });
}

if (isInstalled(webkit)) {
  projects.push({
    name: 'webkit',
    use: { ...devices['Desktop WebKit'] },
  });
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

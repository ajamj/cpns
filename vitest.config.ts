import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests only; DOM flows are covered by Playwright. Keeps the
    // runner independent of an undeclared jsdom dependency.
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.test.ts', '**/*.spec.ts', 'vite.config.ts', 'vitest.config.ts'],
    },
  },
});
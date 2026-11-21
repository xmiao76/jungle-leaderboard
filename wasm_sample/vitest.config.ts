import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'web/src/**/*.test.ts', 'host/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    testTimeout: 60_000,
  },
});

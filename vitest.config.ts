import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'arena/src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', 'dist/**', 'wasm_sample/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      // Unit coverage targets the Arena's logic. DOM, canvas, audio and worker-entry
      // modules run only in a browser and are covered by the Playwright suites
      // (tests/e2e) and the conformance runner instead.
      include: ['arena/src/**/*.ts', 'server/**/*.ts'],
      exclude: [
        'arena/src/**/*.test.ts',
        'arena/src/**/*.test-support.ts',
        'server/**/*.test.ts',
        'server/**/*.test-support.ts',
        'arena/src/**/*.d.ts',
        'arena/src/main.ts',
        'arena/src/workers/**',
        'arena/src/app/**',
        'arena/src/audio/**',
        'arena/src/conformance/**',
        'arena/src/ui/present.ts',
        'arena/src/ui/classes.ts',
        'arena/src/replay/player.ts',
        'arena/src/replay/reference-board.ts',
      ],
      thresholds: { lines: 80, statements: 80, functions: 80 },
    },
  },
});

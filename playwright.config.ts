import { defineConfig, devices } from '@playwright/test';

// The built site is served under a nested prefix to prove every Arena URL is relative; its
// api/ requests are forwarded to the real catalog API (wrangler pages dev, fresh seeded state).
export const SUBPATH = '/nested/static/path/';
const PORT = 4400;
const API_PORT = 4410;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${SUBPATH}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node --import tsx scripts/api-server.ts --port ${API_PORT} --state .wrangler/e2e-state --fresh`,
      url: `http://127.0.0.1:${API_PORT}/api/catalog/manifest.json`,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
    {
      command: `node scripts/serve-static.mjs dist --prefix ${SUBPATH} --port ${PORT} --api http://127.0.0.1:${API_PORT}`,
      url: `http://127.0.0.1:${PORT}${SUBPATH}arena/`,
      reuseExistingServer: !process.env['CI'],
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});

import { defineConfig, devices } from '@playwright/test';

// The production bundle is served from a nested path to prove every URL is relative.
export const SUBPATH = '/games/jungle-sample/';
const PORT = 4410;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${PORT}${SUBPATH}`, trace: 'retain-on-failure' },
  webServer: {
    command: `node scripts/serve-static.mjs web/dist --prefix ${SUBPATH} --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}${SUBPATH}`,
    reuseExistingServer: !process.env['CI'],
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 900 } } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 900 } } },
    { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1280, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 900 } } },
  ],
});

import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { chooseVersion, fixture, importWasm, openArena, playInSeat, SAMPLE, setFastPlay, setUpTestVsSample, startMatch } from './arena';

test.describe.configure({ mode: 'serial' });

/** Import a late-failing entrant into the left seat (Red) against the public catalog game. */
async function lateMatch(page: Page, file: string, thinkDeadline?: string) {
  await importWasm(page, fixture(file));
  await playInSeat(page, 'left');
  await setFastPlay(page);
  await chooseVersion(page, 'right', SAMPLE, 'v1.0.0');
  await page.getByTestId('left-red').check();
  if (thinkDeadline) await page.getByTestId('think-deadline').selectOption({ label: thinkDeadline });
  await startMatch(page);
}

test('an out-of-range index forfeits as invalid-move', async ({ page }) => {
  await lateMatch(page, 'late-index.wasm');
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 60_000 });
  await expect(page.getByTestId('result')).toContainText('Blue wins');
  await expect(page.getByTestId('result')).toContainText('invalid move');
  await expect(page.locator('[data-notice="warning"]')).toContainText('invalid move');
});

test('a trapping entrant forfeits as trap', async ({ page }) => {
  await lateMatch(page, 'late-trap.wasm');
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 60_000 });
  await expect(page.getByTestId('result')).toContainText('the opponent crashed');
});

test('a non-responsive entrant forfeits at the think deadline while the page stays responsive', async ({ page }) => {
  await lateMatch(page, 'late-hang.wasm', '1 s');
  await expect(page.getByTestId('activity-left')).toHaveText('thinking', { timeout: 30_000 });
  // The guest spins in its worker; the main thread must still answer at once.
  const started = Date.now();
  await page.getByTestId('mute').click();
  await expect(page.getByTestId('mute')).toHaveText('Unmute');
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 30_000 });
  await expect(page.getByTestId('result')).toContainText('ran out of time');
  // A fresh instance drew the terminal position for the forfeiting seat.
  const rev = await page.getByTestId('rev').textContent();
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', rev!);
});

test('a bad frame marks only that pane and the game still finishes', async ({ page }) => {
  await lateMatch(page, 'late-frame-size.wasm');
  await expect(page.getByTestId('pane-error-left')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pane-error-left')).toContainText('Display failure');
  await expect(page.getByTestId('pane-error-right')).toHaveCount(0);
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 120_000 });
  await expect(page.getByTestId('result')).toContainText(/wins|Draw/);
});

test('pause takes effect at a ply boundary and resume continues', async ({ page }) => {
  await setUpTestVsSample(page);
  await page.getByLabel('Animation speed').selectOption('slow');
  await startMatch(page);
  await expect(page.getByTestId('phase')).toHaveText('Playing', { timeout: 60_000 });
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('phase')).toHaveText('Paused', { timeout: 30_000 });
  const rev = await page.getByTestId('rev').textContent();
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('rev')).toHaveText(rev!);
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', rev!);
  await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', rev!);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('rev')).not.toHaveText(rev!, { timeout: 30_000 });
});

test('a replay whose binaries are missing opens on the labeled reference board', async ({ page }, info) => {
  await setUpTestVsSample(page);
  await setFastPlay(page);
  await startMatch(page);
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 120_000 });

  await openArena(page); // the replay list lives on the setup page
  const download = page.waitForEvent('download');
  await page.getByTestId('replay-list').locator('li[data-replay-id]').first().getByTestId('replay-download').click();
  const path = info.outputPath('replay.json');
  await (await download).saveAs(path);
  const replay = JSON.parse(readFileSync(path, 'utf8'));
  replay.id = `${replay.id}-orphan`;
  replay.seats.left.sha256 = 'e'.repeat(64);
  replay.seats.right.sha256 = 'f'.repeat(64);
  const orphan = info.outputPath('orphan-replay.json');
  writeFileSync(orphan, JSON.stringify(replay));

  await page.getByTestId('replay-import').setInputFiles(orphan);
  await expect(page.getByTestId('replay-viewer')).toBeVisible();
  await expect(page.getByTestId('replay-source-left')).toContainText('Arena reference board');
  await expect(page.getByTestId('replay-source-right')).toContainText('Arena reference board');
  await expect(page.getByTestId('replay-why-left')).toContainText('not on this device');
});

test('works, and says so, when IndexedDB is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await openArena(page);
  await expect(page.locator('[data-notice="storage"]')).toContainText('IndexedDB');
  await setFastPlay(page);
  // Uploads would not survive the page change without storage, so both seats use the public game.
  await chooseVersion(page, 'left', SAMPLE, 'v1.0.0');
  await chooseVersion(page, 'right', SAMPLE, 'v1.0.0');
  await startMatch(page);
  await expect(page.getByTestId('phase')).toHaveText('Finished', { timeout: 120_000 });
});

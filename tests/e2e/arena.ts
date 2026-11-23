import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) => fileURLToPath(new URL(`../../arena/test-fixtures/${name}`, import.meta.url));

/** The Arena play page (/arena/). */
export async function openArena(page: Page): Promise<void> {
  await page.goto('arena/');
  await expect(page.locator('[data-page="arena"][data-booted="true"]')).toBeVisible({ timeout: 30_000 });
}

/** The game upload page (/arena/upload/). */
export async function openUpload(page: Page): Promise<void> {
  await page.goto('arena/upload/');
  await expect(page.locator('[data-page="upload"][data-booted="true"]')).toBeVisible({ timeout: 30_000 });
}

/** Upload through the public upload page, exactly as a visitor would. Stays on that page. */
export async function importWasm(page: Page, file: string): Promise<string> {
  await openUpload(page);
  await page.getByTestId('import-input').setInputFiles(file);
  const admitted = page.getByTestId('import-admitted');
  const rejected = page.getByTestId('import-rejected');
  await expect(admitted.or(rejected)).toBeVisible({ timeout: 90_000 });
  await expect(rejected).toHaveCount(0);
  return (await page.getByTestId('import-title').textContent()) ?? '';
}

/** After an upload: "Play in … seat" puts it in that seat and opens the Arena page. */
export async function playInSeat(page: Page, seat: 'left' | 'right'): Promise<void> {
  await page.getByTestId(`use-${seat}`).click();
  await expect(page.locator('[data-page="arena"][data-booted="true"]')).toBeVisible({ timeout: 30_000 });
}

export async function chooseVersion(page: Page, seat: 'left' | 'right', title: string, versionText: string): Promise<void> {
  await page.getByTestId(`title-${seat}`).selectOption({ label: title });
  const select = page.getByTestId(`version-${seat}`);
  const option = select.locator('option', { hasText: versionText }).first();
  await select.selectOption({ value: (await option.getAttribute('value'))! });
}

export async function setFastPlay(page: Page): Promise<void> {
  await page.getByLabel('Animation speed').selectOption('fast');
}

/** Setup page → Start → the full-screen play page has booted. */
export async function startMatch(page: Page): Promise<void> {
  await page.getByTestId('start').click();
  await expect(page.locator('[data-page="play"][data-booted="true"]')).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait until both games of the match are over: the result dialog opens by itself with a headline,
 * and the bar keeps a one-line summary. Closes the dialog so the page can be used again.
 */
export async function waitForMatchResult(page: Page, timeout = 170_000): Promise<string> {
  await expect(page.getByTestId('match-result')).toBeVisible({ timeout });
  await expect(page.getByTestId('phase')).toHaveText('Finished');
  await expect(page.getByTestId('match-result-dialog')).toBeVisible();
  await expect(page.getByTestId('match-headline')).toHaveText(/wins the match|The match is drawn|No match result/);
  await closeMatchResult(page);
  return (await page.getByTestId('match-result').textContent()) ?? '';
}

export async function closeMatchResult(page: Page): Promise<void> {
  await page.getByTestId('match-result-close').click();
  await expect(page.getByTestId('match-result-dialog')).toBeHidden();
}

/** Start a match and play it out: both games, then the match result. */
export async function startAndFinish(page: Page): Promise<{ result: string; match: string; games: string; rev: number }> {
  await startMatch(page);
  const match = await waitForMatchResult(page);
  const rev = Number(await page.getByTestId('rev').textContent());
  // Both panes must end on the same committed revision, each drawn by its own program.
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', String(rev));
  await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', String(rev));
  return {
    result: (await page.getByTestId('result').textContent()) ?? '',
    match,
    games: (await page.getByTestId('match-games').textContent()) ?? '',
    rev,
  };
}

/** A coarse fingerprint of a canvas, to tell two renderers (or two views) apart. */
export function canvasFingerprint(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) >>> 0;
    return `${c.width}x${c.height}:${h.toString(16)}`;
  });
}

/** The real game in the public catalog, and the small test-only entrant from arena/test-fixtures. */
export const SAMPLE = 'Claude-Opus-5.5 · ClaudeCode';
export const TEST_ENTRANT = 'Arena test entrant';

/** Upload the test entrant through the upload page into a seat; ends on the Arena setup page. */
export async function uploadTestEntrant(page: Page, seat: 'left' | 'right', version: '1.1.0' | '1.0.0' = '1.1.0'): Promise<void> {
  expect(await importWasm(page, fixture(`test-entrant-${version}.wasm`))).toBe(TEST_ENTRANT);
  await playInSeat(page, seat);
}

/** A quick, decisive pairing: the test entrant (always index 0) on the left, the real game on the right. */
export async function setUpTestVsSample(page: Page): Promise<void> {
  await uploadTestEntrant(page, 'left');
  await chooseVersion(page, 'right', SAMPLE, 'v1.1.0');
  await playFriendly(page);
}

/** A non-standard node budget makes a match friendly, so ordinary tests leave Elo ratings alone. */
export async function playFriendly(page: Page): Promise<void> {
  await page.getByLabel('Shared search budget (nodes)').selectOption('5000');
  await expect(page.getByTestId('rated-badge')).toHaveText('Friendly match');
}

/** SHA-256 of a test fixture, to open it in a seat by hash. */
export const shaOf = (file: string) => createHash('sha256').update(readFileSync(fixture(file))).digest('hex');

/** The seed catalog's reference program (the sample game). */
export const SAMPLE_SHA: string = JSON.parse(readFileSync(new URL('../../seed/catalog/seed.json', import.meta.url), 'utf8')).entries[0].sha256;

// The leaderboard at / is live: it renders GET api/leaderboard (every published program with
// its Elo standing). The database is shared by every spec in a run, and other specs publish
// programs and (in match.spec) play one rated match, so assertions compare the page against
// the API, and rating changes are asserted relatively, never as fixed numbers.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { SAMPLE, SAMPLE_SHA, setFastPlay, shaOf, startMatch } from './arena';

interface Standing {
  sha256: string;
  title: string;
  rating: number;
  ratedMatches: number;
  wins: number;
  losses: number;
  draws: number;
  provisional: boolean;
}

async function standings(page: Page): Promise<Standing[]> {
  const response = await page.request.get('api/leaderboard');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { entries: Standing[] }).entries;
}

const board = (page: Page) => page.locator('#leaderboard');
const rows = (page: Page) => board(page).locator('tbody tr[data-sha]');
const rowFor = (page: Page, sha: string) => board(page).locator(`tbody tr[data-sha="${sha}"]`);

test('shows every published program at its API standing, fresh ones at 1000 provisional', async ({ page }) => {
  const api = await standings(page);
  expect(api.length).toBeGreaterThanOrEqual(5); // the seed sample plus the e2e fixtures

  await page.goto('./');
  await expect(board(page)).toHaveAttribute('data-state', 'ready');
  await expect(rows(page)).toHaveCount(api.length);
  await expect(board(page).locator('[data-lb-podium] li[data-sha]')).toHaveCount(3);

  // The page renders the API's order exactly.
  const domShas = await rows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-sha')));
  expect(domShas).toEqual(api.map((e) => e.sha256));

  // The sample program is there, under its own name, with a relative Arena link.
  const sample = rowFor(page, SAMPLE_SHA);
  await expect(sample.locator('[data-f="title"]')).toHaveText(SAMPLE);
  // Both the sample and the fixtures declare the official model platform, shown under Model.
  await expect(sample.locator('[data-f="modelPlatform"]')).toHaveText('official');
  await expect(sample.locator('[data-f="arena"]')).toHaveAttribute('href', new RegExp(`arena/\\?left=${SAMPLE_SHA}$`));

  // A program that has never played a rated match sits at 1000, provisional, 0–0–0.
  const fresh = rowFor(page, shaOf('late-hang.wasm'));
  await expect(fresh.locator('[data-f="rating"]')).toHaveText('1000');
  await expect(fresh.locator('[data-f="provisional"]')).toBeVisible();
  await expect(fresh.locator('[data-f="matches"]')).toHaveText('0');
  await expect(fresh.locator('[data-f="record"]')).toHaveText('0–0–0');
  await expect(fresh.locator('[data-f="modelPlatform"]')).toBeVisible();
});

test('shows its empty state when nothing is published', async ({ page }) => {
  await page.route('**/api/leaderboard', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ entries: [] }) }),
  );
  await page.goto('./');
  await expect(board(page)).toHaveAttribute('data-state', 'empty');
  await expect(board(page)).toContainText('No programs have been published yet');
});

test('shows its error state when the API fails, and retry recovers', async ({ page }) => {
  let failing = true;
  await page.route('**/api/leaderboard', (route) =>
    failing ? route.fulfill({ status: 503, body: 'The leaderboard is temporarily unavailable.' }) : route.continue(),
  );
  await page.goto('./');
  await expect(board(page)).toHaveAttribute('data-state', 'error');

  failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(board(page)).toHaveAttribute('data-state', 'ready');
  await expect(rows(page).first()).toBeVisible();
});

test('a rated match moves both programs on the leaderboard', async ({ page }) => {
  test.setTimeout(240_000);
  const leftSha = shaOf('test-entrant-1.1.0.wasm');
  const before = await standings(page);
  const was = (sha: string) => before.find((e) => e.sha256 === sha)!;

  await page.goto(`arena/?left=${leftSha}&right=${SAMPLE_SHA}`);
  await expect(page.locator('[data-page="arena"][data-booted="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('rated-badge')).toHaveText('Rated match');
  await page.getByTestId('seed').fill('20261122');
  await page.getByTestId('seed').blur();
  await setFastPlay(page);
  await startMatch(page);
  await expect(page.getByTestId('match-result-dialog')).toBeVisible({ timeout: 170_000 });
  await expect(page.getByTestId('match-rating')).toHaveAttribute('data-state', 'counted', { timeout: 30_000 });

  const after = await standings(page);
  const now = (sha: string) => after.find((e) => e.sha256 === sha)!;
  const leftDelta = now(leftSha).rating - was(leftSha).rating;
  const rightDelta = now(SAMPLE_SHA).rating - was(SAMPLE_SHA).rating;
  expect(leftDelta).not.toBe(0);
  expect(Math.abs(leftDelta + rightDelta)).toBeLessThan(1e-9); // ratings are conserved
  for (const sha of [leftSha, SAMPLE_SHA]) {
    expect(now(sha).ratedMatches).toBe(was(sha).ratedMatches + 1);
    const games = now(sha).wins - was(sha).wins + (now(sha).losses - was(sha).losses) + (now(sha).draws - was(sha).draws);
    expect(games).toBe(2);
  }

  await page.goto('./');
  await expect(board(page)).toHaveAttribute('data-state', 'ready');
  for (const sha of [leftSha, SAMPLE_SHA]) {
    await expect(rowFor(page, sha).locator('[data-f="rating"]')).toHaveText(String(Math.round(now(sha).rating)));
    await expect(rowFor(page, sha).locator('[data-f="matches"]')).toHaveText(String(now(sha).ratedMatches));
    await expect(rowFor(page, sha).locator('[data-f="record"]')).toHaveText(`${now(sha).wins}–${now(sha).losses}–${now(sha).draws}`);
  }
  // The winner of the rating change now stands above the loser.
  const domShas = await rows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-sha')));
  const winner = leftDelta > 0 ? leftSha : SAMPLE_SHA;
  const loser = leftDelta > 0 ? SAMPLE_SHA : leftSha;
  expect(domShas.indexOf(winner)).toBeLessThan(domShas.indexOf(loser));
});

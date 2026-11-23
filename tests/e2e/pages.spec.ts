// The site has three separate pages: leaderboard (/), game upload (/arena/upload/) and
// the Arena (/arena/). Each has its own path and title, and the shared nav links them.
import { expect, test } from './fixtures';
import { fixture, importWasm, openArena, openUpload, playInSeat, SAMPLE, TEST_ENTRANT } from './arena';

test('leaderboard, upload and arena are separate pages linked by the site nav', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jungle Leaderboard');

  await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page).toHaveURL(/\/arena\/upload\/$/);
  await expect(page).toHaveTitle('Upload a game — Jungle Arena');
  await expect(page.locator('[data-page="upload"]')).toBeVisible();
  await expect(page.getByTestId('import-input')).toBeAttached();
  await expect(page.getByTestId('title-left')).toHaveCount(0); // no match UI here

  await page.getByTestId('nav-arena').click();
  await expect(page).toHaveURL(/\/arena\/$/);
  await expect(page).toHaveTitle(/^Jungle Arena/);
  await expect(page.locator('[data-page="arena"][data-booted="true"]')).toBeVisible();
  await expect(page.getByTestId('import-input')).toHaveCount(0); // no upload UI here
  await expect(page.getByTestId('start')).toBeVisible();

  await page.getByTestId('nav-leaderboard').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jungle Leaderboard');
});

test('an upload that fails its test round is not published, and nothing is stored', async ({ page }) => {
  await openUpload(page);
  await expect(page.getByTestId('public-list')).toContainText(SAMPLE);
  await expect(page.getByTestId('device-list')).toContainText('New uploads are published');
  const published = page.getByTestId('public-list').locator('li[data-sha]');
  const before = await published.count();

  // late-trap passes admission, then crashes in its first game against the reference.
  await page.getByTestId('import-input').setInputFiles(fixture('late-trap.wasm'));
  const rejected = page.getByTestId('import-rejected');
  await expect(rejected).toBeVisible({ timeout: 90_000 });
  await expect(rejected).toContainText('Not published');
  await expect(rejected).toContainText('Nothing was stored');
  await expect(page.locator('[data-stage="smoke"]')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-stage="game-1"]')).toHaveAttribute('data-state', 'failed');
  await expect(published).toHaveCount(before);
  await expect(page.getByTestId('device-list')).toContainText('New uploads are published');
});

test('uploading a program that is already published reuses its entry', async ({ page }) => {
  // The e2e catalog already holds test-entrant-1.1.0 (scripts/e2e-fixtures.ts).
  expect(await importWasm(page, fixture('test-entrant-1.1.0.wasm'))).toBe(TEST_ENTRANT);
  await expect(page.getByTestId('import-admitted')).toContainText('Already published');
  await expect(page.getByTestId('import-admitted')).toContainText('Model platform');
  await expect(page.getByTestId('import-admitted')).toContainText('official');
  await expect(page.locator('[data-stage="publish"]')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-stage="game-2"] [data-testid="plies-game-2"]')).toContainText('plies');
});

test('an uploaded game opens in the chosen seat, and seats can be shared as a link', async ({ page }) => {
  await importWasm(page, fixture('test-entrant-1.0.0.wasm'));
  await playInSeat(page, 'right');
  await expect(page).toHaveURL(/\/arena\/\?right=[0-9a-f]{64}$/);
  await expect(page.getByTestId('version-right')).toContainText('v1.0.0');
  const sha = new URL(page.url()).searchParams.get('right')!;

  // A fresh visit with ?left=&right= preselects both seats.
  await page.goto(`arena/?left=${sha}&right=${sha}`);
  await expect(page.locator('[data-page="arena"][data-booted="true"]')).toBeVisible();
  for (const seat of ['left', 'right'] as const) {
    await expect(page.getByTestId(`version-${seat}`)).toHaveValue(sha);
  }
  await openArena(page);
});

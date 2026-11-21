// The site has three separate pages: leaderboard (/), game upload (/arena/upload/) and
// the Arena (/arena/). Each has its own path and title, and the shared nav links them.
import { expect, test } from '@playwright/test';
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

test('the upload page lists both catalogs and manages this device’s uploads', async ({ page }) => {
  await openUpload(page);
  await expect(page.getByTestId('public-list').locator('li[data-sha]')).toHaveCount(1);
  await expect(page.getByTestId('public-list')).toContainText(SAMPLE);
  await expect(page.getByTestId('device-list')).toContainText('Nothing uploaded yet');

  await importWasm(page, fixture('test-entrant-1.1.0.wasm'));
  const row = page.getByTestId('device-list').locator('li[data-sha]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(TEST_ENTRANT);
  await expect(row).not.toContainText('also in the public catalog');

  const sha = (await row.getAttribute('data-sha'))!;
  await page.getByTestId(`remove-${sha.slice(0, 8)}`).click();
  await expect(page.getByTestId('device-list')).toContainText('Nothing uploaded yet');
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

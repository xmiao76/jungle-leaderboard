// The play page gives the screen to the two game boards: no scrolling, boards side by side
// (stacked on portrait screens), everything else in one bar or in overlays.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { setUpTestVsSample, startMatch } from './arena';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openPausedMatch(page: Page): Promise<void> {
  await setUpTestVsSample(page);
  await page.getByTestId('begin-paused').check();
  await startMatch(page);
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', '0');
  await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', '0');
}

async function boards(page: Page): Promise<[Box, Box]> {
  const left = (await page.getByTestId('canvas-left').boundingBox())!;
  const right = (await page.getByTestId('canvas-right').boundingBox())!;
  return [left, right];
}

async function scrollExtent(page: Page) {
  return page.evaluate(() => ({
    vertical: document.documentElement.scrollHeight - window.innerHeight,
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
  }));
}

for (const [width, height, minShare] of [
  [1920, 1080, 0.6],
  [1366, 768, 0.6],
  [1280, 720, 0.6],
] as const) {
  test(`${width}×${height}: two side-by-side boards fill the screen without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPausedMatch(page);
    expect(await scrollExtent(page)).toEqual({ vertical: 0, horizontal: 0 });

    const [left, right] = await boards(page);
    expect(Math.abs(left.y - right.y)).toBeLessThan(1); // side by side
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    expect(left.y + left.height).toBeLessThanOrEqual(height);
    expect(right.x + right.width).toBeLessThanOrEqual(width);
    expect((left.width * left.height + right.width * right.height) / (width * height)).toBeGreaterThanOrEqual(minShare);
    expect(left.height).toBeGreaterThan(height * 0.82);
    expect(Math.abs(left.width / left.height - 7 / 9)).toBeLessThan(0.01);
  });
}

test('portrait screens stack the boards, still without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await openPausedMatch(page);
  expect(await scrollExtent(page)).toEqual({ vertical: 0, horizontal: 0 });
  const [top, bottom] = await boards(page);
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y);
  expect(bottom.y + bottom.height).toBeLessThanOrEqual(1280);
  expect(top.height).toBeGreaterThan(500);
});

test('the history drawer overlays the boards without moving or resizing them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openPausedMatch(page);
  await page.getByTestId('step').click();
  await expect(page.getByTestId('rev')).toHaveText('1');
  const before = await boards(page);
  await expect(page.getByTestId('history-drawer')).toHaveAttribute('data-open', 'false');

  await page.getByTestId('history-toggle').click();
  await expect(page.getByTestId('history-drawer')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('history').locator('li')).toHaveCount(1);
  expect(await boards(page)).toEqual(before);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('history-drawer')).toHaveAttribute('data-open', 'false');
  await page.keyboard.press('h');
  await expect(page.getByTestId('history-drawer')).toHaveAttribute('data-open', 'true');
});

test('labels above each board name the seat, side, program, version and model; the bar shows the shared state', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openPausedMatch(page);
  const left = page.locator('article[data-seat="left"]');
  await expect(left).toHaveAttribute('aria-label', /Left seat · Red · Arena test entrant v1\.1\.0 · /);
  await expect(page.getByTestId('pane-title-right')).toHaveText('Jungle — Claude-Opus-5.5 sample · v1.1.0');
  await expect(page.getByTestId('side-right')).toHaveText(/Blue/);
  // The label sits directly above its board.
  const label = (await left.locator('header').boundingBox())!;
  const [board] = await boards(page);
  expect(label.y + label.height).toBeLessThanOrEqual(board.y + 1);

  await expect(page.getByTestId('turn')).toHaveText(/Red · Left seat/);
  await page.keyboard.press('s'); // keyboard step
  await expect(page.getByTestId('rev')).toHaveText('1');
  await expect(page.getByTestId('last-move')).toHaveText(/\d+→\d+/);
  await expect(page.getByTestId('back-setup')).toHaveAttribute('href', /\/arena\/$/);
});

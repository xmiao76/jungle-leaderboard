import { expect, test } from '@playwright/test';
import {
  canvasFingerprint,
  chooseVersion,
  openArena,
  SAMPLE,
  setFastPlay,
  setUpTestVsSample,
  startAndFinish,
  startMatch,
  TEST_ENTRANT,
  uploadTestEntrant,
  waitForMatchResult,
} from './arena';

test.describe.configure({ mode: 'serial' });

test('a match is two games, colours swapped so each side moves first once, then the overall result', async ({ page }) => {
  test.setTimeout(400_000); // two full matches (four games)
  // Upload page → Arena setup page with the upload in the left seat; the right seat from the catalog.
  await setUpTestVsSample(page);
  await expect(page.getByTestId('title-left')).toHaveValue(TEST_ENTRANT);
  await expect(page.getByTestId('title-right')).toHaveValue(SAMPLE);
  await setFastPlay(page);
  await page.getByTestId('left-red').check();
  await startMatch(page);

  // Game 1: Left plays Red, as set up.
  await expect(page.getByTestId('series-game')).toHaveText('Game 1 of 2', { timeout: 60_000 });
  await expect(page.getByTestId('side-left')).toHaveText(/Red/);
  // Each pane shows its own program's board.
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', /\d+/);
  expect(await canvasFingerprint(page, 'canvas-left')).not.toBe(await canvasFingerprint(page, 'canvas-right'));

  // Game 2 starts by itself, colours swapped.
  await expect(page.getByTestId('series-game')).toHaveText('Game 2 of 2', { timeout: 150_000 });
  await expect(page.getByTestId('side-left')).toHaveText(/Blue/);

  // After game 2: the overall match result, and what each game was.
  const match = await waitForMatchResult(page);
  expect(match).toMatch(/^Match: Left (2|1½|1|½|0) – (2|1½|1|½|0) Right · /);
  expect(match).toMatch(/wins the match|the match is drawn/);
  await expect(page.getByTestId('series-game')).toHaveText('Match over');
  const games = (await page.getByTestId('match-games').textContent()) ?? '';
  expect(games).toContain('Game 1: Left plays red, Left moves first');
  expect(games).toContain('Game 2: Left plays blue, Right moves first');
  const rev = Number(await page.getByTestId('rev').textContent());
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', String(rev));
  await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', String(rev));

  // Swap & rematch: a new two-game match with game 1's colours exchanged.
  await page.getByTestId('swap').click();
  await expect(page.getByTestId('series-game')).toHaveText('Game 1 of 2', { timeout: 60_000 });
  await expect(page.getByTestId('side-left')).toHaveText(/Blue/);
  await waitForMatchResult(page);
  await expect(page.getByTestId('side-left')).toHaveText(/Red/);
  expect(await page.getByTestId('match-games').textContent()).toContain('Game 1: Left plays blue, Right moves first');
});

test('runs the same binary in both seats', async ({ page }) => {
  await uploadTestEntrant(page, 'left');
  await chooseVersion(page, 'right', TEST_ENTRANT, 'v1.1.0');
  await setFastPlay(page);
  const { result, match } = await startAndFinish(page);
  expect(result).toMatch(/wins|Draw/);
  expect(match).toMatch(/wins the match|the match is drawn/);
  await expect(page.getByTestId('pane-title-left')).toHaveText((await page.getByTestId('pane-title-right').textContent()) ?? '');
});

test('plays a program against an older version of itself', async ({ page }) => {
  await uploadTestEntrant(page, 'left', '1.1.0');
  await uploadTestEntrant(page, 'right', '1.0.0');
  await chooseVersion(page, 'left', TEST_ENTRANT, 'v1.1.0');
  await chooseVersion(page, 'right', TEST_ENTRANT, 'v1.0.0');
  await setFastPlay(page);
  await startAndFinish(page);
  await expect(page.getByTestId('pane-title-left')).toContainText('v1.1.0');
  await expect(page.getByTestId('pane-title-right')).toContainText('v1.0.0');
});

test('steps one ply at a time, flips one board, and keeps both panes on the same revision', async ({ page }) => {
  await setUpTestVsSample(page);
  await page.getByTestId('begin-paused').check();
  await startMatch(page);
  await expect(page.getByTestId('phase')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', '0');

  for (const expected of [1, 2, 3]) {
    await page.getByTestId('step').click();
    await expect(page.getByTestId('rev')).toHaveText(String(expected));
    await expect(page.getByTestId('phase')).toHaveText('Paused');
    await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', String(expected));
    await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', String(expected));
  }
  await expect(page.getByTestId('history').locator('li')).toHaveCount(3);

  const before = await canvasFingerprint(page, 'canvas-left');
  const rightBefore = await canvasFingerprint(page, 'canvas-right');
  await page.getByTestId('flip-left').click();
  await expect.poll(() => canvasFingerprint(page, 'canvas-left')).not.toBe(before);
  expect(await canvasFingerprint(page, 'canvas-right')).toBe(rightBefore);
  await expect(page.getByTestId('rev')).toHaveText('3');

  // Still a legal, synchronized game after flipping.
  await page.getByTestId('step').click();
  await expect(page.getByTestId('rev')).toHaveText('4');
  await expect(page.getByTestId('canvas-left')).toHaveAttribute('data-rev', '4');
  await expect(page.getByTestId('canvas-right')).toHaveAttribute('data-rev', '4');
});

test('reopens a saved replay after a reload with the original renderers', async ({ page }) => {
  await setUpTestVsSample(page);
  await setFastPlay(page);
  const { rev } = await startAndFinish(page);

  // A fresh load of the setup page (which lists replays), then full-screen playback.
  await openArena(page);
  const items = page.getByTestId('replay-list').locator('li[data-replay-id]');
  await expect(items.first()).toBeVisible();
  // Each game of the match is its own replay; the newest is game 2.
  await expect(items.first().getByTestId('replay-game')).toHaveText(/Game 2 of 2/);
  await expect(items.nth(1).getByTestId('replay-game')).toHaveText(/Game 1 of 2/);
  await items.first().getByTestId('replay-open').click();
  const viewer = page.getByTestId('replay-viewer');
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('replay-source-left')).toHaveText('original renderer', { timeout: 60_000 });
  await expect(page.getByTestId('replay-source-right')).toHaveText('original renderer');
  await expect(viewer.getByText(`Revision ${rev} of ${rev}`)).toBeVisible();
  await expect(page.getByTestId('replay-result')).toBeVisible();

  // Seeking straight to an early revision redraws it.
  const end = await canvasFingerprint(page, 'replay-canvas-left');
  await page.getByTestId('replay-seek').fill('2');
  await expect.poll(() => canvasFingerprint(page, 'replay-canvas-left')).not.toBe(end);
});

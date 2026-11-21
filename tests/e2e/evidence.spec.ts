// Render evidence for the README: one finished match between an uploaded program and the
// public catalog's game, with each pane saved separately. Written to docs/evidence/.
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canvasFingerprint, setFastPlay, setUpTestVsSample, startAndFinish } from './arena';

const OUT = fileURLToPath(new URL('../../docs/evidence/arena/', import.meta.url));

test('captures both entrants’ own boards at the same final revision', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'evidence is captured once, in Chromium');
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpTestVsSample(page);
  await setFastPlay(page);
  const { rev } = await startAndFinish(page);
  expect(await canvasFingerprint(page, 'canvas-left')).not.toBe(await canvasFingerprint(page, 'canvas-right'));
  await page.getByTestId('canvas-left').screenshot({ path: `${OUT}pane-left-test-entrant-rev${rev}.png` });
  await page.getByTestId('canvas-right').screenshot({ path: `${OUT}pane-right-sample-rev${rev}.png` });
  await page.screenshot({ path: `${OUT}play-page-1280.png` });
});

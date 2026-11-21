import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { instantiate, RELEASE } from '../support';

const EVIDENCE = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));

interface Hooks {
  legal(): number[];
  toPlay(): number;
  status(): number;
  humanSide(): number;
  thinking(): boolean;
}

async function open(page: Page, query = '?test&fast&seed=7'): Promise<number> {
  const started = Date.now();
  await page.goto(`./${query}`);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 60_000 });
  return Date.now() - started;
}

async function start(page: Page, options: { mode?: 'ai-ai'; level?: 'easy' | 'medium' | 'hard'; aiFirst?: boolean; side?: 'blue' } = {}) {
  const menu = page.locator('#menu');
  if (!(await menu.evaluate((d: HTMLDialogElement) => d.open))) await page.locator('#btn-new').click();
  if (options.mode === 'ai-ai') await page.getByTestId('mode-ai-ai').check();
  // The dialog keeps its last choices, so always set the level explicitly.
  const levelValue = { easy: '0', medium: '1', hard: '2' }[options.level ?? 'medium'];
  await page.locator(`input[name="level"][value="${levelValue}"]`).check();
  if (options.aiFirst) await page.getByTestId('ai-first').check();
  if (options.side) await page.getByTestId('human-side').selectOption('1');
  // The dialog's close event starts the new game as a later task: wait for it, or the
  // next clicks would land on the previous game.
  const previous = await page.getByTestId('board').getAttribute('data-game');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('board')).not.toHaveAttribute('data-game', previous ?? '');
}

/** Run `fn` against the page's read-only test hooks (`?test`). */
const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate(`(${fn.toString()})(window.__jungle)`) as Promise<T>;

/** Click the centre of a board square through the canvas, honouring the flip. */
async function clickSquare(page: Page, square: number, flipped: boolean) {
  const box = (await page.getByTestId('board').boundingBox())!;
  const cell = flipped ? 62 - square : square;
  await page.mouse.click(box.x + (((cell % 7) + 0.5) / 7) * box.width, box.y + ((Math.floor(cell / 7) + 0.5) / 9) * box.height);
}

const rev = async (page: Page) => Number(await page.getByTestId('board').getAttribute('data-rev'));

test('loads from a nested path, shows the release identity, and offers the exact binary', async ({ page, request }) => {
  await open(page);
  const info = (await instantiate(RELEASE)).game.info();
  const identity = page.getByTestId('identity');
  for (const key of ['model', 'codeAgent', 'engineVersion', 'runtime', 'rulesId'] as const) await expect(identity).toContainText(info[key]!);
  await expect(identity).toContainText(`${info['title']} v${info['gameVersion']}`);
  await page.getByRole('button', { name: 'Cancel' }).click();

  const href = (await page.getByTestId('download').getAttribute('href'))!;
  const response = await request.get(new URL(href, page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/wasm');
  const body = await response.body();
  const sha = createHash('sha256').update(body).digest('hex');
  expect(sha).toBe(createHash('sha256').update(readFileSync(RELEASE)).digest('hex'));
  await expect(page.getByTestId('release-sha')).toHaveText(sha);
});

test('a scripted human game against the AI reaches a verified terminal position', async ({ page }) => {
  await open(page);
  await start(page, { level: 'easy' });
  for (let ply = 0; ply < 400; ply += 1) {
    if ((await hooks(page, (h) => h.status())) !== 0) break;
    await expect.poll(() => hooks(page, (h) => h.toPlay() === h.humanSide() && !h.thinking()), { timeout: 30_000 }).toBe(true).catch(() => undefined);
    if ((await hooks(page, (h) => h.status())) !== 0) break;
    const legal = await hooks(page, (h) => h.legal());
    // Deterministic script: prefer captures, then the move that gets closest to the blue den (3).
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < legal.length; i += 2) {
      const dst = legal[i + 1]!;
      const score = -(Math.abs(Math.floor(dst / 7)) + Math.abs((dst % 7) - 3)) + (i % 6) * 0.01;
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    const before = await rev(page);
    await clickSquare(page, legal[best]!, false);
    await clickSquare(page, legal[best + 1]!, false);
    await expect.poll(() => rev(page)).toBeGreaterThan(before);
  }
  await expect(page.getByTestId('board')).not.toHaveAttribute('data-status', '0', { timeout: 60_000 });
  await expect(page.getByTestId('message')).toHaveText(/wins|Draw/);
  expect(await page.getByTestId('history').locator('li').count()).toBe(await rev(page));
});

test('AI vs AI plays a complete game', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'ai-ai', level: 'easy' });
  await expect(page.getByTestId('board')).not.toHaveAttribute('data-status', '0', { timeout: 240_000 });
  await expect(page.getByTestId('message')).toHaveText(/wins|Draw/);
});

test('pointer mapping follows the flip, and both first-mover choices work', async ({ page }) => {
  await open(page);
  await start(page, { aiFirst: true, side: 'blue' });
  // Red (the AI) moves first.
  await expect.poll(() => rev(page)).toBe(1);
  await page.getByTestId('flip').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-flipped', 'true');
  await expect.poll(() => hooks(page, (h) => h.toPlay() === h.humanSide() && !h.thinking())).toBe(true);
  const legal = await hooks(page, (h) => h.legal());
  await clickSquare(page, legal[0]!, true);
  await clickSquare(page, legal[1]!, true);
  await expect.poll(() => rev(page)).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('history').locator('li').nth(1)).toContainText(`${legal[0]} → ${legal[1]}`);
});

test('undo during the AI’s thought restores the position and drops the late reply', async ({ page }) => {
  await open(page, '?test&seed=7');
  await start(page, { level: 'hard' });
  await clickSquare(page, 42, false);
  await clickSquare(page, 35, false);
  await expect(page.getByTestId('ai-status')).toHaveText(/thinking/);
  await page.getByTestId('undo').click();
  await expect.poll(() => rev(page)).toBe(0);
  await page.waitForTimeout(4_000); // longer than a Hard search; the stale reply must not land
  expect(await rev(page)).toBe(0);
  expect(await hooks(page, (h) => h.toPlay() === h.humanSide())).toBe(true);
});

test('stays responsive while the AI searches, and records load and think times', async ({ page }, info) => {
  const loadMs = await open(page, '?test&seed=11');
  const timings: Record<string, number> = { coldLoadMs: loadMs };
  for (const level of ['easy', 'medium', 'hard'] as const) {
    await start(page, { level });
    // Sample animation frames from the moment the search starts until it ends; a long gap
    // would mean the search blocked the UI thread. Armed before the click so a fast search
    // is still observed.
    const sampling = page.evaluate(
      () =>
        new Promise<{ maxGapMs: number; frames: number; seen: string[] }>((resolve) => {
          // The status text changes synchronously when a search starts and ends; a
          // MutationObserver sees both even when the search fits inside one frame.
          const status = document.getElementById('ai-status')!;
          const seen: string[] = [];
          let started = false;
          let done = false;
          let last = 0;
          let max = 0;
          let frames = 0;
          const finish = () => {
            done = true;
            observer.disconnect();
            resolve({ maxGapMs: max, frames, seen });
          };
          const observer = new MutationObserver(() => {
            const text = status.textContent ?? '';
            seen.push(text);
            if (text.includes('thinking') && !started) {
              started = true;
              last = performance.now();
            } else if (started && text.includes('took')) {
              max = Math.max(max, performance.now() - last);
              finish();
            }
          });
          observer.observe(status, { childList: true, characterData: true, subtree: true });
          // Never hang the test: report what was observed instead.
          setTimeout(() => {
            if (!done) finish();
          }, 30_000);
          const tick = (now: number) => {
            if (started && !done) {
              max = Math.max(max, now - last);
              last = now;
              frames += 1;
            }
            if (!done) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const before = await rev(page);
    await clickSquare(page, 42, false);
    await clickSquare(page, 35, false);
    await expect.poll(() => rev(page), { message: `${level}: the human move was not registered` }).toBeGreaterThan(before);
    const { maxGapMs, frames, seen } = await sampling;
    expect(seen.some((t) => t.includes('took')), `${level}: status changes seen: ${JSON.stringify(seen)}`).toBe(true);
    await expect(page.getByTestId('ai-status')).toHaveText(/took \d+ ms/);
    const thinkMs = Number((await page.getByTestId('ai-status').textContent())!.match(/(\d+) ms/)![1]);
    timings[`${level}ThinkMs`] = thinkMs;
    timings[`${level}FramesDuringSearch`] = frames;
    timings[`${level}MaxFrameGapMs`] = Math.round(maxGapMs);
    expect(maxGapMs, `${level}: main thread blocked`).toBeLessThan(250);
    // A search long enough to measure must have kept the page painting throughout.
    if (thinkMs > 200) expect(frames, `${level}: frames painted during a ${thinkMs} ms search`).toBeGreaterThan(thinkMs / 100);
  }
  if (info.project.name === 'chromium') {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(`${EVIDENCE}timings-${info.project.name}.json`, `${JSON.stringify({ ...timings, browser: info.project.name, at: new Date().toISOString() }, null, 2)}\n`);
    await page.getByTestId('board').screenshot({ path: `${EVIDENCE}standalone-board.png` });
    await page.screenshot({ path: `${EVIDENCE}standalone-page.png` });
  }
});

test('the conformance host plays the published release against the fixture in both colours', async ({ page }) => {
  await page.goto('./host/');
  await page.getByTestId('run').click();
  const result = page.getByTestId('result');
  await expect(result).not.toHaveAttribute('data-status', /idle|running/, { timeout: 240_000 });
  const report = JSON.parse((await result.textContent())!);
  expect(report.error, report.error).toBeUndefined();
  await expect(result).toHaveAttribute('data-status', 'passed');
  expect(report.publishedHashMatches).toBe(true);
  expect(report.matches.map((m: { releaseSide: string }) => m.releaseSide)).toEqual(['red', 'blue']);
  for (const m of report.matches) expect(['won', 'drawn']).toContain(m.status);
});

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => fileURLToPath(new URL(`../../arena/test-fixtures/${name}`, import.meta.url));

async function check(page: import('@playwright/test').Page, file: string) {
  await page.goto('arena/conformance.html');
  await page.locator('#file').setInputFiles(file);
  const result = page.locator('#result');
  await expect(result).not.toHaveAttribute('data-status', /idle|running/, { timeout: 150_000 });
  return { status: await result.getAttribute('data-status'), body: JSON.parse((await result.textContent()) ?? '{}') };
}

test('admits a newly built single-file component and shows its own frames', async ({ page }) => {
  const { status, body } = await check(page, fixture('test-entrant-1.1.0.wasm'));
  expect(status, JSON.stringify(body)).toBe('passed');
  expect(body.checks.map((c: { name: string }) => c.name)).toEqual(
    expect.arrayContaining(['admission', 'render-does-not-change-choice', 'two-instances-isolated', 'flip-changes-view', 'match-as-red', 'match-as-blue', 'match-self']),
  );
  expect(body.metadata.title).toBe('Arena test entrant');
  expect(body.metadata.rulesDigest).toBe('a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63');
  // The canvas holds guest pixels: sample the frame and confirm it is not blank.
  const painted = await page.locator('#frame-0').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4096) if (data[i]! + data[i + 1]! + data[i + 2]! > 0) nonZero += 1;
    return nonZero;
  });
  expect(painted).toBeGreaterThan(100);
});

for (const [file, stage, reason] of [
  ['core-module.wasm', 'header', /core WebAssembly module/],
  ['truncated.wasm', 'contract', /could not be parsed|Truncated|past the end/],
  ['broken-extra-import.wasm', 'contract', /does not supply/],
  ['broken-digest.wasm', 'smoke', /Rules digest/],
  ['broken-frame-size.wasm', 'smoke', /440×576/],
  ['broken-hang.wasm', 'smoke', /deadline|did not finish/],
] as const) {
  test(`rejects ${file} at ${stage}`, async ({ page }) => {
    const { status, body } = await check(page, fixture(file));
    expect(status).toBe('rejected');
    expect(body.stage).toBe(stage);
    expect(body.reasons.join('\n')).toMatch(reason);
  });
}

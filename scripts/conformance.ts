// Conformance runner: check one finished entrant in a real browser.
//
//   npm run conformance -- path/to/entrant.wasm [--browser chromium|firefox|webkit|chrome|msedge]
//                                              [--url https://deployed.example/arena/] [--json out.json]
//
// By default it serves the local build (dist/) under a random nested subpath, which also
// proves every Arena URL is relative. With --url it drives a deployed Arena instead.
// The page admits the file through the public upload path, runs behavioural checks and
// plays full matches; this script prints the report and exits non-zero on failure.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
// @ts-expect-error -- plain ESM helper without type declarations
import { startStaticServer } from './serve-static.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

async function launch(name: string): Promise<Browser> {
  switch (name) {
    case 'chromium':
      return chromium.launch();
    case 'chrome':
      return chromium.launch({ channel: 'chrome' });
    case 'msedge':
      return chromium.launch({ channel: 'msedge' });
    case 'firefox':
      return firefox.launch();
    case 'webkit':
      return webkit.launch();
    default:
      throw new Error(`unknown browser "${name}"`);
  }
}

const file = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!file || !existsSync(file)) {
  console.error('usage: npm run conformance -- path/to/entrant.wasm [--browser chromium|firefox|webkit|chrome|msedge] [--url URL] [--json out.json]');
  process.exit(2);
}
const browserName = flag('browser') ?? 'chromium';
const deployed = flag('url');

let server: { url: string; close: () => Promise<void> } | null = null;
let arenaUrl: string;
if (deployed) {
  arenaUrl = deployed.endsWith('/') ? deployed : `${deployed}/`;
} else {
  if (!existsSync(join(ROOT, 'dist', 'arena', 'conformance.html'))) {
    console.error('dist/arena is missing: run `npm run build` first.');
    process.exit(2);
  }
  const prefix = `/conformance-${Math.random().toString(36).slice(2, 8)}/nested/`;
  server = await startStaticServer({ dir: join(ROOT, 'dist'), prefix });
  arenaUrl = `${server!.url}arena/`;
}

const browser = await launch(browserName);
let exitCode = 1;
try {
  const page = await browser.newPage();
  await page.goto(`${arenaUrl}conformance.html`);
  await page.locator('#file').setInputFiles(resolve(file));
  const result = page.locator('#result');
  await result.waitFor();
  await page.waitForFunction(() => !['idle', 'running'].includes(document.querySelector('#result')?.getAttribute('data-status') ?? 'idle'), undefined, {
    timeout: 10 * 60_000,
  });
  const status = await result.getAttribute('data-status');
  const report = JSON.parse((await result.textContent()) ?? '{}');
  const full = { ...report, status, browser: browserName, browserVersion: browser.version(), arenaUrl };

  console.log(`\n${report.metadata?.title ?? file} — ${status?.toUpperCase()} in ${browserName} ${browser.version()}`);
  console.log(`  sha256 ${report.sha256 ?? '(not computed)'}`);
  for (const check of report.checks ?? []) console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  for (const reason of report.reasons ?? []) console.log(`  REJECTED at ${report.stage}: ${reason}`);
  const out = flag('json');
  if (out) writeFileSync(out, `${JSON.stringify(full, null, 2)}\n`);
  else console.log(`\n${JSON.stringify(full, null, 2)}`);
  exitCode = status === 'passed' ? 0 : 1;
} finally {
  await browser.close();
  await server?.close();
}
process.exit(exitCode);

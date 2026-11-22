// Maintainer command: add a binary to the seed catalog (seed/catalog/), the curated programs
// `npm run db:seed` loads into the Arena's catalog database.
//
//   npm run catalog:add -- path/to/entrant.wasm [--language Rust] [--source <url or path>]
//                          [--toolchain "rustc 1.94.1 + wit-bindgen 0.63.0"] [--credits "…"]
//                          [--reference]
//
// Runs the same checks as a browser import (size, component header, contract against
// wit/jungle.wit, then a deadline-bounded smoke test), copies the exact bytes into
// seed/catalog/, and records the hash in seed.json. --reference makes it the one program
// every upload test plays against. It is public after `npm run db:seed -- --remote`.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, type PublicEntry } from '../arena/src/catalog/catalog';
import { DEADLINES, MAX_UPLOAD_BYTES } from '../arena/src/loader/limits';
import { contractIssuesInNode } from '../arena/src/loader/node-host';
import { isComponentBinary } from '../arena/src/loader/strip';
import type { Metadata } from '../arena/src/referee/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'seed', 'catalog');
const MANIFEST = join(CATALOG, 'seed.json');

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

function fail(message: string): never {
  console.error(`catalog:add: ${message}`);
  process.exit(1);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'entrant';
}

function smoke(file: string): Promise<{ ok: boolean; metadata: Metadata | null; issues: string[]; failedStep: string | null }> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', join(ROOT, 'scripts', 'smoke-child.ts'), file],
      { cwd: ROOT, timeout: DEADLINES.smoke, killSignal: 'SIGKILL', maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error) {
          reject(new Error(error.killed ? `the smoke test exceeded ${DEADLINES.smoke / 1000} s` : `the smoke test crashed: ${error.message}`));
          return;
        }
        resolvePromise(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}'));
      },
    );
  });
}

// Flags that take a value; --reference does not, so it may appear anywhere.
const VALUE_FLAGS = new Set(['--language', '--source', '--toolchain', '--credits']);
const input = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !VALUE_FLAGS.has(all[i - 1] ?? ''));
if (!input) fail('usage: npm run catalog:add -- path/to/entrant.wasm [--language L] [--source S] [--toolchain T] [--credits C] [--reference]');
const path = resolve(input);
const bytes = new Uint8Array(readFileSync(path));

if (bytes.length > MAX_UPLOAD_BYTES) fail(`${bytes.length} bytes exceeds the ${MAX_UPLOAD_BYTES}-byte limit`);
if (!isComponentBinary(bytes)) fail('not a WebAssembly component (run `wasm-tools component new` on core modules)');
const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`sha256   ${sha256}`);

const issues = await contractIssuesInNode(bytes);
if (issues.length > 0) fail(`contract check failed:\n  ${issues.join('\n  ')}`);
console.log('contract ok (imports display only, exports game with the canonical types)');

const report = await smoke(path).catch((err: Error) => fail(err.message));
if (!report.ok || !report.metadata) fail(`smoke test failed at ${report.failedStep}:\n  ${report.issues.join('\n  ')}`);
const metadata = report.metadata;
console.log(`smoke ok  ${metadata.title} v${metadata.gameVersion} (${metadata.model}, ${metadata.codeAgent})`);

const fileName = `${slug(metadata.title)}-${slug(metadata.gameVersion)}-${sha256.slice(0, 8)}.wasm`;

const { manifest, issues: manifestIssues } = parseManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')));
if (!manifest || manifestIssues.length > 0) fail(`the existing seed.json is invalid: ${manifestIssues.join(' ')}`);
// Re-adding the current reference (say, to fix its credits) keeps it the reference.
const reference = process.argv.includes('--reference') || manifest.entries.some((e) => e.sha256 === sha256 && e.reference);
const language = flag('language');
const entry: PublicEntry = {
  sha256,
  size: bytes.length,
  file: fileName,
  metadata,
  addedAt: new Date().toISOString().slice(0, 10),
  provenance: language ? { language, source: flag('source') ?? '', toolchain: flag('toolchain') ?? metadata.runtime } : null,
  credits: flag('credits'),
  reference,
};
// One reference at most: flagging this entry unflags the previous one.
const kept = manifest.entries.filter((e) => e.sha256 !== sha256).map((e) => (reference ? { ...e, reference: false } : e));
if (!reference && !kept.some((e) => e.reference)) fail('the seed needs one reference opponent: pass --reference');
// Every check passed: only now copy the bytes, then record them.
copyFileSync(path, join(CATALOG, fileName));
const entries = [...kept, entry].sort(
  (a, b) => a.metadata.title.localeCompare(b.metadata.title) || a.metadata.gameVersion.localeCompare(b.metadata.gameVersion),
);
writeFileSync(MANIFEST, `${JSON.stringify({ format: 'jungle-arena-catalog', version: 1, entries }, null, 2)}\n`);
console.log(`added    seed/catalog/${fileName}${reference ? ' as the reference opponent' : ''}; load it with \`npm run db:seed -- --local\`, publish with --remote`);

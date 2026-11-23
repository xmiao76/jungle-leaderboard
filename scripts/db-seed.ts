// Load the curated seed entries (seed/catalog/seed.json) into the catalog: each binary into R2 as
// "<sha256>.wasm", then one upsert per entry into D1. Safe to re-run.
//
//   npm run db:seed -- --local [--persist-to <dir>]     local state used by `npm run dev:full`
//   npm run db:seed -- --remote                         the production database and bucket
//
// Run `npm run db:migrate -- --local|--remote` first so the table exists.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, type PublicEntry } from '../arena/src/catalog/catalog';
import { binaryKey } from '../server/entrant-row';
import { seedSql } from '../server/seed-sql';
import { BUCKET_NAME, DB_NAME, ROOT, runWrangler, targetArgs, type Target } from './wrangler-run';

export const SEED_DIR = join(ROOT, 'seed', 'catalog');

/** The seed entries, each proven to match its recorded size and hash. */
export function readSeed(): { entries: readonly PublicEntry[]; paths: ReadonlyMap<string, string> } {
  const { manifest, issues } = parseManifest(JSON.parse(readFileSync(join(SEED_DIR, 'seed.json'), 'utf8')));
  if (!manifest || issues.length > 0) throw new Error(`seed/catalog/seed.json is invalid: ${issues.join(' ')}`);
  const paths = new Map<string, string>();
  for (const entry of manifest.entries) {
    const path = join(SEED_DIR, entry.file);
    const bytes = readFileSync(path);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.size || actual !== entry.sha256) throw new Error(`${entry.file} does not match its recorded size and hash`);
    paths.set(entry.sha256, path);
  }
  return { entries: manifest.entries, paths };
}

export async function seedCatalog(target: Target): Promise<number> {
  const { entries, paths } = readSeed();
  // Build (and so validate) the SQL before touching storage: a bad seed uploads nothing.
  return loadEntries(target, entries, paths, seedSql(entries));
}

/** Put each entry's bytes in R2, then run `sql` (already validated) against D1. */
export async function loadEntries(target: Target, entries: readonly PublicEntry[], paths: ReadonlyMap<string, string>, sql: string): Promise<number> {
  for (const entry of entries) {
    const object = `${BUCKET_NAME}/${binaryKey(entry.sha256)}`;
    await runWrangler(['r2', 'object', 'put', object, '--file', paths.get(entry.sha256)!, '--content-type', 'application/wasm', ...targetArgs(target)]);
  }
  const dir = mkdtempSync(join(tmpdir(), 'jungle-seed-'));
  try {
    const sqlFile = join(dir, 'seed.sql');
    writeFileSync(sqlFile, sql);
    await runWrangler(['d1', 'execute', DB_NAME, '--file', sqlFile, '--yes', ...targetArgs(target)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return entries.length;
}

export function parseTarget(argv: readonly string[]): Target {
  const local = argv.includes('--local');
  const remote = argv.includes('--remote');
  if (local === remote) throw new Error('pass exactly one of --local or --remote');
  if (remote) return { mode: 'remote' };
  const i = argv.indexOf('--persist-to');
  return i >= 0 && argv[i + 1] ? { mode: 'local', persistTo: resolve(argv[i + 1]!) } : { mode: 'local' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const count = await seedCatalog(parseTarget(process.argv.slice(2)));
    console.log(`db:seed: ${count} seed entr${count === 1 ? 'y' : 'ies'} loaded`);
  } catch (err) {
    console.error(`db:seed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

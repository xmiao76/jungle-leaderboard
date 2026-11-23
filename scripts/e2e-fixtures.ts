// Published test programs for e2e (never the real catalog): `api-server.ts --fixtures` loads them
// into throwaway local state on top of the seed catalog. The late-* programs pass admission but
// misbehave mid-game, so they could never pass the upload round; tests open them by hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicEntry } from '../arena/src/catalog/catalog';
import { checkMetadata } from '../arena/src/loader/metadata';
import { instantiateInNode } from '../arena/src/loader/node-host';
import { upsertSql } from '../server/seed-sql';
import { loadEntries } from './db-seed';
import { ROOT, type Target } from './wrangler-run';

export const E2E_FIXTURES = ['test-entrant-1.1.0.wasm', 'late-index.wasm', 'late-trap.wasm', 'late-hang.wasm', 'late-frame-size.wasm'] as const;
const FIXTURE_DIR = join(ROOT, 'arena', 'test-fixtures');

async function fixtureEntry(file: string): Promise<{ entry: PublicEntry; path: string }> {
  const path = join(FIXTURE_DIR, file);
  const bytes = new Uint8Array(readFileSync(path));
  const { metadata, issues } = checkMetadata((await instantiateInNode(bytes)).info());
  if (!metadata || issues.length > 0) throw new Error(`${file}: ${issues.join(' ')}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const entry: PublicEntry = { sha256, size: bytes.length, file, metadata, addedAt: '2026-11-22', provenance: null, credits: 'Arena e2e fixture', reference: false };
  return { entry, path };
}

export async function seedFixtures(target: Target): Promise<number> {
  const loaded = await Promise.all(E2E_FIXTURES.map(fixtureEntry));
  const entries = loaded.map((l) => l.entry);
  return loadEntries(target, entries, new Map(loaded.map((l) => [l.entry.sha256, l.path])), upsertSql(entries));
}

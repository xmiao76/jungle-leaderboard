// `npm run catalog:verify` (also part of `npm test`): every seed entry (the curated programs
// `npm run db:seed` loads into the catalog database) must be present, byte-identical to its
// recorded hash, and conform to the contract; exactly one is the reference opponent.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contractIssuesInNode } from '../loader/node-host';
import { parseManifest } from './catalog';

const catalogUrl = new URL('../../../seed/catalog/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('seed.json', catalogUrl), 'utf8'));
const { manifest, issues } = parseManifest(raw);

describe('seed catalog', () => {
  it('parses without issues and lists at least one playable program', () => {
    expect(issues).toEqual([]);
    expect(manifest!.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('names exactly one reference opponent', () => {
    expect(manifest!.entries.filter((e) => e.reference)).toHaveLength(1);
  });

  it('lists each hash once', () => {
    const hashes = manifest!.entries.map((e) => e.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each(manifest!.entries.map((e) => [e.file, e] as const))('%s matches its hash and the contract', async (_file, entry) => {
    const bytes = new Uint8Array(readFileSync(new URL(entry.file, catalogUrl)));
    expect(bytes.length).toBe(entry.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(await contractIssuesInNode(bytes)).toEqual([]);
  });
});

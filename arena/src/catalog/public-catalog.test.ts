// `npm run catalog:verify` (also part of `npm test`): every public catalog entry must
// be present, byte-identical to its recorded hash, and conform to the contract.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contractIssuesInNode } from '../loader/node-host';
import { parseManifest } from './catalog';

const catalogUrl = new URL('../../public/catalog/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('manifest.json', catalogUrl), 'utf8'));
const { manifest, issues } = parseManifest(raw);

describe('public catalog manifest', () => {
  it('parses without issues and lists at least one playable program', () => {
    expect(issues).toEqual([]);
    expect(manifest!.entries.length).toBeGreaterThanOrEqual(1);
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

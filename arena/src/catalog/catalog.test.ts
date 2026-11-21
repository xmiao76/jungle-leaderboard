import { describe, expect, it } from 'vitest';
import { METADATA } from '../match/fakes.test-support';
import { compareVersions, fetchPublicBinary, groupByTitle, HashMismatchError, mergeCatalog, parseManifest, type PublicEntry } from './catalog';

const sha = (c: string) => c.repeat(64);
const entry = (over: Partial<PublicEntry> = {}): PublicEntry => ({
  sha256: sha('a'),
  size: 10,
  file: 'a.wasm',
  metadata: METADATA,
  addedAt: '2026-11-20',
  provenance: null,
  credits: null,
  ...over,
});

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const { manifest, issues } = parseManifest({ format: 'jungle-arena-catalog', version: 1, entries: [entry()] });
    expect(issues).toEqual([]);
    expect(manifest?.entries).toHaveLength(1);
  });

  it('drops entries with unsafe paths, bad hashes or bad metadata, and says why', () => {
    const { manifest, issues } = parseManifest({
      format: 'jungle-arena-catalog',
      version: 1,
      entries: [entry({ file: '../../etc/passwd.wasm' }), entry({ sha256: 'nope' }), entry({ metadata: { ...METADATA, rulesDigest: 'x' } }), entry({ file: 'ok.wasm' })],
    });
    expect(manifest?.entries.map((e) => e.file)).toEqual(['ok.wasm']);
    expect(issues).toHaveLength(3);
  });

  it('rejects an unknown format outright', () => {
    expect(parseManifest({ format: 'other' }).manifest).toBeNull();
  });
});

describe('catalog merging and grouping', () => {
  it('lists a hash once, preferring the public entry, and marks device copies', () => {
    const merged = mergeCatalog([entry()], [
      { sha256: sha('a'), size: 10, metadata: METADATA, importedAt: '2026-11-21' },
      { sha256: sha('b'), size: 11, metadata: { ...METADATA, gameVersion: '2.0.0' }, importedAt: '2026-11-21' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ origin: 'public', onDevice: true });
    expect(merged[1]).toMatchObject({ origin: 'device', sha256: sha('b') });
  });

  it('treats a new hash with an unchanged title and version as a separate entry', () => {
    const merged = mergeCatalog([], [
      { sha256: sha('a'), size: 10, metadata: METADATA, importedAt: '2026-11-20' },
      { sha256: sha('b'), size: 10, metadata: METADATA, importedAt: '2026-11-21' },
    ]);
    const [group] = groupByTitle(merged);
    expect(group!.versions.map((v) => v.sha256)).toEqual([sha('b'), sha('a')]);
  });

  it('orders versions newest first and titles alphabetically', () => {
    const merged = mergeCatalog(
      [
        entry({ sha256: sha('1'), metadata: { ...METADATA, title: 'Zeta', gameVersion: '1.9.0' } }),
        entry({ sha256: sha('2'), metadata: { ...METADATA, title: 'Zeta', gameVersion: '1.10.0' } }),
        entry({ sha256: sha('3'), metadata: { ...METADATA, title: 'Alpha' } }),
      ],
      [],
    );
    const groups = groupByTitle(merged);
    expect(groups.map((g) => g.title)).toEqual(['Alpha', 'Zeta']);
    expect(groups[1]!.versions.map((v) => v.metadata.gameVersion)).toEqual(['1.10.0', '1.9.0']);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0', '10.0')).toBeLessThan(0);
  });
});

describe('fetchPublicBinary', () => {
  const bytes = new TextEncoder().encode('hello');
  const helloSha = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const fetcher = (async () => new Response(bytes)) as unknown as typeof fetch;

  it('returns bytes whose hash matches the manifest', async () => {
    await expect(fetchPublicBinary({ file: 'x.wasm', sha256: helloSha }, new URL('https://example.test/catalog/'), fetcher)).resolves.toEqual(bytes);
  });

  it('refuses bytes that do not match the manifest hash', async () => {
    await expect(fetchPublicBinary({ file: 'x.wasm', sha256: sha('0') }, new URL('https://example.test/catalog/'), fetcher)).rejects.toBeInstanceOf(HashMismatchError);
  });
});

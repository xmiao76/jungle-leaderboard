import { describe, expect, it } from 'vitest';
import { parseManifest } from '../arena/src/catalog/catalog';
import { binaryKey, rowToPublicEntry } from './entrant-row';
import { sampleRow, sha } from './rows.test-support';

describe('rowToPublicEntry', () => {
  it('maps the columns to the catalog wire format the Arena already parses', () => {
    const entry = rowToPublicEntry(sampleRow());
    expect(entry).toEqual({
      sha256: sha('a'),
      size: 4,
      file: `${sha('a')}.wasm`,
      metadata: {
        title: 'Jungle — test',
        gameVersion: '1.0.0',
        model: 'Model-X',
        codeAgent: 'Agent-Y',
        githubUrl: 'https://github.com/example/jungle',
        engineVersion: 'engine 1',
        runtime: 'Rust',
        rulesId: 'desktop-jungle-v2',
        rulesDigest: 'a457bbc009e975a9eafe5ff1f8fa40ca2548f2a689b121c8c4ed99dd0f3fdc57',
      },
      addedAt: '2026-11-21T10:00:00.000Z',
      provenance: { language: 'Rust', source: 'https://github.com/example/jungle', toolchain: 'rustc 1.94.1' },
      credits: 'Art: CC-BY 4.0',
      reference: false,
    });
  });

  it('marks the reference opponent', () => {
    expect(rowToPublicEntry(sampleRow({ is_reference: 1 })).reference).toBe(true);
  });

  it('drops provenance that is not valid JSON or lacks its string fields', () => {
    expect(rowToPublicEntry(sampleRow({ provenance: '{not json' })).provenance).toBeNull();
    expect(rowToPublicEntry(sampleRow({ provenance: '"Rust"' })).provenance).toBeNull();
    expect(rowToPublicEntry(sampleRow({ provenance: '{"language":"Rust","source":1,"toolchain":"x"}' })).provenance).toBeNull();
    expect(rowToPublicEntry(sampleRow({ provenance: null })).provenance).toBeNull();
  });

  it('produces entries that parseManifest accepts without issues', () => {
    const document = { format: 'jungle-arena-catalog', version: 1, entries: [rowToPublicEntry(sampleRow({ is_reference: 1 }))] };
    const { manifest, issues } = parseManifest(JSON.parse(JSON.stringify(document)));
    expect(issues).toEqual([]);
    expect(manifest?.entries[0]?.reference).toBe(true);
  });
});

describe('binaryKey', () => {
  it('names the R2 object after the hash', () => {
    expect(binaryKey(sha('b'))).toBe(`${sha('b')}.wasm`);
  });
});

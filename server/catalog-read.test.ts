import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../arena/src/catalog/catalog';
import { handleCatalogGet, handleCatalogHead } from './catalog-read';
import { startLocalEnv, type LocalEnv } from './local-env.test-support';
import { insertRow, sampleRow, sha, WASM_BYTES } from './rows.test-support';

let local: LocalEnv;
beforeAll(async () => {
  local = await startLocalEnv();
}, 60_000);
afterAll(() => local.dispose());
beforeEach(() => local.reset());

async function stored(row = sampleRow()): Promise<void> {
  await insertRow(local.env.DB, row);
  await local.env.ENTRANTS.put(`${row.sha256}.wasm`, WASM_BYTES);
}

describe('GET manifest.json', () => {
  it('serves an empty catalog in the manifest format', async () => {
    const response = await handleCatalogGet(local.env, 'manifest.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.json()).toEqual({ format: 'jungle-arena-catalog', version: 1, entries: [] });
  });

  it('lists only listed entrants, sorted by title, in a form parseManifest accepts', async () => {
    await stored(sampleRow({ sha256: sha('c'), title: 'Zebra' }));
    await stored(sampleRow({ sha256: sha('a'), title: 'Antelope', is_reference: 1 }));
    await stored(sampleRow({ sha256: sha('b'), title: 'Hidden', status: 'hidden' }));

    const { manifest, issues } = parseManifest(await (await handleCatalogGet(local.env, 'manifest.json')).json());
    expect(issues).toEqual([]);
    expect(manifest?.entries.map((e) => [e.metadata.title, e.reference])).toEqual([
      ['Antelope', true],
      ['Zebra', false],
    ]);
  });

  it('answers 503 without internal details when the database fails, and logs the cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...local.env, DB: { prepare: () => { throw new Error('D1_ERROR: secret internals'); } } } as unknown as Env;
    const response = await handleCatalogGet(broken, 'manifest.json');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret internals');
    expect(logged).toHaveBeenCalledWith('catalog read failed', 'manifest.json', expect.objectContaining({ message: 'D1_ERROR: secret internals' }));
    logged.mockRestore();
  });
});

describe('GET <sha256>.wasm', () => {
  it('streams a listed entrant with wasm and immutable cache headers', async () => {
    await stored();
    const response = await handleCatalogGet(local.env, `${sha('a')}.wasm`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/wasm');
    expect(response.headers.get('content-length')).toBe(String(WASM_BYTES.length));
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WASM_BYTES);
  });

  it('hides hidden entrants, unknown hashes, and rows whose bytes are missing', async () => {
    await stored(sampleRow({ sha256: sha('b'), status: 'hidden' }));
    await insertRow(local.env.DB, sampleRow({ sha256: sha('d') }));
    for (const file of [`${sha('b')}.wasm`, `${sha('e')}.wasm`, `${sha('d')}.wasm`]) {
      expect((await handleCatalogGet(local.env, file)).status).toBe(404);
    }
  });

  it('answers HEAD with the same status and headers and no body', async () => {
    await stored();
    const found = await handleCatalogHead(local.env, `${sha('a')}.wasm`);
    expect(found.status).toBe(200);
    expect(found.headers.get('content-type')).toBe('application/wasm');
    expect(found.body).toBeNull();
    expect((await handleCatalogHead(local.env, `${sha('e')}.wasm`)).status).toBe(404);
  });

  it.each(['../wrangler.toml', `${sha('A')}.wasm`, `${sha('a')}.WASM`, `${sha('a')}.wasm.txt`, 'manifest.jsonx', ''])('rejects the name %j', async (file) => {
    await stored();
    expect((await handleCatalogGet(local.env, file)).status).toBe(404);
  });
});

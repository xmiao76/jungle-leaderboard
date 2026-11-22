import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStaticServer } from './serve-static.mjs';

let dir;
let upstream;
let seen = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'serve-static-'));
  writeFileSync(join(dir, 'index.html'), '<p>static</p>');
  upstream = createServer((req, res) => {
    seen = [...seen, `${req.method} ${req.url}`];
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"from":"api"}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  await new Promise((r) => upstream.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const origin = () => `http://127.0.0.1:${upstream.address().port}`;

describe('startStaticServer with an API origin', () => {
  it('forwards <prefix>api/… to the origin as /api/…, keeping the query, and serves everything else from disk', async () => {
    const server = await startStaticServer({ dir, prefix: '/nested/path/', api: origin() });
    try {
      seen = [];
      const api = await fetch(`${server.url}api/catalog/manifest.json?x=1`);
      expect(await api.json()).toEqual({ from: 'api' });
      expect(seen).toEqual(['GET /api/catalog/manifest.json?x=1']);
      expect(await (await fetch(`${server.url}index.html`)).text()).toBe('<p>static</p>');
      expect((await fetch(`${server.url.replace('/nested/path/', '/')}api/catalog/manifest.json`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('answers 502 when the API is not running', async () => {
    const server = await startStaticServer({ dir, prefix: '/', api: 'http://127.0.0.1:1' });
    try {
      const response = await fetch(`${server.url}api/catalog/manifest.json`);
      expect(response.status).toBe(502);
    } finally {
      await server.close();
    }
  });

  it('serves api/ from disk (a 404 here) when no API origin is given', async () => {
    const server = await startStaticServer({ dir, prefix: '/' });
    try {
      seen = [];
      expect((await fetch(`${server.url}api/catalog/manifest.json`)).status).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

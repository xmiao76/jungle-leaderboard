import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../arena/src/loader/limits';
import { RULES_DIGEST, RULES_ID } from '../arena/src/referee/profile';
import { handleCatalogGet } from './catalog-read';
import {
  handleCatalogUpload, hashUploader, MAX_UPLOADS_PER_DAY, quotaBucket,
  type CatalogUploadDeps, type CatalogUploadEnv,
} from './catalog-upload';
import { FakeR2Bucket } from './fake-r2.test-support';
import { startLocalEnv, type LocalEnv } from './local-env.test-support';
import { insertRow, sampleRow } from './rows.test-support';

// Real local D1, fake R2: a streamed put cannot reach real R2 from Node (see
// fake-r2.test-support.ts). The handler's FixedLengthStream is likewise injected.

const NOW = new Date('2026-11-22T12:00:00.000Z');
const IP = '203.0.113.7';
const SALT = 'test-salt';
const SECRET = 'test-secret';

const METADATA = {
  title: 'Jungle — test',
  gameVersion: '1.0.0',
  model: 'Model-X',
  codeAgent: 'Agent-Y',
  modelPlatform: 'official',
  githubUrl: 'https://github.com/example/jungle',
  engineVersion: 'engine 1',
  runtime: 'Rust',
  rulesId: RULES_ID,
  rulesDigest: RULES_DIGEST,
};
const REPORT = {
  stages: ['size', 'header', 'hash', 'contract', 'transpile', 'smoke'],
  games: [{ label: 'uploaded-first', plies: 35 }, { label: 'reference-first', plies: 38 }],
  loaderVersion: 'test-loader',
  browser: 'test-browser',
};

const COMPONENT_PREAMBLE = [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00];
const makeBody = (tag = 1): Uint8Array => new Uint8Array([...COMPONENT_PREAMBLE, 8, 9, 10, tag]);
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const encodeReport = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const turnstileOk = (async () => Response.json({ success: true })) as typeof fetch;

let local: LocalEnv;
let bucket: FakeR2Bucket;
let env: CatalogUploadEnv;

beforeAll(async () => {
  local = await startLocalEnv();
}, 60_000);
afterAll(() => local.dispose());
beforeEach(async () => {
  await local.reset();
  bucket = new FakeR2Bucket();
  env = { DB: local.env.DB, ENTRANTS: bucket.asBucket(), TURNSTILE_SECRET: SECRET, UPLOADER_SALT: SALT };
});

function deps(overrides: CatalogUploadDeps = {}): CatalogUploadDeps {
  return {
    fetcher: turnstileOk,
    now: () => NOW,
    fixedLengthStream: () => new TransformStream<Uint8Array, Uint8Array>(),
    ...overrides,
  };
}

interface RequestOverrides {
  sha256?: string;
  reportHeader?: string;
  token?: string | null;
  contentType?: string;
}

function uploadRequest(body: Uint8Array, overrides: RequestOverrides = {}): Request {
  const headers = new Headers({
    // A real HTTP request carries this; Node's Request constructor does not add it.
    'content-length': String(body.byteLength),
    'content-type': overrides.contentType ?? 'application/wasm',
    'x-entrant-sha256': overrides.sha256 ?? sha256Hex(body),
    'x-entrant-report': overrides.reportHeader ?? encodeReport({ metadata: METADATA, report: REPORT }),
    'cf-connecting-ip': IP,
  });
  if (overrides.token !== null) headers.set('x-turnstile-token', overrides.token ?? 'token-123');
  return new Request('http://arena.test/api/catalog', { method: 'POST', body: body as BodyInit, headers });
}

async function entrantCount(): Promise<number> {
  const row = await local.env.DB.prepare('SELECT COUNT(*) AS n FROM entrants').first<{ n: number }>();
  return row!.n;
}

async function expectNothingStored(): Promise<void> {
  expect(await entrantCount()).toBe(0);
  expect(bucket.objects.size).toBe(0);
}

async function expectRejection(response: Response, status: number): Promise<string[]> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { stage: string; reasons: string[] };
  expect(body.stage).toBe('server');
  expect(body.reasons.length).toBeGreaterThan(0);
  await expectNothingStored();
  return body.reasons;
}

describe('POST /api/catalog', () => {
  it('publishes a passing upload: 201, row and bytes stored, then listed and downloadable', async () => {
    const body = makeBody();
    const sha = sha256Hex(body);
    const siteverify: { url?: string; form?: string } = {};
    const fetcher = (async (input: unknown, init?: { body?: unknown }) => {
      siteverify.url = String(input);
      siteverify.form = String(init?.body);
      return Response.json({ success: true });
    }) as typeof fetch;

    const response = await handleCatalogUpload(env, uploadRequest(body), deps({ fetcher }));
    expect(response.status).toBe(201);
    const { entry } = (await response.json()) as { entry: Record<string, unknown> };
    expect(entry).toMatchObject({
      sha256: sha, size: body.length, file: `${sha}.wasm`, metadata: METADATA,
      addedAt: NOW.toISOString(), provenance: null, credits: null, reference: false,
    });

    expect(siteverify.url).toContain('challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(siteverify.form).toContain(`secret=${SECRET}`);
    expect(siteverify.form).toContain('response=token-123');

    const row = await local.env.DB.prepare('SELECT * FROM entrants WHERE sha256 = ?').bind(sha)
      .first<{ report: string; uploader: string; status: string }>();
    expect(row!.status).toBe('listed');
    expect(JSON.parse(row!.report)).toEqual(REPORT);
    const uploader = await hashUploader(SALT, IP);
    expect(row!.uploader).toBe(uploader);
    expect(row!.uploader).not.toContain(IP);

    const quota = await local.env.DB.prepare('SELECT count FROM upload_quota WHERE bucket = ?')
      .bind(quotaBucket(uploader, NOW)).first<{ count: number }>();
    expect(quota!.count).toBe(1);

    expect(bucket.objects.get(`${sha}.wasm`)?.bytes).toEqual(body);

    const manifest = (await (await handleCatalogGet(env, 'manifest.json')).json()) as { entries: { sha256: string }[] };
    expect(manifest.entries.map((e) => e.sha256)).toEqual([sha]);
    const download = await handleCatalogGet(env, `${sha}.wasm`);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(body);
  });

  it('returns the existing entry for identical bytes instead of a second row', async () => {
    const body = makeBody();
    expect((await handleCatalogUpload(env, uploadRequest(body), deps())).status).toBe(201);
    const second = await handleCatalogUpload(env, uploadRequest(body), deps());
    expect(second.status).toBe(200);
    const parsed = (await second.json()) as { existing: boolean; entry: { sha256: string } };
    expect(parsed.existing).toBe(true);
    expect(parsed.entry.sha256).toBe(sha256Hex(body));
    expect(await entrantCount()).toBe(1);
    expect(bucket.objects.size).toBe(1);
  });

  it('answers the duplicate check from the claimed hash alone, before any bytes are stored', async () => {
    // Plan order is duplicate → hash-verified put, so a body that does not hash to an
    // already-listed claim is discarded and the listed entry is the answer. An honest
    // client cannot get here (it hashes its own bytes); a lying one gains nothing.
    const body = makeBody(1);
    expect((await handleCatalogUpload(env, uploadRequest(body), deps())).status).toBe(201);
    const impostor = await handleCatalogUpload(env, uploadRequest(makeBody(2), { sha256: sha256Hex(body) }), deps());
    expect(impostor.status).toBe(200);
    expect(bucket.objects.get(`${sha256Hex(body)}.wasm`)?.bytes).toEqual(body);
    expect(await entrantCount()).toBe(1);
  });

  it('settles two concurrent uploads of the same bytes as one 201 and one 200', async () => {
    const body = makeBody();
    const [a, b] = await Promise.all([
      handleCatalogUpload(env, uploadRequest(body), deps()),
      handleCatalogUpload(env, uploadRequest(body), deps()),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await entrantCount()).toBe(1);
    expect(bucket.objects.get(`${sha256Hex(body)}.wasm`)?.bytes).toEqual(body);
  });

  it('does not resurrect a hidden entry', async () => {
    const body = makeBody();
    const sha = sha256Hex(body);
    await insertRow(local.env.DB, sampleRow({ sha256: sha, size: body.length, status: 'hidden' }));
    await bucket.put(`${sha}.wasm`, body);
    const response = await handleCatalogUpload(env, uploadRequest(body), deps());
    expect(response.status).toBe(400);
    const row = await local.env.DB.prepare('SELECT status FROM entrants WHERE sha256 = ?').bind(sha).first<{ status: string }>();
    expect(row!.status).toBe('hidden');
    expect(await entrantCount()).toBe(1);
  });

  it('rejects a failed Turnstile check and stores nothing', async () => {
    const fetcher = (async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] })) as typeof fetch;
    const response = await handleCatalogUpload(env, uploadRequest(makeBody()), deps({ fetcher }));
    await expectRejection(response, 403);
  });

  it('rejects a missing Turnstile token without calling Siteverify', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return Response.json({ success: true });
    }) as typeof fetch;
    const response = await handleCatalogUpload(env, uploadRequest(makeBody(), { token: null }), deps({ fetcher }));
    await expectRejection(response, 400);
    expect(called).toBe(false);
  });

  it('answers 503 when Siteverify is unreachable, storing nothing', async () => {
    const fetcher = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const response = await handleCatalogUpload(env, uploadRequest(makeBody()), deps({ fetcher }));
    await expectRejection(response, 503);
  });

  it.each(['TURNSTILE_SECRET', 'UPLOADER_SALT'] as const)('answers 503 when %s is not configured', async (missing) => {
    const unconfigured = { ...env, [missing]: undefined };
    const response = await handleCatalogUpload(unconfigured, uploadRequest(makeBody()), deps());
    await expectRejection(response, 503);
  });

  it('rejects once the daily quota is used up, storing nothing', async () => {
    const uploader = await hashUploader(SALT, IP);
    await local.env.DB.prepare('INSERT INTO upload_quota (bucket, count) VALUES (?, ?)')
      .bind(quotaBucket(uploader, NOW), MAX_UPLOADS_PER_DAY).run();
    const response = await handleCatalogUpload(env, uploadRequest(makeBody()), deps());
    const reasons = await expectRejection(response, 429);
    expect(reasons.join(' ')).toMatch(/limit/i);
    const quota = await local.env.DB.prepare('SELECT count FROM upload_quota WHERE bucket = ?')
      .bind(quotaBucket(uploader, NOW)).first<{ count: number }>();
    expect(quota!.count).toBe(MAX_UPLOADS_PER_DAY);
  });

  it('uses UPLOAD_DAILY_LIMIT when it is configured (e2e raises it)', async () => {
    const uploader = await hashUploader(SALT, IP);
    await local.env.DB.prepare('INSERT INTO upload_quota (bucket, count) VALUES (?, ?)')
      .bind(quotaBucket(uploader, NOW), MAX_UPLOADS_PER_DAY).run();
    const raised = { ...env, UPLOAD_DAILY_LIMIT: String(MAX_UPLOADS_PER_DAY + 5) };
    expect((await handleCatalogUpload(raised, uploadRequest(makeBody()), deps())).status).toBe(201);
    const lowered = { ...env, UPLOAD_DAILY_LIMIT: '1' };
    const refused = await handleCatalogUpload(lowered, uploadRequest(makeBody()), deps());
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { reasons: string[] }).reasons.join(' ')).toContain('daily limit of 1 uploads');
  });

  it('rejects a body over the size limit from its Content-Length, storing nothing', async () => {
    const body = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    body.set(COMPONENT_PREAMBLE);
    const response = await handleCatalogUpload(env, uploadRequest(body), deps());
    await expectRejection(response, 413);
  });

  it('rejects a body with no Content-Length, storing nothing', async () => {
    const body = makeBody();
    const request = uploadRequest(body);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });
    const chunked = new Request(request, { body: stream, headers, duplex: 'half' } as RequestInit);
    const response = await handleCatalogUpload(env, chunked, deps());
    await expectRejection(response, 411);
  });

  it('rejects a non-wasm Content-Type, storing nothing', async () => {
    const response = await handleCatalogUpload(env, uploadRequest(makeBody(), { contentType: 'text/plain' }), deps());
    await expectRejection(response, 415);
  });

  it('rejects bytes that are not a component, storing nothing', async () => {
    const coreModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, 2]);
    const reasons = await expectRejection(await handleCatalogUpload(env, uploadRequest(coreModule), deps()), 400);
    expect(reasons.join(' ')).toMatch(/component/i);
    await expectRejection(await handleCatalogUpload(env, uploadRequest(new Uint8Array([0x00, 0x61, 0x73])), deps()), 400);
  });

  it('rejects metadata that fails the shared check, storing nothing', async () => {
    const reportHeader = encodeReport({ metadata: { ...METADATA, rulesDigest: 'sha256:wrong' }, report: REPORT });
    const reasons = await expectRejection(await handleCatalogUpload(env, uploadRequest(makeBody(), { reportHeader }), deps()), 400);
    expect(reasons.join(' ')).toMatch(/digest/i);
  });

  it('rejects a malformed report header, storing nothing', async () => {
    for (const reportHeader of ['not base64url!!', encodeReport({ nope: 1 }), encodeReport({ metadata: METADATA, report: 42 })]) {
      await expectRejection(await handleCatalogUpload(env, uploadRequest(makeBody(), { reportHeader }), deps()), 400);
    }
  });

  it('rejects a malformed hash header, storing nothing', async () => {
    await expectRejection(await handleCatalogUpload(env, uploadRequest(makeBody(), { sha256: 'XYZ' }), deps()), 400);
    await expectRejection(await handleCatalogUpload(env, uploadRequest(makeBody(), { sha256: 'A'.repeat(64) }), deps()), 400);
  });

  it('rejects bytes whose hash differs from the header, storing nothing', async () => {
    const response = await handleCatalogUpload(env, uploadRequest(makeBody(1), { sha256: sha256Hex(makeBody(2)) }), deps());
    const reasons = await expectRejection(response, 400);
    expect(reasons.join(' ')).toMatch(/sha-256|hash/i);
  });

  it('removes the stored bytes when the catalog insert fails', async () => {
    const real = local.env.DB;
    const broken = {
      prepare: (sql: string) => {
        if (sql.startsWith('INSERT INTO entrants')) {
          return { bind: () => ({ run: async () => { throw new Error('D1_ERROR: disk full'); } }) };
        }
        return real.prepare(sql);
      },
    } as unknown as D1Database;
    const response = await handleCatalogUpload({ ...env, DB: broken }, uploadRequest(makeBody()), deps());
    const reasons = await expectRejection(response, 503);
    expect(reasons.join(' ')).not.toContain('disk full');
  });
});

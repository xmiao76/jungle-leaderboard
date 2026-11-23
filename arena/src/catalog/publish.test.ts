import { describe, expect, it, vi } from 'vitest';
import { METADATA } from '../match/fakes.test-support';
import { publishEntrant } from './publish';
import { UPLOAD_HEADERS } from './upload-protocol';

const ENDPOINT = new URL('https://arena.example/api/catalog');
const SHA = 'c'.repeat(64);
const input = { bytes: new Uint8Array([0, 97, 115, 109]), sha256: SHA, metadata: METADATA, report: { games: 2 }, turnstileToken: 'token-1' };
const answer = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const decode = (header: string) => JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));

describe('publishEntrant', () => {
  it('posts the bytes with the hash, the report and the Turnstile token', async () => {
    const fetcher = answer(201, { entry: {} });
    expect(await publishEntrant(input, ENDPOINT, fetcher)).toEqual({ ok: true, existing: false });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(String(ENDPOINT));
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/wasm');
    expect(headers.get(UPLOAD_HEADERS.sha256)).toBe(SHA);
    expect(headers.get(UPLOAD_HEADERS.turnstileToken)).toBe('token-1');
    expect(decode(headers.get(UPLOAD_HEADERS.report)!)).toEqual({ metadata: METADATA, report: { games: 2 } });
    expect(init.body).toBe(input.bytes);
  });

  it('treats "already published" as success', async () => {
    expect(await publishEntrant(input, ENDPOINT, answer(200, { entry: {}, existing: true }))).toEqual({ ok: true, existing: true });
  });

  it("passes on the server's reasons for a refusal", async () => {
    expect(await publishEntrant(input, ENDPOINT, answer(429, { stage: 'server', reasons: ['The daily limit of 20 uploads is used up.'] }))).toEqual({
      ok: false,
      reasons: ['The daily limit of 20 uploads is used up.'],
    });
  });

  it('explains a refusal without reasons and a network failure', async () => {
    const html = vi.fn(async () => new Response('<html>oops</html>', { status: 502 }));
    expect(await publishEntrant(input, ENDPOINT, html)).toEqual({ ok: false, reasons: ['The Arena refused the upload (HTTP 502).'] });
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await publishEntrant(input, ENDPOINT, offline)).toEqual({ ok: false, reasons: ['The Arena could not be reached: Failed to fetch'] });
  });
});

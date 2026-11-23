/**
 * The catalog write path, served by functions/api/catalog/index.ts (POST /api/catalog):
 * one entrant whose browser upload test already passed becomes a public catalog entry.
 *
 * The request is the raw `application/wasm` body plus three headers:
 *   X-Entrant-Sha256    lowercase hex SHA-256 of the body
 *   X-Entrant-Report    base64url JSON `{ metadata, report }`: the entrant's `info()` and
 *                       the upload round's report, stored for display
 *   X-Turnstile-Token   a Turnstile token for this upload
 *
 * Checks run in the plan's order — Turnstile → quota → size → component header → metadata →
 * duplicate → R2 put (hash verified by R2) → D1 insert — and nothing is stored until the
 * check before it has passed. If the insert fails after the put, the object just written is
 * deleted again, unless a concurrent upload of the same bytes won the insert, in which case
 * that entry is the answer. The server never executes the binary; it re-checks everything it
 * can without running it (see docs/PLAN-shared-catalog.md).
 *
 * Responses: `201 { entry }` for a new entrant, `200 { entry, existing: true }` when these
 * exact bytes are already listed, and `{ stage: 'server', reasons: [...] }` with a 4xx/5xx
 * status for every rejection.
 */
import { UPLOAD_HEADERS } from '../arena/src/catalog/upload-protocol';
import { MAX_UPLOAD_BYTES } from '../arena/src/loader/limits';
import { checkMetadata } from '../arena/src/loader/metadata';
import { isComponentBinary } from '../arena/src/loader/strip';
import type { Metadata } from '../arena/src/referee/types';
import { consumeQuota, dailyLimit, hashUploader, quotaBucket, verifyTurnstile } from './abuse';
import { LISTED_COLUMNS, binaryKey, rowToPublicEntry, type EntrantStatus, type ListedRow } from './entrant-row';

export { hashUploader, quotaBucket, UPLOAD_HEADERS };

/** The runtime bindings plus the two upload secrets (set with `wrangler pages secret put`;
 * locally they come from `.dev.vars` — see `.dev.vars.example`). Not part of the generated
 * worker-configuration types, which only cover `wrangler.toml`. */
export interface CatalogUploadEnv extends Env {
  readonly TURNSTILE_SECRET?: string;
  readonly UPLOADER_SALT?: string;
  /** Optional override of MAX_UPLOADS_PER_DAY (e2e raises it). */
  readonly UPLOAD_DAILY_LIMIT?: string;
}

export interface CatalogUploadDeps {
  /** Siteverify calls; the real fetch in production. */
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  /**
   * R2 put only accepts a known-length stream, so the body — minus the prefix already read
   * for the header check, plus that prefix again — is pumped through workerd's
   * FixedLengthStream. Injected in tests, which run under Node where it does not exist.
   */
  readonly fixedLengthStream?: (length: number) => {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
  };
}

/** Upload attempts one uploader may make per UTC day. An attempt that passes Turnstile
 * counts, published or not: the quota is a brake on abuse, not a publication allowance. */
export const MAX_UPLOADS_PER_DAY = 20;

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Far above a real round report; bounds what a hostile header can make the worker parse. */
const MAX_REPORT_HEADER_CHARS = 65_536;
const HEADER_BYTES = 8;

const INSERT_ENTRANT = [
  'INSERT INTO entrants (sha256, size, title, game_version, model, code_agent, model_platform, github_url, engine_version, runtime,',
  '  rules_id, rules_digest, provenance, credits, report, uploader, created_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
].join('\n');
const SELECT_BY_SHA = `SELECT ${LISTED_COLUMNS}, status FROM entrants WHERE sha256 = ?`;

type StoredRow = ListedRow & { readonly status: EntrantStatus };

function rejection(status: number, reasons: readonly string[]): Response {
  return Response.json({ stage: 'server', reasons }, { status });
}

function unavailable(reason: string): Response {
  return rejection(503, [reason]);
}

/** Read just enough of the body to see the component preamble; the reader stays open. */
async function peekPrefix(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < HEADER_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const prefix = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, at);
    at += chunk.length;
  }
  return prefix;
}

async function pumpBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  prefix: Uint8Array,
  writable: WritableStream<Uint8Array>,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    if (prefix.length > 0) await writer.write(prefix);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (err) {
    await writer.abort(err).catch(() => undefined);
    throw err;
  }
}

function decodeReportHeader(value: string | null): { metadata: unknown; reportJson: string } | { reasons: string[] } {
  if (value === null || value.length === 0) return { reasons: ['The upload is missing its report header.'] };
  if (value.length > MAX_REPORT_HEADER_CHARS) return { reasons: ['The upload report is too large.'] };
  let parsed: unknown;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return { reasons: ['The upload report is not base64url-encoded JSON.'] };
  }
  if (typeof parsed !== 'object' || parsed === null) return { reasons: ['The upload report is not an object.'] };
  const { metadata, report } = parsed as Record<string, unknown>;
  if (metadata === undefined) return { reasons: ['The upload report carries no metadata.'] };
  if (typeof report !== 'object' || report === null || Array.isArray(report)) {
    return { reasons: ['The upload report carries no test report.'] };
  }
  return { metadata, reportJson: JSON.stringify(report) };
}

async function findEntrant(db: D1Database, sha256: string): Promise<StoredRow | null> {
  return db.prepare(SELECT_BY_SHA).bind(sha256).first<StoredRow>();
}

function existingResponse(row: StoredRow): Response {
  if (row.status !== 'listed') {
    return rejection(400, ['These exact bytes were uploaded before and are not listed in the catalog.']);
  }
  return Response.json({ entry: rowToPublicEntry(row), existing: true }, { status: 200 });
}

const isHashMismatch = (err: unknown): boolean =>
  /sha-?256|checksum|10037/i.test(err instanceof Error ? err.message : String(err));

export async function handleCatalogUpload(
  env: CatalogUploadEnv,
  request: Request,
  deps: CatalogUploadDeps = {},
): Promise<Response> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? (() => new Date());
  const fixedLengthStream = deps.fixedLengthStream ?? ((length: number) => new FixedLengthStream(length));
  try {
    if (!env.TURNSTILE_SECRET || !env.UPLOADER_SALT) {
      console.error('catalog upload unavailable: TURNSTILE_SECRET or UPLOADER_SALT is not configured');
      return unavailable('Uploads are not available right now; nothing was stored.');
    }

    // 1. Turnstile.
    const token = request.headers.get(UPLOAD_HEADERS.turnstileToken);
    if (!token) return rejection(400, ['The upload is missing its Turnstile token.']);
    const address = request.headers.get('cf-connecting-ip') ?? '';
    const turnstile = await verifyTurnstile(fetcher, env.TURNSTILE_SECRET, token, address);
    if (turnstile === 'unavailable') return unavailable('The bot check could not be verified; nothing was stored.');
    if (turnstile === 'failed') return rejection(403, ['The bot check failed; reload the upload page and try again.']);

    // 2. Quota.
    const uploader = await hashUploader(env.UPLOADER_SALT, address);
    const limit = dailyLimit(env.UPLOAD_DAILY_LIMIT, MAX_UPLOADS_PER_DAY);
    if (!(await consumeQuota(env.DB, 'upload_quota', quotaBucket(uploader, now()), limit))) {
      return rejection(429, [`The daily limit of ${limit} uploads is used up; try again tomorrow.`]);
    }

    // 3. Size (and content type), from headers alone; the body is streamed, never buffered.
    const contentType = request.headers.get('content-type');
    if (contentType !== null && contentType.split(';')[0]!.trim().toLowerCase() !== 'application/wasm') {
      return rejection(415, ['The upload body must be application/wasm.']);
    }
    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader === null) return rejection(411, ['The upload must send a Content-Length.']);
    const size = Number(lengthHeader);
    if (!Number.isSafeInteger(size) || size <= 0) return rejection(400, ['The upload Content-Length is not a positive size.']);
    if (size > MAX_UPLOAD_BYTES) return rejection(413, [`The file is larger than the ${MAX_UPLOAD_BYTES} byte limit.`]);
    if (request.body === null) return rejection(400, ['The upload has no body.']);

    // 4. Component header: the first eight bytes, read off the front of the stream.
    const reader = request.body.getReader();
    const abandon = async (response: Response): Promise<Response> => {
      await reader.cancel().catch(() => undefined);
      return response;
    };
    const prefix = await peekPrefix(reader);
    if (prefix.length < HEADER_BYTES || !isComponentBinary(prefix)) {
      return abandon(rejection(400, ['The file is not a WebAssembly component (its first bytes are not the component preamble).']));
    }

    // 5. Hash header and metadata, checked with the same code the Arena loader uses.
    const sha256 = request.headers.get(UPLOAD_HEADERS.sha256) ?? '';
    if (!SHA256_HEX.test(sha256)) {
      return abandon(rejection(400, ['The upload hash header is not a lowercase SHA-256 hex digest.']));
    }
    const decoded = decodeReportHeader(request.headers.get(UPLOAD_HEADERS.report));
    if ('reasons' in decoded) return abandon(rejection(400, decoded.reasons));
    const checked = checkMetadata(decoded.metadata);
    if (checked.issues.length > 0 || checked.metadata === null) {
      return abandon(rejection(400, checked.issues.length > 0 ? checked.issues : ['The metadata is not usable.']));
    }
    const metadata: Metadata = checked.metadata;

    // 6. Duplicate: identical bytes are the same entrant, never a second row.
    const existing = await findEntrant(env.DB, sha256);
    if (existing) return abandon(existingResponse(existing));

    // 7. Store the bytes; R2 itself verifies them against the claimed hash.
    const key = binaryKey(sha256);
    const { readable, writable } = fixedLengthStream(size);
    const [put, pump] = await Promise.allSettled([
      env.ENTRANTS.put(key, readable, { sha256, httpMetadata: { contentType: 'application/wasm' } }),
      pumpBody(reader, prefix, writable),
    ]);
    if (put.status === 'rejected') {
      if (isHashMismatch(put.reason)) {
        return rejection(400, ['The bytes do not match the SHA-256 in the upload hash header.']);
      }
      throw put.reason;
    }
    if (pump.status === 'rejected') {
      await env.ENTRANTS.delete(key).catch(() => undefined);
      throw pump.reason;
    }
    if (put.value === null || put.value.size !== size) {
      await env.ENTRANTS.delete(key).catch(() => undefined);
      return rejection(400, ['The upload body did not match its Content-Length.']);
    }

    // 8. Register the entrant. On failure the bytes go away again — unless the row now
    // exists because a concurrent upload of the same bytes won; then it is the answer.
    const createdAt = now().toISOString();
    try {
      await env.DB.prepare(INSERT_ENTRANT)
        .bind(
          sha256, size, metadata.title, metadata.gameVersion, metadata.model, metadata.codeAgent, metadata.modelPlatform,
          metadata.githubUrl, metadata.engineVersion, metadata.runtime, metadata.rulesId, metadata.rulesDigest,
          null, null, decoded.reportJson, uploader, createdAt,
        )
        .run();
    } catch (err) {
      const winner = await findEntrant(env.DB, sha256).catch(() => null);
      if (winner) return existingResponse(winner);
      await env.ENTRANTS.delete(key).catch(() => undefined);
      console.error('catalog upload insert failed', sha256, err);
      return unavailable('The catalog could not register the upload; nothing was stored.');
    }

    const entry = rowToPublicEntry({
      sha256, size,
      title: metadata.title, game_version: metadata.gameVersion, model: metadata.model,
      code_agent: metadata.codeAgent, model_platform: metadata.modelPlatform, github_url: metadata.githubUrl,
      engine_version: metadata.engineVersion, runtime: metadata.runtime,
      rules_id: metadata.rulesId, rules_digest: metadata.rulesDigest,
      provenance: null, credits: null, is_reference: 0, created_at: createdAt,
    });
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    // The cause goes to the Functions log; the uploader never sees binding internals.
    console.error('catalog upload failed', err);
    return unavailable('The catalog is temporarily unavailable; nothing was stored.');
  }
}

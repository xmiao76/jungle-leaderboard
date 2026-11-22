/**
 * The catalog read path, served by functions/api/catalog/[file].ts (GET and HEAD):
 *   /api/catalog/manifest.json   every listed entrant, in the Arena's manifest format
 *   /api/catalog/<sha256>.wasm   one listed entrant's bytes, streamed from R2
 * Anything else is a 404. The Arena verifies every download against the listed hash.
 */
import { CATALOG_FORMAT, type PublicEntry } from '../arena/src/catalog/catalog';
import { LISTED_COLUMNS, binaryKey, rowToPublicEntry, type ListedRow } from './entrant-row';

const MANIFEST = 'manifest.json';
const BINARY = /^([0-9a-f]{64})\.wasm$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

const LIST_LISTED = `SELECT ${LISTED_COLUMNS} FROM entrants WHERE status = 'listed' ORDER BY title, created_at, sha256`;
const IS_LISTED = "SELECT 1 AS listed FROM entrants WHERE sha256 = ? AND status = 'listed'";

export async function listPublicEntries(db: D1Database): Promise<PublicEntry[]> {
  const { results } = await db.prepare(LIST_LISTED).all<ListedRow>();
  return results.map(rowToPublicEntry);
}

const notFound = (): Response => new Response('Not found', { status: 404 });
const unavailable = (): Response => new Response('The Arena catalog is temporarily unavailable.', { status: 503 });

async function manifestResponse(db: D1Database): Promise<Response> {
  const entries = await listPublicEntries(db);
  return Response.json({ format: CATALOG_FORMAT, version: 1, entries }, { headers: { 'cache-control': 'no-cache' } });
}

async function binaryResponse(env: Env, sha256: string): Promise<Response> {
  const listed = await env.DB.prepare(IS_LISTED).bind(sha256).first();
  if (!listed) return notFound();
  const object = await env.ENTRANTS.get(binaryKey(sha256));
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      'content-type': 'application/wasm',
      'content-length': String(object.size),
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
    },
  });
}

export async function handleCatalogGet(env: Env, file: string): Promise<Response> {
  const binary = BINARY.exec(file);
  if (file !== MANIFEST && !binary) return notFound();
  try {
    return binary ? await binaryResponse(env, binary[1]!) : await manifestResponse(env.DB);
  } catch (err) {
    // The cause goes to the Functions log; the visitor never sees binding internals.
    console.error('catalog read failed', file, err);
    return unavailable();
  }
}

/** HEAD: the GET answer's status and headers, without reading the body. */
export async function handleCatalogHead(env: Env, file: string): Promise<Response> {
  const response = await handleCatalogGet(env, file);
  await response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}

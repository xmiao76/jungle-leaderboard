/**
 * Two catalogs, one picker:
 * - "Public catalog": every entrant admitted to the Arena's database, served by the catalog API
 *   (server/catalog-read.ts) as manifest.json plus one <sha256>.wasm per entrant. Every fetch is
 *   verified against the listed hash.
 * - "On this device": binaries this browser imported, stored in IndexedDB by hash.
 * A hash is an identity: the same bytes appear once, a new hash is a new entry even if
 * its title and version string are unchanged.
 */
import { sha256Hex } from '../loader/hash';
import { checkMetadata } from '../loader/metadata';
import type { Metadata } from '../referee/types';

export const CATALOG_FORMAT = 'jungle-arena-catalog';

export interface Provenance {
  readonly language: string;
  readonly source: string;
  readonly toolchain: string;
}

export interface PublicEntry {
  readonly sha256: string;
  readonly size: number;
  /** Path relative to the catalog directory. */
  readonly file: string;
  readonly metadata: Metadata;
  readonly addedAt: string;
  readonly provenance: Provenance | null;
  readonly credits: string | null;
  /** The program every upload test plays against (at most one entry). */
  readonly reference: boolean;
}

export interface PublicManifest {
  readonly format: typeof CATALOG_FORMAT;
  readonly version: 1;
  readonly entries: readonly PublicEntry[];
}

export type CatalogOrigin = 'public' | 'device';

export interface CatalogEntry {
  readonly sha256: string;
  readonly size: number;
  readonly metadata: Metadata;
  readonly origin: CatalogOrigin;
  /** The public entry is also stored on this device. */
  readonly onDevice: boolean;
  readonly addedAt: string;
  readonly file: string | null;
  readonly provenance: Provenance | null;
  readonly credits: string | null;
  readonly reference: boolean;
}

export interface CatalogGroup {
  readonly title: string;
  /** Newest version first. */
  readonly versions: readonly CatalogEntry[];
}

const SHA = /^[0-9a-f]{64}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.wasm$/;

export function parseManifest(data: unknown): { manifest: PublicManifest | null; issues: string[] } {
  const issues: string[] = [];
  if (typeof data !== 'object' || data === null) return { manifest: null, issues: ['The catalog manifest is not an object.'] };
  const record = data as Record<string, unknown>;
  if (record['format'] !== CATALOG_FORMAT || record['version'] !== 1) return { manifest: null, issues: ['Unknown catalog manifest format.'] };
  if (!Array.isArray(record['entries'])) return { manifest: null, issues: ['The catalog manifest has no entry list.'] };

  const entries: PublicEntry[] = [];
  for (const [i, raw] of (record['entries'] as unknown[]).entries()) {
    const e = raw as Record<string, unknown>;
    const metadata = checkMetadata(e?.['metadata']);
    if (typeof e?.['sha256'] !== 'string' || !SHA.test(e['sha256'])) issues.push(`Entry ${i}: malformed hash.`);
    else if (typeof e['file'] !== 'string' || !SAFE_FILE.test(e['file'])) issues.push(`Entry ${i}: unsafe or missing file name.`);
    else if (typeof e['size'] !== 'number' || !metadata.metadata || metadata.issues.length > 0) issues.push(`Entry ${i}: invalid size or metadata.`);
    else {
      entries.push({
        sha256: e['sha256'],
        size: e['size'],
        file: e['file'],
        metadata: metadata.metadata,
        addedAt: typeof e['addedAt'] === 'string' ? e['addedAt'] : '',
        provenance: (e['provenance'] as Provenance | undefined) ?? null,
        credits: typeof e['credits'] === 'string' ? e['credits'] : null,
        reference: e['reference'] === true,
      });
    }
  }
  return { manifest: { format: CATALOG_FORMAT, version: 1, entries }, issues };
}

export async function fetchPublicManifest(catalogBase: URL, fetcher: typeof fetch = fetch): Promise<{ entries: PublicEntry[]; error: string | null }> {
  try {
    const response = await fetcher(new URL('manifest.json', catalogBase), { cache: 'no-cache' });
    if (!response.ok) return { entries: [], error: `The public catalog could not be loaded (HTTP ${response.status}).` };
    const { manifest, issues } = parseManifest(await response.json());
    return { entries: [...(manifest?.entries ?? [])], error: issues.length > 0 ? issues.join(' ') : null };
  } catch (err) {
    return { entries: [], error: `The public catalog could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export class HashMismatchError extends Error {
  override readonly name = 'HashMismatchError';
}

/** Fetch a public binary and prove it is the one the manifest names. */
export async function fetchPublicBinary(entry: { file: string; sha256: string }, catalogBase: URL, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetcher(new URL(entry.file, catalogBase));
  if (!response.ok) throw new Error(`Could not download ${entry.file} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = await sha256Hex(bytes);
  if (actual !== entry.sha256) throw new HashMismatchError(`${entry.file} does not match its catalog hash (got ${actual.slice(0, 12)}…, expected ${entry.sha256.slice(0, 12)}…).`);
  return bytes;
}

/** Compare dotted versions numerically where possible ("1.10.0" > "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = Number(x);
    const ny = Number(y);
    const diff = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function mergeCatalog(
  publicEntries: readonly PublicEntry[],
  deviceEntries: readonly { sha256: string; size: number; metadata: Metadata; importedAt: string }[],
): CatalogEntry[] {
  const deviceHashes = new Set(deviceEntries.map((d) => d.sha256));
  const merged: CatalogEntry[] = publicEntries.map((p) => ({
    sha256: p.sha256,
    size: p.size,
    metadata: p.metadata,
    origin: 'public',
    onDevice: deviceHashes.has(p.sha256),
    addedAt: p.addedAt,
    file: p.file,
    provenance: p.provenance,
    credits: p.credits,
    reference: p.reference,
  }));
  const publicHashes = new Set(publicEntries.map((p) => p.sha256));
  for (const d of deviceEntries) {
    if (publicHashes.has(d.sha256)) continue;
    // Stored device metadata may predate modelPlatform; normalize it like checkMetadata does.
    merged.push({ sha256: d.sha256, size: d.size, metadata: { ...d.metadata, modelPlatform: d.metadata.modelPlatform ?? '' }, origin: 'device', onDevice: true, addedAt: d.importedAt, file: null, provenance: null, credits: null, reference: false });
  }
  return merged;
}

export function groupByTitle(entries: readonly CatalogEntry[]): CatalogGroup[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.metadata.title) ?? [];
    list.push(entry);
    groups.set(entry.metadata.title, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, versions]) => ({
      title,
      versions: versions.sort((a, b) => compareVersions(b.metadata.gameVersion, a.metadata.gameVersion) || b.addedAt.localeCompare(a.addedAt)),
    }));
}

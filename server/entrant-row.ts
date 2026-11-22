/**
 * One entrant as stored in D1 (migrations/0001_entrants.sql), and its mapping to the catalog
 * wire format the Arena already parses (`PublicEntry` in arena/src/catalog/catalog.ts).
 */
import type { Provenance, PublicEntry } from '../arena/src/catalog/catalog';

export type EntrantStatus = 'listed' | 'hidden';

export interface EntrantRow {
  readonly sha256: string;
  readonly size: number;
  readonly title: string;
  readonly game_version: string;
  readonly model: string;
  readonly code_agent: string;
  readonly github_url: string;
  readonly engine_version: string;
  readonly runtime: string;
  readonly rules_id: string;
  readonly rules_digest: string;
  readonly provenance: string | null;
  readonly credits: string | null;
  readonly report: string;
  readonly status: EntrantStatus;
  readonly is_reference: number;
  readonly uploader: string | null;
  readonly created_at: string;
}

/** The columns the public listing reads: never the stored report or the uploader hash. */
export type ListedRow = Omit<EntrantRow, 'report' | 'status' | 'uploader'>;

/** R2 object key, and the file name the catalog lists, for an entrant's bytes. */
export const binaryKey = (sha256: string): string => `${sha256}.wasm`;

/** The columns a `ListedRow` selects: never the stored report or the uploader hash. */
export const LISTED_COLUMNS = [
  'sha256', 'size', 'title', 'game_version', 'model', 'code_agent', 'github_url', 'engine_version', 'runtime',
  'rules_id', 'rules_digest', 'provenance', 'credits', 'is_reference', 'created_at',
].join(', ');

function parseProvenance(text: string | null): Provenance | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { language, source, toolchain } = value as Record<string, unknown>;
  if (typeof language !== 'string' || typeof source !== 'string' || typeof toolchain !== 'string') return null;
  return { language, source, toolchain };
}

export function rowToPublicEntry(row: ListedRow): PublicEntry {
  return {
    sha256: row.sha256,
    size: row.size,
    file: binaryKey(row.sha256),
    metadata: {
      title: row.title,
      gameVersion: row.game_version,
      model: row.model,
      codeAgent: row.code_agent,
      githubUrl: row.github_url,
      engineVersion: row.engine_version,
      runtime: row.runtime,
      rulesId: row.rules_id,
      rulesDigest: row.rules_digest,
    },
    addedAt: row.created_at,
    provenance: parseProvenance(row.provenance),
    credits: row.credits,
    reference: row.is_reference === 1,
  };
}

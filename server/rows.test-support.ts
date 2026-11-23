/** Catalog rows for server tests. */
import { RULES_DIGEST, RULES_ID } from '../arena/src/referee/profile';
import type { EntrantRow } from './entrant-row';

export const sha = (c: string): string => c.repeat(64);

export function sampleRow(overrides: Partial<EntrantRow> = {}): EntrantRow {
  return {
    sha256: sha('a'),
    size: 4,
    title: 'Jungle — test',
    game_version: '1.0.0',
    model: 'Model-X',
    code_agent: 'Agent-Y',
    model_platform: 'official',
    github_url: 'https://github.com/example/jungle',
    engine_version: 'engine 1',
    runtime: 'Rust',
    rules_id: RULES_ID,
    rules_digest: RULES_DIGEST,
    provenance: JSON.stringify({ language: 'Rust', source: 'https://github.com/example/jungle', toolchain: 'rustc 1.94.1' }),
    credits: 'Art: CC-BY 4.0',
    report: JSON.stringify({ source: 'test' }),
    status: 'listed',
    is_reference: 0,
    uploader: null,
    created_at: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

const COLUMNS = Object.keys(sampleRow()) as (keyof EntrantRow)[];

export async function insertRow(db: D1Database, row: EntrantRow): Promise<void> {
  const placeholders = COLUMNS.map(() => '?').join(', ');
  await db
    .prepare(`INSERT INTO entrants (${COLUMNS.join(', ')}) VALUES (${placeholders})`)
    .bind(...COLUMNS.map((c) => row[c]))
    .run();
}

/** The bytes of a minimal component header, enough for R2 round trips. */
export const WASM_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

/**
 * SQL that loads maintainer-curated seed entries (seed/catalog/seed.json) into D1, run by
 * scripts/db-seed.ts through `wrangler d1 execute --file`. Re-running it is safe: entries are
 * upserted by hash, a hidden entry stays hidden, and its first-added date is kept. The seed
 * file decides which entry is the reference opponent.
 */
import type { PublicEntry } from '../arena/src/catalog/catalog';

const SEED_REPORT = JSON.stringify({ source: 'seed', checks: 'npm run catalog:add (size, header, contract, smoke)' });

/** A SQLite string literal, or NULL. Only single quotes need escaping inside one. */
export function sqlText(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

// `wrangler d1 execute --file` strips transaction statements by plain text search, even inside
// string literals, and D1 rejects NUL; control characters and lone surrogates do not round-trip.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TRANSACTION = /\bBEGIN\s+TRANSACTION\b|\bCOMMIT\s*;/i;

function unsafeText(entry: PublicEntry): string | null {
  const m = entry.metadata;
  const texts = [entry.credits, entry.addedAt, ...Object.values(m), ...Object.values(entry.provenance ?? {})];
  const bad = texts.find((t) => t !== null && (CONTROL.test(t) || TRANSACTION.test(t) || !t.isWellFormed()));
  return bad === undefined ? null : `${entry.file}: text ${JSON.stringify(bad.slice(0, 40))} cannot be seeded`;
}

function upsert(entry: PublicEntry): string {
  const m = entry.metadata;
  const values = [
    sqlText(entry.sha256),
    String(entry.size),
    sqlText(m.title),
    sqlText(m.gameVersion),
    sqlText(m.model),
    sqlText(m.codeAgent),
    sqlText(m.githubUrl),
    sqlText(m.engineVersion),
    sqlText(m.runtime),
    sqlText(m.rulesId),
    sqlText(m.rulesDigest),
    sqlText(entry.provenance ? JSON.stringify(entry.provenance) : null),
    sqlText(entry.credits),
    sqlText(SEED_REPORT),
    entry.reference ? '1' : '0',
    sqlText(entry.addedAt),
  ];
  return [
    'INSERT INTO entrants (sha256, size, title, game_version, model, code_agent, github_url, engine_version, runtime,',
    '  rules_id, rules_digest, provenance, credits, report, is_reference, created_at)',
    `VALUES (${values.join(', ')})`,
    'ON CONFLICT (sha256) DO UPDATE SET size = excluded.size, title = excluded.title,',
    '  game_version = excluded.game_version, model = excluded.model, code_agent = excluded.code_agent,',
    '  github_url = excluded.github_url,',
    '  engine_version = excluded.engine_version, runtime = excluded.runtime, rules_id = excluded.rules_id,',
    '  rules_digest = excluded.rules_digest, provenance = excluded.provenance, credits = excluded.credits,',
    '  report = excluded.report, is_reference = excluded.is_reference;',
  ].join('\n');
}

/** Throws unless the entries can be seeded safely; the seed always names exactly one reference. */
export function seedSql(entries: readonly PublicEntry[]): string {
  const references = entries.filter((e) => e.reference).length;
  if (references !== 1) throw new Error(`the seed must name exactly one reference opponent (found ${references})`);
  const unsafe = entries.map(unsafeText).find((issue) => issue !== null);
  if (unsafe) throw new Error(unsafe);
  // Clear the flag first so moving it between entries never trips the one-reference index.
  return ['UPDATE entrants SET is_reference = 0 WHERE is_reference = 1;', ...entries.map(upsert)].join('\n\n') + '\n';
}

// Remove (or hide) one published program from the Arena catalog — the maintainer operation
// there is deliberately no UI for, because uploads are anonymous:
//
//   npm run program:remove -- --local --list
//   npm run program:remove -- --local [--persist-to <dir>] --sha <sha256> [--dry-run]
//   npm run program:remove -- --remote --title "Muse Jungle" [--version 1.2.0] [--hide|--unhide] [--dry-run]
//
// Default is a hard delete: the program's match records, rating history and catalog row go,
// then its bytes leave R2, and — if it had counted matches — ratings are recomputed so its
// opponents' standings no longer include those results. This is irreversible except by
// re-uploading the file (which publishes it fresh at 1000). --hide is the reversible version:
// status='hidden' removes it from the catalog, pickers and leaderboard (and its .wasm URL
// 404s) while everything stays stored; --unhide restores it. The reference opponent can be
// neither removed nor hidden (every upload test plays against it), and a curated seed entry
// cannot be hard-deleted — db:seed would put it straight back; hide it, or remove it from
// seed/catalog first.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlText } from '../server/seed-sql';
import { parseTarget, readSeed } from './db-seed';
import { applyRecompute } from './ratings-recompute';
import { d1ExecuteSql, d1Query, r2DeleteObject, type Target } from './wrangler-run';

export interface ProgramRow {
  readonly sha256: string;
  readonly title: string;
  readonly gameVersion: string;
  readonly model: string;
  readonly codeAgent: string;
  readonly modelPlatform: string;
  readonly status: string;
  readonly isReference: boolean;
  readonly rating: number;
  readonly ratedMatches: number;
}

export interface MatchCounts {
  readonly counted: number;
  readonly unrated: number;
  readonly voided: number;
}

export type RemovalMode = 'remove' | 'hide' | 'unhide';

export interface RemovalPlan {
  readonly mode: RemovalMode;
  readonly program: ProgramRow;
  readonly matches: MatchCounts;
  readonly ratingChanges: number;
  /** Opponents' ratings must be re-folded without this program's counted matches. */
  readonly willRecompute: boolean;
}

const SHA = /^[0-9a-f]{64}$/;

/** What may be done to this program, refusing the cases that would break the Arena. Pure. */
export function planRemoval(program: ProgramRow, matches: MatchCounts, ratingChanges: number, isSeedEntry: boolean, mode: RemovalMode): RemovalPlan {
  if (!SHA.test(program.sha256)) throw new Error(`refusing to act on a malformed hash: ${program.sha256}`);
  if (program.isReference) {
    throw new Error(`"${program.title}" is the reference opponent every upload test plays against; it can be neither removed nor hidden`);
  }
  if (mode === 'remove' && isSeedEntry) {
    throw new Error(
      `"${program.title}" is a curated seed entry (seed/catalog/seed.json); db:seed would put it straight back. ` +
        'Remove it from the seed catalog first, or use --hide (re-seeding preserves hidden).',
    );
  }
  if (mode === 'hide' && program.status === 'hidden') throw new Error(`"${program.title}" is already hidden`);
  if (mode === 'unhide' && program.status !== 'hidden') throw new Error(`"${program.title}" is not hidden (status: ${program.status})`);
  return { mode, program, matches, ratingChanges, willRecompute: mode === 'remove' && matches.counted > 0 };
}

/** Foreign-key order: matches and rating history reference the entrant, so they go first. */
export function removalSql(sha256: string): string {
  if (!SHA.test(sha256)) throw new Error(`refusing to write SQL for a malformed hash: ${sha256}`);
  return [
    `DELETE FROM matches WHERE left_sha = '${sha256}' OR right_sha = '${sha256}';`,
    `DELETE FROM rating_changes WHERE sha256 = '${sha256}';`,
    `DELETE FROM entrants WHERE sha256 = '${sha256}';`,
    '',
  ].join('\n');
}

export function visibilitySql(sha256: string, hide: boolean): string {
  if (!SHA.test(sha256)) throw new Error(`refusing to write SQL for a malformed hash: ${sha256}`);
  return `UPDATE entrants SET status = '${hide ? 'hidden' : 'listed'}' WHERE sha256 = '${sha256}';\n`;
}

const COLUMNS = 'sha256, title, game_version, model, code_agent, model_platform, status, is_reference, rating, rated_matches';

function toProgram(row: Record<string, unknown>): ProgramRow {
  const text = (f: string) => {
    const v = row[f];
    if (typeof v !== 'string') throw new Error(`entrants row has no text ${f}: ${JSON.stringify(row)}`);
    return v;
  };
  const num = (f: string) => {
    const v = row[f];
    if (typeof v !== 'number') throw new Error(`entrants row has no numeric ${f}: ${JSON.stringify(row)}`);
    return v;
  };
  return {
    sha256: text('sha256'),
    title: text('title'),
    gameVersion: text('game_version'),
    model: text('model'),
    codeAgent: text('code_agent'),
    modelPlatform: text('model_platform'),
    status: text('status'),
    isReference: num('is_reference') === 1,
    rating: num('rating'),
    ratedMatches: num('rated_matches'),
  };
}

const describe = (p: ProgramRow): string =>
  `"${p.title}" v${p.gameVersion} (${p.model} · ${p.codeAgent}${p.modelPlatform ? ` · ${p.modelPlatform}` : ''}, ${p.sha256.slice(0, 12)}…, ${p.status}, Elo ${Math.round(p.rating)}, ${p.ratedMatches} rated match(es)${p.isReference ? ', REFERENCE' : ''})`;

async function lookup(target: Target, selector: { sha: string | null; title: string | null; version: string | null }): Promise<ProgramRow> {
  const where = selector.sha
    ? `sha256 = ${sqlText(selector.sha)}`
    : `title = ${sqlText(selector.title!)}${selector.version ? ` AND game_version = ${sqlText(selector.version)}` : ''}`;
  const rows = (await d1Query(target, `SELECT ${COLUMNS} FROM entrants WHERE ${where} ORDER BY created_at`)).map(toProgram);
  if (rows.length === 0) throw new Error(selector.sha ? `no program with sha256 ${selector.sha}` : `no program titled "${selector.title}"${selector.version ? ` v${selector.version}` : ''}; try --list`);
  if (rows.length > 1) {
    throw new Error(`that title matches ${rows.length} programs; pick one with --sha:\n${rows.map((r) => `  ${describe(r)}\n    --sha ${r.sha256}`).join('\n')}`);
  }
  return rows[0]!;
}

async function matchCounts(target: Target, sha256: string): Promise<{ matches: MatchCounts; changes: number }> {
  const rows = await d1Query(
    target,
    `SELECT status, COUNT(*) AS n FROM matches WHERE left_sha = '${sha256}' OR right_sha = '${sha256}' GROUP BY status`,
  );
  const byStatus = new Map(rows.map((r) => [String(r['status']), Number(r['n'])]));
  const changes = await d1Query(target, `SELECT COUNT(*) AS n FROM rating_changes WHERE sha256 = '${sha256}'`);
  return {
    matches: { counted: byStatus.get('counted') ?? 0, unrated: byStatus.get('unrated') ?? 0, voided: byStatus.get('voided') ?? 0 },
    changes: Number(changes[0]?.['n'] ?? 0),
  };
}

export interface RemovalOptions {
  readonly mode: RemovalMode;
  readonly sha: string | null;
  readonly title: string | null;
  readonly version: string | null;
  readonly list: boolean;
  readonly dryRun: boolean;
}

export async function runProgramRemove(target: Target, options: RemovalOptions): Promise<void> {
  if (options.list) {
    const rows = (await d1Query(target, `SELECT ${COLUMNS} FROM entrants ORDER BY title, created_at`)).map(toProgram);
    if (rows.length === 0) console.log('program:remove: the catalog is empty');
    for (const p of rows) console.log(`  ${describe(p)}\n    --sha ${p.sha256}`);
    return;
  }
  if (!options.sha && !options.title) throw new Error('name the program with --sha <sha256> or --title "<title>" [--version <v>], or use --list');
  if (options.sha && !SHA.test(options.sha)) throw new Error(`--sha must be a full 64-hex SHA-256, got "${options.sha}"`);

  const program = await lookup(target, options);
  const { matches, changes } = await matchCounts(target, program.sha256);
  const isSeedEntry = readSeed().entries.some((e) => e.sha256 === program.sha256);
  const plan = planRemoval(program, matches, changes, isSeedEntry, options.mode);
  const verb = options.mode === 'remove' ? 'REMOVE' : options.mode === 'hide' ? 'HIDE' : 'UNHIDE';
  console.log(`program:remove: ${verb} ${describe(program)}`);
  console.log(`  match records: ${matches.counted} counted, ${matches.unrated} unrated, ${matches.voided} voided; ${changes} rating change(s)`);
  if (options.dryRun) {
    console.log('program:remove: --dry-run, nothing written');
    return;
  }

  if (options.mode === 'hide' || options.mode === 'unhide') {
    const hide = options.mode === 'hide';
    await d1ExecuteSql(target, visibilitySql(program.sha256, hide));
    console.log(`program:remove: ${hide ? 'hidden (reversible with --unhide)' : 'listed again'}; ratings untouched`);
    return;
  }

  await d1ExecuteSql(target, removalSql(program.sha256));
  console.log('program:remove: catalog row, match records and rating history deleted');
  try {
    await r2DeleteObject(target, `${program.sha256}.wasm`);
    console.log('program:remove: binary deleted from R2');
  } catch (err) {
    // The row is gone, so the bytes are unreachable; name the orphan for a manual retry.
    console.error(`program:remove: WARNING — the R2 object ${program.sha256}.wasm could not be deleted (${err instanceof Error ? err.message : String(err)}); it is orphaned but unservable`);
  }
  if (plan.willRecompute) {
    console.log('program:remove: it had counted matches; recomputing the remaining ratings');
    await applyRecompute(target, false);
  }
  console.log('program:remove: done. Re-uploading the same file would publish it fresh at 1000 Elo.');
}

const flagValue = (args: readonly string[], name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--hide') && args.includes('--unhide')) throw new Error('pass at most one of --hide and --unhide');
    await runProgramRemove(parseTarget(args), {
      mode: args.includes('--hide') ? 'hide' : args.includes('--unhide') ? 'unhide' : 'remove',
      sha: flagValue(args, '--sha'),
      title: flagValue(args, '--title'),
      version: flagValue(args, '--version'),
      list: args.includes('--list'),
      dryRun: args.includes('--dry-run'),
    });
  } catch (err) {
    console.error(`program:remove: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

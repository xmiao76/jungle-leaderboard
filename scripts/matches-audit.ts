// Audit recorded matches by actually re-running them in Node: both programs are fetched from
// R2, instantiated through the Arena's own loader, and driven against the real referee with
// the match's seed, difficulty and node budget. Every move a program chooses must equal the
// move the browser reported, and the game must end the way the report said. That is the check
// the report API cannot do (Workers Free cannot run the programs), and it is the answer to a
// forged or selectively reported match: --void withdraws it and ratings are recomputed.
//
//   npm run matches:audit -- --local [--persist-to <dir>] [--id <match id>] [--all] [--dry-run]
//   npm run matches:audit -- --remote --void <match id>
//
// Default: every `counted` match. --all adds `unrated` ones; `voided` rows are never audited.
// A game that ended by forfeit cannot be re-run (a timeout is a property of the reporter's
// browser, and chooseMove is synchronous here so a deadline cannot preempt a hostile program);
// such games report as `forfeit` and do not fail the audit. Exit code is non-zero when any
// audited game mismatches, errors, or has unreadable stored moves.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuestGame } from '../arena/src/loader/guest';
import { instantiateInNode } from '../arena/src/loader/node-host';
import { applyMove, initialSnapshot, legalMoves } from '../arena/src/referee';
import type { Level, Side } from '../arena/src/referee/types';
import { parseTarget } from './db-seed';
import { applyRecompute } from './ratings-recompute';
import { d1ExecuteSql, d1Query, r2GetToFile, type Target } from './wrangler-run';

/** One game as stored in matches.moves (canonicalMoves in server/match-report-body.ts). */
export interface StoredGame {
  readonly red: string;
  readonly blue: string;
  readonly moves: readonly (readonly [number, number])[];
  readonly result: { readonly status: string; readonly winner: Side | null; readonly reason: string };
}

export type VerdictKind = 'ok' | 'mismatch' | 'program-error' | 'forfeit' | 'corrupt';
export interface Verdict {
  readonly kind: VerdictKind;
  readonly detail: string;
}

const SHA = /^[0-9a-f]{64}$/;
const SIDES: readonly string[] = ['red', 'blue'];
const LEVELS: readonly string[] = ['easy', 'medium', 'hard'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The two stored games, or null when the stored text is not the canonical shape. */
export function parseStoredGames(text: string): StoredGame[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const games: StoredGame[] = [];
  for (const g of raw as unknown[]) {
    if (!isRecord(g) || typeof g['red'] !== 'string' || !SHA.test(g['red']) || typeof g['blue'] !== 'string' || !SHA.test(g['blue'])) return null;
    if (!Array.isArray(g['moves']) || !g['moves'].every((m) => Array.isArray(m) && m.length === 2 && m.every((n) => Number.isInteger(n)))) return null;
    const result = g['result'];
    if (!isRecord(result) || typeof result['status'] !== 'string' || typeof result['reason'] !== 'string') return null;
    if (!(result['winner'] === null || SIDES.includes(result['winner'] as string))) return null;
    games.push({
      red: g['red'],
      blue: g['blue'],
      moves: g['moves'] as [number, number][],
      result: { status: result['status'], winner: result['winner'] as Side | null, reason: result['reason'] },
    });
  }
  return games;
}

export interface AuditSettings {
  readonly firstSide: Side;
  readonly seed: number;
  readonly difficulty: Level;
  readonly nodeBudget: number;
}

/**
 * Re-run one stored game: fresh guests (already instantiated) are initialised with the match's
 * seed and difficulty, then each side to move must choose exactly the reported move.
 */
export function auditGame(guests: { readonly red: GuestGame; readonly blue: GuestGame }, settings: AuditSettings, stored: StoredGame): Verdict {
  if (stored.result.status === 'forfeited') {
    return { kind: 'forfeit', detail: `ended by forfeit (${stored.result.reason}); the ending cannot be re-run` };
  }
  const bySide: Record<Side, GuestGame> = { red: guests.red, blue: guests.blue };
  let snapshot = initialSnapshot(settings.firstSide);
  try {
    guests.red.init('red', settings.difficulty, settings.seed);
    guests.blue.init('blue', settings.difficulty, settings.seed);
    for (const [i, [src, dst]] of stored.moves.entries()) {
      const legal = legalMoves(snapshot);
      const index = bySide[snapshot.toPlay].chooseMove(snapshot, legal, settings.nodeBudget);
      const move = legal[index];
      if (!move) return { kind: 'program-error', detail: `${snapshot.toPlay} chose out-of-range index ${index} at ply ${i + 1}` };
      if (move.src !== src || move.dst !== dst) {
        return { kind: 'mismatch', detail: `ply ${i + 1}: reported ${src}→${dst}, the program now chooses ${move.src}→${move.dst}` };
      }
      snapshot = applyMove(snapshot, move);
    }
  } catch (err) {
    return { kind: 'program-error', detail: err instanceof Error ? err.message : String(err) };
  }
  if (snapshot.status !== stored.result.status || snapshot.winner !== stored.result.winner || snapshot.reason !== stored.result.reason) {
    return {
      kind: 'mismatch',
      detail: `reported ${stored.result.status}/${stored.result.winner ?? 'none'}/${stored.result.reason}, re-run ends ${snapshot.status}/${snapshot.winner ?? 'none'}/${snapshot.reason}`,
    };
  }
  return { kind: 'ok', detail: `${stored.moves.length} plies, ${snapshot.status}${snapshot.winner ? ` by ${snapshot.winner}` : ''} (${snapshot.reason})` };
}

interface MatchRow {
  readonly id: number;
  readonly status: string;
  readonly firstSide: Side;
  readonly seed: number;
  readonly difficulty: Level;
  readonly nodeBudget: number;
  readonly moves: string;
}

const num = (row: Record<string, unknown>, field: string): number => {
  const value = row[field];
  if (typeof value !== 'number') throw new Error(`matches row has no numeric ${field}: ${JSON.stringify(row)}`);
  return value;
};

async function loadMatches(target: Target, id: number | null, all: boolean, voidId: number | null): Promise<MatchRow[]> {
  const status = voidId !== null ? '' : all ? "status IN ('counted', 'unrated')" : "status = 'counted'";
  const conditions = [id !== null ? `id = ${id}` : '', status].filter(Boolean).join(' AND ');
  const rows = await d1Query(
    target,
    `SELECT id, status, first_side, seed, difficulty, node_budget, moves FROM matches ${conditions ? `WHERE ${conditions}` : ''} ORDER BY id`,
  );
  return rows.map((row) => {
    const firstSide = row['first_side'];
    const difficulty = row['difficulty'];
    if (!SIDES.includes(firstSide as string) || !LEVELS.includes(difficulty as string)) {
      throw new Error(`matches row has an unknown side or difficulty: ${JSON.stringify(row)}`);
    }
    return {
      id: num(row, 'id'),
      status: String(row['status']),
      firstSide: firstSide as Side,
      seed: num(row, 'seed'),
      difficulty: difficulty as Level,
      nodeBudget: num(row, 'node_budget'),
      moves: String(row['moves']),
    };
  });
}

async function guestFor(target: Target, sha256: string, dir: string, cache: Map<string, Uint8Array>): Promise<GuestGame> {
  let bytes = cache.get(sha256);
  if (!bytes) {
    const file = join(dir, `${sha256}.wasm`);
    await r2GetToFile(target, `${sha256}.wasm`, file);
    bytes = new Uint8Array(readFileSync(file));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256) throw new Error(`R2 bytes for ${sha256} hash to ${actual} instead`);
    cache.set(sha256, bytes);
  }
  return instantiateInNode(bytes);
}

const flagValue = (args: readonly string[], name: string): number | null => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = Number(args[i + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} needs a match id, got "${args[i + 1]}"`);
  return value;
};

export async function runAudit(target: Target, args: { id: number | null; all: boolean; voidId: number | null; dryRun: boolean }): Promise<number> {
  const matches = await loadMatches(target, args.voidId ?? args.id, args.all, args.voidId);
  if (args.voidId !== null) {
    const row = matches[0];
    if (!row) throw new Error(`match ${args.voidId} does not exist`);
    if (row.status === 'voided') throw new Error(`match ${args.voidId} is already voided`);
  }
  if (matches.length === 0) {
    console.log('matches:audit: no matches to audit');
    return 0;
  }
  const dir = mkdtempSync(join(tmpdir(), 'jungle-audit-'));
  const cache = new Map<string, Uint8Array>();
  let failures = 0;
  try {
    for (const match of matches) {
      const games = parseStoredGames(match.moves);
      if (!games) {
        console.log(`match ${match.id} (${match.status}): CORRUPT — stored moves are not the canonical shape`);
        failures += 1;
        continue;
      }
      for (const [i, game] of games.entries()) {
        const label = `match ${match.id} (${match.status}) game ${i + 1} red ${game.red.slice(0, 8)}… blue ${game.blue.slice(0, 8)}…`;
        if (game.result.status === 'forfeited') {
          console.log(`${label}: FORFEIT — ended by forfeit (${game.result.reason}); the ending cannot be re-run`);
          continue;
        }
        const guests = { red: await guestFor(target, game.red, dir, cache), blue: await guestFor(target, game.blue, dir, cache) };
        const verdict = auditGame(guests, { firstSide: match.firstSide, seed: match.seed, difficulty: match.difficulty, nodeBudget: match.nodeBudget }, game);
        console.log(`${label}: ${verdict.kind.toUpperCase()} — ${verdict.detail}`);
        if (verdict.kind !== 'ok') failures += 1;
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (args.voidId !== null) {
    if (args.dryRun) {
      console.log(`matches:audit: --dry-run, match ${args.voidId} NOT voided and ratings NOT recomputed`);
      return failures;
    }
    await d1ExecuteSql(target, `UPDATE matches SET status = 'voided' WHERE id = ${args.voidId} AND status <> 'voided';\n`);
    console.log(`matches:audit: match ${args.voidId} voided; recomputing ratings`);
    await applyRecompute(target, false);
  }
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    const failures = await runAudit(parseTarget(args), {
      id: flagValue(args, '--id'),
      all: args.includes('--all'),
      voidId: flagValue(args, '--void'),
      dryRun: args.includes('--dry-run'),
    });
    if (failures > 0) {
      console.error(`matches:audit: ${failures} game(s) did not verify`);
      process.exit(1);
    }
    console.log('matches:audit: every audited game verified');
  } catch (err) {
    console.error(`matches:audit: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

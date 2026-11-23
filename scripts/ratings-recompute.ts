// Recompute every Elo rating from the recorded matches, and put right any that drifted:
//
//   npm run ratings:recompute -- --local [--persist-to <dir>] [--dry-run]
//   npm run ratings:recompute -- --remote [--dry-run]
//
// It folds the `counted` matches in id order through replayRatings (server/elo.ts) — the same
// function the report API's arithmetic is defined by — and, for each entrant whose stored
// standing differs, bumps rating_seq by one, writes the folded standing, and appends one
// rating_changes row (match_id NULL). Sequences are never renumbered and history is never
// deleted: the (sha256, seq) key is what concurrent match reports collide on, so disturbing
// it would remove their protection. D1 runs the SQL file statement by statement, so each
// entrant's UPDATE precedes its INSERT: an interruption can lose a history row but can never
// wedge a sequence, and re-running always heals the ratings. On a healthy database this
// reports no changes — which is also the check that the fold reproduces the stored ratings.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_RATING, replayRatings, type CountedMatch, type Standing } from '../server/elo';
import { parseTarget } from './db-seed';
import { d1ExecuteSql, d1Query, type Target } from './wrangler-run';

export interface EntrantStanding {
  readonly sha256: string;
  readonly rating: number;
  readonly ratingSeq: number;
  readonly ratedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface RatingChangePlan {
  readonly sha256: string;
  readonly before: EntrantStanding;
  readonly after: Standing;
  readonly newSeq: number;
}

const SHA = /^[0-9a-f]{64}$/;
const FRESH: Standing = { rating: INITIAL_RATING, matches: 0, wins: 0, losses: 0, draws: 0 };
/** Folded ratings replay the same arithmetic in the same order; anything closer is the same number. */
const EPSILON = 1e-9;

/** The entrants whose stored standing disagrees with the fold, with their next sequence number. */
export function planRecompute(entrants: readonly EntrantStanding[], counted: readonly CountedMatch[]): RatingChangePlan[] {
  const folded = replayRatings(counted);
  const plan: RatingChangePlan[] = [];
  for (const entrant of entrants) {
    const after = folded.get(entrant.sha256) ?? FRESH;
    const changed =
      Math.abs(after.rating - entrant.rating) > EPSILON ||
      after.matches !== entrant.ratedMatches ||
      after.wins !== entrant.wins ||
      after.losses !== entrant.losses ||
      after.draws !== entrant.draws;
    if (changed) plan.push({ sha256: entrant.sha256, before: entrant, after, newSeq: entrant.ratingSeq + 1 });
  }
  return plan;
}

/** The SQL for a plan. Hashes are validated and counts proven whole before interpolation. */
export function recomputeSql(plan: readonly RatingChangePlan[]): string {
  const statements: string[] = [];
  for (const change of plan) {
    if (!SHA.test(change.sha256)) throw new Error(`refusing to write SQL for a malformed hash: ${change.sha256}`);
    const { after, before, newSeq } = change;
    for (const n of [after.matches, after.wins, after.losses, after.draws, newSeq]) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`refusing to write a non-count (${n}) for ${change.sha256}`);
    }
    if (!Number.isFinite(before.rating) || !Number.isFinite(after.rating)) throw new Error(`refusing to write a non-finite rating for ${change.sha256}`);
    statements.push(
      `UPDATE entrants SET rating = ${after.rating}, rating_seq = ${newSeq}, rated_matches = ${after.matches}, ` +
        `game_wins = ${after.wins}, game_losses = ${after.losses}, game_draws = ${after.draws} WHERE sha256 = '${change.sha256}';`,
      `INSERT INTO rating_changes (sha256, seq, match_id, rating_before, rating_after) VALUES ('${change.sha256}', ${newSeq}, NULL, ${before.rating}, ${after.rating});`,
    );
  }
  return `${statements.join('\n')}\n`;
}

const num = (row: Record<string, unknown>, field: string): number => {
  const value = row[field];
  if (typeof value !== 'number') throw new Error(`D1 row has no numeric ${field}: ${JSON.stringify(row)}`);
  return value;
};
const text = (row: Record<string, unknown>, field: string): string => {
  const value = row[field];
  if (typeof value !== 'string') throw new Error(`D1 row has no text ${field}: ${JSON.stringify(row)}`);
  return value;
};

/** Read the database, work out the plan, and (unless dry-running) apply it. Returns the plan. */
export async function applyRecompute(target: Target, dryRun: boolean): Promise<RatingChangePlan[]> {
  const entrantRows = await d1Query(
    target,
    'SELECT sha256, rating, rating_seq, rated_matches, game_wins, game_losses, game_draws FROM entrants ORDER BY sha256',
  );
  const entrants: EntrantStanding[] = entrantRows.map((row) => ({
    sha256: text(row, 'sha256'),
    rating: num(row, 'rating'),
    ratingSeq: num(row, 'rating_seq'),
    ratedMatches: num(row, 'rated_matches'),
    wins: num(row, 'game_wins'),
    losses: num(row, 'game_losses'),
    draws: num(row, 'game_draws'),
  }));
  const matchRows = await d1Query(target, "SELECT left_sha, right_sha, left_wins, right_wins, draws FROM matches WHERE status = 'counted' ORDER BY id");
  const counted: CountedMatch[] = matchRows.map((row) => ({
    left: text(row, 'left_sha'),
    right: text(row, 'right_sha'),
    leftWins: num(row, 'left_wins'),
    rightWins: num(row, 'right_wins'),
    draws: num(row, 'draws'),
  }));
  const plan = planRecompute(entrants, counted);
  console.log(`ratings:recompute: ${counted.length} counted match(es), ${entrants.length} entrant(s), ${plan.length} standing(s) to correct`);
  for (const change of plan) {
    console.log(
      `  ${change.sha256.slice(0, 12)}… rating ${change.before.rating} → ${change.after.rating}, ` +
        `matches ${change.before.ratedMatches} → ${change.after.matches}, seq ${change.before.ratingSeq} → ${change.newSeq}`,
    );
  }
  if (plan.length === 0) return plan;
  if (dryRun) {
    console.log('ratings:recompute: --dry-run, nothing written');
    return plan;
  }
  await d1ExecuteSql(target, recomputeSql(plan));
  console.log('ratings:recompute: applied');
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    await applyRecompute(parseTarget(args), args.includes('--dry-run'));
  } catch (err) {
    console.error(`ratings:recompute: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

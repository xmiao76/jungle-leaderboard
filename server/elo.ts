/**
 * Elo ratings for Arena programs. Every published program starts at 1000; one two-game match
 * is one update: K = 32 per game, against the expected score over both games.
 *   E = 1 / (1 + 10^((R_opponent − R_self) / 400))
 *   Δ = K × (points − 2E),   points = wins + draws/2  (0 … 2)
 * The opponent moves by −Δ, so ratings are conserved. Ratings are stored unrounded.
 */
export const INITIAL_RATING = 1000;
export const K_FACTOR = 32;
const GAMES_PER_MATCH = 2;

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** New ratings after one match in which the left program scored `leftPoints` of 2. */
export function rateMatch(left: number, right: number, leftPoints: number): { left: number; right: number; delta: number } {
  if (!Number.isInteger(leftPoints * 2) || leftPoints < 0 || leftPoints > GAMES_PER_MATCH) {
    throw new RangeError(`A two-game match scores 0 to 2 in half points, not ${leftPoints}`);
  }
  const delta = K_FACTOR * (leftPoints - GAMES_PER_MATCH * expectedScore(left, right));
  return { left: left + delta, right: right - delta, delta };
}

export interface CountedMatch {
  readonly left: string;
  readonly right: string;
  readonly leftWins: number;
  readonly rightWins: number;
  readonly draws: number;
}

export interface Standing {
  readonly rating: number;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

const FRESH: Standing = { rating: INITIAL_RATING, matches: 0, wins: 0, losses: 0, draws: 0 };

/** Every program's standing after folding `matches` in order (for a full recompute). */
export function replayRatings(matches: readonly CountedMatch[]): Map<string, Standing> {
  const standings = new Map<string, Standing>();
  for (const m of matches) {
    const left = standings.get(m.left) ?? FRESH;
    const right = standings.get(m.right) ?? FRESH;
    const next = rateMatch(left.rating, right.rating, m.leftWins + m.draws / 2);
    standings.set(m.left, { rating: next.left, matches: left.matches + 1, wins: left.wins + m.leftWins, losses: left.losses + m.rightWins, draws: left.draws + m.draws });
    standings.set(m.right, { rating: next.right, matches: right.matches + 1, wins: right.wins + m.rightWins, losses: right.losses + m.leftWins, draws: right.draws + m.draws });
  }
  return standings;
}

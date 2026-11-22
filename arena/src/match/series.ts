/**
 * A match between two versions is always two games.
 *
 * Game 1 plays the colours as set up; game 2 swaps them, while the same side moves
 * first in both. So each seat — each version — moves first exactly once and plays
 * each colour once. After game 2 the overall match result is shown.
 *
 * Scoring: a win is 1 point, a draw ½ each, a loss 0. A forfeit is a result (the
 * game goes to the opposing seat), so it scores as a win. A system error is no board
 * result: the match is then incomplete and has no winner.
 *
 * Pure: the app layer (`app/arena.ts`) drives the games; this module only plans and
 * scores them.
 */
import { SEATS, type Seat } from '../protocol/messages';
import { opponent, type Side } from '../referee/types';
import type { MatchResult } from './controller';

export const GAMES_PER_MATCH = 2;
export type GameNumber = 1 | 2;

export interface SeriesGame {
  readonly game: GameNumber;
  readonly sides: Readonly<Record<Seat, Side>>;
  /** The seat whose side moves first in this game. */
  readonly firstSeat: Seat;
  readonly result: MatchResult | null;
}

export interface SeriesSummary {
  readonly score: Readonly<Record<Seat, number>>;
  /** Both games ended with a board result (a forfeit counts; a system error does not). */
  readonly complete: boolean;
  readonly winner: Seat | 'draw' | null;
}

/** The colours for a game: game 1 as set up, game 2 swapped. */
export function sidesForGame(game: GameNumber, game1LeftSide: Side): Record<Seat, Side> {
  const left = game === 1 ? game1LeftSide : opponent(game1LeftSide);
  return { left, right: opponent(left) };
}

export function firstSeatFor(sides: Readonly<Record<Seat, Side>>, firstSide: Side): Seat {
  return sides.left === firstSide ? 'left' : 'right';
}

/** Both games' plans, before any is played. */
export function planSeries(game1LeftSide: Side, firstSide: Side): SeriesGame[] {
  return ([1, 2] as const).map((game) => {
    const sides = sidesForGame(game, game1LeftSide);
    return { game, sides, firstSeat: firstSeatFor(sides, firstSide), result: null };
  });
}

/** Points per seat for one game, or null when it produced no board result. */
export function gamePoints(result: MatchResult | null): Record<Seat, number> | null {
  if (!result || result.kind === 'system-error') return null;
  if (result.winnerSeat) return result.winnerSeat === 'left' ? { left: 1, right: 0 } : { left: 0, right: 1 };
  if (result.status === 'drawn') return { left: 0.5, right: 0.5 };
  return null;
}

export function summarizeSeries(games: readonly SeriesGame[]): SeriesSummary {
  const score: Record<Seat, number> = { left: 0, right: 0 };
  let complete = games.length === GAMES_PER_MATCH;
  for (const g of games) {
    const points = gamePoints(g.result);
    if (!points) {
      complete = false;
      continue;
    }
    for (const seat of SEATS) score[seat] += points[seat];
  }
  const winner = !complete ? null : score.left > score.right ? 'left' : score.right > score.left ? 'right' : 'draw';
  return { score, complete, winner };
}

/** One seat's games in the match: a forfeit counts as a win for the other seat. */
export interface SeatRecord {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

/** Wins, losses and draws per seat; a game with no board result counts for neither. */
export function seriesRecord(games: readonly SeriesGame[]): Readonly<Record<Seat, SeatRecord>> {
  const empty: SeatRecord = { wins: 0, losses: 0, draws: 0 };
  return games.reduce<Record<Seat, SeatRecord>>(
    (record, game) => {
      const points = gamePoints(game.result);
      if (!points) return record;
      const tally = (seat: Seat): SeatRecord => {
        const r = record[seat];
        if (points[seat] === 1) return { ...r, wins: r.wins + 1 };
        if (points[seat] === 0) return { ...r, losses: r.losses + 1 };
        return { ...r, draws: r.draws + 1 };
      };
      return { left: tally('left'), right: tally('right') };
    },
    { left: empty, right: empty },
  );
}

/** 1.5 → "1½", 0.5 → "½", 2 → "2". */
export function formatPoints(points: number): string {
  const whole = Math.floor(points);
  if (points - whole < 0.5) return String(whole);
  return whole ? `${whole}½` : '½';
}

const SEAT_NAME: Readonly<Record<Seat, string>> = { left: 'Left', right: 'Right' };

/** "Match: Left 2 – 0 Right · Left (Claude Jungle v3.0.0) wins the match." */
export function describeSeries(summary: SeriesSummary, names: Readonly<Record<Seat, string>>): string {
  const score = `Match: Left ${formatPoints(summary.score.left)} – ${formatPoints(summary.score.right)} Right`;
  if (!summary.complete) return `${score} · incomplete, no match result.`;
  if (summary.winner === 'draw') return `${score} · the match is drawn.`;
  const winner = summary.winner as Seat;
  return `${score} · ${SEAT_NAME[winner]} (${names[winner]}) wins the match.`;
}

/** One line per game, for the result notice and the history. */
export function describeSeriesGame(game: SeriesGame): string {
  const points = gamePoints(game.result);
  const outcome = !game.result
    ? 'not played'
    : game.result.kind === 'system-error'
      ? 'system error, no board result'
      : game.result.winnerSeat
        ? `${SEAT_NAME[game.result.winnerSeat]} won`
        : 'drawn';
  const score = points ? ` (${formatPoints(points.left)}–${formatPoints(points.right)})` : '';
  return `Game ${game.game}: Left plays ${game.sides.left}, ${SEAT_NAME[game.firstSeat]} moves first — ${outcome}${score}.`;
}

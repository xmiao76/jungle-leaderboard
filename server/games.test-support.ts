/** Complete legal games for server tests, played through the real referee. */
import { applyMove, initialSnapshot, legalMoves, type Side, type Snapshot } from '../arena/src/referee';
import type { ReportedResult } from './verify-game';

/** Deterministic xorshift32, so every random game is reproducible from its seed. */
export function rng(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
}

/** A random legal game from the opening to its end (or `cap` plies). */
export function randomGame(seed: number, firstSide: Side, cap = 3_000): { moves: [number, number][]; trail: Snapshot[] } {
  const next = rng(seed);
  let s = initialSnapshot(firstSide);
  const trail: Snapshot[] = [];
  const moves: [number, number][] = [];
  while (s.status === 'playing' && moves.length < cap) {
    const legal = legalMoves(s);
    const m = legal[Math.floor(next() * legal.length)]!;
    s = applyMove(s, m);
    trail.push(s);
    moves.push([m.src, m.dst]);
  }
  return { moves, trail };
}

export const resultOf = (s: Snapshot): ReportedResult => ({ status: s.status as ReportedResult['status'], winner: s.winner, reason: s.reason });

/** A finished game as a report carries it. */
export function finishedGame(seed: number, firstSide: Side): { moves: [number, number][]; result: ReportedResult } {
  const { moves, trail } = randomGame(seed, firstSide);
  return { moves, result: resultOf(trail.at(-1)!) };
}

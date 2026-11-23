/**
 * Lean re-check of one reported game, cheap enough for a Pages Function on Workers Free
 * (10 ms of CPU per request): it replays the moves from the opening on one mutable board.
 *
 * It must decide exactly what the referee (`arena/src/referee/apply.ts`) decides; the
 * differential test in verify-game.test.ts holds it to that on hundreds of random games.
 * - Every ply is checked for legality against the mover's full legal list.
 * - Before the last ply, a game that has ended (den, elimination, repetition, no-capture) is
 *   rejected. Immobilization needs no check there: if the defender had no legal move, the next
 *   ply — the defender's — fails the legality check.
 * - The last ply gets the full adjudication, in the profile's order.
 * - Repetition counts positions (board + side to move) since the last capture, the starting
 *   position included, as `positionOccurrences` does for a game played from the opening.
 * - A forfeit cannot be proven from moves; it is accepted only for the side to move, in a game
 *   that has not ended (the caller decides what a forfeit may count for).
 */
import { legalMovesFor } from '../arena/src/referee/movegen';
import { BOARD_SIZE, DEN, NO_CAPTURE_LIMIT, REPETITION_LIMIT } from '../arena/src/referee/profile';
import { initialSnapshot } from '../arena/src/referee/snapshot';
import { ANIMALS, opponent, type Phase, type Piece, type Reason, type Side } from '../arena/src/referee/types';

/** The longest legal game is about 1,500 plies (15 captures, each after up to 99 quiet plies). */
export const MAX_PLIES = 1_600;
const FORFEIT_REASONS: ReadonlySet<string> = new Set(['timeout', 'trap', 'invalid-move']);

export interface ReportedResult {
  readonly status: 'won' | 'drawn' | 'forfeited';
  readonly winner: Side | null;
  readonly reason: string;
}

export interface PlyOutcome {
  readonly status: Phase;
  readonly winner: Side | null;
  readonly reason: Reason;
}

export type Verification = { readonly ok: true; readonly plies: number } | { readonly ok: false; readonly reason: string };

type Move = readonly [number, number];

interface Walk {
  readonly board: (Piece | null)[];
  toPlay: Side;
  quiet: number;
  readonly seen: Map<string, number>;
}

const PLAYING: PlyOutcome = { status: 'playing', winner: null, reason: '' };
const won = (winner: Side, reason: Reason): PlyOutcome => ({ status: 'won', winner, reason });
const drawn = (reason: Reason): PlyOutcome => ({ status: 'drawn', winner: null, reason });

/** One character per square (a–p for pieces, '.' for empty) plus the side to move. */
function positionKey(board: readonly (Piece | null)[], toPlay: Side): string {
  let key = toPlay === 'red' ? 'r' : 'b';
  for (let square = 0; square < BOARD_SIZE; square += 1) {
    const piece = board[square];
    key += piece ? String.fromCharCode(97 + (piece.owner === 'red' ? 0 : 8) + ANIMALS.indexOf(piece.kind)) : '.';
  }
  return key;
}

function start(firstSide: Side): Walk {
  const board = [...initialSnapshot(firstSide).board];
  return { board, toPlay: firstSide, quiet: 0, seen: new Map([[positionKey(board, firstSide), 1]]) };
}

const isSquare = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < BOARD_SIZE;

function isLegalNow(walk: Walk, [src, dst]: Move): boolean {
  return legalMovesFor(walk.board, walk.toPlay).some((m) => m.src === src && m.dst === dst);
}

/** Commit a legal move; returns who moved, where, and how often the new position has occurred. */
function step(walk: Walk, [src, dst]: Move): { mover: Side; dst: number; occurrences: number } {
  const mover = walk.toPlay;
  const captured = walk.board[dst] !== null;
  walk.board[dst] = walk.board[src]!;
  walk.board[src] = null;
  walk.quiet = captured ? 0 : walk.quiet + 1;
  walk.toPlay = opponent(mover);
  // Positions before a capture can never recur: fewer pieces remain.
  if (captured) walk.seen.clear();
  const key = positionKey(walk.board, walk.toPlay);
  const occurrences = (walk.seen.get(key) ?? 0) + 1;
  walk.seen.set(key, occurrences);
  return { mover, dst, occurrences };
}

/** Full adjudication of the position just reached, in the profile's order. */
function adjudicate(walk: Walk, mover: Side, dst: number, occurrences: number): PlyOutcome {
  const defender = opponent(mover);
  if (dst === DEN[defender]) return won(mover, 'den');
  if (!walk.board.some((p) => p?.owner === defender)) return won(mover, 'elimination');
  if (legalMovesFor(walk.board, defender).length === 0) return won(mover, 'immobilization');
  if (occurrences >= REPETITION_LIMIT) return drawn('repetition');
  if (walk.quiet >= NO_CAPTURE_LIMIT) return drawn('no-capture');
  return PLAYING;
}

/** Every ending except immobilization, which the next legal ply disproves. */
function endedCheaply(walk: Walk, mover: Side, dst: number, occurrences: number): boolean {
  const defender = opponent(mover);
  return dst === DEN[defender] || !walk.board.some((p) => p?.owner === defender) || occurrences >= REPETITION_LIMIT || walk.quiet >= NO_CAPTURE_LIMIT;
}

/** The referee's verdict after every ply, fully adjudicated: the definition the lean path must match. */
export function adjudicateEachPly(firstSide: Side, moves: readonly Move[]): PlyOutcome[] | { illegalAt: number } {
  const walk = start(firstSide);
  const outcomes: PlyOutcome[] = [];
  for (const [i, move] of moves.entries()) {
    if (!isLegalNow(walk, move)) return { illegalAt: i + 1 };
    const { mover, dst, occurrences } = step(walk, move);
    outcomes.push(adjudicate(walk, mover, dst, occurrences));
  }
  return outcomes;
}

const fail = (reason: string): Verification => ({ ok: false, reason });
const describe = (o: PlyOutcome) => (o.status === 'won' ? `in a ${o.winner} win by ${o.reason}` : `in a draw by ${o.reason}`);

/** Does `moves`, played from the opening with `firstSide` to move, end exactly as `reported`? */
export function verifyGame(firstSide: Side, moves: readonly Move[], reported: ReportedResult): Verification {
  if (moves.length > MAX_PLIES) return fail(`a game has at most ${MAX_PLIES} plies`);
  const walk = start(firstSide);
  let outcome = PLAYING;
  for (const [i, move] of moves.entries()) {
    const [src, dst] = move;
    if (!isSquare(src) || !isSquare(dst)) return fail(`ply ${i + 1} is not a pair of squares`);
    if (!isLegalNow(walk, move)) return fail(`ply ${i + 1} (${src} → ${dst}) is not a legal move`);
    const ply = step(walk, move);
    if (i === moves.length - 1) outcome = adjudicate(walk, ply.mover, ply.dst, ply.occurrences);
    else if (endedCheaply(walk, ply.mover, ply.dst, ply.occurrences)) return fail(`the game was already over after ply ${i + 1}`);
  }

  if (reported.status === 'forfeited') {
    if (outcome.status !== 'playing') return fail(`a game that ended ${describe(outcome)} cannot be forfeited`);
    if (!FORFEIT_REASONS.has(reported.reason)) return fail(`"${reported.reason}" is not a forfeit reason`);
    if (reported.winner !== opponent(walk.toPlay)) return fail('only the side to move can forfeit');
    return { ok: true, plies: moves.length };
  }
  if (outcome.status === 'playing') return fail('the game had not ended');
  if (outcome.status !== reported.status || outcome.winner !== reported.winner || outcome.reason !== reported.reason) {
    return fail(`the game ended ${describe(outcome)}, not as reported`);
  }
  return { ok: true, plies: moves.length };
}

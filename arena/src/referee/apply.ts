import { isLegal, legalMovesFor } from './movegen';
import { DEN, NO_CAPTURE_LIMIT, REPETITION_LIMIT } from './profile';
import { positionOccurrences } from './repetition';
import { opponent, type Board, type ForfeitReason, type PlyMove, type Side, type Snapshot } from './types';

export class IllegalMoveError extends Error {
  override readonly name = 'IllegalMoveError';
}

interface Outcome {
  readonly status: Snapshot['status'];
  readonly winner: Side | null;
  readonly reason: Snapshot['reason'];
}

const PLAYING: Outcome = { status: 'playing', winner: null, reason: '' };

/** Terminal checks in the profile's order: den, elimination, immobilization, repetition, no-capture. */
function adjudicate(board: Board, mover: Side, dst: number, noCapturePlies: number, occurrences: number): Outcome {
  const defender = opponent(mover);
  if (dst === DEN[defender]) return { status: 'won', winner: mover, reason: 'den' };
  if (!board.some((piece) => piece?.owner === defender)) {
    return { status: 'won', winner: mover, reason: 'elimination' };
  }
  if (legalMovesFor(board, defender).length === 0) {
    return { status: 'won', winner: mover, reason: 'immobilization' };
  }
  if (occurrences >= REPETITION_LIMIT) return { status: 'drawn', winner: null, reason: 'repetition' };
  if (noCapturePlies >= NO_CAPTURE_LIMIT) return { status: 'drawn', winner: null, reason: 'no-capture' };
  return PLAYING;
}

/**
 * Commit one legal move and return the next snapshot. Never mutates `snapshot`.
 * `to-play` passes to the opponent even when the move ends the game.
 */
export function applyMove(snapshot: Snapshot, move: PlyMove): Snapshot {
  if (snapshot.status !== 'playing') {
    throw new IllegalMoveError(`Game is already ${snapshot.status}`);
  }
  if (!isLegal(snapshot, move)) {
    throw new IllegalMoveError(`${move.src} → ${move.dst} is not legal for ${snapshot.toPlay} at rev ${snapshot.rev}`);
  }

  const captured = snapshot.board[move.dst] ?? null;
  const board = snapshot.board.map((piece, square) => {
    if (square === move.src) return null;
    if (square === move.dst) return snapshot.board[move.src] ?? null;
    return piece;
  });
  const noCapturePlies = captured ? 0 : snapshot.noCapturePlies + 1;
  const history = [...snapshot.history, { src: move.src, dst: move.dst }];
  const outcome = adjudicate(board, snapshot.toPlay, move.dst, noCapturePlies, positionOccurrences(board, history, noCapturePlies));

  return {
    ...snapshot,
    rev: snapshot.rev + 1,
    board,
    toPlay: opponent(snapshot.toPlay),
    history,
    noCapturePlies,
    ...outcome,
  };
}

/**
 * Award the game to the opposing seat. Board, turn, counters and history stay as they
 * were; only the revision advances.
 */
export function forfeit(snapshot: Snapshot, loser: Side, reason: ForfeitReason): Snapshot {
  if (snapshot.status !== 'playing') {
    throw new IllegalMoveError(`Cannot forfeit a game that is already ${snapshot.status}`);
  }
  return {
    ...snapshot,
    rev: snapshot.rev + 1,
    status: 'forfeited',
    winner: opponent(loser),
    reason,
  };
}

/**
 * Repetition counting for the `desktop-jungle-v2` draw rule: a position is the 63 squares plus
 * the side to move, and a committed move that produces a position for the third time draws.
 *
 * No extra state is kept. A capture can never be undone, so only positions since the last
 * capture can repeat, and every move since then only relocated one piece. Stepping those moves
 * back from the current board reproduces each earlier position exactly; the quiet counter says
 * how many there are (a synthetic start may carry a counter larger than its history).
 */
import type { Board, Piece, PlyMove } from './types';

const samePiece = (a: Piece | null | undefined, b: Piece | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && a.owner === b.owner && a.kind === b.kind);

function sameBoard(a: Board, b: Board): boolean {
  return a.every((piece, square) => samePiece(piece, b[square]));
}

/** Undo one non-capturing move: the piece on `dst` goes back to `src`. */
function undo(board: Board, { src, dst }: PlyMove): Board {
  return board.map((piece, square) => (square === src ? (board[dst] ?? null) : square === dst ? null : piece));
}

/** How many times the current position has occurred in the game, this occurrence included. */
export function positionOccurrences(board: Board, history: readonly PlyMove[], noCapturePlies: number): number {
  const reversible = Math.min(noCapturePlies, history.length);
  let earlier = board;
  let count = 1;
  for (let back = 1; back <= reversible; back += 1) {
    earlier = undo(earlier, history[history.length - back]!);
    // Only an even number of plies back has the same side to move.
    if (back % 2 === 0 && sameBoard(earlier, board)) count += 1;
  }
  return count;
}

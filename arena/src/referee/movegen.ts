import { BOARD_SIZE, COLS, DEN, isWater, jumpLengths, rankOf, ROWS, TRAPS } from './profile';
import { opponent, type Board, type Piece, type PlyMove, type Side, type Snapshot } from './types';

/** Orthogonal directions as [rowDelta, colDelta]. */
const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

function neighbour(square: number, dRow: number, dCol: number): number | null {
  const row = Math.floor(square / COLS) + dRow;
  const col = (square % COLS) + dCol;
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return row * COLS + col;
}

/** A piece standing on a trap owned by its opponent has effective rank zero. */
function isTrapped(piece: Piece, square: number): boolean {
  return TRAPS[opponent(piece.owner)].has(square);
}

/**
 * Whether the piece on `from` may capture the piece on `to`, using pre-move squares.
 * The caller guarantees both squares hold opposing pieces.
 */
function canCapture(attacker: Piece, from: number, defender: Piece, to: number): boolean {
  // Captures never cross a water/land boundary, in either direction.
  if (isWater(from) !== isWater(to)) return false;
  // Only rats reach water, so water-to-water is always rat takes rat.
  if (isWater(from)) return true;

  if (isTrapped(defender, to)) return true;
  const attackerTrapped = isTrapped(attacker, from);
  if (attackerTrapped) return false; // rank zero against an untrapped defender

  if (attacker.kind === 'rat' && defender.kind === 'elephant') return true;
  if (attacker.kind === 'elephant' && defender.kind === 'rat') return false;
  return rankOf(attacker.kind) >= rankOf(defender.kind);
}

function canEnter(board: Board, piece: Piece, from: number, to: number): boolean {
  if (to === DEN[piece.owner]) return false;
  const occupant = board[to];
  if (!occupant) return true;
  if (occupant.owner === piece.owner) return false;
  return canCapture(piece, from, occupant, to);
}

/** The landing square of a river jump from `from`, or null if no jump is possible. */
function jumpLanding(board: Board, piece: Piece, from: number, dRow: number, dCol: number): number | null {
  const lengths = jumpLengths(piece.kind);
  if (lengths.length === 0 || isWater(from)) return null;

  let square = neighbour(from, dRow, dCol);
  let crossed = 0;
  while (square !== null && isWater(square)) {
    if (board[square]?.kind === 'rat') return null; // any rat on traversed water blocks
    crossed += 1;
    square = neighbour(square, dRow, dCol);
  }
  if (square === null || crossed === 0 || !lengths.includes(crossed)) return null;
  return square;
}

function movesFrom(board: Board, from: number, piece: Piece): PlyMove[] {
  const moves: PlyMove[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    const step = neighbour(from, dRow, dCol);
    if (step === null) continue;

    if (isWater(step) && piece.kind !== 'rat') {
      const landing = jumpLanding(board, piece, from, dRow, dCol);
      if (landing !== null && canEnter(board, piece, from, landing)) moves.push({ src: from, dst: landing });
      continue;
    }
    if (canEnter(board, piece, from, step)) moves.push({ src: from, dst: step });
  }
  return moves;
}

/** All legal moves for `side` on `board`, sorted numerically by (src, dst). */
export function legalMovesFor(board: Board, side: Side): PlyMove[] {
  const moves: PlyMove[] = [];
  for (let square = 0; square < BOARD_SIZE; square += 1) {
    const piece = board[square];
    if (piece && piece.owner === side) moves.push(...movesFrom(board, square, piece));
  }
  return moves.sort((a, b) => a.src - b.src || a.dst - b.dst);
}

/** The contractual legal list for the side to play; empty once the game has ended. */
export function legalMoves(snapshot: Snapshot): PlyMove[] {
  if (snapshot.status !== 'playing') return [];
  return legalMovesFor(snapshot.board, snapshot.toPlay);
}

export function isLegal(snapshot: Snapshot, move: PlyMove): boolean {
  return legalMoves(snapshot).some((m) => m.src === move.src && m.dst === move.dst);
}

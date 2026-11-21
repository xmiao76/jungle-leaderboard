import { BOARD_SIZE, isOnBoard, OPENING } from './profile';
import { ANIMALS, SIDES, type Animal, type Piece, type Side, type Snapshot } from './types';

/** The untouched opening. Choosing Blue first changes only who moves first. */
export function initialSnapshot(firstSide: Side): Snapshot {
  const board: (Piece | null)[] = Array.from({ length: BOARD_SIZE }, () => null);
  for (const side of SIDES) {
    OPENING[side].forEach((square, rank) => {
      board[square] = { owner: side, kind: ANIMALS[rank]! };
    });
  }
  return {
    rev: 0,
    board,
    firstSide,
    toPlay: firstSide,
    history: [],
    noCapturePlies: 0,
    status: 'playing',
    winner: null,
    reason: '',
  };
}

/** Parse a fixture cell such as `red:cat`. */
export function parsePiece(text: string): Piece {
  const [owner, kind] = text.split(':');
  if (!SIDES.includes(owner as Side) || !ANIMALS.includes(kind as Animal)) {
    throw new Error(`Not a piece: ${JSON.stringify(text)}`);
  }
  return { owner: owner as Side, kind: kind as Animal };
}

interface SparseOptions {
  readonly toPlay: Side;
  readonly firstSide?: Side;
  readonly noCapturePlies?: number;
}

/**
 * Build a synthetic live position from a `{ "square": "side:animal" }` map, the shape
 * the portable conformance cases use. Terrain is always canonical.
 */
export function sparseSnapshot(cells: Readonly<Record<string, string>>, options: SparseOptions): Snapshot {
  const board: (Piece | null)[] = Array.from({ length: BOARD_SIZE }, () => null);
  for (const [key, value] of Object.entries(cells)) {
    const square = Number(key);
    if (!isOnBoard(square)) throw new Error(`Square out of range: ${key}`);
    board[square] = parsePiece(value);
  }
  return {
    rev: 0,
    board,
    firstSide: options.firstSide ?? options.toPlay,
    toPlay: options.toPlay,
    history: [],
    noCapturePlies: options.noCapturePlies ?? 0,
    status: 'playing',
    winner: null,
    reason: '',
  };
}

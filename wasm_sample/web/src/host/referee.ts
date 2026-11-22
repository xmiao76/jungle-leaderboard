/**
 * The conformance host's referee: an independent TypeScript implementation of the
 * desktop-jungle-v2 rulebook (it shares no code with the Rust core it is checking).
 * Works directly on jco-shaped snapshots: empty squares and "no winner" are undefined.
 */

export type Side = 'red' | 'blue';
export type Kind = 'rat' | 'cat' | 'dog' | 'wolf' | 'leopard' | 'tiger' | 'lion' | 'elephant';
export interface Piece {
  owner: Side;
  kind: Kind;
}
export interface Ply {
  src: number;
  dst: number;
}
export interface State {
  rev: number;
  board: (Piece | undefined)[];
  firstSide: Side;
  toPlay: Side;
  history: Ply[];
  noCapturePlies: number;
  status: 'playing' | 'won' | 'drawn' | 'forfeited';
  winner: Side | undefined;
  reason: string;
}

const KINDS: Kind[] = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'];
const WATER = new Set([22, 23, 25, 26, 29, 30, 32, 33, 36, 37, 39, 40]);
const DENS: Record<Side, number> = { red: 59, blue: 3 };
const TRAPS: Record<Side, Set<number>> = { red: new Set([52, 58, 60]), blue: new Set([2, 4, 10]) };
const START: Record<Side, number[]> = { red: [48, 50, 54, 44, 46, 56, 62, 42], blue: [14, 12, 8, 18, 16, 6, 0, 20] };

const other = (side: Side): Side => (side === 'red' ? 'blue' : 'red');
const rankOf = (kind: Kind) => KINDS.indexOf(kind) + 1;
const at = (row: number, col: number) => (row >= 0 && row < 9 && col >= 0 && col < 7 ? row * 7 + col : -1);

export function openingState(firstSide: Side): State {
  const board: (Piece | undefined)[] = new Array(63).fill(undefined);
  (['red', 'blue'] as const).forEach((owner) => START[owner].forEach((sq, i) => (board[sq] = { owner, kind: KINDS[i]! })));
  return { rev: 0, board, firstSide, toPlay: firstSide, history: [], noCapturePlies: 0, status: 'playing', winner: undefined, reason: '' };
}

/** Effective rank on `square`: zero inside the opponent's trap. */
function effective(piece: Piece, square: number): number {
  return TRAPS[other(piece.owner)].has(square) ? 0 : rankOf(piece.kind);
}

function captures(attacker: Piece, from: number, defender: Piece, to: number): boolean {
  const fromWater = WATER.has(from);
  if (fromWater !== WATER.has(to)) return false;
  if (fromWater) return attacker.kind === 'rat' && defender.kind === 'rat';
  const a = effective(attacker, from);
  const d = effective(defender, to);
  if (d === 0) return true;
  if (a === 0) return false;
  if (attacker.kind === 'rat' && defender.kind === 'elephant') return true;
  if (attacker.kind === 'elephant' && defender.kind === 'rat') return false;
  return a >= d;
}

function destination(board: State['board'], piece: Piece, from: number, dr: number, dc: number): number {
  const [r, c] = [Math.floor(from / 7), from % 7];
  const next = at(r + dr, c + dc);
  if (next < 0) return -1;
  if (!WATER.has(next) || piece.kind === 'rat') return next;
  if (piece.kind !== 'lion' && piece.kind !== 'tiger') return -1;
  let steps = 0;
  let row = r + dr;
  let col = c + dc;
  while (at(row, col) >= 0 && WATER.has(at(row, col))) {
    if (board[at(row, col)]?.kind === 'rat') return -1;
    steps += 1;
    row += dr;
    col += dc;
  }
  const landing = at(row, col);
  const ok = piece.kind === 'lion' ? steps === 2 || steps === 3 : steps === 2;
  return ok ? landing : -1;
}

export function movesFor(board: State['board'], side: Side): Ply[] {
  const out: Ply[] = [];
  board.forEach((piece, src) => {
    if (!piece || piece.owner !== side) return;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const dst = destination(board, piece, src, dr, dc);
      if (dst < 0 || dst === DENS[side]) continue;
      const target = board[dst];
      if (target && (target.owner === side || !captures(piece, src, target, dst))) continue;
      out.push({ src, dst });
    }
  });
  return out.sort((a, b) => a.src - b.src || a.dst - b.dst);
}

export function legalMoves(state: State): Ply[] {
  return state.status === 'playing' ? movesFor(state.board, state.toPlay) : [];
}

export function apply(state: State, ply: Ply): State {
  if (!legalMoves(state).some((m) => m.src === ply.src && m.dst === ply.dst)) throw new Error(`illegal ${ply.src}→${ply.dst}`);
  const board = state.board.slice();
  const captured = board[ply.dst] !== undefined;
  board[ply.dst] = board[ply.src];
  board[ply.src] = undefined;
  const mover = state.toPlay;
  const foe = other(mover);
  const quiet = captured ? 0 : state.noCapturePlies + 1;
  const history = [...state.history, { ...ply }];
  let status: State['status'] = 'playing';
  let winner: Side | undefined;
  let reason = '';
  if (ply.dst === DENS[foe]) [status, winner, reason] = ['won', mover, 'den'];
  else if (!board.some((p) => p?.owner === foe)) [status, winner, reason] = ['won', mover, 'elimination'];
  else if (movesFor(board, foe).length === 0) [status, winner, reason] = ['won', mover, 'immobilization'];
  else if (timesSeen(board, history, quiet) >= 3) [status, winner, reason] = ['drawn', undefined, 'repetition'];
  else if (quiet >= 100) [status, winner, reason] = ['drawn', undefined, 'no-capture'];
  return { ...state, rev: state.rev + 1, board, toPlay: foe, history, noCapturePlies: quiet, status, winner, reason };
}

/**
 * How often `board` (with the side to move after `history`) has occurred: walk the quiet moves
 * since the last capture backwards, moving each piece home again, and compare every second
 * board (the same side to move).
 */
function timesSeen(board: (Piece | undefined)[], history: Ply[], quiet: number): number {
  const same = (a: Piece | undefined, b: Piece | undefined) => a?.owner === b?.owner && a?.kind === b?.kind;
  let count = 1;
  let earlier = board;
  const steps = Math.min(quiet, history.length);
  for (let back = 1; back <= steps; back += 1) {
    const { src, dst } = history[history.length - back]!;
    const prior = earlier.slice();
    prior[src] = prior[dst];
    prior[dst] = undefined;
    earlier = prior;
    if (back % 2 === 0 && earlier.every((p, i) => same(p, board[i]))) count += 1;
  }
  return count;
}

export function forfeit(state: State, loser: Side, reason: 'timeout' | 'trap' | 'invalid-move'): State {
  return { ...state, rev: state.rev + 1, status: 'forfeited', winner: other(loser), reason };
}

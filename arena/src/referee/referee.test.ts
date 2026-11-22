import { describe, expect, it } from 'vitest';
import adjudication from '../../../sdk/fixtures/adjudication.json';
import moveCases from '../../../sdk/fixtures/moves.json';
import opening from '../../../sdk/fixtures/opening.json';
import {
  applyMove,
  BOARD_SIZE,
  forfeit,
  IllegalMoveError,
  initialSnapshot,
  isLegal,
  legalMoves,
  positionOccurrences,
  sparseSnapshot,
} from './index';
import type { PlyMove, Snapshot } from './types';

const move = ([src, dst]: readonly number[]): PlyMove => ({ src: src!, dst: dst! });
/** JSON fixture rows infer a union of optional keys; every present key maps to a string. */
const board = (cells: object) => cells as Readonly<Record<string, string>>;
const pairs = (moves: readonly PlyMove[]) => moves.map((m) => [m.src, m.dst]);

describe('portable conformance cases', () => {
  it.each(moveCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const snapshot = sparseSnapshot(board(c.board), { toPlay: 'red' });
    expect(isLegal(snapshot, move(c.move))).toBe(c.legal);
    expect(legalMoves(snapshot).some((m) => m.src === c.move[0] && m.dst === c.move[1])).toBe(c.legal);
  });
});

describe('opening handshake', () => {
  it('gives each side 24 legal moves from the untouched opening', () => {
    expect(legalMoves(initialSnapshot('red'))).toHaveLength(opening.legalCountPerSide);
    expect(legalMoves(initialSnapshot('blue'))).toHaveLength(opening.legalCountPerSide);
  });

  it('sorts the red-first list numerically by (src, dst)', () => {
    const legal = pairs(legalMoves(initialSnapshot('red')));
    expect(legal[0]).toEqual(opening.redFirst.index0);
    expect(legal[23]).toEqual(opening.redFirst.index23);
    const sorted = [...legal].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(legal).toEqual(sorted);
  });

  it('starts the blue-first list at 0 → 1', () => {
    expect(pairs(legalMoves(initialSnapshot('blue')))[0]).toEqual(opening.blueFirst.index0);
  });

  it('produces the documented revision-1 snapshot after red plays index 0', () => {
    const start = initialSnapshot('red');
    const next = applyMove(start, legalMoves(start)[0]!);
    const expected = opening.afterRedIndex0;
    expect(next.rev).toBe(expected.rev);
    for (const sq of expected.emptySquares) expect(next.board[sq]).toBeNull();
    expect(next.board[35]).toEqual({ owner: 'red', kind: 'elephant' });
    expect(next.noCapturePlies).toBe(expected.noCapturePlies);
    expect(pairs(next.history)).toEqual(expected.history);
    expect(next.toPlay).toBe(expected.toPlay);
    expect(next.status).toBe(expected.status);
    expect(next.winner).toBeNull();
    expect(next.reason).toBe('');
  });

  it('starts at revision 0 with an empty history and zero counters', () => {
    const start = initialSnapshot('blue');
    expect(start.rev).toBe(0);
    expect(start.history).toEqual([]);
    expect(start.noCapturePlies).toBe(0);
    expect(start.firstSide).toBe('blue');
    expect(start.toPlay).toBe('blue');
    expect(start.board).toHaveLength(BOARD_SIZE);
    expect(start.board[48]).toEqual({ owner: 'red', kind: 'rat' });
    expect(start.board[42]).toEqual({ owner: 'red', kind: 'elephant' });
    expect(start.board[14]).toEqual({ owner: 'blue', kind: 'rat' });
    expect(start.board[20]).toEqual({ owner: 'blue', kind: 'elephant' });
  });
});

describe('adjudication', () => {
  // A row commits one `move`, or several `moves` in order, Red first, alternating sides.
  const plies = (c: { move?: readonly number[]; moves?: readonly (readonly number[])[] }) => (c.moves ?? [c.move!]).map(move);

  it.each(adjudication.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const before = sparseSnapshot(board(c.board), { toPlay: 'red', noCapturePlies: c.quietBefore });
    const sequence = plies(c);
    const after = sequence.reduce(applyMove, before);
    expect(after.noCapturePlies).toBe(c.quietAfter);
    expect(after.status).toBe(c.status);
    expect(after.winner).toBe(c.winner);
    expect(after.reason).toBe(c.reason);
    expect(after.rev).toBe(before.rev + sequence.length);
    expect(after.history).toHaveLength(before.history.length + sequence.length);
    const last = sequence.at(-1)!;
    expect(after.board[last.dst]).not.toBeNull();
    expect(after.board[last.src]).toBeNull();
    // to-play flips on every committed legal move, terminal ones included.
    expect(after.toPlay).toBe(sequence.length % 2 === 1 ? 'blue' : 'red');
  });
});

describe('repetition', () => {
  const LOOP = [move([42, 43]), move([6, 5]), move([43, 42]), move([5, 6])];
  const start = (noCapturePlies = 0) => sparseSnapshot({ '42': 'red:cat', '6': 'blue:dog' }, { toPlay: 'red', noCapturePlies });

  it('counts how often the current position has occurred, from the history alone', () => {
    const counts = [...LOOP, ...LOOP].reduce<{ s: Snapshot; seen: number[] }>(
      ({ s, seen }, m) => {
        const next = applyMove(s, m);
        return { s: next, seen: [...seen, positionOccurrences(next.board, next.history, next.noCapturePlies)] };
      },
      { s: start(), seen: [] },
    ).seen;
    // The start position (Red to move) recurs after plies 4 and 8; the others after ply 4 + their own.
    expect(counts).toEqual([1, 1, 1, 2, 2, 2, 2, 3]);
  });

  it('draws at the third occurrence, ahead of the no-capture limit', () => {
    const drawn = [...LOOP, ...LOOP].reduce(applyMove, start(92));
    expect(drawn).toMatchObject({ status: 'drawn', winner: null, reason: 'repetition', noCapturePlies: 100, rev: 8, toPlay: 'red' });
  });

  it('never counts positions from before a capture', () => {
    // Red's wolf takes Blue's cat, then both sides shuffle: the capture starts a new count.
    const s0 = sparseSnapshot({ '42': 'red:wolf', '43': 'blue:cat', '6': 'blue:dog' }, { toPlay: 'red' });
    const afterCapture = applyMove(s0, move([42, 43]));
    expect(afterCapture.noCapturePlies).toBe(0);
    expect(positionOccurrences(afterCapture.board, afterCapture.history, afterCapture.noCapturePlies)).toBe(1);
  });

  it('only matches positions with the same side to move', () => {
    // After 42→43, 6→5, 43→42 the board equals no earlier board with Blue to move.
    const s = [LOOP[0]!, LOOP[1]!, LOOP[2]!].reduce(applyMove, start());
    expect(positionOccurrences(s.board, s.history, s.noCapturePlies)).toBe(1);
  });

  it('plays on from the opening: a full game never repeats without both sides shuffling', () => {
    const s = applyMove(initialSnapshot('red'), legalMoves(initialSnapshot('red'))[0]!);
    expect(positionOccurrences(s.board, s.history, s.noCapturePlies)).toBe(1);
  });
});

describe('applyMove', () => {
  it('never mutates its input snapshot', () => {
    const start = initialSnapshot('red');
    const frozen = JSON.stringify(start);
    applyMove(start, legalMoves(start)[0]!);
    expect(JSON.stringify(start)).toBe(frozen);
  });

  it('rejects a move that is not in the legal list', () => {
    // Two squares in one step; the opponent's piece out of turn; an empty source square.
    expect(() => applyMove(initialSnapshot('red'), { src: 42, dst: 44 })).toThrow(IllegalMoveError);
    expect(() => applyMove(initialSnapshot('red'), { src: 14, dst: 15 })).toThrow(IllegalMoveError);
    expect(() => applyMove(initialSnapshot('red'), { src: 43, dst: 36 })).toThrow(IllegalMoveError);
  });

  it('rejects any move once the game is over', () => {
    const won = applyMove(sparseSnapshot({ 2: 'red:cat', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 2, dst: 3 });
    expect(won.status).toBe('won');
    expect(legalMoves(won)).toEqual([]);
    expect(() => applyMove(won, { src: 0, dst: 1 })).toThrow(IllegalMoveError);
  });

  it('removes a captured piece', () => {
    const s = sparseSnapshot({ 42: 'red:wolf', 43: 'blue:cat', 6: 'blue:dog' }, { toPlay: 'red' });
    const after = applyMove(s, { src: 42, dst: 43 });
    expect(after.board.filter(Boolean)).toHaveLength(2);
  });
});

describe('forfeit', () => {
  const live: Snapshot = applyMove(initialSnapshot('red'), { src: 42, dst: 35 });

  it('awards the game to the opposing seat and bumps the revision once', () => {
    const f = forfeit(live, 'blue', 'timeout');
    expect(f.status).toBe('forfeited');
    expect(f.winner).toBe('red');
    expect(f.reason).toBe('timeout');
    expect(f.rev).toBe(live.rev + 1);
  });

  it('keeps the last board, turn, counters and history', () => {
    const f = forfeit(live, 'blue', 'invalid-move');
    expect(f.board).toEqual(live.board);
    expect(f.toPlay).toBe(live.toPlay);
    expect(f.noCapturePlies).toBe(live.noCapturePlies);
    expect(f.history).toEqual(live.history);
  });

  it('refuses to forfeit a finished game', () => {
    const f = forfeit(live, 'red', 'trap');
    expect(() => forfeit(f, 'blue', 'trap')).toThrow(IllegalMoveError);
  });
});

describe('rules beyond the portable table', () => {
  it('applies the same jump lengths in reverse and on the other river', () => {
    // Reverse long jump 43 → 15, and a short jump across the right river 27 → 24.
    expect(isLegal(sparseSnapshot({ 43: 'red:lion', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 43, dst: 15 })).toBe(true);
    expect(isLegal(sparseSnapshot({ 27: 'red:tiger', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 27, dst: 24 })).toBe(true);
    expect(isLegal(sparseSnapshot({ 19: 'red:tiger', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 19, dst: 47 })).toBe(false);
    expect(isLegal(sparseSnapshot({ 19: 'red:lion', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 19, dst: 47 })).toBe(true);
  });

  it('never wraps a step across a row boundary', () => {
    // Red dog on 7 (row 1, col 0): 6 is the end of row 0, not a neighbour.
    const s = sparseSnapshot({ 7: 'red:dog', 0: 'blue:rat' }, { toPlay: 'red' });
    expect(isLegal(s, { src: 7, dst: 6 })).toBe(false);
    expect(legalMoves(s).map((m) => m.dst)).toEqual([0, 8, 14]);
  });

  it('lets any attacker take a defender standing on an opponent-owned trap', () => {
    // 4 is a blue trap, so the red elephant there has rank zero.
    const s = sparseSnapshot({ 4: 'red:elephant', 11: 'blue:cat', 5: 'blue:rat', 62: 'red:rat' }, { toPlay: 'blue' });
    expect(isLegal(s, { src: 11, dst: 4 })).toBe(true);
    expect(isLegal(s, { src: 5, dst: 4 })).toBe(true);
    const untrapped = sparseSnapshot({ 12: 'red:elephant', 11: 'blue:cat', 62: 'red:rat' }, { toPlay: 'blue' });
    expect(isLegal(untrapped, { src: 11, dst: 12 })).toBe(false);
  });

  it('does not reduce the rank of a piece on its own side’s trap', () => {
    // 52 is a red trap; the red cat on it keeps rank 2 against blue attackers.
    const s = sparseSnapshot({ 52: 'red:cat', 45: 'blue:rat', 0: 'red:dog' }, { toPlay: 'blue' });
    expect(isLegal(s, { src: 45, dst: 52 })).toBe(false);
    const attack = sparseSnapshot({ 52: 'red:cat', 45: 'blue:dog', 0: 'blue:rat' }, { toPlay: 'red' });
    expect(isLegal(attack, { src: 52, dst: 45 })).toBe(false);
  });
});

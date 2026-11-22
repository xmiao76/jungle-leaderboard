import { describe, expect, it } from 'vitest';
import adjudication from '../../../spec/fixtures/adjudication.json';
import moves from '../../../spec/fixtures/moves.json';
import { apply, forfeit, legalMoves, openingState, type Piece, type State } from './referee';

function sparse(cells: object, quiet = 0): State {
  const board: (Piece | undefined)[] = new Array(63).fill(undefined);
  for (const [sq, text] of Object.entries(cells as Record<string, string>)) {
    const [owner, kind] = text.split(':') as [Piece['owner'], Piece['kind']];
    board[Number(sq)] = { owner, kind };
  }
  return { ...openingState('red'), board, noCapturePlies: quiet };
}

describe('host referee (independent of the Rust core)', () => {
  it.each(moves.map((m) => [m.name, m] as const))('%s', (_n, m) => {
    expect(legalMoves(sparse(m.board)).some((p) => p.src === m.move[0] && p.dst === m.move[1])).toBe(m.legal);
  });

  it.each(adjudication.map((a) => [a.name, a] as const))('adjudicates %s', (_n, a) => {
    // A row commits one `move`, or several `moves` in order (Red first, alternating sides).
    const plies = ('moves' in a ? a.moves : [a.move]) as number[][];
    const after = plies.reduce((s, [src, dst]) => apply(s, { src: src!, dst: dst! }), sparse(a.board, a.quietBefore));
    expect([after.status, after.winner ?? null, after.reason, after.noCapturePlies]).toEqual([a.status, a.winner, a.reason, a.quietAfter]);
    expect(after.toPlay).toBe(plies.length % 2 === 1 ? 'blue' : 'red');
  });

  it('meets the opening handshake for both first movers', () => {
    const red = legalMoves(openingState('red'));
    expect(red).toHaveLength(24);
    expect(red[0]).toEqual({ src: 42, dst: 35 });
    expect(red[23]).toEqual({ src: 62, dst: 61 });
    expect(legalMoves(openingState('blue'))[0]).toEqual({ src: 0, dst: 1 });
    const next = apply(openingState('red'), red[0]!);
    expect([next.rev, next.noCapturePlies, next.toPlay, next.history]).toEqual([1, 1, 'blue', [{ src: 42, dst: 35 }]]);
  });

  it('forfeits without touching the board', () => {
    const s = apply(openingState('red'), { src: 42, dst: 35 });
    const f = forfeit(s, 'blue', 'timeout');
    expect([f.rev, f.status, f.winner, f.reason, f.history]).toEqual([2, 'forfeited', 'red', 'timeout', s.history]);
  });
});

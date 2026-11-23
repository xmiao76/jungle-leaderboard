import { describe, expect, it } from 'vitest';
import type { Side } from '../arena/src/referee';
import { randomGame, resultOf } from './games.test-support';
import { adjudicateEachPly, MAX_PLIES, verifyGame } from './verify-game';

const RANDOM_GAMES = 400;

describe('lean game verifier, against the referee', () => {
  it(`agrees with applyMove on every ply of ${RANDOM_GAMES} random games`, () => {
    const reasons = new Map<string, number>();
    for (let seed = 1; seed <= RANDOM_GAMES; seed += 1) {
      const firstSide: Side = seed % 2 ? 'red' : 'blue';
      const { moves, trail } = randomGame(seed, firstSide);
      const perPly = adjudicateEachPly(firstSide, moves);
      expect(perPly, `seed ${seed}`).not.toHaveProperty('illegalAt');
      expect(perPly).toEqual(trail.map((s) => ({ status: s.status, winner: s.winner, reason: s.reason })));
      const last = trail.at(-1)!;
      if (last.status !== 'playing') {
        expect(verifyGame(firstSide, moves, resultOf(last)), `seed ${seed}`).toMatchObject({ ok: true });
        reasons.set(last.reason, (reasons.get(last.reason) ?? 0) + 1);
      }
    }
    // The sample must exercise the endings the verifier has to tell apart.
    for (const reason of ['den', 'elimination', 'repetition', 'no-capture']) expect(reasons.get(reason) ?? 0, reason).toBeGreaterThan(0);
  }, 60_000);

  it('rejects a game that continues after it already ended', () => {
    const { moves, trail } = randomGame(7, 'red');
    const ended = trail.at(-1)!;
    expect(ended.status).not.toBe('playing');
    // Any extra ply is invalid: the game was over.
    const extra = [...moves, [0, 0] as [number, number]];
    expect(verifyGame('red', extra, resultOf(ended))).toMatchObject({ ok: false });
    // Claiming the end one ply later than it happened is just as wrong.
    expect(verifyGame('red', moves.slice(0, -1), resultOf(ended))).toMatchObject({ ok: false });
  });

  it('rejects an illegal move and says which ply', () => {
    const result = verifyGame('red', [[42, 35], [0, 2]], { status: 'drawn', winner: null, reason: 'no-capture' });
    expect(result).toEqual({ ok: false, reason: 'ply 2 (0 → 2) is not a legal move' });
  });

  it('rejects a result that is not where and how the referee ends the game', () => {
    const { moves, trail } = randomGame(11, 'blue');
    const ended = trail.at(-1)!;
    const other: Side = ended.winner === 'red' ? 'blue' : 'red';
    expect(verifyGame('blue', moves, { ...resultOf(ended), winner: ended.status === 'won' ? other : 'red', status: 'won' })).toMatchObject({ ok: false });
    expect(verifyGame('blue', moves, { ...resultOf(ended), reason: ended.reason === 'den' ? 'elimination' : 'den' })).toMatchObject({ ok: false });
  });

  it('accepts a forfeit only by the side to move, in a game still in progress', () => {
    const opening: [number, number][] = [[42, 35], [20, 27]];
    // Red is to move after two plies, so only Red can forfeit; Blue wins.
    expect(verifyGame('red', opening, { status: 'forfeited', winner: 'blue', reason: 'timeout' })).toMatchObject({ ok: true });
    expect(verifyGame('red', opening, { status: 'forfeited', winner: 'red', reason: 'timeout' })).toMatchObject({ ok: false });
    expect(verifyGame('red', [], { status: 'forfeited', winner: 'blue', reason: 'trap' })).toMatchObject({ ok: true });
    expect(verifyGame('red', opening, { status: 'forfeited', winner: 'blue', reason: 'den' })).toMatchObject({ ok: false });
    const { moves, trail } = randomGame(5, 'red');
    const loser = trail.at(-1)!.toPlay;
    expect(verifyGame('red', moves, { status: 'forfeited', winner: loser === 'red' ? 'blue' : 'red', reason: 'timeout' })).toMatchObject({ ok: false });
  });

  it('rejects a game that has not ended', () => {
    expect(verifyGame('red', [[42, 35]], { status: 'drawn', winner: null, reason: 'no-capture' })).toMatchObject({ ok: false });
  });

  it('rejects malformed moves and games longer than any legal game', () => {
    expect(verifyGame('red', [[42, 99]], { status: 'drawn', winner: null, reason: 'no-capture' })).toMatchObject({ ok: false });
    expect(verifyGame('red', [[1.5, 2]] as [number, number][], { status: 'drawn', winner: null, reason: 'no-capture' })).toMatchObject({ ok: false });
    const tooLong = Array.from({ length: MAX_PLIES + 1 }, () => [42, 35] as [number, number]);
    expect(verifyGame('red', tooLong, { status: 'drawn', winner: null, reason: 'no-capture' })).toEqual({ ok: false, reason: `a game has at most ${MAX_PLIES} plies` });
  });
});

describe('verifier cost', () => {
  it('verifies two typical games and the longest random game quickly', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ side: (i % 2 ? 'red' : 'blue') as Side, ...randomGame(1_000 + i, i % 2 ? 'red' : 'blue') })).filter(
      (g) => g.trail.at(-1)!.status !== 'playing',
    );
    const started = performance.now();
    let plies = 0;
    for (const g of games) {
      expect(verifyGame(g.side, g.moves, resultOf(g.trail.at(-1)!))).toMatchObject({ ok: true });
      plies += g.moves.length;
    }
    const perPly = (performance.now() - started) / plies;
    // Recorded for the plan (Workers Free allows 10 ms of CPU per request); generous bound for CI.
    expect(perPly).toBeLessThan(0.05);
  });
});


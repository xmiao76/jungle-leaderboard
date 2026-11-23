import { describe, expect, it } from 'vitest';
import type { GuestGame } from '../arena/src/loader/guest';
import { applyMove, initialSnapshot, legalMoves } from '../arena/src/referee';
import { auditGame, parseStoredGames, type StoredGame } from './matches-audit';

const sha = (c: string): string => c.repeat(64);

/** A guest that always plays legal index 0 — the test-entrant's strategy, without the binary. */
const firstMoveGuest: GuestGame = {
  info: () => ({}),
  init: () => undefined,
  chooseMove: () => 0,
  render: () => [],
};

/** Play first-move vs first-move with the real referee and record it as a stored game. */
function honestGame(firstSide: 'red' | 'blue' = 'red'): StoredGame {
  let snapshot = initialSnapshot(firstSide);
  const moves: [number, number][] = [];
  while (snapshot.status === 'playing') {
    const move = legalMoves(snapshot)[0]!;
    moves.push([move.src, move.dst]);
    snapshot = applyMove(snapshot, move);
  }
  return { red: sha('a'), blue: sha('b'), moves, result: { status: snapshot.status, winner: snapshot.winner, reason: snapshot.reason } };
}

const settings = { firstSide: 'red', seed: 1, difficulty: 'hard', nodeBudget: 20_000 } as const;

describe('auditGame', () => {
  it('verifies a faithfully reported game move for move', () => {
    const stored = honestGame();
    expect(auditGame({ red: firstMoveGuest, blue: firstMoveGuest }, settings, stored).kind).toBe('ok');
  });

  it('flags a game whose reported moves the programs do not reproduce', () => {
    const stored = honestGame();
    const tampered: StoredGame = { ...stored, moves: stored.moves.map((m, i) => (i === 2 ? [m[1], m[0]] as [number, number] : m)) };
    const verdict = auditGame({ red: firstMoveGuest, blue: firstMoveGuest }, settings, tampered);
    expect(verdict.kind).toBe('mismatch');
    expect(verdict.detail).toContain('ply 3');
  });

  it('flags a misreported ending even when every move matches', () => {
    const stored = honestGame();
    const verdict = auditGame({ red: firstMoveGuest, blue: firstMoveGuest }, settings, {
      ...stored,
      result: { ...stored.result, reason: stored.result.reason === 'den' ? 'elimination' : 'den' },
    });
    expect(verdict.kind).toBe('mismatch');
  });

  it('reports a program that throws or plays out of range as a program error', () => {
    const stored = honestGame();
    const throwing: GuestGame = { ...firstMoveGuest, chooseMove: () => { throw new Error('boom'); } };
    expect(auditGame({ red: throwing, blue: firstMoveGuest }, settings, stored)).toEqual({ kind: 'program-error', detail: 'boom' });
    const wild: GuestGame = { ...firstMoveGuest, chooseMove: () => 999 };
    expect(auditGame({ red: wild, blue: firstMoveGuest }, settings, stored).kind).toBe('program-error');
  });

  it('never re-runs a forfeit', () => {
    const verdict = auditGame({ red: firstMoveGuest, blue: firstMoveGuest }, settings, {
      red: sha('a'),
      blue: sha('b'),
      moves: [],
      result: { status: 'forfeited', winner: 'red', reason: 'timeout' },
    });
    expect(verdict.kind).toBe('forfeit');
  });
});

describe('parseStoredGames', () => {
  it('reads back the canonical stored shape', () => {
    const stored = honestGame();
    expect(parseStoredGames(JSON.stringify([stored, stored]))).toEqual([stored, stored]);
  });

  it.each([
    ['not JSON', '{nope'],
    ['one game only', JSON.stringify([honestGame()])],
    ['a bad hash', JSON.stringify([{ ...honestGame(), red: 'x' }, honestGame()])],
    ['a fractional square', JSON.stringify([{ ...honestGame(), moves: [[1.5, 2]] }, honestGame()])],
    ['an unknown winner', JSON.stringify([{ ...honestGame(), result: { status: 'won', winner: 'green', reason: 'den' } }, honestGame()])],
  ])('rejects %s', (_label, text) => {
    expect(parseStoredGames(text)).toBeNull();
  });
});

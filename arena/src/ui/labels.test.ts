import { describe, expect, it } from 'vitest';
import { applyMove, initialSnapshot, legalMoves } from '../referee';
import { describeResult, moveNumber, seatLabel, shortHash, sideLabel, squareName } from './labels';

describe('labels', () => {
  it('names seats, sides and hashes', () => {
    expect(seatLabel('left')).toBe('Left seat');
    expect(sideLabel('blue')).toBe('Blue');
    expect(shortHash('0123456789abcdef'.repeat(4))).toBe('01234567…cdef');
  });

  it('numbers the move about to be played, or the last one when the game is over', () => {
    const s = initialSnapshot('red');
    expect(moveNumber(null)).toBe(0);
    expect(moveNumber(s)).toBe(1);
    expect(moveNumber(applyMove(s, legalMoves(s)[0]!))).toBe(2);
    expect(moveNumber({ ...s, status: 'won', history: [{ src: 42, dst: 35 }] })).toBe(1);
  });

  it('names squares by wire number and board coordinate', () => {
    expect(squareName(0)).toBe('0 (a9)');
    expect(squareName(62)).toBe('62 (g1)');
    expect(squareName(42)).toBe('42 (a3)');
  });

  it('describes board results, forfeits and system errors', () => {
    const names = { red: 'Alpha', blue: 'Beta' };
    const base = { winnerSeat: 'left' as const, endRev: 9, forfeit: null };
    expect(describeResult(null, names)).toBe('');
    expect(describeResult({ kind: 'board', status: 'won', winner: 'red', reason: 'den', ...base }, names)).toBe('Red wins (Alpha): reached the enemy den.');
    expect(describeResult({ kind: 'board', status: 'drawn', winner: null, reason: 'no-capture', ...base }, names)).toMatch(/^Draw: 100 plies/);
    expect(describeResult({ kind: 'forfeit', status: 'forfeited', winner: 'blue', reason: 'timeout', ...base }, names)).toBe('Blue wins (Beta): the opponent ran out of time.');
    expect(describeResult({ kind: 'system-error', message: 'referee down', endRev: 3 }, names)).toMatch(/System error — no board result/);
  });
});

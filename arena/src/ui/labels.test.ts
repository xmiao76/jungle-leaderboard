import { describe, expect, it } from 'vitest';
import { applyMove, initialSnapshot, legalMoves } from '../referee';
import type { MatchResult } from '../match/controller';
import type { SeriesGame } from '../match/series';
import { describeResult, describeTally, formatRecord, gameOutcome, moveNumber, programNames, seatLabel, seriesHeadline, shortHash, sideLabel, squareName } from './labels';

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

describe('match result labels', () => {
  const meta = (title: string, gameVersion: string) => ({ metadata: { title, gameVersion } });
  const names = { left: 'Alpha v2.0.0', right: 'Alpha v1.0.0' };
  const game = (result: MatchResult | null): SeriesGame => ({ game: 1, sides: { left: 'red', right: 'blue' }, firstSeat: 'left', result });
  const base = { endRev: 9, forfeit: null };

  it('writes a record with singular and plural counts', () => {
    expect(formatRecord({ wins: 1, losses: 0, draws: 1 })).toBe('1 win · 0 losses · 1 draw');
    expect(formatRecord({ wins: 2, losses: 1, draws: 0 })).toBe('2 wins · 1 loss · 0 draws');
  });

  it('names each program by title and version, adding the seat when both are the same build', () => {
    expect(programNames({ left: meta('Alpha', '2.0.0'), right: meta('Alpha', '1.0.0') })).toEqual(names);
    expect(programNames({ left: meta('Alpha', '1.0.0'), right: meta('Alpha', '1.0.0') })).toEqual({
      left: 'Alpha v1.0.0 (left seat)',
      right: 'Alpha v1.0.0 (right seat)',
    });
  });

  it('sums the match up in one sentence: games won by each, and games drawn', () => {
    expect(describeTally({ left: { wins: 1, losses: 0, draws: 1 }, right: { wins: 0, losses: 1, draws: 1 } }, names)).toBe(
      'Alpha v2.0.0 won 1 game, Alpha v1.0.0 won 0 games, 1 game was drawn.',
    );
    expect(describeTally({ left: { wins: 0, losses: 0, draws: 2 }, right: { wins: 0, losses: 0, draws: 2 } }, names)).toBe(
      'Alpha v2.0.0 won 0 games, Alpha v1.0.0 won 0 games, 2 games were drawn.',
    );
  });

  it('heads the result with the winner, a drawn match, or no result', () => {
    const score = { left: 1.5, right: 0.5 };
    expect(seriesHeadline({ score, complete: true, winner: 'left' }, names)).toBe('Alpha v2.0.0 wins the match');
    expect(seriesHeadline({ score: { left: 1, right: 1 }, complete: true, winner: 'draw' }, names)).toBe('The match is drawn');
    expect(seriesHeadline({ score, complete: false, winner: null }, names)).toBe('No match result');
  });

  it('says how each game ended and why', () => {
    expect(gameOutcome(game({ kind: 'board', status: 'won', winner: 'blue', winnerSeat: 'right', reason: 'den', ...base }), names)).toBe(
      'Alpha v1.0.0 won · reached the enemy den',
    );
    expect(gameOutcome(game({ kind: 'board', status: 'drawn', winner: null, winnerSeat: null, reason: 'no-capture', ...base }), names)).toBe(
      'Drawn · 100 plies passed without a capture',
    );
    expect(gameOutcome(game({ kind: 'forfeit', status: 'forfeited', winner: 'red', winnerSeat: 'left', reason: 'timeout', ...base }), names)).toBe(
      'Alpha v2.0.0 won · the opponent ran out of time',
    );
    expect(gameOutcome(game({ kind: 'system-error', message: 'referee down', endRev: 3 }), names)).toBe('No result · a system error stopped the game');
    expect(gameOutcome(game(null), names)).toBe('Not played');
  });
});

import { describe, expect, it } from 'vitest';
import type { MatchResult } from './controller';
import {
  describeSeries,
  describeSeriesGame,
  firstSeatFor,
  formatPoints,
  gamePoints,
  planSeries,
  sidesForGame,
  summarizeSeries,
  type SeriesGame,
} from './series';

const won = (winnerSeat: 'left' | 'right', winner: 'red' | 'blue' = 'red'): MatchResult => ({
  kind: 'board', status: 'won', winner, winnerSeat, reason: 'den', endRev: 40, forfeit: null,
});
const drawn: MatchResult = { kind: 'board', status: 'drawn', winner: null, winnerSeat: null, reason: 'no-capture', endRev: 200, forfeit: null };
const forfeitTo = (winnerSeat: 'left' | 'right'): MatchResult => ({
  kind: 'forfeit', status: 'forfeited', winner: 'blue', winnerSeat, reason: 'timeout', endRev: 7,
  forfeit: { seat: winnerSeat === 'left' ? 'right' : 'left', side: 'red', reason: 'timeout', message: 'deadline', elapsedMs: 5000, deadlineMs: 5000 },
});
const systemError: MatchResult = { kind: 'system-error', message: 'referee crashed', endRev: 3 };

function withResults(results: (MatchResult | null)[], leftSide: 'red' | 'blue' = 'red'): SeriesGame[] {
  return planSeries(leftSide, 'red').slice(0, results.length).map((g, i) => ({ ...g, result: results[i]! }));
}

describe('planSeries', () => {
  it('swaps the colours for game 2 so each seat moves first once', () => {
    for (const leftSide of ['red', 'blue'] as const) {
      for (const firstSide of ['red', 'blue'] as const) {
        const [g1, g2] = planSeries(leftSide, firstSide);
        expect(g1!.sides).toEqual(sidesForGame(1, leftSide));
        expect(g2!.sides.left).toBe(g1!.sides.right);
        expect(g2!.sides.right).toBe(g1!.sides.left);
        expect([g1!.firstSeat, g2!.firstSeat].sort()).toEqual(['left', 'right']);
      }
    }
  });

  it('puts the first move with the seat holding the first side', () => {
    expect(firstSeatFor({ left: 'red', right: 'blue' }, 'red')).toBe('left');
    expect(firstSeatFor({ left: 'red', right: 'blue' }, 'blue')).toBe('right');
    expect(planSeries('red', 'red').map((g) => g.firstSeat)).toEqual(['left', 'right']);
    expect(planSeries('blue', 'red').map((g) => g.firstSeat)).toEqual(['right', 'left']);
  });
});

describe('scoring', () => {
  it('scores a game for the seat that won it, whatever its colour', () => {
    expect(gamePoints(won('left'))).toEqual({ left: 1, right: 0 });
    expect(gamePoints(won('right', 'blue'))).toEqual({ left: 0, right: 1 });
    expect(gamePoints(drawn)).toEqual({ left: 0.5, right: 0.5 });
    expect(gamePoints(forfeitTo('right'))).toEqual({ left: 0, right: 1 });
    expect(gamePoints(systemError)).toBeNull();
    expect(gamePoints(null)).toBeNull();
  });

  it('sums a sweep, a split and a half-point match', () => {
    expect(summarizeSeries(withResults([won('left'), won('left', 'blue')]))).toEqual({ score: { left: 2, right: 0 }, complete: true, winner: 'left' });
    expect(summarizeSeries(withResults([won('left'), won('right')]))).toEqual({ score: { left: 1, right: 1 }, complete: true, winner: 'draw' });
    expect(summarizeSeries(withResults([drawn, forfeitTo('right')]))).toEqual({ score: { left: 0.5, right: 1.5 }, complete: true, winner: 'right' });
  });

  it('leaves a match with a missing or failed game incomplete', () => {
    expect(summarizeSeries(withResults([won('left')]))).toMatchObject({ complete: false, winner: null });
    expect(summarizeSeries(withResults([won('left'), systemError]))).toMatchObject({ complete: false, winner: null, score: { left: 1, right: 0 } });
  });
});

describe('wording', () => {
  const names = { left: 'Claude Jungle v3.0.0', right: 'Sample v1.0.0' };

  it('writes half points as people do', () => {
    expect([0, 0.5, 1, 1.5, 2].map(formatPoints)).toEqual(['0', '½', '1', '1½', '2']);
  });

  it('describes a won, a drawn and an incomplete match', () => {
    expect(describeSeries(summarizeSeries(withResults([won('left'), won('left', 'blue')])), names)).toBe(
      'Match: Left 2 – 0 Right · Left (Claude Jungle v3.0.0) wins the match.',
    );
    expect(describeSeries(summarizeSeries(withResults([won('left'), won('right')])), names)).toBe('Match: Left 1 – 1 Right · the match is drawn.');
    expect(describeSeries(summarizeSeries(withResults([drawn, systemError])), names)).toBe('Match: Left ½ – ½ Right · incomplete, no match result.');
  });

  it('describes each game with who played what and who moved first', () => {
    const [g1, g2] = withResults([won('left'), drawn]);
    expect(describeSeriesGame(g1!)).toBe('Game 1: Left plays red, Left moves first — Left won (1–0).');
    expect(describeSeriesGame(g2!)).toBe('Game 2: Left plays blue, Right moves first — drawn (½–½).');
    expect(describeSeriesGame({ ...g2!, result: systemError })).toContain('system error');
    expect(describeSeriesGame({ ...g2!, result: null })).toContain('not played');
  });
});

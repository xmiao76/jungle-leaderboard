import { describe, expect, it } from 'vitest';
import { expectedScore, INITIAL_RATING, K_FACTOR, rateMatch, replayRatings } from './elo';

describe('expectedScore', () => {
  it('is one half between equals and favours the higher rating symmetrically', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3);
    expect(expectedScore(1400, 1000) + expectedScore(1000, 1400)).toBeCloseTo(1, 12);
  });
});

describe('rateMatch (one update per two-game match, K = 32 per game)', () => {
  it('moves equal ratings by K per game won beyond the expected score', () => {
    expect(K_FACTOR).toBe(32);
    expect(rateMatch(1000, 1000, 2)).toEqual({ left: 1032, right: 968, delta: 32 });
    expect(rateMatch(1000, 1000, 1.5)).toEqual({ left: 1016, right: 984, delta: 16 });
    expect(rateMatch(1000, 1000, 1)).toEqual({ left: 1000, right: 1000, delta: 0 });
    expect(rateMatch(1000, 1000, 0)).toEqual({ left: 968, right: 1032, delta: -32 });
  });

  it('gives the favourite less for winning and costs it more for losing', () => {
    const favouriteWins = rateMatch(1200, 1000, 2);
    const underdogWins = rateMatch(1200, 1000, 0);
    expect(favouriteWins.delta).toBeGreaterThan(0);
    expect(favouriteWins.delta).toBeLessThan(32);
    expect(-underdogWins.delta).toBeGreaterThan(32);
  });

  it('never creates or destroys rating points', () => {
    for (const [l, r, p] of [[1000, 1000, 0.5], [1530.7, 940.2, 2], [800, 1600, 1.5]] as const) {
      const next = rateMatch(l, r, p);
      expect(next.left + next.right).toBeCloseTo(l + r, 9);
    }
  });

  it('rejects a points total outside 0 to 2 in half points', () => {
    expect(() => rateMatch(1000, 1000, 2.5)).toThrow();
    expect(() => rateMatch(1000, 1000, 0.3)).toThrow();
  });
});

describe('replayRatings', () => {
  it('folds counted matches in order, starting every program at 1000, and counts its games', () => {
    const ratings = replayRatings([
      { left: 'a', right: 'b', leftWins: 2, rightWins: 0, draws: 0 },
      { left: 'b', right: 'c', leftWins: 0, rightWins: 1, draws: 1 },
    ]);
    const first = rateMatch(INITIAL_RATING, INITIAL_RATING, 2);
    const second = rateMatch(first.right, INITIAL_RATING, 0.5);
    expect(ratings.get('a')).toEqual({ rating: first.left, matches: 1, wins: 2, losses: 0, draws: 0 });
    expect(ratings.get('b')).toEqual({ rating: second.left, matches: 2, wins: 0, losses: 3, draws: 1 });
    expect(ratings.get('c')).toEqual({ rating: second.right, matches: 1, wins: 1, losses: 0, draws: 1 });
  });
});

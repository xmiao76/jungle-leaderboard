import { describe, expect, it } from 'vitest';
import { MODELS, type ModelEntry } from '../data/models';
import { buildLeaderboard, medalForPlace, validateEntries } from './ranking';

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: 'test-model',
    model: 'Test-Model',
    provider: 'Test Provider',
    access: 'open',
    harness: 'TestHarness',
    effort: 'high',
    playUrl: 'https://example.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/test_jungle_web',
    place: 1,
    ...overrides,
  };
}

describe('medalForPlace', () => {
  it('awards medals to the top three places only', () => {
    expect(medalForPlace(1)).toBe('gold');
    expect(medalForPlace(2)).toBe('silver');
    expect(medalForPlace(3)).toBe('bronze');
    expect(medalForPlace(4)).toBeNull();
    expect(medalForPlace(5)).toBeNull();
  });
});

describe('buildLeaderboard', () => {
  it('orders entries by place regardless of input order', () => {
    const ranked = buildLeaderboard([
      entry({ id: 'c', model: 'C', place: 3 }),
      entry({ id: 'a', model: 'A', place: 1 }),
      entry({ id: 'b', model: 'B', place: 2 }),
    ]);

    expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by model name so the render order is stable', () => {
    const ranked = buildLeaderboard([
      entry({ id: 'zeta', model: 'Zeta', place: 1 }),
      entry({ id: 'alpha', model: 'Alpha', place: 1 }),
    ]);

    expect(ranked.map((r) => r.model)).toEqual(['Alpha', 'Zeta']);
  });

  it('flags every member of a tied place and nobody else', () => {
    const ranked = buildLeaderboard([
      entry({ id: 'solo', model: 'Solo', place: 1 }),
      entry({ id: 'tied-a', model: 'TiedA', place: 2 }),
      entry({ id: 'tied-b', model: 'TiedB', place: 2 }),
    ]);

    expect(ranked.map((r) => [r.id, r.isTied])).toEqual([
      ['solo', false],
      ['tied-a', true],
      ['tied-b', true],
    ]);
  });

  it('does not mutate the input array or its entries', () => {
    const input = [entry({ id: 'b', model: 'B', place: 2 }), entry({ id: 'a', model: 'A', place: 1 })];
    const before = JSON.stringify(input);

    buildLeaderboard(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });

  describe('applied to the published data', () => {
    const ranked = buildLeaderboard(MODELS);

    it('produces standard competition places with a shared fourth and no fifth', () => {
      expect(ranked.map((r) => r.place)).toEqual([1, 2, 3, 4, 4, 6]);
      expect(ranked.some((r) => r.place === 5)).toBe(false);
    });

    it('puts Claude-Opus-5 first and marks both fourth-place models as tied', () => {
      expect(ranked[0]?.model).toBe('Claude-Opus-5');

      const fourth = ranked.filter((r) => r.place === 4);
      expect(fourth.map((r) => r.model)).toEqual(['Kimi-K3', 'Qwen-3.8-Max']);
      expect(fourth.every((r) => r.isTied)).toBe(true);
    });

    it('no longer lists the retired Claude-Fable-5 entry', () => {
      expect(ranked.map((r) => r.model)).not.toContain('Claude-Fable-5');
    });

    it('medals exactly the first three rows', () => {
      expect(ranked.map((r) => r.medal)).toEqual(['gold', 'silver', 'bronze', null, null, null]);
    });
  });
});

describe('validateEntries', () => {
  it('accepts the published data', () => {
    expect(() => validateEntries(MODELS)).not.toThrow();
  });

  it('rejects an empty leaderboard', () => {
    expect(() => validateEntries([])).toThrow(/empty/i);
  });

  it('rejects duplicate ids', () => {
    expect(() => validateEntries([entry({ place: 1 }), entry({ place: 2 })])).toThrow(/Duplicate model id/);
  });

  it('rejects blank required text', () => {
    expect(() => validateEntries([entry({ harness: '   ' })])).toThrow(/empty harness/);
  });

  it('rejects a play URL that is not https', () => {
    expect(() => validateEntries([entry({ playUrl: 'http://example.pages.dev/' })])).toThrow(/must use https/);
  });

  it('rejects a malformed URL', () => {
    expect(() => validateEntries([entry({ playUrl: 'not-a-url' })])).toThrow(/not a valid URL/);
  });

  it('rejects a source URL that is not on github.com', () => {
    expect(() => validateEntries([entry({ sourceUrl: 'https://gitlab.com/xmiao76/x' })])).toThrow(/must be on github\.com/);
  });

  it('rejects a gap in the place sequence', () => {
    const entries = [entry({ id: 'a', place: 1 }), entry({ id: 'b', place: 2 }), entry({ id: 'c', place: 4 })];
    expect(() => validateEntries(entries)).toThrow(/expected place 3 but found 4/);
  });

  it('rejects a tie that fails to skip the following place', () => {
    const entries = [entry({ id: 'a', place: 1 }), entry({ id: 'b', place: 1 }), entry({ id: 'c', place: 2 })];
    expect(() => validateEntries(entries)).toThrow(/expected place 3 but found 2/);
  });

  it('accepts a tie that correctly skips the following place', () => {
    const entries = [entry({ id: 'a', place: 1 }), entry({ id: 'b', place: 1 }), entry({ id: 'c', place: 3 })];
    expect(() => validateEntries(entries)).not.toThrow();
  });

  it('rejects a place that is not a positive integer', () => {
    expect(() => validateEntries([entry({ place: 0 })])).toThrow(/non-positive-integer place/);
    expect(() => validateEntries([entry({ place: 1.5 })])).toThrow(/non-positive-integer place/);
  });
});

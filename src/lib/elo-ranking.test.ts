import { describe, expect, it } from 'vitest';
import { arenaHref, buildEloRanking, githubHref, matchesText, medalForPlace, modelLine, parseLeaderboard, podiumPrograms, programCountText, versionText, type LeaderboardEntry } from './elo-ranking';

const sha = (c: string): string => c.repeat(64);

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    sha256: sha('a'),
    title: 'Jungle — test',
    gameVersion: '1.0.0',
    model: 'Model-X',
    codeAgent: 'Agent-Y',
    modelPlatform: 'official',
    githubUrl: 'https://github.com/example/jungle',
    rating: 1000,
    ratedMatches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    provisional: true,
    addedAt: '2026-11-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('parseLeaderboard', () => {
  it('accepts an empty leaderboard', () => {
    expect(parseLeaderboard({ entries: [] })).toEqual({ entries: [], issues: [] });
  });

  it('accepts an entry whose modelPlatform is missing or empty, as empty', () => {
    const { modelPlatform: _dropped, ...without } = entry();
    expect(parseLeaderboard({ entries: [without] }).entries?.[0]?.modelPlatform).toBe('');
    expect(parseLeaderboard({ entries: [entry({ modelPlatform: '' })] }).issues).toEqual([]);
    expect(parseLeaderboard({ entries: [{ ...entry(), modelPlatform: 7 }] }).entries).toBeNull();
  });

  it('accepts well-formed entries', () => {
    const e = entry();
    expect(parseLeaderboard({ entries: [e] })).toEqual({ entries: [e], issues: [] });
  });

  it.each([
    ['no entry list', {}],
    ['entries not a list', { entries: 'nope' }],
    ['a non-object entry', { entries: [42] }],
    ['a malformed hash', { entries: [entry({ sha256: 'xyz' })] }],
    ['a missing text field', { entries: [{ ...entry(), model: 7 }] }],
    ['a non-numeric rating', { entries: [entry({ rating: Number.NaN })] }],
    ['a fractional count', { entries: [entry({ wins: 1.5 })] }],
    ['a non-boolean provisional', { entries: [{ ...entry(), provisional: 'yes' }] }],
  ])('rejects %s rather than rendering half a table', (_label, data) => {
    const { entries, issues } = parseLeaderboard(data);
    expect(entries).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('buildEloRanking', () => {
  it('orders by rating, then rated matches, then oldest first', () => {
    const ranked = buildEloRanking([
      entry({ sha256: sha('c'), rating: 1000, ratedMatches: 3, addedAt: '2026-11-22T09:00:00.000Z' }),
      entry({ sha256: sha('a'), rating: 1016 }),
      entry({ sha256: sha('b'), rating: 1000, ratedMatches: 3, addedAt: '2026-11-21T09:00:00.000Z' }),
      entry({ sha256: sha('d'), rating: 1000, ratedMatches: 7 }),
    ]);
    expect(ranked.map((r) => r.sha256)).toEqual([sha('a'), sha('d'), sha('b'), sha('c')]);
  });

  it('assigns competition places from the rounded rating, skipping after a tie', () => {
    const ranked = buildEloRanking([
      entry({ sha256: sha('a'), rating: 1016.2 }),
      entry({ sha256: sha('b'), rating: 1000.4 }),
      entry({ sha256: sha('c'), rating: 999.6 }),
      entry({ sha256: sha('d'), rating: 984.1 }),
    ]);
    expect(ranked.map((r) => [r.displayRating, r.place, r.isTied])).toEqual([
      [1016, 1, false],
      [1000, 2, true],
      [1000, 2, true],
      [984, 4, false],
    ]);
  });

  it('awards medals by place, including to a tied second place', () => {
    const ranked = buildEloRanking([
      entry({ sha256: sha('a'), rating: 1100 }),
      entry({ sha256: sha('b'), rating: 1050 }),
      entry({ sha256: sha('c'), rating: 1050 }),
      entry({ sha256: sha('d'), rating: 900 }),
    ]);
    expect(ranked.map((r) => r.medal)).toEqual(['gold', 'silver', 'silver', null]);
    expect(medalForPlace(3)).toBe('bronze');
  });

  it('never mutates its input', () => {
    const entries = [entry({ rating: 900 }), entry({ sha256: sha('b'), rating: 1100 })];
    const before = [...entries];
    buildEloRanking(entries);
    expect(entries).toEqual(before);
  });

  it('ranks an empty field as empty', () => {
    expect(buildEloRanking([])).toEqual([]);
  });
});

describe('podiumPrograms', () => {
  it('takes the first three programs even when everyone is tied at 1000', () => {
    const ranked = buildEloRanking(['a', 'b', 'c', 'd', 'e'].map((c) => entry({ sha256: sha(c) })));
    expect(ranked.every((r) => r.place === 1)).toBe(true);
    expect(podiumPrograms(ranked)).toHaveLength(3);
  });

  it('shows fewer than three cards for a small field', () => {
    expect(podiumPrograms(buildEloRanking([entry()]))).toHaveLength(1);
    expect(podiumPrograms([])).toEqual([]);
  });
});

describe('links and copy', () => {
  it('joins model and platform only when a platform is declared', () => {
    expect(modelLine(entry())).toBe('Model-X · official');
    expect(modelLine(entry({ modelPlatform: '' }))).toBe('Model-X');
  });

  it('prefixes a bare version with v, once', () => {
    expect(versionText('1.1.0')).toBe('v1.1.0');
    expect(versionText('v2')).toBe('v2');
  });

  it('builds the relative Arena link for a program', () => {
    expect(arenaHref(sha('a'))).toBe(`arena/?left=${sha('a')}`);
  });

  it('passes through only GitHub repository URLs', () => {
    expect(githubHref('https://github.com/example/jungle')).toBe('https://github.com/example/jungle');
    expect(githubHref('https://example.com/jungle')).toBeNull();
    expect(githubHref('javascript:alert(1)')).toBeNull();
  });

  it('counts rated matches', () => {
    expect(matchesText(0)).toBe('0 rated matches');
    expect(matchesText(1)).toBe('1 rated match');
    expect(matchesText(5)).toBe('5 rated matches');
  });

  it('counts published programs', () => {
    expect(programCountText(1)).toBe('1 published program');
    expect(programCountText(7)).toBe('7 published programs');
  });
});

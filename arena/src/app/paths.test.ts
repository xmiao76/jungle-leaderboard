import { describe, expect, it } from 'vitest';
import { parsePlayQuery, playUrl, replayUrl, selectionFromQuery } from './paths';

describe('selectionFromQuery', () => {
  const sha = (c: string) => c.repeat(64);

  it('reads both seats from a shareable link', () => {
    expect(selectionFromQuery(`?left=${sha('a')}&right=${sha('b')}`)).toEqual({ left: sha('a'), right: sha('b') });
  });

  it('ignores anything that is not a lowercase SHA-256', () => {
    expect(selectionFromQuery(`?left=${sha('A')}&right=nope`)).toEqual({});
    expect(selectionFromQuery('')).toEqual({});
  });
});

describe('play page URLs', () => {
  const root = new URL('https://example.test/some/arena/');
  const config = {
    left: 'a'.repeat(64),
    right: 'b'.repeat(64),
    leftSide: 'blue',
    firstSide: 'red',
    difficulty: 'hard',
    seed: 4294967295,
    nodeBudget: 20000,
    thinkDeadlineMs: 5000,
    speed: 'fast',
    beginPaused: true,
  } as const;

  it('round-trips a full match configuration', () => {
    const url = new URL(playUrl(config, root));
    expect(url.pathname).toBe('/some/arena/play/');
    const parsed = parsePlayQuery(url.search);
    expect(parsed).toEqual({ replay: null, config, issues: [] });
  });

  it('keeps valid fields, drops invalid ones, and reports them', () => {
    const parsed = parsePlayQuery('?left=zz&leftSide=green&level=easy&seed=-4&budget=abc&think=50&speed=fast&paused=0');
    expect(parsed.config).toEqual({ difficulty: 'easy', speed: 'fast', beginPaused: false });
    expect(parsed.issues).toEqual(['left is not a SHA-256', 'leftSide=green', 'seed=-4', 'budget=abc', 'think=50']);
  });

  it('builds and recognises replay links', () => {
    expect(parsePlayQuery(new URL(replayUrl('m1-abc', root)).search).replay).toBe('m1-abc');
    expect(parsePlayQuery('?replay=../../x').replay).toBeNull();
  });
});

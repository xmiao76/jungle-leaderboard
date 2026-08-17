import { describe, expect, it } from 'vitest';
import { MODELS, type ModelEntry } from '../data/models';
import { describeRanking, describeTies, findTieGroups } from './ties';

/** Only `id` and `place` matter here, so the rest is filler. */
function at(place: number, id: string): ModelEntry {
  return {
    id,
    model: id.toUpperCase(),
    provider: 'Test Provider',
    access: 'open',
    harness: 'TestHarness',
    effort: 'high',
    playUrl: 'https://example.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/test_jungle_web',
    place,
  };
}

describe('findTieGroups', () => {
  it('returns nothing when every place is unique', () => {
    expect(findTieGroups([at(1, 'a'), at(2, 'b'), at(3, 'c')])).toEqual([]);
  });

  it('reports the places a two-way tie consumes', () => {
    expect(findTieGroups([at(1, 'a'), at(4, 'b'), at(4, 'c'), at(6, 'd')])).toEqual([
      { place: 4, count: 2, skippedPlaces: [5] },
    ]);
  });

  it('reports every place a three-way tie consumes', () => {
    expect(findTieGroups([at(4, 'a'), at(4, 'b'), at(4, 'c')])).toEqual([
      { place: 4, count: 3, skippedPlaces: [5, 6] },
    ]);
  });

  it('orders multiple tie groups by place', () => {
    const groups = findTieGroups([at(5, 'd'), at(5, 'e'), at(2, 'b'), at(2, 'c'), at(1, 'a')]);
    expect(groups.map((g) => g.place)).toEqual([2, 5]);
  });
});

describe('describeTies', () => {
  it('returns null when there is nothing to explain', () => {
    expect(describeTies([at(1, 'a'), at(2, 'b')])).toBeNull();
  });

  it('describes a two-way tie in the singular', () => {
    expect(describeTies([at(1, 'a'), at(4, 'b'), at(4, 'c'), at(6, 'd')])).toBe(
      'Two models share fourth place, so no fifth place is awarded.',
    );
  });

  it('describes a three-way tie in the plural', () => {
    expect(describeTies([at(4, 'a'), at(4, 'b'), at(4, 'c')])).toBe(
      'Three models share fourth place, so fifth and sixth places are not awarded.',
    );
  });

  it('lists three skipped places with commas and a final and', () => {
    expect(describeTies([at(2, 'a'), at(2, 'b'), at(2, 'c'), at(2, 'd')])).toBe(
      'Four models share second place, so third, fourth and fifth places are not awarded.',
    );
  });

  it('joins one sentence per tie group', () => {
    expect(describeTies([at(1, 'a'), at(2, 'b'), at(2, 'c'), at(4, 'd'), at(4, 'e')])).toBe(
      'Two models share second place, so no third place is awarded. ' +
        'Two models share fourth place, so no fifth place is awarded.',
    );
  });

  it('describes the published standings', () => {
    expect(describeTies(MODELS)).toBe('Two models share fourth place, so no fifth place is awarded.');
  });
});

describe('describeRanking', () => {
  it('appends the tie explanation to the preface', () => {
    expect(describeRanking(MODELS)).toBe(
      'Places follow standard competition ranking. Two models share fourth place, so no fifth place is awarded.',
    );
  });

  it('is just the preface when nothing is tied', () => {
    expect(describeRanking([at(1, 'a'), at(2, 'b')])).toBe(
      'Places follow standard competition ranking.',
    );
  });
});

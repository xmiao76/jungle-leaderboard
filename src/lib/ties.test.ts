import { describe, expect, it } from 'vitest';
import { describeRanking, describeTies, findTieGroups, type Placed } from './ties';

const at = (place: number): Placed => ({ place });

describe('findTieGroups', () => {
  it('returns nothing when every place is unique', () => {
    expect(findTieGroups([at(1), at(2), at(3)])).toEqual([]);
  });

  it('reports the places a two-way tie consumes', () => {
    expect(findTieGroups([at(1), at(4), at(4), at(6)])).toEqual([
      { place: 4, count: 2, skippedPlaces: [5] },
    ]);
  });

  it('reports every place a three-way tie consumes', () => {
    expect(findTieGroups([at(4), at(4), at(4)])).toEqual([
      { place: 4, count: 3, skippedPlaces: [5, 6] },
    ]);
  });

  it('orders multiple tie groups by place', () => {
    const groups = findTieGroups([at(5), at(5), at(2), at(2), at(1)]);
    expect(groups.map((g) => g.place)).toEqual([2, 5]);
  });
});

describe('describeTies', () => {
  it('returns null when there is nothing to explain', () => {
    expect(describeTies([at(1), at(2)])).toBeNull();
  });

  it('describes a two-way tie in the singular', () => {
    expect(describeTies([at(1), at(4), at(4), at(6)])).toBe(
      'Two programs share fourth place, so no fifth place is awarded.',
    );
  });

  it('describes a three-way tie in the plural', () => {
    expect(describeTies([at(4), at(4), at(4)])).toBe(
      'Three programs share fourth place, so fifth and sixth places are not awarded.',
    );
  });

  it('lists three skipped places with commas and a final and', () => {
    expect(describeTies([at(2), at(2), at(2), at(2)])).toBe(
      'Four programs share second place, so third, fourth and fifth places are not awarded.',
    );
  });

  it('joins one sentence per tie group', () => {
    expect(describeTies([at(1), at(2), at(2), at(4), at(4)])).toBe(
      'Two programs share second place, so no third place is awarded. ' +
        'Two programs share fourth place, so no fifth place is awarded.',
    );
  });
});

describe('describeRanking', () => {
  it('appends the tie explanation to the preface', () => {
    expect(describeRanking([at(1), at(4), at(4), at(6), at(6)])).toBe(
      'Places follow standard competition ranking. ' +
        'Two programs share fourth place, so no fifth place is awarded. ' +
        'Two programs share sixth place, so no seventh place is awarded.',
    );
  });

  it('is just the preface when nothing is tied', () => {
    expect(describeRanking([at(1), at(2)])).toBe(
      'Places follow standard competition ranking.',
    );
  });
});

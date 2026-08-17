import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DATE } from '../data/models';
import { countWord, formatRecord, formatSnapshotDate, ordinalWord } from './format';

describe('formatSnapshotDate', () => {
  it('formats the published snapshot date', () => {
    expect(formatSnapshotDate(SNAPSHOT_DATE)).toBe('August 17, 2026');
  });

  it('does not drift a day in western timezones', () => {
    // A naive `new Date('2026-01-01')` render in UTC-8 would print December 31.
    expect(formatSnapshotDate('2026-01-01')).toBe('January 1, 2026');
  });

  it('throws on an unparseable date', () => {
    expect(() => formatSnapshotDate('not-a-date')).toThrow(/ISO calendar date/);
  });
});

describe('ordinalWord', () => {
  it('spells out the ordinals a leaderboard actually uses', () => {
    expect([1, 2, 3, 4, 5, 6].map(ordinalWord)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
    ]);
  });

  it('falls back to numeric ordinals past tenth, including the teens', () => {
    expect(ordinalWord(11)).toBe('11th');
    expect(ordinalWord(12)).toBe('12th');
    expect(ordinalWord(13)).toBe('13th');
    expect(ordinalWord(21)).toBe('21st');
    expect(ordinalWord(22)).toBe('22nd');
    expect(ordinalWord(23)).toBe('23rd');
  });

  it('rejects a place that is not a positive integer', () => {
    expect(() => ordinalWord(0)).toThrow(/positive integer/);
    expect(() => ordinalWord(1.5)).toThrow(/positive integer/);
  });
});

describe('countWord', () => {
  it('spells out small counts', () => {
    expect([0, 1, 2, 6, 10].map(countWord)).toEqual(['zero', 'one', 'two', 'six', 'ten']);
  });

  it('falls back to digits past ten', () => {
    expect(countWord(11)).toBe('11');
  });

  it('rejects a negative count', () => {
    expect(() => countWord(-1)).toThrow(/non-negative integer/);
  });
});

describe('formatRecord', () => {
  it('renders wins, losses and draws', () => {
    expect(formatRecord({ wins: 4, losses: 1, draws: 0 })).toBe('4–1–0');
  });

  it('falls back to an em dash when no record is published', () => {
    expect(formatRecord(undefined)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DATE } from '../data/models';
import { formatRecord, formatSnapshotDate } from './format';

describe('formatSnapshotDate', () => {
  it('formats the published snapshot date', () => {
    expect(formatSnapshotDate(SNAPSHOT_DATE)).toBe('August 14, 2026');
  });

  it('does not drift a day in western timezones', () => {
    // A naive `new Date('2026-01-01')` render in UTC-8 would print December 31.
    expect(formatSnapshotDate('2026-01-01')).toBe('January 1, 2026');
  });

  it('throws on an unparseable date', () => {
    expect(() => formatSnapshotDate('not-a-date')).toThrow(/ISO calendar date/);
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

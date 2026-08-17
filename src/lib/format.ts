import type { MatchRecord } from '../data/models';

const DISPLAY_DATE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  // Pinned to UTC so the rendered date never shifts with the build machine's zone.
  timeZone: 'UTC',
});

/** Turns an ISO calendar date (`2026-08-14`) into `August 14, 2026`. */
export function formatSnapshotDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Not an ISO calendar date: "${isoDate}".`);
  }
  return DISPLAY_DATE.format(parsed);
}

const ORDINAL_WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
] as const;

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

const NUMERIC_SUFFIXES: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

function numericOrdinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${NUMERIC_SUFFIXES[n % 10] ?? 'th'}`;
}

/** `4` → `fourth`. Falls back to a numeric ordinal (`11th`) past tenth. */
export function ordinalWord(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Ordinal needs a positive integer, got: ${n}.`);
  }
  return n <= ORDINAL_WORDS.length ? ORDINAL_WORDS[n - 1]! : numericOrdinal(n);
}

/** `2` → `two`. Falls back to digits past ten. */
export function countWord(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Count needs a non-negative integer, got: ${n}.`);
  }
  return n < COUNT_WORDS.length ? COUNT_WORDS[n]! : String(n);
}

/** Renders a head-to-head record as `W–L–D`, or an em dash when unpublished. */
export function formatRecord(record: MatchRecord | undefined): string {
  if (!record) return '—';
  return `${record.wins}–${record.losses}–${record.draws}`;
}

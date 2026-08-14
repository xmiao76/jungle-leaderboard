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

/** Renders a head-to-head record as `W–L–D`, or an em dash when unpublished. */
export function formatRecord(record: MatchRecord | undefined): string {
  if (!record) return '—';
  return `${record.wins}–${record.losses}–${record.draws}`;
}

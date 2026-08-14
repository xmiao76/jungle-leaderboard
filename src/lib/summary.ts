import type { ModelEntry } from '../data/models';

export interface LeaderboardSummary {
  readonly total: number;
  readonly openCount: number;
  readonly closedCount: number;
  /** Drives whether the table renders a Record column at all. */
  readonly hasRecords: boolean;
}

export function summarize(entries: readonly ModelEntry[]): LeaderboardSummary {
  const openCount = entries.filter((entry) => entry.access === 'open').length;
  return {
    total: entries.length,
    openCount,
    closedCount: entries.length - openCount,
    hasRecords: entries.some((entry) => entry.record !== undefined),
  };
}

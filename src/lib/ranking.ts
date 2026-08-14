/**
 * Pure ranking helpers. Every function returns new values and never mutates its
 * arguments, so the leaderboard data stays a single immutable source of truth.
 */
import type { ModelEntry } from '../data/models';

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface RankedEntry extends ModelEntry {
  /** True when another entry shares this place. */
  readonly isTied: boolean;
  /** Set for the top three places only. */
  readonly medal: Medal;
}

const GITHUB_HOST = 'github.com';

export function medalForPlace(place: number): Medal {
  if (place === 1) return 'gold';
  if (place === 2) return 'silver';
  if (place === 3) return 'bronze';
  return null;
}

function countByPlace(entries: readonly ModelEntry[]): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    counts.set(entry.place, (counts.get(entry.place) ?? 0) + 1);
  }
  return counts;
}

/**
 * Orders entries by place (ties broken by model name for a stable render) and
 * annotates each with its medal and tie state.
 */
export function buildLeaderboard(entries: readonly ModelEntry[]): readonly RankedEntry[] {
  const counts = countByPlace(entries);
  return [...entries]
    .sort((a, b) => a.place - b.place || a.model.localeCompare(b.model))
    .map((entry) => ({
      ...entry,
      isTied: (counts.get(entry.place) ?? 0) > 1,
      medal: medalForPlace(entry.place),
    }));
}

function assertUniqueIds(entries: readonly ModelEntry[]): void {
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`Duplicate model id: "${id}".`);
    seen.add(id);
  }
}

function assertRequiredText(entries: readonly ModelEntry[]): void {
  for (const entry of entries) {
    for (const field of ['model', 'provider', 'harness', 'effort'] as const) {
      if (entry[field].trim() === '') {
        throw new Error(`Entry "${entry.id}" has an empty ${field}.`);
      }
    }
  }
}

function parseHttpsUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL: "${raw}".`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use https: "${raw}".`);
  }
  return url;
}

function assertUrls(entries: readonly ModelEntry[]): void {
  for (const entry of entries) {
    parseHttpsUrl(entry.playUrl, `Play URL for "${entry.id}"`);
    const source = parseHttpsUrl(entry.sourceUrl, `Source URL for "${entry.id}"`);
    if (source.host !== GITHUB_HOST) {
      throw new Error(`Source URL for "${entry.id}" must be on ${GITHUB_HOST}: "${entry.sourceUrl}".`);
    }
  }
}

/**
 * Enforces standard competition ranking: places start at 1, and a group of k
 * entries sharing a place is followed by place + k. So 1,2,3,4,5,5 is valid but
 * 1,2,4 (gap) and 1,1,2 (tie not skipping a place) are not.
 */
function assertCompetitionPlaces(entries: readonly ModelEntry[]): void {
  for (const { id, place } of entries) {
    if (!Number.isInteger(place) || place < 1) {
      throw new Error(`Entry "${id}" has a non-positive-integer place: ${place}.`);
    }
  }
  const counts = countByPlace(entries);
  let expected = 1;
  for (const place of [...counts.keys()].sort((a, b) => a - b)) {
    if (place !== expected) {
      throw new Error(`Invalid competition ranking: expected place ${expected} but found ${place}.`);
    }
    expected += counts.get(place) ?? 0;
  }
}

/** Throws on any malformed leaderboard data. Call at build time. */
export function validateEntries(entries: readonly ModelEntry[]): void {
  if (entries.length === 0) throw new Error('Leaderboard data is empty.');
  assertUniqueIds(entries);
  assertRequiredText(entries);
  assertUrls(entries);
  assertCompetitionPlaces(entries);
}

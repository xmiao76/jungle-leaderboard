/**
 * The live leaderboard's pure logic: the `GET /api/leaderboard` wire format (server/leaderboard.ts),
 * its strict parser, and the ranking the page renders. Every string the page's bundled script
 * prints comes from here (or from ties.ts/format.ts), so it is unit-tested even though the
 * script itself only runs in a browser. Nothing here mutates its input.
 */

export interface LeaderboardEntry {
  readonly sha256: string;
  readonly title: string;
  readonly gameVersion: string;
  readonly model: string;
  readonly codeAgent: string;
  /** '' when the program declared none (or predates the field); displayed as nothing. */
  readonly modelPlatform: string;
  readonly githubUrl: string;
  /** Stored unrounded; places and display round it. */
  readonly rating: number;
  readonly ratedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Fewer than five rated matches (computed by the server, the constant's owner). */
  readonly provisional: boolean;
  readonly addedAt: string;
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export function medalForPlace(place: number): Medal {
  if (place === 1) return 'gold';
  if (place === 2) return 'silver';
  if (place === 3) return 'bronze';
  return null;
}

export interface RankedProgram extends LeaderboardEntry {
  /** Standard competition place, shared by programs whose rounded ratings are equal. */
  readonly place: number;
  readonly isTied: boolean;
  readonly medal: Medal;
  readonly displayRating: number;
}

const SHA = /^[0-9a-f]{64}$/;
/** The same shape the Arena loader demands of `info().githubUrl` (arena/src/loader/metadata.ts). */
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+\/?$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Validate one leaderboard response. The server is ours, so parsing is strict: any malformed
 * entry fails the whole response and the page shows its error state rather than half a table.
 */
export function parseLeaderboard(data: unknown): { entries: LeaderboardEntry[] | null; issues: string[] } {
  if (!isRecord(data) || !Array.isArray(data['entries'])) {
    return { entries: null, issues: ['The leaderboard response has no entry list.'] };
  }
  const issues: string[] = [];
  const entries: LeaderboardEntry[] = [];
  for (const [i, raw] of (data['entries'] as unknown[]).entries()) {
    if (!isRecord(raw)) {
      issues.push(`Entry ${i} is not an object.`);
      continue;
    }
    const strings = ['title', 'gameVersion', 'model', 'codeAgent', 'githubUrl', 'addedAt'] as const;
    const counts = ['ratedMatches', 'wins', 'losses', 'draws'] as const;
    if (typeof raw['sha256'] !== 'string' || !SHA.test(raw['sha256'])) issues.push(`Entry ${i}: malformed hash.`);
    else if (strings.some((f) => typeof raw[f] !== 'string')) issues.push(`Entry ${i}: missing text fields.`);
    else if (typeof raw['rating'] !== 'number' || !Number.isFinite(raw['rating'])) issues.push(`Entry ${i}: rating is not a number.`);
    else if (counts.some((f) => !isCount(raw[f]))) issues.push(`Entry ${i}: match counts are not whole numbers.`);
    else if (typeof raw['provisional'] !== 'boolean') issues.push(`Entry ${i}: provisional is not a flag.`);
    // modelPlatform is optional in the wire format: older servers omit it.
    else if (raw['modelPlatform'] !== undefined && typeof raw['modelPlatform'] !== 'string') issues.push(`Entry ${i}: modelPlatform is not text.`);
    else {
      entries.push({
        sha256: raw['sha256'],
        title: raw['title'] as string,
        gameVersion: raw['gameVersion'] as string,
        model: raw['model'] as string,
        codeAgent: raw['codeAgent'] as string,
        modelPlatform: (raw['modelPlatform'] as string | undefined) ?? '',
        githubUrl: raw['githubUrl'] as string,
        rating: raw['rating'],
        ratedMatches: raw['ratedMatches'] as number,
        wins: raw['wins'] as number,
        losses: raw['losses'] as number,
        draws: raw['draws'] as number,
        provisional: raw['provisional'],
        addedAt: raw['addedAt'] as string,
      });
    }
  }
  return issues.length > 0 ? { entries: null, issues } : { entries, issues };
}

/** The API's order (kept here too, so the ranking is right whatever order entries arrive in). */
function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.rating - a.rating || b.ratedMatches - a.ratedMatches || a.addedAt.localeCompare(b.addedAt) || a.sha256.localeCompare(b.sha256);
}

/**
 * Order the programs and assign places: standard competition ranking over the *rounded*
 * rating, so two programs displayed at the same rating share a place (and consume the next).
 */
export function buildEloRanking(entries: readonly LeaderboardEntry[]): readonly RankedProgram[] {
  const sorted = [...entries].sort(compareEntries);
  const counts = new Map<number, number>();
  for (const e of sorted) counts.set(Math.round(e.rating), (counts.get(Math.round(e.rating)) ?? 0) + 1);
  let place = 0;
  let previous: number | null = null;
  return sorted.map((entry, index) => {
    const displayRating = Math.round(entry.rating);
    if (displayRating !== previous) {
      place = index + 1;
      previous = displayRating;
    }
    return { ...entry, place, isTied: (counts.get(displayRating) ?? 0) > 1, medal: medalForPlace(place), displayRating };
  });
}

/**
 * The podium cards: the first three programs in ranking order. Places alone cannot size the
 * podium — every fresh program sits at 1000, tied for first — so three cards it is, whatever
 * places they carry (a tied card still shows its shared place).
 */
export const podiumPrograms = (ranked: readonly RankedProgram[]): readonly RankedProgram[] => ranked.slice(0, 3);

/** `1.1.0` → `v1.1.0`, unless the author already wrote the `v`. */
export const versionText = (gameVersion: string): string => (gameVersion.startsWith('v') ? gameVersion : `v${gameVersion}`);

/** The Arena setup page with this program in the left seat, relative to the leaderboard. */
export const arenaHref = (sha256: string): string => `arena/?left=${sha256}`;

/** A safe link target for a program's repository, or null when the stored URL is not one. */
export const githubHref = (url: string): string | null => (GITHUB_URL.test(url) ? url : null);

/** Podium identity line: `Model-X`, or `Model-X · <platform>` when one is declared. */
export const modelLine = (entry: Pick<LeaderboardEntry, 'model' | 'modelPlatform'>): string =>
  entry.modelPlatform ? `${entry.model} · ${entry.modelPlatform}` : entry.model;

/** Podium copy: `1 rated match`, `5 rated matches`. */
export const matchesText = (n: number): string => `${n} rated match${n === 1 ? '' : 'es'}`;

/** Masthead copy: `1 published program`, `7 published programs`. */
export const programCountText = (n: number): string => `${n} published program${n === 1 ? '' : 's'}`;

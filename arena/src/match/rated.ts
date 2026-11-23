/**
 * Which matches change Elo ratings. Shared by the Arena pages (the Rated/Friendly badge) and the
 * match-report API, so both apply one rule. No Vue or browser imports: the server bundles it.
 * Rated: two different programs published in the Arena catalog, at the standard settings.
 * The server adds what only it knows (same uploader, forfeits; see server/match-report.ts).
 */
import type { Level } from '../referee/types';

export interface RatedSettings {
  readonly difficulty: Level;
  readonly nodeBudget: number;
  readonly thinkDeadlineMs: number;
}

/** The standard settings; also the Arena's defaults, so a default match is rated. */
export const RATED_SETTINGS: RatedSettings = { difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 5_000 };

/** Below this many rated matches a rating is shown as provisional. */
export const PROVISIONAL_MATCHES = 5;

export function isRatedSettings(settings: RatedSettings): boolean {
  return (
    settings.difficulty === RATED_SETTINGS.difficulty &&
    settings.nodeBudget === RATED_SETTINGS.nodeBudget &&
    settings.thinkDeadlineMs === RATED_SETTINGS.thinkDeadlineMs
  );
}

export type RatedEligibility = { readonly rated: true } | { readonly rated: false; readonly reason: string };

export function ratedEligibility(match: {
  readonly left: string;
  readonly right: string;
  readonly leftPublished: boolean;
  readonly rightPublished: boolean;
  readonly settings: RatedSettings;
}): RatedEligibility {
  if (match.left === match.right) return { rated: false, reason: 'A program does not play rated matches against itself.' };
  if (!match.leftPublished || !match.rightPublished) return { rated: false, reason: 'Only programs published to the Arena catalog are rated.' };
  if (!isRatedSettings(match.settings)) return { rated: false, reason: 'Rated matches use hard, 20,000 nodes and 5 s per move.' };
  return { rated: true };
}

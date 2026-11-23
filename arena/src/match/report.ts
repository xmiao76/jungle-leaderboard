/**
 * Report a finished two-game match to the Arena (`POST /api/matches`, server/match-report.ts).
 * The body carries both games as moves plus result; the server replays them, then records the
 * match and — when rated — updates both programs' Elo ratings.
 */
import type { Level, PlyMove, Side } from '../referee/types';
import type { MatchResult } from './controller';

export interface MatchReportBody {
  readonly left: string;
  readonly right: string;
  readonly leftSide: Side;
  readonly firstSide: Side;
  readonly seed: number;
  readonly settings: { readonly difficulty: Level; readonly nodeBudget: number; readonly thinkDeadlineMs: number };
  readonly games: readonly {
    readonly moves: readonly (readonly [number, number])[];
    readonly result: { readonly status: 'won' | 'drawn' | 'forfeited'; readonly winner: Side | null; readonly reason: string };
  }[];
}

export interface RatingChange {
  readonly before: number;
  readonly after: number;
}

export type ReportOutcome =
  | { readonly state: 'counted'; readonly ratings: { readonly left: RatingChange; readonly right: RatingChange } }
  | { readonly state: 'already' }
  | { readonly state: 'unrated'; readonly reason: string }
  | { readonly state: 'failed'; readonly reasons: readonly string[] };

export interface ReportInput {
  readonly left: string;
  readonly right: string;
  readonly settings: { readonly leftSide: Side; readonly firstSide: Side; readonly seed: number; readonly difficulty: Level; readonly nodeBudget: number; readonly thinkDeadlineMs: number };
  readonly games: readonly { readonly result: MatchResult | null; readonly moves: readonly PlyMove[] }[];
}

/** The report for a match whose two games both ended with a result; null otherwise. */
export function buildMatchReport(input: ReportInput): MatchReportBody | null {
  if (input.games.length !== 2) return null;
  const games: MatchReportBody['games'][number][] = [];
  for (const game of input.games) {
    const r = game.result;
    if (!r || r.kind === 'system-error' || r.status === 'playing') return null;
    games.push({ moves: game.moves.map((m) => [m.src, m.dst] as const), result: { status: r.status, winner: r.winner, reason: r.reason } });
  }
  const s = input.settings;
  return {
    left: input.left,
    right: input.right,
    leftSide: s.leftSide,
    firstSide: s.firstSide,
    seed: s.seed,
    settings: { difficulty: s.difficulty, nodeBudget: s.nodeBudget, thinkDeadlineMs: s.thinkDeadlineMs },
    games,
  };
}

interface ServerAnswer {
  readonly existing?: boolean;
  readonly match?: { readonly status?: string; readonly unratedReason?: string | null };
  readonly ratings?: { readonly left: RatingChange; readonly right: RatingChange } | null;
  readonly reasons?: unknown;
}

export async function postMatchReport(body: MatchReportBody, turnstileToken: string, endpoint: URL, fetcher: typeof fetch = fetch): Promise<ReportOutcome> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-turnstile-token': turnstileToken },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { state: 'failed', reasons: [`The Arena could not be reached: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const answer = (await response.json().catch(() => ({}))) as ServerAnswer;
  if (response.status === 200 && answer.existing) return { state: 'already' };
  if (response.status === 201 && answer.match?.status === 'unrated') return { state: 'unrated', reason: answer.match.unratedReason ?? 'This match does not change ratings.' };
  if (response.status === 201 && answer.ratings) return { state: 'counted', ratings: answer.ratings };
  const reasons = Array.isArray(answer.reasons) ? answer.reasons.filter((r): r is string => typeof r === 'string') : [];
  return { state: 'failed', reasons: reasons.length > 0 ? reasons : [`The Arena refused the result (HTTP ${response.status}).`] };
}

/**
 * `GET /api/leaderboard` (functions/api/leaderboard/index.ts): every published program's live
 * Elo standing, for the leaderboard page at `/` (src/pages/index.astro, which parses this with
 * `parseLeaderboard` in src/lib/elo-ranking.ts). A public read, like the catalog manifest:
 * no Turnstile, no quota, and never the uploader hash or the stored upload report.
 * Ordered by rating; ties fall to more rated matches, then to the older program.
 */
import { PROVISIONAL_MATCHES } from '../arena/src/match/rated';
import { RULES_DIGEST, RULES_ID } from '../arena/src/referee/profile';

export interface LeaderboardEntry {
  readonly sha256: string;
  readonly title: string;
  readonly gameVersion: string;
  readonly model: string;
  readonly codeAgent: string;
  /** '' when the program declared none (or predates the field); displayed as nothing. */
  readonly modelPlatform: string;
  readonly githubUrl: string;
  /** Stored unrounded; the page rounds for display and for places. */
  readonly rating: number;
  readonly ratedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly provisional: boolean;
  readonly addedAt: string;
}

/** One entrant row, only the columns this endpoint reads. */
interface StandingRow {
  readonly sha256: string;
  readonly title: string;
  readonly game_version: string;
  readonly model: string;
  readonly code_agent: string;
  readonly model_platform: string;
  readonly github_url: string;
  readonly rating: number;
  readonly rated_matches: number;
  readonly game_wins: number;
  readonly game_losses: number;
  readonly game_draws: number;
  readonly created_at: string;
}

// Only entrants built for the referee's current rules, as on the catalog read path.
const LIST_STANDINGS = [
  'SELECT sha256, title, game_version, model, code_agent, model_platform, github_url,',
  '  rating, rated_matches, game_wins, game_losses, game_draws, created_at',
  "FROM entrants WHERE status = 'listed' AND rules_id = ? AND rules_digest = ?",
  'ORDER BY rating DESC, rated_matches DESC, created_at ASC, sha256 ASC',
].join('\n');

function rowToEntry(row: StandingRow): LeaderboardEntry {
  return {
    sha256: row.sha256,
    title: row.title,
    gameVersion: row.game_version,
    model: row.model,
    codeAgent: row.code_agent,
    modelPlatform: row.model_platform,
    githubUrl: row.github_url,
    rating: row.rating,
    ratedMatches: row.rated_matches,
    wins: row.game_wins,
    losses: row.game_losses,
    draws: row.game_draws,
    provisional: row.rated_matches < PROVISIONAL_MATCHES,
    addedAt: row.created_at,
  };
}

export async function listStandings(db: D1Database): Promise<LeaderboardEntry[]> {
  const { results } = await db.prepare(LIST_STANDINGS).bind(RULES_ID, RULES_DIGEST).all<StandingRow>();
  return results.map(rowToEntry);
}

export async function handleLeaderboardGet(env: Env): Promise<Response> {
  try {
    const entries = await listStandings(env.DB);
    return Response.json({ entries }, { headers: { 'cache-control': 'no-cache' } });
  } catch (err) {
    // The cause goes to the Functions log; the visitor never sees binding internals.
    console.error('leaderboard read failed', err);
    return new Response('The leaderboard is temporarily unavailable.', { status: 503 });
  }
}

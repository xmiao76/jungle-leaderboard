/**
 * `POST /api/matches` (functions/api/matches/index.ts): one finished two-game match, reported by
 * the browser that played it, becomes a row in `matches` and — when rated — moves both programs'
 * Elo ratings (server/elo.ts). The server cannot run the programs (Workers Free), so it checks
 * everything else first and stores nothing unless every check passes:
 *   Turnstile → report quota → size and shape → standard settings → both programs published under
 *   the current rules and different → each game replayed from the opening (verify-game.ts) →
 *   one report per match → rating update in one D1 batch (a transaction).
 * A match with a forfeit (unverifiable from moves) is recorded as `unrated`. (Matches between
 * two programs from one uploader DO count: the catalog's curator uploads most programs, so
 * excluding them would leave almost nothing rated; abuse is bounded by move verification,
 * quotas, one report per match, and maintainer audit/void instead.) Concurrent reports for
 * one program collide on rating_changes
 * (sha256, seq) and retry, so ratings always equal a sequential application.
 */
import { isRatedSettings } from '../arena/src/match/rated';
import { RULES_DIGEST, RULES_ID } from '../arena/src/referee/profile';
import { consumeQuota, dailyLimit, hashUploader, quotaBucket, verifyTurnstile } from './abuse';
import { rateMatch } from './elo';
import { canonicalMoves, matchKey, parseReport, scoreMatch, type MatchReport, type MatchScore } from './match-report-body';
import { verifyGame } from './verify-game';

export interface MatchReportEnv extends Env {
  readonly TURNSTILE_SECRET?: string;
  readonly UPLOADER_SALT?: string;
  /** Optional override of MAX_REPORTS_PER_DAY (e2e raises it). */
  readonly REPORT_DAILY_LIMIT?: string;
}

export interface MatchReportDeps {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

export const MAX_REPORTS_PER_DAY = 60;
/** Two games of at most 1,600 plies each fit easily; bounds what a hostile body can make us parse. */
export const MAX_REPORT_BYTES = 64 * 1024;
const ATTEMPTS = 3;

interface Standing {
  readonly sha256: string;
  readonly rating: number;
  readonly rating_seq: number;
}

interface MatchRow {
  readonly id: number;
  readonly status: string;
  readonly moves: string;
  readonly left_wins: number;
  readonly right_wins: number;
  readonly draws: number;
}

const reject = (status: number, reasons: readonly string[]) => Response.json({ stage: 'server', reasons }, { status });

const LOAD_PLAYABLE = `SELECT sha256, rating, rating_seq FROM entrants WHERE sha256 IN (?, ?) AND status = 'listed' AND rules_id = ? AND rules_digest = ?`;
const MATCH_BY_KEY = "FROM matches WHERE sha_lo = ? AND sha_hi = ? AND seed = ? AND first_side = ? AND status <> 'voided'";
const FIND_MATCH = `SELECT id, status, moves, left_wins, right_wins, draws ${MATCH_BY_KEY}`;
const INSERT_MATCH = [
  'INSERT INTO matches (left_sha, right_sha, sha_lo, sha_hi, left_side, first_side, seed, difficulty, node_budget, think_ms,',
  '  game1_result, game1_reason, game1_plies, game2_result, game2_reason, game2_plies, left_wins, right_wins, draws,',
  '  left_rating_before, left_rating_after, right_rating_before, right_rating_after, moves, reporter, status, unrated_reason, created_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
].join('\n');
// The new match's id by its key: it is inserted first in the same batch.
const INSERT_CHANGE = `INSERT INTO rating_changes (sha256, seq, match_id, rating_before, rating_after) VALUES (?, ?, (SELECT id ${MATCH_BY_KEY}), ?, ?)`;
const UPDATE_STANDING = [
  'UPDATE entrants SET rating = ?, rating_seq = ?, rated_matches = rated_matches + 1,',
  '  game_wins = game_wins + ?, game_losses = game_losses + ?, game_draws = game_draws + ? WHERE sha256 = ?',
].join('\n');

/** Every check that does not touch ratings; a reason list means "refuse, store nothing". */
async function admit(env: MatchReportEnv, report: MatchReport): Promise<{ status: number; reasons: string[] } | { standings: Map<string, Standing>; score: MatchScore }> {
  if (report.left === report.right) return { status: 400, reasons: ['A program does not play rated matches against itself.'] };
  if (!isRatedSettings(report.settings)) return { status: 400, reasons: ['Only rated matches (hard, 20,000 nodes, 5 s per move) are recorded.'] };
  const { results } = await env.DB.prepare(LOAD_PLAYABLE).bind(report.left, report.right, RULES_ID, RULES_DIGEST).all<Standing>();
  const standings = new Map(results.map((s) => [s.sha256, s]));
  if (standings.size !== 2) return { status: 404, reasons: ['Both programs must be published in the Arena catalog under the current rules.'] };
  for (const [i, game] of report.games.entries()) {
    const verdict = verifyGame(report.firstSide, game.moves, game.result);
    if (!verdict.ok) return { status: 400, reasons: [`Game ${i + 1}: ${verdict.reason}`] };
  }
  return { standings, score: scoreMatch(report) };
}

function unratedReason(score: MatchScore): string | null {
  if (score.hasForfeit) return 'A game ended by forfeit, which the server cannot verify from the moves.';
  return null;
}

function matchStatement(env: MatchReportEnv, report: MatchReport, score: MatchScore, ratings: ReturnType<typeof rateMatch> | null, before: [number, number] | null, reporter: string, unrated: string | null, now: Date): D1PreparedStatement {
  const key = matchKey(report);
  const [g1, g2] = score.games as [MatchScore['games'][number], MatchScore['games'][number]];
  return env.DB.prepare(INSERT_MATCH).bind(
    report.left, report.right, key.shaLo, key.shaHi, report.leftSide, report.firstSide, report.seed,
    report.settings.difficulty, report.settings.nodeBudget, report.settings.thinkDeadlineMs,
    g1.result, g1.reason, g1.plies, g2.result, g2.reason, g2.plies, score.leftWins, score.rightWins, score.draws,
    before?.[0] ?? null, ratings?.left ?? null, before?.[1] ?? null, ratings?.right ?? null,
    canonicalMoves(report), reporter, unrated ? 'unrated' : 'counted', unrated, now.toISOString(),
  );
}

/** One write attempt from freshly read ratings; throws when a concurrent writer got there first. */
async function writeOnce(env: MatchReportEnv, report: MatchReport, score: MatchScore, reporter: string, unrated: string | null, now: Date) {
  if (unrated) {
    await env.DB.batch([matchStatement(env, report, score, null, null, reporter, unrated, now)]);
    return null;
  }
  const { results } = await env.DB.prepare(LOAD_PLAYABLE).bind(report.left, report.right, RULES_ID, RULES_DIGEST).all<Standing>();
  const [left, right] = [results.find((s) => s.sha256 === report.left)!, results.find((s) => s.sha256 === report.right)!];
  const ratings = rateMatch(left.rating, right.rating, score.leftWins + score.draws / 2);
  const key = matchKey(report);
  const keyBinds = [key.shaLo, key.shaHi, key.seed, key.firstSide];
  await env.DB.batch([
    matchStatement(env, report, score, ratings, [left.rating, right.rating], reporter, null, now),
    env.DB.prepare(INSERT_CHANGE).bind(left.sha256, left.rating_seq + 1, ...keyBinds, left.rating, ratings.left),
    env.DB.prepare(INSERT_CHANGE).bind(right.sha256, right.rating_seq + 1, ...keyBinds, right.rating, ratings.right),
    env.DB.prepare(UPDATE_STANDING).bind(ratings.left, left.rating_seq + 1, score.leftWins, score.rightWins, score.draws, left.sha256),
    env.DB.prepare(UPDATE_STANDING).bind(ratings.right, right.rating_seq + 1, score.rightWins, score.leftWins, score.draws, right.sha256),
  ]);
  return { left: { before: left.rating, after: ratings.left }, right: { before: right.rating, after: ratings.right } };
}

function answerExisting(existing: MatchRow, report: MatchReport): Response {
  if (existing.moves !== canonicalMoves(report)) return reject(409, ['A different result for this match (same programs, seed and first side) is already recorded.']);
  return Response.json({ existing: true, match: { id: existing.id, status: existing.status, leftWins: existing.left_wins, rightWins: existing.right_wins, draws: existing.draws } });
}

async function record(env: MatchReportEnv, report: MatchReport, score: MatchScore, reporter: string, unrated: string | null, now: Date): Promise<Response> {
  const key = matchKey(report);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const existing = await env.DB.prepare(FIND_MATCH).bind(key.shaLo, key.shaHi, key.seed, key.firstSide).first<MatchRow>();
    if (existing) return answerExisting(existing, report);
    try {
      const ratings = await writeOnce(env, report, score, reporter, unrated, now);
      const row = await env.DB.prepare(FIND_MATCH).bind(key.shaLo, key.shaHi, key.seed, key.firstSide).first<MatchRow>();
      const match = { id: row?.id ?? null, status: unrated ? 'unrated' : 'counted', unratedReason: unrated, leftWins: score.leftWins, rightWins: score.rightWins, draws: score.draws };
      return Response.json({ match, ratings }, { status: 201 });
    } catch {
      // A concurrent report claimed the same rating step or the same match; re-read and retry.
    }
  }
  return reject(503, ['The match could not be recorded right now; nothing was stored. Try again.']);
}

export async function handleMatchReport(env: MatchReportEnv, request: Request, deps: MatchReportDeps = {}): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    if (!env.TURNSTILE_SECRET || !env.UPLOADER_SALT) {
      console.error('match reports unavailable: TURNSTILE_SECRET or UPLOADER_SALT is not configured');
      return reject(503, ['Match results cannot be recorded right now.']);
    }
    const token = request.headers.get('x-turnstile-token');
    if (!token) return reject(400, ['The report is missing its Turnstile token.']);
    const address = request.headers.get('cf-connecting-ip') ?? '';
    const turnstile = await verifyTurnstile(deps.fetcher ?? fetch, env.TURNSTILE_SECRET, token, address);
    if (turnstile !== 'ok') return reject(turnstile === 'failed' ? 403 : 503, ['The bot check could not be verified; nothing was stored.']);
    const reporter = await hashUploader(env.UPLOADER_SALT, address);
    const limit = dailyLimit(env.REPORT_DAILY_LIMIT, MAX_REPORTS_PER_DAY);
    if (!(await consumeQuota(env.DB, 'report_quota', quotaBucket(reporter, now), limit))) return reject(429, [`The daily limit of ${limit} match reports is used up.`]);

    if (Number(request.headers.get('content-length') ?? 0) > MAX_REPORT_BYTES) return reject(413, ['The report is too large.']);
    const text = await request.text();
    if (text.length > MAX_REPORT_BYTES) return reject(413, ['The report is too large.']);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return reject(400, ['The report is not valid JSON.']);
    }
    const parsed = parseReport(raw);
    if ('reasons' in parsed) return reject(400, parsed.reasons);
    const admitted = await admit(env, parsed.report);
    if ('reasons' in admitted) return reject(admitted.status, admitted.reasons);
    return await record(env, parsed.report, admitted.score, reporter, unratedReason(admitted.score), now);
  } catch (err) {
    console.error('match report failed', err);
    return reject(503, ['The match could not be recorded right now; nothing was stored.']);
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RATED_SETTINGS } from '../arena/src/match/rated';
import { opponent, type Side } from '../arena/src/referee/types';
import { TURNSTILE_TEST_SECRET } from './abuse';
import { rateMatch, replayRatings } from './elo';
import { finishedGame, randomGame } from './games.test-support';
import { startLocalEnv, type LocalEnv } from './local-env.test-support';
import { handleMatchReport, type MatchReportEnv } from './match-report';
import { insertRow, sampleRow, sha } from './rows.test-support';
import type { ReportedResult } from './verify-game';

const A = sha('a');
const B = sha('b');
const C = sha('c');

let local: LocalEnv;
let env: MatchReportEnv;
beforeAll(async () => {
  local = await startLocalEnv();
}, 60_000);
afterAll(() => local.dispose());
beforeEach(async () => {
  await local.reset();
  env = { ...local.env, TURNSTILE_SECRET: TURNSTILE_TEST_SECRET, UPLOADER_SALT: 'salt' };
  for (const [sha256, uploader] of [[A, 'u-a'], [B, 'u-b'], [C, 'u-c']] as const) await insertRow(local.env.DB, sampleRow({ sha256, uploader }));
});

type Game = { moves: [number, number][]; result: ReportedResult };
interface Body {
  left: string;
  right: string;
  leftSide: Side;
  firstSide: Side;
  seed: number;
  settings: typeof RATED_SETTINGS;
  games: Game[];
}

const body = (overrides: Partial<Body> = {}): Body => ({
  left: A,
  right: B,
  leftSide: 'red',
  firstSide: 'red',
  seed: 7,
  settings: RATED_SETTINGS,
  games: [finishedGame(1, 'red'), finishedGame(2, 'red')],
  ...overrides,
});

function request(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://arena.test/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-turnstile-token': 'token', 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

const report = (payload: unknown, headers?: Record<string, string>) => handleMatchReport(env, request(payload, headers));

/** The left program's points over both games, from the results as the seats saw them. */
function leftPoints(b: Body): number {
  return b.games.reduce((points, game, i) => {
    const leftSide = i === 0 ? b.leftSide : opponent(b.leftSide);
    if (game.result.winner === null) return points + 0.5;
    return points + (game.result.winner === leftSide ? 1 : 0);
  }, 0);
}

const rows = async (sql: string, ...binds: unknown[]) => (await local.env.DB.prepare(sql).bind(...binds).all()).results;
const entrant = async (sha256: string) =>
  (await local.env.DB.prepare('SELECT rating, rating_seq, rated_matches, game_wins, game_losses, game_draws FROM entrants WHERE sha256 = ?').bind(sha256).first())!;

describe('POST /api/matches', () => {
  it('records a rated match and moves both ratings by equal and opposite amounts', async () => {
    const b = body();
    const response = await report(b);
    expect(response.status).toBe(201);
    const answer = (await response.json()) as { match: { status: string; leftWins: number; rightWins: number; draws: number }; ratings: { left: { before: number; after: number }; right: { before: number; after: number } } };
    const expected = rateMatch(1000, 1000, leftPoints(b));
    expect(answer.match.status).toBe('counted');
    expect(answer.ratings).toEqual({ left: { before: 1000, after: expected.left }, right: { before: 1000, after: expected.right } });
    expect(answer.match.leftWins + answer.match.rightWins + answer.match.draws).toBe(2);

    expect(await entrant(A)).toMatchObject({ rating: expected.left, rating_seq: 1, rated_matches: 1, game_wins: answer.match.leftWins, game_losses: answer.match.rightWins, game_draws: answer.match.draws });
    expect(await entrant(B)).toMatchObject({ rating: expected.right, rating_seq: 1, rated_matches: 1, game_wins: answer.match.rightWins });
    expect(await rows('SELECT left_sha, right_sha, status, left_wins, right_wins, draws FROM matches')).toEqual([
      { left_sha: A, right_sha: B, status: 'counted', left_wins: answer.match.leftWins, right_wins: answer.match.rightWins, draws: answer.match.draws },
    ]);
    expect(await rows('SELECT sha256, seq FROM rating_changes ORDER BY sha256')).toEqual([{ sha256: A, seq: 1 }, { sha256: B, seq: 1 }]);
  });

  it('answers a repeated report with the recorded match, even with the seats swapped', async () => {
    const b = body();
    expect((await report(b)).status).toBe(201);
    expect((await report(b)).status).toBe(200);
    // B on the left, Red first again: game 1 is the original game 2 and vice versa.
    const swapped = body({ left: B, right: A, games: [b.games[1]!, b.games[0]!] });
    const again = await report(swapped);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ existing: true });
    expect(await rows('SELECT id FROM matches')).toHaveLength(1);
    expect(await entrant(A)).toMatchObject({ rating_seq: 1, rated_matches: 1 });
  });

  it('refuses a different result for a match already recorded (409), changing nothing', async () => {
    expect((await report(body())).status).toBe(201);
    const before = await entrant(A);
    const conflicting = await report(body({ games: [finishedGame(3, 'red'), finishedGame(4, 'red')] }));
    expect(conflicting.status).toBe(409);
    expect(await entrant(A)).toEqual(before);
  });

  it('records only matches at the standard settings', async () => {
    const response = await report(body({ settings: { ...RATED_SETTINGS, nodeBudget: 5_000 } }));
    expect(response.status).toBe(400);
    expect(await rows('SELECT id FROM matches')).toEqual([]);
  });

  it('refuses unknown, hidden or old-rules programs, and a program against itself', async () => {
    await local.env.DB.prepare("UPDATE entrants SET status = 'hidden' WHERE sha256 = ?").bind(C).run();
    expect((await report(body({ right: sha('d') }))).status).toBe(404);
    expect((await report(body({ right: C }))).status).toBe(404);
    await local.env.DB.prepare("UPDATE entrants SET status = 'listed', rules_id = 'desktop-jungle-v1' WHERE sha256 = ?").bind(C).run();
    expect((await report(body({ right: C }))).status).toBe(404);
    expect((await report(body({ right: A }))).status).toBe(400);
    expect(await rows('SELECT id FROM matches')).toEqual([]);
  });

  it('refuses a game that is not legal or does not end as reported', async () => {
    const [g1, g2] = body().games as [Game, Game];
    const illegal = { ...g1, moves: [[0, 2] as [number, number], ...g1.moves.slice(1)] };
    const misreported: Game = { ...g2, result: { status: 'drawn', winner: null, reason: g2.result.reason === 'no-capture' ? 'repetition' : 'no-capture' } };
    for (const games of [[illegal, g2], [g1, misreported]]) {
      const response = await report(body({ games }));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { reasons: string[] }).reasons[0]).toMatch(/^Game [12]:/);
    }
    expect(await rows('SELECT id FROM matches')).toEqual([]);
  });

  it('records a match with a forfeit as unrated and leaves ratings alone', async () => {
    const { moves, trail } = randomGame(9, 'red', 6);
    const forfeit: Game = { moves, result: { status: 'forfeited', winner: opponent(trail.at(-1)!.toPlay), reason: 'timeout' } };
    const response = await report(body({ games: [finishedGame(1, 'red'), forfeit] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ match: { status: 'unrated' }, ratings: null });
    expect(await entrant(A)).toMatchObject({ rating: 1000, rating_seq: 0, rated_matches: 0 });
    expect(await rows('SELECT status, unrated_reason FROM matches')).toEqual([{ status: 'unrated', unrated_reason: expect.stringMatching(/forfeit/) }]);
  });

  it('counts a match between two programs from one uploader (the curator uploads most programs)', async () => {
    await local.env.DB.prepare("UPDATE entrants SET uploader = 'u-a' WHERE sha256 = ?").bind(B).run();
    const response = await report(body());
    expect(response.status).toBe(201);
    const answer = (await response.json()) as { match: { status: string }; ratings: unknown };
    expect(answer.match.status).toBe('counted');
    expect(answer.ratings).not.toBeNull();
    expect(await entrant(B)).toMatchObject({ rated_matches: 1 });
  });

  it('needs a Turnstile token and keeps to the daily limit', async () => {
    expect((await report(body(), { 'x-turnstile-token': '' })).status).toBe(400);
    env = { ...env, REPORT_DAILY_LIMIT: '1' };
    expect((await report(body())).status).toBe(201);
    expect((await report(body({ seed: 8 }))).status).toBe(429);
  });

  it('refuses a malformed or oversized report', async () => {
    expect((await report('{not json')).status).toBe(400);
    expect((await report({ ...body(), games: [] })).status).toBe(400);
    expect((await report({ ...body(), seed: -1 })).status).toBe(400);
    const huge = 'x'.repeat(70_000);
    expect((await report(huge, { 'content-length': String(huge.length) })).status).toBe(413);
    expect(await rows('SELECT id FROM matches')).toEqual([]);
  });

  it('applies concurrent reports for one program one after the other', async () => {
    const [ab, ac] = await Promise.all([report(body({ seed: 1 })), report(body({ right: C, seed: 2 }))]);
    expect([ab.status, ac.status]).toEqual([201, 201]);
    const counted = (await rows("SELECT left_sha, right_sha, left_wins, right_wins, draws FROM matches WHERE status = 'counted' ORDER BY id")) as {
      left_sha: string; right_sha: string; left_wins: number; right_wins: number; draws: number;
    }[];
    const replayed = replayRatings(counted.map((m) => ({ left: m.left_sha, right: m.right_sha, leftWins: m.left_wins, rightWins: m.right_wins, draws: m.draws })));
    for (const program of [A, B, C]) expect((await entrant(program)).rating).toBeCloseTo(replayed.get(program)!.rating, 9);
    expect(await entrant(A)).toMatchObject({ rating_seq: 2, rated_matches: 2 });
  });
});

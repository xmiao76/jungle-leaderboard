import { describe, expect, it, vi } from 'vitest';
import type { MatchResult } from './controller';
import { buildMatchReport, postMatchReport } from './report';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const settings = { leftSide: 'red', firstSide: 'red', seed: 42, difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 5_000 } as const;
const won: MatchResult = { kind: 'board', status: 'won', winner: 'blue', winnerSeat: 'right', reason: 'den', endRev: 3, forfeit: null };
const drawn: MatchResult = { kind: 'board', status: 'drawn', winner: null, winnerSeat: null, reason: 'repetition', endRev: 2, forfeit: null };
const forfeited: MatchResult = {
  kind: 'forfeit', status: 'forfeited', winner: 'red', winnerSeat: 'left', reason: 'timeout', endRev: 1,
  forfeit: { seat: 'right', side: 'blue', reason: 'timeout', message: 'deadline', elapsedMs: 5_000, deadlineMs: 5_000 },
};
const moves = [{ src: 42, dst: 35 }, { src: 20, dst: 27 }, { src: 35, dst: 28 }];

describe('buildMatchReport', () => {
  it('carries both programs, the settings and each game as moves plus result', () => {
    const body = buildMatchReport({ left: A, right: B, settings, games: [{ result: won, moves }, { result: drawn, moves: moves.slice(0, 2) }] });
    expect(body).toEqual({
      left: A,
      right: B,
      leftSide: 'red',
      firstSide: 'red',
      seed: 42,
      settings: { difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 5_000 },
      games: [
        { moves: [[42, 35], [20, 27], [35, 28]], result: { status: 'won', winner: 'blue', reason: 'den' } },
        { moves: [[42, 35], [20, 27]], result: { status: 'drawn', winner: null, reason: 'repetition' } },
      ],
    });
  });

  it('reports a forfeit as such, and nothing for a match without two results', () => {
    const body = buildMatchReport({ left: A, right: B, settings, games: [{ result: won, moves }, { result: forfeited, moves: [moves[0]!] }] });
    expect(body?.games[1]?.result).toEqual({ status: 'forfeited', winner: 'red', reason: 'timeout' });
    const systemError: MatchResult = { kind: 'system-error', message: 'boom', endRev: 0 };
    expect(buildMatchReport({ left: A, right: B, settings, games: [{ result: won, moves }, { result: systemError, moves: [] }] })).toBeNull();
    expect(buildMatchReport({ left: A, right: B, settings, games: [{ result: won, moves }] })).toBeNull();
  });
});

describe('postMatchReport', () => {
  const ENDPOINT = new URL('https://arena.example/api/matches');
  const body = buildMatchReport({ left: A, right: B, settings, games: [{ result: won, moves }, { result: drawn, moves }] })!;
  const answer = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));

  it('posts JSON with the Turnstile token and returns the rating change', async () => {
    const ratings = { left: { before: 1000, after: 1016 }, right: { before: 1000, after: 984 } };
    const fetcher = answer(201, { match: { status: 'counted' }, ratings });
    expect(await postMatchReport(body, 'tok', ENDPOINT, fetcher)).toEqual({ state: 'counted', ratings });
    const [, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(new Headers(init.headers).get('x-turnstile-token')).toBe('tok');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('tells an unrated match, an already recorded one and a refusal apart', async () => {
    expect(await postMatchReport(body, 't', ENDPOINT, answer(201, { match: { status: 'unrated', unratedReason: 'A game ended by forfeit.' }, ratings: null }))).toEqual({
      state: 'unrated',
      reason: 'A game ended by forfeit.',
    });
    expect(await postMatchReport(body, 't', ENDPOINT, answer(200, { existing: true, match: { status: 'counted' } }))).toEqual({ state: 'already' });
    expect(await postMatchReport(body, 't', ENDPOINT, answer(409, { reasons: ['A different result is recorded.'] }))).toEqual({ state: 'failed', reasons: ['A different result is recorded.'] });
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await postMatchReport(body, 't', ENDPOINT, offline)).toEqual({ state: 'failed', reasons: ['The Arena could not be reached: Failed to fetch'] });
  });
});

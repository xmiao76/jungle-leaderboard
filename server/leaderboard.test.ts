import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLeaderboardGet } from './leaderboard';
import { startLocalEnv, type LocalEnv } from './local-env.test-support';
import { insertRow, sampleRow, sha } from './rows.test-support';

let local: LocalEnv;
beforeAll(async () => {
  local = await startLocalEnv();
}, 60_000);
afterAll(() => local.dispose());
beforeEach(() => local.reset());

interface Standing {
  rating?: number;
  ratedMatches?: number;
  wins?: number;
  losses?: number;
  draws?: number;
}

/** Insert an entrant, then set its rating columns (which `insertRow` leaves at their defaults). */
async function standing(sha256: string, s: Standing = {}, row: Parameters<typeof sampleRow>[0] = {}): Promise<void> {
  await insertRow(local.env.DB, sampleRow({ sha256, ...row }));
  await local.env.DB
    .prepare('UPDATE entrants SET rating = ?, rated_matches = ?, game_wins = ?, game_losses = ?, game_draws = ? WHERE sha256 = ?')
    .bind(s.rating ?? 1000, s.ratedMatches ?? 0, s.wins ?? 0, s.losses ?? 0, s.draws ?? 0, sha256)
    .run();
}

async function entries(): Promise<Record<string, unknown>[]> {
  const response = await handleLeaderboardGet(local.env);
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: Record<string, unknown>[] }).entries;
}

describe('GET /api/leaderboard', () => {
  it('serves an empty leaderboard as JSON with no-cache', async () => {
    const response = await handleLeaderboardGet(local.env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.json()).toEqual({ entries: [] });
  });

  it('maps a fresh entrant to 1000, provisional, with no games played', async () => {
    await standing(sha('a'));
    expect(await entries()).toEqual([
      {
        sha256: sha('a'),
        title: 'Jungle — test',
        gameVersion: '1.0.0',
        model: 'Model-X',
        codeAgent: 'Agent-Y',
        modelPlatform: 'official',
        githubUrl: 'https://github.com/example/jungle',
        rating: 1000,
        ratedMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        provisional: true,
        addedAt: '2026-11-21T10:00:00.000Z',
      },
    ]);
  });

  it('orders by rating, then rated matches, then oldest first', async () => {
    await standing(sha('c'), { rating: 1000, ratedMatches: 3 }, { created_at: '2026-11-22T09:00:00.000Z' });
    await standing(sha('a'), { rating: 1016 });
    await standing(sha('b'), { rating: 1000, ratedMatches: 3 }, { created_at: '2026-11-21T09:00:00.000Z' });
    await standing(sha('d'), { rating: 1000, ratedMatches: 7 });
    expect((await entries()).map((e) => e['sha256'])).toEqual([sha('a'), sha('d'), sha('b'), sha('c')]);
  });

  it('carries the games record and drops the provisional flag at five rated matches', async () => {
    await standing(sha('a'), { rating: 1032.5, ratedMatches: 4, wins: 5, losses: 2, draws: 1 });
    await standing(sha('b'), { rating: 990, ratedMatches: 5, wins: 4, losses: 5, draws: 1 });
    const [a, b] = await entries();
    expect([a!['rating'], a!['wins'], a!['losses'], a!['draws'], a!['provisional']]).toEqual([1032.5, 5, 2, 1, true]);
    expect(b!['provisional']).toBe(false);
  });

  it('lists only listed entrants built for the current rules', async () => {
    await standing(sha('a'));
    await standing(sha('b'), {}, { status: 'hidden' });
    await standing(sha('c'), {}, { rules_id: 'desktop-jungle-v1', rules_digest: 'a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63' });
    expect((await entries()).map((e) => e['sha256'])).toEqual([sha('a')]);
  });

  it('answers 503 without internal details when the database fails, and logs the cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...local.env, DB: { prepare: () => { throw new Error('D1_ERROR: secret internals'); } } } as unknown as Env;
    const response = await handleLeaderboardGet(broken);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret internals');
    expect(logged).toHaveBeenCalledWith('leaderboard read failed', expect.objectContaining({ message: 'D1_ERROR: secret internals' }));
    logged.mockRestore();
  });
});

// GET /api/leaderboard — every published program's Elo standing; see server/leaderboard.ts.
import { handleLeaderboardGet } from '../../../server/leaderboard';

export const onRequestGet: PagesFunction<Env> = ({ env }) => handleLeaderboardGet(env);

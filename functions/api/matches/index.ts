// POST /api/matches — record one finished two-game match; see server/match-report.ts.
import { handleMatchReport, type MatchReportEnv } from '../../../server/match-report';

export const onRequestPost: PagesFunction<MatchReportEnv> = ({ env, request }) => handleMatchReport(env, request);

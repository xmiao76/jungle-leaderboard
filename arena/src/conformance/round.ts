/**
 * The upload round: what a program must pass, after admission, before it is published.
 * - Behaviour checks: rendering never changes a choice; two instances stay isolated; flipping
 *   changes only the view (conformance/checks.ts, shared with the conformance page).
 * - One match round against the Arena's reference program, exactly as in match play: two games
 *   from `planSeries`, so the upload moves first in game 1 and the reference in game 2.
 * Pass: every check passes and both games end on the board (den, elimination, immobilization,
 * repetition or no-capture) with no forfeit by the upload and no system error. The score does not
 * matter. Runs headless on real workers; browser-only, covered by e2e.
 */
import type { TranspiledEntrant } from '../loader/guest';
import type { Metadata } from '../referee/types';
import { CONFORMANCE_SETTINGS, entrantFrom, loadOpponent, playMatch, renderDoesNotChangeChoice, twoInstancesAndFlip, type CheckResult, type MatchSummary } from './checks';

export type RoundStage = 'checks' | 'game-1' | 'game-2';
export const ROUND_STAGES: readonly RoundStage[] = ['checks', 'game-1', 'game-2'];

export interface UploadReport {
  readonly settings: typeof CONFORMANCE_SETTINGS;
  readonly checks: readonly CheckResult[];
  readonly opponent: { readonly sha256: string; readonly title: string; readonly gameVersion: string } | null;
  readonly games: readonly { readonly game: 1 | 2; readonly entrantSide: string; readonly result: string; readonly plies: number }[];
  readonly userAgent: string;
}

export type RoundOutcome =
  | { readonly ok: true; readonly report: UploadReport }
  | { readonly ok: false; readonly stage: RoundStage; readonly reasons: readonly string[]; readonly report: UploadReport };

export interface RoundProgress {
  onStage(stage: RoundStage): void;
  onPly(stage: RoundStage, plies: number): void;
}

const describeGame = (m: MatchSummary) =>
  !m.result ? 'no result' : m.result.kind === 'system-error' ? `system error: ${m.result.message}` : `${m.result.status}/${m.result.winner ?? 'none'}/${m.result.reason}`;

function gameFailure(m: MatchSummary): string {
  if (!m.result) return 'The game produced no result.';
  if (m.result.kind === 'system-error') return `The game stopped with a system error: ${m.result.message}`;
  return `The uploaded program forfeited (${m.result.reason}): ${m.result.forfeit?.message ?? 'see the replay'}`;
}

export async function runUploadRound(sha256: string, metadata: Metadata, artifact: TranspiledEntrant, progress: RoundProgress): Promise<RoundOutcome> {
  const checks: CheckResult[] = [];
  const games: UploadReport['games'][number][] = [];
  let opponent: UploadReport['opponent'] = null;
  const report = (): UploadReport => ({ settings: CONFORMANCE_SETTINGS, checks, opponent, games, userAgent: navigator.userAgent });
  const fail = (stage: RoundStage, reasons: readonly string[]): RoundOutcome => ({ ok: false, stage, reasons, report: report() });

  progress.onStage('checks');
  checks.push(await renderDoesNotChangeChoice(artifact), ...(await twoInstancesAndFlip(artifact)));
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) return fail('checks', failed.map((c) => `${c.name}: ${c.detail}`));

  progress.onStage('game-1');
  let reference;
  try {
    reference = await loadOpponent();
  } catch (err) {
    return fail('game-1', [`The Arena's reference program could not be loaded: ${err instanceof Error ? err.message : String(err)}`]);
  }
  opponent = { sha256: reference.sha256, title: reference.metadata.title, gameVersion: reference.metadata.gameVersion };
  const upload = entrantFrom(sha256, metadata, artifact);

  // planSeries with the upload in the left seat as Red, Red first: game 2 swaps the colours.
  const plan: readonly [RoundStage, 'red' | 'blue'][] = [['game-1', 'red'], ['game-2', 'blue']];
  for (const [stage, side] of plan) {
    progress.onStage(stage);
    const [red, blue] = side === 'red' ? [upload, reference] : [reference, upload];
    const summary = await playMatch(stage, red, blue, side, sha256, (plies) => progress.onPly(stage, plies));
    games.push({ game: stage === 'game-1' ? 1 : 2, entrantSide: side, result: describeGame(summary), plies: summary.plies });
    if (!summary.ok) return fail(stage, [gameFailure(summary)]);
  }
  return { ok: true, report: report() };
}

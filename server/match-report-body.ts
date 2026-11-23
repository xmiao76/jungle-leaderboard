/**
 * The body of `POST /api/matches` (pure: parsing, scoring, the one-report-per-match key).
 *
 *   { left, right, leftSide, firstSide, seed, settings: { difficulty, nodeBudget, thinkDeadlineMs },
 *     games: [ { moves: [[src, dst], …], result: { status, winner, reason } } × 2 ] }
 *
 * Game 1 is played with the left program on `leftSide`; game 2 swaps the colours and keeps the
 * same first side (`planSeries` in arena/src/match/series.ts).
 */
import type { RatedSettings } from '../arena/src/match/rated';
import { LEVELS, opponent, type Side } from '../arena/src/referee/types';
import type { ReportedResult } from './verify-game';

export interface ReportedGame {
  readonly moves: readonly (readonly [number, number])[];
  readonly result: ReportedResult;
}

export interface MatchReport {
  readonly left: string;
  readonly right: string;
  readonly leftSide: Side;
  readonly firstSide: Side;
  readonly seed: number;
  readonly settings: RatedSettings;
  readonly games: readonly [ReportedGame, ReportedGame];
}

export type GameResult = 'left' | 'right' | 'draw';

export interface MatchScore {
  readonly games: readonly { readonly result: GameResult; readonly reason: string; readonly plies: number }[];
  readonly leftWins: number;
  readonly rightWins: number;
  readonly draws: number;
  readonly hasForfeit: boolean;
}

const SHA = /^[0-9a-f]{64}$/;
const SIDES: readonly string[] = ['red', 'blue'];
const STATUSES: readonly string[] = ['won', 'drawn', 'forfeited'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMove = (m: unknown): m is [number, number] => Array.isArray(m) && m.length === 2 && m.every((n) => Number.isInteger(n));

function parseGame(raw: unknown, n: number, reasons: string[]): ReportedGame | null {
  if (!isRecord(raw) || !Array.isArray(raw['moves']) || !isRecord(raw['result'])) {
    reasons.push(`Game ${n} needs moves and a result.`);
    return null;
  }
  const moves = raw['moves'];
  const result = raw['result'];
  if (!moves.every(isMove)) reasons.push(`Game ${n}: every move is a pair of whole numbers.`);
  const winner = result['winner'];
  if (!STATUSES.includes(result['status'] as string) || !(winner === null || SIDES.includes(winner as string)) || typeof result['reason'] !== 'string') {
    reasons.push(`Game ${n}: the result needs a status, a winner (or null) and a reason.`);
  }
  return { moves: moves as [number, number][], result: { status: result['status'] as ReportedResult['status'], winner: winner as Side | null, reason: result['reason'] as string } };
}

function parseSettings(raw: unknown, reasons: string[]): RatedSettings | null {
  if (!isRecord(raw) || !LEVELS.includes(raw['difficulty'] as never) || !Number.isInteger(raw['nodeBudget']) || !Number.isInteger(raw['thinkDeadlineMs'])) {
    reasons.push('The settings need a difficulty, a node budget and a think deadline.');
    return null;
  }
  return { difficulty: raw['difficulty'] as RatedSettings['difficulty'], nodeBudget: raw['nodeBudget'] as number, thinkDeadlineMs: raw['thinkDeadlineMs'] as number };
}

export function parseReport(raw: unknown): { report: MatchReport } | { reasons: string[] } {
  if (!isRecord(raw)) return { reasons: ['The report is not a JSON object.'] };
  const reasons: string[] = [];
  const { left, right, leftSide, firstSide, seed } = raw;
  if (typeof left !== 'string' || !SHA.test(left) || typeof right !== 'string' || !SHA.test(right)) reasons.push('left and right must be SHA-256 hashes.');
  if (!SIDES.includes(leftSide as string) || !SIDES.includes(firstSide as string)) reasons.push('leftSide and firstSide must be red or blue.');
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffff_ffff) reasons.push('seed must be a whole number from 0 to 4294967295.');
  const settings = parseSettings(raw['settings'], reasons);
  const games = Array.isArray(raw['games']) && raw['games'].length === 2 ? raw['games'].map((g, i) => parseGame(g, i + 1, reasons)) : null;
  if (!games) reasons.push('A match has exactly two games.');
  if (reasons.length > 0 || !settings || !games || games.some((g) => g === null)) return { reasons };
  return {
    report: { left: left as string, right: right as string, leftSide: leftSide as Side, firstSide: firstSide as Side, seed: seed as number, settings, games: games as [ReportedGame, ReportedGame] },
  };
}

/** The left program's colour in game 1 and game 2. */
const leftSideIn = (report: MatchReport, game: 0 | 1): Side => (game === 0 ? report.leftSide : opponent(report.leftSide));

export function scoreMatch(report: MatchReport): MatchScore {
  const games = report.games.map((g, i) => {
    const winner = g.result.winner;
    const result: GameResult = winner === null ? 'draw' : winner === leftSideIn(report, i as 0 | 1) ? 'left' : 'right';
    return { result, reason: g.result.reason, plies: g.moves.length };
  });
  const count = (r: GameResult) => games.filter((g) => g.result === r).length;
  return { games, leftWins: count('left'), rightWins: count('right'), draws: count('draw'), hasForfeit: report.games.some((g) => g.result.status === 'forfeited') };
}

/** The same pair, seed and first side always produce the same two games, in some seat order. */
export function matchKey(report: MatchReport): { readonly shaLo: string; readonly shaHi: string; readonly seed: number; readonly firstSide: Side } {
  const [shaLo, shaHi] = [report.left, report.right].sort() as [string, string];
  return { shaLo, shaHi, seed: report.seed, firstSide: report.firstSide };
}

/** Both games' moves keyed by colour, independent of seat order: stored, and compared on a re-report. */
export function canonicalMoves(report: MatchReport): string {
  const games = report.games.map((g, i) => {
    const leftIsRed = leftSideIn(report, i as 0 | 1) === 'red';
    return { red: leftIsRed ? report.left : report.right, blue: leftIsRed ? report.right : report.left, moves: g.moves, result: g.result };
  });
  return JSON.stringify(games.sort((a, b) => a.red.localeCompare(b.red)));
}

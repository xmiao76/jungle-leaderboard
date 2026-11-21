/** Human-readable labels for the Arena UI. All metadata is rendered as text, never HTML. */
import type { MatchPhase, MatchResult, SeatActivity } from '../match/controller';
import type { Seat } from '../protocol/messages';
import type { Side, Snapshot } from '../referee/types';

export const seatLabel = (seat: Seat) => (seat === 'left' ? 'Left seat' : 'Right seat');
export const sideLabel = (side: Side) => (side === 'red' ? 'Red' : 'Blue');
export const shortHash = (sha256: string) => `${sha256.slice(0, 8)}…${sha256.slice(-4)}`;

export const PHASE_LABEL: Readonly<Record<MatchPhase, string>> = {
  loading: 'Loading entrants',
  ready: 'Ready',
  running: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
  failed: 'Stopped',
  disposed: 'Closed',
};

export const ACTIVITY_LABEL: Readonly<Record<SeatActivity, string>> = {
  loading: 'loading',
  idle: 'waiting',
  thinking: 'thinking',
  rendering: 'drawing',
  restarting: 'restarting',
  dead: 'unavailable',
};

const REASON_TEXT: Readonly<Record<string, string>> = {
  den: 'reached the enemy den',
  elimination: 'captured every enemy piece',
  immobilization: 'left the opponent without a legal move',
  'no-capture': '100 plies passed without a capture',
  timeout: 'the opponent ran out of time',
  trap: 'the opponent crashed',
  'invalid-move': 'the opponent proposed an invalid move',
};

export function describeResult(result: MatchResult | null, sideNames: Record<Side, string>): string {
  if (!result) return '';
  if (result.kind === 'system-error') return `System error — no board result. ${result.message}`;
  if (result.status === 'drawn') return `Draw: ${REASON_TEXT[result.reason] ?? result.reason}.`;
  if (!result.winner) return 'Game over.';
  return `${sideLabel(result.winner)} wins (${sideNames[result.winner]}): ${REASON_TEXT[result.reason] ?? result.reason}.`;
}

/** Move number shown to people: the ply about to be played, or the last one when over. */
export function moveNumber(snapshot: Snapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.status === 'playing' ? snapshot.history.length + 1 : snapshot.history.length;
}

const COLS = 7;
/** Squares as both the wire number and a column/row coordinate, e.g. `42 (a7)`. */
export function squareName(square: number): string {
  return `${square} (${String.fromCharCode(97 + (square % COLS))}${9 - Math.floor(square / COLS)})`;
}

/**
 * Replay format v1. A replay records the decisions, never reruns a search: both seat
 * hashes and metadata, the rules identity, the starting snapshot and settings, every
 * committed ply (with its captured piece and quiet counter as lossless deltas), and
 * the result — including an explicit wall-clock timeout record.
 */
import type { ForfeitRecord, MatchResult, PlyRecord } from '../match/controller';
import type { Seat } from '../protocol/messages';
import { applyMove, forfeit, initialSnapshot, RULES_DIGEST, RULES_ID } from '../referee';
import type { Level, Metadata, Side, Snapshot } from '../referee/types';

export const REPLAY_FORMAT = 'jungle-arena-replay';
export const REPLAY_VERSION = 1;

export interface ReplaySeat {
  readonly sha256: string;
  readonly size: number;
  readonly metadata: Metadata;
  readonly side: Side;
}

export interface ReplayV1 {
  readonly format: typeof REPLAY_FORMAT;
  readonly version: typeof REPLAY_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly arena: { readonly version: string; readonly loaderVersion: string };
  readonly rules: { readonly id: string; readonly digest: string };
  /**
   * Which game of a two-game match this is (match/series.ts). Optional: replays from
   * before matches had two games, and imported ones, may not carry it.
   */
  readonly series?: { readonly id: string; readonly game: number; readonly of: number };
  readonly seats: Readonly<Record<Seat, ReplaySeat>>;
  readonly settings: {
    readonly firstSide: Side;
    readonly seed: number;
    readonly difficulty: Level;
    readonly nodeBudget: number;
    readonly deadlines: { readonly load: number; readonly think: number; readonly render: number };
  };
  readonly initial: Snapshot;
  readonly plies: readonly PlyRecord[];
  readonly result: MatchResult | null;
  /** The terminal snapshot (needed for a forfeit, which adds a revision without a ply). */
  readonly final: Snapshot | null;
}

export function withPly(replay: ReplayV1, ply: PlyRecord): ReplayV1 {
  return { ...replay, plies: [...replay.plies, ply] };
}

export function withResult(replay: ReplayV1, result: MatchResult, final: Snapshot | null): ReplayV1 {
  return { ...replay, result, final };
}

/** Every official snapshot from rev 0 to the end, rebuilt by the referee from the record. */
export function replaySnapshots(replay: ReplayV1): Snapshot[] {
  const snapshots: Snapshot[] = [replay.initial];
  let current = replay.initial;
  for (const ply of replay.plies) {
    current = applyMove(current, ply.move);
    snapshots.push(current);
  }
  const result = replay.result;
  if (result && result.kind === 'forfeit' && result.forfeit && current.status === 'playing') {
    snapshots.push(forfeit(current, result.forfeit.side, result.forfeit.reason));
  }
  return snapshots;
}

// ---- Validation of untrusted replay files ---------------------------------------------

export type ReplayCheck = { readonly ok: true; readonly replay: ReplayV1 } | { readonly ok: false; readonly issues: readonly string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHA = /^[0-9a-f]{64}$/;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateReplay(data: unknown): ReplayCheck {
  const issues: string[] = [];
  if (!isObject(data)) return { ok: false, issues: ['The file is not a JSON object.'] };
  if (data['format'] !== REPLAY_FORMAT) return { ok: false, issues: ['This is not a Jungle Arena replay file.'] };
  if (data['version'] !== REPLAY_VERSION) return { ok: false, issues: [`Unsupported replay version ${String(data['version'])}.`] };

  const rules = data['rules'];
  if (!isObject(rules) || rules['id'] !== RULES_ID || rules['digest'] !== RULES_DIGEST) {
    issues.push(`The replay was recorded under different rules (expected ${RULES_ID}).`);
  }
  const seats = data['seats'];
  if (!isObject(seats) || !isObject(seats['left']) || !isObject(seats['right'])) {
    issues.push('Seat records are missing.');
  } else {
    for (const seat of ['left', 'right'] as const) {
      const s = seats[seat] as Record<string, unknown>;
      if (typeof s['sha256'] !== 'string' || !SHA.test(s['sha256'])) issues.push(`The ${seat} seat hash is malformed.`);
      if (!isObject(s['metadata'])) issues.push(`The ${seat} seat metadata is missing.`);
    }
  }
  if (!Array.isArray(data['plies'])) issues.push('The ply list is missing.');
  if (typeof data['id'] !== 'string' || typeof data['createdAt'] !== 'string') issues.push('The replay id or date is missing.');
  const series = data['series'];
  if (series !== undefined) {
    const ok = isObject(series) && typeof series['id'] === 'string'
      && Number.isInteger(series['of']) && (series['of'] as number) >= 1
      && Number.isInteger(series['game']) && (series['game'] as number) >= 1 && (series['game'] as number) <= (series['of'] as number);
    if (!ok) issues.push('The match (series) record is malformed.');
  }
  if (issues.length > 0) return { ok: false, issues };

  // Re-derive every snapshot through the referee: the record must reproduce itself.
  const replay = data as unknown as ReplayV1;
  try {
    const settings = replay.settings;
    if (!same(replay.initial, initialSnapshot(settings.firstSide))) {
      return { ok: false, issues: ['The starting position is not the standard opening for the recorded first side.'] };
    }
    const snapshots = replaySnapshots(replay);
    replay.plies.forEach((ply, i) => {
      const s = snapshots[i + 1]!;
      if (ply.rev !== s.rev || ply.noCapturePlies !== s.noCapturePlies) issues.push(`Ply ${i + 1} does not match the referee's replay.`);
    });
    const last = snapshots[snapshots.length - 1]!;
    if (replay.final && !same(replay.final, last)) issues.push('The recorded final position does not match the referee’s replay.');
    if (replay.result && replay.result.kind !== 'system-error' && replay.result.status !== last.status) {
      issues.push('The recorded result does not match the final position.');
    }
  } catch (err) {
    issues.push(`A recorded move is illegal: ${err instanceof Error ? err.message : String(err)}`);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, replay };
}

export function forfeitSummary(record: ForfeitRecord): string {
  const clock = record.deadlineMs !== null ? ` after ${(record.elapsedMs / 1000).toFixed(1)} s (deadline ${record.deadlineMs / 1000} s)` : '';
  return `${record.side} (${record.seat} seat) forfeited: ${record.reason}${clock}. ${record.message}`;
}

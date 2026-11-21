/**
 * Worker wire protocol. Every request and reply carries the envelope outside WIT:
 * `matchId`, `seat`, `requestId` and `rev`. Replies whose envelope does not match the
 * outstanding request are stale, duplicate, wrong-seat or canceled, and are ignored.
 */
import type { TranspiledEntrant } from '../loader/guest';
import type { SmokeReport } from '../loader/smoke';
import type { Level, Metadata, PlyMove, Side, Snapshot } from '../referee/types';

/** Arena columns. Independent of Red/Blue, which the visitor assigns per match. */
export type Seat = 'left' | 'right';
export const SEATS: readonly Seat[] = ['left', 'right'];

export interface Envelope {
  readonly matchId: string;
  readonly seat: Seat;
  readonly requestId: number;
  readonly rev: number;
}

// ---- Host → seat worker ---------------------------------------------------------

export interface InitRequest {
  readonly type: 'INIT';
  readonly env: Envelope;
  readonly artifact: TranspiledEntrant;
  readonly settings: { readonly side: Side; readonly difficulty: Level; readonly seed: number };
}
export interface ThinkRequest {
  readonly type: 'THINK';
  readonly env: Envelope;
  readonly snapshot: Snapshot;
  readonly legal: readonly PlyMove[];
  readonly nodeBudget: number;
}
export interface RenderRequest {
  readonly type: 'RENDER';
  readonly env: Envelope;
  readonly snapshot: Snapshot;
  readonly flipped: boolean;
  readonly progress: number;
}
export interface SmokeRequest {
  readonly type: 'SMOKE';
  readonly env: Envelope;
  readonly artifact: TranspiledEntrant;
}
export type SeatRequest = InitRequest | ThinkRequest | RenderRequest | SmokeRequest;

// ---- Seat worker → host ---------------------------------------------------------

export interface ReadyReply {
  readonly type: 'READY';
  readonly env: Envelope;
  readonly metadata: Metadata | null;
  readonly issues: readonly string[];
}
export interface ProposalReply {
  readonly type: 'PROPOSAL';
  readonly env: Envelope;
  readonly index: number;
  readonly thinkMs: number;
}
export interface FrameReply {
  readonly type: 'FRAME';
  readonly env: Envelope;
  readonly width: number;
  readonly height: number;
  /** Transferred, not copied. */
  readonly rgba: ArrayBuffer;
}
export interface SmokeReply {
  readonly type: 'SMOKE_REPORT';
  readonly env: Envelope;
  readonly report: SmokeReport;
}
export type ErrorKind = 'load' | 'trap' | 'invalid-frame' | 'protocol';
export interface ErrorReply {
  readonly type: 'ERROR';
  readonly env: Envelope;
  readonly phase: 'init' | 'think' | 'render' | 'smoke';
  readonly kind: ErrorKind;
  readonly message: string;
}
export type SeatReply = ReadyReply | ProposalReply | FrameReply | SmokeReply | ErrorReply;

// ---- Loader worker ----------------------------------------------------------------

export type LoaderStage = 'size' | 'header' | 'hash' | 'contract' | 'transpile';
export const LOADER_STAGES: readonly LoaderStage[] = ['size', 'header', 'hash', 'contract', 'transpile'];

export interface ValidateRequest {
  readonly type: 'VALIDATE';
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  /** Skip transpilation when a cached artifact for this hash and loader version exists. */
  readonly skipTranspile: boolean;
}
export interface ProgressReply {
  readonly type: 'PROGRESS';
  readonly requestId: number;
  readonly stage: LoaderStage;
}
export interface ValidatedReply {
  readonly type: 'VALIDATED';
  readonly requestId: number;
  readonly sha256: string;
  readonly size: number;
  readonly artifact: TranspiledEntrant | null;
}
export interface RejectedReply {
  readonly type: 'REJECTED';
  readonly requestId: number;
  readonly stage: LoaderStage;
  readonly sha256: string | null;
  readonly reasons: readonly string[];
}
export type LoaderReply = ProgressReply | ValidatedReply | RejectedReply;

// ---- Referee worker ---------------------------------------------------------------

export type RefereeRequest =
  | { readonly type: 'NEW_GAME'; readonly requestId: number; readonly firstSide: Side }
  | { readonly type: 'COMMIT'; readonly requestId: number; readonly rev: number; readonly move: PlyMove }
  | { readonly type: 'FORFEIT'; readonly requestId: number; readonly rev: number; readonly loser: Side; readonly reason: 'timeout' | 'trap' | 'invalid-move' };

export type RefereeReply =
  | { readonly type: 'STATE'; readonly requestId: number; readonly snapshot: Snapshot; readonly legal: readonly PlyMove[] }
  | { readonly type: 'REFUSED'; readonly requestId: number; readonly message: string };

export function sameEnvelope(a: Envelope, b: Envelope): boolean {
  return a.matchId === b.matchId && a.seat === b.seat && a.requestId === b.requestId && a.rev === b.rev;
}

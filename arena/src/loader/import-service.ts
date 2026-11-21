/**
 * Admission pipeline, run on the main thread but entirely through workers:
 * loader worker (size → header → hash → contract → transpile), then a bounded smoke
 * test on a disposable seat worker. Nothing here touches storage; callers persist the
 * admitted result.
 */
import type { Envelope, LoaderStage, SeatReply } from '../protocol/messages';
import type { Metadata } from '../referee/types';
import { DeadlineError, SeatHandle, type Clock, type LoaderClient, type WorkerFactory, realClock } from '../workers/rpc';
import type { Frame } from './frame';
import type { TranspiledEntrant } from './guest';
import { sha256Hex } from './hash';
import { DEADLINES } from './limits';
import type { SmokeReport } from './smoke';

export type ImportStage = LoaderStage | 'smoke';
export const IMPORT_STAGES: readonly ImportStage[] = ['size', 'header', 'hash', 'contract', 'transpile', 'smoke'];

export type ImportOutcome =
  | {
      readonly ok: true;
      readonly sha256: string;
      readonly size: number;
      readonly metadata: Metadata;
      readonly artifact: TranspiledEntrant;
      readonly frames: readonly Frame[];
    }
  | {
      readonly ok: false;
      readonly stage: ImportStage;
      readonly sha256: string | null;
      readonly reasons: readonly string[];
      readonly metadata: Metadata | null;
    };

export interface ImportDeps {
  readonly loader: LoaderClient;
  readonly seatFactory: WorkerFactory;
  readonly clock?: Clock;
  readonly onStage?: (stage: ImportStage) => void;
  /** A previously transpiled artifact for this exact hash and loader version. */
  readonly cachedArtifact?: (sha256: string) => Promise<TranspiledEntrant | null>;
}

let smokeCounter = 0;

/** Run the smoke test on a fresh seat worker that is always terminated afterwards. */
export function runSmokeInWorker(
  artifact: TranspiledEntrant,
  seatFactory: WorkerFactory,
  clock: Clock = realClock,
  deadlineMs: number = DEADLINES.smoke,
): Promise<SmokeReport> {
  const env: Envelope = { matchId: `smoke-${++smokeCounter}`, seat: 'left', requestId: 1, rev: 0 };
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: unknown = null;
    let handle: SeatHandle | null = null;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clearTimeout(timer);
      handle?.terminate();
      fn();
    };
    handle = new SeatHandle(
      seatFactory,
      (reply: SeatReply) => {
        if (reply.env.matchId !== env.matchId || reply.env.requestId !== env.requestId) return;
        if (reply.type === 'SMOKE_REPORT') done(() => resolve(reply.report));
        else if (reply.type === 'ERROR') done(() => reject(new Error(reply.message)));
      },
      (crash) => done(() => reject(crash)),
    );
    timer = clock.setTimeout(() => done(() => reject(new DeadlineError('Smoke test', deadlineMs))), deadlineMs);
    handle.send({ type: 'SMOKE', env, artifact });
  });
}

function reasonOf(err: unknown): string {
  if (err instanceof DeadlineError) return `${err.label} did not finish within ${err.deadlineMs / 1000} s.`;
  return err instanceof Error ? err.message : String(err);
}

export async function importBinary(bytes: Uint8Array, deps: ImportDeps): Promise<ImportOutcome> {
  const clock = deps.clock ?? realClock;
  let stage: ImportStage = 'size';
  const onProgress = (s: LoaderStage) => {
    stage = s;
    deps.onStage?.(s);
  };

  // A binary already transpiled by this loader version skips jco; validation still runs.
  const cached = deps.cachedArtifact ? await deps.cachedArtifact(await sha256Hex(bytes)) : null;
  // Copy: `bytes` stays usable by the caller after the loader request.
  const copy = bytes.slice().buffer as ArrayBuffer;
  let validated;
  try {
    validated = await deps.loader.validate(copy, {
      skipTranspile: cached !== null,
      onProgress,
      validateDeadlineMs: DEADLINES.validate,
      transpileDeadlineMs: DEADLINES.transpile,
    });
  } catch (err) {
    return { ok: false, stage, sha256: null, reasons: [reasonOf(err)], metadata: null };
  }
  if (validated.type === 'REJECTED') {
    return { ok: false, stage: validated.stage, sha256: validated.sha256, reasons: validated.reasons, metadata: null };
  }
  const { sha256, size } = validated;
  const artifact = validated.artifact ?? cached;
  if (!artifact) return { ok: false, stage: 'transpile', sha256, reasons: ['No transpiled output was produced.'], metadata: null };

  deps.onStage?.('smoke');
  let report: SmokeReport;
  try {
    report = await runSmokeInWorker(artifact, deps.seatFactory, clock);
  } catch (err) {
    return { ok: false, stage: 'smoke', sha256, reasons: [reasonOf(err)], metadata: null };
  }
  if (!report.ok || !report.metadata) {
    return { ok: false, stage: 'smoke', sha256, reasons: report.issues, metadata: report.metadata };
  }
  return { ok: true, sha256, size, metadata: report.metadata, artifact, frames: report.frames };
}

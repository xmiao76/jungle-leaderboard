import { describe, expect, it } from 'vitest';
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH } from './limits';
import { importBinary, runSmokeInWorker } from './import-service';
import type { SmokeReport } from './smoke';
import { ManualClock, METADATA, flush } from '../match/fakes.test-support';
import type { LoaderReply, SeatRequest, ValidateRequest } from '../protocol/messages';
import { LoaderClient, type WorkerLike } from '../workers/rpc';

const ARTIFACT = { js: 'js', modules: {} };
const frame = () => ({ width: FRAME_WIDTH, height: FRAME_HEIGHT, rgba: new Uint8Array(FRAME_BYTES) });

class FakeLoader implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  requests: ValidateRequest[] = [];
  constructor(private readonly reply: (req: ValidateRequest) => LoaderReply[] | 'hang') {}
  postMessage(message: unknown): void {
    const req = message as ValidateRequest;
    this.requests.push(req);
    const replies = this.reply(req);
    if (replies === 'hang') return;
    queueMicrotask(() => replies.forEach((r) => this.onmessage?.({ data: r } as MessageEvent)));
  }
  terminate(): void {
    this.terminated = true;
  }
}

class FakeSmokeSeat implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly report: SmokeReport | 'hang' | 'error') {}
  postMessage(message: unknown): void {
    const msg = message as SeatRequest;
    if (this.report === 'hang') return;
    queueMicrotask(() => {
      if (this.report === 'error') this.onmessage?.({ data: { type: 'ERROR', env: msg.env, phase: 'smoke', kind: 'load', message: 'boom' } } as MessageEvent);
      else this.onmessage?.({ data: { type: 'SMOKE_REPORT', env: msg.env, report: this.report } } as MessageEvent);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

const goodReport: SmokeReport = { ok: true, metadata: METADATA, rulesCompatible: true, issues: [], failedStep: null, frames: [frame(), frame()] };
const validated = (req: ValidateRequest): LoaderReply[] => [
  { type: 'PROGRESS', requestId: req.requestId, stage: 'size' },
  { type: 'PROGRESS', requestId: req.requestId, stage: 'contract' },
  { type: 'VALIDATED', requestId: req.requestId, sha256: 'a'.repeat(64), size: 3, artifact: req.skipTranspile ? null : ARTIFACT },
];

describe('importBinary', () => {
  it('admits a binary that validates and passes the smoke test, reporting each stage', async () => {
    const stages: string[] = [];
    const outcome = await importBinary(new Uint8Array([1, 2, 3]), {
      loader: new LoaderClient(() => new FakeLoader(validated)),
      seatFactory: () => new FakeSmokeSeat(goodReport),
      onStage: (s) => stages.push(s),
    });
    expect(outcome).toMatchObject({ ok: true, sha256: 'a'.repeat(64), metadata: METADATA });
    expect(stages).toEqual(['size', 'contract', 'smoke']);
  });

  it('skips transpilation when this loader version already transpiled the same bytes', async () => {
    const loader = new FakeLoader(validated);
    const outcome = await importBinary(new Uint8Array([1, 2, 3]), {
      loader: new LoaderClient(() => loader),
      seatFactory: () => new FakeSmokeSeat(goodReport),
      cachedArtifact: async () => ({ js: 'cached', modules: {} }),
    });
    expect(loader.requests[0]!.skipTranspile).toBe(true);
    expect(outcome.ok && outcome.artifact.js).toBe('cached');
  });

  it('returns the loader rejection with its stage and reasons', async () => {
    const outcome = await importBinary(new Uint8Array([1]), {
      loader: new LoaderClient(() => new FakeLoader((req) => [{ type: 'REJECTED', requestId: req.requestId, stage: 'contract', sha256: null, reasons: ['nope'] }])),
      seatFactory: () => new FakeSmokeSeat(goodReport),
    });
    expect(outcome).toEqual({ ok: false, stage: 'contract', sha256: null, reasons: ['nope'], metadata: null });
  });

  it('turns a failed smoke test into a rejection at the smoke stage', async () => {
    const report: SmokeReport = { ...goodReport, ok: false, issues: ['Rules digest is wrong'], failedStep: 'info', frames: [] };
    const outcome = await importBinary(new Uint8Array([1]), {
      loader: new LoaderClient(() => new FakeLoader(validated)),
      seatFactory: () => new FakeSmokeSeat(report),
    });
    expect(outcome).toMatchObject({ ok: false, stage: 'smoke', reasons: ['Rules digest is wrong'] });
  });

  it('reports a validation deadline and recreates the loader worker next time', async () => {
    const clock = new ManualClock();
    const workers: FakeLoader[] = [];
    const loader = new LoaderClient(() => {
      const w = new FakeLoader(workers.length === 0 ? () => 'hang' : validated);
      workers.push(w);
      return w;
    }, clock);
    const pending = importBinary(new Uint8Array([1]), { loader, seatFactory: () => new FakeSmokeSeat(goodReport), clock });
    await flush();
    clock.advance(20_000);
    expect(await pending).toMatchObject({ ok: false, reasons: [expect.stringMatching(/did not finish within 15 s/)] });
    expect(workers[0]!.terminated).toBe(true);
    const second = await importBinary(new Uint8Array([1]), { loader, seatFactory: () => new FakeSmokeSeat(goodReport), clock });
    expect(second.ok).toBe(true);
    expect(workers).toHaveLength(2);
  });
});

describe('runSmokeInWorker', () => {
  it('terminates the disposable worker after a report', async () => {
    const seat = new FakeSmokeSeat(goodReport);
    await runSmokeInWorker(ARTIFACT, () => seat);
    expect(seat.terminated).toBe(true);
  });

  it('rejects on a worker error and on the deadline', async () => {
    await expect(runSmokeInWorker(ARTIFACT, () => new FakeSmokeSeat('error'))).rejects.toThrow('boom');
    const clock = new ManualClock();
    const seat = new FakeSmokeSeat('hang');
    const pending = runSmokeInWorker(ARTIFACT, () => seat, clock, 1000);
    clock.advance(1000);
    await expect(pending).rejects.toThrow(/deadline/);
    expect(seat.terminated).toBe(true);
  });
});

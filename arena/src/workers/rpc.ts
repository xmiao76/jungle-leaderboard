/**
 * Main-thread handles for workers. Deadlines are enforced here by terminating the
 * worker: guest calls are synchronous and cannot be interrupted any other way.
 */
import type { LoaderReply, LoaderStage, SeatReply, SeatRequest, ValidateRequest } from '../protocol/messages';

/** The subset of `Worker` the Arena relies on; tests supply fakes. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export type WorkerFactory = () => WorkerLike;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class DeadlineError extends Error {
  override readonly name = 'DeadlineError';
  constructor(
    readonly label: string,
    readonly deadlineMs: number,
  ) {
    super(`${label} exceeded its ${deadlineMs / 1000} s deadline`);
  }
}

export class WorkerCrashError extends Error {
  override readonly name = 'WorkerCrashError';
}

function crashMessage(event: ErrorEvent): string {
  return event.message ? event.message : 'The worker failed to start or crashed.';
}

/** A seat worker. The match controller owns correlation; this only moves messages. */
export class SeatHandle {
  private worker: WorkerLike | null;

  constructor(
    factory: WorkerFactory,
    private readonly onReply: (reply: SeatReply) => void,
    private readonly onCrash: (error: WorkerCrashError) => void,
  ) {
    const worker = factory();
    worker.onmessage = (event) => this.onReply(event.data as SeatReply);
    worker.onerror = (event) => {
      if ('preventDefault' in event) event.preventDefault();
      this.onCrash(new WorkerCrashError(crashMessage(event)));
    };
    this.worker = worker;
  }

  get alive(): boolean {
    return this.worker !== null;
  }

  send(request: SeatRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(request, transfer);
  }

  terminate(): void {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }
}

export interface ValidateOptions {
  readonly skipTranspile: boolean;
  readonly onProgress?: (stage: LoaderStage) => void;
  readonly validateDeadlineMs: number;
  readonly transpileDeadlineMs: number;
}

/** The dedicated loader worker, recreated after a deadline or crash. */
export class LoaderClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly factory: WorkerFactory,
    private readonly clock: Clock = realClock,
  ) {}

  /** Requests are serialized so a slow transpile never races a second import. */
  validate(bytes: ArrayBuffer, options: ValidateOptions): Promise<LoaderReply & { type: 'VALIDATED' | 'REJECTED' }> {
    const run = this.queue.then(() => this.runValidate(bytes, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private runValidate(bytes: ArrayBuffer, options: ValidateOptions): Promise<LoaderReply & { type: 'VALIDATED' | 'REJECTED' }> {
    const worker = (this.worker ??= this.factory());
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer: unknown = null;
      const arm = (label: string, ms: number) => {
        if (timer !== null) this.clock.clearTimeout(timer);
        timer = this.clock.setTimeout(() => {
          this.dispose();
          reject(new DeadlineError(label, ms));
        }, ms);
      };
      const finish = () => {
        if (timer !== null) this.clock.clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
      };
      worker.onmessage = (event) => {
        const reply = event.data as LoaderReply;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'PROGRESS') {
          options.onProgress?.(reply.stage);
          if (reply.stage === 'transpile') arm('Transpilation', options.transpileDeadlineMs);
          return;
        }
        finish();
        resolve(reply);
      };
      worker.onerror = (event) => {
        if ('preventDefault' in event) event.preventDefault();
        finish();
        this.dispose();
        reject(new WorkerCrashError(crashMessage(event)));
      };
      arm('Validation', options.validateDeadlineMs);
      const request: ValidateRequest = { type: 'VALIDATE', requestId, bytes, skipTranspile: options.skipTranspile };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

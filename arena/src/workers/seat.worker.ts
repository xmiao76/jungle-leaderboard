/// <reference lib="webworker" />
/**
 * One long-lived instance of one entrant for one seat of one match. A second copy of
 * the same binary always gets its own worker, so instances never share memory.
 * Calls into the guest are synchronous; the host enforces deadlines by terminating
 * this worker.
 */
import { checkRenderFrames } from '../loader/frame';
import { instantiateGuest, type GuestGame, type TranspiledEntrant } from '../loader/guest';
import { checkMetadata } from '../loader/metadata';
import { runSmokeTest } from '../loader/smoke';
import type { Envelope, ErrorReply, SeatReply, SeatRequest } from '../protocol/messages';

declare const self: DedicatedWorkerGlobalScope;

let game: GuestGame | null = null;

async function importBlob(js: string) {
  const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(artifact: TranspiledEntrant): Promise<GuestGame> {
  return instantiateGuest(artifact, importBlob);
}

function reply(message: SeatReply, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function error(env: Envelope, phase: ErrorReply['phase'], kind: ErrorReply['kind'], err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  reply({ type: 'ERROR', env, phase, kind, message });
}

async function handle(msg: SeatRequest): Promise<void> {
  switch (msg.type) {
    case 'INIT': {
      try {
        game = await load(msg.artifact);
      } catch (err) {
        error(msg.env, 'init', 'load', err);
        return;
      }
      try {
        const check = checkMetadata(game.info());
        game.init(msg.settings.side, msg.settings.difficulty, msg.settings.seed);
        reply({ type: 'READY', env: msg.env, metadata: check.metadata, issues: check.issues });
      } catch (err) {
        error(msg.env, 'init', 'trap', err);
      }
      return;
    }
    case 'THINK': {
      if (!game) return error(msg.env, 'think', 'protocol', new Error('THINK before INIT'));
      const started = performance.now();
      try {
        const index = game.chooseMove(msg.snapshot, msg.legal, msg.nodeBudget);
        reply({ type: 'PROPOSAL', env: msg.env, index, thinkMs: Math.round(performance.now() - started) });
      } catch (err) {
        error(msg.env, 'think', 'trap', err);
      }
      return;
    }
    case 'RENDER': {
      if (!game) return error(msg.env, 'render', 'protocol', new Error('RENDER before INIT'));
      let check;
      try {
        check = checkRenderFrames(game.render(msg.snapshot, msg.flipped, msg.progress));
      } catch (err) {
        error(msg.env, 'render', 'trap', err);
        return;
      }
      if (!check.ok) {
        reply({ type: 'ERROR', env: msg.env, phase: 'render', kind: 'invalid-frame', message: check.reason });
        return;
      }
      const { width, height, rgba } = check.frame;
      const buffer = rgba.buffer as ArrayBuffer;
      reply({ type: 'FRAME', env: msg.env, width, height, rgba: buffer }, [buffer]);
      return;
    }
    case 'SMOKE': {
      try {
        const report = runSmokeTest(await load(msg.artifact));
        reply({ type: 'SMOKE_REPORT', env: msg.env, report }, report.frames.map((f) => f.rgba.buffer as ArrayBuffer));
      } catch (err) {
        error(msg.env, 'smoke', 'load', err);
      }
      return;
    }
  }
}

self.onmessage = (event: MessageEvent<SeatRequest>) => {
  void handle(event.data);
};

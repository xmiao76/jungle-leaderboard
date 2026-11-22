/// <reference lib="webworker" />
// The AI runs here, off the UI thread, using the same jungle-core search as the Arena
// entrant. Replies carry the request id; the session drops any it no longer wants.
import init, { choose, choose_within } from './pkg/jungle_web.js';
import type { AiRequest } from './session';

declare const self: DedicatedWorkerGlobalScope;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const ready = init().then(
  () => self.postMessage({ type: 'ready' }),
  (err: unknown) => {
    self.postMessage({ type: 'init-error', message: message(err) });
    throw err;
  },
);

self.onmessage = async (event: MessageEvent<AiRequest>) => {
  const { id, snapshot, budget, seed, level, deadlineEpochMs } = event.data;
  try {
    await ready;
    const started = performance.now();
    // Hard carries a one-second deadline from the moment the shell asked; search
    // against whatever of it is left instead of the fixed node budget.
    const index = deadlineEpochMs === undefined
      ? choose(snapshot, budget, seed, level)
      : choose_within(snapshot, seed, level, Math.max(0, deadlineEpochMs - Date.now()));
    self.postMessage({ type: 'result', id, index, ms: Math.round(performance.now() - started) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: message(err) });
  }
};

import { describe, expect, it } from 'vitest';
import { initialSnapshot, legalMoves } from '../referee';
import type { WorkerLike } from '../workers/rpc';
import { ManualClock } from './fakes.test-support';
import { SeatChannel, SeatFailure } from './seat-channel';

class ThrowingWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(): void {
    throw new DOMException('#<Object> could not be cloned.', 'DataCloneError');
  }
  terminate(): void {}
}

describe('SeatChannel', () => {
  // Regression: a replay posted a Vue proxy, postMessage threw synchronously, and the
  // channel stayed "busy" forever with a live deadline timer.
  it('rejects and frees the seat when postMessage throws synchronously', async () => {
    const clock = new ManualClock();
    const channel = new SeatChannel('left', 'm', () => new ThrowingWorker(), clock);
    const s = initialSnapshot('red');
    await expect(channel.think(s, legalMoves(s), 10, 1000)).rejects.toMatchObject({ kind: 'protocol' });
    expect(channel.busy).toBe(false);
    // The deadline timer was cleared: advancing the clock does nothing.
    clock.advance(5000);
    await expect(channel.render(s, false, 1000, 1000)).rejects.toBeInstanceOf(SeatFailure);
    expect(channel.busy).toBe(false);
  });
});

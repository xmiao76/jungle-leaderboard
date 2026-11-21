/**
 * Replay rendering for one seat. A replay displays recorded decisions without
 * rerunning any search: the original binary (when this device or the public catalog
 * still has its exact hash) is instantiated fresh and asked only to render; otherwise
 * the Arena reference board stands in, clearly labeled.
 */
import { DEADLINES } from '../loader/limits';
import type { MatchEntrant } from '../match/controller';
import { SeatChannel } from '../match/seat-channel';
import type { Seat } from '../protocol/messages';
import type { Snapshot } from '../referee/types';
import { presentFrame } from '../ui/present';
import { realClock, type WorkerFactory } from '../workers/rpc';
import { drawReferenceBoard } from './reference-board';
import type { ReplayV1 } from './schema';

export type ReplaySource = 'loading' | 'original' | 'reference';

export class ReplaySeatRenderer {
  private channel: SeatChannel | null = null;
  source: ReplaySource = 'loading';
  lastError: string | null = null;

  constructor(
    private readonly seat: Seat,
    private readonly replay: ReplayV1,
    private readonly factory: WorkerFactory,
  ) {}

  async open(entrant: MatchEntrant | null): Promise<ReplaySource> {
    if (!entrant) {
      this.source = 'reference';
      return this.source;
    }
    const channel = new SeatChannel(this.seat, `replay-${this.replay.id}`, this.factory, realClock);
    try {
      const recorded = this.replay.seats[this.seat];
      await channel.init(entrant.artifact, { side: recorded.side, difficulty: this.replay.settings.difficulty, seed: this.replay.settings.seed }, DEADLINES.load);
      this.channel = channel;
      this.source = 'original';
    } catch (err) {
      channel.dispose();
      this.lastError = err instanceof Error ? err.message : String(err);
      this.source = 'reference';
    }
    return this.source;
  }

  /** Draw the settled board for `snapshot`; seeking straight to any revision is allowed. */
  async draw(canvas: HTMLCanvasElement, snapshot: Snapshot, flipped: boolean): Promise<void> {
    if (this.channel && this.source === 'original') {
      try {
        const frame = await this.channel.render(snapshot, flipped, 1000, DEADLINES.render);
        presentFrame(canvas, frame);
        return;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.channel.dispose();
        this.channel = null;
        this.source = 'reference';
      }
    }
    drawReferenceBoard(canvas, snapshot, flipped);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = null;
  }
}

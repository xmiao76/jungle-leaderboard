/**
 * Shared match audio, synthesized with Web Audio (no sound files to license). The
 * context is created on the first user gesture, plays exactly once per committed move,
 * and the mute choice persists per viewer when storage allows.
 */

const MUTE_KEY = 'jungle-arena:muted';

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

type Cue = 'move' | 'capture' | 'end';

export class MatchAudio {
  private context: AudioContext | null = null;
  muted = readMuted();

  /** Call from a click or key handler; browsers only start audio after a gesture. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.context = new Ctor();
    } catch {
      this.context = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    writeMuted(muted);
  }

  play(cue: Cue): void {
    const ctx = this.context;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const notes: readonly [number, number, number][] =
      cue === 'move' ? [[520, 0, 0.07]] : cue === 'capture' ? [[330, 0, 0.09], [220, 0.06, 0.12]] : [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.22]];
    for (const [freq, offset, length] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue === 'capture' ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + length + 0.02);
    }
  }
}

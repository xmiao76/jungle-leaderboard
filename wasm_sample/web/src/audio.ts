// Original sound effects, synthesized with Web Audio (nothing to license). The context
// starts on the first user gesture; mute persists per browser when storage allows.

const KEY = 'jungle-sample:muted';
type Cue = 'move' | 'capture' | 'win' | 'lose' | 'select';

export class Sounds {
  private ctx: AudioContext | null = null;
  muted: boolean;

  constructor() {
    let stored = false;
    try {
      stored = localStorage.getItem(KEY) === '1';
    } catch {
      stored = false;
    }
    this.muted = stored;
  }

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    void this.ctx.resume();
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(KEY, this.muted ? '1' : '0');
    } catch {
      // storage blocked: the choice lasts for this page
    }
    return this.muted;
  }

  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const notes: Record<Cue, readonly [number, number, number, OscillatorType][]> = {
      select: [[880, 0, 0.05, 'sine']],
      move: [[440, 0, 0.08, 'triangle'], [660, 0.04, 0.06, 'sine']],
      capture: [[200, 0, 0.12, 'sawtooth'], [130, 0.05, 0.16, 'square']],
      win: [[523, 0, 0.14, 'triangle'], [659, 0.13, 0.14, 'triangle'], [784, 0.26, 0.3, 'triangle']],
      lose: [[392, 0, 0.18, 'sine'], [330, 0.17, 0.18, 'sine'], [262, 0.34, 0.34, 'sine']],
    };
    const now = ctx.currentTime;
    for (const [freq, at, length, type] of notes[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(cue === 'capture' ? 0.09 : 0.14, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + length + 0.03);
    }
  }
}

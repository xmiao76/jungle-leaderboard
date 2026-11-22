/**
 * Behavioural conformance checks, run in the browser on real workers with the same
 * loader, seat workers, referee and match controller the Arena uses. Every entrant gets
 * the same settings.
 */
import { fetchPublicBinary, fetchPublicManifest } from '../catalog/catalog';
import type { TranspiledEntrant } from '../loader/guest';
import { DEADLINES } from '../loader/limits';
import { MatchController, type MatchEntrant, type MatchResult } from '../match/controller';
import { SeatChannel } from '../match/seat-channel';
import { applyMove, initialSnapshot, legalMoves } from '../referee';
import type { Metadata, Side } from '../referee/types';
import { catalogBase } from '../app/paths';
import { createRefereeWorker, createSeatWorker, createLoaderWorker } from '../workers/factories';
import { LoaderClient, realClock } from '../workers/rpc';

export const CONFORMANCE_SETTINGS = { difficulty: 'medium', seed: 20_261_120, nodeBudget: 20_000, thinkDeadlineMs: 5_000 } as const;
/** How the report names the opponent: the catalog entry flagged as the reference program. */
export const OPPONENT_LABEL = 'the reference program in the public catalog';

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface MatchSummary {
  readonly label: string;
  readonly entrantSide: Side;
  readonly result: MatchResult | null;
  readonly plies: number;
  readonly settledBothPanes: number;
  readonly ok: boolean;
}

const ok = (name: string, detail: string): CheckResult => ({ name, ok: true, detail });
const bad = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

let channelCounter = 0;
async function instance(artifact: TranspiledEntrant, side: Side): Promise<SeatChannel> {
  const channel = new SeatChannel('left', `conformance-${++channelCounter}`, createSeatWorker, realClock);
  await channel.init(artifact, { side, difficulty: CONFORMANCE_SETTINGS.difficulty, seed: CONFORMANCE_SETTINGS.seed }, DEADLINES.load);
  return channel;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** choose → render ×3 → choose on the same instance and snapshot must give the same index. */
export async function renderDoesNotChangeChoice(artifact: TranspiledEntrant): Promise<CheckResult> {
  const name = 'render-does-not-change-choice';
  const channel = await instance(artifact, 'red');
  try {
    const s = initialSnapshot('red');
    const legal = legalMoves(s);
    const first = await channel.think(s, legal, CONFORMANCE_SETTINGS.nodeBudget, CONFORMANCE_SETTINGS.thinkDeadlineMs);
    await channel.render(s, false, 1000, DEADLINES.render);
    await channel.render(s, true, 1000, DEADLINES.render);
    await channel.render(s, false, 500, DEADLINES.render);
    const second = await channel.think(s, legal, CONFORMANCE_SETTINGS.nodeBudget, CONFORMANCE_SETTINGS.thinkDeadlineMs);
    return first.index === second.index
      ? ok(name, `index ${first.index} before and after three renders`)
      : bad(name, `index ${first.index} before rendering, ${second.index} after`);
  } catch (err) {
    return bad(name, errText(err));
  } finally {
    channel.dispose();
  }
}

/** Two instances of one binary keep separate state; flipping changes only the view. */
export async function twoInstancesAndFlip(artifact: TranspiledEntrant): Promise<CheckResult[]> {
  const a = await instance(artifact, 'red');
  const b = await instance(artifact, 'blue');
  try {
    const opening = initialSnapshot('red');
    const s = applyMove(opening, legalMoves(opening)[0]!);
    const legal = legalMoves(s);
    const before = await b.think(s, legal, CONFORMANCE_SETTINGS.nodeBudget, CONFORMANCE_SETTINGS.thinkDeadlineMs);
    // Activity on instance A must not influence instance B.
    await a.think(opening, legalMoves(opening), CONFORMANCE_SETTINGS.nodeBudget, CONFORMANCE_SETTINGS.thinkDeadlineMs);
    await a.render(s, true, 1000, DEADLINES.render);
    const after = await b.think(s, legal, CONFORMANCE_SETTINGS.nodeBudget, CONFORMANCE_SETTINGS.thinkDeadlineMs);
    const isolation =
      before.index === after.index
        ? ok('two-instances-isolated', `second instance chose ${before.index} both times`)
        : bad('two-instances-isolated', `second instance chose ${before.index}, then ${after.index} after the first instance ran`);

    const plain = await a.render(s, false, 1000, DEADLINES.render);
    const flipped = await a.render(s, true, 1000, DEADLINES.render);
    const again = await a.render(s, false, 1000, DEADLINES.render);
    const flip = sameBytes(plain.rgba, flipped.rgba)
      ? bad('flip-changes-view', 'the flipped frame is identical to the unflipped one')
      : sameBytes(plain.rgba, again.rgba)
        ? ok('flip-changes-view', 'flipped frame differs; unflipped frame is reproducible')
        : bad('flip-changes-view', 'two settled renders of the same snapshot differ');
    return [isolation, flip];
  } catch (err) {
    return [bad('two-instances-isolated', errText(err))];
  } finally {
    a.dispose();
    b.dispose();
  }
}

/**
 * The reference opponent: the one catalog entry flagged `reference` (chosen by a maintainer in
 * seed/catalog/seed.json, never by uploads), hash-verified. Every entrant meets the same opponent.
 */
export async function loadOpponent(): Promise<MatchEntrant> {
  const base = catalogBase();
  const { entries, error } = await fetchPublicManifest(base);
  if (error) throw new Error(error);
  const entry = entries.find((e) => e.reference);
  if (!entry) throw new Error('The public catalog has no reference program to play against.');
  const bytes = await fetchPublicBinary({ file: entry.file, sha256: entry.sha256 }, base);
  const loader = new LoaderClient(createLoaderWorker);
  try {
    const reply = await loader.validate(bytes.slice().buffer as ArrayBuffer, {
      skipTranspile: false,
      validateDeadlineMs: DEADLINES.validate,
      transpileDeadlineMs: DEADLINES.transpile,
    });
    if (reply.type !== 'VALIDATED' || !reply.artifact) throw new Error('the opponent failed admission');
    return { sha256: entry.sha256, metadata: entry.metadata, artifact: reply.artifact };
  } finally {
    loader.dispose();
  }
}

export function playMatch(label: string, red: MatchEntrant, blue: MatchEntrant, entrantSide: Side, entrantSha: string): Promise<MatchSummary> {
  return new Promise((resolve) => {
    let plies = 0;
    let settledBothPanes = 0;
    const controller = new MatchController({
      matchId: `conformance-${label}-${Date.now()}`,
      entrants: { left: red, right: blue },
      settings: {
        sides: { left: 'red', right: 'blue' },
        firstSide: 'red',
        difficulty: CONFORMANCE_SETTINGS.difficulty,
        seed: CONFORMANCE_SETTINGS.seed,
        nodeBudget: CONFORMANCE_SETTINGS.nodeBudget,
        thinkDeadlineMs: CONFORMANCE_SETTINGS.thinkDeadlineMs,
      },
      seatFactory: createSeatWorker,
      refereeFactory: createRefereeWorker,
      clock: realClock,
      loadDeadlineMs: DEADLINES.load,
      renderDeadlineMs: DEADLINES.render,
      animation: () => ({ steps: [], pauseMs: 0 }),
      listener: {
        state: (view) => {
          if (view.phase === 'failed' && !view.result) {
            controller.dispose();
            resolve({ label, entrantSide, result: null, plies, settledBothPanes, ok: false });
          }
        },
        frame: () => undefined,
        settled: (frames) => {
          if (frames.left && frames.right) settledBothPanes += 1;
        },
        committed: () => {
          plies += 1;
        },
        ended: (result) => {
          const entrantSeat = entrantSide === 'red' ? 'left' : 'right';
          const entrantForfeited = result.kind === 'forfeit' && result.forfeit?.seat === entrantSeat;
          const conforming = result.kind !== 'system-error' && !entrantForfeited && (red.sha256 !== entrantSha || blue.sha256 !== entrantSha || result.kind === 'board');
          controller.dispose();
          resolve({ label, entrantSide, result, plies, settledBothPanes, ok: conforming });
        },
      },
    });
    void controller.start().then(() => {
      if (controller.view.phase === 'ready') controller.play();
    });
  });
}

export function entrantFrom(sha256: string, metadata: Metadata, artifact: TranspiledEntrant): MatchEntrant {
  return { sha256, metadata, artifact };
}

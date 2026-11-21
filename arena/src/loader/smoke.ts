/**
 * The bounded admission smoke test, run on a disposable instance before an entrant
 * enters any catalog: metadata, startup, one move choice and two frames.
 * Wall-clock deadlines are enforced by whoever hosts the instance (it terminates the
 * worker); this function only checks observable behaviour.
 */
import { initialSnapshot, legalMoves } from '../referee';
import type { Metadata } from '../referee/types';
import { checkRenderFrames, type Frame } from './frame';
import type { GuestGame } from './guest';
import { checkMetadata } from './metadata';

export type SmokeStep = 'info' | 'init' | 'choose-move' | 'render' | 'render-flipped';

export interface SmokeReport {
  readonly ok: boolean;
  readonly metadata: Metadata | null;
  readonly rulesCompatible: boolean;
  readonly issues: readonly string[];
  /** The step that failed, if any. */
  readonly failedStep: SmokeStep | null;
  /** Settled opening frames, unflipped then flipped, for the import preview. */
  readonly frames: readonly Frame[];
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export function runSmokeTest(game: GuestGame): SmokeReport {
  const frames: Frame[] = [];
  const fail = (step: SmokeStep, issue: string, metadata: Metadata | null = null, rulesCompatible = false): SmokeReport => ({
    ok: false,
    metadata,
    rulesCompatible,
    issues: [issue],
    failedStep: step,
    frames,
  });

  let check;
  try {
    check = checkMetadata(game.info());
  } catch (err) {
    return fail('info', `info() trapped: ${describeError(err)}`);
  }
  if (check.issues.length > 0) {
    return { ok: false, metadata: check.metadata, rulesCompatible: check.rulesCompatible, issues: check.issues, failedStep: 'info', frames };
  }
  const { metadata, rulesCompatible } = check;

  try {
    game.init('red', 'medium', 1);
  } catch (err) {
    return fail('init', `init() trapped: ${describeError(err)}`, metadata, rulesCompatible);
  }

  const opening = initialSnapshot('red');
  const legal = legalMoves(opening);
  try {
    const index = game.chooseMove(opening, legal, 1_000);
    if (!Number.isInteger(index) || index < 0 || index >= legal.length) {
      return fail('choose-move', `choose-move returned ${index}; the opening legal list has ${legal.length} moves.`, metadata, rulesCompatible);
    }
  } catch (err) {
    return fail('choose-move', `choose-move trapped: ${describeError(err)}`, metadata, rulesCompatible);
  }

  for (const [step, flipped] of [['render', false], ['render-flipped', true]] as const) {
    try {
      const result = checkRenderFrames(game.render(opening, flipped, 1000));
      if (!result.ok) return fail(step, result.reason, metadata, rulesCompatible);
      frames.push(result.frame);
    } catch (err) {
      return fail(step, `render() trapped: ${describeError(err)}`, metadata, rulesCompatible);
    }
  }

  return { ok: true, metadata, rulesCompatible, issues: [], failedStep: null, frames };
}

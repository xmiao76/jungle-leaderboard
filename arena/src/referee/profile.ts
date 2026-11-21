/**
 * The canonical `desktop-jungle-v1` profile, read from the SDK JSON so terrain and
 * openings have exactly one source. `scripts/verify-rules-digest.mjs` proves at build
 * time that the file's bytes still hash to RULES_DIGEST.
 */
import profileJson from '../../../sdk/rules/desktop-jungle-v1.json';
import { ANIMALS, type Animal, type Side } from './types';

export const RULES_ID = 'desktop-jungle-v1';
export const RULES_DIGEST = 'a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63';

export const COLS = 7;
export const ROWS = 9;
export const BOARD_SIZE = COLS * ROWS;

interface Profile {
  readonly id: string;
  readonly size: readonly number[];
  readonly animalsLowToHigh: readonly string[];
  readonly openingByAscendingRank: Readonly<Record<Side, readonly number[]>>;
  readonly water: readonly number[];
  readonly den: Readonly<Record<Side, number>>;
  readonly traps: Readonly<Record<Side, readonly number[]>>;
  readonly jumpWaterLengths: Readonly<Record<string, readonly number[]>>;
  readonly noCapturePlies: number;
}

const profile: Profile = profileJson;

if (profile.id !== RULES_ID || profile.size[0] !== COLS || profile.size[1] !== ROWS) {
  throw new Error(`Rules profile mismatch: expected ${RULES_ID} on a ${COLS}x${ROWS} board`);
}
if (profile.animalsLowToHigh.join() !== ANIMALS.join()) {
  throw new Error('Rules profile animal order does not match the WIT enum order');
}

const WATER = new Set(profile.water);

export const DEN: Readonly<Record<Side, number>> = profile.den;
export const TRAPS: Readonly<Record<Side, ReadonlySet<number>>> = {
  red: new Set(profile.traps.red),
  blue: new Set(profile.traps.blue),
};
export const OPENING = profile.openingByAscendingRank;
export const NO_CAPTURE_LIMIT = profile.noCapturePlies;

export function isWater(square: number): boolean {
  return WATER.has(square);
}

/** Rank 1 (rat) through 8 (elephant), in profile order. */
export function rankOf(kind: Animal): number {
  return ANIMALS.indexOf(kind) + 1;
}

export function jumpLengths(kind: Animal): readonly number[] {
  return profile.jumpWaterLengths[kind] ?? [];
}

export function isOnBoard(square: number): boolean {
  return Number.isInteger(square) && square >= 0 && square < BOARD_SIZE;
}

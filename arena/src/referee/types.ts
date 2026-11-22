/**
 * Arena-side model of the `jungle:arena/game@1.0.0` types.
 *
 * Empty squares and "no winner" are `null` here so snapshots survive JSON (replays,
 * IndexedDB). The seat worker converts `null` to `undefined` at the WIT boundary,
 * which is how jco represents `option<T>`.
 */

export const SIDES = ['red', 'blue'] as const;
export type Side = (typeof SIDES)[number];

export const ANIMALS = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'] as const;
export type Animal = (typeof ANIMALS)[number];

export const LEVELS = ['easy', 'medium', 'hard'] as const;
export type Level = (typeof LEVELS)[number];

export const PHASES = ['playing', 'won', 'drawn', 'forfeited'] as const;
export type Phase = (typeof PHASES)[number];

export type BoardReason = 'den' | 'elimination' | 'immobilization' | 'no-capture';
export type ForfeitReason = 'timeout' | 'trap' | 'invalid-move';
export type Reason = '' | BoardReason | ForfeitReason;

export interface Piece {
  readonly owner: Side;
  readonly kind: Animal;
}

export interface PlyMove {
  readonly src: number;
  readonly dst: number;
}

export type Board = readonly (Piece | null)[];

export interface Snapshot {
  readonly rev: number;
  readonly board: Board;
  readonly firstSide: Side;
  readonly toPlay: Side;
  readonly history: readonly PlyMove[];
  readonly noCapturePlies: number;
  readonly status: Phase;
  readonly winner: Side | null;
  readonly reason: Reason;
}

export interface Metadata {
  readonly title: string;
  readonly gameVersion: string;
  readonly model: string;
  readonly codeAgent: string;
  /** The game's public GitHub repository URL (`https://github.com/<owner>/<repo>`). */
  readonly githubUrl: string;
  readonly engineVersion: string;
  readonly runtime: string;
  readonly rulesId: string;
  readonly rulesDigest: string;
}

export interface Settings {
  readonly seat: Side;
  readonly difficulty: Level;
  readonly seed: number;
}

export function opponent(side: Side): Side {
  return side === 'red' ? 'blue' : 'red';
}

export function sameMove(a: PlyMove, b: PlyMove): boolean {
  return a.src === b.src && a.dst === b.dst;
}

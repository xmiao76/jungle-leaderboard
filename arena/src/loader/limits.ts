/** Admission and runtime limits. Every value here is disclosed in the Arena UI. */

/** Cloudflare Pages serves at most 25 MiB per file; leave headroom for the catalog. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

export const FRAME_WIDTH = 448;
export const FRAME_HEIGHT = 576;
export const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 4;

/** Longest accepted metadata string; anything longer is not a label but a payload. */
export const MAX_METADATA_CHARS = 160;

/** Deadlines in milliseconds. The same values apply to both seats. */
export const DEADLINES = {
  /** Contract check (strip, print, extract) in the loader worker. */
  validate: 15_000,
  /** jco transpilation of a new binary. */
  transpile: 30_000,
  /** Compile + instantiate + info() + init() on a seat worker. */
  load: 20_000,
  /** One choose-move call. Configurable per match, always equal for both seats. */
  think: 5_000,
  /** One render call, from dispatch to an idle worker until its FRAME arrives. */
  render: 2_000,
  /** Whole disposable smoke test before catalog admission. */
  smoke: 20_000,
} as const;

export const THINK_DEADLINE_CHOICES = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const DEFAULT_NODE_BUDGET = 20_000;
export const NODE_BUDGET_CHOICES = [1_000, 5_000, 20_000, 100_000, 500_000] as const;

/** Bumped whenever transpile options or glue change, invalidating cached outputs. */
export const LOADER_VERSION = 'jco-transpile@0.24.0+loader-1';

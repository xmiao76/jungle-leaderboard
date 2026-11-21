/**
 * Host-side glue for one instance of a transpiled entrant. Environment-agnostic: the
 * seat worker passes a Blob-URL importer, Node tests a data-URL importer.
 *
 * The only import handed to the guest is `display.present`. Its bytes are copied out
 * of guest memory immediately, because the view is invalid after the call returns.
 */
import type { Level, Metadata, PlyMove, Side, Snapshot } from '../referee/types';
import type { Frame } from './frame';
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH } from './limits';

/** Frames kept per render call; further presents are only counted (one is required). */
const MAX_CAPTURED_FRAMES = 2;
const EMPTY = new Uint8Array(0);

/** jco's output for one binary: the generated JS and the core modules it loads. */
export interface TranspiledEntrant {
  readonly js: string;
  readonly modules: Readonly<Record<string, Uint8Array>>;
}

export const TRANSPILE_NAME = 'entrant';
export const TRANSPILE_JS = `${TRANSPILE_NAME}.js`;

/** Keep only what instantiation needs from jco's file list. */
export function packTranspiled(files: Iterable<readonly [string, Uint8Array]>): TranspiledEntrant {
  let js: string | null = null;
  const modules: Record<string, Uint8Array> = {};
  for (const [name, bytes] of files) {
    if (name === TRANSPILE_JS) js = new TextDecoder().decode(bytes);
    else if (name.endsWith('.wasm')) modules[name] = bytes;
  }
  if (js === null) throw new Error('Transpilation produced no JavaScript glue');
  return { js, modules };
}

interface WireSnapshot {
  rev: number;
  board: ({ owner: Side; kind: string } | undefined)[];
  firstSide: Side;
  toPlay: Side;
  history: PlyMove[];
  noCapturePlies: number;
  status: string;
  winner: Side | undefined;
  reason: string;
}

interface JcoGame {
  info(): unknown;
  init(config: { seat: Side; difficulty: Level; seed: number }): void;
  chooseMove(state: WireSnapshot, legal: PlyMove[], nodeBudget: number): number;
  render(state: WireSnapshot, flipped: boolean, progress: number): void;
}

interface JcoModule {
  instantiate(
    getCoreModule: (path: string) => Promise<WebAssembly.Module>,
    imports: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export type ModuleImporter = (js: string) => Promise<JcoModule>;

export interface GuestGame {
  info(): unknown;
  init(seat: Side, difficulty: Level, seed: number): void;
  chooseMove(state: Snapshot, legal: readonly PlyMove[], nodeBudget: number): number;
  /** Calls render and returns every frame presented during the call. */
  render(state: Snapshot, flipped: boolean, progress: number): Frame[];
}

/** jco represents `option<T>` as `T | undefined`; the referee uses `null`. */
export function toWireSnapshot(s: Snapshot): WireSnapshot {
  return {
    rev: s.rev,
    board: s.board.map((p) => (p ? { owner: p.owner, kind: p.kind } : undefined)),
    firstSide: s.firstSide,
    toPlay: s.toPlay,
    history: s.history.map((m) => ({ src: m.src, dst: m.dst })),
    noCapturePlies: s.noCapturePlies,
    status: s.status,
    winner: s.winner ?? undefined,
    reason: s.reason,
  };
}

export async function instantiateGuest(entrant: TranspiledEntrant, importModule: ModuleImporter): Promise<GuestGame> {
  const module = await importModule(entrant.js);
  let captured: Frame[] = [];
  const display = {
    present(width: number, height: number, rgba: Uint8Array) {
      // Copy only a correctly sized frame, and only the first few: a guest must not be
      // able to exhaust host memory through display.present.
      const wellFormed = width === FRAME_WIDTH && height === FRAME_HEIGHT && rgba.length === FRAME_BYTES;
      const keep = wellFormed && captured.length < MAX_CAPTURED_FRAMES;
      captured.push({ width, height, rgba: keep ? new Uint8Array(rgba) : EMPTY, presentedBytes: rgba.length });
    },
  };
  const compiled = new Map<string, Promise<WebAssembly.Module>>();
  const getCoreModule = (path: string) => {
    const bytes = entrant.modules[path];
    if (!bytes) return Promise.reject(new Error(`Transpiled output has no core module ${path}`));
    let pending = compiled.get(path);
    if (!pending) {
      pending = WebAssembly.compile(bytes as BufferSource);
      compiled.set(path, pending);
    }
    return pending;
  };
  // Supplied under both the unversioned key jco emits and the full interface name.
  const exports = await module.instantiate(getCoreModule, {
    'jungle:arena/display': display,
    'jungle:arena/display@1.0.0': display,
  });
  const game = (exports['jungle:arena/game@1.0.0'] ?? exports['game']) as JcoGame | undefined;
  if (!game || typeof game.chooseMove !== 'function') throw new Error('Instance does not export jungle:arena/game@1.0.0');

  return {
    info: () => game.info(),
    init: (seat, difficulty, seed) => game.init({ seat, difficulty, seed }),
    chooseMove: (state, legal, nodeBudget) =>
      game.chooseMove(toWireSnapshot(state), legal.map((m) => ({ src: m.src, dst: m.dst })), nodeBudget),
    render(state, flipped, progress) {
      captured = [];
      try {
        game.render(toWireSnapshot(state), flipped, progress);
        return captured;
      } finally {
        captured = [];
      }
    },
  };
}

// Node helpers: load the release component through jco and the wasm-bindgen build.
import { readFileSync } from 'node:fs';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
import { initSync } from '../web/src/pkg/jungle_web.js';
import * as web from '../web/src/pkg/jungle_web.js';

export { web };

const here = (path: string) => new URL(path, import.meta.url);
export const RELEASE = here('../dist/jungle-claude-opus-5-5-claudecode-official-1.1.0.wasm');
export const TEST_BUILD = here('../dist/test/jungle-opus55-test.wasm');
export const FIXTURE = here('../dist/jungle-fixture-1.0.0.wasm');

let webReady = false;
export function initWeb(): void {
  if (webReady) return;
  initSync({ module: readFileSync(here('../web/src/pkg/jungle_web_bg.wasm')) });
  webReady = true;
}

export type Side = 'red' | 'blue';
export const ANIMALS = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'] as const;
export interface WirePiece {
  owner: Side;
  kind: (typeof ANIMALS)[number];
}
export interface WireMove {
  src: number;
  dst: number;
}
export interface WireSnapshot {
  rev: number;
  board: (WirePiece | undefined)[];
  firstSide: Side;
  toPlay: Side;
  history: WireMove[];
  noCapturePlies: number;
  status: 'playing' | 'won' | 'drawn' | 'forfeited';
  winner: Side | undefined;
  reason: string;
}

export interface Instance {
  game: {
    info(): Record<string, string>;
    init(c: { seat: Side; difficulty: 'easy' | 'medium' | 'hard'; seed: number }): void;
    chooseMove(s: WireSnapshot, legal: WireMove[], budget: number): number;
    render(s: WireSnapshot, flipped: boolean, progress: number): void;
  };
  rules?: { legalMoves(s: WireSnapshot): WireMove[]; apply(s: WireSnapshot, m: WireMove): WireSnapshot | undefined };
  frames: { width: number; height: number; rgba: Uint8Array }[];
}

export async function instantiate(url: URL): Promise<Instance> {
  const t = await transpileBytes(new Uint8Array(readFileSync(url)), { name: 'c', instantiation: 'async', emitTypescriptDeclarations: false, nodejsCompat: false });
  const js = new TextDecoder().decode(t.files['c.js']);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const frames: Instance['frames'] = [];
  const display = { present: (width: number, height: number, rgba: Uint8Array) => frames.push({ width, height, rgba: new Uint8Array(rgba) }) };
  const exports = await mod.instantiate((p: string) => WebAssembly.compile(t.files[p]! as BufferSource), { 'jungle:arena/display': display });
  return { game: exports['jungle:arena/game@1.0.0'] ?? exports.game, rules: exports['test:rules/rules'] ?? exports.rules, frames };
}

/** Render and return the single frame the call presented. */
export function renderOnce(instance: Instance, s: WireSnapshot, flipped: boolean, progress = 1000): Uint8Array {
  instance.frames.length = 0;
  instance.game.render(s, flipped, progress);
  if (instance.frames.length !== 1) throw new Error(`render presented ${instance.frames.length} frames`);
  return instance.frames[0]!.rgba;
}

// ---- Snapshot encoding shared with jungle-web (see crates/jungle-web/src/lib.rs) ----

export function encode(s: WireSnapshot): Uint8Array {
  const reason = new TextEncoder().encode(s.reason);
  const out = new Uint8Array(13 + reason.length + 63 + s.history.length * 2);
  const view = new DataView(out.buffer);
  view.setUint32(0, s.rev, true);
  out[4] = s.firstSide === 'red' ? 0 : 1;
  out[5] = s.toPlay === 'red' ? 0 : 1;
  view.setUint32(6, s.noCapturePlies, true);
  out[10] = ['playing', 'won', 'drawn', 'forfeited'].indexOf(s.status);
  out[11] = s.winner === undefined ? 2 : s.winner === 'red' ? 0 : 1;
  out[12] = reason.length;
  out.set(reason, 13);
  const cells = 13 + reason.length;
  s.board.forEach((p, i) => {
    out[cells + i] = p ? (p.owner === 'red' ? 0 : 8) + ANIMALS.indexOf(p.kind) + 1 : 0;
  });
  s.history.forEach((m, i) => {
    out[cells + 63 + i * 2] = m.src;
    out[cells + 63 + i * 2 + 1] = m.dst;
  });
  return out;
}

const OPENING = { red: [48, 50, 54, 44, 46, 56, 62, 42], blue: [14, 12, 8, 18, 16, 6, 0, 20] };

export function opening(first: Side): WireSnapshot {
  const board: (WirePiece | undefined)[] = Array.from({ length: 63 }, () => undefined);
  for (const side of ['red', 'blue'] as const) OPENING[side].forEach((sq, i) => (board[sq] = { owner: side, kind: ANIMALS[i]! }));
  return { rev: 0, board, firstSide: first, toPlay: first, history: [], noCapturePlies: 0, status: 'playing', winner: undefined, reason: '' };
}

export function sparse(cells: Record<string, string>, toPlay: Side = 'red', quiet = 0): WireSnapshot {
  const board: (WirePiece | undefined)[] = Array.from({ length: 63 }, () => undefined);
  for (const [sq, text] of Object.entries(cells)) {
    const [owner, kind] = text.split(':') as [Side, WirePiece['kind']];
    board[Number(sq)] = { owner, kind };
  }
  return { ...opening(toPlay), board, noCapturePlies: quiet };
}

export function pairs(bytes: Uint8Array): WireMove[] {
  const out: WireMove[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push({ src: bytes[i]!, dst: bytes[i + 1]! });
  return out;
}

/** Follow `count` plies of a deterministic policy using the web build's rules. */
export function playOut(start: WireSnapshot, count: number, pick: (legal: WireMove[]) => number, rules: Instance['rules']): WireSnapshot {
  let s = start;
  for (let i = 0; i < count && s.status === 'playing'; i += 1) {
    const legal = rules!.legalMoves(s);
    s = rules!.apply(s, legal[pick(legal)]!)!;
  }
  return s;
}

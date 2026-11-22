/**
 * Browser conformance host. Opens the exact release binary, supplies only
 * `display.present`, and orchestrates full matches against the fixture opponent using
 * the independent referee in ./referee.ts. The report lands in `#result[data-status]`.
 */
import { $init, generate } from '@bytecodealliance/jco-transpile/component';
import { apply, forfeit, legalMoves, openingState, type Side, type State } from './referee';

const BUDGET = 5_000;
const SEED = 20_261_120;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array;
}
interface Instance {
  name: string;
  frames: Frame[];
  game: {
    info(): Record<string, string>;
    init(c: { seat: Side; difficulty: 'medium'; seed: number }): void;
    chooseMove(s: State, legal: { src: number; dst: number }[], budget: number): number;
    render(s: State, flipped: boolean, progress: number): void;
  };
}

function log(text: string): void {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').append(li);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Transpile with jco in the browser and instantiate with only `display`. */
async function instantiate(name: string, bytes: Uint8Array): Promise<Instance> {
  await $init;
  const out = generate(bytes, { name: 'c', instantiation: { tag: 'async' }, noTypescript: true, noNodejsCompat: true });
  const files = new Map(out.files);
  const unexpected = out.imports.filter((i) => !i.startsWith('jungle:arena/display'));
  if (unexpected.length > 0) throw new Error(`${name} imports ${unexpected.join(', ')}; only display is supplied`);
  const url = URL.createObjectURL(new Blob([new TextDecoder().decode(files.get('c.js'))], { type: 'text/javascript' }));
  const mod = await import(/* @vite-ignore */ url);
  URL.revokeObjectURL(url);
  const frames: Frame[] = [];
  const display = { present: (width: number, height: number, rgba: Uint8Array) => frames.push({ width, height, rgba: new Uint8Array(rgba) }) };
  const exports = await mod.instantiate((path: string) => WebAssembly.compile(files.get(path) as BufferSource), { 'jungle:arena/display': display });
  return { name, frames, game: exports['jungle:arena/game@1.0.0'] ?? exports.game };
}

function renderOne(instance: Instance, s: State, flipped: boolean, canvas?: HTMLCanvasElement): Frame {
  instance.frames.length = 0;
  instance.game.render(s, flipped, 1000);
  if (instance.frames.length !== 1) throw new Error(`${instance.name} presented ${instance.frames.length} frames for one render`);
  const frame = instance.frames[0]!;
  if (frame.width !== 448 || frame.height !== 576 || frame.rgba.length !== 448 * 576 * 4) {
    throw new Error(`${instance.name} presented a ${frame.width}×${frame.height} frame of ${frame.rgba.length} bytes`);
  }
  if (canvas) canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), 448, 576), 0, 0);
  return frame;
}

interface MatchReport {
  releaseSide: Side;
  plies: number;
  status: string;
  winner: Side | null;
  reason: string;
  framesPerInstance: number;
  snapshots: State[];
}

async function match(releaseBytes: Uint8Array, fixtureBytes: Uint8Array, releaseSide: Side): Promise<MatchReport> {
  // Fresh instances for every match.
  const release = await instantiate('release', releaseBytes);
  const fixture = await instantiate('fixture', fixtureBytes);
  const fixtureSide: Side = releaseSide === 'red' ? 'blue' : 'red';
  release.game.init({ seat: releaseSide, difficulty: 'medium', seed: SEED });
  fixture.game.init({ seat: fixtureSide, difficulty: 'medium', seed: SEED });
  let state = openingState('red');
  const snapshots = [state];
  let frames = 0;
  const draw = (s: State) => {
    renderOne(release, s, releaseSide === 'blue', $('release'));
    renderOne(fixture, s, fixtureSide === 'blue', $('fixture'));
    frames += 1;
  };
  draw(state);
  while (state.status === 'playing') {
    const active = state.toPlay === releaseSide ? release : fixture;
    const legal = legalMoves(state);
    let index: number;
    try {
      index = active.game.chooseMove(state, legal.map((m) => ({ ...m })), BUDGET);
    } catch (err) {
      log(`  ${active.name} trapped in choose-move: ${err instanceof Error ? err.message : String(err)}`);
      state = forfeit(state, state.toPlay, 'trap');
      break;
    }
    if (!Number.isInteger(index) || index < 0 || index >= legal.length) {
      state = forfeit(state, state.toPlay, 'invalid-move');
      break;
    }
    state = apply(state, legal[index]!);
    snapshots.push(state);
    draw(state);
    if (snapshots.length % 10 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  if (snapshots.at(-1) !== state) {
    snapshots.push(state);
    draw(state);
  }
  return { releaseSide, plies: state.history.length, status: state.status, winner: state.winner ?? null, reason: state.reason, framesPerInstance: frames, snapshots };
}

/** Seek straight to recorded revisions on fresh instances, in both orientations. */
async function replaySeek(releaseBytes: Uint8Array, fixtureBytes: Uint8Array, snapshots: State[]): Promise<number> {
  const release = await instantiate('release', releaseBytes);
  const fixture = await instantiate('fixture', fixtureBytes);
  const picks = [snapshots.length - 1, 0, Math.floor(snapshots.length / 2), 1, snapshots.length - 2].filter((i) => i >= 0 && i < snapshots.length);
  let checked = 0;
  for (const i of picks) {
    for (const flipped of [false, true]) {
      const a = renderOne(release, snapshots[i]!, flipped);
      const b = renderOne(release, snapshots[i]!, flipped);
      if (a.rgba.some((v, k) => v !== b.rgba[k])) throw new Error(`release frames for revision ${i} are not reproducible`);
      renderOne(fixture, snapshots[i]!, flipped);
      checked += 1;
    }
  }
  return checked;
}

async function run(releaseBytes: Uint8Array, source: string): Promise<void> {
  $('log').innerHTML = '';
  const result = $('result');
  result.dataset['status'] = 'running';
  const started = performance.now();
  try {
    const hash = await sha256(releaseBytes);
    log(`release ${source}: ${releaseBytes.length} bytes, SHA-256 ${hash}`);
    let published: { sha256?: string } = {};
    try {
      published = await (await fetch('../release/release.json', { cache: 'no-cache' })).json();
    } catch {
      published = {};
    }
    const matchesPublished = published.sha256 ? published.sha256 === hash : null;
    log(matchesPublished === null ? 'no published release.json to compare' : matchesPublished ? 'hash matches the published release.json' : 'hash differs from the published release.json');
    const fixtureBytes = await fetchBytes('./jungle-fixture-1.0.0.wasm');
    const info = (await instantiate('release', releaseBytes)).game.info();
    log(`info(): ${info['title']} v${info['gameVersion']} — ${info['model']} / ${info['codeAgent']}, rules ${info['rulesId']}`);

    // Rendering must not change a choice: choose, render three times, choose again.
    const probe = await instantiate('release', releaseBytes);
    probe.game.init({ seat: 'red', difficulty: 'medium', seed: SEED });
    const opening = openingState('red');
    const openingLegal = legalMoves(opening);
    const firstChoice = probe.game.chooseMove(opening, openingLegal, BUDGET);
    for (const flipped of [false, true, false]) renderOne(probe, opening, flipped);
    const renderStable = probe.game.chooseMove(opening, openingLegal, BUDGET) === firstChoice;
    log(`render-does-not-change-choice: ${renderStable ? 'ok' : 'FAILED'} (index ${firstChoice})`);

    const matches: Omit<MatchReport, 'snapshots'>[] = [];
    let seekChecks = 0;
    for (const side of ['red', 'blue'] as const) {
      log(`match: release as ${side} vs fixture`);
      const report = await match(releaseBytes, fixtureBytes, side);
      log(`  ${report.status} / ${report.winner ?? 'none'} / ${report.reason} after ${report.plies} plies; ${report.framesPerInstance} frames per instance`);
      seekChecks += await replaySeek(releaseBytes, fixtureBytes, report.snapshots);
      const { snapshots: _snapshots, ...summary } = report;
      matches.push(summary);
    }
    log(`replay seek: ${seekChecks} revisions re-rendered by fresh instances in both orientations`);
    const terminal = matches.every((m) => m.status === 'won' || m.status === 'drawn');
    const releaseNeverForfeits = matches.every((m) => !(m.status === 'forfeited' && m.winner !== m.releaseSide));
    const rulesMatch = info['rulesId'] === 'desktop-jungle-v2' && info['rulesDigest'] === 'a457bbc009e975a9eafe5ff1f8fa40ca2548f2a689b121c8c4ed99dd0f3fdc57';
    const ok = terminal && releaseNeverForfeits && rulesMatch && renderStable && matchesPublished !== false;
    result.textContent = JSON.stringify({ ok, source, sha256: hash, publishedHashMatches: matchesPublished, rulesMatch, renderStable, info, matches, seekChecks, elapsedMs: Math.round(performance.now() - started), userAgent: navigator.userAgent }, null, 2);
    result.dataset['status'] = ok ? 'passed' : 'failed';
  } catch (err) {
    result.textContent = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2);
    result.dataset['status'] = 'failed';
  }
}

$('run').addEventListener('click', async () => run(await fetchBytes('../jungle-opus55-1.1.0.wasm'), 'published site'));
$('file').addEventListener('change', async () => {
  const file = ($('file') as HTMLInputElement).files?.[0];
  if (file) await run(new Uint8Array(await file.arrayBuffer()), file.name);
});

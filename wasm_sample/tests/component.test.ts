// Milestone 3 (Arena binary) and 4 (cross-build parity) checks on the exact release file.
import { readFileSync } from 'node:fs';
import { componentWit } from '@bytecodealliance/jco-transpile/wasm-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import moves from '../spec/fixtures/moves.json';
import adjudication from '../spec/fixtures/adjudication.json';
import {
  encode,
  FIXTURE,
  initWeb,
  instantiate,
  opening,
  pairs,
  playOut,
  RELEASE,
  renderOnce,
  sparse,
  TEST_BUILD,
  web,
  type Instance,
  type WireSnapshot,
} from './support';

const DIGEST = 'a457bbc009e975a9eafe5ff1f8fa40ca2548f2a689b121c8c4ed99dd0f3fdc57';
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const cells = (b: object) => b as Record<string, string>;

let release: Instance;
let testBuild: Instance;
let positions: WireSnapshot[];

beforeAll(async () => {
  initWeb();
  release = await instantiate(RELEASE);
  testBuild = await instantiate(TEST_BUILD);
  release.game.init({ seat: 'red', difficulty: 'medium', seed: 2026 });
  testBuild.game.init({ seat: 'red', difficulty: 'medium', seed: 2026 });
  const mid = playOut(opening('red'), 9, (l) => Math.floor(l.length / 2), testBuild.rules);
  positions = [opening('red'), opening('blue'), mid, ...moves.map((m) => sparse(cells(m.board)))];
});

describe('release binary', () => {
  it('imports only display and exports only the game interface', async () => {
    const wit = await componentWit(new Uint8Array(readFileSync(RELEASE)));
    const imports = [...wit.matchAll(/^\s*import (\S+);/gm)].map((m) => m[1]);
    const exports = [...wit.matchAll(/^\s*export (\S+);/gm)].map((m) => m[1]);
    expect(imports).toEqual(['jungle:arena/display@1.0.0']);
    expect(exports).toEqual(['jungle:arena/game@1.0.0']);
  });

  it('reports its identity and the contractual rules', () => {
    const info = release.game.info();
    expect(info).toMatchObject({ title: 'Claude-Opus-5.5 · ClaudeCode', gameVersion: '1.1.0', model: 'Claude-Opus-5.5', codeAgent: 'ClaudeCode', modelPlatform: 'official', githubUrl: 'https://github.com/xmiao76/jungle-leaderboard', rulesId: 'desktop-jungle-v2', rulesDigest: DIGEST });
    expect(JSON.parse(web.identity_json())).toEqual(info);
  });

  it('plays either seat, and two copies of one file keep separate state', async () => {
    const a = await instantiate(RELEASE);
    const b = await instantiate(RELEASE);
    a.game.init({ seat: 'red', difficulty: 'hard', seed: 1 });
    b.game.init({ seat: 'blue', difficulty: 'easy', seed: 99 });
    const s = opening('red');
    const legal = pairs(web.legal_of(encode(s)));
    const first = a.game.chooseMove(s, legal, 3000);
    const afterRed = testBuild.rules!.apply(s, legal[first]!)!;
    const blueLegal = pairs(web.legal_of(encode(afterRed)));
    expect(b.game.chooseMove(afterRed, blueLegal, 3000)).toBeLessThan(blueLegal.length);
    // Instance b's very different settings do not leak into a.
    expect(a.game.chooseMove(s, legal, 3000)).toBe(first);
  });

  it('finds a jump, takes a capture and renders terminal snapshots and direct seeks', () => {
    const jump = sparse({ 21: 'red:lion', 24: 'blue:dog', 0: 'blue:rat' });
    const jl = pairs(web.legal_of(encode(jump)));
    expect(jl[release.game.chooseMove(jump, jl, 5000)]).toEqual({ src: 21, dst: 24 });

    const won = testBuild.rules!.apply(sparse({ 2: 'red:cat', 0: 'blue:rat' }), { src: 2, dst: 3 })!;
    expect(won).toMatchObject({ status: 'won', winner: 'red', reason: 'den', toPlay: 'blue' });
    const banner = renderOnce(release, won, false);
    const live = renderOnce(release, { ...won, status: 'playing', winner: undefined, reason: '' }, false);
    expect(same(banner, live)).toBe(false);

    // Seeking straight to a late revision draws it without any earlier frames.
    const fresh = positions[2]!;
    expect(renderOnce(release, fresh, true).length).toBe(448 * 576 * 4);
  });

  it('never lets rendering change a choice', () => {
    const s = positions[2]!;
    const legal = pairs(web.legal_of(encode(s)));
    const before = release.game.chooseMove(s, legal, 6000);
    for (const p of [0, 333, 1000]) renderOnce(release, s, p % 2 === 0, p);
    expect(release.game.chooseMove(s, legal, 6000)).toBe(before);
  });

  it('draws labels and art in each piece’s own square in both orientations', () => {
    for (const flipped of [false, true]) {
      const frame = renderOnce(release, opening('red'), flipped);
      // Red elephant on 42: the label band of its cell holds near-white text pixels.
      const cell = flipped ? 62 - 42 : 42;
      const [x, y] = [(cell % 7) * 64, Math.floor(cell / 7) * 64];
      let bright = 0;
      for (let yy = y + 46; yy < y + 58; yy += 1) {
        for (let xx = x + 10; xx < x + 54; xx += 1) {
          const i = (yy * 448 + xx) * 4;
          if (frame[i]! > 230 && frame[i + 1]! > 230 && frame[i + 2]! > 230) bright += 1;
        }
      }
      expect(bright, `flipped=${flipped}`).toBeGreaterThan(25);
    }
  });

  it('the fixture opponent always plays index 0 and draws a visibly different board', async () => {
    const fixture = await instantiate(FIXTURE);
    fixture.game.init({ seat: 'blue', difficulty: 'medium', seed: 0 });
    const s = positions[2]!;
    expect(fixture.game.chooseMove(s, pairs(web.legal_of(encode(s))), 1000)).toBe(0);
    let differing = 0;
    const a = renderOnce(fixture, s, false);
    const b = renderOnce(release, s, false);
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) differing += 1;
    expect(differing / (a.length / 4)).toBeGreaterThan(0.5);
  });
});

describe('cross-build parity (standalone web build vs release component)', () => {
  it('chooses the same move at equal seed and budget', () => {
    for (const s of positions) {
      if (s.status !== 'playing') continue;
      const legal = pairs(web.legal_of(encode(s)));
      if (legal.length === 0) continue;
      expect(release.game.chooseMove(s, legal, 7000)).toBe(web.choose(encode(s), 7000, 2026, 1));
    }
  });

  it('draws byte-identical settled frames in both orientations', () => {
    for (const s of positions.slice(0, 4)) {
      for (const flipped of [false, true]) {
        expect(same(renderOnce(release, s, flipped), web.render_snapshot(encode(s), flipped, 1000))).toBe(true);
      }
    }
  });

  it('agrees on legal sets for every fixture position (test-exports build)', () => {
    for (const s of positions) {
      expect(testBuild.rules!.legalMoves(s)).toEqual(pairs(web.legal_of(encode(s))));
    }
  });

  it('agrees on applied moves, next player, counters and outcomes', () => {
    for (const row of adjudication) {
      // A row commits one `move`, or several `moves` in order (Red first, alternating sides).
      const plies = ('moves' in row ? row.moves : [row.move]) as number[][];
      const start = sparse(cells(row.board), 'red', row.quietBefore);
      const viaComponent = plies.reduce((s, [src, dst]) => testBuild.rules!.apply(s, { src: src!, dst: dst! })!, start);
      const viaWeb = plies.reduce((bytes, [src, dst]) => web.apply_to(bytes, src!, dst!), encode(start));
      expect(same(encode(viaComponent), viaWeb), row.name).toBe(true);
      const toPlay = plies.length % 2 === 1 ? 'blue' : 'red';
      expect(viaComponent).toMatchObject({ status: row.status, reason: row.reason, noCapturePlies: row.quietAfter, toPlay });
    }
    // An illegal move is refused by both.
    expect(testBuild.rules!.apply(opening('red'), { src: 42, dst: 44 })).toBeUndefined();
    expect(web.apply_to(encode(opening('red')), 42, 44).length).toBe(0);
  });
});

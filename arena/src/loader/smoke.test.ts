import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMove, initialSnapshot, legalMoves, sparseSnapshot } from '../referee';
import { FRAME_BYTES } from './limits';
import { instantiateInNode, readBinary } from './node-host';
import { runSmokeTest } from './smoke';

const fixture = (name: string) => readBinary(new URL(`../../test-fixtures/${name}`, import.meta.url));
const testEntrant = () => fixture('test-entrant-1.1.0.wasm');

describe('smoke test on the test entrant', () => {
  it('passes and returns two settled opening frames', async () => {
    const report = runSmokeTest(await instantiateInNode(testEntrant()));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.rulesCompatible).toBe(true);
    expect(report.metadata?.title).toBe('Arena test entrant');
    expect(report.frames).toHaveLength(2);
    expect(report.frames[0]!.rgba.byteLength).toBe(FRAME_BYTES);
    // Flipping changes the picture: the frame is the entrant's own view, not a copy.
    expect(Buffer.from(report.frames[0]!.rgba).equals(Buffer.from(report.frames[1]!.rgba))).toBe(false);
  });

  it('keeps separate state per instance of the same binary', async () => {
    const bytes = testEntrant();
    const [a, b] = await Promise.all([instantiateInNode(bytes), instantiateInNode(bytes)]);
    a.init('red', 'easy', 1);
    b.init('blue', 'hard', 2);
    const start = initialSnapshot('red');
    const next = applyMove(start, legalMoves(start)[0]!);
    expect(a.chooseMove(start, legalMoves(start), 100)).toBe(0);
    expect(b.chooseMove(next, legalMoves(next), 100)).toBe(0);
    expect(a.render(next, false, 1000)).toHaveLength(1);
  });

  it('renders a settled frame for any revision directly from its snapshot', async () => {
    const game = await instantiateInNode(testEntrant());
    let s = initialSnapshot('red');
    for (let i = 0; i < 6; i += 1) s = applyMove(s, legalMoves(s)[0]!);
    const direct = game.render(s, false, 1000)[0]!;
    const again = game.render(s, false, 1000)[0]!;
    expect(Buffer.from(direct.rgba).equals(Buffer.from(again.rgba))).toBe(true);
  });
});

describe('the public catalog program', () => {
  // The real game published with the site: a different program, so a different board.
  const published = () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/catalog/manifest.json', import.meta.url), 'utf8'));
    return readBinary(new URL(`../../public/catalog/${manifest.entries[0].file}`, import.meta.url));
  };

  it('passes the smoke test', async () => {
    const report = runSmokeTest(await instantiateInNode(published()));
    expect(report.issues).toEqual([]);
    expect(report.rulesCompatible).toBe(true);
  });

  it('draws visibly different frames from the test entrant for the same snapshot', async () => {
    const [test, real] = await Promise.all([instantiateInNode(testEntrant()), instantiateInNode(published())]);
    const s = initialSnapshot('red');
    const a = test.render(s, false, 1000)[0]!.rgba;
    const b = real.render(s, false, 1000)[0]!.rgba;
    let differing = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differing += 1;
    expect(differing / (a.length / 4)).toBeGreaterThan(0.5);
  });

  it('draws the terminal banner from the snapshot', async () => {
    const game = await instantiateInNode(published());
    const won = applyMove(sparseSnapshot({ 2: 'red:cat', 0: 'blue:rat' }, { toPlay: 'red' }), { src: 2, dst: 3 });
    const playing = sparseSnapshot({ 2: 'red:cat', 0: 'blue:rat' }, { toPlay: 'red' });
    const a = game.render(won, false, 1000)[0]!.rgba;
    const b = game.render({ ...playing, history: won.history }, false, 1000)[0]!.rgba;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('smoke test on broken entrants', () => {
  it.each([
    ['broken-trap.wasm', 'choose-move', /trapped/],
    ['broken-index.wasm', 'choose-move', /returned 24/],
    ['broken-frame-size.wasm', 'render', /440×576/],
    ['broken-no-frame.wasm', 'render', /without presenting/],
    ['broken-double-frame.wasm', 'render', /presented 2 frames/],
    ['broken-digest.wasm', 'info', /Rules digest/],
  ] as const)('%s fails at %s', async (name, step, message) => {
    const report = runSmokeTest(await instantiateInNode(fixture(name)));
    expect(report.ok).toBe(false);
    expect(report.failedStep).toBe(step);
    expect(report.issues.join('\n')).toMatch(message);
  });

  it('flags an incompatible rules digest as incompatible, not as a crash', async () => {
    const report = runSmokeTest(await instantiateInNode(fixture('broken-digest.wasm')));
    expect(report.rulesCompatible).toBe(false);
    expect(report.metadata?.title).toBe('Arena test entrant');
  });
});

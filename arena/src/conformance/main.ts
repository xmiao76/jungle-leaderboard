/**
 * Conformance runner page. A `.wasm` selected here goes through the same public upload
 * path visitors use (loader worker → contract → jco → smoke test), then through the
 * behavioural checks in checks.ts and full matches against the first program in the
 * public catalog in both colours and against itself. The machine-readable report is written to
 * `#result` with `data-status` set to `passed`, `failed` or `rejected`.
 */
import { importBinary, IMPORT_STAGES } from '../loader/import-service';
import { LOADER_VERSION } from '../loader/limits';
import { presentFrame } from '../ui/present';
import { createLoaderWorker, createSeatWorker } from '../workers/factories';
import { LoaderClient } from '../workers/rpc';
import {
  CONFORMANCE_SETTINGS,
  entrantFrom,
  loadOpponent,
  OPPONENT_LABEL,
  playMatch,
  renderDoesNotChangeChoice,
  twoInstancesAndFlip,
  type CheckResult,
  type MatchSummary,
} from './checks';

const root = document.getElementById('conformance')!;
root.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 72rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5">
    <h1>Jungle Arena — conformance runner</h1>
    <p>Select a <code>.wasm</code> component. It is admitted exactly as the Arena admits uploads, then checked for
    behaviour and played to a finish against ${OPPONENT_LABEL} as Red, as Blue, and against itself.
    Settings for every entrant: difficulty ${CONFORMANCE_SETTINGS.difficulty}, seed ${CONFORMANCE_SETTINGS.seed},
    budget ${CONFORMANCE_SETTINGS.nodeBudget} nodes, ${CONFORMANCE_SETTINGS.thinkDeadlineMs / 1000} s per move.</p>
    <input id="file" type="file" accept=".wasm,application/wasm" aria-label="Component to check" />
    <ol id="stages"></ol>
    <div style="display: flex; gap: 1rem; flex-wrap: wrap">
      <canvas id="frame-0" width="448" height="576" style="width: 224px; border: 1px solid #ccc" aria-label="Unflipped opening frame"></canvas>
      <canvas id="frame-1" width="448" height="576" style="width: 224px; border: 1px solid #ccc" aria-label="Flipped opening frame"></canvas>
    </div>
    <pre id="result" data-status="idle" style="white-space: pre-wrap"></pre>
  </main>`;

const fileInput = root.querySelector<HTMLInputElement>('#file')!;
const stages = root.querySelector<HTMLOListElement>('#stages')!;
const result = root.querySelector<HTMLPreElement>('#result')!;
const loader = new LoaderClient(createLoaderWorker);

function log(text: string): void {
  const li = document.createElement('li');
  li.textContent = text;
  stages.append(li);
}

async function run(file: File): Promise<void> {
  stages.innerHTML = '';
  result.dataset['status'] = 'running';
  result.textContent = '';
  const started = performance.now();
  const base = { file: file.name, loaderVersion: LOADER_VERSION, userAgent: navigator.userAgent, settings: CONFORMANCE_SETTINGS };

  const outcome = await importBinary(new Uint8Array(await file.arrayBuffer()), {
    loader,
    seatFactory: createSeatWorker,
    onStage: (stage) => log(`admission: ${stage} (${IMPORT_STAGES.indexOf(stage) + 1}/${IMPORT_STAGES.length})`),
  });
  if (!outcome.ok) {
    result.textContent = JSON.stringify({ ...base, ok: false, admitted: false, stage: outcome.stage, sha256: outcome.sha256, reasons: outcome.reasons, elapsedMs: Math.round(performance.now() - started) }, null, 2);
    result.dataset['status'] = 'rejected';
    return;
  }
  outcome.frames.forEach((frame, i) => presentFrame(root.querySelector<HTMLCanvasElement>(`#frame-${i}`)!, frame));

  const checks: CheckResult[] = [{ name: 'admission', ok: true, detail: 'size, header, contract, transpile and smoke test passed' }];
  log('check: render does not change the choice');
  checks.push(await renderDoesNotChangeChoice(outcome.artifact));
  log('check: two instances, flip');
  checks.push(...(await twoInstancesAndFlip(outcome.artifact)));

  const matches: MatchSummary[] = [];
  const entrant = entrantFrom(outcome.sha256, outcome.metadata, outcome.artifact);
  try {
    const opponent = await loadOpponent();
    log(`opponent: ${opponent.metadata.title} v${opponent.metadata.gameVersion} (${opponent.sha256.slice(0, 12)}…)`);
    for (const [label, red, blue, side] of [
      ['as-red', entrant, opponent, 'red'],
      ['as-blue', opponent, entrant, 'blue'],
      ['self', entrant, entrant, 'red'],
    ] as const) {
      log(`match: ${label}`);
      matches.push(await playMatch(label, red, blue, side, outcome.sha256));
    }
  } catch (err) {
    checks.push({ name: 'matches', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
  for (const m of matches) {
    const detail = m.result
      ? m.result.kind === 'system-error'
        ? `system error: ${m.result.message}`
        : `${m.result.status}/${m.result.winner ?? 'none'}/${m.result.reason} after ${m.plies} plies; both panes settled ${m.settledBothPanes} times`
      : 'did not start';
    checks.push({ name: `match-${m.label}`, ok: m.ok && m.settledBothPanes === m.plies + 1 + (m.result?.kind === 'forfeit' ? 1 : 0), detail });
  }

  const passed = checks.every((c) => c.ok);
  result.textContent = JSON.stringify(
    { ...base, ok: passed, admitted: true, sha256: outcome.sha256, size: outcome.size, metadata: outcome.metadata, checks, matches, elapsedMs: Math.round(performance.now() - started) },
    null,
    2,
  );
  result.dataset['status'] = passed ? 'passed' : 'failed';
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void run(file);
});

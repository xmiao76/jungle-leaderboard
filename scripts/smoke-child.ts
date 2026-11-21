// Runs the admission smoke test on one binary in its own process, so the parent can
// enforce a wall-clock deadline by killing it. Prints one JSON line on stdout.
import { readFileSync } from 'node:fs';
import { instantiateInNode } from '../arena/src/loader/node-host';
import { runSmokeTest } from '../arena/src/loader/smoke';

const file = process.argv[2];
if (!file) {
  console.error('usage: smoke-child <file.wasm>');
  process.exit(2);
}
const report = runSmokeTest(await instantiateInNode(new Uint8Array(readFileSync(file))));
process.stdout.write(`${JSON.stringify({ ok: report.ok, metadata: report.metadata, issues: report.issues, failedStep: report.failedStep })}\n`);

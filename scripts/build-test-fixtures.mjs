// Build the Arena's test fixtures from the test-only entrant in tests/test-entrant/.
//
//   node scripts/build-test-fixtures.mjs     (npm run build:fixtures)
//
// Output goes to arena/test-fixtures/, which is committed so the test suite needs no Rust
// toolchain. Nothing here is ever published in a catalog.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentNew } from '@bytecodealliance/jco-transpile/wasm-tools';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'arena', 'test-fixtures');
const CRATE = join(ROOT, 'tests', 'test-entrant');
const CORE = join(CRATE, 'target', 'wasm32-unknown-unknown', 'release', 'arena_test_entrant.wasm');

const VARIANTS = [
  // Well-behaved builds: a small, fast entrant for tests, in two versions ("A vs older A").
  { features: [], out: 'test-entrant-1.1.0.wasm' },
  { features: ['older'], out: 'test-entrant-1.0.0.wasm' },
  // Rejected at admission.
  ...[
    'broken-trap',
    'broken-hang',
    'broken-index',
    'broken-frame-size',
    'broken-no-frame',
    'broken-double-frame',
    'broken-digest',
    'broken-extra-import',
  ].map((feature) => ({ features: [feature], out: `${feature}.wasm` })),
  // Admitted, then failing mid-match: forfeits and display failures in a real browser.
  ...['broken-trap', 'broken-hang', 'broken-index', 'broken-frame-size'].map((feature) => ({
    features: [feature, 'late'],
    out: `late-${feature.replace('broken-', '')}.wasm`,
  })),
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

mkdirSync(FIXTURES, { recursive: true });
let release = null;
for (const variant of VARIANTS) {
  const args = ['build', '--release', '--quiet', '--target', 'wasm32-unknown-unknown'];
  if (variant.features.length) args.push('--features', variant.features.join(','));
  execFileSync('cargo', args, { cwd: CRATE, stdio: ['ignore', 'inherit', 'inherit'] });
  const core = readFileSync(CORE);
  const component = await componentNew(core);
  writeFileSync(join(FIXTURES, variant.out), component);
  console.log(`  ${sha256(component).slice(0, 16)}  ${String(component.length).padStart(8)} B  arena/test-fixtures/${variant.out}`);
  if (variant.features.length === 0) {
    release = component;
    // Admission must reject a bare core module with an actionable message.
    writeFileSync(join(FIXTURES, 'core-module.wasm'), core);
  }
}
// A truncated upload: valid preamble, cut mid-section.
writeFileSync(join(FIXTURES, 'truncated.wasm'), release.subarray(0, 4096));

// One command to rebuild both outputs from a clean checkout:
//   1. the single-file Arena entrant  dist/jungle-claude-opus-5-5-claudecode-official-1.1.0.wasm  (+ fixture and test builds)
//   2. the standalone static site      web/dist/
//
//   node scripts/build-all.mjs [--skip-web-build]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
import { componentNew, componentWit } from '@bytecodealliance/jco-transpile/wasm-tools';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'web', 'public');
const TARGET = join(ROOT, 'target', 'wasm32-unknown-unknown', 'release');
export const RELEASE_NAME = 'jungle-claude-opus-5-5-claudecode-official-1.1.0.wasm';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd !== 'cargo' && cmd !== 'node' });

async function component(crate, features, out) {
  const args = ['build', '--release', '--quiet', '--target', 'wasm32-unknown-unknown', '-p', crate];
  if (features) args.push('--features', features);
  run('cargo', args);
  const bytes = await componentNew(readFileSync(join(TARGET, `${crate.replace(/-/g, '_')}.wasm`)));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`  ${sha256(bytes).slice(0, 16)}  ${String(bytes.length).padStart(8)} B  ${out.slice(ROOT.length + 1)}`);
  return bytes;
}

console.log('assets');
run('node', ['scripts/fetch-assets.mjs']);
run('node', ['scripts/build-atlas.mjs']);

console.log('components');
const release = await component('jungle-entrant', null, join(DIST, RELEASE_NAME));
await component('jungle-entrant', 'test-exports', join(DIST, 'test', 'jungle-opus55-test.wasm'));
const fixture = await component('jungle-fixture', null, join(DIST, 'jungle-fixture-1.0.0.wasm'));

console.log('web wrapper (wasm-pack)');
run('wasm-pack', ['build', 'crates/jungle-web', '--release', '--target', 'web', '--out-dir', '../../web/src/pkg', '--no-pack']);

console.log('release documents');
const releaseDir = join(PUBLIC, 'release');
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(join(releaseDir, 'types'), { recursive: true });
const releaseHash = sha256(release);
copyFileSync(join(DIST, RELEASE_NAME), join(PUBLIC, RELEASE_NAME));
writeFileSync(join(PUBLIC, `${RELEASE_NAME}.sha256`), `${releaseHash}  ${RELEASE_NAME}\n`);
copyFileSync(join(ROOT, 'wit', 'jungle.wit'), join(releaseDir, 'jungle.wit'));
copyFileSync(join(ROOT, 'spec', 'rules', 'desktop-jungle-v2.json'), join(releaseDir, 'desktop-jungle-v2.json'));
writeFileSync(join(releaseDir, 'embedded.wit'), await componentWit(release));
const typed = await transpileBytes(release, { name: 'jungle-opus55', instantiation: 'async', emitTypescriptDeclarations: true });
for (const [name, bytes] of Object.entries(typed.files)) {
  if (!name.endsWith('.d.ts')) continue;
  const out = join(releaseDir, 'types', name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
}
const identity = JSON.parse(execFileSync('cargo', ['run', '-q', '--release', '-p', 'jungle-core', '--example', 'identity'], { cwd: ROOT }).toString());
const manifest = {
  file: RELEASE_NAME,
  sha256: releaseHash,
  size: release.length,
  ...identity,
  world: 'jungle:arena/competitor@1.0.0',
  imports: typed.imports,
  fixture: { file: 'host/jungle-fixture-1.0.0.wasm', sha256: sha256(fixture) },
  builtAt: new Date().toISOString(),
};
writeFileSync(join(releaseDir, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
mkdirSync(join(PUBLIC, 'host'), { recursive: true });
copyFileSync(join(DIST, 'jungle-fixture-1.0.0.wasm'), join(PUBLIC, 'host', 'jungle-fixture-1.0.0.wasm'));
console.log(`  release ${releaseHash}`);

if (!process.argv.includes('--skip-web-build')) {
  console.log('standalone site (vite)');
  run('npx', ['vite', 'build', '--config', 'web/vite.config.ts']);
}

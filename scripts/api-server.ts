// The site with its catalog API, locally: `wrangler pages dev` serves dist/ and functions/
// with local D1/R2 state. Every start applies new migrations and re-loads the seed catalog
// (both are idempotent); --fresh first wipes the state directory, so tests and conformance runs
// start from the seed catalog alone.
//
//   node --import tsx scripts/api-server.ts [--port 8788] [--state .wrangler/state] [--fresh]
import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCatalog } from './db-seed';
import { migrate, ROOT, spawnWrangler } from './wrangler-run';

export interface ApiServer {
  /** Origin of the server, e.g. http://127.0.0.1:8788 (no trailing slash). */
  readonly origin: string;
  close(): Promise<void>;
}

const READY_TIMEOUT_MS = 90_000;

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  // wrangler runs workerd as a grandchild; on Windows only taskkill /T takes the whole tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitUntilReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler pages dev exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/catalog/manifest.json`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the catalog API did not answer within ${READY_TIMEOUT_MS / 1000} s`);
}

const STATE_ROOT = join(ROOT, '.wrangler');

/** Only a folder inside .wrangler/ (other than wrangler's own tmp/) may be wiped, whatever --state says. */
function assertDisposable(stateDir: string): void {
  const inside = relative(STATE_ROOT, resolve(stateDir));
  // On Windows a different drive makes relative() return an absolute path.
  const isInside = inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
  if (!isInside || inside.split(sep)[0] === 'tmp') throw new Error(`--fresh only wipes a folder inside .wrangler/, not ${stateDir}`);
}

export async function startApiServer(options: { port: number; stateDir: string; fresh: boolean }): Promise<ApiServer> {
  if (!existsSync(join(ROOT, 'dist', 'arena'))) throw new Error('dist/ is missing: run `npm run build` first.');
  const target = { mode: 'local', persistTo: options.stateDir } as const;
  if (options.fresh) {
    assertDisposable(options.stateDir);
    rmSync(options.stateDir, { recursive: true, force: true });
  }
  await migrate(target);
  await seedCatalog(target);
  const origin = `http://127.0.0.1:${options.port}`;
  const child = spawnWrangler([
    'pages', 'dev', 'dist',
    '--ip', '127.0.0.1',
    '--port', String(options.port),
    '--inspector-port', String(options.port + 1000),
    '--persist-to', options.stateDir,
    '--show-interactive-dev-session', 'false',
    '--log-level', 'warn',
  ]);
  try {
    await waitUntilReady(origin, child);
  } catch (err) {
    killTree(child);
    throw err;
  }
  return {
    origin,
    close: async () => killTree(child),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
  try {
    const server = await startApiServer({
      port: Number(flag('--port', '8788')),
      stateDir: resolve(flag('--state', join(ROOT, '.wrangler', 'state'))),
      fresh: args.includes('--fresh'),
    });
    console.log(`site and catalog API at ${server.origin}/ (catalog: ${server.origin}/api/catalog/manifest.json)`);
    const stop = () => void server.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    console.error(`api-server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

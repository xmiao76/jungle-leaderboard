// The site with its catalog API, locally: `wrangler pages dev` serves dist/ and functions/
// with local D1/R2 state. Every start applies new migrations and re-loads the seed catalog
// (both are idempotent); --fresh first wipes the state directory, so tests and conformance runs
// start from the seed catalog alone.
//
//   node --import tsx scripts/api-server.ts [--port 8788] [--state .wrangler/state] [--fresh]
//
// The port is the last --port given, else ARENA_API_PORT, else 8788 (the Vite dev server's
// /api proxy reads the same variable). If another program already uses the port, it stops at
// once and says so, rather than waiting for a server that cannot start there.
import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_FORMAT } from '../arena/src/catalog/catalog';
import { seedCatalog } from './db-seed';
import { migrate, ROOT, spawnWrangler } from './wrangler-run';

export interface ApiServer {
  /** Origin of the server, e.g. http://127.0.0.1:8788 (no trailing slash). */
  readonly origin: string;
  close(): Promise<void>;
}

const READY_TIMEOUT_MS = 90_000;
const DEFAULT_PORT = 8788;
const PROBE_TIMEOUT_MS = 1_000;

/** The last --port, else ARENA_API_PORT, else 8788; anything else is an error. */
export function portFrom(args: readonly string[], env: Readonly<Record<string, string | undefined>>): number {
  const i = args.lastIndexOf('--port');
  const raw = i >= 0 ? args[i + 1] : (env['ARENA_API_PORT'] ?? String(DEFAULT_PORT));
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`"${raw}" is not a valid port`);
  return port;
}

function canListen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

async function somethingAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

/** Throws when another program holds the port: bound on 127.0.0.1, or answering there from [::]. */
export async function assertPortFree(port: number): Promise<void> {
  if ((await canListen(port)) && !(await somethingAnswers(port))) return;
  throw new Error(
    `port ${port} is already in use by another program. Stop that program, or choose another port: ` +
      `npm run dev:full -- --port ${port + 2}`,
  );
}

/** Ready means the Arena catalog itself answered, not just any server on the port. */
export function isArenaCatalog(status: number, body: unknown): boolean {
  return status === 200 && typeof body === 'object' && body !== null && (body as { format?: unknown }).format === CATALOG_FORMAT;
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  // wrangler runs workerd as a grandchild; on Windows only taskkill /T takes the whole tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitUntilReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastSeen = 'no answer';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler pages dev exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/catalog/manifest.json`);
      const body: unknown = await response.json().catch(() => null);
      if (isArenaCatalog(response.status, body)) return;
      lastSeen = `HTTP ${response.status} ${response.headers.get('content-type') ?? ''}`.trim();
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the catalog API did not answer within ${READY_TIMEOUT_MS / 1000} s (last answer: ${lastSeen})`);
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
  // Check before the slow migrate and seed steps, so a busy port fails in about a second.
  await assertPortFree(options.port);
  const target = { mode: 'local', persistTo: options.stateDir } as const;
  if (options.fresh) {
    assertDisposable(options.stateDir);
    rmSync(options.stateDir, { recursive: true, force: true });
  }
  await migrate(target);
  await seedCatalog(target);
  const origin = `http://127.0.0.1:${options.port}`;
  console.log(`api-server: starting the site and catalog API on ${origin}/ (this can take a few seconds)…`);
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
  const flag = (name: string, fallback: string) => (args.includes(name) ? (args[args.lastIndexOf(name) + 1] ?? fallback) : fallback);
  try {
    const server = await startApiServer({
      port: portFrom(args, process.env),
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

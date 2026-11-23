// Shared helpers for scripts that drive the pinned wrangler (local or remote D1/R2).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Names from wrangler.toml. */
export const DB_NAME = 'jungle-arena';
export const BUCKET_NAME = 'jungle-arena-entrants';

// The package does not export bin/; find it next to its main entry (wrangler-dist/cli.js).
const WRANGLER = join(dirname(createRequire(import.meta.url).resolve('wrangler')), '..', 'bin', 'wrangler.js');

/** Where a command acts: the local state (optionally in a chosen directory) or the real account. */
export type Target = { readonly mode: 'local'; readonly persistTo?: string } | { readonly mode: 'remote' };

export function targetArgs(target: Target): string[] {
  if (target.mode === 'remote') return ['--remote'];
  return target.persistTo ? ['--local', '--persist-to', target.persistTo] : ['--local'];
}

export function spawnWrangler(args: readonly string[]): ChildProcess {
  return spawn(process.execPath, [WRANGLER, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
}

/** Run one wrangler command to completion; rejects with its exit code on failure. */
export function runWrangler(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnWrangler(args);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} exited with ${code}`))));
  });
}

export function migrate(target: Target): Promise<void> {
  return runWrangler(['d1', 'migrations', 'apply', DB_NAME, ...targetArgs(target)]);
}

/** Run one wrangler command and capture its stdout (for `--json` answers) instead of inheriting it. */
export function runWranglerCapture(args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise(stdout) : reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`)),
    );
  });
}

/** `wrangler d1 execute --json` answers one `{results: [...]}` object per statement. */
export function parseD1Json(text: string): Record<string, unknown>[] {
  const start = text.indexOf('[');
  if (start < 0) throw new Error(`wrangler returned no JSON array: ${text.slice(0, 200)}`);
  const parsed: unknown = JSON.parse(text.slice(start));
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'object' || parsed[0] === null || !Array.isArray((parsed[0] as { results?: unknown }).results)) {
    throw new Error('wrangler d1 execute --json returned an unexpected shape');
  }
  return (parsed[0] as { results: Record<string, unknown>[] }).results;
}

/** Read rows from D1 (one statement; callers validate the fields they interpolate). */
export async function d1Query(target: Target, sql: string): Promise<Record<string, unknown>[]> {
  return parseD1Json(await runWranglerCapture(['d1', 'execute', DB_NAME, '--json', '--command', sql, ...targetArgs(target)]));
}

/**
 * Apply a batch of SQL statements from a temp file. D1 rejects explicit BEGIN/COMMIT, so the
 * statements run in order; callers order them so an interruption is safe to re-run over.
 */
export async function d1ExecuteSql(target: Target, sql: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'jungle-sql-'));
  try {
    const file = join(dir, 'statements.sql');
    writeFileSync(file, sql);
    await runWrangler(['d1', 'execute', DB_NAME, '--file', file, '--yes', ...targetArgs(target)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Download one R2 object (`<sha256>.wasm`) to a local file. */
export function r2GetToFile(target: Target, key: string, file: string): Promise<void> {
  return runWrangler(['r2', 'object', 'get', `${BUCKET_NAME}/${key}`, '--file', file, ...targetArgs(target)]);
}

/** Delete one R2 object (`<sha256>.wasm`). */
export function r2DeleteObject(target: Target, key: string): Promise<void> {
  return runWrangler(['r2', 'object', 'delete', `${BUCKET_NAME}/${key}`, ...targetArgs(target)]);
}

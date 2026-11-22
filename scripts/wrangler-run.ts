// Shared helpers for scripts that drive the pinned wrangler (local or remote D1/R2).
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
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

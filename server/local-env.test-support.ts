/**
 * Real local D1 and R2 for server tests: wrangler's getPlatformProxy runs workerd with the
 * bindings from wrangler.toml, in memory (nothing persisted, never remote), and every
 * migration in migrations/ is applied exactly as `wrangler d1 migrations apply` would.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';

const ROOT = new URL('../', import.meta.url);

export interface LocalEnv {
  readonly env: Env;
  /** Empty the catalog table and the bucket between tests. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

async function applyMigrations(db: D1Database): Promise<void> {
  const dir = new URL('migrations/', ROOT);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const statement of unstable_splitSqlQuery(readFileSync(new URL(file, dir), 'utf8'))) {
      await db.prepare(statement).run();
    }
  }
}

export async function startLocalEnv(): Promise<LocalEnv> {
  const proxy = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL('wrangler.toml', ROOT)),
    persist: false,
    remoteBindings: false,
  });
  await applyMigrations(proxy.env.DB);
  return {
    env: proxy.env,
    async reset() {
      await proxy.env.DB.prepare('DELETE FROM entrants').run();
      await proxy.env.DB.prepare('DELETE FROM upload_quota').run();
      const listed = await proxy.env.ENTRANTS.list();
      if (listed.objects.length > 0) await proxy.env.ENTRANTS.delete(listed.objects.map((o) => o.key));
    },
    dispose: () => proxy.dispose(),
  };
}

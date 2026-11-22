// Run first by `npm run deploy`: refuse to deploy while wrangler.toml still carries the
// local-only placeholder D1 id, which would publish an Arena whose catalog API cannot reach
// a database. Create the database (`wrangler d1 create jungle-arena`), put its id in
// wrangler.toml, then deploy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/** Problems that make this wrangler.toml unfit for a production deploy. */
export function deployConfigIssues(tomlText) {
  const ids = [...tomlText.matchAll(/^\s*database_id\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  if (ids.length === 0) return ['wrangler.toml declares no D1 database_id.'];
  return ids
    .filter((id) => PLACEHOLDER.test(id))
    .map(() => 'wrangler.toml still uses the local placeholder D1 database_id. Run `npx wrangler d1 create jungle-arena` and record its id.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const issues = deployConfigIssues(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  if (issues.length > 0) {
    for (const issue of issues) console.error(`deploy refused: ${issue}`);
    process.exit(1);
  }
}

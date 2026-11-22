// Apply migrations/ to the catalog database.
//
//   npm run db:migrate -- --local [--persist-to <dir>]
//   npm run db:migrate -- --remote
import { parseTarget } from './db-seed';
import { migrate } from './wrangler-run';

try {
  await migrate(parseTarget(process.argv.slice(2)));
} catch (err) {
  console.error(`db:migrate: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

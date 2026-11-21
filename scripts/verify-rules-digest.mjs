// Fails the build if the SDK rules profile no longer hashes to the contractual digest.
// The digest covers the exact bytes (UTF-8, LF, one final LF, no BOM), so an editor that
// reformats or re-ends the file breaks admission for every entrant.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES_DIGEST = 'a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63';
export const RULES_PATH = fileURLToPath(new URL('../sdk/rules/desktop-jungle-v1.json', import.meta.url));

export function rulesDigest(path = RULES_PATH) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const actual = rulesDigest();
  if (actual !== RULES_DIGEST) {
    console.error(`rules digest mismatch\n  expected ${RULES_DIGEST}\n  actual   ${actual}\n  file     ${RULES_PATH}`);
    process.exit(1);
  }
  console.log(`rules digest ok (${RULES_DIGEST.slice(0, 12)}…)`);
}

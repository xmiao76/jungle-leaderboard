// Fails the build if the SDK rules profile no longer hashes to the contractual digest.
// The digest covers the exact bytes (UTF-8, LF, one final LF, no BOM), so an editor that
// reformats or re-ends the file breaks admission for every entrant.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES_DIGEST = 'a457bbc009e975a9eafe5ff1f8fa40ca2548f2a689b121c8c4ed99dd0f3fdc57';
export const RULES_PATH = fileURLToPath(new URL('../sdk/rules/desktop-jungle-v2.json', import.meta.url));

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

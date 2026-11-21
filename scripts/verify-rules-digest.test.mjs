import { describe, expect, it } from 'vitest';
import { RULES_DIGEST, rulesDigest } from './verify-rules-digest.mjs';

describe('SDK rules profile', () => {
  it('hashes to the contractual rules digest', () => {
    expect(rulesDigest()).toBe(RULES_DIGEST);
  });
});

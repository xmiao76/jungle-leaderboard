import { RULES_DIGEST, RULES_ID } from '../referee/profile';
import type { Metadata } from '../referee/types';
import { MAX_METADATA_CHARS } from './limits';

const FIELDS = ['title', 'gameVersion', 'model', 'codeAgent', 'engineVersion', 'runtime', 'rulesId', 'rulesDigest'] as const;

export interface MetadataCheck {
  readonly metadata: Metadata | null;
  /** Problems that make the entrant inadmissible. */
  readonly issues: readonly string[];
  readonly rulesCompatible: boolean;
}

/**
 * Metadata is untrusted text: it is never interpreted as markup and never used as a
 * key. Control characters are removed and length is capped before display.
 */
export function sanitizeText(value: string): string {
  // Control characters, zero-width and bidi formatting, line/paragraph separators, BOM.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '').trim();
}

export function checkMetadata(raw: unknown): MetadataCheck {
  if (typeof raw !== 'object' || raw === null) {
    return { metadata: null, issues: ['info() did not return a metadata record.'], rulesCompatible: false };
  }
  const issues: string[] = [];
  const record = raw as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') {
      issues.push(`info().${field} is not a string.`);
      clean[field] = '';
      continue;
    }
    const text = sanitizeText(value);
    if (text.length > MAX_METADATA_CHARS) issues.push(`info().${field} is longer than ${MAX_METADATA_CHARS} characters.`);
    if (text.length === 0 && field !== 'engineVersion') issues.push(`info().${field} is empty.`);
    clean[field] = text.slice(0, MAX_METADATA_CHARS);
  }

  // Identity is compared on the raw strings: "desktop-jungle-v1\0" is not the rules ID.
  const rulesCompatible = record['rulesId'] === RULES_ID && record['rulesDigest'] === RULES_DIGEST;
  if (record['rulesId'] !== RULES_ID) {
    issues.push(`Rules ID is "${clean['rulesId']}", expected "${RULES_ID}".`);
  }
  if (record['rulesDigest'] !== RULES_DIGEST) {
    issues.push(`Rules digest is "${clean['rulesDigest']}", expected ${RULES_DIGEST}.`);
  }
  return { metadata: clean as unknown as Metadata, issues, rulesCompatible };
}

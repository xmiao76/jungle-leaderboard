/**
 * Abuse brakes shared by every write endpoint (catalog uploads, match reports): the Turnstile
 * bot check, the salted reporter identity, and per-day quotas.
 */

/** Cloudflare's documented always-pass Turnstile secret, used locally, in CI and in e2e. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = 'ok' | 'failed' | 'unavailable';

/**
 * Verify one Turnstile token. Siteverify always answers success for the test secret, so that
 * call is skipped (same outcome, no network): local runs and CI need no internet access. Only
 * the operator sets the secret, so this opens nothing in production.
 */
export async function verifyTurnstile(fetcher: typeof fetch, secret: string, token: string, address: string): Promise<TurnstileResult> {
  if (secret === TURNSTILE_TEST_SECRET) return 'ok';
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, ...(address ? { remoteip: address } : {}) }),
    });
    if (!response.ok) return 'unavailable';
    const outcome = (await response.json()) as { success?: unknown };
    return outcome.success === true ? 'ok' : 'failed';
  } catch {
    return 'unavailable';
  }
}

/** A reporter's identity for quotas and abuse review: a salted hash, never the address. */
export async function hashUploader(salt: string, address: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${address}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Quota bucket for one reporter on one UTC day. */
export function quotaBucket(reporter: string, date: Date): string {
  return `${reporter}|${date.toISOString().slice(0, 10)}`;
}

/** A configured daily limit (an optional binding, e.g. raised for e2e), else `fallback`. */
export function dailyLimit(configured: string | undefined, fallback: number): number {
  const value = Number(configured);
  return configured && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The quota tables; each has `(bucket TEXT PRIMARY KEY, count INTEGER)`. */
const CONSUME: Readonly<Record<'upload_quota' | 'report_quota', string>> = {
  upload_quota: 'INSERT INTO upload_quota (bucket, count) VALUES (?, 1) ON CONFLICT (bucket) DO UPDATE SET count = count + 1 WHERE upload_quota.count < ?',
  report_quota: 'INSERT INTO report_quota (bucket, count) VALUES (?, 1) ON CONFLICT (bucket) DO UPDATE SET count = count + 1 WHERE report_quota.count < ?',
};

/** Atomically take one of today's attempts; false when the allowance is used up. */
export async function consumeQuota(db: D1Database, table: keyof typeof CONSUME, bucket: string, limit: number): Promise<boolean> {
  const result = await db.prepare(CONSUME[table]).bind(bucket, limit).run();
  return result.meta.changes > 0;
}

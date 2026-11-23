import { describe, expect, it, vi } from 'vitest';
import { dailyLimit, quotaBucket, TURNSTILE_TEST_SECRET, verifyTurnstile } from './abuse';

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('verifyTurnstile', () => {
  it("skips the network for Cloudflare's always-pass test secret, whose answer is always success", async () => {
    const fetcher = reply({ success: false });
    expect(await verifyTurnstile(fetcher, TURNSTILE_TEST_SECRET, 'any-token', '203.0.113.5')).toBe('ok');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks siteverify for any other secret', async () => {
    expect(await verifyTurnstile(reply({ success: true }), 'real-secret', 'token', '')).toBe('ok');
    expect(await verifyTurnstile(reply({ success: false }), 'real-secret', 'token', '')).toBe('failed');
    expect(await verifyTurnstile(reply({}, false), 'real-secret', 'token', '')).toBe('unavailable');
    expect(await verifyTurnstile(vi.fn(async () => { throw new Error('offline'); }), 'real-secret', 'token', '')).toBe('unavailable');
  });
});

describe('dailyLimit', () => {
  it('uses a configured positive whole number, else the default', () => {
    expect(dailyLimit('500', 20)).toBe(500);
    expect(dailyLimit(undefined, 20)).toBe(20);
    for (const bad of ['', '0', '-3', '2.5', 'many']) expect(dailyLimit(bad, 20), bad).toBe(20);
  });
});

describe('quotaBucket', () => {
  it('keys one reporter on one UTC day', () => {
    expect(quotaBucket('abc', new Date('2026-11-22T23:59:59Z'))).toBe('abc|2026-11-22');
  });
});

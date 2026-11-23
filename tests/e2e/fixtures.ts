import { test as base, expect } from '@playwright/test';

/**
 * Every e2e page gets a stand-in for Cloudflare's Turnstile script: it hands out a dummy token at
 * once, and the local API accepts any token because it runs with Cloudflare's always-pass test
 * secret (scripts/api-server.ts). So uploads and match reports need no network in e2e.
 */
const TURNSTILE_STUB = `window.turnstile = {
  render(host, options) { setTimeout(() => options.callback('XXXX.DUMMY.TOKEN.XXXX'), 0); return 'e2e-stub'; },
  remove() {},
};`;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }));
    await use(page);
  },
});

export { expect };

/**
 * Cloudflare Turnstile, the bot check in front of every write (uploads, match reports). The
 * script loads on first use; each request gets one fresh token (tokens are single-use and expire
 * after 300 s), so a token is fetched when it is needed, never at page load. The widget only
 * appears if Cloudflare wants an interaction, in a fixed corner overlay that never moves the page.
 * Browser-only: covered by e2e, which stubs the script.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Cloudflare's always-pass test key, used whenever no real key was built in. */
const TEST_SITE_KEY = '1x00000000000000000000AA';
const TOKEN_TIMEOUT_MS = 120_000;

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY;

interface RenderOptions {
  readonly sitekey: string;
  readonly action: string;
  readonly appearance: 'interaction-only';
  readonly callback: (token: string) => void;
  readonly 'error-callback': () => void;
  readonly 'expired-callback': () => void;
}

interface TurnstileApi {
  render(host: HTMLElement, options: RenderOptions): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('The bot check did not start.')));
    script.onerror = () => {
      loading = null; // allow a retry
      reject(new Error('The bot check could not be loaded. Check your connection and try again.'));
    };
    document.head.append(script);
  });
  return loading;
}

/** One fresh Turnstile token for one request; `action` labels it in Cloudflare's analytics. */
export async function turnstileToken(action: 'upload' | 'match'): Promise<string> {
  const api = await loadTurnstile();
  const host = document.createElement('div');
  host.className = 'fixed right-4 bottom-4 z-50';
  document.body.append(host);
  let widgetId: string | null = null;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The bot check took too long; try again.')), TOKEN_TIMEOUT_MS);
      const settle = (fn: () => void) => () => {
        clearTimeout(timer);
        fn();
      };
      widgetId = api.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        appearance: 'interaction-only',
        callback: (token) => settle(() => resolve(token))(),
        'error-callback': settle(() => reject(new Error('The bot check failed; reload the page and try again.'))),
        'expired-callback': settle(() => reject(new Error('The bot check expired; try again.'))),
      });
    });
  } finally {
    if (widgetId !== null) api.remove(widgetId);
    host.remove();
  }
}

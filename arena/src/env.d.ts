/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  /** Cloudflare Turnstile site key; unset locally, where the always-pass test key is used. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

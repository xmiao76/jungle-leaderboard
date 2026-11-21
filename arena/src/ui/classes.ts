/**
 * Shared class strings. Complete literals only, so Tailwind's scanner sees every
 * class; never build a token class by concatenation. Token colours never take a /NN
 * opacity modifier (it silently drops) — use the -soft / -line tokens instead.
 */
export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 py-2 text-sm font-semibold text-fg transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50',
  quiet:
    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted transition hover:bg-inset hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
} as const;

export const CARD = 'rounded-2xl border border-line bg-raised p-5 sm:p-6';
export const LABEL = 'text-[0.66rem] font-semibold tracking-[0.14em] text-subtle uppercase';
export const FIELD =
  'w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-fg transition focus-visible:border-accent disabled:opacity-60';
export const SECTION_TITLE = 'font-display text-2xl font-semibold tracking-tight sm:text-3xl';

export const SIDE_CHIP = {
  red: 'inline-flex items-center gap-1.5 rounded-full border border-side-red-line bg-side-red-soft px-2.5 py-0.5 text-xs font-semibold text-side-red',
  blue: 'inline-flex items-center gap-1.5 rounded-full border border-side-blue-line bg-side-blue-soft px-2.5 py-0.5 text-xs font-semibold text-side-blue',
} as const;

export const SIDE_DOT = {
  red: 'inline-block h-2 w-2 rounded-full bg-side-red',
  blue: 'inline-block h-2 w-2 rounded-full bg-side-blue',
} as const;

export const ORIGIN_BADGE = {
  public: 'inline-flex items-center rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[0.68rem] font-semibold text-accent',
  device: 'inline-flex items-center rounded-full border border-line-strong bg-inset px-2 py-0.5 text-[0.68rem] font-semibold text-muted',
} as const;

export const NOTICE_TONE = {
  error: 'border-bronze-line bg-bronze-soft',
  warning: 'border-gold-line bg-gold-soft',
  info: 'border-accent-line bg-accent-soft',
} as const;

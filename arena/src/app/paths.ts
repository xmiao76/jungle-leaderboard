/**
 * URLs between the site's pages. Every Arena page declares where the Arena root is,
 * relative to itself, in `<meta name="arena-root">` (`./` for /arena/, `../` for
 * /arena/upload/), so links and the catalog resolve from any page and any deployment
 * subpath without absolute URLs.
 */
import type { Seat } from '../protocol/messages';
import type { Level, Side } from '../referee/types';

export type Page = 'leaderboard' | 'upload' | 'arena';

export function appRoot(): URL {
  const declared = document.querySelector<HTMLMetaElement>('meta[name="arena-root"]')?.content ?? './';
  return new URL(declared, document.baseURI);
}

export const arenaUrl = (selection: Partial<Record<Seat, string | null>> = {}): string => {
  const url = appRoot();
  for (const [seat, sha] of Object.entries(selection)) if (sha) url.searchParams.set(seat, sha);
  return url.href;
};
export const uploadUrl = (): string => new URL('upload/', appRoot()).href;
export const leaderboardUrl = (): string => new URL('../', appRoot()).href;
/** The catalog API (functions/api/catalog/), a sibling of the Arena at the site root. */
export const catalogBase = (): URL => new URL('../api/catalog/', appRoot());
/** POST target for publishing an upload (functions/api/catalog/index.ts). */
export const catalogUploadUrl = (): URL => new URL('../api/catalog', appRoot());
/** POST target for a finished match's result (functions/api/matches/index.ts). */
export const matchesUrl = (): URL => new URL('../api/matches', appRoot());
export const sdkUrl = (file: string): string => new URL(`sdk/${file}`, appRoot()).href;

// ---- The play page (/arena/play/) -------------------------------------------------------

export type Speed = 'slow' | 'normal' | 'fast';

/** Everything a match needs, carried in the play page's URL so it is shareable and reloadable. */
export interface PlayConfig {
  readonly left: string;
  readonly right: string;
  readonly leftSide: Side;
  readonly firstSide: Side;
  readonly difficulty: Level;
  readonly seed: number;
  readonly nodeBudget: number;
  readonly thinkDeadlineMs: number;
  readonly speed: Speed;
  readonly beginPaused: boolean;
}

const playPage = (root: URL = appRoot()): URL => new URL('play/', root);

export function playUrl(config: PlayConfig, root?: URL): string {
  const url = playPage(root);
  const p = url.searchParams;
  p.set('left', config.left);
  p.set('right', config.right);
  p.set('leftSide', config.leftSide);
  p.set('first', config.firstSide);
  p.set('level', config.difficulty);
  p.set('seed', String(config.seed));
  p.set('budget', String(config.nodeBudget));
  p.set('think', String(config.thinkDeadlineMs));
  p.set('speed', config.speed);
  if (config.beginPaused) p.set('paused', '1');
  return url.href;
}

export const replayUrl = (id: string, root?: URL): string => {
  const url = playPage(root);
  url.searchParams.set('replay', id);
  return url.href;
};

export interface PlayRequest {
  /** Set when the page should play back a saved replay instead of starting a match. */
  readonly replay: string | null;
  /** Valid fields only; anything missing keeps its default. */
  readonly config: Partial<PlayConfig>;
  /** Fields that were present but invalid, for a notice. */
  readonly issues: readonly string[];
}

const SIDE_VALUES: readonly Side[] = ['red', 'blue'];
const LEVEL_VALUES: readonly Level[] = ['easy', 'medium', 'hard'];
const SPEED_VALUES: readonly Speed[] = ['slow', 'normal', 'fast'];
const SHA = /^[0-9a-f]{64}$/;

function intIn(text: string | null, min: number, max: number): number | null {
  if (text === null || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Parse and validate the play page's query string. Never throws. */
export function parsePlayQuery(search: string = location.search): PlayRequest {
  const p = new URLSearchParams(search);
  const issues: string[] = [];
  const config: { -readonly [K in keyof PlayConfig]?: PlayConfig[K] } = {};
  const pick = <T extends string>(name: string, allowed: readonly T[], apply: (v: T) => void) => {
    const v = p.get(name);
    if (v === null) return;
    if ((allowed as readonly string[]).includes(v)) apply(v as T);
    else issues.push(`${name}=${v}`);
  };

  const replay = p.get('replay');
  for (const seat of ['left', 'right'] as const) {
    const sha = p.get(seat);
    if (sha === null) continue;
    if (SHA.test(sha)) config[seat] = sha;
    else issues.push(`${seat} is not a SHA-256`);
  }
  pick('leftSide', SIDE_VALUES, (v) => (config.leftSide = v));
  pick('first', SIDE_VALUES, (v) => (config.firstSide = v));
  pick('level', LEVEL_VALUES, (v) => (config.difficulty = v));
  pick('speed', SPEED_VALUES, (v) => (config.speed = v));
  const numbers: [string, number, number, (n: number) => void][] = [
    ['seed', 0, 0xffffffff, (n) => (config.seed = n)],
    ['budget', 1, 10_000_000, (n) => (config.nodeBudget = n)],
    ['think', 100, 120_000, (n) => (config.thinkDeadlineMs = n)],
  ];
  for (const [name, min, max, apply] of numbers) {
    const raw = p.get(name);
    if (raw === null) continue;
    const n = intIn(raw, min, max);
    if (n === null) issues.push(`${name}=${raw}`);
    else apply(n);
  }
  if (p.has('paused')) config.beginPaused = p.get('paused') === '1';
  return { replay: replay && /^[\w.-]{1,80}$/.test(replay) ? replay : null, config, issues };
}

/** Seats preselected by a shareable `?left=<sha256>&right=<sha256>` link. */
export function selectionFromQuery(search: string = location.search): Partial<Record<Seat, string>> {
  const params = new URLSearchParams(search);
  const out: Partial<Record<Seat, string>> = {};
  for (const seat of ['left', 'right'] as const) {
    const sha = params.get(seat);
    if (sha && /^[0-9a-f]{64}$/.test(sha)) out[seat] = sha;
  }
  return out;
}

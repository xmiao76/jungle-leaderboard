/**
 * Application state and actions. Vue components read `state` and call the exported
 * actions; workers, the controller and storage live outside reactivity.
 */
import { reactive, toRaw, watch } from 'vue';
import { MatchAudio } from '../audio/sfx';
import { fetchPublicBinary, fetchPublicManifest, groupByTitle, mergeCatalog, type CatalogEntry, type CatalogGroup } from '../catalog/catalog';
import { publishEntrant } from '../catalog/publish';
import { ROUND_STAGES, runUploadRound, type RoundStage } from '../conformance/round';
import type { Frame } from '../loader/frame';
import { sha256Hex } from '../loader/hash';
import { importBinary, IMPORT_STAGES, type ImportOutcome, type ImportStage } from '../loader/import-service';
import { DEADLINES, DEFAULT_NODE_BUDGET, LOADER_VERSION, MAX_UPLOAD_BYTES } from '../loader/limits';
import { MatchController, type AnimationPlan, type MatchEntrant, type MatchResult, type MatchView } from '../match/controller';
import {
  describeSeries,
  describeSeriesGame,
  GAMES_PER_MATCH,
  planSeries,
  summarizeSeries,
  type GameNumber,
  type SeriesGame,
  type SeriesSummary,
} from '../match/series';
import { RATED_SETTINGS, ratedEligibility, type RatedEligibility } from '../match/rated';
import { buildMatchReport, postMatchReport, type ReportOutcome } from '../match/report';
import { SEATS, type Seat } from '../protocol/messages';
import { initialSnapshot, RULES_DIGEST, RULES_ID } from '../referee';
import { opponent, type Level, type Metadata, type PlyMove, type Side } from '../referee/types';
import { REPLAY_FORMAT, withPly, withResult, type ReplayV1 } from '../replay/schema';
import { MemoryStore, openArenaStore, ResilientStore, type ArenaStore } from '../storage/db';
import { createLoaderWorker, createRefereeWorker, createSeatWorker } from '../workers/factories';
import { arenaUrl, catalogBase, catalogUploadUrl, matchesUrl, parsePlayQuery, playUrl, selectionFromQuery, type PlayConfig, type Speed } from './paths';
import { turnstileToken } from './turnstile';
import { LoaderClient, realClock } from '../workers/rpc';

export const ARENA_VERSION = '1.0.0';
/** Matches start at full strength (the brief's `hard`), the rated standard (match/rated.ts). */
export const DEFAULT_DIFFICULTY: Level = RATED_SETTINGS.difficulty;

export type { Speed } from './paths';
export const SPEEDS: Readonly<Record<Speed, AnimationPlan>> = {
  slow: { steps: [200, 400, 600, 800], pauseMs: 900 },
  normal: { steps: [333, 667], pauseMs: 350 },
  fast: { steps: [], pauseMs: 0 },
};

export interface Notice {
  readonly id: number;
  readonly tone: 'error' | 'warning' | 'info';
  readonly title: string;
  readonly body: string;
}

/** The two-game match in progress or just finished (match/series.ts). */
export interface SeriesView {
  readonly id: string;
  /** The game being played or last played. */
  game: GameNumber;
  games: SeriesGame[];
  /** Set once the match is over: after game 2, or after a system error. */
  summary: SeriesSummary | null;
  text: string | null;
  details: string[];
  /** While game 1's result is shown: when game 2 starts (epoch ms). */
  nextGameAt: number | null;
  /** Each game's moves, for the result report. */
  moves: PlyMove[][];
  /** What became of the result: friendly, being reported, rated, or why not. */
  rating: RatingView | null;
}

export type RatingView = { readonly state: 'friendly'; readonly reason: string } | { readonly state: 'reporting' } | ReportOutcome;

export interface ArenaState {
  booted: boolean;
  storageNotice: string | null;
  catalogError: string | null;
  entries: CatalogEntry[];
  selection: Record<Seat, string | null>;
  settings: {
    leftSide: Side;
    firstSide: Side;
    difficulty: Level;
    seed: number;
    nodeBudget: number;
    thinkDeadlineMs: number;
    speed: Speed;
    beginPaused: boolean;
  };
  preparing: Record<Seat, string | null>;
  match: MatchView | null;
  series: SeriesView | null;
  matchEntrants: Record<Seat, CatalogEntry> | null;
  matchSides: Record<Seat, Side> | null;
  replayId: string | null;
  notices: Notice[];
  muted: boolean;
  announcement: string;
  replays: ReplayV1[];
  /** On the play page: the replay being played back instead of a live match. */
  viewReplay: ReplayV1 | null;
}

const audio = new MatchAudio();
const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const state: ArenaState = reactive({
  booted: false,
  storageNotice: null,
  catalogError: null,
  entries: [],
  selection: { left: null, right: null },
  settings: {
    leftSide: 'red',
    firstSide: 'red',
    difficulty: DEFAULT_DIFFICULTY,
    seed: randomSeed(),
    nodeBudget: DEFAULT_NODE_BUDGET,
    thinkDeadlineMs: DEADLINES.think,
    speed: 'normal',
    beginPaused: false,
  },
  preparing: { left: null, right: null },
  match: null,
  series: null,
  matchEntrants: null,
  matchSides: null,
  replayId: null,
  notices: [],
  muted: audio.muted,
  announcement: '',
  replays: [],
  viewReplay: null,
}) as ArenaState;

/** Replaced by the IndexedDB-backed store in boot(); memory until then. */
let store: ArenaStore = new ResilientStore(new MemoryStore());
let controller: MatchController | null = null;
let replay: ReplayV1 | null = null;
let noticeId = 0;
const loader = new LoaderClient(createLoaderWorker);

// ---- Frame presentation -----------------------------------------------------------------

/** Draws one frame on a pane; `rev` is the revision the frame shows. */
type Presenter = (frame: Frame, rev: number) => void;
const presenters: Record<Seat, Presenter | null> = { left: null, right: null };

/** PlayBoard registers how to draw on its canvas. */
export function registerPresenter(seat: Seat, presenter: Presenter | null): void {
  presenters[seat] = presenter;
}

/** Both settled frames are staged and presented in one animation callback. */
function presentSettled(frames: Readonly<Record<Seat, Frame | null>>, rev: number): void {
  requestAnimationFrame(() => {
    for (const seat of SEATS) {
      const frame = frames[seat];
      if (frame) presenters[seat]?.(frame, rev);
    }
  });
}

// ---- Notices ----------------------------------------------------------------------------

export function notify(tone: Notice['tone'], title: string, body: string): void {
  state.notices.push({ id: ++noticeId, tone, title, body });
}

export function dismissNotice(id: number): void {
  state.notices = state.notices.filter((n) => n.id !== id);
}

// ---- Boot and catalog -----------------------------------------------------------------------

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

export const groups = (): CatalogGroup[] => groupByTitle(state.entries);
export const entryByHash = (sha256: string | null) => state.entries.find((e) => e.sha256 === sha256) ?? null;

export async function refreshCatalog(): Promise<void> {
  const [publicCatalog, device] = await Promise.all([fetchPublicManifest(catalogBase()), store.listPackages()]);
  state.catalogError = publicCatalog.error;
  state.entries = mergeCatalog(publicCatalog.entries, device);
  for (const seat of SEATS) {
    if (state.selection[seat] && !entryByHash(state.selection[seat])) state.selection[seat] = null;
  }
}

export async function boot(): Promise<void> {
  store = new ResilientStore(await openArenaStore());
  state.storageNotice = store.unavailableReason;
  await refreshCatalog();
  // Seat choices: a shareable ?left=&right= link first, then what this viewer picked last
  // (on either page), then the first two public programs.
  const fromQuery = selectionFromQuery();
  const stored = loadStoredSelection();
  for (const seat of SEATS) {
    const wanted = fromQuery[seat] ?? stored[seat];
    if (wanted && entryByHash(wanted)) state.selection[seat] = wanted;
    else if (fromQuery[seat]) {
      notify('warning', 'That link names a program this browser does not have', `The ${seat} seat's program (${fromQuery[seat]!.slice(0, 12)}…) is not in the public catalog or on this device. Upload it first.`);
    }
  }
  const g = groups();
  state.selection.left ??= g[0]?.versions[0]?.sha256 ?? null;
  state.selection.right ??= (g[1] ?? g[0])?.versions[0]?.sha256 ?? null;
  watch(() => ({ ...state.selection }), saveSelection);
  saveSelection();
  state.replays = await store.listReplays();
  state.booted = true;
}

// ---- Import ---------------------------------------------------------------------------------

/** Every step of an upload, in order: admission, the upload round, then publishing. */
export type UploadStage = ImportStage | RoundStage | 'publish';
export const UPLOAD_STAGES: readonly UploadStage[] = [...IMPORT_STAGES, ...ROUND_STAGES, 'publish'];

export type UploadOutcome =
  | Extract<ImportOutcome, { ok: true }>
  | {
      readonly ok: false;
      readonly stage: UploadStage;
      readonly sha256: string | null;
      readonly reasons: readonly string[];
      readonly metadata: Metadata | null;
    };

export interface ImportResult {
  readonly outcome: UploadOutcome;
  /** These exact bytes were already published. */
  readonly reused: boolean;
}

export interface UploadProgress {
  onStage(stage: UploadStage): void;
  onPly(stage: RoundStage, plies: number): void;
}

/**
 * Upload = admission → the upload round (behaviour checks + two games against the reference)
 * → Turnstile → publish to the shared catalog. Nothing is stored anywhere unless every step
 * passes and the server accepts it; afterwards only the transpiled code is cached here.
 */
export async function importFile(file: File, progress: UploadProgress): Promise<ImportResult> {
  // Refuse oversized files before reading them into memory at all.
  if (file.size > MAX_UPLOAD_BYTES) {
    progress.onStage('size');
    const reason = `The file is ${(file.size / 1048576).toFixed(1)} MiB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MiB.`;
    return { outcome: { ok: false, stage: 'size', sha256: null, reasons: [reason], metadata: null }, reused: false };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const admitted = await importBinary(bytes, {
    loader,
    seatFactory: createSeatWorker,
    onStage: (stage) => progress.onStage(stage),
    cachedArtifact: async (sha) => store.getTranspiled(sha, LOADER_VERSION),
  });
  if (!admitted.ok) return { outcome: admitted, reused: false };
  const refuse = (stage: UploadStage, reasons: readonly string[]): ImportResult => ({
    outcome: { ok: false, stage, sha256: admitted.sha256, reasons, metadata: admitted.metadata },
    reused: false,
  });

  const round = await runUploadRound(admitted.sha256, admitted.metadata, admitted.artifact, progress);
  if (!round.ok) return refuse(round.stage, round.reasons);

  progress.onStage('publish');
  let token: string;
  try {
    token = await turnstileToken('upload');
  } catch (err) {
    return refuse('publish', [err instanceof Error ? err.message : String(err)]);
  }
  const published = await publishEntrant(
    { bytes, sha256: admitted.sha256, metadata: admitted.metadata, report: round.report, turnstileToken: token },
    catalogUploadUrl(),
  );
  if (!published.ok) return refuse('publish', published.reasons);

  await store.putTranspiled(admitted.sha256, LOADER_VERSION, admitted.artifact);
  state.storageNotice = store.unavailableReason;
  await refreshCatalog();
  return { outcome: admitted, reused: published.existing };
}

// ---- Seat selection across pages -----------------------------------------------------------

const SELECTION_KEY = 'jungle-arena:selection';

function loadStoredSelection(): Partial<Record<Seat, string>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') as Partial<Record<Seat, unknown>>;
    const out: Partial<Record<Seat, string>> = {};
    for (const seat of SEATS) if (typeof parsed[seat] === 'string') out[seat] = parsed[seat] as string;
    return out;
  } catch {
    return {};
  }
}

/** A per-viewer convenience: the page still works when storage is blocked. */
function saveSelection(): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(toRaw(state.selection)));
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** From the upload page: put a program in a seat and go to the Arena to play it. */
export function useInSeat(seat: Seat, sha256: string): void {
  state.selection[seat] = sha256;
  saveSelection();
  location.assign(arenaUrl({ [seat]: sha256 }));
}

/** Entries stored in this browser, newest first (upload page). */
export const deviceEntries = () => state.entries.filter((e) => e.onDevice).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
export const publicEntries = () => state.entries.filter((e) => e.origin === 'public');

export async function forgetDeviceEntry(sha256: string): Promise<void> {
  await store.deletePackage(sha256);
  await refreshCatalog();
}

// ---- Preparing entrants ---------------------------------------------------------------------

async function entrantBytes(entry: CatalogEntry): Promise<Uint8Array> {
  if (entry.origin === 'device' || entry.onDevice) {
    const stored = await store.getPackage(entry.sha256);
    if (stored) {
      // Reopening an entry: the stored bytes must still be the bytes that were admitted.
      const actual = await sha256Hex(stored.bytes);
      if (actual !== entry.sha256) throw new Error(`The stored copy of ${entry.metadata.title} no longer matches its hash; re-import it.`);
      return stored.bytes;
    }
  }
  if (entry.file) return fetchPublicBinary({ file: entry.file, sha256: entry.sha256 }, catalogBase());
  throw new Error(`${entry.metadata.title} is not available on this device any more.`);
}

export async function prepareEntrant(entry: CatalogEntry, onStatus: (text: string) => void = () => {}): Promise<MatchEntrant> {
  const cached = await store.getTranspiled(entry.sha256, LOADER_VERSION);
  if (cached) {
    // Reopening a stored entry re-proves its bytes even when the transpile cache hits.
    if (entry.origin === 'device' || entry.onDevice) await entrantBytes(entry);
    return { sha256: entry.sha256, metadata: entry.metadata, artifact: { js: cached.js, modules: cached.modules } };
  }
  onStatus('Downloading and verifying…');
  const bytes = await entrantBytes(entry);
  onStatus('Validating and transpiling…');
  const reply = await loader.validate(bytes.slice().buffer as ArrayBuffer, {
    skipTranspile: false,
    onProgress: (stage) => onStatus(`Loader: ${stage}…`),
    validateDeadlineMs: DEADLINES.validate,
    transpileDeadlineMs: DEADLINES.transpile,
  });
  if (reply.type === 'REJECTED') throw new Error(`${entry.metadata.title} failed admission at ${reply.stage}: ${reply.reasons.join(' ')}`);
  if (reply.sha256 !== entry.sha256) throw new Error(`${entry.metadata.title} changed: its bytes hash to ${reply.sha256.slice(0, 12)}….`);
  const artifact = reply.artifact!;
  await store.putTranspiled(entry.sha256, LOADER_VERSION, artifact);
  return { sha256: entry.sha256, metadata: entry.metadata, artifact };
}

// ---- Matches --------------------------------------------------------------------------------

function newId(): string {
  return `${Date.now().toString(36)}-${randomSeed().toString(36)}`;
}

/**
 * Persist before the match advances. The record is cloned to plain JSON data first:
 * IndexedDB cannot store Vue proxies, and a DataCloneError here once silently pushed
 * every replay into memory-only storage (regression test: e2e replay-after-reload).
 */
async function persistReplay(next: ReplayV1): Promise<void> {
  replay = JSON.parse(JSON.stringify(next)) as ReplayV1;
  await store.putReplay(replay);
  if (!store.persistent && state.storageNotice !== store.unavailableReason) {
    state.storageNotice = store.unavailableReason;
    notify('warning', 'Replay kept in memory only', `${store.unavailableReason ?? ''} Download the replay before leaving this page.`);
  }
}

function describeMove(rev: number, seat: Seat, side: Side, src: number, dst: number, captured: boolean): string {
  return `Move ${rev}: ${side} (${seat} seat) ${src} to ${dst}${captured ? ', capture' : ''}.`;
}

// ---- Matches: always two games (match/series.ts) ---------------------------------------------

/** How long game 1's result stays up before game 2 starts, per animation speed. */
const BETWEEN_GAMES_MS: Readonly<Record<Speed, number>> = { slow: 4_000, normal: 2_500, fast: 1_200 };
let nextGameTimer: ReturnType<typeof setTimeout> | null = null;

const entrantName = (entry: CatalogEntry) => `${entry.metadata.title} v${entry.metadata.gameVersion}`;

/**
 * Start a match: two games between the selected versions. Game 1 uses the colours as set up;
 * game 2 starts by itself with the colours swapped and the same first side, so each version
 * moves first once. The overall match result is shown after game 2.
 */
export async function startMatch(): Promise<void> {
  audio.unlock();
  // Raw objects: these end up in worker messages and IndexedDB, which cannot take proxies.
  const leftEntry = entryByHash(state.selection.left);
  const rightEntry = entryByHash(state.selection.right);
  const left = leftEntry ? toRaw(leftEntry) : null;
  const right = rightEntry ? toRaw(rightEntry) : null;
  if (!left || !right) {
    notify('warning', 'Pick two entrants', 'Choose a version in each column before starting.');
    return;
  }
  stopMatch();
  // One copy of the settings for both games: changing the speed during game 1 must not change
  // what game 2 is.
  const settings = { ...state.settings };
  const id = newId();
  state.series = {
    id,
    game: 1,
    games: planSeries(settings.leftSide, settings.firstSide),
    summary: null,
    text: null,
    details: [],
    nextGameAt: null,
    moves: [[], []],
    rating: null,
  };
  await startGame(id, 1, { left, right }, settings);
}

/** One game of the match identified by `seriesId`; a newer match makes it a no-op. */
async function startGame(
  seriesId: string,
  game: GameNumber,
  picked: Readonly<Record<Seat, CatalogEntry>>,
  settings: ArenaState['settings'],
): Promise<void> {
  const series = state.series;
  if (!series || series.id !== seriesId) return;
  disposeController();
  series.game = game;
  series.nextGameAt = null;
  const { left, right } = picked;
  const sides: Record<Seat, Side> = { ...series.games[game - 1]!.sides };
  state.matchEntrants = { left, right };
  state.matchSides = sides;
  state.match = null;

  let entrants: Record<Seat, MatchEntrant>;
  try {
    const [l, r] = await Promise.all(
      (['left', 'right'] as const).map((seat) =>
        prepareEntrant(seat === 'left' ? left : right, (text) => (state.preparing[seat] = text)).finally(() => (state.preparing[seat] = null)),
      ),
    );
    entrants = { left: l!, right: r! };
  } catch (err) {
    notify('error', 'Could not prepare the entrants', err instanceof Error ? err.message : String(err));
    return;
  }
  if (state.series?.id !== seriesId) return; // a newer match started while preparing

  const matchId = newId();
  state.replayId = matchId;
  await persistReplay({
    format: REPLAY_FORMAT,
    version: 1,
    id: matchId,
    createdAt: new Date().toISOString(),
    arena: { version: ARENA_VERSION, loaderVersion: LOADER_VERSION },
    rules: { id: RULES_ID, digest: RULES_DIGEST },
    series: { id: seriesId, game, of: GAMES_PER_MATCH },
    seats: {
      left: { sha256: left.sha256, size: left.size, metadata: left.metadata, side: sides.left },
      right: { sha256: right.sha256, size: right.size, metadata: right.metadata, side: sides.right },
    },
    settings: {
      firstSide: settings.firstSide,
      seed: settings.seed,
      difficulty: settings.difficulty,
      nodeBudget: settings.nodeBudget,
      deadlines: { load: DEADLINES.load, think: settings.thinkDeadlineMs, render: DEADLINES.render },
    },
    initial: initialSnapshot(settings.firstSide),
    plies: [],
    result: null,
    final: null,
  });

  const created = new MatchController({
    matchId,
    entrants,
    settings: {
      sides,
      firstSide: settings.firstSide,
      difficulty: settings.difficulty,
      seed: settings.seed,
      nodeBudget: settings.nodeBudget,
      thinkDeadlineMs: settings.thinkDeadlineMs,
    },
    seatFactory: createSeatWorker,
    refereeFactory: createRefereeWorker,
    clock: realClock,
    loadDeadlineMs: DEADLINES.load,
    renderDeadlineMs: DEADLINES.render,
    animation: () => (prefersReducedMotion() ? { ...SPEEDS[state.settings.speed], steps: [] } : SPEEDS[state.settings.speed]),
    listener: {
      state: (view) => {
        if (controller === created) state.match = view;
      },
      frame: (seat, frame, rev) => presenters[seat]?.(frame, rev),
      settled: (frames, rev) => presentSettled(frames, rev),
      committed: async (record, snapshot) => {
        if (replay?.id === matchId) await persistReplay(withPly(replay, record));
        audio.play(record.captured ? 'capture' : 'move');
        state.announcement = describeMove(snapshot.rev, record.seat, record.side, record.move.src, record.move.dst, record.captured !== null);
      },
      ended: async (result, snapshot) => {
        if (replay?.id === matchId) await persistReplay(withResult(replay, result, snapshot));
        state.replays = await store.listReplays();
        audio.play('end');
        if (result.kind === 'system-error') notify('error', 'The game stopped with a system error', result.message);
        else if (result.kind === 'forfeit' && result.forfeit) {
          const f = result.forfeit;
          const title = f.reason === 'timeout' ? 'An entrant ran out of time' : f.reason === 'trap' ? 'An entrant crashed' : 'An entrant proposed an invalid move';
          notify('warning', title, `${f.side} (${f.seat} seat) forfeited: ${f.message}`);
        }
        gameEnded(seriesId, game, result, picked, settings, snapshot?.history ?? []);
      },
    },
  });
  controller = created;
  await created.start();
  if (controller !== created) return;
  const view = created.view;
  if (view.phase === 'failed') {
    notify('error', 'An entrant failed to initialize', view.failure ?? 'Unknown failure.');
    // No board result: the match cannot be completed.
    gameEnded(seriesId, game, { kind: 'system-error', message: view.failure ?? 'An entrant failed to initialize.', endRev: 0 }, picked, settings, []);
    return;
  }
  if (!settings.beginPaused) created.play();
}

/** Record one game's result; after game 1 schedule game 2, after game 2 show the match result. */
function gameEnded(
  seriesId: string,
  game: GameNumber,
  result: MatchResult,
  picked: Readonly<Record<Seat, CatalogEntry>>,
  settings: ArenaState['settings'],
  moves: readonly PlyMove[],
): void {
  const series = state.series;
  if (!series || series.id !== seriesId || series.games[game - 1]!.result) return;
  series.games[game - 1] = { ...series.games[game - 1]!, result: JSON.parse(JSON.stringify(result)) as MatchResult };
  series.moves[game - 1] = moves.map((m) => ({ src: m.src, dst: m.dst }));
  if (game === 1 && result.kind !== 'system-error') {
    const delay = BETWEEN_GAMES_MS[state.settings.speed];
    series.nextGameAt = Date.now() + delay;
    state.announcement = `Game 1 is over. Game 2 starts in ${Math.ceil(delay / 1000)} seconds, colours swapped.`;
    nextGameTimer = setTimeout(() => {
      nextGameTimer = null;
      void startGame(seriesId, 2, picked, settings);
    }, delay);
    return;
  }
  const played = series.games.filter((g) => g.result);
  const summary = summarizeSeries(played);
  series.summary = summary;
  series.text = describeSeries(summary, { left: entrantName(picked.left), right: entrantName(picked.right) });
  series.details = played.map(describeSeriesGame);
  // The play page shows the full result in MatchResultDialog; this line is for screen readers.
  state.announcement = series.text;
  void reportMatch(seriesId, picked, settings);
}

/** Whether a match between these catalog entries, at these settings, changes Elo ratings. */
export function matchEligibility(left: CatalogEntry | null, right: CatalogEntry | null, settings: Pick<ArenaState['settings'], 'difficulty' | 'nodeBudget' | 'thinkDeadlineMs'>): RatedEligibility {
  if (!left || !right) return { rated: false, reason: 'Pick a program for each seat.' };
  return ratedEligibility({ left: left.sha256, right: right.sha256, leftPublished: left.origin === 'public', rightPublished: right.origin === 'public', settings });
}

/**
 * Report a finished match to the Arena: rated ones change both Elo ratings, the rest are friendly
 * and stay local. Never blocks the result display; the outcome appears in MatchResultDialog.
 */
async function reportMatch(seriesId: string, picked: Readonly<Record<Seat, CatalogEntry>>, settings: ArenaState['settings']): Promise<void> {
  const series = state.series;
  if (!series || series.id !== seriesId || !series.summary) return;
  const eligibility = matchEligibility(picked.left, picked.right, settings);
  if (!eligibility.rated) {
    series.rating = { state: 'friendly', reason: eligibility.reason };
    return;
  }
  const body = buildMatchReport({
    left: picked.left.sha256,
    right: picked.right.sha256,
    settings,
    games: series.games.map((g, i) => ({ result: g.result, moves: series.moves[i] ?? [] })),
  });
  if (!body) {
    series.rating = { state: 'friendly', reason: 'A game ended without a board result, so there is nothing to rate.' };
    return;
  }
  series.rating = { state: 'reporting' };
  let outcome: ReportOutcome;
  try {
    outcome = await postMatchReport(body, await turnstileToken('match'), matchesUrl());
  } catch (err) {
    outcome = { state: 'failed', reasons: [err instanceof Error ? err.message : String(err)] };
  }
  if (state.series?.id === seriesId) state.series.rating = outcome;
}

function disposeController(): void {
  controller?.dispose();
  controller = null;
}

/** Stop the current game and any game 2 still waiting to start. */
export function stopMatch(): void {
  if (nextGameTimer) {
    clearTimeout(nextGameTimer);
    nextGameTimer = null;
  }
  if (state.series) state.series.nextGameAt = null;
  disposeController();
}

/** A new two-game match with game 1's colours exchanged; the play page's URL follows. */
export async function swapAndRematch(): Promise<void> {
  state.settings.leftSide = opponent(state.settings.leftSide);
  const config = currentPlayConfig();
  if (config) history.replaceState(null, '', playUrl(config));
  await startMatch();
}

// ---- Setup page → play page ----------------------------------------------------------------

function currentPlayConfig(): PlayConfig | null {
  const { left, right } = state.selection;
  if (!left || !right) return null;
  return { left, right, ...state.settings };
}

/** Setup page: open the full-screen play page for the chosen entrants and settings. */
export function goToPlay(): void {
  const config = currentPlayConfig();
  if (!config) {
    notify('warning', 'Pick two entrants', 'Choose a version in each column before starting.');
    return;
  }
  location.assign(playUrl(config));
}

/**
 * Play page boot: storage and catalogs, then either a saved replay (`?replay=`) or the match
 * described by the URL, started at once (the visitor already pressed Start on the setup page).
 */
export async function bootPlay(): Promise<void> {
  await boot();
  const request = parsePlayQuery();
  if (request.issues.length > 0) {
    notify('warning', 'Some match settings in the link were ignored', request.issues.join(', '));
  }
  if (request.replay) {
    const saved = state.replays.find((r) => r.id === request.replay) ?? null;
    if (!saved) notify('error', 'Replay not found', 'This browser has no saved replay with that id. Open it from the Arena setup page.');
    state.viewReplay = saved;
    return;
  }
  const { left, right, ...settings } = request.config;
  for (const [seat, sha] of [['left', left], ['right', right]] as const) {
    if (!sha) continue;
    if (entryByHash(sha)) state.selection[seat] = sha;
    else notify('error', `The ${seat} program is not available`, `${sha.slice(0, 12)}… is not in the public catalog or on this device. Upload it first.`);
  }
  Object.assign(state.settings, settings);
  await startMatch();
}

export const play = () => {
  audio.unlock();
  controller?.play();
};
export const pause = () => controller?.pause();
export const step = () => {
  audio.unlock();
  controller?.step();
};
export const flip = (seat: Seat) => controller?.flip(seat);
export const resync = (seat: Seat) => controller?.resync(seat);

export function setMuted(muted: boolean): void {
  audio.unlock();
  audio.setMuted(muted);
  state.muted = muted;
}

// ---- Replays ------------------------------------------------------------------------------------

export async function refreshReplays(): Promise<void> {
  state.replays = await store.listReplays();
}

export async function deleteReplay(id: string): Promise<void> {
  await store.deleteReplay(id);
  await refreshReplays();
}

export async function saveImportedReplay(imported: ReplayV1): Promise<void> {
  await store.putReplay(imported);
  await refreshReplays();
}

export function downloadReplay(r: ReplayV1): void {
  const blob = new Blob([`${JSON.stringify(r, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jungle-replay-${r.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Resolve a recorded seat to a runnable entrant, if its exact binary is available. */
export async function entrantForReplay(sha256: string): Promise<MatchEntrant | null> {
  const entry = entryByHash(sha256);
  if (!entry) return null;
  try {
    return await prepareEntrant(entry);
  } catch {
    return null;
  }
}

// Standalone shell: loading, menus, input, audio and presentation. Rules, AI and
// pixels come from jungle-core via jungle-web (main thread) and the AI worker.
import './styles.css';
import init, { budget_for, Game, identity_json } from './pkg/jungle_web.js';
import wasmUrl from './pkg/jungle_web_bg.wasm?url';
import { Sounds } from './audio';
import { BoardView } from './board-view';
import { Session, type AiReply, type Level, type Mode, type SessionEvent } from './session';

const params = new URLSearchParams(location.search);
/** Test hooks: `?fast` skips animation delays, `?seed=N` makes the AI deterministic. */
const FAST = params.has('fast');
const FIXED_SEED = params.get('seed');
const SIDE_NAMES = ['Red', 'Blue'] as const;
const REASONS: Record<string, string> = {
  den: 'reached the enemy den',
  elimination: 'captured every enemy piece',
  immobilization: 'left the opponent without a legal move',
  repetition: 'the same position occurred for the third time',
  'no-capture': '100 plies passed without a capture',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Release {
  file: string;
  sha256: string;
  size: number;
  title: string;
  gameVersion: string;
  model: string;
  codeAgent: string;
  modelPlatform: string;
  githubUrl: string;
  engineVersion: string;
  runtime: string;
  rulesId: string;
  rulesDigest: string;
}

// ---- Loading ------------------------------------------------------------------------

function progress(stage: string, fraction: number, detail = ''): void {
  $('loading-stage').textContent = stage;
  $('loading-fill').style.width = `${Math.round(fraction * 100)}%`;
  $('loading-detail').textContent = detail;
}

async function fetchWithProgress(url: string, onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not load the engine (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}

function startWorker(): Promise<Worker> {
  const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module', name: 'jungle-ai' });
  return new Promise((resolve, reject) => {
    worker.addEventListener('message', function ready(event) {
      if (event.data?.type === 'ready') {
        worker.removeEventListener('message', ready);
        resolve(worker);
      } else if (event.data?.type === 'init-error') {
        reject(new Error(`The AI could not start: ${event.data.message}`));
      }
    });
    worker.addEventListener('error', (event) => reject(new Error(event.message || 'The AI worker failed to start.')));
  });
}

async function loadRelease(): Promise<Release> {
  const fallback = { ...JSON.parse(identity_json()), file: 'claude-opus-5-5-claudecode-1.1.0.wasm', sha256: '', size: 0 } as Release;
  try {
    const response = await fetch('release/release.json', { cache: 'no-cache' });
    return response.ok ? ((await response.json()) as Release) : fallback;
  } catch {
    return fallback;
  }
}

// ---- Game -----------------------------------------------------------------------------

interface Config {
  mode: Mode;
  level: Level;
  humanSide: 0 | 1;
  firstSide: 0 | 1;
}

const sounds = new Sounds();
let worker: Worker;
let view: BoardView;
let release: Release;
let config: Config = { mode: 'human-ai', level: 1, humanSide: 0, firstSide: 0 };
let engine: Game | null = null;
let session: Session | null = null;
let selected = -1;
let animating = false;
let gameNumber = 0;

function seed(): number {
  return FIXED_SEED !== null ? Number(FIXED_SEED) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]!;
}

function draw(progressValue = 1000): void {
  if (!engine) return;
  view.present(engine.render(view.flipped, progressValue, selected));
  const canvas = view.canvas;
  canvas.dataset['game'] = String(gameNumber);
  canvas.dataset['rev'] = String(engine.rev());
  canvas.dataset['status'] = String(engine.status());
  canvas.dataset['flipped'] = String(view.flipped);
  const history = engine.history();
  const last = history.length >= 2 ? `, last move ${history[history.length - 2]} to ${history[history.length - 1]}` : '';
  canvas.setAttribute('aria-label', `Jungle board, ${SIDE_NAMES[engine.to_play()]} to move, move ${history.length / 2 + 1}${last}${view.flipped ? ', flipped' : ''}`);
}

function animate(): Promise<void> {
  const duration = FAST || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;
  if (duration === 0) {
    draw();
    return Promise.resolve();
  }
  animating = true;
  const start = performance.now();
  const game = gameNumber;
  return new Promise((resolve) => {
    const tick = (now: number) => {
      // A new game abandons this animation: it must not draw over, or block, the next one.
      if (game !== gameNumber) return resolve();
      const p = Math.min(1000, Math.round(((now - start) / duration) * 1000));
      draw(p);
      if (p < 1000) requestAnimationFrame(tick);
      else {
        animating = false;
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function updatePanel(): void {
  if (!engine || !session) return;
  const toPlay = engine.to_play();
  const over = engine.status() !== 0;
  const who = config.mode === 'human-ai' ? (toPlay === config.humanSide ? ' — your move' : ' — AI') : ' — AI';
  $('turn').innerHTML = over ? 'Game over' : `<span class="${toPlay === 0 ? 'red' : 'blue'}">${SIDE_NAMES[toPlay]}</span> to move${who}`;
  const message = $('message');
  if (over) {
    const status = engine.status();
    const winner = engine.winner();
    const reason = REASONS[engine.reason()] ?? engine.reason();
    let text = status === 2 ? `Draw — ${reason}.` : `${SIDE_NAMES[winner as 0 | 1]} wins — ${reason}.`;
    if (config.mode === 'human-ai' && status !== 2) text = `${winner === config.humanSide ? 'You win!' : 'The AI wins.'} ${text}`;
    message.textContent = text;
    message.classList.add('result');
  } else {
    message.classList.remove('result');
    if (!message.dataset['sticky']) message.textContent = `Move ${engine.history().length / 2 + 1}. Quiet plies: ${engine.quiet()} / 100.`;
  }
  ($('btn-undo') as HTMLButtonElement).disabled = !session.canUndo() || animating;
  const pause = $('btn-pause') as HTMLButtonElement;
  pause.hidden = config.mode !== 'ai-ai';
  pause.textContent = session.paused ? 'Resume' : 'Pause';
  pause.disabled = over;

  const list = $('history');
  const pairs = engine.history();
  list.innerHTML = '';
  for (let i = 0; i < pairs.length; i += 2) {
    const side = (i / 2) % 2 === 0 ? config.firstSide : ((1 - config.firstSide) as 0 | 1);
    const li = document.createElement('li');
    li.innerHTML = `<span class="${side === 0 ? 'red' : 'blue'}">${SIDE_NAMES[side]}</span> ${pairs[i]} → ${pairs[i + 1]}`;
    list.append(li);
  }
  list.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function onEvent(event: SessionEvent): void {
  switch (event.type) {
    case 'thinking':
      $('ai-status').textContent = event.on ? 'AI is thinking…' : session && session.lastThinkMs ? `AI took ${session.lastThinkMs} ms.` : '';
      break;
    case 'moved': {
      sounds.play(event.capture ? 'capture' : 'move');
      selected = -1;
      const current = gameNumber;
      void animate().then(() => {
        if (current !== gameNumber) return;
        updatePanel();
        scheduleAi();
      });
      updatePanel();
      break;
    }
    case 'undone':
      selected = -1;
      draw();
      updatePanel();
      break;
    case 'over': {
      const humanWon = config.mode === 'human-ai' && engine?.winner() === config.humanSide;
      const draw = engine?.status() === 2;
      sounds.play(config.mode === 'ai-ai' || humanWon || draw ? 'win' : 'lose');
      break;
    }
  }
}

function scheduleAi(): void {
  const current = gameNumber;
  const delay = FAST ? 0 : config.mode === 'ai-ai' ? 350 : 60;
  setTimeout(() => {
    if (current !== gameNumber) return;
    // Regression: dropping the request while an animation ran could stall an AI-first game.
    if (animating) scheduleAi();
    else session?.advance();
  }, delay);
}

function newGame(next: Config): void {
  gameNumber += 1;
  animating = false; // any animation of the previous game stops at its next frame
  session?.cancel();
  engine?.free();
  config = next;
  selected = -1;
  engine = new Game(next.firstSide);
  session = new Session(
    engine,
    { mode: next.mode, level: next.level, humanSide: next.humanSide, seed: seed(), budget: budget_for(next.level) },
    (request) => worker.postMessage(request, [request.snapshot.buffer]),
    onEvent,
  );
  $('message').textContent = '';
  $('ai-status').textContent = '';
  draw();
  updatePanel();
  scheduleAi();
}

function onSquare(square: number): void {
  sounds.unlock();
  if (!engine || !session || animating) return;
  if (!session.isHumanTurn()) {
    if (config.mode === 'human-ai' && session.thinking) $('ai-status').textContent = 'AI is thinking… one moment.';
    return;
  }
  if (selected >= 0 && session.legalFrom(selected).includes(square)) {
    session.humanMove(selected, square);
    return;
  }
  if (engine.piece_owner(square) === config.humanSide && session.legalFrom(square).length > 0) {
    selected = square === selected ? -1 : square;
    sounds.play('select');
  } else {
    selected = -1;
  }
  draw();
}

// ---- Menu -----------------------------------------------------------------------------------

function identityRows(r: Release): string {
  const rows: [string, string][] = [
    ['Title', `${r.title} v${r.gameVersion}`],
    ['Model', r.model],
    ['Code agent', r.codeAgent],
    ...(r.modelPlatform ? [['Model platform', r.modelPlatform] as [string, string]] : []),
    ['Engine', r.engineVersion],
    ['Runtime', r.runtime],
    ['Rules', `${r.rulesId} · ${r.rulesDigest.slice(0, 16)}…`],
  ];
  const github = `<dt>GitHub</dt><dd><a href="${escapeHtml(r.githubUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(r.githubUrl)}</a></dd>`;
  return `<dl class="identity">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}${github}</dl>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function openMenu(): void {
  const dialog = $('menu') as HTMLDialogElement;
  const form = $('menu-form') as HTMLFormElement;
  const syncMode = () => {
    const mode = (form.elements.namedItem('mode') as RadioNodeList).value as Mode;
    $('first-human').hidden = mode !== 'human-ai';
    $('first-ai').hidden = mode !== 'ai-ai';
  };
  form.onchange = syncMode;
  syncMode();
  dialog.showModal();
}

function readMenu(form: HTMLFormElement): Config {
  const value = (name: string) => (form.elements.namedItem(name) as RadioNodeList | HTMLSelectElement).value;
  const mode = value('mode') as Mode;
  const level = Number(value('level')) as Level;
  if (mode === 'ai-ai') {
    const firstSide = Number(value('firstSide')) as 0 | 1;
    return { mode, level, humanSide: 0, firstSide };
  }
  const humanSide = Number(value('side')) as 0 | 1;
  const firstSide = value('first') === 'human' ? humanSide : ((1 - humanSide) as 0 | 1);
  return { mode, level, humanSide, firstSide };
}

function renderRelease(r: Release): void {
  $('byline').textContent = `${[r.model, r.codeAgent, r.modelPlatform || null].filter(Boolean).join(' · ')} · engine ${r.engineVersion.split(' ')[1] ?? r.gameVersion} · v${r.gameVersion}`;
  $('identity').innerHTML = identityRows(r);
  $('release').innerHTML = `
    <p><a class="btn primary" href="${r.file}" download="${r.file}" data-testid="download">Download Arena .wasm</a>
       <span class="small">${r.file}${r.size ? ` · ${(r.size / 1024).toFixed(0)} KiB` : ''}</span></p>
    ${identityRows(r)}
    <p class="small">SHA-256 <code data-testid="release-sha">${r.sha256 || 'see release/release.json'}</code></p>`;
}

/** Read-only view for browser tests (`?test`): the legal list and whose turn it is. */
function exposeTestHooks(): void {
  (window as unknown as { __jungle: unknown }).__jungle = {
    legal: () => (engine ? Array.from(engine.legal()) : []),
    toPlay: () => engine?.to_play() ?? -1,
    status: () => engine?.status() ?? -1,
    humanSide: () => config.humanSide,
    thinking: () => session?.thinking ?? false,
  };
}

// ---- Boot --------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  progress('Downloading the engine…', 0.05);
  const bytes = await fetchWithProgress(wasmUrl, (loaded, total) =>
    progress('Downloading the engine…', 0.05 + (total ? (loaded / total) * 0.6 : 0.3), `${(loaded / 1024).toFixed(0)} KiB`),
  );
  progress('Starting the engine…', 0.7);
  await init({ module_or_path: bytes });
  progress('Waking the AI…', 0.8);
  worker = await startWorker();
  worker.addEventListener('message', (event: MessageEvent<{ type: string; message?: string } & AiReply>) => {
    if (event.data.type === 'result') session?.receive(event.data);
    if (event.data.type === 'error' && session?.fail(event.data.id)) {
      $('ai-status').textContent = `The AI failed (${event.data.message ?? 'unknown error'}); it played its first legal move instead.`;
    }
  });
  progress('Reading release details…', 0.9);
  release = await loadRelease();
  progress('Drawing the board…', 0.96);

  view = new BoardView($('board') as HTMLCanvasElement, $('cursor'), onSquare);
  renderRelease(release);
  newGame(config);

  $('btn-new').addEventListener('click', () => openMenu());
  ($('menu') as HTMLDialogElement).addEventListener('close', () => {
    const dialog = $('menu') as HTMLDialogElement;
    sounds.unlock();
    if (dialog.returnValue === 'start') newGame(readMenu($('menu-form') as HTMLFormElement));
  });
  $('btn-undo').addEventListener('click', () => {
    sounds.unlock();
    session?.undo();
    scheduleAi();
  });
  $('btn-flip').addEventListener('click', () => {
    view.flipped = !view.flipped;
    $('btn-flip').setAttribute('aria-pressed', String(view.flipped));
    draw();
    view.placeCursor(document.activeElement === view.canvas);
  });
  $('btn-pause').addEventListener('click', () => {
    if (!session) return;
    session.paused = !session.paused;
    updatePanel();
    if (!session.paused) scheduleAi();
  });
  $('btn-mute').addEventListener('click', () => {
    sounds.unlock();
    const muted = sounds.toggle();
    $('btn-mute').textContent = muted ? 'Unmute' : 'Mute';
    $('btn-mute').setAttribute('aria-pressed', String(muted));
  });
  $('btn-mute').textContent = sounds.muted ? 'Unmute' : 'Mute';
  $('btn-restart').addEventListener('click', () => {
    sounds.unlock();
    newGame(config);
  });
  document.addEventListener('pointerdown', () => sounds.unlock(), { once: true });

  progress('Ready', 1);
  $('loading').hidden = true;
  $('app').hidden = false;
  document.body.dataset['ready'] = '1';
  if (params.has('test')) exposeTestHooks();
  openMenu();
}

boot().catch((err: unknown) => {
  progress('The game could not start.', 0, err instanceof Error ? err.message : String(err));
  document.body.dataset['ready'] = 'error';
});

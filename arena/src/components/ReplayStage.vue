<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue';
import { entrantForReplay } from '../app/arena';
import { arenaUrl } from '../app/paths';
import { SEATS, type Seat } from '../protocol/messages';
import { ReplaySeatRenderer, type ReplaySource } from '../replay/player';
import { forfeitSummary, replaySnapshots, type ReplayV1 } from '../replay/schema';
import { createSeatWorker } from '../workers/factories';
import { BTN, SIDE_CHIP, SIDE_DOT } from '../ui/classes';
import { describeResult, seatLabel, shortHash, sideLabel } from '../ui/labels';
import HistoryDrawer from './HistoryDrawer.vue';

/**
 * Full-screen replay playback on the play page: the same two maximized boards, drawn by the
 * original programs when this browser has their exact hashes (else the labeled reference
 * board), with seek controls in the bar. Recorded decisions only — no search is rerun.
 */
const props = defineProps<{ replay: ReplayV1; historyOpen: boolean }>();
const emit = defineEmits<{ toggleHistory: [] }>();

// Raw data only: these snapshots are posted to workers, which cannot clone Vue proxies.
const record = toRaw(props.replay);
const snapshots = replaySnapshots(record);
const rev = ref(snapshots.length - 1);
const flipped = reactive<Record<Seat, boolean>>({ left: false, right: false });
const sources = reactive<Record<Seat, ReplaySource>>({ left: 'loading', right: 'loading' });
const whyReference = reactive<Record<Seat, string | null>>({ left: null, right: null });
const canvases: Record<Seat, HTMLCanvasElement | null> = { left: null, right: null };
const renderers: Record<Seat, ReplaySeatRenderer> = {
  left: new ReplaySeatRenderer('left', record, createSeatWorker),
  right: new ReplaySeatRenderer('right', record, createSeatWorker),
};
const playing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
let drawToken = 0;

const last = snapshots.length - 1;
const snapshot = computed(() => snapshots[rev.value]!);
const sides = computed(() => ({ left: record.seats.left.side, right: record.seats.right.side }));
const sideNames = computed(() => {
  const names = { red: '', blue: '' };
  for (const seat of SEATS) names[record.seats[seat].side] = `${record.seats[seat].metadata.title}, ${seatLabel(seat).toLowerCase()}`;
  return names;
});
const resultText = computed(() => (record.result ? describeResult(record.result, sideNames.value) : 'Unfinished: ends at its last committed ply.'));
const forfeitText = computed(() => (record.result?.kind === 'forfeit' && record.result.forfeit ? forfeitSummary(record.result.forfeit) : ''));
const details = computed<[string, string][]>(() => [
  ['Recorded', new Date(record.createdAt).toLocaleString()],
  ['Seed', String(record.settings.seed)],
  ['Node budget', record.settings.nodeBudget.toLocaleString('en')],
  ['Think deadline', `${record.settings.deadlines.think / 1000} s`],
  ...SEATS.map((seat): [string, string] => [seatLabel(seat), `${record.seats[seat].metadata.title} v${record.seats[seat].metadata.gameVersion} · ${shortHash(record.seats[seat].sha256)}`]),
  ...(forfeitText.value ? [['Forfeit', forfeitText.value] as [string, string]] : []),
]);

async function draw() {
  const token = ++drawToken;
  const s = snapshot.value;
  for (const seat of SEATS) {
    const canvas = canvases[seat];
    if (!canvas || sources[seat] === 'loading') continue;
    await renderers[seat].draw(canvas, s, flipped[seat]);
    if (token !== drawToken) return; // a newer seek superseded this one
    sources[seat] = renderers[seat].source;
    if (sources[seat] === 'reference') whyReference[seat] ??= renderers[seat].lastError;
  }
}

onMounted(async () => {
  await Promise.all(
    SEATS.map(async (seat) => {
      const entrant = await entrantForReplay(record.seats[seat].sha256);
      sources[seat] = await renderers[seat].open(entrant);
      whyReference[seat] = entrant ? renderers[seat].lastError : 'this exact binary is not on this device or in the public catalog';
    }),
  );
  await draw();
});

watch([rev, () => flipped.left, () => flipped.right], () => void draw());

function togglePlay() {
  playing.value = !playing.value;
  if (timer) clearInterval(timer);
  timer = null;
  if (!playing.value) return;
  if (rev.value >= last) rev.value = 0;
  timer = setInterval(() => {
    if (rev.value >= last) togglePlay();
    else rev.value += 1;
  }, 650);
}

/** Keyboard support from the page: Space plays/pauses, arrows step. */
defineExpose({
  togglePlay,
  stepBy: (delta: number) => (rev.value = Math.min(last, Math.max(0, rev.value + delta))),
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  for (const seat of SEATS) renderers[seat].dispose();
});

const BUTTON =
  'inline-flex h-8 shrink-0 items-center rounded-md border border-line-strong bg-raised px-2.5 text-xs font-semibold text-fg transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45';
</script>

<template>
  <div class="play-root" data-testid="replay-viewer">
    <div class="flex min-w-0 items-center gap-3 border-b border-line-strong bg-raised px-3 text-xs" role="toolbar" aria-label="Replay controls">
      <a :href="arenaUrl()" class="shrink-0 font-semibold text-accent hover:underline" data-testid="back-setup">← Setup</a>
      <span class="shrink-0 font-semibold">Replay</span>
      <span class="shrink-0 tabular">Revision {{ rev }} of {{ last }}</span>
      <input
        v-model.number="rev"
        type="range"
        min="0"
        :max="last"
        step="1"
        class="min-w-24 flex-1"
        aria-label="Seek to revision"
        data-testid="replay-seek"
      />
      <span class="min-w-0 max-w-[30%] truncate rounded-md border border-gold-line bg-gold-soft px-2 py-1 font-semibold" :title="`${resultText} ${forfeitText}`" data-testid="replay-result">
        {{ resultText }}
      </span>
      <div class="play-bar-controls flex shrink-0 items-center gap-1.5">
        <button type="button" :class="BUTTON" :disabled="rev === 0" aria-label="First revision" @click="rev = 0">⏮</button>
        <button type="button" :class="BUTTON" :disabled="rev === 0" aria-label="Back one revision" @click="rev -= 1">◀</button>
        <button type="button" :class="BUTTON" aria-keyshortcuts="Space" @click="togglePlay()">{{ playing ? '❚❚ Pause' : '▶ Play' }}</button>
        <button type="button" :class="BUTTON" :disabled="rev === last" aria-label="Forward one revision" data-testid="replay-next" @click="rev += 1">▶</button>
        <button type="button" :class="BUTTON" :disabled="rev === last" aria-label="Last revision" @click="rev = last">⏭</button>
        <button type="button" :class="BUTTON" :aria-expanded="historyOpen" aria-controls="history-drawer" data-testid="history-toggle" @click="emit('toggleHistory')">History</button>
      </div>
    </div>

    <main class="play-stage">
      <article v-for="seat in SEATS" :key="seat" class="play-seat" :data-seat="seat">
        <header class="play-label flex items-center gap-2 text-xs">
          <span class="shrink-0 font-semibold tracking-[0.12em] text-subtle uppercase">{{ seat }}</span>
          <span :class="[SIDE_CHIP[record.seats[seat].side], 'shrink-0']"><span :class="SIDE_DOT[record.seats[seat].side]" aria-hidden="true" />{{ sideLabel(record.seats[seat].side) }}</span>
          <span class="min-w-0 truncate font-display text-sm font-semibold">{{ record.seats[seat].metadata.title }} · v{{ record.seats[seat].metadata.gameVersion }}</span>
          <span class="ml-auto shrink-0 text-subtle" :title="whyReference[seat] ?? ''" :data-testid="`replay-source-${seat}`">{{
            sources[seat] === 'original' ? 'original renderer' : sources[seat] === 'reference' ? 'Arena reference board (binary unavailable)' : 'loading…'
          }}</span>
          <button type="button" :class="[BTN.quiet, 'shrink-0']" :aria-pressed="flipped[seat]" :aria-label="`Flip the ${seat} board`" @click="flipped[seat] = !flipped[seat]">⟲ Flip</button>
        </header>
        <div class="play-board overflow-hidden rounded-lg border border-line-strong bg-inset">
          <canvas
            :ref="(el) => (canvases[seat] = el as HTMLCanvasElement | null)"
            width="448"
            height="576"
            role="img"
            :aria-label="`${seatLabel(seat)} replay board at revision ${rev}`"
            :data-testid="`replay-canvas-${seat}`"
          />
          <p
            v-if="sources[seat] === 'reference' && whyReference[seat]"
            class="absolute inset-x-0 bottom-0 bg-raised px-3 py-1.5 text-xs text-subtle"
            :data-testid="`replay-why-${seat}`"
          >
            Reason: {{ whyReference[seat] }}
          </p>
        </div>
      </article>
    </main>

    <HistoryDrawer
      :open="historyOpen"
      :history="snapshot.history"
      :first-side="record.settings.firstSide"
      :sides="sides"
      :details="details"
      @close="emit('toggleHistory')"
    />
  </div>
</template>

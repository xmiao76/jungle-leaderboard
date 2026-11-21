<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { flip, registerPresenter, resync, state } from '../app/arena';
import type { Seat } from '../protocol/messages';
import { BTN, SIDE_CHIP, SIDE_DOT } from '../ui/classes';
import { ACTIVITY_LABEL, seatLabel, shortHash, sideLabel, squareName } from '../ui/labels';
import { presentFrame } from '../ui/present';

const props = defineProps<{ seat: Seat }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const presentedRev = ref<number | null>(null);
const entrant = computed(() => state.matchEntrants?.[props.seat] ?? null);
const side = computed(() => state.matchSides?.[props.seat] ?? null);
const seatView = computed(() => state.match?.seats[props.seat] ?? null);
const snapshot = computed(() => state.match?.snapshot ?? null);
const isTurn = computed(() => snapshot.value?.status === 'playing' && snapshot.value.toPlay === side.value);
const identity = computed(() =>
  entrant.value
    ? `${seatLabel(props.seat)} · ${side.value ? sideLabel(side.value) : ''} · ${entrant.value.metadata.title} v${entrant.value.metadata.gameVersion} · ${entrant.value.metadata.model} · ${entrant.value.metadata.codeAgent} · ${entrant.value.sha256}`
    : seatLabel(props.seat),
);

const ariaLabel = computed(() => {
  if (!entrant.value || !side.value) return `${seatLabel(props.seat)} board`;
  const last = snapshot.value?.history.at(-1);
  const lastText = last ? `, last move ${squareName(last.src)} to ${squareName(last.dst)}` : '';
  const flipped = seatView.value?.flipped ? ', flipped view' : '';
  return `${seatLabel(props.seat)} board drawn by ${entrant.value.metadata.title} version ${entrant.value.metadata.gameVersion}, playing ${sideLabel(side.value)}, revision ${presentedRev.value ?? 0}${lastText}${flipped}`;
});

onMounted(() => {
  registerPresenter(props.seat, (frame, rev) => {
    if (canvas.value && presentFrame(canvas.value, frame)) presentedRev.value = rev;
  });
});
onBeforeUnmount(() => registerPresenter(props.seat, null));
</script>

<template>
  <article class="play-seat" :data-seat="seat" :aria-label="identity">
    <header class="play-label flex items-center gap-2 text-xs" :title="identity">
      <span class="shrink-0 font-semibold tracking-[0.12em] text-subtle uppercase">{{ seat }}</span>
      <span v-if="side" :class="[SIDE_CHIP[side], 'shrink-0']" :data-testid="`side-${seat}`">
        <span :class="SIDE_DOT[side]" aria-hidden="true" />{{ sideLabel(side) }}
      </span>
      <span class="min-w-0 truncate font-display text-sm font-semibold" :data-testid="`pane-title-${seat}`">
        {{ entrant ? `${entrant.metadata.title} · v${entrant.metadata.gameVersion}` : 'Loading…' }}
      </span>
      <span v-if="entrant" class="hidden min-w-0 truncate text-muted md:inline">
        {{ entrant.metadata.model }} · <span class="font-mono">{{ shortHash(entrant.sha256) }}</span>
      </span>
      <span v-if="isTurn" class="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-px font-semibold text-accent-ink">to move</span>
      <span :class="[isTurn ? '' : 'ml-auto', 'shrink-0 text-subtle']" :data-testid="`activity-${seat}`">{{ seatView ? ACTIVITY_LABEL[seatView.activity] : '' }}</span>
      <button
        type="button"
        :class="[BTN.quiet, 'shrink-0']"
        :disabled="!state.match"
        :aria-pressed="seatView?.flipped ?? false"
        :aria-label="`Flip the ${seat} board`"
        :data-testid="`flip-${seat}`"
        @click="flip(seat)"
      >
        ⟲ Flip
      </button>
    </header>

    <div class="play-board overflow-hidden rounded-lg border border-line-strong bg-inset">
      <canvas
        ref="canvas"
        width="448"
        height="576"
        role="img"
        :aria-label="ariaLabel"
        :data-testid="`canvas-${seat}`"
        :data-rev="presentedRev ?? ''"
      />
      <p v-if="presentedRev === null" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-subtle">
        {{ state.match?.phase === 'failed' ? 'This program could not start.' : 'Loading this program…' }}
      </p>
      <div
        v-if="seatView?.paneError"
        class="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-bronze-line bg-raised px-3 py-2 text-xs"
        role="alert"
        :data-testid="`pane-error-${seat}`"
      >
        <span class="text-fg">{{ seatView.paneError }}</span>
        <button type="button" :class="BTN.secondary" @click="resync(seat)">Resync</button>
      </div>
    </div>
  </article>
</template>

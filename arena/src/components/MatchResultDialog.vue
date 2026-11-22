<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { startMatch, state, swapAndRematch } from '../app/arena';
import { arenaUrl } from '../app/paths';
import { formatPoints, seriesRecord } from '../match/series';
import type { Seat } from '../protocol/messages';
import { BTN, LABEL, SIDE_DOT } from '../ui/classes';
import { describeTally, formatRecord, gameOutcome, programNames, seatLabel, seriesHeadline, sideLabel } from '../ui/labels';

/**
 * The two-game match result, over the boards: each program's points and its wins, losses and
 * draws, then how each game ended. A native modal <dialog>: it sits in the top layer, so it never
 * moves or resizes the boards, traps focus, and closes on Escape.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const SEATS = ['left', 'right'] as const;
type Outcome = 'won' | 'lost' | 'drawn' | 'none';

// Complete class strings (Tailwind's scanner must see each one).
const CARD_TONE: Readonly<Record<Outcome, string>> = {
  won: 'border-accent bg-accent-soft',
  lost: 'border-line bg-raised',
  drawn: 'border-line-strong bg-raised',
  none: 'border-line bg-raised',
};
const BADGE: Readonly<Record<Exclude<Outcome, 'none'>, string>> = {
  won: 'bg-accent text-accent-ink',
  lost: 'border border-line-strong text-muted',
  drawn: 'border border-line-strong text-fg',
};
const BADGE_TEXT: Readonly<Record<Exclude<Outcome, 'none'>, string>> = { won: 'Winner', lost: 'Lost', drawn: 'Drawn' };

const dialog = ref<HTMLDialogElement | null>(null);
const viewBoards = ref<HTMLButtonElement | null>(null);

const series = computed(() => state.series);
const summary = computed(() => series.value?.summary ?? null);
const games = computed(() => series.value?.games ?? []);
const names = computed(() => (state.matchEntrants ? programNames(state.matchEntrants) : { left: seatLabel('left'), right: seatLabel('right') }));
const record = computed(() => seriesRecord(games.value));
const headline = computed(() => (summary.value ? seriesHeadline(summary.value, names.value) : ''));
const tally = computed(() => describeTally(record.value, names.value));

function outcome(seat: Seat): Outcome {
  const s = summary.value;
  if (!s?.complete || !s.winner) return 'none';
  if (s.winner === 'draw') return 'drawn';
  return s.winner === seat ? 'won' : 'lost';
}

async function show(): Promise<void> {
  const d = dialog.value;
  if (!d || d.open) return;
  d.showModal();
  await nextTick();
  viewBoards.value?.focus();
}

watch(
  () => props.open,
  (open) => (open ? void show() : dialog.value?.open && dialog.value.close()),
);
onMounted(() => {
  if (props.open) void show();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="match-result-dialog m-auto w-[min(46rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-line-strong bg-raised p-0 text-fg shadow-2xl"
    aria-labelledby="match-result-title"
    aria-describedby="match-tally"
    data-testid="match-result-dialog"
    @cancel.prevent="emit('close')"
    @close="emit('close')"
  >
    <div v-if="summary" class="p-5 sm:p-6">
      <p :class="LABEL">Match result · two games</p>
      <h2 id="match-result-title" class="mt-1 font-display text-2xl leading-tight font-semibold tracking-tight sm:text-3xl" data-testid="match-headline">
        {{ headline }}
      </h2>
      <p id="match-tally" class="mt-2 text-sm text-muted" data-testid="match-tally">
        {{ tally }}
        <template v-if="!summary.complete"> A game ended without a board result, so the match has no winner.</template>
      </p>

      <div class="mt-5 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <template v-for="(seat, i) in SEATS" :key="seat">
          <div v-if="i === 1" class="hidden self-center font-display text-sm text-subtle italic sm:block" aria-hidden="true">vs</div>
          <section
            :class="['flex flex-col rounded-xl border p-4', CARD_TONE[outcome(seat)]]"
            :aria-label="`${seatLabel(seat)}: ${names[seat]}`"
            :data-testid="`match-card-${seat}`"
            :data-outcome="outcome(seat)"
            :data-wins="record[seat].wins"
            :data-losses="record[seat].losses"
            :data-draws="record[seat].draws"
          >
            <div class="flex items-center justify-between gap-2">
              <span :class="LABEL">{{ seatLabel(seat) }}</span>
              <span v-if="outcome(seat) !== 'none'" :class="['rounded-full px-2 py-0.5 text-[0.68rem] font-semibold', BADGE[outcome(seat) as Exclude<Outcome, 'none'>]]">
                {{ BADGE_TEXT[outcome(seat) as Exclude<Outcome, 'none'>] }}
              </span>
            </div>
            <p class="mt-2 font-display text-lg leading-snug font-semibold break-words">{{ state.matchEntrants?.[seat].metadata.title ?? names[seat] }}</p>
            <p class="text-sm">
              <span class="font-semibold">v{{ state.matchEntrants?.[seat].metadata.gameVersion }}</span>
              <span class="text-muted"> · {{ state.matchEntrants?.[seat].metadata.model }} · {{ state.matchEntrants?.[seat].metadata.codeAgent }}</span>
            </p>
            <!-- Anchored to the card's foot, so both cards' scores line up even when a title wraps. -->
            <p class="mt-auto flex items-baseline gap-2 pt-3">
              <span class="tabular font-display text-4xl leading-none font-semibold" :data-testid="`match-points-${seat}`">{{ formatPoints(summary.score[seat]) }}</span>
              <span class="text-sm text-muted">{{ summary.score[seat] === 1 ? 'point' : 'points' }}</span>
            </p>
            <dl class="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center" :aria-label="formatRecord(record[seat])">
              <div>
                <dt :class="LABEL">Won</dt>
                <dd class="tabular font-display text-2xl font-semibold">{{ record[seat].wins }}</dd>
              </div>
              <div>
                <dt :class="LABEL">Lost</dt>
                <dd class="tabular font-display text-2xl font-semibold">{{ record[seat].losses }}</dd>
              </div>
              <div>
                <dt :class="LABEL">Drawn</dt>
                <dd class="tabular font-display text-2xl font-semibold">{{ record[seat].draws }}</dd>
              </div>
            </dl>
          </section>
        </template>
      </div>

      <ol class="mt-5 divide-y divide-line border-y border-line text-sm" aria-label="Each game">
        <li v-for="g in games" :key="g.game" class="grid grid-cols-[4.5rem_1fr] gap-x-3 py-2.5" :data-testid="`match-game-${g.game}`">
          <span class="font-semibold">Game {{ g.game }}</span>
          <div class="min-w-0">
            <p class="font-medium">{{ gameOutcome(g, names) }}</p>
            <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span v-for="seat in SEATS" :key="seat" class="inline-flex items-center gap-1">
                <span :class="SIDE_DOT[g.sides[seat]]" aria-hidden="true" />{{ seat === 'left' ? 'Left' : 'Right' }} played {{ sideLabel(g.sides[seat]) }}
              </span>
              <span>· {{ g.firstSeat === 'left' ? 'Left' : 'Right' }} moved first</span>
            </p>
          </div>
        </li>
      </ol>
      <p class="mt-2 text-xs text-subtle">
        Final score {{ formatPoints(summary.score.left) }} – {{ formatPoints(summary.score.right) }}. A win is 1 point and a draw is ½ each; a forfeit
        counts as a win for the other program.
      </p>

      <div class="mt-5 flex flex-wrap items-center justify-end gap-2">
        <a :href="arenaUrl()" :class="BTN.quiet" data-testid="match-result-setup">← Back to setup</a>
        <button type="button" :class="BTN.secondary" title="A new two-game match with game 1's colours swapped" data-testid="match-result-swap" @click="swapAndRematch()">
          Swap colours &amp; play again
        </button>
        <button type="button" :class="BTN.secondary" title="The same two-game match again from game 1" data-testid="match-result-restart" @click="startMatch()">
          Play again
        </button>
        <button ref="viewBoards" type="button" :class="BTN.primary" data-testid="match-result-close" @click="emit('close')">View the boards</button>
      </div>
    </div>
  </dialog>
</template>

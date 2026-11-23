<script setup lang="ts">
import { computed } from 'vue';
import { matchEligibility, pause, play, setMuted, SPEEDS, startMatch, state, step, swapAndRematch, type Speed } from '../app/arena';
import { arenaUrl } from '../app/paths';
import { SIDE_CHIP } from '../ui/classes';
import { describeResult, moveNumber, PHASE_LABEL, seatLabel, sideLabel } from '../ui/labels';

defineProps<{ historyOpen: boolean; fullscreen: boolean }>();
const emit = defineEmits<{ toggleHistory: []; toggleFullscreen: []; showResult: [] }>();

const match = computed(() => state.match);
const snapshot = computed(() => match.value?.snapshot ?? null);
const phase = computed(() => match.value?.phase ?? null);
const canPlay = computed(() => phase.value === 'ready' || phase.value === 'paused');
const busy = computed(() => !match.value || phase.value === 'loading');
const turnSeat = computed(() => {
  const s = snapshot.value;
  if (!s || !state.matchSides) return null;
  return state.matchSides.left === s.toPlay ? 'left' : 'right';
});
const lastMove = computed(() => snapshot.value?.history.at(-1) ?? null);
const sideNames = computed(() => {
  const names = { red: '', blue: '' };
  if (state.matchSides && state.matchEntrants) {
    for (const seat of ['left', 'right'] as const) names[state.matchSides[seat]] = `${state.matchEntrants[seat].metadata.title}, ${seatLabel(seat).toLowerCase()}`;
  }
  return names;
});
const resultText = computed(() => describeResult(match.value?.result ?? null, sideNames.value));
// Every match is two games (match/series.ts): which one this is, and the overall result.
const series = computed(() => state.series);
const seriesLabel = computed(() => {
  const s = series.value;
  if (!s) return '';
  if (s.summary) return 'Match over';
  if (s.nextGameAt) return 'Game 1 of 2 over · game 2 next, colours swapped';
  return `Game ${s.game} of 2`;
});
const speeds = Object.keys(SPEEDS) as Speed[];
const eligibility = computed(() => matchEligibility(state.matchEntrants?.left ?? null, state.matchEntrants?.right ?? null, state.settings));
const RATED_BADGE = {
  rated: 'inline-flex items-center rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent',
  friendly: 'inline-flex items-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold text-muted',
} as const;

const BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-raised px-2.5 text-xs font-semibold text-fg transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45';
const PRIMARY =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-xs font-semibold text-accent-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45';
const STAT = 'shrink-0 whitespace-nowrap';
</script>

<template>
  <div class="flex min-w-0 items-center gap-3 border-b border-line-strong bg-raised px-3 text-xs" role="toolbar" aria-label="Match controls" data-testid="controls">
    <a :href="arenaUrl()" class="shrink-0 font-semibold text-accent hover:underline" data-testid="back-setup">← Setup</a>

    <div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden" aria-live="polite">
      <span v-if="seriesLabel" :class="[STAT, 'rounded-full border border-accent-line px-2 py-px font-semibold text-accent']" data-testid="series-game" :data-game="series?.game">{{
        seriesLabel
      }}</span>
      <span
        v-if="state.matchEntrants"
        :class="[RATED_BADGE[eligibility.rated ? 'rated' : 'friendly'], 'shrink-0']"
        :title="eligibility.rated ? 'Both programs’ Elo ratings change after this match.' : eligibility.reason"
        data-testid="play-rated"
        >{{ eligibility.rated ? 'Rated' : 'Friendly' }}</span
      >
      <span :class="[STAT, 'font-semibold']" data-testid="phase">{{ phase ? PHASE_LABEL[phase] : 'Starting' }}</span>
      <span :class="STAT">Move <span class="tabular font-semibold" data-testid="move-number">{{ moveNumber(snapshot) }}</span></span>
      <span :class="[STAT, 'text-subtle']">rev <span class="tabular" data-testid="rev">{{ snapshot?.rev ?? '—' }}</span></span>
      <span v-if="lastMove" :class="[STAT, 'text-muted']">last <span class="font-mono" data-testid="last-move">{{ lastMove.src }}→{{ lastMove.dst }}</span></span>
      <span v-if="match?.heldProposal" :class="[STAT, 'rounded-full border border-gold-line bg-gold-soft px-2 py-px']" data-testid="held">
        held {{ match.heldProposal.src }}→{{ match.heldProposal.dst }}
      </span>
      <button
        v-if="series?.text"
        type="button"
        class="min-w-0 truncate rounded-md border border-gold-line bg-gold-soft px-2 py-1 text-left font-semibold transition hover:border-accent"
        :title="`${[series.text, ...series.details].join(' · ')} — click for the full result`"
        data-testid="match-result"
        @click="emit('showResult')"
        >{{ series.text }}</button
      >
      <span v-if="series?.summary" class="sr-only" data-testid="match-games">{{ series.details.join(' ') }}</span>
      <span
        v-if="resultText"
        :class="[
          'min-w-0 truncate rounded-md border px-2 py-1 font-semibold',
          series?.text ? 'border-line-strong text-muted' : 'border-gold-line bg-gold-soft',
        ]"
        :title="resultText"
        :role="series?.text ? undefined : 'status'"
        data-testid="result"
        >{{ series && !series.summary ? `Game ${series.game}: ` : '' }}{{ resultText }}</span
      >
      <span v-else-if="snapshot && snapshot.status === 'playing' && turnSeat" :class="[SIDE_CHIP[snapshot.toPlay], 'shrink-0']" data-testid="turn">
        {{ sideLabel(snapshot.toPlay) }} · {{ seatLabel(turnSeat) }}
      </span>
      <span v-if="match?.failure && match.result?.kind !== 'system-error'" class="min-w-0 truncate text-bronze" :title="match.failure" role="alert">{{ match.failure }}</span>
    </div>

    <div class="play-bar-controls flex shrink-0 items-center gap-1.5">
      <button v-if="phase === 'running'" type="button" :class="PRIMARY" data-testid="pause" aria-keyshortcuts="Space" @click="pause()">
        {{ match?.pauseRequested ? 'Pausing…' : '❚❚ Pause' }}
      </button>
      <button v-else type="button" :class="PRIMARY" :disabled="!canPlay" data-testid="play" aria-keyshortcuts="Space" @click="play()">
        ▶ {{ phase === 'paused' ? 'Resume' : 'Play' }}
      </button>
      <button type="button" :class="BUTTON" :disabled="!canPlay" data-testid="step" aria-keyshortcuts="S" @click="step()">Step</button>
      <select v-model="state.settings.speed" :class="[BUTTON, 'pr-1']" aria-label="Animation speed">
        <option v-for="s in speeds" :key="s" :value="s">{{ s }}</option>
      </select>
      <button type="button" :class="BUTTON" :disabled="busy" data-testid="restart" title="Play the two-game match again from game 1" @click="startMatch()">Restart</button>
      <button type="button" :class="BUTTON" :disabled="busy" data-testid="swap" title="A new two-game match with game 1's colours swapped" @click="swapAndRematch()">
        Swap
      </button>
      <button type="button" :class="BUTTON" :aria-pressed="state.muted" data-testid="mute" aria-keyshortcuts="M" @click="setMuted(!state.muted)">
        {{ state.muted ? 'Unmute' : 'Mute' }}
      </button>
      <button type="button" :class="BUTTON" :aria-expanded="historyOpen" aria-controls="history-drawer" data-testid="history-toggle" aria-keyshortcuts="H" @click="emit('toggleHistory')">
        History
      </button>
      <button type="button" :class="BUTTON" :aria-pressed="fullscreen" data-testid="fullscreen" @click="emit('toggleFullscreen')">
        {{ fullscreen ? 'Exit full screen' : 'Full screen' }}
      </button>
    </div>
  </div>
</template>

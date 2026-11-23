<script setup lang="ts">
import { computed } from 'vue';
import { entryByHash, goToPlay, matchEligibility, randomSeed, SPEEDS, state, type Speed } from '../app/arena';
import { DEADLINES, NODE_BUDGET_CHOICES, THINK_DEADLINE_CHOICES } from '../loader/limits';
import { LEVELS, opponent } from '../referee/types';
import { BTN, CARD, FIELD, LABEL } from '../ui/classes';
import { sideLabel } from '../ui/labels';

// The match itself runs on the full-screen play page; this page only prepares it.
const loading = computed(() => !state.booted);
const canStart = computed(() => state.selection.left !== null && state.selection.right !== null && !loading.value);
const speeds = Object.keys(SPEEDS) as Speed[];
// Rated matches change both programs' Elo ratings (match/rated.ts); the rest are friendly.
const eligibility = computed(() => matchEligibility(entryByHash(state.selection.left), entryByHash(state.selection.right), state.settings));
const RATED_BADGE = {
  rated: 'inline-flex items-center rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent',
  friendly: 'inline-flex items-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold text-muted',
} as const;

function setSeed(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) state.settings.seed = value;
}
</script>

<template>
  <section :class="CARD" aria-labelledby="settings-title">
    <h3 id="settings-title" class="font-display text-xl font-semibold">Match settings</h3>

    <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <fieldset class="grid gap-1.5">
        <legend :class="LABEL">Sides</legend>
        <div class="mt-1.5 flex flex-wrap gap-2 text-sm">
          <label class="inline-flex items-center gap-2"
            ><input v-model="state.settings.leftSide" type="radio" value="red" :disabled="loading" data-testid="left-red" /> Left plays Red</label
          >
          <label class="inline-flex items-center gap-2"
            ><input v-model="state.settings.leftSide" type="radio" value="blue" :disabled="loading" data-testid="left-blue" /> Left plays Blue</label
          >
        </div>
        <p class="text-xs text-subtle">Right plays {{ sideLabel(opponent(state.settings.leftSide)) }} in game 1; the colours swap for game 2.</p>
      </fieldset>

      <fieldset class="grid gap-1.5">
        <legend :class="LABEL">First mover</legend>
        <div class="mt-1.5 flex flex-wrap gap-2 text-sm">
          <label class="inline-flex items-center gap-2"><input v-model="state.settings.firstSide" type="radio" value="red" :disabled="loading" /> Red</label>
          <label class="inline-flex items-center gap-2"
            ><input v-model="state.settings.firstSide" type="radio" value="blue" :disabled="loading" data-testid="first-blue" /> Blue</label
          >
        </div>
      </fieldset>

      <label class="grid gap-1.5">
        <span :class="LABEL">Difficulty (passed to both)</span>
        <select v-model="state.settings.difficulty" :class="FIELD" :disabled="loading">
          <option v-for="level in LEVELS" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>

      <label class="grid gap-1.5">
        <span :class="LABEL">Seed</span>
        <span class="flex gap-2">
          <input :class="FIELD" type="number" min="0" max="4294967295" :value="state.settings.seed" :disabled="loading" data-testid="seed" @change="setSeed" />
          <button type="button" :class="BTN.secondary" :disabled="loading" @click="state.settings.seed = randomSeed()">New</button>
        </span>
      </label>

      <label class="grid gap-1.5">
        <span :class="LABEL">Shared search budget (nodes)</span>
        <select v-model.number="state.settings.nodeBudget" :class="FIELD" :disabled="loading">
          <option v-for="n in NODE_BUDGET_CHOICES" :key="n" :value="n">{{ n.toLocaleString('en') }}</option>
        </select>
      </label>

      <label class="grid gap-1.5">
        <span :class="LABEL">Animation speed</span>
        <select v-model="state.settings.speed" :class="FIELD" :disabled="loading" aria-label="Animation speed">
          <option v-for="s in speeds" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <label class="grid gap-1.5">
        <span :class="LABEL">Think deadline per move</span>
        <select v-model.number="state.settings.thinkDeadlineMs" :class="FIELD" :disabled="loading" data-testid="think-deadline">
          <option v-for="ms in THINK_DEADLINE_CHOICES" :key="ms" :value="ms">{{ ms / 1000 }} s</option>
        </select>
      </label>
    </div>

    <p class="mt-4 text-xs leading-relaxed text-subtle">
      Both seats get identical, disclosed limits: {{ DEADLINES.load / 1000 }} s to load, {{ state.settings.thinkDeadlineMs / 1000 }} s per
      move, {{ DEADLINES.render / 1000 }} s per frame, and the same node budget. Running out of time, crashing, or proposing an index outside
      the legal list forfeits the game.
    </p>
    <p class="mt-2 text-xs leading-relaxed text-subtle" data-testid="match-format">
      A match is two games. Game 2 starts by itself with the colours swapped and the same side moving first, so each version moves
      first once. A win scores 1 (a forfeit counts as a win for the other seat), a draw ½ each; the overall result is shown after
      game 2.
    </p>

    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" :class="BTN.primary" :disabled="!canStart" data-testid="start" @click="goToPlay()">
        Start match (2 games) — full screen
      </button>
      <span
        :class="eligibility.rated ? RATED_BADGE.rated : RATED_BADGE.friendly"
        :title="eligibility.rated ? 'Both programs’ Elo ratings change after this match.' : eligibility.reason"
        data-testid="rated-badge"
        :data-rated="eligibility.rated"
        >{{ eligibility.rated ? 'Rated match' : 'Friendly match' }}</span
      >
      <label class="inline-flex items-center gap-2 text-sm text-muted">
        <input v-model="state.settings.beginPaused" type="checkbox" data-testid="begin-paused" /> Begin paused (step through)
      </label>
    </div>
  </section>
</template>

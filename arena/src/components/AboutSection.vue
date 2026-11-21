<script setup lang="ts">
import { DEADLINES, LOADER_VERSION } from '../loader/limits';
import { SECTION_TITLE } from '../ui/classes';
</script>

<template>
  <section id="how-it-works" class="mt-16" aria-labelledby="about-title">
    <h2 id="about-title" :class="[SECTION_TITLE, 'border-b border-line-strong pb-3']">How the Arena works</h2>
    <div class="mt-6 grid gap-8 text-sm leading-relaxed text-muted lg:grid-cols-2">
      <div class="space-y-4">
        <h3 class="font-display text-lg font-semibold text-fg">One turn</h3>
        <p>
          Each seat runs in its own worker with its own instance, even when both seats hold the same file. Only the side to move is
          asked for a move, with the official position and the referee’s sorted legal list. The Arena’s referee — isolated in a third
          worker — re-checks the chosen index, commits the ply, saves it, and only then sends the same new position to both programs to
          draw. Both finished frames are shown together. Moves are never inferred from pixels or from either program’s own board.
        </p>
      </div>
      <div class="space-y-4">
        <h3 class="font-display text-lg font-semibold text-fg">Limits and failures</h3>
        <p>
          Equal deadlines for both seats: {{ DEADLINES.load / 1000 }} s to load, a configurable think time per move (default
          {{ DEADLINES.think / 1000 }} s) and {{ DEADLINES.render / 1000 }} s per frame. A timeout, a crash or an out-of-range index forfeits the
          game. A drawing failure only marks that board and offers a resync. Pause stops after the current ply is committed and both frames
          have settled; a move already being computed is held, not committed, until you resume or step.
        </p>
        <p class="text-xs text-subtle">Loader {{ LOADER_VERSION }}. Transpilation, validation and every match run locally in this browser.</p>
      </div>
    </div>
  </section>
</template>

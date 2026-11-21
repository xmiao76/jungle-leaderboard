<script setup lang="ts">
import { computed } from 'vue';
import { state } from '../app/arena';
import type { PlyMove, Side } from '../referee/types';
import { BTN, LABEL } from '../ui/classes';
import { seatLabel, shortHash } from '../ui/labels';
import MoveHistory from './MoveHistory.vue';

/**
 * The single move history and match details, as an overlay: opening it never resizes or
 * moves the boards. In replay mode the caller passes the replay's history and seats.
 */
const props = defineProps<{
  open: boolean;
  history?: readonly PlyMove[];
  firstSide?: Side;
  sides?: Record<'left' | 'right', Side> | null;
  details?: readonly [string, string][];
}>();
const emit = defineEmits<{ close: [] }>();

const rows = computed<readonly [string, string][]>(() => {
  if (props.details) return props.details;
  const s = state.settings;
  const out: [string, string][] = [
    ['Seed', String(s.seed)],
    ['Node budget', s.nodeBudget.toLocaleString('en')],
    ['Think deadline', `${s.thinkDeadlineMs / 1000} s`],
    ['Difficulty', s.difficulty],
  ];
  for (const seat of ['left', 'right'] as const) {
    const e = state.matchEntrants?.[seat];
    if (e) out.push([seatLabel(seat), `${e.metadata.title} v${e.metadata.gameVersion} · ${shortHash(e.sha256)}`]);
  }
  return out;
});
</script>

<template>
  <aside
    id="history-drawer"
    class="play-drawer fixed top-[var(--bar-h,46px)] right-0 bottom-0 z-30 flex w-[min(24rem,92vw)] flex-col gap-4 overflow-y-auto border-l border-line-strong bg-raised p-4 shadow-2xl"
    :class="open ? 'translate-x-0' : 'pointer-events-none translate-x-full'"
    :inert="!open"
    :aria-hidden="!open"
    aria-label="Move history and match details"
    data-testid="history-drawer"
    :data-open="open"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-display text-lg font-semibold">History</h2>
      <button type="button" :class="BTN.quiet" @click="emit('close')">Close</button>
    </div>
    <MoveHistory :history="history" :first-side="firstSide" :sides="sides" />
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <template v-for="[k, v] in rows" :key="k">
        <dt :class="LABEL">{{ k }}</dt>
        <dd class="break-all text-muted">{{ v }}</dd>
      </template>
    </dl>
  </aside>
</template>

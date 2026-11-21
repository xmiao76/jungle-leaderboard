<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { state } from '../app/arena';
import type { Seat } from '../protocol/messages';
import type { PlyMove, Side } from '../referee/types';
import { opponent } from '../referee/types';
import { LABEL, SIDE_DOT } from '../ui/classes';
import { seatLabel, sideLabel } from '../ui/labels';

const props = defineProps<{ history?: readonly PlyMove[]; firstSide?: Side; sides?: Record<'left' | 'right', Side> | null }>();

const list = ref<HTMLOListElement | null>(null);
const history = computed(() => props.history ?? state.match?.snapshot?.history ?? []);
const firstSide = computed(() => props.firstSide ?? state.match?.snapshot?.firstSide ?? 'red');
const sides = computed(() => props.sides ?? state.matchSides);

const rows = computed(() =>
  history.value.map((move, i) => {
    const side: Side = i % 2 === 0 ? firstSide.value : opponent(firstSide.value);
    const seat: Seat | null = sides.value ? (sides.value.left === side ? 'left' : 'right') : null;
    return { n: i + 1, side, seat, move };
  }),
);

watch(
  () => rows.value.length,
  async () => {
    await nextTick();
    list.value?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  },
);
</script>

<template>
  <section aria-labelledby="history-title">
    <h3 id="history-title" :class="LABEL">Move history (one list, official coordinates)</h3>
    <ol ref="list" class="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-raised p-2 text-sm" data-testid="history">
      <li v-if="rows.length === 0" class="px-2 py-1 text-subtle">No moves yet.</li>
      <li v-for="row in rows" :key="row.n" class="tabular flex items-center gap-2 rounded-md px-2 py-0.5 even:bg-inset">
        <span class="w-8 text-right text-subtle">{{ row.n }}.</span>
        <span :class="SIDE_DOT[row.side]" aria-hidden="true" />
        <span class="w-10 font-semibold">{{ sideLabel(row.side) }}</span>
        <span class="text-subtle">{{ row.seat ? seatLabel(row.seat).replace(' seat', '') : '' }}</span>
        <span class="ml-auto font-mono">{{ row.move.src }} → {{ row.move.dst }}</span>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { deleteReplay, downloadReplay, notify, saveImportedReplay, state } from '../app/arena';
import { replayUrl } from '../app/paths';
import { validateReplay, type ReplayV1 } from '../replay/schema';
import { BTN, SECTION_TITLE } from '../ui/classes';
import { describeResult } from '../ui/labels';

/** Replays play back full screen on the play page. */
const openReplay = (id: string) => location.assign(replayUrl(id));
const fileInput = ref<HTMLInputElement | null>(null);

function summary(r: ReplayV1): string {
  if (!r.result) return r.plies.length > 0 ? `Unfinished after ${r.plies.length} plies` : 'Not started';
  const names = { red: r.seats.left.side === 'red' ? 'left' : 'right', blue: r.seats.left.side === 'blue' ? 'left' : 'right' };
  return describeResult(r.result, { red: `${names.red} seat`, blue: `${names.blue} seat` });
}

async function importReplay() {
  const file = fileInput.value?.files?.[0];
  if (!file) return;
  try {
    const check = validateReplay(JSON.parse(await file.text()));
    if (!check.ok) {
      notify('error', 'That replay file cannot be opened', check.issues.join(' '));
      return;
    }
    await saveImportedReplay(check.replay);
    openReplay(check.replay.id);
  } catch (err) {
    notify('error', 'That replay file cannot be opened', err instanceof Error ? err.message : String(err));
  } finally {
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>

<template>
  <section id="replays" class="mt-16" aria-labelledby="replays-title">
    <div class="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-3">
      <h2 id="replays-title" :class="SECTION_TITLE">Replays</h2>
      <label :class="[BTN.secondary, 'cursor-pointer']">
        <input ref="fileInput" type="file" accept=".json,application/json" class="sr-only" data-testid="replay-import" @change="importReplay" />
        Open replay file
      </label>
    </div>
    <p class="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
      Every committed ply is saved on this device before the match moves on, so a replay survives a reload. Download one to keep it
      or share it; opening it elsewhere redraws each position with the original programs when that browser has their exact hashes, or
      with a clearly labeled reference board when it does not.
    </p>

    <ul class="mt-5 grid gap-2" data-testid="replay-list">
      <li v-if="state.replays.length === 0" class="text-sm text-subtle">No replays on this device yet.</li>
      <li
        v-for="r in state.replays"
        :key="r.id"
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-sm"
        :data-replay-id="r.id"
      >
        <div class="min-w-0">
          <p class="font-semibold">
            {{ r.seats.left.metadata.title }} v{{ r.seats.left.metadata.gameVersion }}
            <span class="text-subtle">vs</span>
            {{ r.seats.right.metadata.title }} v{{ r.seats.right.metadata.gameVersion }}
          </p>
          <p class="text-xs text-muted">
            <span v-if="r.series" class="font-semibold text-fg" data-testid="replay-game">Game {{ r.series.game }} of {{ r.series.of }} ·</span>
            {{ new Date(r.createdAt).toLocaleString() }} · {{ r.plies.length }} plies · {{ summary(r) }}
          </p>
        </div>
        <div class="flex gap-2">
          <button type="button" :class="BTN.secondary" data-testid="replay-open" @click="openReplay(r.id)">Open</button>
          <button type="button" :class="BTN.secondary" data-testid="replay-download" @click="downloadReplay(r)">Download</button>
          <button type="button" :class="BTN.quiet" @click="deleteReplay(r.id)">Delete</button>
        </div>
      </li>
    </ul>
  </section>
</template>

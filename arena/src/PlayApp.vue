<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { bootPlay, notify, pause, play, setMuted, state, step, stopMatch } from './app/arena';
import HistoryDrawer from './components/HistoryDrawer.vue';
import MatchResultDialog from './components/MatchResultDialog.vue';
import PlayBar from './components/PlayBar.vue';
import PlayBoard from './components/PlayBoard.vue';
import ReplayStage from './components/ReplayStage.vue';
import ToastStack from './components/ToastStack.vue';

/** The full-screen play page: the two boards get the viewport; everything else overlays. */
const historyOpen = ref(false);
const fullscreen = ref(false);
const replayStage = ref<InstanceType<typeof ReplayStage> | null>(null);

// The match result opens by itself when a two-game match ends. "View the boards" hides it for
// that match only; the bar's result chip brings it back, and the next match shows its own.
const resultDismissedFor = ref<string | null>(null);
const resultOpen = computed(() => !!state.series?.summary && resultDismissedFor.value !== state.series.id);
function closeResult(): void {
  // Only a shown result can be dismissed: closing because a new match started must not hide its result.
  if (state.series?.summary) resultDismissedFor.value = state.series.id;
}
function showResult(): void {
  resultDismissedFor.value = null;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => notify('info', 'Full screen is unavailable', 'This browser refused full-screen mode.'));
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  // The result dialog handles its own keys (Escape closes it); the page behind it is inert.
  if (resultOpen.value) return;
  if (event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, select, textarea')) return;
  const key = event.key.toLowerCase();
  // Space and Enter on a focused button or link already activate it.
  if ((key === ' ' || key === 'enter') && target?.closest('button, a')) return;
  if (key === 'h') historyOpen.value = !historyOpen.value;
  else if (key === 'escape') historyOpen.value = false;
  else if (state.viewReplay) {
    if (key === ' ') replayStage.value?.togglePlay();
    else if (key === 'arrowright') replayStage.value?.stepBy(1);
    else if (key === 'arrowleft') replayStage.value?.stepBy(-1);
    else return;
  } else if (key === ' ') {
    if (state.match?.phase === 'running') pause();
    else play();
  } else if (key === 's') step();
  else if (key === 'm') setMuted(!state.muted);
  else return;
  event.preventDefault();
}

const onFullscreenChange = () => (fullscreen.value = document.fullscreenElement !== null);

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  try {
    await bootPlay();
  } catch (err) {
    notify('error', 'The match could not start', err instanceof Error ? err.message : String(err));
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  stopMatch();
});
</script>

<template>
  <div data-page="play" :data-booted="state.booted">
    <ReplayStage v-if="state.viewReplay" ref="replayStage" :replay="state.viewReplay" :history-open="historyOpen" @toggle-history="historyOpen = !historyOpen" />
    <div v-else class="play-root">
      <PlayBar
        :history-open="historyOpen"
        :fullscreen="fullscreen"
        @toggle-history="historyOpen = !historyOpen"
        @toggle-fullscreen="toggleFullscreen"
        @show-result="showResult"
      />
      <main class="play-stage" aria-label="The two boards">
        <PlayBoard seat="left" />
        <PlayBoard seat="right" />
      </main>
      <HistoryDrawer :open="historyOpen" @close="historyOpen = false" />
      <MatchResultDialog :open="resultOpen" @close="closeResult" />
    </div>
    <ToastStack />
    <p class="sr-only" aria-live="polite" data-testid="announcer">{{ state.announcement }}</p>
  </div>
</template>

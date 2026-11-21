<script setup lang="ts">
import { dismissNotice, state } from '../app/arena';
import { BTN, NOTICE_TONE } from '../ui/classes';

/** Notices as fixed toasts: on the play page they must not take space from the boards. */
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex flex-col items-center gap-2 px-3" aria-live="assertive">
    <p
      v-if="state.storageNotice"
      :class="['pointer-events-auto max-w-2xl rounded-xl border px-4 py-2 text-xs text-fg shadow-lg', NOTICE_TONE.warning, 'bg-raised']"
      data-notice="storage"
    >
      <span class="font-semibold">On-device storage is unavailable.</span> {{ state.storageNotice }}
    </p>
    <div
      v-for="notice in state.notices"
      :key="notice.id"
      :class="['pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl border bg-raised px-4 py-2 text-xs text-fg shadow-lg', NOTICE_TONE[notice.tone]]"
      role="alert"
      :data-notice="notice.tone"
    >
      <p>
        <span class="font-semibold">{{ notice.title }}.</span>
        {{ notice.body }}
      </p>
      <button type="button" :class="BTN.quiet" @click="dismissNotice(notice.id)">Dismiss</button>
    </div>
  </div>
</template>

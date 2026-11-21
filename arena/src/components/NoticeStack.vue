<script setup lang="ts">
import { dismissNotice, state } from '../app/arena';
import { BTN, NOTICE_TONE } from '../ui/classes';
</script>

<template>
  <div class="mt-8 space-y-3" aria-live="assertive">
    <p v-if="state.storageNotice" :class="['rounded-xl border px-4 py-3 text-sm text-fg', NOTICE_TONE.warning]" data-notice="storage">
      <span class="font-semibold">On-device storage is unavailable.</span> {{ state.storageNotice }}
    </p>
    <div
      v-for="notice in state.notices"
      :key="notice.id"
      :class="['flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm text-fg', NOTICE_TONE[notice.tone]]"
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

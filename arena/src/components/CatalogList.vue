<script setup lang="ts">
import { computed } from 'vue';
import { deviceEntries, forgetDeviceEntry, publicEntries, state, useInSeat } from '../app/arena';
import type { CatalogEntry } from '../catalog/catalog';
import { BTN, ORIGIN_BADGE, SECTION_TITLE } from '../ui/classes';
import { shortHash } from '../ui/labels';

const device = computed(() => deviceEntries());
const published = computed(() => publicEntries());

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');
const sizeKb = (e: CatalogEntry) => `${Math.max(1, Math.round(e.size / 1024))} KiB`;
</script>

<template>
  <section class="mt-14" aria-labelledby="catalog-title">
    <h2 id="catalog-title" :class="[SECTION_TITLE, 'border-b border-line-strong pb-3']">Your games and the public catalog</h2>

    <div class="mt-6 grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="device-title">
        <h3 id="device-title" class="flex items-center gap-2 font-display text-xl font-semibold">
          <span :class="ORIGIN_BADGE.device">On this device</span>
          <span class="text-sm font-normal text-subtle">{{ device.length }} {{ device.length === 1 ? 'program' : 'programs' }}</span>
        </h3>
        <p class="mt-2 text-sm text-muted">Uploaded in this browser. Only you can see these.</p>
        <ul class="mt-4 grid gap-3" data-testid="device-list">
          <li v-if="!state.booted" class="text-sm text-subtle">Loading…</li>
          <li v-else-if="device.length === 0" class="text-sm text-subtle">Nothing uploaded yet. Use Import .wasm above.</li>
          <li v-for="e in device" :key="e.sha256" class="rounded-xl border border-line bg-raised p-4 text-sm" :data-sha="e.sha256">
            <p class="font-semibold">{{ e.metadata.title }} <span class="font-normal text-subtle">v{{ e.metadata.gameVersion }}</span></p>
            <p class="mt-0.5 text-xs text-muted">{{ e.metadata.model }} · {{ e.metadata.codeAgent }} · {{ e.metadata.runtime }}</p>
            <p class="mt-0.5 text-xs text-subtle">
              <span class="font-mono" :title="e.sha256">{{ shortHash(e.sha256) }}</span> · {{ sizeKb(e) }}
              <template v-if="e.origin === 'device'"> · uploaded {{ when(e.addedAt) }}</template>
              <template v-else> · also in the public catalog</template>
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" :class="BTN.secondary" :data-testid="`play-left-${e.sha256.slice(0, 8)}`" @click="useInSeat('left', e.sha256)">Play in left seat</button>
              <button type="button" :class="BTN.secondary" @click="useInSeat('right', e.sha256)">Play in right seat</button>
              <button type="button" :class="BTN.quiet" :data-testid="`remove-${e.sha256.slice(0, 8)}`" @click="forgetDeviceEntry(e.sha256)">Remove from this device</button>
            </div>
          </li>
        </ul>
      </section>

      <section aria-labelledby="public-title">
        <h3 id="public-title" class="flex items-center gap-2 font-display text-xl font-semibold">
          <span :class="ORIGIN_BADGE.public">Public catalog</span>
          <span class="text-sm font-normal text-subtle">{{ published.length }} {{ published.length === 1 ? 'program' : 'programs' }}</span>
        </h3>
        <p class="mt-2 text-sm text-muted">Published with this site, available in every browser.</p>
        <p v-if="state.catalogError" class="mt-2 text-sm text-bronze" role="alert">{{ state.catalogError }}</p>
        <ul class="mt-4 grid gap-3" data-testid="public-list">
          <li v-for="e in published" :key="e.sha256" class="rounded-xl border border-line bg-raised p-4 text-sm" :data-sha="e.sha256">
            <p class="font-semibold">{{ e.metadata.title }} <span class="font-normal text-subtle">v{{ e.metadata.gameVersion }}</span></p>
            <p class="mt-0.5 text-xs text-muted">{{ e.metadata.model }} · {{ e.metadata.codeAgent }}</p>
            <p class="mt-0.5 text-xs text-subtle">
              <span class="font-mono" :title="e.sha256">{{ shortHash(e.sha256) }}</span> · {{ sizeKb(e) }}
              <template v-if="e.provenance"> · {{ e.provenance.language }}</template>
            </p>
            <p v-if="e.credits" class="mt-1 text-xs text-subtle">{{ e.credits }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" :class="BTN.secondary" @click="useInSeat('left', e.sha256)">Play in left seat</button>
              <button type="button" :class="BTN.secondary" @click="useInSeat('right', e.sha256)">Play in right seat</button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

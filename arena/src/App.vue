<script setup lang="ts">
import { onMounted } from 'vue';
import { boot, notify, state } from './app/arena';
import { uploadUrl } from './app/paths';
import AboutSection from './components/AboutSection.vue';
import ArenaFooter from './components/ArenaFooter.vue';
import ArenaHeader from './components/ArenaHeader.vue';
import EntrantColumn from './components/EntrantColumn.vue';
import MatchSettings from './components/MatchSettings.vue';
import NoticeStack from './components/NoticeStack.vue';
import ReplaysSection from './components/ReplaysSection.vue';
import { BTN, SECTION_TITLE } from './ui/classes';

onMounted(async () => {
  try {
    await boot();
  } catch (err) {
    notify('error', 'The Arena could not start', err instanceof Error ? err.message : String(err));
  }
});
</script>

<template>
  <a
    href="#entrants-title"
    class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
  >
    Skip to the match setup
  </a>
  <div class="mx-auto w-full max-w-7xl px-5 sm:px-8" :data-booted="state.booted" data-page="arena">
    <ArenaHeader page="arena" />
    <NoticeStack />
    <p v-if="state.catalogError" class="mt-4 text-sm text-bronze" role="alert">{{ state.catalogError }}</p>

    <section class="mt-12" aria-labelledby="entrants-title">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-3">
        <h2 id="entrants-title" :class="SECTION_TITLE">Entrants</h2>
        <a :href="uploadUrl()" :class="BTN.secondary" data-testid="go-upload">Upload a game</a>
      </div>
      <p class="mt-4 max-w-3xl text-sm text-muted">
        Choose a program and an exact version for each seat — from the public catalog, or from programs you have
        <a :href="uploadUrl()" class="text-accent underline underline-offset-2">uploaded</a> on this device.
      </p>
      <div class="mt-6 grid gap-5">
        <div class="grid gap-5 md:grid-cols-2">
          <EntrantColumn seat="left" />
          <EntrantColumn seat="right" />
        </div>
        <MatchSettings />
      </div>
    </section>

    <ReplaysSection />
    <AboutSection />
    <ArenaFooter />
  </div>
</template>

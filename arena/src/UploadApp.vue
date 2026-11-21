<script setup lang="ts">
import { onMounted } from 'vue';
import { boot, notify, state } from './app/arena';
import { arenaUrl } from './app/paths';
import AboutCatalogs from './components/AboutCatalogs.vue';
import ArenaFooter from './components/ArenaFooter.vue';
import ArenaHeader from './components/ArenaHeader.vue';
import CatalogList from './components/CatalogList.vue';
import ImportPanel from './components/ImportPanel.vue';
import NoticeStack from './components/NoticeStack.vue';
import { BTN, SECTION_TITLE } from './ui/classes';

onMounted(async () => {
  try {
    await boot();
  } catch (err) {
    notify('error', 'The upload page could not start', err instanceof Error ? err.message : String(err));
  }
});
</script>

<template>
  <a
    href="#upload"
    class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
  >
    Skip to the upload
  </a>
  <div class="mx-auto w-full max-w-7xl px-5 sm:px-8" :data-booted="state.booted" data-page="upload">
    <ArenaHeader page="upload" />
    <NoticeStack />

    <section id="upload" class="mt-12 scroll-mt-6" aria-labelledby="upload-title">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-3">
        <h2 id="upload-title" :class="SECTION_TITLE">Import a .wasm</h2>
        <a :href="arenaUrl()" :class="BTN.secondary" data-testid="go-arena">Go to the Arena</a>
      </div>
      <div class="mt-6">
        <ImportPanel />
      </div>
    </section>

    <CatalogList />
    <AboutCatalogs />
    <ArenaFooter />
  </div>
</template>

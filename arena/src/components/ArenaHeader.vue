<script setup lang="ts">
import { arenaUrl, leaderboardUrl, uploadUrl, type Page } from '../app/paths';
import { RULES_ID } from '../referee';

const props = defineProps<{ page: Exclude<Page, 'leaderboard'> }>();

const LINKS: readonly { page: Page; label: string; href: () => string }[] = [
  { page: 'leaderboard', label: 'Leaderboard', href: leaderboardUrl },
  { page: 'upload', label: 'Upload', href: uploadUrl },
  { page: 'arena', label: 'Arena', href: () => arenaUrl() },
];

const COPY = {
  arena: {
    title: 'Jungle Arena',
    lede: 'Two independently built WebAssembly programs. Two boards, each drawn by its own program. One referee.',
    body: 'Set up a match here: choose a version for each seat and the settings, then Start — the match opens full screen. Each program picks its own moves and paints its own board; the Arena keeps the official position, checks every move and saves the replay. Everything runs in this browser — no server computes a move.',
  },
  upload: {
    title: 'Upload a game',
    lede: 'Bring your own Jungle program, compiled to one WebAssembly Component.',
    body: 'Your file is checked here, in this browser, before any of its code runs. Once it passes, it is saved on this device and ready to play in either seat of the Arena.',
  },
} as const;

const copy = COPY[props.page];
</script>

<template>
  <header class="pt-10 sm:pt-14">
    <div
      class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line-strong pb-3 text-[0.66rem] font-semibold tracking-[0.16em] uppercase"
    >
      <nav aria-label="Site" class="flex items-baseline gap-4" data-testid="site-nav">
        <template v-for="link in LINKS" :key="link.page">
          <span v-if="link.page === page" class="text-accent" aria-current="page">{{ link.label }}</span>
          <a v-else :href="link.href()" class="text-subtle underline-offset-4 hover:text-accent hover:underline" :data-testid="`nav-${link.page}`">{{ link.label }}</a>
        </template>
      </nav>
      <p class="text-subtle">Contract jungle:arena/competitor@1.0.0 · Rules {{ RULES_ID }}</p>
    </div>

    <h1 class="mt-8 font-display text-5xl leading-[1.03] font-semibold tracking-tight text-balance sm:mt-10 sm:text-6xl">
      {{ copy.title }}
    </h1>
    <p class="mt-6 max-w-3xl font-display text-xl leading-snug text-muted text-balance sm:text-2xl">{{ copy.lede }}</p>
    <p class="mt-5 max-w-2xl text-sm leading-relaxed text-subtle">{{ copy.body }}</p>
  </header>
</template>

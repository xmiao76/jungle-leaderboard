<script setup lang="ts">
import { leaderboardUrl, sdkUrl } from '../app/paths';

const LINK = 'text-muted underline decoration-line-strong underline-offset-2 hover:text-accent';
</script>

<template>
  <footer class="mt-16 border-t border-line-strong py-9 text-xs leading-relaxed text-subtle sm:mt-20">
    <p>
      Arena built by Claude-Opus-5.5 with ClaudeCode for the
      <a :href="leaderboardUrl()" :class="LINK">Jungle Leaderboard</a>. Source:
      <a href="https://github.com/xmiao76/jungle-leaderboard" target="_blank" rel="noopener noreferrer" :class="LINK">github.com/xmiao76/jungle-leaderboard</a>.
      Contract: <a :href="sdkUrl('jungle.wit')" :class="LINK">jungle.wit</a> ·
      <a :href="sdkUrl('desktop-jungle-v1.json')" :class="LINK">rules profile</a>.
    </p>
  </footer>
</template>

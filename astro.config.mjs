// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Used for canonical + Open Graph URLs. Must match the deployed Pages domain.
  site: 'https://jungle-leaderboard.pages.dev',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});
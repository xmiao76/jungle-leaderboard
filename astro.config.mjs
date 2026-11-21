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

  // The Arena pages come from a separate Vite build (dist/arena/), so list them explicitly.
  integrations: [
    sitemap({
      customPages: ['https://jungle-leaderboard.pages.dev/arena/', 'https://jungle-leaderboard.pages.dev/arena/upload/'],
    }),
  ]
});
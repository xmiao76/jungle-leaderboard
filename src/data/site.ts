/** Site-wide metadata. Keep `url` in sync with `site` in astro.config.mjs. */
export const SITE = {
  name: 'Jungle Leaderboard',
  title: 'Jungle Leaderboard — SOTA AI Model Coding Benchmark',
  description:
    'Frontier AI models were each given about two hours of agentic coding time to build a playable Jungle (Dou Shou Qi) program, then their programs competed. Rankings, playable builds, and source code.',
  url: 'https://jungle-leaderboard.pages.dev',
  repoUrl: 'https://github.com/xmiao76/jungle-leaderboard',
  author: 'xmiao76',
  authorUrl: 'https://github.com/xmiao76',
} as const;

/** Site-wide metadata. Keep `url` in sync with `site` in astro.config.mjs. */
export const SITE = {
  name: 'Jungle Leaderboard',
  title: 'Jungle Leaderboard — Live Elo Standings for Jungle Programs',
  description: 'Published Jungle (Dou Shou Qi) programs ranked by Elo. Every program starts at 1000 once it passes the upload test; rated matches in the Arena move its rating. Upload your own and play them off.',
  url: 'https://jungle-leaderboard.pages.dev',
  repoUrl: 'https://github.com/xmiao76/jungle-leaderboard',
  author: 'xmiao76',
  authorUrl: 'https://github.com/xmiao76',
} as const;

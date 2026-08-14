# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server at http://localhost:4321
npm run build        # astro check && astro build -> dist/
npm run check        # type + template diagnostics only
npm test             # vitest run
npm run test:watch   # vitest in watch mode
```

Single test file or single case:

```bash
npx vitest run src/lib/ranking.test.ts
npx vitest run -t 'rejects a gap in the place sequence'
```

`npm run build` type-checks first, so a red build can mean a type error rather than a build failure —
run `npm run check` to separate the two.

## Architecture

A single static page whose entire content derives from one data module. The flow is:

`src/data/models.ts` → `validateEntries()` → `buildLeaderboard()` → `.astro` components → `dist/`

- **`src/data/models.ts` is the only place leaderboard data lives.** Content edits belong here, not
  in templates. `src/data/site.ts` holds title/description/canonical URL/byline.
- **`validateEntries()` is called from `src/pages/index.astro` at build time**, so bad data fails the
  build instead of shipping. It rejects duplicate ids, blank required text, non-HTTPS URLs, source
  URLs outside github.com, and place sequences that are not valid competition ranking.
- **`buildLeaderboard()` sorts and annotates; it never mutates.** It returns new objects carrying
  `isTied` and `medal`. Ties are expressed by two entries sharing a `place`, and standard competition
  ranking means the next place is skipped (1,2,3,4,5,5 — never a 6). The validator enforces this, so
  changing a place usually means changing another one too.
- **The Record column is conditional.** `summarize().hasRecords` is false while no entry has a
  `record`, and the column is omitted entirely rather than rendered empty. Adding a `record` to any
  entry makes the column appear with no template change.
- Logic lives in `src/lib/` and is unit-tested; `.astro` components have no unit tests and are
  verified through build output instead.

## Styling gotchas

Tailwind v4 with tokens declared in `src/styles/global.css`: CSS custom properties on `:root`, a
`prefers-color-scheme: light` override, and `@theme inline` to expose them as utilities.

- **Opacity modifiers silently break on these tokens.** `bg-gold/12` compiles to
  `background-color: var(--c-gold)` — full opacity, modifier dropped — because `@theme inline` gives
  Tailwind an unresolvable `var()` to mix. Use the alpha-baked tokens instead: `bg-gold-soft`,
  `border-gold-line`, and the matching `silver`/`bronze`/`open`/`closed` variants. Never add a `/NN`
  modifier to a token colour; add a new token carrying its own alpha.
- **Dynamic class names must appear literally in source.** Component styles use `as const` lookup
  maps of complete class strings (see `RankBadge.astro`, `AccessBadge.astro`) so Tailwind's scanner
  finds them. Never build a token class by string concatenation.
- **The mobile table depends on `data-label`.** Under 48rem, `.lb-table` collapses rows to cards and
  renders each column's heading from `td[data-label]` via `::before`. Any new `<td>` in
  `ModelRow.astro` needs a `data-label` matching its `<th>`, or it loses its label on phones. Add
  `data-span` for a cell that should span the full card width.

## Deployment

Static build on Cloudflare Pages via the GitHub integration; pushes to `main` deploy. Preset Astro,
build command `npm run build`, output `dist`, Node from `.nvmrc`.

Changing the domain means updating three places: `site` in `astro.config.mjs`, `SITE.url` in
`src/data/site.ts`, and the `Sitemap:` line in `public/robots.txt`. Canonical tags, Open Graph URLs
and the generated sitemap all derive from these.

## Astro reference

- [Routing and pages](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Styling and Tailwind](https://docs.astro.build/en/guides/styling/)

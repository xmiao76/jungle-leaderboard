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
  ranking means a group of k tied entries consumes the k-1 places below it. The current data is
  1,2,3,4,4,6 — two share fourth, so fifth is not awarded. The validator enforces this, so changing
  one place usually means changing another too.
- **The Record column is conditional.** `summarize().hasRecords` is false while no entry has a
  `record`, and the column is omitted entirely rather than rendered empty. Adding a `record` to any
  entry makes the column appear with no template change.
- **Ranking prose is generated, not hand-written.** `describeRanking()` in `src/lib/ties.ts` turns the
  places into "Places follow standard competition ranking. Two models share fourth place, so no fifth
  place is awarded." Both the table caption and the "Reading the table" section call it, so editing a
  `place` updates the copy automatically. Never type an ordinal like "fifth" into a component — the
  page contradicted its own table twice before this existed. The README is hand-written and does need
  updating by hand.
- Logic lives in `src/lib/` and is unit-tested; `.astro` components have no unit tests and are
  verified through build output instead.

## Template authoring gotcha

**A newline directly after `{expression}` is dropped, not collapsed to a space.** `{budgetHours}` on
one line and `hours` on the next renders `3hours`; this shipped for three deploys. The same applies to
an HTML comment placed mid-sentence, which is why explanatory comments live in component frontmatter
rather than in markup. Either keep the expression and its neighbouring words on one source line, or
end it with the explicit `{' '}` idiom — see the caption in `LeaderboardTable.astro`. After touching
interpolated copy, grep the built `dist/index.html` for joined words.

## Design direction

"Tournament almanac": warm paper, one jade accent, gold/silver/bronze reserved for the podium.
Fraunces (display, self-hosted, optical-size axis) over IBM Plex Sans (text). **Light is the default
theme**; `prefers-color-scheme: dark` is a warm-neutral inversion, not a cool slate.

The palette is deliberately four things — paper, ink, jade, three metals. Adding a fifth hue for a
new category is the fastest way to make this page look generic; differentiate with weight, rule, or
dot fill instead (see `AccessBadge.astro`, which uses a filled vs hollow dot rather than two colours).

## Styling gotchas

Tokens live in `src/styles/global.css` as CSS custom properties on `:root`, with a
`prefers-color-scheme: dark` override, exposed as utilities through `@theme inline`.

- **Opacity modifiers silently break on these tokens.** `bg-gold/12` compiles to
  `background-color: var(--c-gold)` — full opacity, modifier dropped — because `@theme inline` gives
  Tailwind an unresolvable `var()` to mix. Use the alpha-baked tokens instead: `bg-gold-soft`,
  `border-gold-line`, and the matching `silver`/`bronze`/`accent` variants. Never add a `/NN`
  modifier to a token colour; add a new token carrying its own alpha.
- **Contrast is measured, not eyeballed.** Every text/background pair clears WCAG AA in both themes;
  the tightest is `subtle` on `inset` (light) at 5.10:1. Two separate rounds of this redesign
  produced real failures that looked fine in the values — recompute before lightening `subtle`,
  `muted`, or any medal token.
- **Dynamic class names must appear literally in source.** Component styles use `as const` lookup
  maps of complete class strings (see `RankBadge.astro`, `Podium.astro`) so Tailwind's scanner finds
  them. Never build a token class by string concatenation.
- **The mobile table depends on `data-label`.** Under 48rem, `.lb-table` collapses rows to cards and
  renders each column's heading from `td[data-label]` via `::before`. Any new `<td>` in
  `ModelRow.astro` needs a `data-label` matching its `<th>`, or it loses its label on phones. Add
  `data-span` for a cell that should span the full card width.
- **`--rule` drives the row accent.** `ModelRow.astro` sets it inline per row (medal colour for the
  top three, `--c-accent-line` otherwise); CSS reads it for both the desktop first-cell left border
  and the mobile card's left edge. One variable, two layouts.
- **The podium's visual order is not its DOM order.** `Podium.astro` emits 1·2·3 so screen readers
  and Tab order follow the ranking; `.podium` reorders to 2·1·3 visually at 48rem and up. Never
  "fix" the DOM order to match what you see on screen.
- **Reveal animations must never gate visibility.** `.reveal-fade` / `.reveal-rise` stagger via an
  inline `--i`, and `prefers-reduced-motion` resets them to `opacity: 1`. Any new entry animation
  needs that same reduced-motion reset, or content disappears for those users.

## Deployment

`npm run deploy` runs the tests, then a type-checked build, then `wrangler pages deploy dist` to the
Cloudflare Pages project `jungle-leaderboard`.

**Pushing to GitHub deploys nothing.** The project is Direct Upload, not Git-connected, and
Cloudflare fixes that choice at creation time — so never describe a push as publishing, and do not
offer "connect the repo to Pages" as a fix for a stale site; that would require recreating the
project. Re-run `npm run deploy` instead. Deploying needs a Cloudflare OAuth session, which
`npx wrangler whoami` will confirm.

Changing the domain means updating three places: `site` in `astro.config.mjs`, `SITE.url` in
`src/data/site.ts`, and the `Sitemap:` line in `public/robots.txt`. Canonical tags, Open Graph URLs
and the generated sitemap all derive from these.

## Astro reference

- [Routing and pages](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Styling and Tailwind](https://docs.astro.build/en/guides/styling/)

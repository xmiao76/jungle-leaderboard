# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server at http://localhost:4321
npm run build        # astro check && astro build -> dist/
npm run check        # type + template diagnostics only
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run dev:full     # built site + catalog API (wrangler pages dev, local D1/R2) at :8788
npm run db:migrate -- --local    # apply migrations/ to local state (--remote: production)
npm run db:seed -- --local       # load seed/catalog/ into local D1/R2 (--remote: production)
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
  1,2,3,4,4,6,6 — two share fourth and two share sixth, so neither fifth nor seventh is awarded. The
  validator enforces this, so changing one place usually means changing another too.
- **The Record column is conditional.** `summarize().hasRecords` is false while no entry has a
  `record`, and the column is omitted entirely rather than rendered empty. Adding a `record` to any
  entry makes the column appear with no template change.
- **Ranking prose is generated, not hand-written.** `describeRanking()` in `src/lib/ties.ts` turns the
  places into "Places follow standard competition ranking. Two models share fourth place, so no fifth
  place is awarded." Both the table caption and the "Reading the table" section call it, so editing a
  `place` updates the copy automatically. Never type an ordinal like "fifth" into a component — the
  page contradicted its own table twice before this existed. The README is hand-written and does need
  updating by hand.
- **The model count in the masthead is derived too.** `SiteHeader.astro` renders
  `capitalize(countWord(modelCount))`, fed from `summarize().total`. Adding an entry updates the
  headline automatically; never type "Seven" into the template.
- Logic lives in `src/lib/` and is unit-tested; `.astro` components have no unit tests and are
  verified through build output instead.

## Arena (`arena/`)

A Vue 3 + Vite app built with `base: './'` into `dist/arena/` after the Astro build (`npm run build`
runs both). Spec: `arena_prompt.md`. Protocol and replay format: `sdk/README.md`.

- **Separate pages:** leaderboard `/` (Astro), upload `/arena/upload/` (`arena/upload/index.html` →
  `UploadApp.vue`), Arena setup `/arena/` (`arena/index.html` → `App.vue`) and the full-screen match
  `/arena/play/` (`arena/play/index.html` → `PlayApp.vue`; config or `?replay=` in the URL, parsed by
  `parsePlayQuery`). The play page must never scroll: board size is pure CSS in `arena.css`
  (`.play-root` custom properties); anything new on it goes in the one-row bar or in an overlay
  (history drawer, toasts), never in the layout flow. Each Arena page declares
  its root in `<meta name="arena-root">`; build every link, the catalog URL and SDK URLs through
  `arena/src/app/paths.ts`, never from `document.baseURI`, or the nested page resolves them wrongly.
  Seat choices persist in localStorage and can be preset with `?left=<sha>&right=<sha>`.
- **Pure logic is unit-tested; browser modules are not.** `referee/`, `loader/` (except workers),
  `match/`, `catalog/`, `replay/schema.ts`, `storage/` run under Vitest with fakes
  (`match/fakes.test-support.ts`). `app/`, `components/`, `audio/`, `conformance/`, canvas code and
  worker entry points are covered by Playwright (`tests/e2e/`) and the conformance runner. Coverage is
  enforced at 80 % on the former only (see `vitest.config.ts`).
- **The contract check compares against `arena/src/loader/canonical-contract.json`**, generated from
  `wit/jungle.wit`. Regenerate with `UPDATE_CONTRACT=1 npx vitest run arena/src/loader/contract.test.ts`
  — never edit it by hand. The extractor renders anything it does not model as `unsupported:…`, which
  can never match; keep it that way rather than "accepting" new forms.
- **Never pass Vue proxies to `postMessage` or IndexedDB.** Both throw `DataCloneError` on a proxy.
  Anything that leaves the main thread or is persisted goes through `toRaw()` (entries, replays) or a
  JSON clone (`persistReplay`). This shipped once and silently dropped every replay into memory.
- **The match controller serializes all requests per seat (`withSeat`)** and guards every await with
  `generation`. A new code path that talks to a seat must go through the lock, or a flip or resync
  will collide with a search. Never start a worker after `dispose()`.
- **Test entrants** live in `arena/test-fixtures/` (committed; built from `tests/test-entrant/` by
  `npm run build:fixtures`). `test-entrant-1.1.0`/`-1.0.0` are a small well-behaved program (always
  plays legal index 0) used by e2e tests as an upload; `broken-*` fail admission; `late-*` pass it and
  misbehave from revision 2, for forfeit tests. None of them belongs in the public catalog, which holds
  only real games.
- **The public catalog is a database, not a static file.** Pages Functions in `functions/` (logic in
  `server/`, type-checked by `functions/tsconfig.json` against the generated
  `worker-configuration.d.ts`; rerun `npm run cf-typegen` after editing `wrangler.toml`) serve
  `/api/catalog/manifest.json` from D1 (`migrations/`) and `/api/catalog/<sha256>.wasm` from R2, in the
  manifest format `parseManifest` already reads. `catalogBase()` points there (`../api/catalog/` from
  the Arena root). Plan and status: `docs/PLAN-shared-catalog.md`.
- **Curated entries live in `seed/catalog/`** (binaries + `seed.json`); add them only with
  `npm run catalog:add` (validates, copies, updates `seed.json`; `--reference` picks the one program
  conformance runs play against), then load them with `npm run db:seed`. `npm test` re-hashes every one.
- **Server tests use real local D1/R2**: `server/local-env.test-support.ts` starts workerd through
  wrangler's `getPlatformProxy` (in memory, never remote) and applies every migration. workerd on
  Windows needs the Visual C++ 2015+ runtime. `wrangler.toml`'s `compatibility_date` cannot exceed what
  the pinned workerd supports (2026-08-18 today).
- **e2e and conformance start the API themselves**: `scripts/api-server.ts --fresh` (migrate + seed a
  throwaway `.wrangler/*-state`, then `wrangler pages dev`), and `serve-static.mjs --api` forwards the
  nested prefix's `api/` to it, so the relative-URL proof still holds.

## Template authoring gotcha

**A newline directly after `{expression}` is dropped, not collapsed to a space.** `{budgetHours}` on
one line and `hours` on the next renders `3hours`; this shipped for three deploys. The same applies to
an HTML comment placed mid-sentence, which is why explanatory comments live in component frontmatter
rather than in markup. Either keep the expression and its neighbouring words on one source line, or
end it with the explicit `{' '}` idiom — see the caption in `LeaderboardTable.astro`. After touching
interpolated copy, grep the built `dist/index.html` for joined words.

## Design direction

"Tournament almanac": warm paper, one jade accent, gold/silver/bronze reserved for the podium.
The Arena shares the tokens (`src/styles/tokens.css`). Its Red/Blue side chips use
`--c-side-red`/`--c-side-blue` — the single sanctioned exception to the palette, for side identity
only (contrast measured: tightest 5.79:1). Never use them for any other category.
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

`npm run deploy` checks `wrangler.toml`, runs the tests, then a type-checked build, applies D1
migrations remotely, then `wrangler pages deploy dist` (static site + `functions/`) to the Cloudflare
Pages project `jungle-leaderboard`.

**Deploy is blocked until the production database exists.** `wrangler.toml` carries an all-zero
placeholder `database_id`, and `scripts/check-deploy-config.mjs` refuses to deploy while it does.
One-time setup (account: Workers Free, R2 Paid): `wrangler d1 create jungle-arena` and
`wrangler r2 bucket create jungle-arena-entrants`, record the id in `wrangler.toml`, then
`npm run db:migrate -- --remote` and `npm run db:seed -- --remote`. Creating account resources is
outward-facing: ask first.

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

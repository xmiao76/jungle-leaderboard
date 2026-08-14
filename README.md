# Jungle Leaderboard

A leaderboard for an agentic-coding benchmark. Each frontier AI model is given roughly two hours of
agentic coding time to build a playable **Jungle** — Chinese *Dou Shou Qi* (斗兽棋), "the game of
fighting animals" — program from an empty repository. The finished programs are then played against
one another.

**Live site:** <https://jungle-leaderboard.pages.dev>

---

## What the benchmark measures

Most coding evaluations score a model on isolated functions or on patches to an existing codebase.
This one asks a different question: given a fixed wall-clock budget and a single, fully specified
target, can a model produce a complete, correct, playable artifact?

Jungle is a deliberate choice of target. Its core rule — a piece captures any enemy of equal or
lower rank — is trivial. Its exceptions are not, and they interact:

- The Rat captures the Elephant, while the Elephant cannot touch the Rat.
- Only the Rat may enter the two river regions, and it cannot capture while in the water.
- The Lion and the Tiger leap a river in a straight line, unless a rat of either colour sits
  anywhere along the path.
- A piece standing in one of the opponent's traps loses its rank entirely and can be captured by
  anything.

A naive implementation produces something that resembles Jungle and plays legally most of the time.
Defects concentrate in exactly the positions those exceptions govern. Competition play is what
forces those positions to occur.

## Methodology

**Build phase.** Every model received the same task — implement a complete, playable Jungle program
— and approximately two hours of agentic coding time in which to finish it. Each model worked inside
the coding harness and effort setting recorded against it in the results table, so a row describes a
model-plus-harness configuration rather than a model in isolation.

**Competition phase.** The finished programs were played against one another. A model is credited
with a win when the program it wrote wins its match: what competes is the artifact the model
produced, not the model playing live.

**Failure criterion.** A program in which a defect is observed during competition — an illegal move
accepted, a rule applied incorrectly, a crash, or a state the game cannot recover from — is recorded
as a failure for the model that wrote it. Correctness is a precondition rather than a tiebreaker: a
program that plays strongly but violates a rule does not outrank one that plays correctly.

## Results

Standings as of **August 14, 2026**.

| # | Model | Access | Coding harness | Effort | Play | Source |
|---|-------|--------|----------------|--------|------|--------|
| 1 | DeepSeek-V4-Pro-0813 | Open | ClaudeCode + Vision MCP | official Max | [Play](https://deepseek-jungle.pages.dev/) | [Source](https://github.com/xmiao76/deepseek_jungle_web) |
| 2 | Qwen-3.8 | Open | ClaudeCode | xhigh | [Play](https://qwen-jungle.pages.dev/) | [Source](https://github.com/xmiao76/qwen_jungle_web) |
| 3 | Claude-Fable-5 | Closed | Everything-ClaudeCode | Max | [Play](https://claude-jungle.pages.dev/) | [Source](https://github.com/xmiao76/claude_cc_jungle_web) |
| 4 | Grok-4.6 | Closed | GrokBuild | xhigh | [Play](https://grok-jungle.pages.dev/) | [Source](https://github.com/xmiao76/grok_jungle_web) |
| 5 | GPT-5.6-Sol | Closed | Codex | Ultra | [Play](https://gpt-jungle.pages.dev/) | [Source](https://github.com/xmiao76/gpt_jungle_web) |
| 5 | Kimi-K3 | Open | ClaudeCode | Max | [Play](https://kimi-jungle.pages.dev/) | [Source](https://github.com/xmiao76/kimi_jungle_web) |

*Access* indicates whether the model's weights are publicly available.

### Reading the results

Places follow standard competition ranking. GPT-5.6-Sol and Kimi-K3 finished level and therefore
share fifth place; the place immediately below a shared position is skipped, so no sixth place is
awarded. Models within a tie are level with one another and are not ordered — the alphabetical
sequence shown inside a tie carries no meaning.

Per-match records are not part of this snapshot; the table publishes final placements only. Every
entry links to both the deployed build and its full source, so any result here can be replayed and
inspected directly.

A row should be read as one configuration of a model, not as a verdict on the model at every
setting. The harness driving the model and the reasoning tier it ran at both materially affect the
outcome.

---

## Development

Requires Node 22.12 or newer; `.nvmrc` pins 24 for reproducible builds.

```bash
npm install
npm run dev        # dev server at http://localhost:4321
npm run build      # type-check, then build static output to dist/
npm run preview    # serve the built output locally
npm run check      # astro check (types + template diagnostics) on its own
npm test           # run the Vitest suite once
npm run test:watch # re-run tests on change
```

Run a single test file or a single case:

```bash
npx vitest run src/lib/ranking.test.ts
npx vitest run -t 'rejects a gap in the place sequence'
```

### Project layout

```
src/
  data/models.ts        Leaderboard data — the single source of truth
  data/site.ts          Site title, description, canonical URL, byline
  lib/ranking.ts        buildLeaderboard() and validateEntries(), both pure
  lib/summary.ts        Open/closed counts and Record-column visibility
  lib/format.ts         Date and match-record display formatting
  lib/*.test.ts         Vitest coverage for the logic above
  components/           Presentational Astro components
  layouts/BaseLayout    <head>, metadata, JSON-LD, skip link
  pages/index.astro     Composes the page; validates data at build time
  styles/global.css     Design tokens, base styles, responsive table rules
```

Tests cover the logic layer. The components are verified through the build: `npm run build` fails on
malformed data, and the rendered `dist/index.html` is the artifact to inspect.

### Updating the leaderboard

Edit `src/data/models.ts` — nothing else holds leaderboard data. `validateEntries()` runs during the
build and fails it if an entry has a duplicate id, blank required text, a non-HTTPS URL, a source URL
outside github.com, or a place sequence that is not valid competition ranking (a gap, or a tie that
does not skip the following place).

To publish head-to-head records later, add a `record: { wins, losses, draws }` field to any entry.
The table renders a Record column automatically once at least one entry has one, so no template
change is needed.

## Deployment

Live at <https://jungle-leaderboard.pages.dev>, hosted on Cloudflare Pages as a **Direct Upload**
project — the same arrangement as the six game builds it links to. Pushing to GitHub does not deploy;
publishing is an explicit command:

```bash
npm run deploy
```

That runs the test suite and a type-checked build before uploading, so a malformed data edit cannot
reach production. It needs a Cloudflare session — run `npx wrangler login` once if
`npx wrangler whoami` reports you are not logged in.

A Direct Upload project cannot later be switched to Git integration; Cloudflare fixes that choice
when the project is created. Automatic deploys on push would require either a new project connected
to this repository or a CI workflow invoking the same `wrangler pages deploy`.

If the deployment domain changes, update `site` in `astro.config.mjs`, `SITE.url` in
`src/data/site.ts`, and the sitemap URL in `public/robots.txt` — canonical tags, Open Graph URLs and
the generated sitemap all derive from those.

---

Benchmark designed and run by [xmiao76](https://github.com/xmiao76). Model and product names are the
trademarks of their respective owners.

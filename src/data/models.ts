/**
 * Single source of truth for the leaderboard.
 *
 * To publish an update, edit this file only. `validateEntries()` runs at build
 * time (see src/pages/index.astro), so a malformed entry fails the build rather
 * than shipping a broken page.
 */

/** Whether the model's weights are publicly available. */
export type Access = 'open' | 'closed';

/** Head-to-head competition record. Not yet published for this snapshot. */
export interface MatchRecord {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface ModelEntry {
  /** Stable slug, used for DOM ids and as the uniqueness key. */
  readonly id: string;
  readonly model: string;
  readonly provider: string;
  readonly access: Access;
  /** Coding harness the model ran inside, as reported by the benchmark author. */
  readonly harness: string;
  /** Reasoning-effort or tier setting the model ran at. */
  readonly effort: string;
  /** Deployed, playable build produced by the model. */
  readonly playUrl: string;
  /** GitHub repository holding that build's source. */
  readonly sourceUrl: string;
  /** Standard competition place. Shared values denote a tie. */
  readonly place: number;
  /** Optional: renders a Record column only once at least one entry has it. */
  readonly record?: MatchRecord;
}

/** Date the ranking reflects, as an ISO calendar date. */
export const SNAPSHOT_DATE = '2026-08-14';

/** Approximate agentic coding time each model was given for the build phase. */
export const BUILD_BUDGET_HOURS = 3;

/**
 * The same budget spelled out, for running prose. Kept next to the numeral so
 * the two cannot drift — copy in the header, rules and meta description all read
 * from this rather than hardcoding a word.
 */
export const BUILD_BUDGET_WORDS = 'three';

export const MODELS: readonly ModelEntry[] = [
  {
    id: 'deepseek-v4-pro-0813',
    model: 'DeepSeek-V4-Pro-0813',
    provider: 'DeepSeek',
    access: 'open',
    harness: 'ClaudeCode + Vision MCP',
    effort: 'official Max',
    playUrl: 'https://deepseek-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/deepseek_jungle_web',
    place: 1,
  },
  {
    id: 'qwen-3-8',
    model: 'Qwen-3.8-Max',
    provider: 'Alibaba',
    access: 'open',
    harness: 'ClaudeCode',
    effort: 'xhigh',
    playUrl: 'https://qwen-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/qwen_jungle_web',
    place: 2,
  },
  {
    id: 'claude-fable-5',
    model: 'Claude-Fable-5',
    provider: 'Anthropic',
    access: 'closed',
    harness: 'Everything-ClaudeCode',
    effort: 'Max',
    playUrl: 'https://claude-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/claude_cc_jungle_web',
    place: 3,
  },
  {
    id: 'grok-4-6',
    model: 'Grok-4.6',
    provider: 'xAI',
    access: 'closed',
    harness: 'GrokBuild',
    effort: 'xhigh',
    playUrl: 'https://grok-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/grok_jungle_web',
    place: 4,
  },
  {
    id: 'gpt-5-6-sol',
    model: 'GPT-5.6-Sol',
    provider: 'OpenAI',
    access: 'closed',
    harness: 'Codex',
    effort: 'Ultra',
    playUrl: 'https://gpt-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/gpt_jungle_web',
    place: 5,
  },
  {
    id: 'kimi-k3',
    model: 'Kimi-K3',
    provider: 'Moonshot AI',
    access: 'open',
    harness: 'ClaudeCode',
    effort: 'Max',
    playUrl: 'https://kimi-jungle.pages.dev/',
    sourceUrl: 'https://github.com/xmiao76/kimi_jungle_web',
    place: 5,
  },
];

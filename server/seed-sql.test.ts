import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import type { PublicEntry } from '../arena/src/catalog/catalog';
import { RULES_DIGEST, RULES_ID } from '../arena/src/referee/profile';
import { listPublicEntries } from './catalog-read';
import { startLocalEnv, type LocalEnv } from './local-env.test-support';
import { seedSql, sqlText, upsertSql } from './seed-sql';
import { sha } from './rows.test-support';

function entry(overrides: Partial<PublicEntry> = {}): PublicEntry {
  return {
    sha256: sha('a'),
    size: 121_149,
    file: 'jungle-sample-1-0-0-aaaaaaaa.wasm',
    metadata: {
      title: "Jungle — O'Brien's sample",
      gameVersion: '1.0.0',
      model: 'Claude-Opus-5.5',
      codeAgent: 'ClaudeCode',
      modelPlatform: 'official',
      githubUrl: 'https://github.com/xmiao76/jungle-leaderboard',
      engineVersion: 'alpha-beta; iterative deepening',
      runtime: 'Rust',
      rulesId: RULES_ID,
      rulesDigest: RULES_DIGEST,
    },
    addedAt: '2026-11-21',
    provenance: { language: 'Rust', source: 'wasm_sample/crates/jungle-entrant', toolchain: 'rustc 1.94.1' },
    credits: "Twemoji (c) Twitter; it's CC-BY 4.0; -- not a comment",
    reference: true,
    ...overrides,
  };
}

let local: LocalEnv;
beforeAll(async () => {
  local = await startLocalEnv();
}, 60_000);
afterAll(() => local.dispose());
beforeEach(() => local.reset());

async function execute(sql: string): Promise<void> {
  for (const statement of unstable_splitSqlQuery(sql)) await local.env.DB.prepare(statement).run();
}

describe('sqlText', () => {
  it('quotes text, doubling single quotes, and writes NULL for null', () => {
    expect(sqlText("it's")).toBe("'it''s'");
    expect(sqlText(null)).toBe('NULL');
  });
});

describe('seedSql', () => {
  it('round-trips entries through D1, keeping quotes, semicolons and dashes intact', async () => {
    const entries = [entry(), entry({ sha256: sha('b'), reference: false, provenance: null, credits: null })];
    await execute(seedSql(entries));
    const listed = await listPublicEntries(local.env.DB);
    expect(listed.map((e) => ({ ...e, file: undefined }))).toEqual(entries.map((e) => ({ ...e, file: undefined })));
    expect(listed.map((e) => e.file)).toEqual([`${sha('a')}.wasm`, `${sha('b')}.wasm`]);
  });

  it('re-seeding updates metadata but keeps a hidden entry hidden and its first-added date', async () => {
    await execute(seedSql([entry()]));
    await local.env.DB.prepare("UPDATE entrants SET status = 'hidden'").run();
    await execute(seedSql([entry({ addedAt: '2030-01-01', metadata: { ...entry().metadata, gameVersion: '1.0.1' } })]));
    const row = await local.env.DB.prepare('SELECT status, game_version, created_at FROM entrants').first();
    expect(row).toEqual({ status: 'hidden', game_version: '1.0.1', created_at: '2026-11-21' });
  });

  it('moves the reference flag to whichever seed entry carries it', async () => {
    await execute(seedSql([entry(), entry({ sha256: sha('b'), reference: false })]));
    await execute(seedSql([entry({ reference: false }), entry({ sha256: sha('b'), reference: true })]));
    const { results } = await local.env.DB.prepare('SELECT sha256 FROM entrants WHERE is_reference = 1').all<{ sha256: string }>();
    expect(results.map((r) => r.sha256)).toEqual([sha('b')]);
  });

  it('refuses a seed without exactly one reference opponent, so seeding never clears it', () => {
    expect(() => seedSql([entry({ reference: false })])).toThrow(/exactly one reference/);
    expect(() => seedSql([entry(), entry({ sha256: sha('b') })])).toThrow(/exactly one reference/);
  });

  it.each([
    ['a NUL byte', 'Art\u0000work'],
    ['a control character', 'line\u0007bell'],
    ['a lone surrogate', 'broken \ud800 text'],
    ["wrangler's transaction marker", 'see BEGIN TRANSACTION; notes'],
    ['a lower-case transaction marker', 'commit; done'],
  ])('refuses credits containing %s, which wrangler would mangle or reject', (_label, credits) => {
    expect(() => seedSql([entry({ credits })])).toThrow(/cannot be seeded/);
  });

  it('accepts tabs, newlines and the plain word "commit" in text', async () => {
    const credits = 'Art:\tTwemoji\r\nFont: IBM Plex. Commit 3f2a built it';
    await execute(seedSql([entry({ credits })]));
    const [listed] = await listPublicEntries(local.env.DB);
    expect(listed?.credits).toBe(credits);
  });

  it('upsertSql loads extra entries (e2e fixtures) without touching the reference', async () => {
    await execute(seedSql([entry()]));
    await execute(upsertSql([entry({ sha256: sha('b'), reference: false }), entry({ sha256: sha('c'), reference: false })]));
    const { results } = await local.env.DB.prepare('SELECT sha256, is_reference FROM entrants ORDER BY sha256').all<{ sha256: string; is_reference: number }>();
    expect(results).toEqual([
      { sha256: sha('a'), is_reference: 1 },
      { sha256: sha('b'), is_reference: 0 },
      { sha256: sha('c'), is_reference: 0 },
    ]);
    expect(() => upsertSql([entry({ reference: true })])).toThrow(/reference/);
  });

  it('records where a seed entry came from in its report', async () => {
    await execute(seedSql([entry()]));
    const row = await local.env.DB.prepare('SELECT report, uploader FROM entrants').first<{ report: string; uploader: string | null }>();
    expect(JSON.parse(row!.report)).toMatchObject({ source: 'seed' });
    expect(row!.uploader).toBeNull();
  });
});

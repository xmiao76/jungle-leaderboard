import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployConfigIssues } from './check-deploy-config.mjs';

const REAL_ID = '1f0e7c3a-5b2d-4e8f-9a6c-2d4b8e1f7a90';
const config = (id) => `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "jungle-arena"\ndatabase_id = "${id}"\n`;

describe('deployConfigIssues', () => {
  it('refuses the local placeholder database id', () => {
    expect(deployConfigIssues(config('00000000-0000-0000-0000-000000000000'))).toHaveLength(1);
  });

  it('refuses a config without any database id', () => {
    expect(deployConfigIssues('name = "x"\n')).toHaveLength(1);
  });

  it('accepts a real database id', () => {
    expect(deployConfigIssues(config(REAL_ID))).toEqual([]);
  });

  it('finds the database id in the committed wrangler.toml', () => {
    const committed = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    // Either the placeholder (one issue) or a real id (none): never "no database_id".
    expect(deployConfigIssues(committed).every((issue) => issue.includes('placeholder'))).toBe(true);
  });
});

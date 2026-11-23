import { describe, expect, it } from 'vitest';
import { planRemoval, removalSql, visibilitySql, type ProgramRow } from './program-remove';

const sha = (c: string): string => c.repeat(64);

function program(overrides: Partial<ProgramRow> = {}): ProgramRow {
  return {
    sha256: sha('a'),
    title: 'Muse Jungle',
    gameVersion: '1.2.0',
    model: 'Model-X',
    codeAgent: 'Agent-Y',
    modelPlatform: 'official',
    status: 'listed',
    isReference: false,
    rating: 1000,
    ratedMatches: 0,
    ...overrides,
  };
}

const none = { counted: 0, unrated: 0, voided: 0 };

describe('planRemoval', () => {
  it('plans a plain removal, recomputing only when counted matches exist', () => {
    expect(planRemoval(program(), none, 0, false, 'remove').willRecompute).toBe(false);
    expect(planRemoval(program(), { ...none, unrated: 2 }, 0, false, 'remove').willRecompute).toBe(false);
    expect(planRemoval(program(), { ...none, counted: 1 }, 2, false, 'remove').willRecompute).toBe(true);
  });

  it('never touches the reference opponent, in any mode', () => {
    for (const mode of ['remove', 'hide', 'unhide'] as const) {
      expect(() => planRemoval(program({ isReference: true }), none, 0, false, mode)).toThrow(/reference opponent/);
    }
  });

  it('refuses to hard-delete a seed entry (db:seed would resurrect it) but allows hiding it', () => {
    expect(() => planRemoval(program(), none, 0, true, 'remove')).toThrow(/seed entry/);
    expect(planRemoval(program(), none, 0, true, 'hide').mode).toBe('hide');
  });

  it('rejects redundant visibility changes and malformed hashes', () => {
    expect(() => planRemoval(program({ status: 'hidden' }), none, 0, false, 'hide')).toThrow(/already hidden/);
    expect(() => planRemoval(program(), none, 0, false, 'unhide')).toThrow(/not hidden/);
    expect(() => planRemoval(program({ sha256: "x'; DROP TABLE entrants; --" }), none, 0, false, 'remove')).toThrow(/malformed hash/);
  });
});

describe('removalSql', () => {
  it('deletes in foreign-key order: matches, rating history, then the entrant', () => {
    const sql = removalSql(sha('a'));
    expect(sql.indexOf('DELETE FROM matches')).toBeLessThan(sql.indexOf('DELETE FROM rating_changes'));
    expect(sql.indexOf('DELETE FROM rating_changes')).toBeLessThan(sql.indexOf('DELETE FROM entrants'));
    expect(sql).toContain(`'${sha('a')}'`);
  });

  it('refuses a malformed hash rather than interpolating it', () => {
    expect(() => removalSql('not-a-hash')).toThrow(/malformed hash/);
    expect(() => visibilitySql('not-a-hash', true)).toThrow(/malformed hash/);
  });

  it('hides with a status update and nothing else', () => {
    expect(visibilitySql(sha('b'), true)).toBe(`UPDATE entrants SET status = 'hidden' WHERE sha256 = '${sha('b')}';\n`);
    expect(visibilitySql(sha('b'), false)).toContain(`status = 'listed'`);
  });
});

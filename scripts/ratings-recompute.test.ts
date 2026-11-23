import { describe, expect, it } from 'vitest';
import { replayRatings, type CountedMatch } from '../server/elo';
import { planRecompute, recomputeSql, type EntrantStanding } from './ratings-recompute';
import { parseD1Json } from './wrangler-run';

const sha = (c: string): string => c.repeat(64);
const A = sha('a');
const B = sha('b');

const counted: CountedMatch[] = [
  { left: A, right: B, leftWins: 2, rightWins: 0, draws: 0 },
  { left: B, right: A, leftWins: 1, rightWins: 0, draws: 1 },
];

/** The entrants table exactly as the fold of `counted` leaves it (seq = one per match). */
function consistentEntrants(): EntrantStanding[] {
  const folded = replayRatings(counted);
  return [A, B].map((s) => {
    const f = folded.get(s)!;
    return { sha256: s, rating: f.rating, ratingSeq: f.matches, ratedMatches: f.matches, wins: f.wins, losses: f.losses, draws: f.draws };
  });
}

describe('planRecompute', () => {
  it('finds nothing to do when the stored standings equal the fold', () => {
    expect(planRecompute(consistentEntrants(), counted)).toEqual([]);
  });

  it('corrects a drifted rating and appends the next sequence number, never renumbering', () => {
    const entrants = consistentEntrants().map((e) => (e.sha256 === A ? { ...e, rating: 9999 } : e));
    const plan = planRecompute(entrants, counted);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.sha256).toBe(A);
    expect(plan[0]!.newSeq).toBe(entrants[0]!.ratingSeq + 1);
    expect(plan[0]!.after.rating).toBe(replayRatings(counted).get(A)!.rating);
  });

  it('folds an entrant with no counted matches back to a fresh 1000 after its matches are voided', () => {
    const plan = planRecompute(consistentEntrants(), []);
    expect(plan.map((p) => [p.after.rating, p.after.matches])).toEqual([
      [1000, 0],
      [1000, 0],
    ]);
  });

  it('corrects game counts even when the rating happens to match', () => {
    const entrants = consistentEntrants().map((e) => (e.sha256 === B ? { ...e, wins: e.wins + 1 } : e));
    expect(planRecompute(entrants, counted).map((p) => p.sha256)).toEqual([B]);
  });
});

describe('recomputeSql', () => {
  it('writes the standing, then appends one rating_changes row with a NULL match', () => {
    const sql = recomputeSql(planRecompute(consistentEntrants().map((e) => ({ ...e, rating: 1 })), counted));
    expect(sql).toContain(`UPDATE entrants SET rating = ${replayRatings(counted).get(A)!.rating}, rating_seq = 3,`);
    expect(sql).toContain(`INSERT INTO rating_changes (sha256, seq, match_id, rating_before, rating_after) VALUES ('${A}', 3, NULL, 1,`);
    expect(sql.indexOf('UPDATE entrants')).toBeLessThan(sql.indexOf('INSERT INTO rating_changes'));
    expect(sql).not.toContain('BEGIN');
    expect(sql).not.toContain('DELETE');
  });

  it('refuses a malformed hash rather than interpolating it', () => {
    const plan = planRecompute([{ sha256: "x'; DROP TABLE entrants; --", rating: 1, ratingSeq: 0, ratedMatches: 9, wins: 0, losses: 0, draws: 0 }], []);
    expect(plan).toHaveLength(1);
    expect(() => recomputeSql(plan)).toThrow(/malformed hash/);
  });
});

describe('parseD1Json', () => {
  it('reads the results rows out of the wrangler answer', () => {
    expect(parseD1Json('[{"results":[{"a":1}],"success":true}]')).toEqual([{ a: 1 }]);
  });

  it('rejects output that is not the expected shape', () => {
    expect(() => parseD1Json('no json here')).toThrow(/no JSON array/);
    expect(() => parseD1Json('[{"nope":true}]')).toThrow(/unexpected shape/);
  });
});

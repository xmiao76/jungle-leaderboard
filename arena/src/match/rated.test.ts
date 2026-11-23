import { describe, expect, it } from 'vitest';
import { DEADLINES, DEFAULT_NODE_BUDGET } from '../loader/limits';
import { isRatedSettings, PROVISIONAL_MATCHES, RATED_SETTINGS, ratedEligibility } from './rated';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('rated settings', () => {
  it('are the Arena defaults, so a default match is rated', () => {
    expect(RATED_SETTINGS).toEqual({ difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 5_000 });
    expect(RATED_SETTINGS.nodeBudget).toBe(DEFAULT_NODE_BUDGET);
    expect(RATED_SETTINGS.thinkDeadlineMs).toBe(DEADLINES.think);
    expect(PROVISIONAL_MATCHES).toBe(5);
  });

  it('require all three values exactly', () => {
    expect(isRatedSettings({ difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 5_000 })).toBe(true);
    expect(isRatedSettings({ difficulty: 'medium', nodeBudget: 20_000, thinkDeadlineMs: 5_000 })).toBe(false);
    expect(isRatedSettings({ difficulty: 'hard', nodeBudget: 5_000, thinkDeadlineMs: 5_000 })).toBe(false);
    expect(isRatedSettings({ difficulty: 'hard', nodeBudget: 20_000, thinkDeadlineMs: 2_000 })).toBe(false);
  });
});

describe('ratedEligibility', () => {
  const standard = RATED_SETTINGS;

  it('rates two different published programs at the standard settings', () => {
    expect(ratedEligibility({ left: A, right: B, leftPublished: true, rightPublished: true, settings: standard })).toEqual({ rated: true });
  });

  it('explains why a match is friendly', () => {
    expect(ratedEligibility({ left: A, right: A, leftPublished: true, rightPublished: true, settings: standard })).toEqual({
      rated: false,
      reason: 'A program does not play rated matches against itself.',
    });
    expect(ratedEligibility({ left: A, right: B, leftPublished: false, rightPublished: true, settings: standard })).toEqual({
      rated: false,
      reason: 'Only programs published to the Arena catalog are rated.',
    });
    expect(ratedEligibility({ left: A, right: B, leftPublished: true, rightPublished: true, settings: { ...standard, nodeBudget: 5_000 } })).toEqual({
      rated: false,
      reason: 'Rated matches use hard, 20,000 nodes and 5 s per move.',
    });
  });
});

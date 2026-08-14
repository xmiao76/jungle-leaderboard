import { describe, expect, it } from 'vitest';
import { MODELS } from '../data/models';
import { summarize } from './summary';

describe('summarize', () => {
  it('reports the open/closed split for the published data', () => {
    expect(summarize(MODELS)).toEqual({
      total: 6,
      openCount: 3,
      closedCount: 3,
      hasRecords: false,
    });
  });

  it('reports hasRecords once any entry carries a match record', () => {
    const withRecord = [{ ...MODELS[0]!, record: { wins: 4, losses: 1, draws: 0 } }, MODELS[1]!];

    expect(summarize(withRecord).hasRecords).toBe(true);
  });

  it('handles an empty list without dividing by zero', () => {
    expect(summarize([])).toEqual({ total: 0, openCount: 0, closedCount: 0, hasRecords: false });
  });
});

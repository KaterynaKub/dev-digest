import { describe, it, expect } from 'vitest';
import { foldCycleCost } from '../src/modules/pulls/status.js';

/**
 * The PR list shows ONE cost per PR, folded from the runs of its latest review
 * cycle. The fold has to carry a trust level alongside the total — which is why
 * it is JS and not a SQL `SUM()` (that would silently swallow NULLs).
 */
describe('foldCycleCost', () => {
  it('sums provider-billed runs and stays exact', () => {
    expect(
      foldCycleCost([
        { costUsd: 0.008, costSource: 'exact' },
        { costUsd: 0.006, costSource: 'exact' },
      ]),
    ).toEqual({ usd: 0.014, source: 'exact' });
  });

  it('downgrades to estimated when a run came from the price book', () => {
    const { usd, source } = foldCycleCost([
      { costUsd: 0.008, costSource: 'exact' },
      { costUsd: 0.006, costSource: 'estimated' },
    ]);
    expect(usd).toBeCloseTo(0.014, 10);
    expect(source).toBe('estimated');
  });

  // An unpriced run must not discard what the others cost.
  it('keeps the partial sum as a lower bound when a run has no price', () => {
    expect(
      foldCycleCost([
        { costUsd: 0.008, costSource: 'exact' },
        { costUsd: null, costSource: null },
      ]),
    ).toEqual({ usd: 0.008, source: 'partial' });
  });

  // Incompleteness is contagious: a run that was itself a lower bound makes the
  // whole cycle one too.
  it('propagates a run that was already partial', () => {
    expect(
      foldCycleCost([
        { costUsd: 0.008, costSource: 'exact' },
        { costUsd: 0.002, costSource: 'partial' },
      ]),
    ).toEqual({ usd: 0.01, source: 'partial' });
  });

  it('reports nothing when no run had a price', () => {
    expect(
      foldCycleCost([
        { costUsd: null, costSource: null },
        { costUsd: null, costSource: null },
      ]),
    ).toEqual({ usd: null, source: null });
  });

  it('reports nothing for an empty cycle', () => {
    expect(foldCycleCost([])).toEqual({ usd: null, source: null });
  });

  // Free models bill 0 — a real total, distinct from "unknown".
  it('treats a genuine zero total as known', () => {
    expect(
      foldCycleCost([
        { costUsd: 0, costSource: 'exact' },
        { costUsd: 0, costSource: 'exact' },
      ]),
    ).toEqual({ usd: 0, source: 'exact' });
  });
});

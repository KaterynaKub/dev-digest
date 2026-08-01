import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest } from '../src/index.js';

/**
 * Cost aggregation across chunks.
 *
 * Regression guard for the poison-null bug: a single chunk the price book knew
 * nothing about used to discard the cost of EVERY other chunk, so a review that
 * demonstrably spent money reported nothing at all. The sum must now survive,
 * flagged as a lower bound.
 */
describe('reviewPullRequest — cost aggregation', () => {
  const clean = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };

  /** Two files, so `map-reduce` really issues two LLM calls. */
  function twoFileDiff(): UnifiedDiff {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +1,1 @@',
      '+const a = 1;',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,0 +1,1 @@',
      '+const b = 2;',
    ].join('\n');
    return {
      raw,
      files: [
        {
          path: 'src/a.ts',
          additions: 1,
          deletions: 0,
          hunks: [{ file: 'src/a.ts', oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, newLineNumbers: [1] }],
        },
        {
          path: 'src/b.ts',
          additions: 1,
          deletions: 0,
          hunks: [{ file: 'src/b.ts', oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, newLineNumbers: [1] }],
        },
      ],
    };
  }

  /** Replays one scripted cost per call, in order. */
  function scriptedLlm(
    script: { costUsd: number | null; costSource: 'exact' | 'estimated' | null }[],
  ): LLMProvider {
    let i = 0;
    return {
      id: 'openrouter',
      async completeStructured<T>(): Promise<StructuredResult<T>> {
        const step = script[Math.min(i++, script.length - 1)]!;
        return {
          data: clean as unknown as T,
          model: 'm',
          tokensIn: 10,
          tokensOut: 5,
          costUsd: step.costUsd,
          costSource: step.costSource,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
  }

  async function runWith(
    script: { costUsd: number | null; costSource: 'exact' | 'estimated' | null }[],
  ) {
    return reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: twoFileDiff(),
      llm: scriptedLlm(script),
      strategy: 'map-reduce',
    });
  }

  it('sums provider-billed chunks and keeps them exact', async () => {
    const outcome = await runWith([
      { costUsd: 0.001, costSource: 'exact' },
      { costUsd: 0.002, costSource: 'exact' },
    ]);
    expect(outcome.costUsd).toBeCloseTo(0.003, 10);
    expect(outcome.costSource).toBe('exact');
  });

  it('downgrades to estimated when any chunk came from the price book', async () => {
    const outcome = await runWith([
      { costUsd: 0.001, costSource: 'exact' },
      { costUsd: 0.002, costSource: 'estimated' },
    ]);
    expect(outcome.costUsd).toBeCloseTo(0.003, 10);
    expect(outcome.costSource).toBe('estimated');
  });

  // THE regression guard: an unpriced chunk must not erase the priced one.
  it('keeps the partial sum when a chunk has no price, flagged as a lower bound', async () => {
    const outcome = await runWith([
      { costUsd: 0.001, costSource: 'exact' },
      { costUsd: null, costSource: null },
    ]);
    expect(outcome.costUsd).toBeCloseTo(0.001, 10);
    expect(outcome.costSource).toBe('partial');
  });

  it('reports nothing when no chunk had a price', async () => {
    const outcome = await runWith([
      { costUsd: null, costSource: null },
      { costUsd: null, costSource: null },
    ]);
    expect(outcome.costUsd).toBeNull();
    expect(outcome.costSource).toBeNull();
  });

  // A free model bills 0. That is a real figure, not a missing one — reading it
  // with truthiness instead of `== null` would silently turn it into "unknown".
  it('treats a genuine zero cost as known and exact', async () => {
    const outcome = await runWith([
      { costUsd: 0, costSource: 'exact' },
      { costUsd: 0, costSource: 'exact' },
    ]);
    expect(outcome.costUsd).toBe(0);
    expect(outcome.costSource).toBe('exact');
  });
});

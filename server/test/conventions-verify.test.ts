import { describe, it, expect } from 'vitest';
import type { ConventionExtraction } from '@devdigest/shared';
import {
  verifyCandidates,
  sliceLines,
  numberLines,
  lineCount,
  isDuplicateRule,
  resolveScanModel,
  type SampledFile,
} from '../src/modules/conventions/helpers.js';

/**
 * The evidence gate — the check that decides whether this feature ships
 * hallucinations. Pure: no DB, no git, no LLM, no mocks.
 */

const FILE: SampledFile = {
  path: 'src/api/users.ts',
  // 10 addressable lines; line 5 is deliberately blank.
  content: [
    "import { z } from 'zod';", // 1
    '', // 2
    'export async function getUser(id: string) {', // 3
    '  const user = await db.users.find(id);', // 4
    '', // 5
    '  return user;', // 6
    '}', // 7
    '', // 8
    'export const schema = z.object({});', // 9
    'export default getUser;', // 10
  ].join('\n'),
};

function candidate(over: Partial<ConventionExtraction> = {}): ConventionExtraction {
  return {
    category: 'Validation',
    rule: 'Validate every HTTP request body with a zod schema',
    evidence_path: 'src/api/users.ts',
    evidence_start_line: 3,
    evidence_end_line: 6,
    confidence: 0.9,
    ...over,
  };
}

describe('sliceLines', () => {
  it('slices a 1-based inclusive range', () => {
    expect(sliceLines(FILE.content, 3, 4)).toBe(
      'export async function getUser(id: string) {\n  const user = await db.users.find(id);',
    );
  });

  it('handles the first line, the last line and a single line', () => {
    expect(sliceLines(FILE.content, 1, 1)).toBe("import { z } from 'zod';");
    expect(sliceLines(FILE.content, 10, 10)).toBe('export default getUser;');
    expect(sliceLines(FILE.content, 9, 9)).toBe('export const schema = z.object({});');
  });

  it('returns "" for out-of-range, inverted and non-integer input', () => {
    expect(sliceLines(FILE.content, 11, 12)).toBe('');
    expect(sliceLines(FILE.content, 0, 3)).toBe('');
    expect(sliceLines(FILE.content, 5, 2)).toBe('');
    expect(sliceLines(FILE.content, 1.5, 3)).toBe('');
  });

  it('clamps an end that runs past the file instead of padding', () => {
    expect(sliceLines(FILE.content, 9, 99)).toBe(
      'export const schema = z.object({});\nexport default getUser;',
    );
  });
});

describe('lineCount', () => {
  it('does not count a trailing newline as a phantom line', () => {
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
  });

  it('tolerates CRLF', () => {
    expect(lineCount('a\r\nb\r\n')).toBe(2);
  });
});

describe('numberLines', () => {
  it('prefixes each line with its 1-based number', () => {
    // Width is 1 here, so there is nothing to pad.
    expect(numberLines('alpha\nbeta')).toBe('1| alpha\n2| beta');
  });

  it('keeps the column aligned across the 9 → 10 boundary', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    const out = numberLines(lines).split('\n');
    expect(out[8]).toBe(' 9| l9');
    expect(out[9]).toBe('10| l10');
  });

  it('keeps the column aligned across the 99 → 100 boundary', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `l${i + 1}`).join('\n');
    const out = numberLines(lines).split('\n');
    expect(out[98]).toBe(' 99| l99');
    expect(out[99]).toBe('100| l100');
  });

  it('returns "" for empty content', () => {
    expect(numberLines('')).toBe('');
  });
});

describe('isDuplicateRule', () => {
  it('matches the same rule with different punctuation and case', () => {
    expect(isDuplicateRule('Use async/await, not .then()', 'use async await not then')).toBe(true);
  });

  it('does not match two genuinely different rules', () => {
    expect(isDuplicateRule('Use zod at the HTTP boundary', 'Use async/await')).toBe(false);
  });
});

describe('verifyCandidates', () => {
  it('keeps a candidate whose file was sampled and whose range is in bounds', () => {
    const { kept, dropped } = verifyCandidates([candidate()], [FILE]);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidencePath).toBe('src/api/users.ts');
    expect(kept[0]!.confidence).toBe(0.9);
  });

  it('slices the snippet off disk, ignoring anything the model claimed', () => {
    const { kept } = verifyCandidates([candidate()], [FILE]);
    // Ground truth: exactly what sliceLines returns for the cited range.
    expect(kept[0]!.evidenceSnippet).toBe(sliceLines(FILE.content, 3, 6));
    expect(kept[0]!.evidenceSnippet).toContain('const user = await db.users.find(id);');
  });

  it('drops a candidate citing a file that was never sampled', () => {
    const c = candidate({ evidence_path: 'src/lib/imaginary.ts' });
    const { kept, dropped } = verifyCandidates([c], [FILE]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('src/lib/imaginary.ts');
  });

  it('does NOT resolve a path by suffix — a wrong users.ts is still wrong', () => {
    const c = candidate({ evidence_path: 'users.ts' });
    const { kept } = verifyCandidates([c], [FILE]);
    expect(kept).toHaveLength(0);
  });

  it('drops a candidate whose end line runs past the file (the core case)', () => {
    const c = candidate({ evidence_start_line: 230, evidence_end_line: 245 });
    const { kept, dropped } = verifyCandidates([c], [FILE]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('has only 10');
  });

  it('drops inverted and zero-based ranges', () => {
    const inverted = candidate({ evidence_start_line: 6, evidence_end_line: 3 });
    const zero = candidate({ evidence_start_line: 0, evidence_end_line: 3 });
    expect(verifyCandidates([inverted], [FILE]).kept).toHaveLength(0);
    expect(verifyCandidates([zero], [FILE]).kept).toHaveLength(0);
  });

  it('drops a range wider than the evidence cap', () => {
    const big = { path: 'src/big.ts', content: Array.from({ length: 200 }, (_, i) => `l${i}`).join('\n') };
    const c = candidate({ evidence_path: 'src/big.ts', evidence_start_line: 1, evidence_end_line: 120 });
    const { kept, dropped } = verifyCandidates([c], [big]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('spans more than');
  });

  it('drops a range that lands only on blank lines', () => {
    const c = candidate({ evidence_start_line: 5, evidence_end_line: 5 });
    const { kept, dropped } = verifyCandidates([c], [FILE]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('blank');
  });

  it('drops a candidate against an empty file (the MockGitClient "" case)', () => {
    const empty: SampledFile = { path: 'src/empty.ts', content: '' };
    const c = candidate({ evidence_path: 'src/empty.ts', evidence_start_line: 1, evidence_end_line: 2 });
    const { kept, dropped } = verifyCandidates([c], [empty]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('empty file');
  });

  it('drops a rule too short to carry information', () => {
    const c = candidate({ rule: 'do it' });
    const { kept, dropped } = verifyCandidates([c], [FILE]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('too short');
  });

  it('drops the second of two near-duplicate rules in one batch', () => {
    const first = candidate({ rule: 'Use async/await instead of .then() chains' });
    const second = candidate({ rule: 'use async await instead of then chains!!' });
    const { kept, dropped } = verifyCandidates([first, second], [FILE]);
    expect(kept).toHaveLength(1);
    expect(dropped[0]!.reason).toContain('duplicate');
  });

  it('keeps the good candidate and drops the hallucinated one, together', () => {
    const good = candidate();
    const bad = candidate({
      rule: 'Redis access goes through a singleton',
      evidence_path: 'src/lib/redis.ts',
    });
    const { kept, dropped } = verifyCandidates([good, bad], [FILE]);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(kept[0]!.rule).toBe(good.rule);
  });

  it('returns empty results for an empty candidate list', () => {
    expect(verifyCandidates([], [FILE])).toEqual({ kept: [], dropped: [] });
  });
});

describe('resolveScanModel', () => {
  const override = { provider: 'openai' as const, model: 'gpt-4.1' };
  const fallback = { provider: 'openrouter' as const, model: 'deepseek/deepseek-v4-flash' };

  it('prefers a complete per-scan request over everything else', () => {
    const out = resolveScanModel({ provider: 'anthropic', model: 'claude-x' }, override, fallback);
    expect(out).toEqual({ provider: 'anthropic', model: 'claude-x' });
  });

  it('ignores a PARTIAL request rather than mixing it with the override', () => {
    expect(resolveScanModel({ model: 'claude-x' }, override, fallback)).toEqual(override);
    expect(resolveScanModel({ provider: 'anthropic' }, override, fallback)).toEqual(override);
  });

  it('falls back to the workspace override, then to the module default', () => {
    expect(resolveScanModel(undefined, override, fallback)).toEqual(override);
    expect(resolveScanModel(undefined, undefined, fallback)).toEqual(fallback);
    expect(resolveScanModel({}, undefined, fallback)).toEqual(fallback);
  });
});

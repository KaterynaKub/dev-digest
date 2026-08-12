import { describe, it, expect } from 'vitest';
import {
  compactFinding,
  deriveVerdict,
  normalizeRepo,
  toMcpAgent,
  truncateFindings,
  type FindingLike,
} from '../src/modules/mcp-tools/helpers.js';
import { RATIONALE_MAX_CHARS } from '../src/modules/mcp-tools/constants.js';

function finding(overrides: Partial<FindingLike> = {}): FindingLike {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'Off-by-one',
    file: 'src/a.ts',
    start_line: 12,
    end_line: 18,
    rationale: 'The loop reads one element past the end of the array.',
    ...overrides,
  };
}

describe('compactFinding', () => {
  it('returns exactly 6 fields', () => {
    const out = compactFinding(finding());
    expect(Object.keys(out).sort()).toEqual(
      ['category', 'file', 'lines', 'rationale', 'severity', 'title'].sort(),
    );
  });

  it('does not carry evidence or trifecta_components', () => {
    const out = compactFinding(finding()) as Record<string, unknown>;
    expect(out.evidence).toBeUndefined();
    expect(out.trifecta_components).toBeUndefined();
  });

  it('formats lines as "start-end"', () => {
    const out = compactFinding(finding({ start_line: 12, end_line: 18 }));
    expect(out.lines).toBe('12-18');
  });

  it('leaves a short rationale untouched', () => {
    const out = compactFinding(finding({ rationale: 'short' }));
    expect(out.rationale).toBe('short');
  });

  it('truncates rationale beyond RATIONALE_MAX_CHARS with an ellipsis', () => {
    const long = 'x'.repeat(RATIONALE_MAX_CHARS + 50);
    const out = compactFinding(finding({ rationale: long }));
    expect(out.rationale.length).toBe(RATIONALE_MAX_CHARS + 1); // + '…'
    expect(out.rationale.endsWith('…')).toBe(true);
  });

  it('does not truncate a rationale exactly at the limit', () => {
    const exact = 'x'.repeat(RATIONALE_MAX_CHARS);
    const out = compactFinding(finding({ rationale: exact }));
    expect(out.rationale).toBe(exact);
    expect(out.rationale.endsWith('…')).toBe(false);
  });
});

describe('toMcpAgent', () => {
  it('maps to exactly 5 fields, dropping system_prompt/output_schema/timestamps/workspace_id', () => {
    const row = {
      id: 'a1',
      name: 'Reviewer',
      provider: 'openai',
      model: 'gpt-5',
      enabled: true,
      systemPrompt: 'be strict',
      outputSchema: {},
      workspaceId: 'ws1',
      createdAt: new Date(),
    };
    const out = toMcpAgent(row);
    expect(Object.keys(out).sort()).toEqual(['enabled', 'id', 'model', 'name', 'provider'].sort());
    expect(out).toEqual({ id: 'a1', name: 'Reviewer', provider: 'openai', model: 'gpt-5', enabled: true });
  });
});

describe('deriveVerdict', () => {
  it('is "clean" with zero findings', () => {
    expect(deriveVerdict([], 'critical')).toBe('clean');
  });

  it('is "blocked" when a finding trips the agent gate', () => {
    expect(deriveVerdict([finding({ severity: 'CRITICAL' })], 'critical')).toBe('blocked');
  });

  it('is "concerns" when findings exist but none trip the gate', () => {
    expect(deriveVerdict([finding({ severity: 'SUGGESTION' })], 'critical')).toBe('concerns');
  });

  it('ignores a self-reported verdict — only severities vs the gate matter', () => {
    // No `verdict` field exists on FindingLike at all — this test documents
    // that deriveVerdict has no way to read one, by construction.
    const findings = [finding({ severity: 'WARNING' })];
    expect(deriveVerdict(findings, 'warning')).toBe('blocked');
    expect(deriveVerdict(findings, 'critical')).toBe('concerns');
  });
});

describe('truncateFindings', () => {
  const many = Array.from({ length: 25 }, (_, i) => compactFinding(finding({ title: `f${i}` })));

  it('forms a note when total exceeds the limit', () => {
    const out = truncateFindings(many, 20);
    expect(out.shown).toHaveLength(20);
    expect(out.total).toBe(25);
    expect(out.note).toBeDefined();
    expect(out.note).toContain('20');
    expect(out.note).toContain('25');
  });

  it('does not form a note when total equals the limit', () => {
    const exact = many.slice(0, 20);
    const out = truncateFindings(exact, 20);
    expect(out.shown).toHaveLength(20);
    expect(out.total).toBe(20);
    expect(out.note).toBeUndefined();
  });

  it('does not form a note when total is below the limit', () => {
    const out = truncateFindings(many.slice(0, 5), 20);
    expect(out.note).toBeUndefined();
  });
});

describe('normalizeRepo', () => {
  const cases: [string, string | undefined][] = [
    ['owner/name', 'owner/name'],
    ['https://github.com/owner/name', 'owner/name'],
    ['github.com/owner/name', 'owner/name'],
    ['https://github.com/owner/name/pull/42', 'owner/name'],
    ['https://github.com/owner/name.git', 'owner/name'],
    ['https://github.com/owner/name/', 'owner/name'],
    ['payments-api', undefined],
    ['', undefined],
  ];

  it.each(cases)('normalizeRepo(%j) -> %j', (input, expected) => {
    expect(normalizeRepo(input)).toBe(expected);
  });
});

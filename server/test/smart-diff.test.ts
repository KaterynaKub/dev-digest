import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  buildSmartDiff,
  buildSplitSuggestion,
  classifyPath,
  isLargeFile,
  marksForFile,
  selectCycleFindings,
  sortWithinGroup,
  type FindingLike,
} from '../src/modules/smart-diff/helpers.js';
import {
  LARGE_FILE_LINES_THRESHOLD,
  MIN_LINES_FOR_GENERATED_GUESS,
} from '../src/modules/smart-diff/constants.js';

/** Mirrors client/src/components/diff-viewer/constants.ts#AUTO_EXPAND_MAX_LINES
 *  (not importable here — client/server are separate packages). */
const AUTO_EXPAND_MAX_LINES_REFERENCE = 200;

/**
 * 0005a — pure helpers, no DB, no mocks. Mirrors the classification table and
 * acceptance criteria in specs/0005a-smart-diff-server.md.
 */

function finding(overrides: Partial<FindingLike> = {}): FindingLike {
  return {
    id: 'f1',
    file: 'a.ts',
    startLine: 10,
    severity: 'WARNING',
    reviewId: 'r1',
    agentId: 'agent-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('classifyPath — boilerplate', () => {
  it('a lockfile is boilerplate', () => {
    expect(classifyPath('pnpm-lock.yaml', 5000, 4000)).toBe('boilerplate');
  });

  it('a dist/ build output is boilerplate', () => {
    expect(classifyPath('dist/index.js', 10, 0)).toBe('boilerplate');
  });

  it('a *.generated.* file is boilerplate', () => {
    expect(classifyPath('src/api.generated.ts', 10, 0)).toBe('boilerplate');
  });

  it('a migration is boilerplate', () => {
    expect(classifyPath('src/db/migrations/0001_init.sql', 200, 0)).toBe('boilerplate');
  });

  it('a .snap file is boilerplate', () => {
    expect(classifyPath('src/__snapshots__/x.snap', 100, 0)).toBe('boilerplate');
  });

  it('a binary asset is boilerplate', () => {
    expect(classifyPath('assets/logo.png', 0, 0)).toBe('boilerplate');
  });
});

describe('classifyPath — wiring', () => {
  it('a CI workflow file is wiring', () => {
    expect(classifyPath('.github/workflows/ci.yml', 20, 0)).toBe('wiring');
  });

  it('a *.config.* file is wiring', () => {
    expect(classifyPath('vite.config.ts', 20, 0)).toBe('wiring');
  });

  it('package.json is wiring', () => {
    expect(classifyPath('package.json', 5, 0)).toBe('wiring');
  });

  it('.env.example is wiring', () => {
    expect(classifyPath('.env.example', 3, 0)).toBe('wiring');
  });

  it('routes.ts is wiring', () => {
    expect(classifyPath('src/modules/foo/routes.ts', 50, 10)).toBe('wiring');
  });

  it('a small index.ts (barrel) is wiring', () => {
    expect(classifyPath('src/modules/foo/index.ts', 10, 5)).toBe('wiring');
  });

  it('a locale JSON file is wiring', () => {
    expect(classifyPath('client/messages/en/foo.json', 10, 0)).toBe('wiring');
  });
});

describe('classifyPath — core', () => {
  it('a service file is core', () => {
    expect(classifyPath('src/modules/foo/service.ts', 50, 10)).toBe('core');
  });

  it('a .py file is core', () => {
    expect(classifyPath('scripts/build.py', 20, 5)).toBe('core');
  });

  it('a test file is core', () => {
    expect(classifyPath('foo.test.ts', 40, 2)).toBe('core');
  });

  it('README.md is core', () => {
    expect(classifyPath('README.md', 10, 0)).toBe('core');
  });

  it('a small file with an unknown extension is core', () => {
    expect(classifyPath('src/weird.xyz', 5, 1)).toBe('core');
  });
});

describe('classifyPath — negative matches (the endsWith bug class)', () => {
  it('mylock.json is NOT a lockfile', () => {
    expect(classifyPath('mylock.json', 10, 0)).not.toBe('boilerplate');
  });

  it('distribution/a.ts is NOT boilerplate', () => {
    expect(classifyPath('distribution/a.ts', 10, 0)).not.toBe('boilerplate');
  });

  it('myvendor/a.ts is NOT boilerplate', () => {
    expect(classifyPath('myvendor/a.ts', 10, 0)).not.toBe('boilerplate');
  });
});

describe('classifyPath — barrel size guard', () => {
  it('a 300-line index.ts is core, not wiring', () => {
    expect(classifyPath('src/modules/foo/index.ts', 200, 100)).toBe('core');
  });
});

describe('classifyPath — rule 6 (size-based catch-all)', () => {
  it('a 900-line data.bin is boilerplate', () => {
    expect(classifyPath('data.bin', 500, 400)).toBe('boilerplate');
  });

  it('a 900-line service.ts is core', () => {
    expect(classifyPath('src/modules/foo/service.ts', 500, 400)).toBe('core');
  });
});

describe('classifyPath — first-match-wins', () => {
  it('dist/next.config.js is boilerplate (rule 2 before rule 8)', () => {
    expect(classifyPath('dist/next.config.js', 10, 0)).toBe('boilerplate');
  });
});

describe('isLargeFile', () => {
  it('299 lines is false', () => {
    expect(isLargeFile(200, 99)).toBe(false);
  });

  it('300 lines is true', () => {
    expect(isLargeFile(200, 100)).toBe(true);
  });

  it('150+151 is true', () => {
    expect(isLargeFile(150, 151)).toBe(true);
  });

  it('threshold sits strictly between the client AUTO_EXPAND_MAX_LINES and MIN_LINES_FOR_GENERATED_GUESS', () => {
    expect(LARGE_FILE_LINES_THRESHOLD).toBeGreaterThan(AUTO_EXPAND_MAX_LINES_REFERENCE);
    expect(LARGE_FILE_LINES_THRESHOLD).toBeLessThan(MIN_LINES_FOR_GENERATED_GUESS);
  });
});

describe('sortWithinGroup', () => {
  const base = { additions: 10, deletions: 0, finding_lines: [] };

  it('severity order holds regardless of churn', () => {
    const files = [
      { ...base, path: 'a.ts', additions: 500, finding_marks: [{ line: 1, severity: 'SUGGESTION' as const, finding_id: 'f1', review_id: 'r1' }] },
      { ...base, path: 'b.ts', additions: 5, finding_marks: [{ line: 1, severity: 'CRITICAL' as const, finding_id: 'f2', review_id: 'r1' }] },
    ];
    const sorted = sortWithinGroup(files);
    expect(sorted[0]!.path).toBe('b.ts'); // CRITICAL wins despite less churn
  });

  it('identical files sort by path', () => {
    const files = [
      { ...base, path: 'z.ts', finding_marks: null },
      { ...base, path: 'a.ts', finding_marks: null },
    ];
    const sorted = sortWithinGroup(files);
    expect(sorted.map((f) => f.path)).toEqual(['a.ts', 'z.ts']);
  });

  it('the same input shuffled yields identical output (determinism proof)', () => {
    const files = [
      { ...base, path: 'c.ts', additions: 10, finding_marks: null },
      { ...base, path: 'a.ts', additions: 300, finding_marks: [{ line: 1, severity: 'WARNING' as const, finding_id: 'f1', review_id: 'r1' }] },
      { ...base, path: 'b.ts', additions: 5, finding_marks: null },
      { ...base, path: 'd.ts', additions: 5, finding_marks: [{ line: 2, severity: 'CRITICAL' as const, finding_id: 'f2', review_id: 'r1' }] },
    ];
    const shuffled = [files[2]!, files[0]!, files[3]!, files[1]!];
    const sorted1 = sortWithinGroup(files);
    const sorted2 = sortWithinGroup(shuffled);
    expect(sorted2.map((f) => f.path)).toEqual(sorted1.map((f) => f.path));
  });
});

describe('selectCycleFindings', () => {
  it('two agents 1 minute apart both count', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const oneMinBefore = new Date('2026-01-01T00:09:00Z');
    const rows = [
      finding({ id: 'f1', agentId: 'agent-1', reviewId: 'r1', createdAt: now }),
      finding({ id: 'f2', agentId: 'agent-2', reviewId: 'r2', createdAt: oneMinBefore, file: 'b.ts' }),
    ];
    const kept = selectCycleFindings(rows);
    expect(kept.map((r) => r.id).sort()).toEqual(['f1', 'f2']);
  });

  it('a 2-hour-old review is dropped', () => {
    const now = new Date('2026-01-01T02:00:00Z');
    const twoHoursBefore = new Date('2026-01-01T00:00:00Z');
    const rows = [
      finding({ id: 'f1', agentId: 'agent-1', reviewId: 'r1', createdAt: now }),
      finding({ id: 'f2', agentId: 'agent-2', reviewId: 'r2', createdAt: twoHoursBefore, file: 'b.ts' }),
    ];
    const kept = selectCycleFindings(rows);
    expect(kept.map((r) => r.id)).toEqual(['f1']);
  });

  it('same agent keeps only the newer review', () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-01-01T00:05:00Z');
    const rows = [
      finding({ id: 'f1', agentId: 'agent-1', reviewId: 'r-old', createdAt: older, startLine: 1 }),
      finding({ id: 'f2', agentId: 'agent-1', reviewId: 'r-new', createdAt: newer, startLine: 2 }),
    ];
    const kept = selectCycleFindings(rows);
    expect(kept.map((r) => r.id)).toEqual(['f2']);
  });

  it('duplicates collapse (file, start_line, severity)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const rows = [
      finding({ id: 'f1', reviewId: 'r1', agentId: 'agent-1', createdAt: now, file: 'a.ts', startLine: 5, severity: 'WARNING' }),
      finding({ id: 'f2', reviewId: 'r1', agentId: 'agent-1', createdAt: now, file: 'a.ts', startLine: 5, severity: 'WARNING' }),
    ];
    const kept = selectCycleFindings(rows);
    expect(kept).toHaveLength(1);
  });
});

describe('marksForFile', () => {
  it('finding_lines is deduped and ascending', () => {
    const findings = [
      finding({ id: 'f1', file: 'a.ts', startLine: 20 }),
      finding({ id: 'f2', file: 'a.ts', startLine: 5 }),
      finding({ id: 'f3', file: 'a.ts', startLine: 5, severity: 'CRITICAL' }),
    ];
    const { lines } = marksForFile('a.ts', findings);
    expect(lines).toEqual([5, 20]);
  });

  it('finding_count counts two findings on one line', () => {
    const findings = [
      finding({ id: 'f1', file: 'a.ts', startLine: 5, severity: 'WARNING' }),
      finding({ id: 'f2', file: 'a.ts', startLine: 5, severity: 'CRITICAL' }),
    ];
    const { count } = marksForFile('a.ts', findings);
    expect(count).toBe(2);
  });

  it('marks are capped while count stays uncapped', () => {
    const findings = Array.from({ length: 60 }, (_, i) =>
      finding({ id: `f${i}`, file: 'a.ts', startLine: i }),
    );
    const { marks, count } = marksForFile('a.ts', findings);
    expect(marks.length).toBe(50);
    expect(count).toBe(60);
  });
});

describe('buildSplitSuggestion', () => {
  it('false at 399 lines / 14 files', () => {
    const files = Array.from({ length: 14 }, (_, i) => ({
      path: `src/f${i}.ts`,
      additions: Math.floor(399 / 14),
      deletions: 0,
      role: 'core' as const,
    }));
    // Force exact 399 total.
    const total = files.reduce((s, f) => s + f.additions, 0);
    files[0]!.additions += 399 - total;
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(false);
  });

  it('true at 400 lines / 15 files', () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      path: `src/f${i}.ts`,
      additions: 1,
      deletions: 0,
      role: 'core' as const,
    }));
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(true);
  });

  it('a 5000-line lockfile alone does not trigger it', () => {
    const files = [{ path: 'pnpm-lock.yaml', additions: 5000, deletions: 0, role: 'boilerplate' as const }];
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(false);
    expect(result.total_lines).toBe(5000);
  });
});

describe('buildSmartDiff', () => {
  it('emits three groups in GROUP_ORDER including empty ones, and parses against SmartDiff', () => {
    const files = [
      { path: 'src/modules/foo/service.ts', additions: 50, deletions: 10 }, // core
      { path: 'src/modules/foo/routes.ts', additions: 20, deletions: 5 }, // wiring
    ];
    const result = buildSmartDiff(files, []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(result.groups.find((g) => g.role === 'boilerplate')!.files).toEqual([]);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('never assigns pseudocode_summary', () => {
    const result = buildSmartDiff([{ path: 'a.ts', additions: 1, deletions: 0 }], []);
    const file = result.groups[0]!.files[0]!;
    expect('pseudocode_summary' in file).toBe(false);
  });

  it('two consecutive calls yield a byte-identical SmartDiff', () => {
    const files = [
      { path: 'z.ts', additions: 10, deletions: 0 },
      { path: 'a.ts', additions: 300, deletions: 0 },
      { path: 'pnpm-lock.yaml', additions: 500, deletions: 0 },
    ];
    const findings = [finding({ id: 'f1', file: 'a.ts' })];
    const r1 = buildSmartDiff(files, findings);
    const r2 = buildSmartDiff(files, findings);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DepCruiseGraph } from '../src/adapters/depgraph/index.js';

/**
 * Regression: `toRel` used to return `path.relative`'s output verbatim, which
 * carries PLATFORM separators. On Windows that yields `src\a.ts`, while the
 * `files` list handed in (and everything stored in `symbols.path` /
 * `file_edges.from_file`, normalised by pipeline/walk.ts) uses forward slashes.
 *
 * The mismatch made every `fileSet.has(...)` guard in `buildEdges` reject its
 * module, so the cruise returned ZERO edges — silently. No throw meant no
 * `graphFailed`, so the index was still stamped 'full' while `file_edges` sat
 * empty; `resolveReferences` JOINs that table, so no reference ever resolved
 * and blast radius reported 0 callers for every symbol on an index that looked
 * healthy.
 *
 * These tests therefore assert on SEPARATORS and on edges being found at all —
 * a green `buildEdges` that returns `[]` is exactly the failure mode.
 */
describe('depgraph adapter — repo-relative path normalisation', () => {
  /**
   * The fixture lives UNDER the package (not in os.tmpdir()) on purpose:
   * dependency-cruiser resolves its inputs against `process.cwd()`, so a
   * fixture on another drive/root produces an ENOENT on a mangled path
   * (`<cwd>\C:\Users\...`) rather than exercising the adapter. The real
   * indexer always cruises a clone inside the repo, so this matches production.
   */
  function makeFixture(): string {
    const root = mkdtempSync(join(process.cwd(), 'depgraph-fixture-'));
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    writeFileSync(join(root, 'src', 'dep.ts'), 'export const dep = 1;\n');
    writeFileSync(
      join(root, 'src', 'nested', 'entry.ts'),
      "import { dep } from '../dep.js';\nexport const entry = dep;\n",
    );
    return root;
  }

  it('finds a nested local import edge and emits POSIX separators', async () => {
    const root = makeFixture();
    try {
      const files = ['src/dep.ts', 'src/nested/entry.ts'];
      const edges = await new DepCruiseGraph().buildEdges(root, files);

      // The core assertion: the edge is found at all. Pre-fix this was [].
      expect(edges.length).toBeGreaterThan(0);

      for (const e of edges) {
        expect(e.from).not.toContain('\\');
        expect(e.to).not.toContain('\\');
      }

      expect(edges).toContainEqual({ from: 'src/nested/entry.ts', to: 'src/dep.ts' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits only paths that are members of the input file set', async () => {
    const root = makeFixture();
    try {
      const files = ['src/dep.ts', 'src/nested/entry.ts'];
      const fileSet = new Set(files);
      const edges = await new DepCruiseGraph().buildEdges(root, files);

      // Guards must accept real members, not just reject everything — an empty
      // result would vacuously satisfy this, hence the length check above.
      for (const e of edges) {
        expect(fileSet.has(e.from)).toBe(true);
        expect(fileSet.has(e.to)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades to [] on an empty file list without throwing', async () => {
    const edges = await new DepCruiseGraph().buildEdges(process.cwd(), []);
    expect(edges).toEqual([]);
  });
});

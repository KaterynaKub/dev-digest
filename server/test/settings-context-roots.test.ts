import { describe, it, expect } from 'vitest';
import { ContextRoot, ContextRoots } from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import { readContextRoots, DEFAULT_CONTEXT_ROOTS } from '../src/modules/settings/feature-models.js';

/**
 * Hermetic coverage for `readContextRoots`'s fail-safe parsing (AC-46/AC-54)
 * and the `ContextRoot`/`ContextRoots` schema it relies on (AC-47/NFR-18).
 * Mirrors `readLinkAllowlist`'s shape (same file), but the two are NOT
 * interchangeable: `readLinkAllowlist` fails CLOSED (empty array) while
 * `readContextRoots` fails OPEN (`DEFAULT_CONTEXT_ROOTS`) and additionally
 * distinguishes "no value was ever stored" (`rejected: false`) from "a stored
 * value failed validation" (`rejected: true`) — that distinction is the whole
 * point of AC-54 and the easiest thing for a refactor to collapse.
 */

/** A minimal stand-in for `container.db`'s drizzle chain: `.select().from().where()`
 *  resolves to the given rows, exactly as `readContextRoots` calls it. */
function fakeContainer(rows: Array<{ key: string; value: unknown }>): Container {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return { db: chain } as unknown as Container;
}

const WORKSPACE_ID = 'ws-1';

describe('readContextRoots — fail-safe parsing (AC-46/AC-54)', () => {
  it('a valid stored value is returned verbatim, rejected:false', async () => {
    const container = fakeContainer([{ key: 'context_roots', value: ['rfc/', 'docs/adr'] }]);
    const result = await readContextRoots(container, WORKSPACE_ID);
    expect(result).toEqual({ roots: ['rfc/', 'docs/adr'], rejected: false });
  });

  it('no stored value (unconfigured workspace) → defaults, rejected:false (AC-46)', async () => {
    const container = fakeContainer([]);
    const result = await readContextRoots(container, WORKSPACE_ID);
    expect(result).toEqual({ roots: DEFAULT_CONTEXT_ROOTS, rejected: false });
  });

  it('an invalid stored value fails OPEN to defaults, but rejected:true (AC-54)', async () => {
    const container = fakeContainer([{ key: 'context_roots', value: ['../etc'] }]);
    const result = await readContextRoots(container, WORKSPACE_ID);
    expect(result.roots).toEqual(DEFAULT_CONTEXT_ROOTS);
    expect(result.rejected).toBe(true);
  });

  it('a stored value of the wrong shape (not an array) also fails open with rejected:true', async () => {
    const container = fakeContainer([{ key: 'context_roots', value: 'specs/' }]);
    const result = await readContextRoots(container, WORKSPACE_ID);
    expect(result.roots).toEqual(DEFAULT_CONTEXT_ROOTS);
    expect(result.rejected).toBe(true);
  });

  it('an empty stored array is invalid (min 1) and is rejected, not silently accepted', async () => {
    const container = fakeContainer([{ key: 'context_roots', value: [] }]);
    const result = await readContextRoots(container, WORKSPACE_ID);
    expect(result.roots).toEqual(DEFAULT_CONTEXT_ROOTS);
    expect(result.rejected).toBe(true);
  });

  it('"rejected" vs "unset" is a real distinction, not two labels for one branch', async () => {
    // Same fallback roots either way — the only observable difference is the flag.
    const unset = await readContextRoots(fakeContainer([]), WORKSPACE_ID);
    const rejected = await readContextRoots(
      fakeContainer([{ key: 'context_roots', value: ['C:/x'] }]),
      WORKSPACE_ID,
    );
    expect(unset.roots).toEqual(rejected.roots);
    expect(unset.rejected).toBe(false);
    expect(rejected.rejected).toBe(true);
  });
});

describe('ContextRoot schema — traversal/absolute-path rejection (AC-47/NFR-18)', () => {
  it.each([
    ['../etc', 'leading traversal segment'],
    ['a/../b', 'traversal segment mid-path'],
    ['/etc', 'unix-absolute path'],
    ['C:/x', 'windows-absolute path'],
    ['C:\\x', 'windows-absolute path with backslash'],
    ['specs\\notes', 'backslash path separator'],
    ['.', 'single "." segment'],
    ['specs/.', 'trailing "." segment'],
    ['..', 'single ".." segment'],
  ])('rejects %s (%s)', (value) => {
    expect(ContextRoot.safeParse(value).success).toBe(false);
  });

  it.each([
    ['specs/', 'trailing-slash root'],
    ['docs/', 'trailing-slash root'],
    ['insights/', 'trailing-slash root'],
    ['docs/adr', 'nested root, no trailing slash'],
    ['rfc/', 'custom root'],
  ])('accepts %s (%s)', (value) => {
    expect(ContextRoot.safeParse(value).success).toBe(true);
  });
});

describe('ContextRoots schema — array bounds', () => {
  it('rejects an empty array (min 1 — listing must always have scope)', () => {
    expect(ContextRoots.safeParse([]).success).toBe(false);
  });

  it('accepts exactly 20 entries and rejects 21 (max 20)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `root-${i}/`);
    expect(ContextRoots.safeParse(twenty).success).toBe(true);
    const twentyOne = [...twenty, 'root-20/'];
    expect(ContextRoots.safeParse(twentyOne).success).toBe(false);
  });

  it('rejects the array if even one entry is invalid', () => {
    expect(ContextRoots.safeParse(['specs/', '../etc']).success).toBe(false);
  });
});

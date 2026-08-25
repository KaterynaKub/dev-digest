import { describe, it, expect } from 'vitest';
import {
  isContainedPath,
  matchRoot,
  dedupeByPath,
  buildStatusLine,
} from '../src/modules/project-context/helpers.js';

/**
 * Hermetic coverage for the project-context module's pure helpers: the
 * containment guard (AC-47/NFR-18), root matching (AC-64), path dedup, and
 * status-line assembly across every AC-3/AC-57…AC-63 state.
 */

describe('isContainedPath', () => {
  it('accepts a plain repo-relative path', () => {
    expect(isContainedPath('specs/0001-foo.md')).toBe(true);
    expect(isContainedPath('docs/adr/0001.md')).toBe(true);
  });

  it('rejects a ".." segment anywhere in the path', () => {
    expect(isContainedPath('../etc/passwd')).toBe(false);
    expect(isContainedPath('specs/../../etc/passwd')).toBe(false);
    expect(isContainedPath('specs/..')).toBe(false);
  });

  it('rejects a leading "/" (absolute unix path)', () => {
    expect(isContainedPath('/etc/passwd')).toBe(false);
  });

  it('rejects a Windows-absolute path', () => {
    expect(isContainedPath('C:\\Windows\\System32\\config')).toBe(false);
    expect(isContainedPath('C:/Windows/System32/config')).toBe(false);
  });

  it('rejects a backslash segment', () => {
    expect(isContainedPath('specs\\..\\..\\etc')).toBe(false);
    expect(isContainedPath('docs\\notes.md')).toBe(false);
  });

  it('rejects an empty path and a "." segment', () => {
    expect(isContainedPath('')).toBe(false);
    expect(isContainedPath('specs/./x.md')).toBe(false);
  });
});

describe('matchRoot', () => {
  it('returns the first configured root a path falls under', () => {
    expect(matchRoot('specs/0001-foo.md', ['specs/', 'docs/'])).toBe('specs/');
    expect(matchRoot('docs/readme.md', ['specs/', 'docs/'])).toBe('docs/');
  });

  it('matches a custom root like adr/ with no further configuration', () => {
    expect(matchRoot('adr/0001-decision.md', ['specs/', 'adr/'])).toBe('adr/');
  });

  it('returns null when no root matches', () => {
    expect(matchRoot('src/index.ts', ['specs/', 'docs/'])).toBeNull();
  });

  it('tolerates a root without a trailing slash', () => {
    expect(matchRoot('adr/0001.md', ['adr'])).toBe('adr');
  });
});

describe('dedupeByPath', () => {
  it('keeps the first occurrence and discards later duplicates', () => {
    const entries = [
      { path: 'specs/a.md', tag: 'first' },
      { path: 'specs/b.md', tag: 'only' },
      { path: 'specs/a.md', tag: 'second' },
    ];
    const result = dedupeByPath(entries);
    expect(result).toEqual([
      { path: 'specs/a.md', tag: 'first' },
      { path: 'specs/b.md', tag: 'only' },
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(dedupeByPath([])).toEqual([]);
  });
});

describe('buildStatusLine', () => {
  const scannedAt = '2026-08-24T00:00:00.000Z';

  it('empty listing: count 0, tokenSum 0 (AC-62)', () => {
    const status = buildStatusLine({
      cloned: true,
      count: 0,
      tokenSum: 0,
      pending: false,
      fallbackUsed: false,
      truncated: false,
      scannedAt,
    });
    expect(status).toEqual({
      count: 0,
      tokenSum: 0,
      pending: false,
      fallbackUsed: false,
      truncated: false,
      cloned: true,
      scannedAt,
    });
  });

  it('no clone: count and tokenSum are OMITTED, not zero (AC-6, AC-63)', () => {
    const status = buildStatusLine({
      cloned: false,
      count: 0,
      tokenSum: 0,
      pending: false,
      fallbackUsed: false,
      truncated: false,
      scannedAt,
    });
    expect(status.cloned).toBe(false);
    expect(status.count).toBeUndefined();
    expect(status.tokenSum).toBeUndefined();
    expect('count' in status).toBe(false);
    expect('tokenSum' in status).toBe(false);
  });

  it('pending: tokenSum is null even if a raw sum was computed so far (AC-61, NFR-21)', () => {
    const status = buildStatusLine({
      cloned: true,
      count: 12,
      tokenSum: 999, // must be ignored while pending
      pending: true,
      fallbackUsed: false,
      truncated: false,
      scannedAt,
    });
    expect(status.count).toBe(12);
    expect(status.tokenSum).toBeNull();
    expect(status.pending).toBe(true);
  });

  it('fallback used: fallbackUsed flag surfaces in the status line (AC-18, AC-60)', () => {
    const status = buildStatusLine({
      cloned: true,
      count: 3,
      tokenSum: 450,
      pending: false,
      fallbackUsed: true,
      truncated: false,
      scannedAt,
    });
    expect(status.fallbackUsed).toBe(true);
    expect(status.tokenSum).toBe(450);
  });

  it('truncated: truncated flag surfaces when NFR-5 cap was hit (NFR-19)', () => {
    const status = buildStatusLine({
      cloned: true,
      count: 1000,
      tokenSum: 50_000,
      pending: false,
      fallbackUsed: false,
      truncated: true,
      scannedAt,
    });
    expect(status.truncated).toBe(true);
  });
});

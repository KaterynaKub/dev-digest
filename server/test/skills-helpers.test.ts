import { describe, it, expect } from 'vitest';
import {
  isBodyChange,
  parseSkillMarkdown,
  selectArchiveEntry,
  slugify,
  toSkillDto,
  type ArchiveEntryMeta,
  type SkillRowLike,
} from '../src/modules/skills/helpers.js';

/**
 * Hermetic coverage for the skills module's pure helpers: markdown/frontmatter
 * parsing, the body-only version-bump predicate, row→DTO mapping, and archive
 * entry selection on a synthetic (no real zip) entry list.
 */

describe('parseSkillMarkdown', () => {
  it('reads name/description/type from YAML frontmatter and cuts it from the body', () => {
    const text = [
      '---',
      'name: Test Coverage Rubric',
      'description: Flags untested branches.',
      'type: rubric',
      '---',
      '',
      'Check every new branch has a test.',
    ].join('\n');

    const result = parseSkillMarkdown(text);
    expect(result.name).toBe('Test Coverage Rubric');
    expect(result.description).toBe('Flags untested branches.');
    expect(result.type).toBe('rubric');
    expect(result.body).not.toContain('---');
    expect(result.body).not.toContain('name:');
    expect(result.body).toContain('Check every new branch has a test.');
  });

  it('maps an unknown frontmatter type to custom', () => {
    const text = ['---', 'name: X', 'description: Y', 'type: something-weird', '---', 'Body'].join(
      '\n',
    );
    const result = parseSkillMarkdown(text);
    expect(result.type).toBe('custom');
  });

  it('falls back to the first H1 heading and following paragraph when there is no frontmatter', () => {
    const text = [
      '# Edge Case Checklist',
      '',
      'Covers empty, null, zero, boundary, overflow, unicode, concurrency.',
      '',
      'More detail here.',
    ].join('\n');

    const result = parseSkillMarkdown(text);
    expect(result.name).toBe('Edge Case Checklist');
    expect(result.description).toBe(
      'Covers empty, null, zero, boundary, overflow, unicode, concurrency.',
    );
    expect(result.type).toBe('custom');
  });

  it('falls back to filename + first 200 chars when there is no frontmatter and no H1', () => {
    const body = 'a'.repeat(300);
    const result = parseSkillMarkdown(body, 'mocking-discipline.md');
    expect(result.name).toBe('mocking-discipline');
    expect(result.description).toBe('a'.repeat(200));
    expect(result.type).toBe('custom');
  });

  it('throws when the body is whitespace-only (description would be empty)', () => {
    expect(() => parseSkillMarkdown('   \n\n   ', 'blank.md')).toThrow();
  });

  it('ignores nested/anchored/aliased YAML in frontmatter without throwing', () => {
    const text = [
      '---',
      'name: Has Weird YAML',
      'description: Still parses.',
      'nested:',
      '  - one',
      '  - two',
      'anchor: &foo bar',
      'alias: *foo',
      'tagged: !!python/object:x',
      '---',
      'Body text.',
    ].join('\n');

    expect(() => parseSkillMarkdown(text)).not.toThrow();
    const result = parseSkillMarkdown(text);
    expect(result.name).toBe('Has Weird YAML');
    expect(result.description).toBe('Still parses.');
    expect(result.type).toBe('custom');
  });
});

describe('isBodyChange', () => {
  const existing: Pick<SkillRowLike, 'body'> = { body: 'original body' };

  it('is true when body changes', () => {
    expect(isBodyChange(existing, { body: 'new body' })).toBe(true);
  });

  it('is false when body is identical', () => {
    expect(isBodyChange(existing, { body: 'original body' })).toBe(false);
  });

  it('is false when body is not part of the patch at all', () => {
    expect(isBodyChange(existing, {})).toBe(false);
  });
});

describe('toSkillDto', () => {
  it('maps a persisted row to the public Skill DTO', () => {
    const row: SkillRowLike = {
      id: 's1',
      name: 'Mocking Discipline',
      description: 'Do not mock the unit under test.',
      type: 'convention',
      source: 'manual',
      body: 'Body text',
      enabled: true,
      version: 2,
      evidenceFiles: ['skills/mocking/SKILL.md'],
    };
    expect(toSkillDto(row)).toEqual({
      id: 's1',
      name: 'Mocking Discipline',
      description: 'Do not mock the unit under test.',
      type: 'convention',
      source: 'manual',
      body: 'Body text',
      enabled: true,
      version: 2,
      evidence_files: ['skills/mocking/SKILL.md'],
    });
  });

  it('defaults evidence_files to null when absent', () => {
    const row: SkillRowLike = {
      id: 's2',
      name: 'X',
      description: 'Y',
      type: 'custom',
      source: 'manual',
      body: 'B',
      enabled: true,
      version: 1,
    };
    expect(toSkillDto(row).evidence_files).toBeNull();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Test Coverage Rubric')).toBe('test-coverage-rubric');
  });

  it('never returns an empty string', () => {
    expect(slugify('!!!')).toBe('skill');
  });
});

describe('selectArchiveEntry', () => {
  function entry(fileName: string, uncompressedSize = 100, isSymlink = false): ArchiveEntryMeta {
    return { fileName, uncompressedSize, isSymlink };
  }

  it('prefers root SKILL.md over everything else', () => {
    const entries = [
      entry('README.md'),
      entry('SKILL.md'),
      entry('docs/notes.md', 99999),
    ];
    expect(selectArchiveEntry(entries)?.fileName).toBe('SKILL.md');
  });

  it('prefers a nested <dir>/SKILL.md over root README.md', () => {
    const entries = [entry('README.md'), entry('skills/test-quality/SKILL.md')];
    expect(selectArchiveEntry(entries)?.fileName).toBe('skills/test-quality/SKILL.md');
  });

  it('falls back to root README.md when there is no SKILL.md', () => {
    const entries = [entry('README.md'), entry('notes.md')];
    expect(selectArchiveEntry(entries)?.fileName).toBe('README.md');
  });

  it('falls back to the largest .md entry when there is no SKILL.md or README.md', () => {
    const entries = [entry('small.md', 10), entry('big.md', 5000), entry('medium.md', 500)];
    expect(selectArchiveEntry(entries)?.fileName).toBe('big.md');
  });

  it('never selects a non-.md entry (install.sh / run.js)', () => {
    const entries = [entry('install.sh', 99999), entry('run.js', 99999), entry('notes.md', 5)];
    expect(selectArchiveEntry(entries)?.fileName).toBe('notes.md');
  });

  it('rejects a symlinked .md entry', () => {
    const entries = [entry('SKILL.md', 100, true), entry('README.md', 50)];
    expect(selectArchiveEntry(entries)?.fileName).toBe('README.md');
  });

  it('rejects path-traversal-shaped entries', () => {
    const entries = [entry('../../etc/passwd.md', 99999), entry('safe.md', 5)];
    expect(selectArchiveEntry(entries)?.fileName).toBe('safe.md');
  });

  it('returns undefined when there are zero eligible .md entries', () => {
    const entries = [entry('install.sh'), entry('run.js'), entry('../evil.md')];
    expect(selectArchiveEntry(entries)).toBeUndefined();
  });
});

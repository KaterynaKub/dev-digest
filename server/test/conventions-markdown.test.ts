import { describe, it, expect } from 'vitest';
import {
  buildSkillDraft,
  fenceFor,
  fenceLangFor,
  slugify,
  type DraftRow,
} from '../src/modules/conventions/helpers.js';

/** The merged-skill markdown builder. Pure — no DB, no mocks. */

function row(over: Partial<DraftRow> = {}): DraftRow {
  return {
    category: 'Async',
    rule: 'Always use async/await instead of .then() chains.',
    evidencePath: 'src/api/users.ts',
    evidenceStartLine: 23,
    evidenceEndLine: 31,
    evidenceSnippet: 'const user = await db.users.find(id);',
    ...over,
  };
}

describe('slugify', () => {
  it('kebab-cases and strips punctuation', () => {
    expect(slugify('Payments API')).toBe('payments-api');
    expect(slugify('  Error Handling!  ')).toBe('error-handling');
  });

  it('falls back rather than returning an empty slug', () => {
    expect(slugify('!!!')).toBe('conventions');
  });
});

describe('fenceLangFor', () => {
  it('maps known extensions', () => {
    expect(fenceLangFor('src/a.ts')).toBe('ts');
    expect(fenceLangFor('src/a.tsx')).toBe('tsx');
    expect(fenceLangFor('package.json')).toBe('json');
    expect(fenceLangFor('.prettierrc.yml')).toBe('yaml');
  });

  it('returns "" for an unknown extension', () => {
    expect(fenceLangFor('.editorconfig')).toBe('');
    expect(fenceLangFor('Makefile')).toBe('');
  });
});

describe('fenceFor', () => {
  it('uses a 3-backtick fence for ordinary code', () => {
    expect(fenceFor('const a = 1;')).toBe('```');
  });

  it('widens past a ``` run inside the snippet', () => {
    expect(fenceFor('/** ```ts\n * example\n * ``` */')).toBe('````');
  });

  it('widens past a longer run too', () => {
    expect(fenceFor('a ````` b')).toBe('``````');
  });
});

describe('buildSkillDraft', () => {
  it('generates slug, name, description and type', () => {
    const draft = buildSkillDraft('acme/payments-api', 'payments-api', [row()]);
    expect(draft.slug).toBe('payments-api-conventions');
    expect(draft.name).toBe('Payments Api Conventions');
    expect(draft.type).toBe('convention');
    expect(draft.merged_count).toBe(1);
    expect(draft.description).toContain('acme/payments-api');
    expect(draft.description).toContain('Async');
  });

  it('never produces an empty description (the DB column is NOT NULL)', () => {
    const draft = buildSkillDraft('acme/payments-api', 'payments-api', []);
    expect(draft.description.trim().length).toBeGreaterThan(0);
    expect(draft.merged_count).toBe(0);
  });

  it('renders the documented document shape', () => {
    const body = buildSkillDraft('acme/payments-api', 'payments-api', [row()]).body;
    expect(body).toContain('# payments-api-conventions');
    expect(body).toContain('Conventions extracted from `acme/payments-api`.');
    expect(body).toContain('## async-always-use-async-await');
    expect(body).toContain('Always use async/await instead of .then() chains.');
    expect(body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(body).toContain('```ts\nconst user = await db.users.find(id);\n```');
  });

  it('widens the fence when a snippet contains backticks', () => {
    const body = buildSkillDraft('acme/x', 'x', [
      row({ evidenceSnippet: '/** ```ts\n * inner\n * ``` */' }),
    ]).body;
    expect(body).toContain('````ts');
    expect(body).toContain('\n````');
    // The document must not be corrupted by the inner run.
    expect(body.endsWith('````\n')).toBe(true);
  });

  it('uses a bare fence for an unknown extension', () => {
    const body = buildSkillDraft('acme/x', 'x', [
      row({ evidencePath: '.editorconfig', evidenceSnippet: 'indent_size = 2' }),
    ]).body;
    expect(body).toContain('```\nindent_size = 2\n```');
  });

  it('emits one section per row, in order', () => {
    const body = buildSkillDraft('acme/x', 'x', [
      row({ category: 'Async', rule: 'Always use async/await instead of chains.' }),
      row({
        category: 'Validation',
        rule: 'Validate request bodies with zod schemas.',
        evidencePath: 'src/api/schema.ts',
      }),
    ]).body;
    const headings = body.match(/^## .+$/gm) ?? [];
    expect(headings).toHaveLength(2);
    expect(headings[0]).toContain('async');
    expect(headings[1]).toContain('validation');
  });

  it('takes the human text verbatim for an edited row', () => {
    const edited = 'Prefer `Result<T, E>` over throwing in route handlers.';
    const body = buildSkillDraft('acme/x', 'x', [row({ rule: edited })]).body;
    expect(body).toContain(edited);
  });

  it('dedupes and sorts evidence_files', () => {
    const draft = buildSkillDraft('acme/x', 'x', [
      row({ evidencePath: 'src/z.ts' }),
      row({ evidencePath: 'src/a.ts', rule: 'A different rule about imports here.' }),
      row({ evidencePath: 'src/z.ts', rule: 'Yet another distinct rule about logs.' }),
    ]);
    expect(draft.evidence_files).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('produces a well-formed document with zero rows', () => {
    const body = buildSkillDraft('acme/x', 'x', []).body;
    expect(body).toContain('# x-conventions');
    expect(body).not.toContain('## ');
    expect(body.endsWith('\n')).toBe(true);
  });
});

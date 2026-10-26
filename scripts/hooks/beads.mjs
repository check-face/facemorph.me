// Local closure guard for the exact outgoing Beads snapshot, never a shared working-tree database.
import { execFileSync } from 'node:child_process';
import { violations } from '../beads/check-closure.mjs';

const ISSUES = '.beads/issues.jsonl';

/** Skip unrelated pushes; a new ref considers only history absent from locally known remote refs. No fetch. */
export function checkBeadsCommit({ root, head, base }) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    const changed = base
      ? git('diff', '--name-only', '-z', base, head, '--', ISSUES)
      : git(
          'log',
          '--format=',
          '--name-only',
          '-z',
          '--full-history',
          '-m',
          head,
          '--not',
          '--remotes',
          '--',
          ISSUES,
        );
    if (!changed.trim()) return { ok: true, checked: false, violations: [] };
    const issues = git('show', `${head}:${ISSUES}`)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const found = violations(issues);
    return { ok: found.length === 0, checked: true, violations: found };
  } catch {
    return {
      ok: false,
      checked: true,
      violations: [],
      error: 'cannot read outgoing Beads revision or parse its issues.jsonl',
    };
  }
}

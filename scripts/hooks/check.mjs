#!/usr/bin/env node
// Cheap checks on exact staged/pushed blobs: format/lint, plus outgoing Beads closure and types on pre-push.
// Build, test and device validation remain the contributor's job.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_CACHE, typecheckCommit } from './typecheck.mjs';
import { checkBeadsCommit } from './beads.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const mode = process.argv[2];
const zero = '0'.repeat(40);
const revisions = mode === 'pre-commit' ? [':'] : [];
if (mode === 'pre-push') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  for (const line of input.trim().split('\n')) {
    const [, head, , base] = line.split(/\s+/);
    if (head && head !== zero) revisions.push([head, base === zero ? undefined : base]);
  }
} else if (mode !== 'pre-commit') throw new Error('expected pre-commit or pre-push');

let failed = false;
if (mode === 'pre-push')
  for (const [head, base] of revisions) {
    const result = checkBeadsCommit({ root, head, base });
    for (const violation of result.violations)
      console.error(`pre-push beads: ${JSON.stringify(violation)}`);
    if (!result.ok) {
      console.error(
        `pre-push: Beads closure check failed for ${head}${result.error ? `: ${result.error}` : ''}; fix and commit before pushing.`,
      );
      failed = true;
    }
  }
if (failed) process.exit(1);
for (const revision of revisions) {
  const staged = revision === ':';
  const [head, base] = staged ? [':', undefined] : revision;
  const files = (
    staged
      ? git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')
      : base
        ? git('diff', '--name-only', '-z', '--diff-filter=ACMR', base, head)
        : git('ls-tree', '-r', '--name-only', '-z', head)
  )
    .split('\0')
    .filter(Boolean);
  const format = files.filter((f) => /\.(?:m?[jt]sx?|json|ya?ml|css)$/.test(f));
  if (!format.length) continue;
  const temp = mkdtempSync(join(tmpdir(), 'facemorph-hook-'));
  try {
    for (const path of new Set([...format, '.oxfmtrc.json', '.oxlintrc.json', '.gitignore'])) {
      let contents;
      try {
        contents = git('show', staged ? `:${path}` : `${head}:${path}`);
      } catch {
        continue;
      }
      mkdirSync(dirname(join(temp, path)), { recursive: true });
      writeFileSync(join(temp, path), contents);
    }
    const lint = format.filter((f) => /\.m?[jt]sx?$/.test(f));
    for (const [tool, args] of [
      ['oxfmt', ['--check', ...format]],
      ['oxlint', ['--deny-warnings', '--no-error-on-unmatched-pattern', ...lint]],
    ]) {
      if (tool === 'oxlint' && !lint.length) continue;
      const binary = join(root, 'node_modules/.bin', tool);
      if (!existsSync(binary)) throw new Error(`${tool} is missing: run npm ci first`);
      const result = spawnSync(binary, args, { cwd: temp, encoding: 'utf8' });
      if (result.error) throw result.error;
      // Oxfmt has no equivalent of Oxlint's unmatched-pattern flag. Accept only its exact
      // no-target verdict, never syntax/configuration errors or ordinary formatting failures.
      const noFormatTargets =
        tool === 'oxfmt' &&
        result.status === 2 &&
        result.stdout === 'Checking formatting...\n\n' &&
        result.stderr.trim() ===
          'Expected at least one target file. All matched files may have been excluded by ignore rules.';
      if (!noFormatTargets) {
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
      }
      if (result.status !== 0 && !noFormatTargets) {
        console.error(
          `${mode}: ${tool} failed on ${staged ? 'staged' : head} files; fix and commit them before pushing.`,
        );
        failed = true;
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
// Pre-push also typechecks each pushed commit's own tree (typecheck.mjs): the workspaces it touches and their
// dependents, never the working tree, so other sessions' uncommitted edits cannot hide or cause an error.
if (mode === 'pre-push')
  for (const [head, base] of revisions) {
    const result = await typecheckCommit({
      root,
      head,
      base,
      cache: DEFAULT_CACHE,
      log: (line) => console.error(`pre-push typecheck: ${line}`),
    });
    for (const f of result.failures) process.stdout.write(`\n${f.project}\n${f.output}`);
    if (!result.ok) {
      console.error(
        `pre-push: tsc failed in ${result.failures.length} project(s) of ${head}; fix and commit before pushing.`,
      );
      failed = true;
    } else if (result.checked.length)
      console.error(
        `pre-push typecheck: ${result.checked.length} project(s) clean in ${result.ms} ms`,
      );
  }
process.exitCode = failed ? 1 : 0;

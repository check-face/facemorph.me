#!/usr/bin/env node
// Cheap checks on the exact staged/pushed blobs. Build, test and device validation remain the contributor's job.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
      ['oxlint', ['--deny-warnings', ...lint]],
    ]) {
      if (tool === 'oxlint' && !lint.length) continue;
      const binary = join(root, 'node_modules/.bin', tool);
      if (!existsSync(binary)) throw new Error(`${tool} is missing: run npm ci first`);
      const result = spawnSync(binary, args, { cwd: temp, stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) {
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
process.exitCode = failed ? 1 : 0;

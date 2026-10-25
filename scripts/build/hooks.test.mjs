// Real Git commits and pushes: hooks inspect staged/pushed bytes, preserve other plugins, and install idempotently.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const project = new URL('../..', import.meta.url).pathname;
test('cheap hooks reject broken staged/pushed blobs despite a clean working copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'facemorph-hooks-test-'));
  const root = join(dir, 'repo');
  mkdirSync(root);
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
    git('config', 'user.name', 'hook test');
    git('config', 'user.email', 'hook@example.invalid');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    for (const file of ['.oxfmtrc.json', '.oxlintrc.json'])
      writeFileSync(join(root, file), readFileSync(join(project, file)));
    symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'));
    const install = () =>
      execFileSync(process.execPath, [join(project, 'scripts/hooks/install.mjs'), root]);
    install();
    const plugin = join(root, '.git/hooks/hooks.d/pre-commit/50-test-guard');
    writeFileSync(plugin, '#!/bin/sh\nprintf guard >> "$0.ran"\n');
    chmodSync(plugin, 0o755);
    const before = readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8');
    install();
    assert.equal(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8'), before);
    writeFileSync(join(root, 'bad.mjs'), 'export const x={a:1}\n');
    git('add', '.');
    const good = 'export const x = { a: 1 };\n';
    writeFileSync(join(root, 'bad.mjs'), good);
    const commit = spawnSync('git', ['commit', '-qm', 'bad staged'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(commit.status, 0, commit.stdout + commit.stderr);
    assert.match(commit.stderr, /oxfmt failed/);
    git('add', 'bad.mjs');
    git('commit', '-qm', 'good');
    assert.match(readFileSync(`${plugin}.ran`, 'utf8'), /guardguard/);
    const remote = join(dir, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'main');
    // Imported legacy sources are intentionally excluded by Oxc's versioned config. A
    // change consisting only of these still needs to commit and push through the real hooks.
    mkdirSync(join(root, 'apps/web/src/Next'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/Next/legacy.mjs'), 'export const legacy={a:1}\n');
    git('add', 'apps/web/src/Next/legacy.mjs');
    git('commit', '-qm', 'ignored legacy source');
    git('push', '-q', 'origin', 'main');
    const remoteHead = git('rev-parse', 'HEAD').trim();
    // Create an actual bad commit with plumbing, leaving the good working copy intact.
    writeFileSync(join(root, 'bad.mjs'), 'export const x={a:1}\n');
    git('add', 'bad.mjs');
    const tree = git('write-tree').trim();
    const bad = git('commit-tree', tree, '-p', remoteHead, '-m', 'bad pushed').trim();
    writeFileSync(join(root, 'bad.mjs'), good);
    const push = spawnSync('git', ['push', 'origin', `${bad}:refs/heads/main`], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(push.status, 0, push.stdout + push.stderr);
    assert.match(push.stderr, /oxfmt failed/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], remoteHead);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

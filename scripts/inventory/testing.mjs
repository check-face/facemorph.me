// Test helpers for the inventory scripts: real temporary directories and real Git repositories.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const tempDir = (prefix = 'inventory-') => mkdtempSync(join(tmpdir(), prefix));

export function plant(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

export function gitRepo() {
  const dir = tempDir('inventory-git-');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main'); // `init -b` needs Git 2.28; the triton runner is older
  git('config', 'user.email', 'inventory@test.invalid');
  git('config', 'user.name', 'inventory test');
  git('config', 'commit.gpgsign', 'false');
  const commit = (files, message) => {
    plant(dir, files);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, commit };
}

// Runs an inventory script as a real process; returns exit status and parsed JSON lines.
export function run(script, args, options = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...options });
  const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, lines, summary: lines.at(-1)?.summary, stderr: r.stderr };
}

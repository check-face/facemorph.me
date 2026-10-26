// The pre-push typecheck (typecheck.mjs): which projects a change selects, and real runs on commits built here as
// dangling objects (no ref, index or working-tree file is touched), so the check sees exactly a pushed tree.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { affected, typecheckCommit, workflowProjects, workspaces } from './typecheck.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const WS = workspaces(read);
const names = (r) => r.workspaces.map((w) => w.name).sort();

test('a change selects its workspace and every workspace that depends on it', () => {
  const web = WS.find((w) => w.dir === 'apps/web').name;
  assert.deepEqual(
    names(affected(['packages/stylegan-js/src/index.ts'], WS, [])),
    [
      '@facemorph/browser-model-manager',
      '@facemorph/cloudflare-model-host',
      '@facemorph/stylegan-js',
      web,
    ].sort(),
  );
  assert.deepEqual(names(affected(['apps/web/shell/main.tsx'], WS, [])), [web]);
  assert.deepEqual(names(affected(['docs/README.md', 'apps/web/README.md'], WS, [])), []);
  assert.equal(affected(['tsconfig.base.json'], WS, []).workspaces.length, WS.length);
});

test('workflow-run projects follow their paths and their workspace', () => {
  const extra = ['scripts/ci', 'apps/web/src/media'];
  assert.deepEqual(affected(['scripts/ci/run-lanes.ts'], WS, extra).projects, ['scripts/ci']);
  assert.ok(
    affected(['apps/web/src/media/still-entry.ts'], WS, extra).projects.includes(
      'apps/web/src/media',
    ),
  );
  assert.deepEqual(affected(['scripts/hooks/check.mjs'], WS, extra).projects, []);
  const listed = workflowProjects(read, (dir) =>
    spawnSync('ls', [join(ROOT, dir)], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter(Boolean),
  );
  assert.ok(listed.includes('scripts/ci'), 'the workflows run tsc -p scripts/ci');
});

/** A commit object on top of HEAD with one file replaced: nothing in the checkout changes. */
function plant(path, text) {
  const temp = mkdtempSync(join(tmpdir(), 'typecheck-plant-'));
  try {
    const blob = git(['hash-object', '-w', '--stdin'], { input: text }).trim();
    const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index') };
    git(['read-tree', 'HEAD'], { env });
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
    const tree = git(['write-tree'], { env }).trim();
    return git(['commit-tree', tree, '-p', 'HEAD'], { input: 'planted' }).trim();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test(
  'a planted type error in a pushed commit fails, naming the file; the working tree is not read',
  { timeout: 600_000 },
  async () => {
    const path = 'apps/web/src/admission/route-admission.ts';
    const planted = plant(
      path,
      `${git(['show', `HEAD:${path}`])}\nexport const planted: number = 'not a number';\n`,
    );
    // A working-tree file that would fail is irrelevant: only the commit's tree is checked.
    const cache = mkdtempSync(join(tmpdir(), 'typecheck-cache-'));
    try {
      const r = await typecheckCommit({ root: ROOT, head: planted, base: 'HEAD', cache });
      assert.equal(r.ok, false);
      assert.ok(r.checked.includes('apps/web/tsconfig.json'));
      assert.ok(
        r.failures.some((f) => /route-admission\.ts\(\d+,\d+\): error TS2322/.test(f.output)),
        JSON.stringify(r.failures.map((f) => f.project)),
      );
      assert.ok(r.ms < 120_000, `${r.ms} ms`);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  },
);

test('a commit that touches no TypeScript project checks nothing and passes', async () => {
  const planted = plant('docs/typecheck-hook-probe.md', '# probe\n');
  const r = await typecheckCommit({ root: ROOT, head: planted, base: 'HEAD', cache: tmpdir() });
  assert.deepEqual([r.ok, r.checked], [true, []]);
});

test(
  'the command line exits 1 on the planted error and 2 without a commit',
  { timeout: 600_000 },
  () => {
    const script = join(ROOT, 'scripts/hooks/typecheck.mjs');
    assert.equal(spawnSync('node', [script], { cwd: ROOT }).status, 2);
    const path = git(['ls-tree', '-r', '--name-only', 'HEAD', 'scripts/ci'])
      .split('\n')
      .find((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    assert.ok(path, 'a tracked scripts/ci TypeScript file');
    const text = git(['show', `HEAD:${path}`]);
    const planted = plant(path, `${text}\nconst planted: number = 'x';\nexport { planted };\n`);
    const r = spawnSync('node', [script, planted, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stdout.includes(`${path}(`) && /error TS2322/.test(r.stdout), r.stdout);
  },
);

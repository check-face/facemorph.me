// identity.mjs (fm-pud) on planted inputs in temporary directories (inputs, not fakes): per-root identity and
// check selection in a real Git repository laid out like this workspace, the worker graphs, and artifact identity.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { treeDigest } from '../ci/fetch-artifact.ts';
import { WORKSPACES } from './check-scaffold.mjs';
import {
  artifactIdentity,
  lockClosure,
  rootIdentities,
  selectChecks,
  uncoveredPaths,
  workerFindings,
} from './identity.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
function plant(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
}

/** A Git repository with the five workspaces, a dependency chain and a lockfile, as in this repository. */
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  const names = Object.fromEntries(WORKSPACES.map((w) => [w, `@t/${w.split('/').at(-1)}`]));
  const deps = {
    'apps/web': ['packages/browser-model-manager'],
    'packages/browser-model-manager': ['packages/stylegan-js'],
  };
  const files = {
    'package.json': JSON.stringify({ name: 'root', workspaces: WORKSPACES }),
    'tsconfig.base.json': '{}',
    '.github/workflows/engine.yml': "on:\n  push:\n    paths: ['packages/stylegan-js/**']\n",
  };
  const lock = { packages: { '': {} } };
  for (const w of WORKSPACES) {
    const dependencies = Object.fromEntries((deps[w] ?? []).map((d) => [names[d], '^0.0.0']));
    if (w === 'packages/stylegan-js') dependencies['left-pad'] = '^1.0.0';
    files[`${w}/package.json`] = JSON.stringify({
      name: names[w],
      dependencies,
      scripts: { test: 'node --test test/*.test.mjs' },
    });
    files[`${w}/src/index.mjs`] = `export const name = '${w}';\n`;
    lock.packages[w] = { dependencies };
    lock.packages[`node_modules/${names[w]}`] = { link: true, resolved: w };
  }
  lock.packages['node_modules/left-pad'] = { version: '1.3.0', integrity: 'sha512-planted' };
  files['package-lock.json'] = JSON.stringify(lock);
  plant(dir, files);
  const git = (...a) => assert.equal(spawnSync('git', a, { cwd: dir }).status, 0, a.join(' '));
  git('init', '-q');
  git('add', '-A');
  return dir;
}

test("editing a file in each root changes its identity (and its dependents') and selects its checks", () => {
  const dir = workspace();
  const before = rootIdentities(dir);
  for (const w of WORKSPACES) {
    plant(dir, { [`${w}/src/index.mjs`]: `export const name = '${w}'; // edited\n` });
    const after = rootIdentities(dir);
    assert.notEqual(after.roots[w].digest, before.roots[w].digest, `${w} identity changes`);
    const selected = selectChecks(after, [`${w}/src/index.mjs`]);
    assert.ok(selected.roots.includes(w), w);
    assert.ok(
      selected.tests.some((t) => t.startsWith(`npm test -w ${w} `)),
      `${w} test selected`,
    );
    for (const other of WORKSPACES.filter((o) => !selected.roots.includes(o)))
      assert.equal(
        after.roots[other].digest,
        before.roots[other].digest,
        `${other} unchanged by ${w}`,
      );
    plant(dir, { [`${w}/src/index.mjs`]: `export const name = '${w}';\n` });
  }
  const engine = selectChecks(before, ['packages/stylegan-js/src/index.mjs']);
  assert.deepEqual(
    engine.roots,
    ['apps/web', 'packages/browser-model-manager', 'packages/stylegan-js'],
    'dependents follow',
  );
  assert.ok(engine.workflows.includes('.github/workflows/engine.yml'));
  assert.deepEqual(
    selectChecks(before, ['tsconfig.base.json']).roots.length,
    WORKSPACES.length,
    'a shared config selects every root',
  );
});

test('the lockfile closure is part of identity: a changed resolved version changes the root that uses it', () => {
  const dir = workspace();
  const before = rootIdentities(dir);
  assert.deepEqual(before.roots['packages/stylegan-js'].lockEntries, 1);
  const lock = {
    packages: { '': {}, 'node_modules/left-pad': { version: '1.3.1', integrity: 'sha512-other' } },
  };
  const full = JSON.parse(
    spawnSync('cat', [join(dir, 'package-lock.json')], { encoding: 'utf8' }).stdout,
  );
  plant(dir, {
    'package-lock.json': JSON.stringify({ packages: { ...full.packages, ...lock.packages } }),
  });
  const after = rootIdentities(dir);
  assert.notEqual(
    after.roots['packages/stylegan-js'].digest,
    before.roots['packages/stylegan-js'].digest,
  );
  assert.deepEqual(
    lockClosure(
      {
        packages: {
          a: { dependencies: { x: '1' } },
          'a/node_modules/x': { version: '2' },
          'node_modules/x': { version: '1' },
        },
      },
      'a',
    ).map(([k]) => k),
    ['a/node_modules/x'],
    'nested resolution wins',
  );
});

/** A planted build output: one emitted worker importing a chunk, and a hosted tree with a module and its WASM. */
function workers() {
  const dist = mkdtempSync(join(tmpdir(), 'identity-dist-'));
  const hosted = mkdtempSync(join(tmpdir(), 'identity-hosted-'));
  const worker =
    "import { a } from './shared-1.js';\nconst w = new URL('./codec-2.wasm', import.meta.url);\n";
  plant(dist, {
    'assets/worker-0.js': worker,
    'assets/shared-1.js': 'export const a = 1;\n',
    'assets/codec-2.wasm': 'wasm',
  });
  const mod = "const wasm = 'ort.wasm';\n";
  plant(hosted, { 'assets/r/ort.mjs': mod, 'assets/r/ort.wasm': 'binary' });
  const inventory = {
    emitted: [{ source: 'src/w.mjs', file: 'assets/worker-0.js', sha256: sha(worker) }],
  };
  const pinned = [
    { path: 'assets/r/ort.mjs', sha256: sha(mod) },
    { path: 'assets/r/ort.wasm', sha256: sha('binary') },
  ];
  return { dist, hosted, inventory, pinned };
}

test('worker graphs: a clean build passes and its transitive chunks are hashed', () => {
  const w = workers();
  const r = workerFindings({
    dist: w.dist,
    inventory: w.inventory,
    pinned: w.pinned,
    hostedRoot: w.hosted,
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(
    r.emitted.map((e) => e.path),
    ['assets/codec-2.wasm', 'assets/shared-1.js', 'assets/worker-0.js'],
  );
});

test('one altered byte in an emitted worker or a hosted sibling, without a new pin, fails', () => {
  const w = workers();
  plant(w.dist, {
    'assets/worker-0.js':
      "import { a } from './shared-1.js';\nconst w = new URL('./codec-2.wasm', import.meta.url);\n ",
  });
  assert.match(
    workerFindings({ dist: w.dist, inventory: w.inventory, pinned: w.pinned }).findings[0].problem,
    /pinned/,
  );
  const h = workers();
  plant(h.hosted, { 'assets/r/ort.wasm': 'binarY' });
  const r = workerFindings({
    dist: h.dist,
    inventory: h.inventory,
    pinned: h.pinned,
    hostedRoot: h.hosted,
  });
  assert.deepEqual(
    r.findings.map((f) => [f.graph, f.path]),
    [['hosted', 'assets/r/ort.wasm']],
  );
});

test('an unlisted transitive worker import fails: a missing emitted chunk, or an unpinned hosted sibling', () => {
  const w = workers();
  plant(w.dist, { 'assets/shared-1.js': "export { b } from './extra-3.js';\n" });
  const r = workerFindings({ dist: w.dist, inventory: w.inventory, pinned: w.pinned });
  assert.deepEqual(
    r.findings.map((f) => f.problem),
    ['imported by assets/shared-1.js but not in the build output'],
  );
  const h = workers();
  plant(h.hosted, {
    'assets/r/ort.mjs': "const wasm = 'ort.wasm'; const jsep = 'ort.jsep.mjs';\n",
    'assets/r/ort.jsep.mjs': 'x',
  });
  const pinned = [
    {
      path: 'assets/r/ort.mjs',
      sha256: sha("const wasm = 'ort.wasm'; const jsep = 'ort.jsep.mjs';\n"),
    },
    h.pinned[1],
  ];
  const hr = workerFindings({ dist: h.dist, inventory: h.inventory, pinned, hostedRoot: h.hosted });
  assert.deepEqual(
    hr.findings.map((f) => [f.path, f.problem]),
    [['assets/r/ort.jsep.mjs', 'loaded by assets/r/ort.mjs but not pinned']],
  );
});

test("artifact identity: the control keeps classic's identity and label; a destination build names this repository", () => {
  const control = mkdtempSync(join(tmpdir(), 'identity-control-'));
  plant(control, {
    'next-site-identity.json': JSON.stringify({
      kind: 'control',
      label: 'control (classic candidate build; not built by this repository)',
      deploySource: {
        repository: 'check-face/facemorph.me-classic',
        commit: 'c'.repeat(40),
        buildId: 'next-0123456789abcdef',
        run: 4242,
      },
      assembledBy: { commit: 'a'.repeat(40) },
    }),
  });
  const env = { GITHUB_WORKFLOW: 'import-checks', GITHUB_RUN_ID: '77' };
  const c = artifactIdentity(control, { env });
  assert.deepEqual(
    {
      kind: c.kind,
      repositoryId: c.repositoryId,
      commit: c.commit,
      workflowRun: c.workflowRun,
      buildIdentity: c.buildIdentity,
    },
    {
      kind: 'control',
      repositoryId: 295956585,
      commit: 'c'.repeat(40),
      workflowRun: { workflow: 'next-site.yml', runId: 4242 },
      buildIdentity: 'next-0123456789abcdef',
    },
  );
  assert.match(c.label, /^control /);
  assert.deepEqual(c.assembledBy, {
    repositoryId: 1413979666,
    commit: 'a'.repeat(40),
    workflow: 'import-checks',
    runId: 77,
  });
  const dest = mkdtempSync(join(tmpdir(), 'identity-dest-'));
  plant(dest, {
    'next-site-identity.json': JSON.stringify({
      kind: 'monorepo',
      deploySource: { repository: 'check-face/facemorph.me', commit: 'd'.repeat(40) },
    }),
  });
  const d = artifactIdentity(dest, { env, build: 'b'.repeat(64) });
  assert.deepEqual(d, {
    kind: 'monorepo',
    label: null,
    repositoryId: 1413979666,
    repository: 'check-face/facemorph.me',
    commit: 'd'.repeat(40),
    workflowRun: { workflow: 'import-checks', runId: 77 },
    buildIdentity: 'b'.repeat(64),
    artifactDigest: null,
  });
});

test('every path an identity maps is selected by the shared path filters; a root outside them is reported', () => {
  const dir = workspace();
  const ids = rootIdentities(dir);
  const shared = [
    'apps/web/**',
    'packages/**',
    'package.json',
    'package-lock.json',
    'tsconfig*.json',
  ];
  assert.deepEqual(uncoveredPaths(dir, ids, shared), []);
  plant(dir, { 'packages/stylegan-js/.gitignore': 'dist/\n' });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  assert.deepEqual(
    uncoveredPaths(dir, rootIdentities(dir), shared),
    [],
    'dot-files under ** are selected, as on GitHub',
  );
  assert.deepEqual(
    uncoveredPaths(dir, ids, [
      'apps/web/**',
      'package.json',
      'package-lock.json',
      'tsconfig*.json',
    ]).filter((f) => f.startsWith('packages/')).length > 0,
    true,
  );
});

test("the artifact identity's digest is the shared fetch-artifact tree digest", () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-digest-'));
  plant(dir, {
    'deploy-next/index.html': '<!doctype html>',
    'deploy-next/app/a.js': 'x',
    'next-site-identity.json': JSON.stringify({
      kind: 'monorepo',
      deploySource: { repository: 'r', commit: 'e'.repeat(40) },
    }),
  });
  assert.equal(
    artifactIdentity(dir, { env: {} }).artifactDigest,
    treeDigest(join(dir, 'deploy-next')),
  );
});

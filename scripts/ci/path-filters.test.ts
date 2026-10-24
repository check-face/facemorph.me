// Path-filter coverage and lane conventions (fm-o8xn). The coverage cases are real temporary Git repositories; the
// lane rules are pure functions called on workflow text.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  check,
  codeRoots,
  laneProblems,
  pushPaths,
  type Filters,
  type Lane,
} from './path-filters.ts';

const REPO = new URL('../..', import.meta.url).pathname;
const FILTERS = JSON.parse(
  readFileSync(join(REPO, 'scripts/ci/path-filters.json'), 'utf8'),
) as Filters;

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-filters-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '-A']);
  return root;
}

test('this repository: every code root covered, every lane conforming', () => {
  const r = check(REPO, FILTERS);
  assert.deepEqual(r.problems, []);
  assert.ok(r.roots.includes('apps') && r.roots.includes('packages'));
});

test('a fixture tree with an uncovered top-level code root fails; a prose-only root is not a code root', () => {
  const root = tree({
    'apps/web/src/a.ts': 'export {}',
    'packages/x/index.ts': 'export {}',
    'newroot/thing.ts': 'export {}',
    'notes/readme.md': '# prose',
  });
  const r = check(root, { ...FILTERS, lanes: {} });
  assert.deepEqual(r.problems, [
    {
      rule: 'coverage',
      detail:
        'top-level code root newroot/ is neither in the shared path filters nor excluded with a reason',
    },
  ]);
  assert.ok(!r.roots.includes('notes'));
  rmSync(root, { recursive: true });
});

test('code roots come from code files below the top level only', () => {
  assert.deepEqual(codeRoots(['package.json', 'a/b.py', 'c/d.md', 'e/f/g.yml']), ['a', 'e']);
});

test('push paths read from flow and block lists', () => {
  const flow =
    'on:\n  push:\n    branches: [main]\n    paths:\n      [\n        \'apps/web/**\',\n        "packages/**",\n      ]\n  workflow_dispatch:\n';
  const block = "on:\n  push:\n    paths:\n      - 'apps/web/**'\n      - packages/**\njobs:\n";
  assert.deepEqual(pushPaths(flow), ['apps/web/**', 'packages/**']);
  assert.deepEqual(pushPaths(block), ['apps/web/**', 'packages/**']);
  assert.equal(pushPaths('on:\n  workflow_dispatch:\n'), null);
});

const lane: Lane = {
  workflow: '.github/workflows/l.yml',
  shared: ['apps/web/**'],
  extra: ['x/**'],
};
const good = (
  group = 'l-${{ github.ref }}',
  cancel = 'false',
  key = "deps-${{ hashFiles('package-lock.json') }}",
) =>
  `on:\n  push:\n    paths: ['apps/web/**', 'x/**', '.github/workflows/l.yml', '.github/actions/**']\nconcurrency:\n  group: ${group}\n  cancel-in-progress: ${cancel}\njobs:\n  a:\n    steps:\n      - uses: actions/cache@v4\n        with:\n          key: ${key}\n`;

test('a conforming lane has no problems', () => {
  assert.deepEqual(laneProblems('l', lane, FILTERS, good()), []);
});

test('lane rules: undeclared or missing paths, narrowing outside the shared list, concurrency, cache keys', () => {
  const rules = (yaml: string, l: Lane = lane) =>
    laneProblems('l', l, FILTERS, yaml).map((p) => p.rule);
  assert.deepEqual(rules(good().replace("'x/**', ", '')), ['paths']);
  assert.deepEqual(rules(good().replace("'x/**'", "'x/**', 'docs/**'")), ['paths']);
  assert.deepEqual(rules(good(), { ...lane, shared: ['apps/web/**', 'docs/**'] }), [
    'narrowing',
    'paths',
  ]);
  assert.deepEqual(rules(good('l')), ['concurrency']);
  assert.deepEqual(rules(good(undefined, 'true')), ['concurrency']);
  assert.deepEqual(rules(good(undefined, undefined, 'deps-${{ github.ref }}')), ['cache']);
  assert.deepEqual(rules(good(undefined, undefined, 'runtime-${{ github.run_id }}')), ['cache']);
  assert.deepEqual(rules(good(undefined, undefined, 'runtime-d9e37e50-sha256')), []);
});

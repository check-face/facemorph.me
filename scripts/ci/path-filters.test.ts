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
  mainProblems,
  pushesMain,
  runKeysOnUses,
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

test('push branches: a push trigger on main is found in flow and block lists; other branches are not main', () => {
  assert.equal(pushesMain('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n'), true);
  assert.equal(pushesMain('on:\n  push:\n    branches:\n      - main\n'), true);
  assert.equal(pushesMain('on:\n  push:\n    paths: [x/**]\n'), true);
  assert.equal(pushesMain("on:\n  push:\n    branches: ['candidate/*']\n"), false);
  assert.equal(pushesMain('on:\n  workflow_call:\n  workflow_dispatch:\n'), false);
});

const lane: Lane = {
  workflow: '.github/workflows/l.yml',
  shared: ['apps/web/**'],
  extra: ['x/**'],
};
const good = (
  trigger = '  workflow_call:\n',
  concurrency = '',
  key = "deps-${{ hashFiles('package-lock.json') }}",
) =>
  `on:\n${trigger}  workflow_dispatch:\n${concurrency}jobs:\n  a:\n    steps:\n      - uses: actions/cache@v4\n        with:\n          key: ${key}\n`;
const MAIN_YML =
  "on:\n  push:\n    branches: [main]\nconcurrency:\n  group: main\n  cancel-in-progress: false\njobs:\n  l:\n    needs: changes\n    if: contains(fromJSON(needs.changes.outputs.lanes), 'l')\n    uses: ./.github/workflows/l.yml\n    secrets: inherit\n";

test('a conforming lane and main.yml have no problems', () => {
  assert.deepEqual(laneProblems('l', lane, FILTERS, good(), MAIN_YML), []);
  assert.deepEqual(mainProblems(MAIN_YML), []);
});

test('lane rules: push on main, not reusable, not called by main.yml, narrowing, concurrency, cache keys', () => {
  const rules = (yaml: string, l: Lane = lane, main = MAIN_YML) =>
    laneProblems('l', l, FILTERS, yaml, main).map((p) => p.rule);
  assert.deepEqual(rules(good('  workflow_call:\n  push:\n    branches: [main]\n')), ['queue']);
  assert.deepEqual(rules(good('  push:\n    branches: [main]\n')), ['queue', 'queue']);
  assert.deepEqual(rules(good(), lane, MAIN_YML.replace("'l')", "'m')")), ['queue']);
  assert.deepEqual(rules(good(), lane, MAIN_YML.replace('l.yml', 'm.yml')), ['queue']);
  assert.deepEqual(rules(good(), { ...lane, shared: ['apps/web/**', 'docs/**'] }), ['narrowing']);
  assert.deepEqual(rules(good(), { ...lane, shared: [], extra: [] }), ['paths']);
  assert.deepEqual(rules(good(), { ...lane, always: true }), ['paths']);
  assert.deepEqual(rules(good(), { ...lane, shared: [], extra: [], always: true }), []);
  assert.deepEqual(
    rules(good(undefined, 'concurrency:\n  group: x\n  cancel-in-progress: true\n')),
    ['concurrency'],
  );
  assert.deepEqual(
    rules(good(undefined, 'concurrency:\n  group: x\n  cancel-in-progress: false\n')),
    [],
  );
  assert.deepEqual(rules(good(undefined, undefined, 'deps-${{ github.ref }}')), ['cache']);
  assert.deepEqual(rules(good(undefined, undefined, 'runtime-${{ github.run_id }}')), ['cache']);
  assert.deepEqual(rules(good(undefined, undefined, 'runtime-d9e37e50-sha256')), []);
});

test('main.yml rules: on push to main, group main, never cancelling', () => {
  const rules = (y: string) => mainProblems(y).map((p) => p.detail);
  assert.equal(rules(MAIN_YML.replace('group: main', 'group: other')).length, 1);
  assert.equal(
    rules(MAIN_YML.replace('cancel-in-progress: false', 'cancel-in-progress: true')).length,
    1,
  );
  assert.equal(rules(MAIN_YML.replace('branches: [main]', "branches: ['x']")).length, 1);
});

test('a fixture tree where a second workflow runs on push to main fails', () => {
  const root = tree({
    'apps/web/src/a.ts': 'export {}',
    '.github/workflows/main.yml': MAIN_YML,
    '.github/workflows/l.yml': good(),
    '.github/workflows/rogue.yml': 'on:\n  push:\n    branches: [main]\n',
  });
  const r = check(root, { ...FILTERS, lanes: { l: lane } });
  assert.deepEqual(
    r.problems.map((p) => p.detail),
    ['.github/workflows/rogue.yml runs on push to main outside main.yml'],
  );
  rmSync(root, { recursive: true });
});

test('a uses step that carries working-directory, shell or run is found; run steps and with/env are not', () => {
  const steps = (extra: string) =>
    `jobs:\n  a:\n    steps:\n      - uses: ./.github/actions/x\n        with:\n          y: 1\n${extra}      - run: echo\n        working-directory: apps/web\n        shell: bash\n`;
  assert.deepEqual(runKeysOnUses(steps('')), []);
  assert.deepEqual(runKeysOnUses(steps('        env:\n          A: b\n')), []);
  assert.equal(runKeysOnUses(steps('        working-directory: apps/web\n')).length, 1);
  assert.equal(runKeysOnUses(steps('        shell: bash\n')).length, 1);
});

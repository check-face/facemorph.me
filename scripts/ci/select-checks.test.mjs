import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_SUITES,
  RULES,
  SEGMENTS,
  SUITES,
  changedFiles,
  globRegExp,
  ruleFor,
  selectChecks,
} from './select-checks.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const nothing = {
  functional: [],
  timing: [],
  engine: false,
  cells: false,
  any: false,
  full: false,
};
const pick = (r) => ({
  functional: r.functional,
  timing: r.timing,
  engine: r.engine,
  cells: r.cells,
  any: r.any,
  full: r.full,
});

test('globs: ** spans segments (and none), * stays inside one', () => {
  assert.ok(globRegExp('**/*.md').test('README.md'));
  assert.ok(globRegExp('**/*.md').test('docs/dev/release.md'));
  assert.ok(globRegExp('a/**').test('a/b/c.ts'));
  assert.ok(globRegExp('a/*.ts').test('a/b.ts'));
  assert.ok(!globRegExp('a/*.ts').test('a/b/c.ts'));
  assert.ok(!globRegExp('a.b').test('axb'));
});

test('fail safe: an unknown path, no base or an empty diff selects everything', () => {
  const all = {
    functional: SUITES,
    timing: SEGMENTS,
    engine: true,
    cells: true,
    any: true,
    full: true,
  };
  assert.deepEqual(pick(selectChecks(['services/new-thing/index.ts'])), all);
  assert.deepEqual(pick(selectChecks(['README.md', 'Makefile'])), all);
  assert.deepEqual(pick(selectChecks(null)), all);
  assert.deepEqual(pick(selectChecks([])), all);
  assert.deepEqual(pick(selectChecks(['README.md'], { full: true })), all);
});

test('docs, beads and unit tests select nothing', () => {
  assert.deepEqual(
    pick(
      selectChecks([
        'README.md',
        'docs/dev/release.md',
        '.beads/issues.jsonl',
        'apps/web/src/controller/reducers/crop.test.ts',
        'scripts/ci/select-checks.test.mjs',
        'autoresearch/notes/x.json',
      ]),
    ),
    nothing,
  );
});

test('a changed release suite selects only itself; a non-release e2e file selects nothing', () => {
  assert.deepEqual(selectChecks(['apps/web/test/e2e/blend.e2e.ts']).functional, ['blend']);
  assert.deepEqual(selectChecks(['apps/web/test/e2e/result-actions.e2e.ts']).functional, [
    'result-actions',
  ]);
  assert.deepEqual(pick(selectChecks(['apps/web/test/e2e/facade.e2e.ts'])), nothing);
});

test('every release suite is selectable by its own file, and the file exists', () => {
  for (const suite of SUITES) {
    const path = `apps/web/test/e2e/${suite}.e2e.ts`;
    assert.ok(existsSync(`${ROOT}${path}`), `${path} exists`);
    assert.deepEqual(selectChecks([path]).functional, [suite]);
  }
});

test('the manifest list matches verify-functional.ts', async () => {
  const { VERIFY_FUNCTIONAL } = await import(
    `${ROOT}apps/web/test/verify/cases/verify-functional.ts`
  );
  const files = [
    ...new Set(VERIFY_FUNCTIONAL.cases.map((c) => c.test.file.replace(/\.e2e\.ts$/, ''))),
  ].sort();
  assert.deepEqual(files, [...MANIFEST_SUITES].sort());
});

test('every suite a rule names is a release suite', () => {
  for (const rule of RULES)
    if (Array.isArray(rule.functional))
      for (const s of rule.functional) assert.ok(SUITES.includes(s), `${rule.name}: ${s}`);
});

test('a CSS-only change selects its UI suites and no timing', () => {
  const r = selectChecks(['apps/web/shell/render/blend.css']);
  assert.deepEqual(pick(r), { ...nothing, functional: ['blend'], any: true });
  const crop = selectChecks(['apps/web/shell/render/crop.css']);
  assert.ok(crop.functional.includes('crop-acceptance') && crop.functional.includes('encode'));
});

test('result and Save/Share code selects the result suites, debug-reporting included', () => {
  const r = selectChecks(['apps/web/shell/render/ResultActions.tsx']);
  for (const s of ['result-actions', 'morph-output', 'debug-reporting'])
    assert.ok(r.functional.includes(s), s);
  assert.deepEqual(r.timing, []);
});

test("MossyFalcon's paths select result-actions and debug-reporting (fm-7u7z)", () => {
  for (const path of [
    'apps/web/shell/render/ResultActions.tsx',
    'apps/web/shell/render/FaceTile.tsx',
    'apps/web/shell/render/VideoSlot.tsx',
    'apps/web/shell/render/BlendView.tsx',
    'apps/web/src/contracts/prepared-file-cache.ts',
    'apps/web/src/contracts/export-identity.ts',
    'apps/web/src/media/export-policy.ts',
    'apps/web/src/Next/export-files.mjs',
    'apps/web/src/Next/image-encoder.mjs',
    'apps/web/src/Next/recovery-metadata.mjs',
    'apps/web/src/Next/video-worker.mjs',
    'apps/web/shell/facade/bridge.ts',
  ])
    assert.ok(selectChecks([path]).functional.includes('result-actions'), path);
  for (const path of [
    'apps/web/src/Next/reporting.mjs',
    'apps/web/src/Next/usage-stats.mjs',
    'apps/web/src/Next/analytics.mjs',
    'apps/web/src/consent/requests.ts',
    'apps/web/src/analytics/usage-stats.ts',
    'apps/web/shell/render/StoredData.tsx',
    'apps/web/shell/render/Support.tsx',
    'apps/web/shell/render/Dialogs.tsx',
    'apps/web/shell/render/help.ts',
  ])
    assert.ok(selectChecks([path]).functional.includes('debug-reporting'), path);
});

test('photo code adds photo timing; morph scheduling adds morph timing', () => {
  assert.deepEqual(selectChecks(['apps/web/src/Next/photo/crop.mjs']).timing, ['photo']);
  assert.deepEqual(selectChecks(['apps/web/src/controller/reducers/schedule.ts']).timing, [
    'morph',
  ]);
});

test('shared shell or controller code selects every functional suite but no timing or cells', () => {
  for (const path of [
    'apps/web/shell/Product.tsx',
    'apps/web/src/controller/state.ts',
    'apps/web/shell/facade/bridge.ts',
  ]) {
    const r = selectChecks([path]);
    assert.deepEqual(r.functional, SUITES, path);
    assert.deepEqual([r.timing, r.engine, r.cells], [[], false, false], path);
  }
});

test('engine, runtime, packages and lockfile select everything', () => {
  for (const path of [
    'packages/stylegan-js/src/index.ts',
    'apps/web/src/operations/bridge-service.ts',
    'import/build-inputs.json',
    'package-lock.json',
    'apps/web/src/Next/browser/ort-worker.mjs',
  ])
    assert.equal(selectChecks([path]).full, true, path);
});

test('CI workflows and tooling select nothing (dispatch qualify.yml full=true to run them)', () => {
  assert.deepEqual(
    pick(
      selectChecks([
        '.github/workflows/release.yml',
        '.github/workflows/packages.yml',
        'scripts/ci/release-local.mjs',
      ]),
    ),
    nothing,
  );
});

test('other product modules select every suite; the browser runtime selects everything', () => {
  assert.deepEqual(selectChecks(['apps/web/src/Next/media.mjs']).functional, SUITES);
  assert.equal(selectChecks(['apps/web/src/Next/media.mjs']).timing.length, 0);
  assert.equal(selectChecks(['apps/web/src/Next/browser/runtime.mjs']).full, true);
});

test('device lab selects the cells; the timing harness selects timing; deploy code selects the cells', () => {
  assert.deepEqual(pick(selectChecks(['tools/device-lab/lab.py'])), {
    ...nothing,
    cells: true,
    any: true,
  });
  assert.deepEqual(selectChecks(['scripts/verify/not-worse/median-check.mjs']).timing, SEGMENTS);
  assert.equal(selectChecks(['scripts/hosting/deploy.mjs']).cells, true);
});

test('selections union across paths, and the first matching rule wins', () => {
  const r = selectChecks([
    'apps/web/shell/render/blend.css',
    'apps/web/shell/render/ProviderSelector.tsx',
  ]);
  assert.deepEqual(r.functional, ['blend', 'provider-selector']);
  // A unit test under the photo directory is a unit test, not photo code.
  assert.equal(
    ruleFor('apps/web/src/Next/photo/crop-view.test.mjs').name,
    'unit tests (check.yml)',
  );
});

test('changedFiles: a missing or all-zero base has no diff', () => {
  assert.equal(changedFiles(undefined, 'HEAD'), null);
  assert.equal(changedFiles('0000000000000000000000000000000000000000', 'HEAD'), null);
  assert.equal(changedFiles('not-a-commit', 'HEAD'), null);
});

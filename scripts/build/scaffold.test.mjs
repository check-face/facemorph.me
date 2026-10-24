#!/usr/bin/env node
// fm-fy2.4 unit tests for the scaffold and interop judges (plain values; the real runs
// over the real tree are the operated checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWorkspaces,
  checkScripts,
  checkStrictness,
  checkLayout,
  checkOxfmtConfig,
  checkOxlintConfig,
  checkScope,
  checkInstalls,
  checkRoots,
  WORKSPACES,
  OXC_SCRIPTS,
} from './check-scaffold.mjs';
import { readFileSync } from 'node:fs';
import { findAdapters, judgeAdapters, judgeRenames } from './interop-check.mjs';

test('workspaces must be exactly apps/web plus the four packages', () => {
  assert.equal(checkWorkspaces({})[0].rule, 'workspaces-exact', 'no workspaces is a violation');
  assert.deepEqual(checkWorkspaces({ workspaces: WORKSPACES }), []);
  const nearMiss = checkWorkspaces({ workspaces: WORKSPACES.slice(1) });
  assert.equal(nearMiss[0].rule, 'workspaces-exact');
});

test('the four oxc scripts are exact, and oxlint and oxfmt are caret ranges', () => {
  assert.deepEqual(
    checkScripts({
      scripts: { ...OXC_SCRIPTS },
      devDependencies: { oxlint: '^1.89.0', oxfmt: '^0.74.0' },
    }),
    [],
  );
  const missing = checkScripts({
    scripts: {},
    devDependencies: { oxlint: '^1.89.0', oxfmt: '^0.74.0' },
  });
  assert.equal(missing.length, 4);
  assert.ok(missing.every((v) => v.rule === 'oxc-script'));
  const pinned = checkScripts({
    scripts: { ...OXC_SCRIPTS },
    devDependencies: { oxlint: '1.89.0', oxfmt: '~0.74.0' },
  });
  assert.deepEqual(
    pinned.map((v) => v.rule),
    ['oxc-caret', 'oxc-caret'],
  );
  assert.match(pinned[0].detail, /oxlint/);
  assert.equal(
    checkScripts({ scripts: { ...OXC_SCRIPTS }, devDependencies: {} }).length,
    2,
    'both tools must be declared',
  );
});

test('base strictness is required and package lowering is a violation', () => {
  const good = {
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      isolatedModules: true,
    },
  };
  assert.deepEqual(
    checkStrictness(good, { 'packages/x/tsconfig.json': { extends: '../../tsconfig.base.json' } }),
    [],
  );
  const weaker = {
    ...good,
    compilerOptions: { ...good.compilerOptions, exactOptionalPropertyTypes: false },
  };
  assert.deepEqual(checkStrictness(weaker, {}), [
    { rule: 'base-strict', detail: 'tsconfig.base.json exactOptionalPropertyTypes must be true' },
  ]);
  const lowered = checkStrictness(good, {
    'packages/x/tsconfig.json': { compilerOptions: { noUncheckedIndexedAccess: false } },
  });
  assert.deepEqual(lowered, [
    { rule: 'strict-override', detail: 'packages/x/tsconfig.json lowers noUncheckedIndexedAccess' },
  ]);
});

test('banned lockfiles and orchestrators fail the layout check', () => {
  assert.deepEqual(checkLayout(['package.json', 'apps']), []);
  const violations = checkLayout(['pnpm-lock.yaml', 'turbo.json']);
  assert.deepEqual(
    violations.map((v) => v.rule),
    ['banned-file', 'banned-file'],
  );
});

test('oxfmt config: width 100, two spaces, no tabs, both sortings off', () => {
  assert.deepEqual(
    checkOxfmtConfig({
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      sortImports: false,
      sortPackageJson: false,
    }),
    [],
  );
  const violations = checkOxfmtConfig({ printWidth: 120, tabWidth: 4, sortImports: true });
  assert.deepEqual(violations.map((v) => v.rule).sort(), [
    'oxfmt-imports',
    'oxfmt-indent',
    'oxfmt-packages',
    'oxfmt-width',
  ]);
});

test('oxlint config: correctness errors, TypeScript and React with hooks, browser/worker/node overrides', () => {
  const good = {
    categories: { correctness: 'error' },
    plugins: ['typescript', 'react'],
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
    overrides: [
      { files: ['a'], env: { browser: true } },
      { files: ['b'], env: { worker: true } },
      { files: ['c'], env: { node: true } },
    ],
  };
  assert.deepEqual(checkOxlintConfig(good), []);
  const bad = checkOxlintConfig({
    categories: { correctness: 'warn' },
    plugins: ['typescript'],
    rules: {},
    overrides: [{ files: ['a'], env: { browser: true } }],
  });
  assert.deepEqual([...new Set(bad.map((v) => v.rule))].sort(), [
    'oxlint-correctness',
    'oxlint-hooks',
    'oxlint-override',
    'oxlint-plugin',
  ]);
});

test('the shipped configs pass their own checks, and both tools ignore exactly the declared scope', () => {
  const json = (f) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
  const scope = json('scripts/build/oxc-scope.json'),
    oxfmt = json('.oxfmtrc.json'),
    oxlint = json('.oxlintrc.json');
  assert.deepEqual(
    [...checkOxfmtConfig(oxfmt), ...checkOxlintConfig(oxlint), ...checkScope(scope, oxfmt, oxlint)],
    [],
  );
  assert.equal(
    checkScope(scope, { ...oxfmt, ignorePatterns: oxfmt.ignorePatterns.slice(1) }, oxlint)[0].rule,
    'oxc-scope',
  );
  assert.equal(
    checkScope(
      { ...scope, ignore: scope.ignore.filter((p) => p !== 'autoresearch/candidates/**') },
      oxfmt,
      oxlint,
    ).at(-1).rule,
    'oxc-frozen',
  );
});

test('installs: npm ci only, no @latest, no npx <pkg>@<version>', () => {
  assert.deepEqual(
    checkInstalls([['ok.yml', '- run: npm ci --no-audit\n- run: npx wrangler deploy']]),
    [],
  );
  const bad = checkInstalls([
    ['a.yml', 'npm install'],
    ['b.yml', 'npx -y wrangler@4.149.0 deploy'],
    ['c.sh', 'npm i oxlint@latest'],
  ]);
  assert.deepEqual(bad.map((v) => v.rule).sort(), [
    'install-latest',
    'install-npm-install',
    'install-npm-install',
    'install-npx-version',
  ]);
});

test('adapters are package sources importing the closure; they must declare their test', () => {
  const sources = new Map([
    [
      'packages/stylegan-js/src/bridge.ts',
      "import {thing} from '../../apps/web/src/Next/legacy.mjs';\nexport {thing};",
    ],
    ['packages/stylegan-js/src/pure.ts', 'export const two = 2;'],
    [
      'packages/x/src/w.ts',
      "import {w} from '../../apps/web/src/Next/legacy.mjs';\n// adapter-test: packages/x/test/w.test.mts\nexport {w};",
    ],
  ]);
  assert.deepEqual(findAdapters(sources), [
    'packages/stylegan-js/src/bridge.ts',
    'packages/x/src/w.ts',
  ]);
  const present = new Set(['packages/x/test/w.test.mts']);
  const violations = judgeAdapters(sources, (path) => present.has(path));
  assert.deepEqual(violations, [
    {
      path: 'packages/stylegan-js/src/bridge.ts',
      rule: 'adapter-test-missing',
      detail: 'declares `// adapter-test: <file>` next to the closure import',
    },
  ]);
  assert.deepEqual(
    judgeAdapters(new Map([sources.entries().toArray()[2]]), () => false),
    [
      {
        path: 'packages/x/src/w.ts',
        rule: 'adapter-test-file-missing',
        detail: 'packages/x/test/w.test.mts',
      },
    ],
    'a declared test that does not exist fails too',
  );
});

test('a rename-only .mjs -> .ts change is a violation; other renames are not', () => {
  const violations = judgeRenames([
    ['R100', 'packages/stylegan-js/src/old.mjs', 'packages/stylegan-js/src/old.ts'],
    ['R87', 'apps/web/src/a.mjs', 'apps/web/src/a.ts'],
    ['M', 'apps/web/src/b.mjs'],
  ]);
  assert.deepEqual(violations, [
    {
      rule: 'rename-only-interop',
      detail:
        'packages/stylegan-js/src/old.mjs -> packages/stylegan-js/src/old.ts changed only the extension',
    },
  ]);
});

test('root discovery: every tracked top-level directory is in the scope or declared outside it', () => {
  const scope = { included: ['apps', 'packages'], outside: { docs: 'prose' } };
  assert.deepEqual(checkRoots(scope, ['apps', 'docs', 'packages']), []);
  assert.deepEqual(
    checkRoots(scope, ['apps', 'docs', 'packages', 'spikes']).map((v) => v.rule),
    ['oxc-root'],
  );
  assert.deepEqual(
    checkRoots(scope, ['apps', 'packages']).map((v) => v.rule),
    ['oxc-root-stale'],
  );
});

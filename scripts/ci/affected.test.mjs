import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  BASELINE,
  ROOT_ONLY,
  previousSuccessHead,
  selectSuites,
  withDependents,
  workspaceGraph,
} from './affected.mjs';
import { inventory } from './scaffold-test-shards.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const graph = workspaceGraph(read);
const suites = inventory(ROOT).map(({ cwd }) => cwd || '.');
const ALL = [...new Set(suites)].sort();
const pick = (files) => selectSuites(files, graph, suites);

test('the workspace graph follows package.json dependencies between workspaces', () => {
  const deps = Object.fromEntries(graph.map(({ dir, deps }) => [dir, deps]));
  assert.deepEqual(deps['apps/web'], ['packages/browser-model-manager', 'packages/stylegan-js']);
  assert.deepEqual(deps['packages/browser-model-manager'], ['packages/stylegan-js']);
  assert.deepEqual(deps['packages/cloudflare-model-host'], ['packages/browser-model-manager']);
  assert.deepEqual(deps['packages/stylegan-js'], []);
  assert.deepEqual([...withDependents(graph, ['packages/stylegan-js'])].sort(), [
    'apps/web',
    'packages/browser-model-manager',
    'packages/cloudflare-model-host',
    'packages/stylegan-js',
  ]);
});

test('a workspace change runs it, its dependents and the baseline, and nothing else', () => {
  assert.deepEqual(pick(['apps/web/src/index.ts']).suites, ['.', 'apps/web']);
  assert.deepEqual(pick(['packages/cloudflare-model-host/src/a.ts']).suites, [
    '.',
    'apps/web',
    'packages/cloudflare-model-host',
  ]);
  assert.deepEqual(pick(['packages/browser-model-manager/README.md']).suites, [
    '.',
    'apps/web',
    'packages/browser-model-manager',
    'packages/cloudflare-model-host',
  ]);
  assert.deepEqual(pick(['packages/stylegan-js/test/x.test.ts']).suites, ALL);
  // model-conv has no npm-test suite and no dependents.
  assert.deepEqual(pick(['packages/model-conv/convert.py']).suites, BASELINE);
  // A directory sharing a workspace's prefix is not that workspace.
  assert.equal(pick(['packages/stylegan-jsx/a.ts']).full, true);
});

test('root-only paths run the baseline; root config, CI, unknown paths, no base and no diff run everything', () => {
  assert.deepEqual(pick(['.beads/issues.jsonl', 'scripts/hooks/check.mjs']), {
    full: false,
    reason: 'root-only paths',
    suites: BASELINE,
  });
  for (const file of [
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    '.oxlintrc.json',
    '.oxfmtrc.json',
    '.nvmrc',
    '.github/workflows/check.yml',
    '.github/actions/setup-runtime/action.yml',
    'scripts/ci/affected.mjs',
    'scripts/import/build-next.mjs',
    'hosting/next-cloudflare/worker.mjs',
    'docs/dev/README.md',
    'PLAN.md',
    'new-top-level/x.ts',
  ])
    assert.deepEqual(pick(['apps/web/a.ts', file]).suites, ALL, file);
  assert.equal(pick(null).full, true);
  assert.deepEqual(pick(null).suites, ALL);
  assert.deepEqual(pick([]).suites, ALL);
});

test('only the latest earlier successful push or dispatch run on main is a base', () => {
  const sha = (c) => c.repeat(40);
  const run = (n, extra) => ({
    run_number: n,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_sha: sha(String(n % 10)),
    ...extra,
  });
  const listing = {
    workflow_runs: [
      run(1),
      run(3),
      run(4, { conclusion: 'failure' }),
      run(5, { conclusion: 'cancelled' }),
      run(6, { status: 'in_progress', conclusion: null }),
      run(7, { head_branch: 'other' }),
      run(8, { event: 'pull_request' }),
      run(9), // the current run and later ones never count
    ],
  };
  assert.equal(previousSuccessHead(listing, 9), sha('3'));
  assert.equal(previousSuccessHead(listing, 2), sha('1'));
  assert.equal(previousSuccessHead(listing, 1), undefined);
  assert.equal(previousSuccessHead({}, 9), undefined);
  assert.equal(previousSuccessHead(listing, Number('')), undefined);
  assert.equal(
    previousSuccessHead({ workflow_runs: [run(2, { head_sha: 'HEAD' })] }, 9),
    undefined,
  );
});

test('ROOT_ONLY directories stay unread by the packages the baseline does not cover', () => {
  const narrowed = ALL.filter((s) => !BASELINE.includes(s));
  assert.ok(narrowed.length >= 3);
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', ...narrowed], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => f && /\.(?:[cm]?[jt]sx?|json|py|sh)$/.test(f));
  assert.ok(tracked.length > 50);
  const patterns = ROOT_ONLY.map((dir) => {
    const parts = dir.replace(/\/$/, '').split('/');
    const quoted = parts.map((p) => `['"\`]${p.replace(/\./g, '\\.')}['"\`]`).join('\\s*,\\s*');
    return [dir, new RegExp(`${dir.replace(/\./g, '\\.')}|${quoted}`)];
  });
  const hits = [];
  for (const file of tracked) {
    let text;
    try {
      text = read(file);
    } catch {
      continue; // deleted in the working tree
    }
    // Comments may cite research records; only code can read them.
    text = text
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|#|\*|\/\*)/.test(line))
      .join('\n');
    for (const [dir, re] of patterns) if (re.test(text)) hits.push(`${file} reads ${dir}`);
    // A whole-repository scan reads every path: that suite belongs in BASELINE.
    if (/\bls-(?:files|tree)\b/.test(text)) hits.push(`${file} lists the repository`);
  }
  assert.deepEqual(hits, []);
});

test('check.yml runs the selected suites in every quick shard and skips unit when nothing is selected', () => {
  const workflow = parse(read('.github/workflows/check.yml'));
  const { affected, unit } = workflow.jobs;
  assert.ok(
    affected.steps.some(
      (s) =>
        typeof s.run === 'string' &&
        s.run.includes('node scripts/ci/affected.mjs') &&
        s.run.includes('--previous-success check.yml'),
    ),
  );
  assert.equal(affected.outputs.suites, '${{ steps.affected.outputs.suites }}');
  assert.deepEqual(unit.needs, 'affected');
  assert.equal(unit.if, "needs.affected.outputs.suites != '[]'");
  const shard = unit.steps.find((s) => s.run?.includes('scaffold-test-shards.mjs'));
  assert.equal(shard.env.FACEMORPH_TEST_SUITES, '${{ needs.affected.outputs.suites }}');
});

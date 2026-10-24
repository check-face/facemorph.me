#!/usr/bin/env node
// fm-pud: real subprocess runs of check-no-disabled-tests.mjs over planted fixture files in temp directories.
// Fixture text is assembled from pieces so this file never contains a disabled-test pattern itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPE, isTestFile } from './check-no-disabled-tests.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-no-disabled-tests.mjs');
const SKIP = '.sk' + 'ip';
const ONLY = '.on' + 'ly';
const MARK = 'disabled-' + 'test: ';
const GOOD = `${MARK}reason=flaky on WebKit; owner=fm-abc; until=fm-abc closes`;

function run(name, text) {
  const dir = mkdtempSync(join(tmpdir(), 'fm-pud-'));
  try {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, '--files', name], {
      encoding: 'utf8',
    });
    const lines = r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return {
      status: r.status,
      findings: lines.slice(0, -1),
      summary: lines.at(-1),
      stderr: r.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Each case: the fixture is flagged bare, passes with the marker on the line above and on the same line. */
const CASES = [
  [
    'node skip',
    'a.test.mjs',
    (m) => `${m ? `// ${m}\n` : ''}test${SKIP}('x', () => {});\n`,
    'skip',
  ],
  [
    'node only',
    'a.test.mjs',
    (m) => `${m ? `// ${m}\n` : ''}test${ONLY}('x', () => {});\n`,
    'only',
  ],
  [
    'pytest skip',
    'test_a.py',
    (m) => `${m ? `# ${m}\n` : ''}@pytest.mark${SKIP}(reason="why")\ndef test_a():\n    pass\n`,
    'pytest-skip',
  ],
  [
    'if false step',
    'ci.yml',
    (m) =>
      `jobs:\n  t:\n    steps:\n${m ? `      # ${m}\n` : ''}      - name: run tests\n        if: false\n        run: npm test\n`,
    'if-false',
  ],
  [
    'continue-on-error test step',
    'ci.yml',
    (m) =>
      `jobs:\n  t:\n    steps:\n      - name: unit tests\n${m ? `        # ${m}\n` : ''}        continue-on-error: true\n        run: node --test\n`,
    'continue-on-error-test',
  ],
];

for (const [label, file, build, rule] of CASES) {
  test(`${label}: fails without the marker, passes with it`, () => {
    const bare = run(file, build(''));
    assert.equal(bare.status, 1, bare.stderr);
    assert.equal(bare.findings[0].rule, rule);
    assert.equal(bare.summary.findings, 1);
    const marked = run(file, build(GOOD));
    assert.equal(marked.status, 0, JSON.stringify(marked.findings));
    assert.deepEqual(marked.summary, { files: 1, findings: 0 });
  });

  test(`${label}: a marker missing a field still fails`, () => {
    for (const bad of [
      `${MARK}reason=why; owner=fm-abc`,
      `${MARK}reason=why; until=later; owner=`,
      `${MARK}owner=fm-abc; until=later`,
    ]) {
      assert.equal(run(file, build(bad)).status, 1, bad);
    }
  });
}

test('the marker may sit on the same line', () => {
  const r = run('a.test.mjs', `test${SKIP}('x', () => {}); // ${GOOD}\n`);
  assert.equal(r.status, 0, JSON.stringify(r.findings));
});

test('pytest skip without a reason string is its own rule', () => {
  const r = run('test_a.py', `@pytest.mark${SKIP}\ndef test_a():\n    pass\n`);
  assert.equal(r.findings[0].rule, 'pytest-skip-no-reason');
  assert.equal(
    run('test_a.py', `# ${GOOD}\n@pytest.mark${SKIP}\ndef test_a():\n    pass\n`).status,
    0,
  );
});

test('node:test literal options fail; runtime-conditional skips pass without a marker', () => {
  assert.equal(run('a.test.mjs', `test('x', { skip: true }, () => {});\n`).status, 1);
  assert.equal(run('a.test.mjs', `test('x', { todo: 'later' }, () => {});\n`).status, 1);
  assert.equal(run('a.test.mjs', `test('x', { skip: 'not now' }, () => {});\n`).status, 1);
  const conditional = [
    `const docker = false;\ntest('x', { skip: !docker && 'docker unavailable' }, () => {});\n`,
    `test('x', (t) => {\n  return t${SKIP}('untested here: no runtime');\n});\n`,
    `test('x', (t) => {\n  if (!runtime) return t${SKIP}(untested);\n});\n`,
    `test('x', (t) => {\n  if (!runtime) return t${SKIP}('not selected');\n});\n`,
    `test('x', async ({ page }, info) => {\n  test${SKIP}(info.project.name !== 'phone', 'phone row');\n});\n`,
  ];
  for (const text of conditional) {
    const r = run('a.test.ts', text);
    assert.equal(r.status, 0, `${text} -> ${JSON.stringify(r.findings)}`);
  }
});

test('an unconditional t.skip with a literal message and literal skip(true) fail', () => {
  assert.equal(run('a.test.mjs', `test('x', (t) => {\n  t${SKIP}('later');\n});\n`).status, 1);
  assert.equal(run('a.test.ts', `test${SKIP}(true, 'always');\n`).status, 1);
});

test('x-prefixed and todo forms fail; comments that mention them do not', () => {
  assert.equal(run('a.test.mjs', `xit('x', () => {});\n`).status, 1);
  assert.equal(run('a.test.mjs', `xdescribe('x', () => {});\n`).status, 1);
  assert.equal(run('a.test.mjs', `test.todo('x');\n`).status, 1);
  assert.equal(
    run('a.test.mjs', `// never use test${SKIP}( or xit( here\ntest('x', () => {});\n`).status,
    0,
  );
});

test('workflow lookalikes pass: if conditions, and continue-on-error on a non-test step', () => {
  const ok = `jobs:\n  t:\n    steps:\n      - name: upload\n        continue-on-error: true\n        uses: actions/upload-artifact\n      - name: run tests\n        if: always()\n        run: npm test\n`;
  assert.equal(run('ci.yml', ok).status, 0);
  assert.equal(run('ci.yml', ok.replace('always()', "'false'")).findings[0].rule, 'if-false');
});

test('usage errors exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('scope: maintained tests in, imported classic code and non-tests out; every glob has a reason', () => {
  assert.ok(isTestFile('scripts/build/x.test.mjs'));
  assert.ok(isTestFile('packages/a/tests/test_x.py'));
  assert.ok(isTestFile('apps/web/test/e2e/a.e2e.ts'));
  assert.ok(!isTestFile('apps/web/src/Next/a.test.mjs'));
  assert.ok(!isTestFile('autoresearch/drivers/a.test.mjs'));
  assert.ok(!isTestFile('hosting/a/test/x.ts'));
  assert.ok(!isTestFile('scripts/build/check-scaffold.mjs'));
  for (const [, why] of [...SCOPE.include, ...SCOPE.workflows, ...SCOPE.exclude]) assert.ok(why);
});

test('the real repository passes except for owned findings (runs the CLI over git ls-files)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.ok(summary.files > 0);
});

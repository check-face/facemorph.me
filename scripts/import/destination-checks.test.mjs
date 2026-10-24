// Pure parts of the destination checks (fm-5ey), called with plain values; the checks themselves run in CI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { listedFindings, nodeTestCounts, testFiles } from './destination-checks.mjs';
import { plant, tempDir } from '../inventory/testing.mjs';

test('every present test file must be run here or owned elsewhere', () => {
  const rows = [
    { file: 'src/Next/a.test.mjs', runs_on: 'closure' },
    { file: 'src/Next/b.test.mjs', runs_on: 'needs files left in classic', owner: 'fm-x' },
    { file: 'src/Next/c.test.mjs', runs_on: 'needs files left in classic' },
  ];
  assert.deepEqual(listedFindings(['src/Next/a.test.mjs', 'src/Next/b.test.mjs'], rows), []);
  assert.deepEqual(listedFindings(['src/Next/new.test.mjs'], rows), [
    { file: 'src/Next/new.test.mjs', problem: 'not run and not owned' },
  ]);
  assert.deepEqual(listedFindings(['src/Next/c.test.mjs'], rows), [
    { file: 'src/Next/c.test.mjs', problem: 'left in classic with no owner' },
  ]);
});

test('node --test summary counts; a missing summary is NaN, never zero-as-pass', () => {
  assert.deepEqual(nodeTestCounts('ok 1 - x\nℹ tests 283\nℹ suites 0\nℹ pass 282\nℹ fail 1\n'), {
    tests: 283,
    pass: 282,
    fail: 1,
  });
  assert.deepEqual(nodeTestCounts('TAP version 13\nok 1 - x\n# tests 3\n# pass 3\n# fail 0\n'), {
    tests: 3,
    pass: 3,
    fail: 0,
  });
  const none = nodeTestCounts('nothing ran');
  assert.ok(Number.isNaN(none.tests) && !(none.tests > 0));
});

test('test files are found recursively with posix paths', () => {
  const dir = plant(tempDir('dest-'), {
    'a.test.mjs': '',
    'browser/b.test.mjs': '',
    'browser/c.mjs': '',
  });
  assert.deepEqual(testFiles(dir), ['a.test.mjs', 'browser/b.test.mjs']);
});

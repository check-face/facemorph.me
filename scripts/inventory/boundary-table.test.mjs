#!/usr/bin/env node
// fm-p7v: unit tests for the hosting-boundary table parser/comparer (plain values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWithTree, parseBoundaryTable } from './check-hosting-boundary.mjs';

const md = `
# t

| path | destination | reason |
|---|---|---|
| hosting/a/one.py | hosting/ | staging stays app-side |
| hosting/a/two.py | packages/cloudflare-model-host | chunking is package machinery |
| hosting/a/three.py | split | worker functions to packages/cloudflare-model-host, glue to hosting/ |
| hosting/a/.wrangler/x.sqlite | historical | committed local state, junk |
`;

test('the parser skips headers, separators and prose rows', () => {
  const rows = parseBoundaryTable(md);
  assert.deepEqual(
    rows.map((r) => r.path),
    ['hosting/a/one.py', 'hosting/a/two.py', 'hosting/a/three.py', 'hosting/a/.wrangler/x.sqlite'],
  );
  assert.equal(rows[1].destination, 'packages/cloudflare-model-host');
});

test('a file in the tree without a table row is unassigned', () => {
  const violations = compareWithTree(parseBoundaryTable(md), [
    'hosting/a/one.py',
    'hosting/a/two.py',
    'hosting/a/three.py',
    'hosting/a/.wrangler/x.sqlite',
    'hosting/a/four.py',
  ]);
  assert.deepEqual(
    violations.map((v) => v.rule),
    ['unassigned'],
  );
  assert.equal(violations[0].path, 'hosting/a/four.py');
});

test('a table row without a tree file is stale; duplicates and bad destinations fail', () => {
  const violations = compareWithTree(parseBoundaryTable(md), ['hosting/a/one.py']);
  assert.deepEqual(violations.map((v) => `${v.path}:${v.rule}`).sort(), [
    'hosting/a/.wrangler/x.sqlite:stale',
    'hosting/a/three.py:stale',
    'hosting/a/two.py:stale',
  ]);
  assert.ok(
    compareWithTree(
      [
        { path: 'a', destination: 'npm', reason: 'x' },
        { path: 'a', destination: 'hosting/', reason: 'y' },
      ],
      ['a'],
    ).some((v) => v.rule === 'bad-destination'),
  );
  assert.ok(
    compareWithTree(
      [
        { path: 'a', destination: 'hosting/', reason: 'x' },
        { path: 'a', destination: 'hosting/', reason: 'y' },
      ],
      ['a'],
    ).some((v) => v.rule === 'duplicate-row'),
  );
});

test('a split row must name both homes', () => {
  assert.deepEqual(
    compareWithTree(
      [
        {
          path: 'a',
          destination: 'split',
          reason: 'worker functions to packages/cloudflare-model-host, glue to hosting/',
        },
      ],
      ['a'],
    ),
    [],
  );
  assert.ok(
    compareWithTree(
      [{ path: 'a', destination: 'split', reason: 'half here, half there' }],
      ['a'],
    ).some((v) => v.rule === 'split-underspecified'),
  );
});

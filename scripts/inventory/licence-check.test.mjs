import assert from 'node:assert/strict';
import test from 'node:test';
import { coverage } from './licence-check.mjs';

const row = (id, applies_to, extra = {}) => ({ id, subject: id, licence: 'MIT', provenance: 'upstream', evidence: ['NOTICE'], redistribution: 'permitted', applies_to, ...extra });
const FILES = [{ source: 'src/Next/a.mjs' }, { source: 'src/public/fonts/roboto.woff2' }];
const ASSETS = [{ path: 'assets/x/mapping.onnx' }, { path: 'chunks/1.bin', of: 'assets/y/synthesis.onnx' }];

test('every file and asset covered: no findings; a chunk is matched by its asset', () => {
  const rows = [
    row('app', { allowlist: ['src/Next/'] }),
    row('fonts', { allowlist: ['src/public/fonts/*.woff2'] }),
    row('stylegan', { runtime: ['assets/*/mapping.onnx', 'assets/*/synthesis.onnx'] }, { redistribution: 'unresolved', unresolved: 'NC licence' }),
  ];
  assert.deepEqual(coverage(rows, FILES, ASSETS), []);
});

test('a file without a licence row fails, as does an asset whose chunk parent has none', () => {
  const rows = [row('app', { allowlist: ['src/Next/'] }), row('mapping', { runtime: ['assets/*/mapping.onnx'] })];
  assert.deepEqual(coverage(rows, FILES, ASSETS), [{ uncovered: 'src/public/fonts/roboto.woff2', set: 'allowlist' }, { uncovered: 'chunks/1.bin', set: 'runtime' }]);
});

test('rows need licence, provenance, evidence and a verdict; unresolved needs its question; dead rows are reported', () => {
  const rows = [
    row('all', { allowlist: ['**'], runtime: ['**'] }),
    row('bare', { allowlist: ['src/'] }, { evidence: [], redistribution: 'maybe', provenance: '' }),
    row('open', { allowlist: ['src/'] }, { redistribution: 'unresolved' }),
    row('dead', { allowlist: ['nothing/'] }),
  ];
  assert.deepEqual(coverage(rows, FILES, ASSETS), [
    { row: 'bare', problem: 'missing provenance, evidence, redistribution' },
    { row: 'open', problem: 'missing unresolved' },
    { row: 'dead', problem: 'matches no allowlist file or runtime asset' },
  ]);
});

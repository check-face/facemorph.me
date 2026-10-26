import assert from 'node:assert/strict';
import test from 'node:test';
import { addedNotices, coverage, noticeFindings } from './licence-check.mjs';
import { sha256 } from './lib.mjs';

const row = (id, applies_to, extra = {}) => ({
  id,
  subject: id,
  licence: 'MIT',
  provenance: 'upstream',
  evidence: ['NOTICE'],
  redistribution: 'permitted',
  applies_to,
  ...extra,
});
const FILES = [{ source: 'src/Next/a.mjs' }, { source: 'src/public/fonts/roboto.woff2' }];
const ASSETS = [
  { path: 'assets/x/mapping.onnx' },
  { path: 'chunks/1.bin', of: 'assets/y/synthesis.onnx' },
];

test('every file and asset covered: no findings; a chunk is matched by its asset', () => {
  const rows = [
    row('app', { allowlist: ['src/Next/'] }),
    row('fonts', { allowlist: ['src/public/fonts/*.woff2'] }),
    row(
      'stylegan',
      { runtime: ['assets/*/mapping.onnx', 'assets/*/synthesis.onnx'] },
      { redistribution: 'unresolved', unresolved: 'NC licence' },
    ),
  ];
  assert.deepEqual(coverage(rows, FILES, ASSETS), []);
});

test('a file without a licence row fails, as does an asset whose chunk parent has none', () => {
  const rows = [
    row('app', { allowlist: ['src/Next/'] }),
    row('mapping', { runtime: ['assets/*/mapping.onnx'] }),
  ];
  assert.deepEqual(coverage(rows, FILES, ASSETS), [
    { uncovered: 'src/public/fonts/roboto.woff2', set: 'allowlist' },
    { uncovered: 'chunks/1.bin', set: 'runtime' },
  ]);
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

test('a notice file must be in classic, a runtime asset, or an added notice with its recorded bytes', () => {
  const rows = [
    row('a', {}, { notice_file: 'hosting/next/notices/a.txt' }),
    row('b', {}, { notices: [{ file: 'hosting/next/notices/b.txt' }, { file: 'notices/c.txt' }] }),
    row('d', {}, { notice_file: 'hosting/next/notices/d.txt' }),
  ];
  const where = {
    runtime: (p) => p === 'notices/c.txt',
    classic: (p) => p === 'hosting/next/notices/a.txt',
    added: (p) => p === 'hosting/next/notices/b.txt',
  };
  assert.deepEqual(
    noticeFindings(rows, where).map((f) => f.row),
    ['d'],
  );
  const bytes = Buffer.from('terms');
  const provenance = {
    addedFiles: [
      { path: 'x.txt', sha256: sha256(bytes), bytes: bytes.length },
      { path: 'changed.txt', sha256: sha256(bytes), bytes: bytes.length },
      { path: 'missing.txt', sha256: sha256(bytes), bytes: bytes.length },
      { path: 'unrecorded.txt' },
    ],
  };
  const read = (p) =>
    ({ 'x.txt': bytes, 'changed.txt': Buffer.from('other'), 'unrecorded.txt': bytes })[p] ?? null;
  assert.deepEqual([...addedNotices(provenance, read)], ['x.txt']);
});

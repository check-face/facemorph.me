import assert from 'node:assert/strict';
import test from 'node:test';
import {
  testListFindings,
  acquiredFindings,
  artifactJob,
  deriveRuntime,
  ledgerFindings,
  rowFindings,
} from './check-build-inputs.mjs';
import { sha256 } from './lib.mjs';
import { gitRepo, plant, tempDir } from './testing.mjs';

const ORIGIN = 'https://next.example';

test('runtime rows: pins from the overlay manifest, overlay and repository files located in classic, chunks marked', () => {
  const repo = gitRepo();
  const overlayBytes = 'split\n';
  const manifest = {
    mapping: { url: `${ORIGIN}/runtime/assets/m/mapping.onnx`, sha256: 'a'.repeat(64), size: 8 },
    split: {
      url: `${ORIGIN}/runtime/assets/s/split.json`,
      sha256: sha256(overlayBytes),
      size: overlayBytes.length,
    },
    codec: {
      url: `${ORIGIN}/runtime/assets/c/codec.wasm`,
      sha256: 'b'.repeat(64),
      size: 32,
      chunks: [{ url: `${ORIGIN}/runtime/chunks/1.bin`, sha256: 'c'.repeat(64), size: 32 }],
    },
    photo: {
      manifestUrl: `${ORIGIN}/runtime/photo/p/manifest.json`,
      manifestSha256: 'd'.repeat(64),
      workerUrl: `${ORIGIN}/runtime/photo/p/photo-worker.mjs`,
      workerSha256: sha256('worker\n'),
    },
  };
  const commit = repo.commit(
    {
      'hosting/next-static/runtime-overlay/manifest.json': JSON.stringify(manifest),
      'hosting/next-static/runtime-overlay/assets/s/split.json': overlayBytes,
      'hosting/next/notices/LICENSE.txt': 'notice\n',
      ...Object.fromEntries(
        ['align-photo.mjs', 'image-header.mjs', 'sha256.mjs', 'THIRD_PARTY_NOTICES.txt'].map(
          (n) => [`photo-runtime/${n}`, `${n}\n`],
        ),
      ),
      'photo-runtime/photo-worker.mjs': 'worker\n',
    },
    'runtime',
  );
  const { rows, nested, findings } = deriveRuntime(repo.dir, commit, ORIGIN);
  assert.deepEqual(findings, []);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), [
    'assets/m/mapping.onnx',
    'assets/s/split.json',
    'chunks/1.bin',
    'manifest.json',
    'notices/LICENSE.txt',
    'photo/p/THIRD_PARTY_NOTICES.txt',
    'photo/p/align-photo.mjs',
    'photo/p/image-header.mjs',
    'photo/p/manifest.json',
    'photo/p/photo-worker.mjs',
    'photo/p/sha256.mjs',
  ]);
  assert.equal(byPath['assets/m/mapping.onnx'].location, `${ORIGIN}/runtime/assets/m/mapping.onnx`);
  assert.deepEqual(byPath['assets/m/mapping.onnx'].acquire, ['mirror-runtime', 'single-file']);
  assert.equal(
    byPath['assets/s/split.json'].location,
    'classic:hosting/next-static/runtime-overlay/assets/s/split.json',
  );
  assert.equal(
    byPath['photo/p/photo-worker.mjs'].location,
    'classic:photo-runtime/photo-worker.mjs',
  );
  assert.equal(byPath['chunks/1.bin'].of, 'assets/c/codec.wasm');
  assert.equal(byPath['chunks/1.bin'].of_sha256, 'b'.repeat(64));
  assert.equal(byPath['manifest.json'].sha256, sha256(JSON.stringify(manifest)));
  assert.deepEqual(
    nested.map((n) => [n.path, n.followed]),
    [['photo/p/manifest.json', false]],
    'a nested manifest with no copy is listed, not followed',
  );
});

test('runtime rows: a repository file that differs from its runtime pin is a finding', () => {
  const repo = gitRepo();
  const manifest = {
    photo: {
      manifestUrl: `${ORIGIN}/runtime/photo/p/manifest.json`,
      manifestSha256: 'd'.repeat(64),
      workerUrl: `${ORIGIN}/runtime/photo/p/photo-worker.mjs`,
      workerSha256: 'e'.repeat(64),
    },
  };
  const commit = repo.commit(
    {
      'hosting/next-static/runtime-overlay/manifest.json': JSON.stringify(manifest),
      'hosting/next/notices/x.txt': 'x',
      ...Object.fromEntries(
        [
          'align-photo.mjs',
          'photo-worker.mjs',
          'image-header.mjs',
          'sha256.mjs',
          'THIRD_PARTY_NOTICES.txt',
        ].map((n) => [`photo-runtime/${n}`, n]),
      ),
    },
    'drift',
  );
  assert.deepEqual(
    deriveRuntime(repo.dir, commit, ORIGIN).findings.map((f) => f.path),
    ['photo/p/photo-worker.mjs'],
  );
});

test('every asset row needs a location, a sha256 and defined acquisition commands', () => {
  const commands = { 'mirror-runtime': {}, 'single-file': {} };
  const good = {
    path: 'a',
    location: 'https://x/runtime/a',
    sha256: 'f'.repeat(64),
    acquire: ['mirror-runtime', 'single-file'],
  };
  assert.deepEqual(rowFindings([good], commands), []);
  const problems = rowFindings(
    [
      { ...good, location: '' },
      { ...good, sha256: 'short' },
      { ...good, acquire: ['unknown'] },
      { ...good, acquire: [] },
    ],
    commands,
  ).map((f) => f.problem);
  assert.deepEqual(problems, [
    'no location',
    'no sha256',
    'acquisition command missing or undefined',
    'acquisition command missing or undefined',
  ]);
});

test('the frozen workflow artifact job yields its steps and its node --test list', () => {
  const workflow = [
    'jobs:',
    '  artifact:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Every test file is actually run',
    '        run: node scripts/check-tests-listed.mjs',
    '      - name: Tests',
    '        run: node --test a.test.mjs  b/c.test.mjs',
    '  qualify:',
    '    steps:',
    '      - name: Not this job',
  ].join('\n');
  assert.deepEqual(artifactJob(workflow), {
    steps: ['Every test file is actually run', 'Tests'],
    tests: ['a.test.mjs', 'b/c.test.mjs'],
  });
});

test('the ledger needs defects 1-23 with evidence, status and lead bead, four open questions and declared changes', () => {
  const defects = Array.from({ length: 23 }, (_, i) => ({
    id: `defect:${i + 1}`,
    evidence: 'operated',
    status: 'required',
    lead_bead: 'fm-x',
  }));
  const ledger = { defects, open_questions: [1, 2, 3, 4], declared_changes: [{}] };
  assert.deepEqual(ledgerFindings(ledger), []);
  const short = {
    ...ledger,
    defects: defects
      .filter((d) => d.id !== 'defect:20')
      .map((d) => (d.id === 'defect:3' ? { ...d, status: undefined } : d)),
    open_questions: [1],
  };
  assert.deepEqual(
    ledgerFindings(short).map((f) => f.problem),
    [
      'candidate_ledger has no defect:20',
      'evidence, status and lead_bead are required',
      'candidate_ledger needs the four open audit questions',
    ],
  );
});

test('an acquired tree must hold exactly the rows, byte for byte', () => {
  const rows = [
    { path: 'a/x.bin', sha256: sha256('x') },
    { path: 'y.json', sha256: sha256('y') },
  ];
  assert.deepEqual(acquiredFindings(plant(tempDir(), { 'a/x.bin': 'x', 'y.json': 'y' }), rows), {
    out: [],
    files: 2,
  });
  const { out } = acquiredFindings(
    plant(tempDir(), { 'a/x.bin': 'tampered', 'stale.bin': 's' }),
    rows,
  );
  assert.deepEqual(
    out.map((f) => f.problem),
    [
      'acquired bytes differ from the row',
      'acquired file has no asset row',
      'asset row missing from the acquired tree',
    ],
  );
});

test('test rows match the frozen next-site.yml list; a monorepo-added row needs its bead and reason', () => {
  const tests = ['a.test.mjs', 'b.test.mjs'];
  const frozen = tests.map((file) => ({ file, runs_on: 'closure' }));
  const added = { file: 'c.test.mjs', runs_on: 'closure', added: { bead: 'fm-x', reason: 'new' } };
  assert.deepEqual(testListFindings([...frozen, added], tests), []);
  assert.deepEqual(testListFindings([...frozen, { ...added, added: { bead: 'fm-x' } }], tests), [
    { test: 'c.test.mjs', problem: 'added without its bead and reason' },
  ]);
  assert.deepEqual(
    testListFindings([...frozen, { file: 'c.test.mjs', runs_on: 'closure' }], tests),
    [{ test: 'c.test.mjs', problem: 'node_test_files row not in next-site.yml' }],
  );
  assert.deepEqual(testListFindings(frozen.slice(1), tests), [
    { test: 'a.test.mjs', problem: 'next-site.yml test without a node_test_files row' },
  ]);
});

// Research-tree import (bead fm-86u) against real temporary Git repositories: a "classic" repository with a
// committed autoresearch/ tree and uncommitted edits, and a destination repository. Planted fixture files
// (ONNX, safetensors, PyTorch, a token) are inputs for the scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { treeFiles, buildDigestList, importFiles, checkImport, scanFile, ledgerFacts, sha256 } from './lib.mjs';
import { consumers, uncommitted, census } from './import.mjs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (root, path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'fm-86u-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  sh(root, 'config', 'user.email', 'test@invalid');
  sh(root, 'config', 'user.name', 'test');
  return root;
}

const LEDGER = 'experiment_id\tlane\tstatus\tevidence\nr1\tcpu\tkeep\ta.md\nr2\tgpu\tinconclusive\tb.md\nr3\tgpu\tkeep\tc.md\n';

// A classic repository: committed tree, a consumer file, then uncommitted edits.
function classic() {
  const root = repo();
  put(root, 'autoresearch/README.md', '# research\n');
  put(root, 'autoresearch/results.tsv', LEDGER);
  put(root, 'autoresearch/run.py', 'print(1)\n');
  put(root, 'autoresearch/.gitignore', 'state/\n__pycache__/\n');
  put(root, 'autoresearch/candidates/a-v1/report.json', '{"ms":12}\n');
  put(root, 'autoresearch/candidates/a-v1/shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 255]));
  put(root, 'autoresearch/devices/eris/bench.sh', '#!/bin/sh\necho hi\n');
  chmodSync(join(root, 'autoresearch/devices/eris/bench.sh'), 0o755);
  put(root, 'tools/promote.py', 'LEDGER = "autoresearch/results.tsv"\nOLD = "autoresearch/candidates/gone-v1/x.html"\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'snapshot');
  const commit = sh(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'autoresearch/README.md'), '# research, edited\n');
  put(root, 'autoresearch/notes-draft.md', 'draft\n');
  return { root, commit };
}

const OVERRIDES = { 'autoresearch/run.py': { disposition: 're-homed', owner: 'fm-htbc', reason: 'lease' } };

function digestList(c) {
  const files = treeFiles(c.root, c.commit, 'autoresearch/');
  return buildDigestList({ snapshot: { commit: c.commit }, files, overrides: OVERRIDES, uncommitted: uncommitted(c.root), consumers: consumers(c.root, c.commit, files), appendOnly: ['autoresearch/results.tsv'] });
}

// A destination repository with the import done and committed, plus an override destination of its own.
function imported(c, list) {
  const dest = repo();
  put(dest, 'autoresearch/run.py', 'print("re-homed")\n');
  const r = importFiles(list, { repo: c.root, commit: c.commit, root: dest });
  sh(dest, 'add', '.');
  sh(dest, 'commit', '-q', '-m', 'import');
  return { dest, r };
}

test('census: every tracked file with size and SHA-256 from Git objects; uncommitted edits excluded with digests', () => {
  const c = classic();
  try {
    const list = digestList(c);
    assert.equal(list.census.files, 7);
    assert.deepEqual(list.scan, { scanned: 7, hits: [] });
    assert.equal(list.files.find((f) => f.source === 'autoresearch/README.md').sha256, sha256(Buffer.from('# research\n')));
    assert.equal(list.files.find((f) => f.source === 'autoresearch/run.py').disposition, 're-homed');
    assert.equal(list.files.find((f) => f.source === 'autoresearch/devices/eris/bench.sh').mode, '100755');
    assert.deepEqual(list.exclusions.map((e) => [e.path, e.sha256]), [
      ['autoresearch/README.md', sha256(Buffer.from('# research, edited\n'))],
      ['autoresearch/notes-draft.md', sha256(Buffer.from('draft\n'))],
    ]);
    assert.deepEqual(list.frozenDirectories, ['autoresearch/candidates/', 'autoresearch/devices/']);
    assert.deepEqual(list.ledger, { columns: ['experiment_id', 'lane', 'status', 'evidence'], rows: 3, statusCounts: { keep: 2, inconclusive: 1 }, sha256: sha256(Buffer.from(LEDGER)) });
    assert.deepEqual(list.consumers, [{ path: 'tools/promote.py', references: ['autoresearch/candidates/gone-v1/x.html', 'autoresearch/results.tsv'], missingAtSnapshot: ['autoresearch/candidates/gone-v1/x.html'] }]);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('import writes from Git objects, keeps modes, never overwrites a different file; the check passes', () => {
  const c = classic();
  const list = digestList(c);
  const { dest, r } = imported(c, list);
  try {
    assert.equal(r.written.length, 6);
    assert.deepEqual(r.conflicts, []);
    assert.equal(readFileSync(join(dest, 'autoresearch/README.md'), 'utf8'), '# research\n'); // committed, not the edit
    assert.equal(readFileSync(join(dest, 'autoresearch/run.py'), 'utf8'), 'print("re-homed")\n');
    assert.equal(existsSync(join(dest, 'autoresearch/notes-draft.md')), false);
    const ok = checkImport(list, dest);
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.imported, 6);

    // A second import over a destination file someone else changed: reported, left alone.
    writeFileSync(join(dest, 'autoresearch/results.tsv'), 'changed\n');
    const again = importFiles(list, { repo: c.root, commit: c.commit, root: dest });
    assert.deepEqual(again.conflicts, ['autoresearch/results.tsv']);
    assert.equal(readFileSync(join(dest, 'autoresearch/results.tsv'), 'utf8'), 'changed\n');
  } finally { rmSync(c.root, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test('check: an altered byte, a missing file and an extra unlisted file each fail', () => {
  const c = classic();
  const list = digestList(c);
  const { dest } = imported(c, list);
  try {
    const png = join(dest, 'autoresearch/candidates/a-v1/shot.png');
    const bytes = readFileSync(png);
    bytes[5] ^= 1;
    writeFileSync(png, bytes);
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'altered', path: 'autoresearch/candidates/a-v1/shot.png' }]);
    bytes[5] ^= 1;
    writeFileSync(png, bytes);

    rmSync(join(dest, 'autoresearch/candidates/a-v1/report.json'));
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'missing', path: 'autoresearch/candidates/a-v1/report.json' }]);
    sh(dest, 'checkout', '--', 'autoresearch/candidates/a-v1/report.json');

    put(dest, 'autoresearch/devices/eris/extra.md', 'unlisted\n');
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'unlisted', path: 'autoresearch/devices/eris/extra.md' }]);
    rmSync(join(dest, 'autoresearch/devices/eris/extra.md'));

    // Ignored by Git (as a test run's __pycache__ would be): not an extra file.
    put(dest, 'autoresearch/candidates/a-v1/__pycache__/x.pyc', 'bytecode');
    assert.deepEqual(checkImport(list, dest).problems, []);

    chmodSync(join(dest, 'autoresearch/devices/eris/bench.sh'), 0o644);
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'mode', path: 'autoresearch/devices/eris/bench.sh' }]);
    chmodSync(join(dest, 'autoresearch/devices/eris/bench.sh'), 0o755);

    // results.tsv is append-only: a new row passes; a changed byte in the snapshot prefix fails.
    const ledger = join(dest, 'autoresearch/results.tsv');
    writeFileSync(ledger, `${LEDGER}r4\tcpu\tproposed\td.md\n`);
    assert.deepEqual(checkImport(list, dest).problems, []);
    writeFileSync(ledger, LEDGER.replace('r2', 'r9'));
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'altered', path: 'autoresearch/results.tsv' }]);
    writeFileSync(ledger, LEDGER.slice(0, -4));
    assert.deepEqual(checkImport(list, dest).problems, [{ kind: 'altered', path: 'autoresearch/results.tsv' }]);
    writeFileSync(ledger, LEDGER);

    const short = { ...list, files: list.files.slice(1) };
    assert.ok(checkImport(short, dest).problems.some((p) => p.kind === 'census'));
  } finally { rmSync(c.root, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

// Minimal planted files in each weight format.
function safetensors() {
  const header = Buffer.from(JSON.stringify({ w: { dtype: 'F32', shape: [2], data_offsets: [0, 8] } }));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([len, header, Buffer.alloc(8)]);
}
const onnx = () => Buffer.concat([Buffer.from([0x08, 0x07, 0x12, 0x07]), Buffer.from('pytorch'), Buffer.from([0x1a, 0x03]), Buffer.from('2.1'), Buffer.alloc(64)]);
const torchZip = () => Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(26), Buffer.from('archive/data.pkl'), Buffer.alloc(32)]);

test('scan: ONNX, safetensors and PyTorch files and a token are flagged, even renamed; text and images pass', () => {
  assert.ok(scanFile('model.onnx', onnx()).some((h) => h.kind === 'onnx'));
  assert.deepEqual(scanFile('renamed.dat', onnx()).map((h) => h.kind), ['onnx']);
  assert.deepEqual(scanFile('w.dat', safetensors()).map((h) => h.kind), ['safetensors']);
  assert.ok(scanFile('w.safetensors', safetensors()).some((h) => h.kind === 'weight-extension'));
  assert.deepEqual(scanFile('ckpt.zip', torchZip()).map((h) => h.kind), ['pytorch-zip']);
  assert.deepEqual(scanFile('m.pt', Buffer.from([0x80, 0x04, 0x95, 0x10])).map((h) => h.kind).sort(), ['pickle', 'weight-extension']);
  const token = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
  assert.deepEqual(scanFile('notes.md', Buffer.from(`deploy with ${token}\n`)).map((h) => h.kind), ['github-token']);
  assert.deepEqual(scanFile('cfg.json', Buffer.from('{"api_key": "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1H"}')).map((h) => h.kind), ['assigned-secret']);
  assert.deepEqual(scanFile('log.md', Buffer.from(`run 38029582696 sha256 ${sha256(Buffer.from('x'))} ok\n`)), []);
  assert.deepEqual(scanFile('report.json', Buffer.from('{"token_count": 12, "secret": false}')), []);
  assert.deepEqual(scanFile('shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), []);
});

test('a file with a scan hit is excluded from the import with the reason, never written', () => {
  const c = classic();
  put(c.root, 'autoresearch/candidates/a-v1/model.onnx', onnx());
  sh(c.root, 'add', 'autoresearch/candidates/a-v1/model.onnx');
  sh(c.root, 'commit', '-q', '-m', 'oops');
  c.commit = sh(c.root, 'rev-parse', 'HEAD');
  const list = digestList(c);
  const dest = repo();
  try {
    const e = list.files.find((f) => f.source.endsWith('model.onnx'));
    assert.equal(e.disposition, 'excluded');
    assert.match(e.reason, /onnx/);
    assert.ok(list.exclusions.some((x) => x.path.endsWith('model.onnx') && x.kind === 'scan hit'));
    assert.equal(list.scan.hits.length, 1);
    assert.ok(!list.frozenDirectories.includes('autoresearch/candidates/'));
    importFiles(list, { repo: c.root, commit: c.commit, root: dest });
    assert.equal(existsSync(join(dest, 'autoresearch/candidates/a-v1/model.onnx')), false);
  } finally { rmSync(c.root, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test('ledger facts: header, row count and status counts', () => {
  assert.deepEqual(ledgerFacts(Buffer.from(LEDGER)).statusCounts, { keep: 2, inconclusive: 1 });
});

test('census of a real repository records the snapshot commit and tree, and whether HEAD has the same tree', () => {
  const c = classic();
  try {
    const list = census(c.root, c.commit);
    assert.equal(list.snapshot.commit, c.commit);
    assert.equal(list.snapshot.tree, sh(c.root, 'rev-parse', `${c.commit}:autoresearch`));
    assert.equal(list.snapshot.sameTreeAt.identical, true);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

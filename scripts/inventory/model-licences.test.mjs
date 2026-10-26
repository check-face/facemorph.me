// Model licence texts beside the weights (fm-qoc3): every notice import/licences.json names exists in
// hosting/next/notices/, is recorded in hosting/PROVENANCE.json with its bytes, is staged at /runtime/notices/ by
// stage.py, is listed on the notices page the runtime manifest's distribution.notices points at, and the app's
// links and the README lists are exactly what the rows give.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { LICENCES, REPO, readJson, sha256 } from './lib.mjs';
import {
  INDEX,
  MODULE,
  NOTICES_DIR,
  READMES,
  SERVED,
  modelNotices,
  noticeProblems,
  outputs,
  splice,
} from './model-licences.mjs';

const { rows } = readJson(LICENCES);
const notices = modelNotices(rows);
const read = (p) => readFileSync(join(REPO, p));

test('the rows name the model licence texts, each with a title and upstream copy', () => {
  assert.deepEqual(noticeProblems(rows), []);
  const byRow = (id) => notices.filter((n) => n.row === id).map((n) => basename(n.file));
  assert.deepEqual(byRow('nvidia-stylegan2-ffhq-config-f-derived'), [
    'NVIDIA-StyleGAN2-NC.txt',
    'NVIDIA-StyleGAN2-ADA.txt',
  ]);
  assert.deepEqual(byRow('ffhq-dataset-terms'), ['FFHQ-terms.txt']);
  assert.deepEqual(byRow('e4e-source-mit'), ['e4e-MIT.txt']);
  assert.deepEqual(byRow('dlib-68-landmark-model'), ['index.html']);
  // Every row with a notice file lists it among its notices.
  for (const r of rows.filter((r) => r.notices))
    assert.ok(
      r.notices.some((n) => n.file === r.notice_file),
      r.id,
    );
  // The NC licence is the 2019 NVlabs/stylegan2 text, unmodified.
  assert.equal(
    sha256(read('hosting/next/notices/NVIDIA-StyleGAN2-NC.txt')),
    '803ddcc4dd20de6387e2e5731f6a864ea01364dd305b17bda7157bcab0c39295',
  );
  assert.match(read('hosting/next/notices/FFHQ-terms.txt').toString(), /BY-NC-SA 4\.0/);
});

test('each notice exists beside the weights with the bytes hosting/PROVENANCE.json records', () => {
  const provenance = readJson(join(REPO, 'hosting/PROVENANCE.json'));
  const recorded = new Map([
    ...provenance.files.map((f) => [f.path, f.ported?.sha256 ?? f.sha256]),
    ...provenance.addedFiles.map((f) => [f.path, f.sha256]),
  ]);
  const onDisk = new Set(readdirSync(join(REPO, NOTICES_DIR)));
  for (const n of notices) {
    assert.ok(onDisk.has(basename(n.file)), n.file);
    assert.equal(recorded.get(n.file), sha256(read(n.file)), `${n.file} is not the recorded bytes`);
    assert.equal(n.href.split('#')[0], SERVED + basename(n.file));
  }
});

test('stage.py publishes every notice at /runtime/notices/ over the runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-model-licences-'));
  try {
    mkdirSync(join(root, 'frontend'));
    mkdirSync(join(root, 'runtime/notices'), { recursive: true });
    writeFileSync(join(root, 'frontend/index.html'), '<html>app</html>');
    writeFileSync(join(root, 'runtime/notices/index.html'), 'frozen');
    writeFileSync(join(root, 'catalogue.json'), '{}');
    execFileSync('python3', [
      join(REPO, 'hosting/next-static/stage.py'),
      '--runtime',
      join(root, 'runtime'),
      '--frontend',
      join(root, 'frontend'),
      '--catalogue',
      join(root, 'catalogue.json'),
      '--output',
      join(root, 'public'),
    ]);
    for (const n of notices) {
      const served = join(root, 'public', n.href.split('#')[0]);
      assert.ok(readFileSync(served).equals(read(n.file)), n.href);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the notices page the runtime manifest points at lists every model licence text', () => {
  const page = read(INDEX).toString();
  for (const n of notices) {
    const [file, fragment] = n.href.slice(SERVED.length).split('#');
    if (file === basename(INDEX)) assert.match(page, new RegExp(`id="${fragment}"`), n.title);
    else assert.ok(page.includes(`<a href="${file}">${n.title}</a>`), n.title);
  }
  // The pinned runtime manifest (frozen) names that page as its distribution notices.
  const manifests = readdirSync(join(REPO, 'import/runtime-manifests/control'));
  assert.ok(manifests.length >= 1);
  for (const sha of manifests) {
    const manifest = readJson(join(REPO, 'import/runtime-manifests/control', sha, 'manifest.json'));
    assert.match(manifest.distribution.notices, new RegExp(`${SERVED}index\\.html$`));
  }
});

test('the app links, notices page and README lists are generated from the rows (--check)', () => {
  const expected = outputs(rows);
  assert.deepEqual(Object.keys(expected).sort(), [INDEX, MODULE, ...READMES].sort());
  for (const [path, text] of Object.entries(expected))
    assert.equal(
      read(path).toString(),
      text,
      `${path}: run node scripts/inventory/model-licences.mjs`,
    );
  for (const p of READMES) {
    const text = read(p).toString();
    for (const n of notices) assert.ok(text.includes(n.upstream), `${p} lacks ${n.title}`);
  }
  const r = spawnSync(process.execPath, [
    join(REPO, 'scripts/inventory/model-licences.mjs'),
    '--check',
  ]);
  assert.equal(r.status, 0, r.stdout.toString());
  // A drifted output fails the check: the generator replaces only between its markers.
  assert.throws(() => splice('no markers', ['<a>', '</a>'], 'x'), /missing/);
  assert.equal(splice('1<a>old</a>2', ['<a>', '</a>'], 'new'), '1<a>new</a>2');
});

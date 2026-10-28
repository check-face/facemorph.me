import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from '../inventory/lib.mjs';
import { fetchFull31 } from './fetch-full31.mjs';

// A two-file fixture set and its tarball, made with the same tar the job unpacks with.
function fixtures() {
  const root = mkdtempSync(join(tmpdir(), 'full31-test-'));
  const src = join(root, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'frame-00.w.f32'), 'latent');
  writeFileSync(join(src, 'frame-00.png'), 'image');
  const files = { 'frame-00.w.f32': sha256('latent'), 'frame-00.png': sha256('image') };
  execFileSync('tar', [
    '-czf',
    join(root, 'f.tar.gz'),
    '-C',
    src,
    'frame-00.w.f32',
    'frame-00.png',
  ]);
  const bytes = readFileSync(join(root, 'f.tar.gz'));
  const release = {
    tag: 'full31-fixtures-test',
    api_url: 'https://example.invalid/asset',
    sha256: sha256(bytes),
  };
  let requests = 0;
  const get = async () => (requests++, new Response(bytes));
  return { root, src, files, release, get, requests: () => requests };
}

test('a directory already holding every pinned file is kept without a download', async () => {
  const f = fixtures();
  const got = await fetchFull31({ dest: f.src, release: f.release, files: f.files, get: f.get });
  assert.deepEqual([got.kept, got.files, f.requests()], [true, 2, 0]);
});

test('a missing or changed directory is restored from the pinned asset and checked file by file', async () => {
  const f = fixtures();
  const dest = join(f.root, 'dest');
  mkdirSync(dest);
  writeFileSync(join(dest, 'frame-00.png'), 'changed');
  const got = await fetchFull31({ dest, release: f.release, files: f.files, get: f.get });
  assert.equal(got.fetched, 'full31-fixtures-test');
  assert.equal(readFileSync(join(dest, 'frame-00.png'), 'utf8'), 'image');
});

test('an asset that is not the pinned one is refused before anything is unpacked', async () => {
  const f = fixtures();
  const dest = join(f.root, 'dest');
  await assert.rejects(
    fetchFull31({
      dest,
      release: f.release,
      files: f.files,
      get: async () => new Response('other'),
    }),
    /is not the pinned/,
  );
});

test('an asset whose files differ from manifest.json fails after unpacking', async () => {
  const f = fixtures();
  const files = { ...f.files, 'frame-00.png': sha256('something else') };
  await assert.rejects(
    fetchFull31({ dest: join(f.root, 'dest'), release: f.release, files, get: f.get }),
    /differ from manifest\.json: frame-00\.png/,
  );
});

// The app's fast photo-native build (fm-3xjm) against the pinned runtime build it replaces: identical face count,
// all 68 landmarks of every face and every prepared RGB byte, aligned and unaligned, on the crop fixtures.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {FAST_NATIVE} from './identity.mjs';

const here = new URL('./', import.meta.url).pathname;
const repo = new URL('../../../../../../', import.meta.url).pathname;
const runtime = process.env.FACEMORPH_RUNTIME_DIR ?? join(repo, '.cache/runtime');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('fast photo-native: identity.mjs names the committed glue and wasm bytes', () => {
  for (const [name, file] of [['glue', 'photo-native.mjs'], ['wasm', 'photo-native.wasm']]) {
    const bytes = readFileSync(join(here, file));
    assert.equal(bytes.length, FAST_NATIVE[name].size, file);
    assert.equal(sha(bytes), FAST_NATIVE[name].sha256, file);
  }
});

function pinnedPhotoRuntime() {
  const root = join(runtime, 'photo');
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const manifestPath = join(root, dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const {landmarks} = manifest;
    const parts = landmarks.chunks?.map((c) => join(runtime, 'chunks', `${c.sha256}.bin`)) ?? [];
    const whole = join(runtime, 'assets', landmarks.sha256, 'shape_predictor_68_face_landmarks.dat');
    let model = null;
    if (existsSync(whole)) model = readFileSync(whole);
    else if (parts.length && parts.every((p) => existsSync(p))) model = Buffer.concat(parts.map((p) => readFileSync(p)));
    if (!model || sha(model) !== landmarks.sha256) continue;
    return {dir: join(root, dir), model};
  }
  return null;
}

async function load(dir, model) {
  const create = (await import(join(dir, 'photo-native.mjs'))).default;
  const m = await create({wasmBinary: readFileSync(join(dir, 'photo-native.wasm')), print() {}, printErr() {}});
  const check = (r) => {
    if (r < 0) throw Error(m.UTF8ToString(m._cf_error()));
    return r;
  };
  const p = m._malloc(model.length);
  m.HEAPU8.set(model, p);
  check(m._cf_init_predictor(p, model.length));
  m._free(p);
  return {
    m,
    run(bytes, align) {
      const q = m._malloc(bytes.length);
      m.HEAPU8.set(bytes, q);
      check(m._cf_decode(q, bytes.length));
      m._free(q);
      const faces = align ? check(m._cf_detect()) : 0;
      const lp = m._malloc(136 * 4), landmarks = [];
      for (let i = 0; i < faces; i++) {
        check(m._cf_landmarks(i, lp));
        landmarks.push([...new Int32Array(m.HEAPU8.buffer, lp, 136)]);
      }
      m._free(lp);
      const aligned = check(m._cf_prepare(align ? 1 : 0));
      const rgb = sha(m.HEAPU8.subarray(m._cf_prepared(), m._cf_prepared() + 196608));
      return {faces, landmarks, aligned, rgb};
    },
  };
}

test('fast photo-native: landmarks and prepared bytes equal the pinned runtime build', {timeout: 600_000}, async (t) => {
  const pinned = pinnedPhotoRuntime();
  if (!pinned) {
    const reason = `untested: no acquired photo runtime with landmarks at ${runtime}; run on the runtime lane`;
    if (process.env.FACEMORPH_REQUIRE_RUNTIME === '1') throw Error(reason);
    t.skip(reason);
    return;
  }
  const fast = await load(here, pinned.model);
  assert.equal(fast.m._cf_fast_loader_used(), 1, 'the direct landmark parser read the pinned model');
  const control = await load(pinned.dir, pinned.model);
  const fixtures = join(repo, 'tests/crop/fixtures');
  const cases = readdirSync(fixtures).filter((f) => /\.(jpe?g|png)$/.test(f) && f !== 'malformed.jpg');
  assert.ok(cases.length >= 4, 'crop fixtures present');
  let detected = 0;
  for (const file of cases) {
    const bytes = readFileSync(join(fixtures, file));
    for (const align of [true, false]) {
      const expected = control.run(bytes, align), actual = fast.run(bytes, align);
      assert.deepEqual(actual, expected, `${file} align=${align}`);
      detected += expected.faces;
    }
  }
  assert.ok(detected >= 2, 'the fixtures exercise detection and landmarks');
});

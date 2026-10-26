// Admission mutations are planted in tiny local files; no model weights, network, installer or browser is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyNonfaceInputs, withVerifiedNonfaceInputs } from './nonface-handoff.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value));
const digest = 'a'.repeat(64);
const image = 'planted/converter@sha256:' + digest;
const tolerance = { rawFloat: 0.001, rgb: 1 };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nonface-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const handoffDir = join(root, 'handoff');
  const modelDir = join(root, 'model');
  const consumerDir = join(root, 'consumer');
  const referenceDir = join(modelDir, 'reference');
  const morphReferenceDir = join(modelDir, 'morph-reference');
  for (const dir of [handoffDir, modelDir, consumerDir, referenceDir, morphReferenceDir])
    mkdirSync(dir);
  const put = (dir, file, bytes) => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { file, size: bytes.length, sha256: sha(bytes) };
  };
  const checkpoint = join(root, 'checkpoint.pkl');
  const checkpointBytes = Buffer.from('planted checkpoint, never loaded');
  writeFileSync(checkpoint, checkpointBytes);
  const modelSourceSha256 = sha(checkpointBytes);
  const model = {
    key: 'planted-nonface',
    conditional: false,
    resolution: 2,
    channels: 3,
    zDim: 2,
    wDim: 2,
    numWs: 2,
    sourceSha256: modelSourceSha256,
    licence: 'Planted test terms',
  };
  const partA = Buffer.from('part one');
  const partB = Buffer.from('part two');
  const chunks = [put(modelDir, 'chunks/one.bin', partA), put(modelDir, 'chunks/two.bin', partB)];
  const manifest = {
    schemaVersion: 1,
    bundleVersion: 'planted',
    modelSourceSha256,
    noiseSha256: digest,
    model,
    mapping: put(modelDir, 'mapping.onnx', Buffer.from('mapping')),
    synthesis: {
      file: 'synthesis.onnx',
      size: partA.length + partB.length,
      sha256: sha(Buffer.concat([partA, partB])),
      chunks,
    },
    average: put(modelDir, 'average.f32', Buffer.alloc(8)),
    noise: [{ ...put(modelDir, 'noise.f32', Buffer.alloc(4)), name: 'noise', shape: [1, 1] }],
    tolerance,
    provenance: {
      checkpoint: {
        path: 'checkpoint.pkl',
        sha256: modelSourceSha256,
        url: 'https://models.example.invalid/fixture.pkl',
      },
      image,
    },
  };
  write(join(handoffDir, 'manifest.json'), manifest);
  const nativeVerification = {
    passed: true,
    descriptor: model,
    manifestSha256: sha(readFileSync(join(handoffDir, 'manifest.json'))),
    tolerance,
    container: { image, baseImage: 'planted/base@sha256:' + digest },
    reference: { checkpointSha256: modelSourceSha256, implementation: 'planted-upstream@fixed' },
    samples: [0, 1, 42].map((seed) => ({
      seed,
      maxRawAbsError: 0,
      maxWAbsError: 0,
      maxRgbDifference: 0,
    })),
  };
  write(join(handoffDir, 'verify.json'), nativeVerification);
  const reference = {
    checkpointSha256: modelSourceSha256,
    implementation: 'planted-upstream@fixed',
    container: 'planted/independent-reference@sha256:' + digest,
    tolerance,
    cases: [],
  };
  for (const seed of [0, 1, 42]) {
    const row = { seed };
    for (const [kind, shape] of [
      ['z', [1, 2]],
      ['w', [1, 2, 2]],
      ['raw', [1, 3, 2, 2]],
    ])
      row[kind] = {
        ...put(
          referenceDir,
          seed + '.' + kind + '.f32',
          Buffer.alloc(shape.reduce((a, b) => a * b, 4)),
        ),
        shape,
      };
    reference.cases.push(row);
  }
  write(join(referenceDir, 'reference.json'), reference);
  const latents = {
    shape: [2, 2, 2],
    sha256: put(morphReferenceDir, 'latents.f32', Buffer.alloc(32)).sha256,
    morph: { controls: ['seed-0', 'seed-1'] },
  };
  write(join(morphReferenceDir, 'latents.json'), latents);
  const morphReference = {
    checkpointSha256: modelSourceSha256,
    implementation: 'planted-upstream@fixed',
    container: 'planted/morph-reference@sha256:' + digest,
    tolerance,
    latents,
    frames: [0, 1].map((index) => ({
      index,
      ...put(morphReferenceDir, 'frame-' + index + '.f32', Buffer.alloc(48)),
    })),
  };
  write(join(morphReferenceDir, 'reference.json'), morphReference);
  const expectedRelease = { commit: 'b'.repeat(40), artifactDigest: 'c'.repeat(64) };
  const packages = ['engine', 'manager', 'host', 'converter'].map((name) => {
    const bytes = Buffer.from('planted ' + name + ' tarball');
    return {
      name: '@planted/' + name,
      ...put(join(consumerDir, 'packs'), name + '.tgz', bytes),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    };
  });
  const report = {
    ok: true,
    source: { commit: expectedRelease.commit },
    release: expectedRelease,
    packages,
  };
  write(join(consumerDir, 'report.json'), report);
  write(join(consumerDir, 'sub-result-3-consumers.json'), report);
  const options = {
    handoffDir,
    modelDir,
    checkpoint,
    consumerDir,
    referenceDir,
    morphReferenceDir,
    expectedRelease,
    handoffIdentity: {},
  };
  const repin = () => {
    const verification = read(join(handoffDir, 'verify.json'));
    verification.manifestSha256 = sha(readFileSync(join(handoffDir, 'manifest.json')));
    write(join(handoffDir, 'verify.json'), verification);
    options.handoffIdentity.manifestSha256 = verification.manifestSha256;
    options.handoffIdentity.verifySha256 = sha(readFileSync(join(handoffDir, 'verify.json')));
  };
  repin();
  return { root, options, repin, put };
}

test('original hand-off governs binary admission; unrelated local manifest is ignored', async (t) => {
  const f = fixture(t);
  write(join(f.options.modelDir, 'manifest.json'), {
    deliberately: 'different local conversion metadata',
  });
  const result = await verifyNonfaceInputs(f.options);
  assert.equal(result.outcome, 'passed');
  assert.equal(result.packages.length, 4);
  assert.ok(
    result.verified.some((row) => row.role === 'synthesis' && row.assembledFrom.length === 2),
  );
  assert.equal(result.referenceProvenance.conversion.image, image);
  assert.notEqual(result.referenceProvenance.generation, image);
  assert.equal(result.checkpoint.terms, 'Planted test terms');
});

for (const [kind, target] of [
  ['checkpoint', (o) => o.checkpoint],
  ['chunk', (o) => join(o.modelDir, 'chunks/one.bin')],
  ['generation reference', (o) => join(o.referenceDir, '0.w.f32')],
  ['morph reference', (o) => join(o.morphReferenceDir, 'frame-0.f32')],
  ['tarball', (o) => join(o.consumerDir, 'packs/engine.tgz')],
])
  test(kind + ' corruption aborts before the consumer callback', async (t) => {
    const { options } = fixture(t);
    writeFileSync(target(options), 'corrupt');
    let called = false;
    await assert.rejects(
      withVerifiedNonfaceInputs(options, () => {
        called = true;
      }),
      /digest mismatch/i,
    );
    assert.equal(called, false);
  });

test('a changed metadata digest or a newer manifest major cannot be admitted', async (t) => {
  const { options, repin } = fixture(t);
  const path = join(options.handoffDir, 'manifest.json');
  const manifest = read(path);
  manifest.schemaVersion = 99;
  write(path, manifest);
  await assert.rejects(verifyNonfaceInputs(options), /metadata digest mismatch/);
  repin();
  await assert.rejects(verifyNonfaceInputs(options), /manifest contract refused/);
});

test('correct chunk hashes cannot hide a wrong complete synthesis digest', async (t) => {
  const { options, repin } = fixture(t);
  const path = join(options.handoffDir, 'manifest.json');
  const manifest = read(path);
  manifest.synthesis.sha256 = 'd'.repeat(64);
  write(path, manifest);
  repin();
  await assert.rejects(verifyNonfaceInputs(options), /assembled digest mismatch/);
});

test('a redundant complete synthesis file is verified when present', async (t) => {
  const { options } = fixture(t);
  const whole = join(options.modelDir, 'synthesis.onnx');
  writeFileSync(
    whole,
    Buffer.concat([
      readFileSync(join(options.modelDir, 'chunks/one.bin')),
      readFileSync(join(options.modelDir, 'chunks/two.bin')),
    ]),
  );
  const result = await verifyNonfaceInputs(options);
  assert.ok(result.verified.some((row) => row.role === 'synthesis:whole-file'));
  writeFileSync(whole, 'corrupted redundant full file');
  await assert.rejects(verifyNonfaceInputs(options), /whole-file digest mismatch/);
});

test('relative traversal and symlinks cannot select files outside the declared asset root', async (t) => {
  const f = fixture(t);
  const manifestPath = join(f.options.handoffDir, 'manifest.json');
  const manifest = read(manifestPath);
  writeFileSync(join(f.root, 'outside.onnx'), 'mapping');
  unlinkSync(join(f.options.modelDir, 'mapping.onnx'));
  symlinkSync(join(f.root, 'outside.onnx'), join(f.options.modelDir, 'mapping.onnx'));
  await assert.rejects(verifyNonfaceInputs(f.options), /escapes its root/);
  manifest.mapping.file = '../outside.onnx';
  write(manifestPath, manifest);
  f.repin();
  await assert.rejects(verifyNonfaceInputs(f.options), /contract refused|escapes its root/);
});

test('reference scope, dimensions and frozen tolerance are enforced before inference', async (t) => {
  const { options } = fixture(t);
  const path = join(options.referenceDir, 'reference.json');
  const reference = read(path);
  reference.tolerance.rawFloat = 0.01;
  write(path, reference);
  await assert.rejects(verifyNonfaceInputs(options), /tolerance differs/);
  reference.tolerance.rawFloat = 0.001;
  reference.cases[0].w.shape = [1, 4];
  write(path, reference);
  await assert.rejects(verifyNonfaceInputs(options), /reference shape differs/);
});

test('source/artifact and sub-result pack identities are bound to the expected release', async (t) => {
  const { options } = fixture(t);
  const path = join(options.consumerDir, 'sub-result-3-consumers.json');
  const report = read(path);
  report.packages[0].integrity = 'sha512-wrong';
  write(path, report);
  await assert.rejects(verifyNonfaceInputs(options), /Sub-result pack identities differ/);
  write(path, read(join(options.consumerDir, 'report.json')));
  options.expectedRelease = { ...options.expectedRelease, artifactDigest: 'e'.repeat(64) };
  await assert.rejects(verifyNonfaceInputs(options), /artifact digest differs/);
});

test('matching sha256 alone cannot replace each exact qualified sha512 integrity', async (t) => {
  const { options } = fixture(t);
  for (const file of ['report.json', 'sub-result-3-consumers.json']) {
    const path = join(options.consumerDir, file);
    const report = read(path);
    report.packages[0].integrity = 'sha512-wrong';
    write(path, report);
  }
  await assert.rejects(verifyNonfaceInputs(options), /sha512 integrity mismatch/);
});

test('missing model data is an error, never a blocked or untested result', async (t) => {
  const { options } = fixture(t);
  unlinkSync(join(options.modelDir, 'chunks/one.bin'));
  await assert.rejects(verifyNonfaceInputs(options), { code: 'ENOENT' });
});

test('only an explicit pinned converter/terms blocker avoids every downstream operation', async (t) => {
  const { options } = fixture(t);
  unlinkSync(join(options.handoffDir, 'verify.json'));
  const file = join(options.handoffDir, 'blocked.json');
  write(file, {
    outcome: 'unqualified',
    blocker: {
      kind: 'terms',
      reason: 'Planted terms unavailable',
      evidence: 'planted qualification result',
    },
  });
  options.handoffIdentity.blockedSha256 = sha(readFileSync(file));
  options.modelDir = '/missing-model-is-not-opened';
  let called = false;
  const result = await withVerifiedNonfaceInputs(options, () => {
    called = true;
  });
  assert.equal(result.outcome, 'unqualified');
  assert.equal(result.verified.length, 1);
  assert.equal(called, false);
});

test('an unpinned or contradictory local blocker cannot hide a qualified hand-off', async (t) => {
  const { options } = fixture(t);
  const file = join(options.handoffDir, 'blocked.json');
  write(file, {
    outcome: 'unqualified',
    blocker: { kind: 'converter', reason: 'Planted failure', evidence: 'planted result' },
  });
  await assert.rejects(verifyNonfaceInputs(options), /independently pinned digest/);
  options.handoffIdentity.blockedSha256 = sha(readFileSync(file));
  await assert.rejects(verifyNonfaceInputs(options), /qualified conversion cannot be replaced/);
});

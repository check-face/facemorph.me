// fm-tqub: admit the original conversion hand-off and the exact already-qualified packs before any consumer runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseModelManifest } from '../../../packages/browser-model-manager/src/contracts/manifest.ts';

const HEX = /^[a-f0-9]{64}$/;
const TOLERANCE = { rawFloat: 0.001, rgb: 1 };
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const container = (value, label) => assert.match(value ?? '', /@sha256:[a-f0-9]{64}$/, label);

function rooted(root, file) {
  assert.equal(typeof file, 'string', 'Declared file must be a relative path');
  assert.ok(file && !isAbsolute(file) && !file.includes('\\'), 'Declared file must be relative');
  const base = realpathSync(root);
  const path = realpathSync(resolve(base, file));
  const rel = relative(base, path);
  assert.ok(
    rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel),
    'Declared file escapes its root',
  );
  return path;
}

async function fileDigest(path, extraHash) {
  const hash = createHash('sha256');
  const integrity = createHash('sha512');
  let size = 0;
  for await (const bytes of createReadStream(path)) {
    size += bytes.length;
    hash.update(bytes);
    integrity.update(bytes);
    extraHash?.update(bytes);
  }
  return { size, sha256: hash.digest('hex'), integrity: 'sha512-' + integrity.digest('base64') };
}

function shapeBytes(shape) {
  assert.ok(
    Array.isArray(shape) && shape.length && shape.every((n) => Number.isSafeInteger(n) && n > 0),
    'Reference shape must contain positive integers',
  );
  const bytes = shape.reduce((a, b) => a * b, 4);
  assert.ok(Number.isSafeInteger(bytes), 'Reference shape is too large');
  return bytes;
}

/** No downloader, installer or browser is called here. Missing/corrupt local input is a failure, never an unavailable cell. */
export async function verifyNonfaceInputs({
  handoffDir,
  modelDir,
  checkpoint,
  consumerDir,
  referenceDir,
  morphReferenceDir,
  expectedRelease,
  handoffIdentity,
} = {}) {
  const verified = [];
  const metadata = (root, file, role, expected) => {
    const path = rooted(root, file);
    const bytes = readFileSync(path);
    const digest = sha(bytes);
    if (expected !== undefined) {
      assert.match(expected, HEX, role + ': expected metadata digest required');
      assert.equal(digest, expected, role + ': metadata digest mismatch');
    }
    verified.push({
      role,
      file,
      size: bytes.length,
      sha256: digest,
      ...(expected ? { expectedSha256: expected } : {}),
    });
    return JSON.parse(bytes.toString('utf8'));
  };
  // A blocked hand-off must be explicit, evidence-linked and pinned by the caller; a failed qualified input cannot select this branch.
  if (existsSync(join(handoffDir, 'blocked.json'))) {
    assert.match(
      handoffIdentity?.blockedSha256 ?? '',
      HEX,
      'Blocked hand-off requires its independently pinned digest',
    );
    const blocked = metadata(
      handoffDir,
      'blocked.json',
      'conversion-blocker',
      handoffIdentity.blockedSha256,
    );
    assert.equal(blocked.outcome, 'unqualified');
    assert.ok(
      ['converter', 'terms'].includes(blocked.blocker?.kind),
      'Only a converter or terms blocker qualifies',
    );
    assert.ok(
      typeof blocked.blocker.reason === 'string' && blocked.blocker.reason.trim(),
      'Blocker reason required',
    );
    assert.ok(
      typeof blocked.blocker.evidence === 'string' && blocked.blocker.evidence.trim(),
      'Blocker evidence required',
    );
    assert.ok(
      !existsSync(join(handoffDir, 'verify.json')) ||
        json(join(handoffDir, 'verify.json')).passed !== true,
      'A qualified conversion cannot be replaced by a blocked outcome',
    );
    return { outcome: 'unqualified', blocker: blocked.blocker, handoff: handoffIdentity, verified };
  }
  referenceDir ??= join(modelDir, 'reference');
  morphReferenceDir ??= join(modelDir, 'morph-reference');
  assert.match(
    handoffIdentity?.manifestSha256 ?? '',
    HEX,
    'Independently pinned hand-off manifest digest required',
  );
  assert.match(
    handoffIdentity?.verifySha256 ?? '',
    HEX,
    'Independently pinned hand-off verification digest required',
  );
  const manifest = metadata(
    handoffDir,
    'manifest.json',
    'conversion-manifest',
    handoffIdentity.manifestSha256,
  );
  const nativeVerification = metadata(
    handoffDir,
    'verify.json',
    'conversion-verification',
    handoffIdentity.verifySha256,
  );
  const parsed = parseModelManifest(manifest, { unpublished: true });
  assert.ok(parsed.ok, 'Manager manifest contract refused: ' + JSON.stringify(parsed.error));
  assert.equal(nativeVerification.passed, true, 'Original conversion must be qualified');
  assert.equal(nativeVerification.manifestSha256, handoffIdentity.manifestSha256);
  assert.equal(nativeVerification.reference.checkpointSha256, manifest.modelSourceSha256);
  assert.deepEqual(nativeVerification.descriptor, manifest.model, 'Hand-off descriptor differs');
  assert.deepEqual(nativeVerification.tolerance, TOLERANCE, 'AFHQ declared tolerance changed');
  assert.deepEqual(manifest.tolerance, TOLERANCE, 'Manifest tolerance changed');
  assert.equal(manifest.model.conditional, false);
  assert.equal(manifest.model.sourceSha256, manifest.modelSourceSha256);
  assert.equal(manifest.provenance.checkpoint.sha256, manifest.modelSourceSha256);
  assert.equal(manifest.provenance.image, nativeVerification.container.image);
  container(nativeVerification.container.image, 'Conversion container digest required');
  container(nativeVerification.container.baseImage, 'Conversion base-image digest required');
  assert.ok(
    manifest.provenance.checkpoint.url.startsWith('https://'),
    'Checkpoint source URL required',
  );
  assert.ok(manifest.model.licence?.trim(), 'Checkpoint acquisition terms required');
  assert.deepEqual(
    nativeVerification.samples.map((row) => row.seed),
    [0, 1, 42],
  );
  for (const row of nativeVerification.samples) {
    assert.ok(
      Number.isFinite(row.maxRawAbsError) &&
        row.maxRawAbsError >= 0 &&
        row.maxRawAbsError <= TOLERANCE.rawFloat,
    );
    assert.ok(
      Number.isFinite(row.maxWAbsError) &&
        row.maxWAbsError >= 0 &&
        row.maxWAbsError <= TOLERANCE.rawFloat,
    );
    assert.ok(
      Number.isFinite(row.maxRgbDifference) &&
        row.maxRgbDifference >= 0 &&
        row.maxRgbDifference <= TOLERANCE.rgb,
    );
  }
  const checkpointDigest = await fileDigest(checkpoint);
  assert.equal(checkpointDigest.sha256, manifest.modelSourceSha256, 'Checkpoint digest mismatch');
  verified.push({
    role: 'checkpoint',
    file: manifest.provenance.checkpoint.path,
    ...checkpointDigest,
  });
  const asset = async (root, declaration, role, extraHash) => {
    assert.match(declaration.sha256 ?? '', HEX, role + ': declared digest required');
    assert.ok(
      Number.isSafeInteger(declaration.size) && declaration.size > 0,
      role + ': declared size required',
    );
    if (declaration.chunks) {
      const assembled = createHash('sha256');
      let size = 0;
      for (const part of declaration.chunks) {
        const record = await asset(root, part, role + ':chunk', assembled);
        size += record.size;
      }
      const record = {
        role,
        file: declaration.file,
        sha256: assembled.digest('hex'),
        size,
        assembledFrom: declaration.chunks.map((part) => part.file),
      };
      assert.equal(record.sha256, declaration.sha256, role + ': assembled digest mismatch');
      assert.equal(size, declaration.size, role + ': assembled size mismatch');
      verified.push(record);
      // Chunk-only converter output is complete. If a redundant whole file is present, it must agree too.
      if (existsSync(join(root, declaration.file))) {
        const whole = await fileDigest(rooted(root, declaration.file));
        assert.equal(whole.sha256, declaration.sha256, role + ': whole-file digest mismatch');
        assert.equal(whole.size, declaration.size, role + ': whole-file size mismatch');
        verified.push({ role: role + ':whole-file', file: declaration.file, ...whole });
      }
      return record;
    }
    const actual = await fileDigest(rooted(root, declaration.file), extraHash);
    assert.equal(
      actual.sha256,
      declaration.sha256,
      role + ': digest mismatch: ' + declaration.file,
    );
    assert.equal(actual.size, declaration.size, role + ': size mismatch: ' + declaration.file);
    const record = { role, file: declaration.file, ...actual };
    verified.push(record);
    return record;
  };
  for (const [role, declaration] of [
    ['mapping', manifest.mapping],
    ['synthesis', manifest.synthesis],
    ['average', manifest.average],
    ...manifest.noise.map((n) => ['noise', n]),
  ])
    await asset(modelDir, declaration, role);
  const reference = metadata(
    referenceDir,
    'reference.json',
    'native-reference',
    handoffIdentity.referenceSha256,
  );
  const morphReference = metadata(
    morphReferenceDir,
    'reference.json',
    'native-morph-reference',
    handoffIdentity.morphReferenceSha256,
  );
  for (const [label, ref] of [
    ['reference', reference],
    ['morph-reference', morphReference],
  ]) {
    assert.equal(ref.checkpointSha256, manifest.modelSourceSha256, label + ': checkpoint differs');
    assert.equal(
      ref.implementation,
      nativeVerification.reference.implementation,
      label + ': upstream reference differs',
    );
    assert.deepEqual(ref.tolerance, TOLERANCE, label + ': declared tolerance differs');
    container(ref.container, label + ': separate reference container digest required');
  }
  const referenceSeeds = reference.cases.map((row) => row.seed);
  assert.ok(
    referenceSeeds.length >= 2 && new Set(referenceSeeds).size === referenceSeeds.length,
    'Independent references require at least two distinct seeds',
  );
  assert.ok(
    referenceSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff),
    'Reference seed must be uint32',
  );
  const shapes = {
    z: [1, manifest.model.zDim],
    w: [1, manifest.model.numWs, manifest.model.wDim],
    raw: [1, manifest.model.channels, manifest.model.resolution, manifest.model.resolution],
  };
  for (const row of reference.cases)
    for (const kind of ['z', 'w', 'raw']) {
      assert.deepEqual(
        row[kind].shape,
        shapes[kind],
        kind + ': reference shape differs from descriptor',
      );
      assert.equal(shapeBytes(row[kind].shape), row[kind].size, kind + ': shape/size differs');
      await asset(referenceDir, row[kind], 'reference:' + kind);
    }
  const latents = metadata(morphReferenceDir, 'latents.json', 'morph-latent-metadata');
  assert.deepEqual(latents, morphReference.latents, 'Morph latent metadata differs from reference');
  assert.deepEqual(
    latents.shape.slice(1),
    [manifest.model.numWs, manifest.model.wDim],
    'Morph latent shape differs from descriptor',
  );
  await asset(
    morphReferenceDir,
    { file: 'latents.f32', sha256: latents.sha256, size: shapeBytes(latents.shape) },
    'morph-latents',
  );
  assert.equal(
    morphReference.frames.length,
    latents.shape[0],
    'Morph frame count differs from latents',
  );
  for (const [index, frame] of morphReference.frames.entries()) {
    assert.equal(frame.index, index, 'Morph frames must be ordered');
    assert.equal(frame.size, shapeBytes(shapes.raw), 'Morph output size differs from descriptor');
    await asset(morphReferenceDir, frame, 'morph-reference:frame');
  }
  assert.match(expectedRelease?.commit ?? '', /^[a-f0-9]{40}$/, 'Expected release commit required');
  assert.match(
    expectedRelease?.artifactDigest ?? '',
    HEX,
    'Expected release artifact digest required',
  );
  const report = metadata(consumerDir, 'report.json', 'consumer-report');
  const consumers = metadata(consumerDir, 'sub-result-3-consumers.json', 'consumer-sub-result');
  assert.equal(report.ok, true, 'Clean consumer must have passed');
  assert.equal(consumers.ok, true, 'Clean consumer sub-result must have passed');
  assert.equal(
    report.source.commit,
    expectedRelease.commit,
    'Consumer source differs from named release',
  );
  assert.equal(report.release.commit, expectedRelease.commit, 'Consumer release source differs');
  assert.equal(
    report.release.artifactDigest,
    expectedRelease.artifactDigest,
    'Consumer artifact digest differs',
  );
  assert.deepEqual(consumers.source, report.source, 'Sub-result source differs');
  assert.deepEqual(consumers.release, report.release, 'Sub-result release differs');
  assert.deepEqual(consumers.packages, report.packages, 'Sub-result pack identities differ');
  assert.equal(report.packages.length, 4, 'All four qualified packs required');
  assert.equal(
    new Set(report.packages.map((p) => p.name)).size,
    4,
    'Pack identities must be unique',
  );
  for (const pack of report.packages) {
    const actual = await fileDigest(rooted(join(consumerDir, 'packs'), pack.file));
    assert.equal(actual.sha256, pack.sha256, 'Pack digest mismatch: ' + pack.name);
    assert.equal(actual.integrity, pack.integrity, 'Pack sha512 integrity mismatch: ' + pack.name);
    verified.push({ role: 'pack', file: pack.file, ...actual });
  }
  return {
    outcome: 'passed',
    verified,
    manifest,
    reference,
    morphReference,
    nativeVerification,
    source: report.source,
    release: report.release,
    packages: report.packages,
    handoff: handoffIdentity,
    manifestValidation: {
      validator: 'browser-model-manager.parseModelManifest',
      unpublished: true,
      ok: true,
    },
    checkpoint: {
      source: manifest.provenance.checkpoint.url,
      sha256: checkpointDigest.sha256,
      terms: manifest.model.licence,
    },
    referenceProvenance: {
      generation: reference.container,
      morph: morphReference.container,
      conversion: nativeVerification.container,
    },
  };
}

/** Admission completes before the caller can install packages or open a browser. */
export async function withVerifiedNonfaceInputs(options, run) {
  const admission = await verifyNonfaceInputs(options);
  return admission.outcome === 'passed' ? run(admission) : admission;
}

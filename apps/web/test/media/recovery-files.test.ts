// The app's recovery files (fm-fy2.7): the package's schema core bound to the bridge's face and project values.
// Stills write schema 3 and read schema 3, 2 and 1 with exact latent and model identity; damaged and unknown
// versions are typed; a face from another checkpoint is refused at equal shape; the MP4 project is schema 2 and
// reads back as the app's project JSON, and the candidate's schema-1 project MP4 reads unchanged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  FFHQ_1024_DESCRIPTOR,
  readMp4Project,
  readRecovery,
  type RecoveryProvenance,
} from '@facemorph/stylegan-js';
import {
  RecoveryFileError,
  checkFaceModel,
  descriptorFor,
  readProjectMp4,
  readStill,
  routeOfMovie,
  writeProjectMp4,
  writeStill,
  type FaceIdentity,
} from '../../src/media/recovery-files.ts';
import { decode, type Project } from '../../src/project/project-json.ts';

const d = FFHQ_1024_DESCRIPTOR;
const file = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const stills = (name: string) => file(`../fixtures/verify/stills/${name}`);
const bytesOf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

const runtime = { modelSha256: d.identity.modelSha256, noiseSha256: d.identity.noiseSha256 };
const provenance: RecoveryProvenance = {
  bundleVersion: 'next-browser-cpu-v1',
  manifestSha256: 'b'.repeat(64),
  ...runtime,
  route: 'cpu',
  truncationPsi: 0.7,
};
/** The schema-2 fixture's seed-42 latent, the same values the schema-1 fixture holds. */
const v2 = readStill(stills('recovery-v2.png'))!;
const face = (over: Partial<FaceIdentity> = {}): FaceIdentity => ({
  latent: { space: 'w-plus', values: v2.latent.values },
  provenance,
  generationKind: 'seed',
  generationSha256: 'c'.repeat(64),
  ...over,
});

test('earlier saved stills read with exact latent and identity: schema 1 PNG, schema 2 PNG and WebP', () => {
  const v1 = readStill(stills('recovery-v1.png'))!;
  assert.equal(v1.schemaVersion, 1);
  for (const name of ['recovery-v1.png', 'recovery-v2.png', 'recovery-v2.webp']) {
    const r = readStill(stills(name))!;
    const raw = readRecovery(stills(name));
    assert.equal(raw.kind, 'parsed');
    if (raw.kind !== 'parsed') return;
    assert.equal(r.schemaVersion, raw.recovered.schemaVersion, name);
    assert.deepEqual(r.latent.shape, [18, 512]);
    assert.ok(bytesOf(r.latent.values).equals(bytesOf(v1.latent.values)), `${name}: exact latent`);
    assert.equal(r.provenance.modelSha256, '2'.repeat(64));
    assert.equal(r.provenance.noiseSha256, '3'.repeat(64));
    assert.equal(r.seed, 42);
    assert.equal(r.generationSha256, '1'.repeat(64));
    assert.equal(r.model, null, `${name}: a model this app does not ship has no model record`);
    assert.ok(Buffer.from(r.image).equals(Buffer.from(raw.recovered.baseImage)));
    assert.throws(
      () => checkFaceModel(r, runtime),
      (e) => e instanceof RecoveryFileError && e.code === 'unknown-model',
    );
  }
  assert.equal(readStill(file('../../../../packages/stylegan-js/test/vectors/plain.png')), null);
});

test('a damaged or future-schema still is a typed error with the reader reason', () => {
  assert.throws(
    () => readStill(stills('damaged-v1.png')),
    (e) => e instanceof RecoveryFileError && e.code === 'damaged' && /Damaged/.test(e.message),
  );
  const saved = writeStill(v2.image, face());
  const at = Buffer.from(saved).indexOf('"schema":3');
  const future = Buffer.from(saved);
  future.write('"schema":4', at);
  // The CRC no longer matches, so this is damage; a valid future record is covered in the package suite.
  assert.throws(() => readStill(new Uint8Array(future)), RecoveryFileError);
});

test('Save writes schema 3: generator record and W+ shape from the descriptor, exact latent, seed only on a seed face', () => {
  for (const [kind, seed, expected] of [
    ['seed', '42', 42],
    ['seed', 7, 7],
    ['latent', '42', undefined],
    ['photo', undefined, undefined],
  ] as const) {
    const saved = writeStill(v2.image, face({ generationKind: kind }), { seed });
    const r = readStill(saved)!;
    assert.equal(r.schemaVersion, 3);
    assert.equal(r.generationKind, kind);
    assert.equal(r.seed, expected);
    assert.deepEqual(r.model, {
      name: d.identity.name,
      architecture: 'stylegan2',
      subject: 'face',
      modelSha256: d.identity.modelSha256,
      noiseSha256: d.identity.noiseSha256,
      latent: { space: 'w-plus', layers: 18, width: 512 },
      output: { width: 1024, height: 1024 },
    });
    assert.ok(bytesOf(r.latent.values).equals(bytesOf(v2.latent.values)));
    assert.ok(Buffer.from(r.image).equals(Buffer.from(v2.image)), 'the image is untouched');
    checkFaceModel(r, runtime);
  }
  // A plain-array latent (as JSON-restored faces hold it) is written with the same float32 values.
  const plain = readStill(
    writeStill(v2.image, face({ latent: { values: Array.from(v2.latent.values) } })),
  )!;
  assert.ok(bytesOf(plain.latent.values).equals(bytesOf(v2.latent.values)));
  // Re-saving replaces the envelope; the hashes cover the new payload.
  const twice = readStill(
    writeStill(writeStill(v2.image, face()), face({ generationKind: 'photo' })),
  )!;
  assert.equal(twice.generationKind, 'photo');
  assert.throws(
    () =>
      writeStill(v2.image, face({ provenance: { ...provenance, modelSha256: '9'.repeat(64) } })),
    /not one this app ships/,
  );
  assert.throws(() => writeStill(v2.image, face(), { seed: 'x' }), /seed/);
  assert.throws(
    () => writeStill(v2.image, face({ latent: { values: v2.latent.values.subarray(0, 512) } })),
    /18 x 512/,
  );
});

test('equal-shape latent from another checkpoint is refused at the file entry', () => {
  const saved = readStill(writeStill(v2.image, face()))!;
  assert.throws(
    () => checkFaceModel(saved, { ...runtime, modelSha256: 'e'.repeat(64) }),
    (e) => e instanceof RecoveryFileError && e.code === 'unknown-model',
  );
  assert.equal(descriptorFor(runtime.modelSha256, runtime.noiseSha256), d);
  assert.equal(descriptorFor(runtime.modelSha256, 'f'.repeat(64)), null);
});

const fixtureProject = (): Project => {
  const p = JSON.parse(
    readFileSync(new URL('../../src/Next/project-v1.fixture.json', import.meta.url), 'utf8'),
  ) as Project;
  return {
    ...p,
    modelSha256: runtime.modelSha256,
    noiseSha256: runtime.noiseSha256,
    morph: {
      ...p.morph,
      controls: p.morph.controls.map((c, i) => ({
        visitId: c.visitId,
        latent: {
          space: 'w-plus',
          shape: [18, 512],
          values: Array.from(v2.latent.values, (v) => Math.fround(v * (i + 1))),
        },
      })),
    },
  };
};

test('a saved MP4 carries a schema-2 project that reads back as the app project, controls exact', () => {
  const candidate = readMp4Project(stills('project.mp4'));
  if (candidate.kind !== 'parsed') throw new Error('fixture movie');
  const movie = candidate.baseVideo;
  const project = fixtureProject();
  const route = {
    width: 256,
    height: 256,
    route: 'ffmpeg',
    reason: 'webcodecs-unavailable',
  } as const;
  const saved = writeProjectMp4(movie, project, route);
  assert.ok(
    Buffer.from(saved.subarray(0, movie.length)).equals(Buffer.from(movie)),
    'movie untouched',
  );
  const r = readProjectMp4(saved)!;
  assert.equal(r.schemaVersion, 2);
  assert.deepEqual(r.video, route);
  const back = decode(r.text);
  assert.ok(back.ok, JSON.stringify(back));
  if (!back.ok) return;
  assert.deepEqual(back.value, { ...project, schemaVersion: 1 });
  // Without the writer's report the route is the policy size read from the movie.
  assert.deepEqual(readProjectMp4(writeProjectMp4(movie, project))!.video, {
    width: 256,
    height: 256,
    route: 'webcodecs',
    reason: 'webcodecs-fallback-size',
  });
  assert.equal(routeOfMovie(movie).width, 256);
  // A project copied onto another movie, or a truncated file, is damage.
  const truncated = saved.subarray(0, saved.length - 100);
  assert.throws(() => readProjectMp4(truncated), RecoveryFileError);
  const copied = saved.slice();
  const mdat = Buffer.from(copied).indexOf('mdat') + 8;
  copied[mdat] = copied[mdat]! ^ 1; // a media byte: the project now belongs to another movie
  assert.throws(
    () => readProjectMp4(copied),
    (e) => e instanceof RecoveryFileError && /integrity/.test(e.detail),
  );
  assert.equal(readProjectMp4(movie), null);
  assert.equal(readProjectMp4(new TextEncoder().encode('not an mp4')), null);
  assert.throws(() => writeProjectMp4(movie, { ...project, modelSha256: '9'.repeat(64) }), /ships/);
});

test('the candidate schema-1 project MP4 reads as its own project text, unchanged', () => {
  const r = readProjectMp4(stills('project.mp4'))!;
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.video, null);
  const fixture = JSON.parse(
    readFileSync(new URL('../../src/Next/project-v1.fixture.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(JSON.parse(r.text), fixture);
});

test('the Blob envelope the encoder worker uses writes schema 3 for a shipped model, schema 2 otherwise', async () => {
  // @ts-expect-error -- an untyped .mjs module of the candidate bridge
  const { embedRecovery, recoverEnvelope } = await import('../../src/Next/image-envelope.mjs');
  const blob = new Blob([new Uint8Array(v2.image)], { type: 'image/png' });
  const result = {
    latent: { values: v2.latent.values },
    provenance,
    generationKind: 'seed',
    generationSha256: 'c'.repeat(64),
  };
  const shipped = await embedRecovery(blob, result, { seed: 42 });
  const three = readStill(new Uint8Array(await shipped.blob.arrayBuffer()))!;
  assert.equal(three.schemaVersion, 3);
  assert.equal(three.seed, 42);
  assert.equal(shipped.baseImageSha256, three.imageSha256);
  assert.equal(shipped.latentSha256, three.latentSha256);
  const back = await recoverEnvelope(shipped.blob);
  assert.equal(back.schemaVersion, 3);
  assert.equal(back.model.modelSha256, runtime.modelSha256);
  assert.ok(bytesOf(back.latent.values).equals(bytesOf(v2.latent.values)));
  assert.ok(Buffer.from(await back.blob.arrayBuffer()).equals(Buffer.from(v2.image)));
  const other = await embedRecovery(blob, {
    ...result,
    provenance: { ...provenance, modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) },
  });
  assert.equal(readStill(new Uint8Array(await other.blob.arrayBuffer()))!.schemaVersion, 2);
  assert.deepEqual(
    await recoverEnvelope(new Blob([stills('recovery-v1.png')], { type: 'image/png' })),
    {
      legacy: true,
    },
  );
  await assert.rejects(embedRecovery(shipped.blob, result), /already/);
});

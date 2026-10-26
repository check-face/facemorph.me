// MP4 project metadata (fm-fzzd): the candidate's saved project MP4 (vectors/mp4/candidate-project.mp4, written by
// classic decorateVideo over the project-v1.fixture.json morph) reads with its controls and settings intact; the
// schema-2 writer round-trips FFHQ and AFHQ-shaped controls exactly; truncation, a copied obsolete project and
// a video that disagrees with its project are typed damage. Real-browser playback is test/browser/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AFHQ_CAT_512_DESCRIPTOR,
  FFHQ_1024_DESCRIPTOR,
  MP4_FORMAT_HELP,
  embedMp4Project,
  mp4VideoInfo,
  readMp4Project,
  videoFileResult,
  type LatentTensor,
  type ModelDescriptor,
  type Mp4ProjectInput,
  type Mp4ProjectResult,
} from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const vector = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./vectors/mp4/${name}`, import.meta.url)));
const fixtureProject = JSON.parse(
  readFileSync(new URL('./vectors/mp4/project-v1.fixture.json', import.meta.url), 'utf8'),
);
const candidate = vector('candidate-project.mp4');
/** The candidate MP4 without its project box: the movie as the encoder wrote it. */
const movie = () => {
  const r = readMp4Project(candidate);
  assert.equal(r.kind, 'parsed');
  return r.kind === 'parsed' ? r.baseVideo : new Uint8Array();
};

function latent(d: ModelDescriptor, seed: number): LatentTensor {
  const random = mulberry32(seed);
  return {
    space: 'w-plus',
    shape: [d.latent.layers, d.latent.width],
    values: Float32Array.from({ length: d.latent.layers * d.latent.width }, () => random() * 6 - 3),
  };
}

const input = (
  d: ModelDescriptor,
  n = 3,
  over: Partial<Mp4ProjectInput> = {},
): Mp4ProjectInput => ({
  descriptor: d,
  bundle: { version: 'test-bundle', manifestSha256: 'b'.repeat(64) },
  truncationPsi: 1,
  truncationCutoff: 0,
  morph: {
    algorithmVersion: 'geometry-v1',
    kind: 'full-smooth-figure8',
    closed: true,
    width: 0.2,
    pinchCenter: true,
    framesPerSegment: 16,
    framesPerSecond: 24,
    controls: Array.from({ length: n }, (_, i) => ({
      visitId: `face-${i}`,
      latent: latent(d, i + 1),
    })),
  },
  route: videoFileResult({ kind: 'webcodecs', width: 256, height: 256 }),
  ...over,
});

function parsed(r: Mp4ProjectResult) {
  assert.equal(r.kind, 'parsed', JSON.stringify(r));
  if (r.kind !== 'parsed') throw new Error('unreachable');
  return r;
}
const damaged = (r: Mp4ProjectResult, reason: string, what: string) => {
  assert.equal(r.kind, 'damaged', what);
  assert.equal(r.kind === 'damaged' && r.reason, reason, what);
};
const bytesOf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

test('the candidate project MP4 reads as schema 1 with its ordered controls and settings intact', () => {
  const r = parsed(readMp4Project(candidate));
  assert.deepEqual(r.video, { codec: 'avc1', width: 256, height: 256, frameCount: 16 });
  const p = r.project;
  assert.equal(p.schemaVersion, 1);
  if (p.schemaVersion !== 1) return;
  assert.deepEqual(JSON.parse(p.text), fixtureProject, 'the stored project is the fixture project');
  const { controls, ...settings } = p.morph;
  const { controls: fixtureControls, ...fixtureSettings } = fixtureProject.morph;
  assert.deepEqual(settings, fixtureSettings);
  assert.deepEqual(
    controls.map((c) => [c.visitId, [...c.latent.shape], Array.from(c.latent.values)]),
    fixtureControls.map((c: { visitId: string; latent: { shape: number[]; values: number[] } }) => [
      c.visitId,
      c.latent.shape,
      c.latent.values,
    ]),
  );
  assert.equal(p.modelSha256, fixtureProject.modelSha256);
});

test('a project-v1-shaped project with real 18 x 512 latents reads exactly (candidate decorateVideo layout)', () => {
  const d = FFHQ_1024_DESCRIPTOR;
  const controls = [1, 2].map((s, i) => {
    const l = latent(d, s);
    return {
      visitId: `v${i}`,
      latent: { space: 'w-plus', shape: [18, 512], values: Array.from(l.values) },
    };
  });
  const project = {
    ...fixtureProject,
    morph: { ...fixtureProject.morph, kind: 'linear', controls },
  };
  const json = Buffer.from(JSON.stringify(project));
  const box = Buffer.alloc(24 + json.length);
  box.writeUInt32BE(box.length, 0);
  box.write('uuid', 4);
  box.write('FaceMorphProject', 8);
  json.copy(box, 24);
  const r = parsed(readMp4Project(new Uint8Array(Buffer.concat([movie(), box]))));
  assert.equal(r.project.schemaVersion, 1);
  r.project.morph.controls.forEach((c, i) =>
    assert.ok(
      bytesOf(c.latent.values).equals(bytesOf(latent(d, i + 1).values)),
      `control ${i} exact`,
    ),
  );
});

test('schema 2 round trip: FFHQ and AFHQ-shaped controls, settings, model and video facts exact', () => {
  for (const d of [FFHQ_1024_DESCRIPTOR, AFHQ_CAT_512_DESCRIPTOR]) {
    const i = input(d, 4);
    const saved = embedMp4Project(movie(), i);
    const r = parsed(readMp4Project(saved));
    const p = r.project;
    assert.equal(p.schemaVersion, 2);
    if (p.schemaVersion !== 2) return;
    assert.equal(p.model.modelSha256, d.identity.modelSha256);
    assert.deepEqual(p.model.latent, {
      space: 'w-plus',
      layers: d.latent.layers,
      width: d.latent.width,
    });
    assert.deepEqual(p.bundle, i.bundle);
    assert.deepEqual(p.video, {
      width: 256,
      height: 256,
      frameCount: 16,
      route: 'webcodecs',
      reason: 'webcodecs-fallback-size',
    });
    const { controls, ...settings } = p.morph;
    const { controls: want, ...wantSettings } = i.morph;
    assert.deepEqual(settings, wantSettings);
    assert.deepEqual(
      controls.map((c) => c.visitId),
      want.map((c) => c.visitId),
      'order kept',
    );
    controls.forEach((c, k) => {
      assert.deepEqual(c.latent.shape, [d.latent.layers, d.latent.width]);
      assert.ok(
        bytesOf(c.latent.values).equals(bytesOf(want[k]!.latent.values)),
        `control ${k} byte-exact`,
      );
    });
    assert.ok(
      Buffer.from(r.baseVideo).equals(Buffer.from(movie())),
      'the movie bytes are untouched',
    );
    // Re-saving replaces the project box instead of adding a second one.
    const again = embedMp4Project(saved, i);
    assert.equal(again.length, saved.length);
    assert.equal(parsed(readMp4Project(again)).project.schemaVersion, 2);
  }
});

test('a truncated MP4 is rejected', () => {
  const saved = embedMp4Project(movie(), input(FFHQ_1024_DESCRIPTOR));
  for (const cut of [1, 100, saved.length - movie().length + 10, saved.length - 2000])
    damaged(readMp4Project(saved.subarray(0, saved.length - cut)), 'truncated', `cut ${cut}`);
  damaged(
    readMp4Project(candidate.subarray(0, candidate.length - 1)),
    'truncated',
    'candidate file',
  );
});

test('a project copied from another video (obsolete integrity hash) fails; so do edited values', () => {
  const a = embedMp4Project(movie(), input(FFHQ_1024_DESCRIPTOR));
  const otherMovie = movie().slice();
  otherMovie[otherMovie.length - 5]! ^= 0xff; // one byte of media data differs
  const box = a.subarray(movie().length);
  damaged(
    readMp4Project(new Uint8Array(Buffer.concat([otherMovie, box]))),
    'integrity',
    'copied project box',
  );
  const text = Buffer.from(box.subarray(24)).toString('utf8');
  const rebox = (json: string) => {
    const body = Buffer.from(json);
    const b = Buffer.alloc(24 + body.length);
    b.writeUInt32BE(b.length, 0);
    b.write('uuid', 4);
    b.write('FaceMorphProject', 8);
    body.copy(b, 24);
    return new Uint8Array(Buffer.concat([movie(), b]));
  };
  const record = JSON.parse(text);
  damaged(
    readMp4Project(
      rebox(JSON.stringify({ ...record, video: { ...record.video, frameCount: 17 } })),
    ),
    'video-mismatch',
    'frame count',
  );
  const shifted = structuredClone(record);
  shifted.morph.controls[0].latent.data = shifted.morph.controls[1].latent.data;
  damaged(
    readMp4Project(rebox(JSON.stringify(shifted))),
    'integrity',
    'latent swapped without its hash',
  );
  const reshaped = structuredClone(record);
  reshaped.morph.controls[0].latent.shape = [16, 512];
  damaged(
    readMp4Project(rebox(JSON.stringify(reshaped))),
    'invalid-fields',
    'shape not the model record',
  );
  for (const v of [3, 0, '2']) {
    const r = readMp4Project(rebox(JSON.stringify({ ...record, schemaVersion: v })));
    assert.deepEqual(r, { kind: 'incompatible-schema', schemaVersion: v });
  }
  damaged(readMp4Project(rebox('{not json')), 'unreadable-json', 'json');
  damaged(
    readMp4Project(new Uint8Array(Buffer.concat([a, box]))),
    'duplicate-metadata',
    'two project boxes',
  );
});

test('missing project, non-MP4 bytes and writer refusals', () => {
  assert.deepEqual(readMp4Project(movie()), { kind: 'missing' });
  assert.deepEqual(readMp4Project(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8)), {
    kind: 'missing',
  });
  assert.throws(() => embedMp4Project(movie(), input(FFHQ_1024_DESCRIPTOR, 1)), /morph settings/);
  assert.throws(
    () =>
      embedMp4Project(
        movie(),
        input(FFHQ_1024_DESCRIPTOR, 3, {
          route: videoFileResult({
            kind: 'ffmpeg',
            width: 512,
            height: 512,
            reason: 'webcodecs-unavailable',
          }),
        }),
      ),
    /256 x 256, not the reported 512 x 512/,
  );
  const mixed = input(FFHQ_1024_DESCRIPTOR);
  const wrong = {
    ...mixed,
    morph: {
      ...mixed.morph,
      controls: [
        ...mixed.morph.controls,
        { visitId: 'cat', latent: latent(AFHQ_CAT_512_DESCRIPTOR, 9) },
      ],
    },
  };
  assert.throws(() => embedMp4Project(movie(), wrong), /18 x 512/);
  assert.throws(
    () => embedMp4Project(movie().subarray(0, 4000), input(FFHQ_1024_DESCRIPTOR)),
    /damaged/,
  );
  assert.deepEqual(mp4VideoInfo(movie()), {
    codec: 'avc1',
    width: 256,
    height: 256,
    frameCount: 16,
  });
  assert.equal(
    MP4_FORMAT_HELP,
    'Video; reopening this file as a project is not available in this release.',
  );
});

test('the file result reports width, height, route and reason for every encoder choice', () => {
  assert.deepEqual(videoFileResult({ kind: 'webcodecs', width: 1024, height: 1024 }), {
    width: 1024,
    height: 1024,
    route: 'webcodecs',
    reason: 'webcodecs-full-size',
  });
  assert.deepEqual(videoFileResult({ kind: 'webcodecs', width: 512, height: 512 }), {
    width: 512,
    height: 512,
    route: 'webcodecs',
    reason: 'webcodecs-fallback-size',
  });
  for (const reason of ['webcodecs-unavailable', 'webcodecs-unsupported'] as const)
    assert.deepEqual(videoFileResult({ kind: 'ffmpeg', width: 512, height: 512, reason }), {
      width: 512,
      height: 512,
      route: 'ffmpeg',
      reason,
    });
});

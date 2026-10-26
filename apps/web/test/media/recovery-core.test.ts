// The recovery schema core (fm-fzzd, in @facemorph/stylegan-js) against the app's own contracts: a blend's export
// identity and filename come from its recipe through exportIdentity/suggestFilename; forced encoder choices from
// export-policy report the file's actual size, route and reason; and the candidate's saved project MP4, read by the
// package, decodes through the app's project codec (project-json.ts) with its controls and settings intact.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  FFHQ_1024_DESCRIPTOR,
  blendExportInputs,
  blendWithRecipe,
  readMp4Project,
  videoFileResult,
  type LatentTensor,
} from '@facemorph/stylegan-js';
import { exportIdentity, suggestFilename } from '../../src/contracts/export-identity.ts';
import { chooseVideoEncoder, WEBP_QUALITY } from '../../src/media/export-policy.ts';
import { decode } from '../../src/project/project-json.ts';

const d = FFHQ_1024_DESCRIPTOR;
const latent = (k: number): LatentTensor => ({
  space: 'w-plus',
  shape: [18, 512],
  values: Float32Array.from({ length: 18 * 512 }, (_, i) => Math.sin(i * k)),
});

function blendName(weights: number[]) {
  const r = blendWithRecipe(
    d,
    [
      { kind: 'word', latent: latent(1) },
      { kind: 'seed', latent: latent(2) },
      { kind: 'photo', latent: latent(3) },
    ],
    weights,
  );
  assert.ok(r.ok);
  if (!r.ok) throw new Error('unreachable');
  const { orderedInputs, label } = blendExportInputs(r.value.recipe);
  const identity = exportIdentity(
    {
      kind: 'webp',
      crops: [],
      orderedInputs,
      modelIdentity: d.identity.modelSha256,
      format: 'webp',
      encodingOptions: { quality: WEBP_QUALITY },
    },
    { origin: 'result-name', text: label },
  );
  return { identity, name: suggestFilename(identity, []).filename };
}

test('a blend export identity includes its recipe and is named by the filename rule', () => {
  const a = blendName([0.3, 0.3, 0.4]);
  const b = blendName([0.3, 0.3, 0.45]);
  assert.match(a.name, /^blend-3-faces-[bcdfghjkmnpqrstvwxz2-9]{6}\.webp$/);
  assert.notEqual(a.identity.digest, b.identity.digest, 'one weight apart: different identities');
  assert.notEqual(a.name, b.name);
  assert.equal(blendName([0.3, 0.3, 0.4]).name, a.name, 'the same blend reuses its name');
});

test('forced WebCodecs-512 and forced FFmpeg report {width: 512, height: 512, route, reason}', () => {
  const at512 = chooseVideoEncoder(16, (s) => s.width === 512);
  assert.deepEqual(videoFileResult(at512), {
    width: 512,
    height: 512,
    route: 'webcodecs',
    reason: 'webcodecs-fallback-size',
  });
  assert.deepEqual(videoFileResult(chooseVideoEncoder(16, null)), {
    width: 512,
    height: 512,
    route: 'ffmpeg',
    reason: 'webcodecs-unavailable',
  });
  assert.deepEqual(videoFileResult(chooseVideoEncoder(16, () => false)), {
    width: 512,
    height: 512,
    route: 'ffmpeg',
    reason: 'webcodecs-unsupported',
  });
  assert.deepEqual(videoFileResult(chooseVideoEncoder(16, () => true)), {
    width: 1024,
    height: 1024,
    route: 'webcodecs',
    reason: 'webcodecs-full-size',
  });
});

test('the candidate project MP4 decodes through the app project codec with controls and settings intact', () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('../fixtures/verify/stills/project.mp4', import.meta.url)),
  );
  const r = readMp4Project(bytes);
  assert.equal(r.kind, 'parsed');
  if (r.kind !== 'parsed' || r.project.schemaVersion !== 1)
    throw new Error('expected a schema-1 project');
  const project = decode(r.project.text);
  assert.ok(project.ok, JSON.stringify(project));
  const fixture = JSON.parse(
    readFileSync(new URL('../../src/Next/project-v1.fixture.json', import.meta.url), 'utf8'),
  );
  assert.equal(r.project.morph.controls.length, fixture.morph.controls.length);
  assert.deepEqual(
    r.project.morph.controls.map((c) => c.visitId),
    fixture.morph.controls.map((c: { visitId: string }) => c.visitId),
  );
  assert.equal(r.project.morph.kind, fixture.morph.kind);
  assert.equal(r.project.morph.framesPerSecond, fixture.morph.framesPerSecond);
});

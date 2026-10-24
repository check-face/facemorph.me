// Writes the verification harness's recovery-bearing stills and project MP4 (fm-48bj) with the candidate's own
// writers, imported byte-identical into apps/web/src/Next (classic a42829b): decorateImage (schema 1 PNG),
// embedRecovery (schema 2 PNG and WebP), decorateVideo (project MP4). Bases are synthetic: the gradient stills in
// packages/stylegan-js/test/vectors and the fixture morph MP4. Then reads every file back with the candidate's
// readers and records its SHA-256 in stills.json. Deterministic: the same inputs give the same bytes.
//   node apps/web/test/fixtures/verify/make-stills.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from '../../../src/Next/browser/originals.mjs';
import { decorateImage, decorateVideo, recoverImage, recoverVideoProject } from '../../../src/Next/recovery-metadata.mjs';
import { embedRecovery, recoverEnvelope } from '../../../src/Next/image-envelope.mjs';

const here = new URL('stills/', import.meta.url);
const vectors = new URL('../../../../../packages/stylegan-js/test/vectors/', import.meta.url);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const bytesOf = async (blob) => Buffer.from(await blob.arrayBuffer());

// A realistic W+ latent: seeded N(0, 1) float32 values, as the mapping network produces (not zeros: a zero latent
// hides the schema 1 size defect, fm-1muu).
let seed = 1;
const uniform = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const values = Float32Array.from(
  { length: 18 * 512 },
  () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()),
);
const provenance = (modelSha256) => ({
  bundleVersion: 'fixture',
  modelSha256,
  noiseSha256: '3'.repeat(64),
  route: 'cpu',
  truncationPsi: 0.7,
});
const result = async (blob, modelSha256 = '2'.repeat(64)) => ({
  blob,
  imageSha256: await digest(new Uint8Array(await blob.arrayBuffer())),
  latentSha256: await digest(values),
  generationKind: 'seed',
  generationSha256: '1'.repeat(64),
  provenance: provenance(modelSha256),
  latent: { space: 'w-plus', values },
});
const png = readFileSync(new URL('plain.png', vectors));
const webp = readFileSync(new URL('plain.webp', vectors));
const blob = (b, type) => new Blob([b], { type });

const out = {};
const write = async (name, b, what) => {
  writeFileSync(new URL(name, here), b);
  out[name] = { sha256: sha256(b), bytes: b.length, what };
};

const v1 = await bytesOf(await decorateImage((await result(blob(png, 'image/png'))), 42));
await write('recovery-v1.png', v1, 'schema 1 PNG (decorateImage), seed 42');
const v2png = await bytesOf((await embedRecovery(blob(png, 'image/png'), (await result(blob(png, 'image/png'))), { seed: 42 })).blob);
await write('recovery-v2.png', v2png, 'schema 2 PNG (embedRecovery), seed 42');
const v2webp = await bytesOf((await embedRecovery(blob(webp, 'image/webp'), (await result(blob(webp, 'image/webp'))), { seed: 42 })).blob);
await write('recovery-v2.webp', v2webp, 'schema 2 lossless WebP (embedRecovery), seed 42');
const other = await bytesOf((await embedRecovery(blob(png, 'image/png'), (await result(blob(png, 'image/png'), '9'.repeat(64))), { seed: 42 })).blob);
await write('model-mismatch-v2.png', other, 'schema 2 PNG for a model this bundle is not (modelSha256 9...9)');
// Damage: one byte of the schema 1 metadata payload flipped, so its chunk CRC no longer matches.
const damaged = Buffer.from(v1);
const at = damaged.indexOf(Buffer.from('FaceMorph\0')) + 40;
damaged[at] ^= 0x20;
await write('damaged-v1.png', damaged, 'schema 1 PNG with one metadata byte flipped (CRC mismatch)');
const project = JSON.parse(readFileSync(new URL('../../../src/Next/project-v1.fixture.json', import.meta.url), 'utf8'));
const mp4 = readFileSync(new URL('../morph/morph.mp4', import.meta.url));
const saved = await bytesOf(await decorateVideo(blob(mp4, 'video/mp4'), project));
await write('project.mp4', saved, 'saved project MP4 (decorateVideo over the fixture morph, project-v1.fixture.json)');

// Read back with the candidate's readers.
const check = [];
// The schema 1 chunk read directly: its JSON carries the latent and seed.
const v1Json = (b) => {
  const start = b.indexOf(Buffer.from('FaceMorph\0')) + 10;
  return JSON.parse(b.subarray(start, b.indexOf(Buffer.from('IEND')) - 8).toString('utf8'));
};
const v1Record = v1Json(v1);
check.push([
  'recovery-v1.png',
  v1Record.schema === 1 && v1Record.seed === 42 && v1Record.latent.values.every((v, i) => v === values[i]),
]);
// Observed, not asserted as correct: the candidate's own recoverImage refuses this realistic schema 1 still.
out['recovery-v1.png'].candidateRecoverImage = await recoverImage(blob(v1, 'image/png')).then(
  () => 'recovered',
  (e) => `throws: ${e.message}`,
);
check.push(['recovery-v2.png', (await recoverEnvelope(blob(v2png, 'image/png')))?.seed === 42]);
check.push(['recovery-v2.webp', (await recoverEnvelope(blob(v2webp, 'image/webp')))?.seed === 42]);
check.push(['model-mismatch-v2.png', (await recoverEnvelope(blob(other, 'image/png')))?.provenance?.modelSha256 === '9'.repeat(64)]);
check.push(['damaged-v1.png', await recoverImage(blob(damaged, 'image/png')).then(() => false, (e) => /Damaged/.test(e.message))]);
check.push(['project.mp4', JSON.parse(await recoverVideoProject(blob(saved, 'video/mp4'))).schemaVersion === 1]);
const failed = check.filter(([, ok]) => !ok);
writeFileSync(new URL('stills.json', here), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ written: Object.keys(out).length, readBack: check.length - failed.length, failed: failed.map(([n]) => n) }));
process.exit(failed.length ? 1 : 0);

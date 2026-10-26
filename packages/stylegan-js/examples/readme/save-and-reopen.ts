import {
  checkCombinable,
  encodeLosslessWebp,
  encodePng,
  FFHQ_1024_DESCRIPTOR,
  latentDigest,
  readRecovery,
  type LatentTensor,
  type RgbaPixels,
} from '@facemorph/stylegan-js';

// In an app these are a face's W+ latent and the RGBA pixels `synthesize` returned for it.
const d = FFHQ_1024_DESCRIPTOR;
const [, , height, width] = d.output.shape;
const { modelSha256, noiseSha256 } = d.identity;
const latent: LatentTensor = {
  space: 'w-plus',
  shape: [d.latent.layers, d.latent.width],
  values: Float32Array.from({ length: d.latent.layers * d.latent.width }, (_, i) => Math.sin(i)),
};
const pixels: RgbaPixels = {
  width,
  height,
  rgba: new Uint8Array(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : i % 251)),
};

// Save: an exact PNG and a lossless WebP, each carrying the latent and the generator that made it.
const recovery = {
  descriptor: d,
  generationKind: 'latent' as const,
  generationSha256: latentDigest(latent),
  provenance: { modelSha256, noiseSha256 },
  latent,
};
const png = await encodePng(pixels, recovery);
const webp = encodeLosslessWebp(pixels, recovery);

// Reopen: the latent and the model identity come back exactly. Nothing here fetches anything.
for (const file of [png, webp]) {
  const read = readRecovery(file);
  if (read.kind !== 'parsed') throw new Error(`not reopenable: ${read.kind}`);
  const { recovered } = read;
  if (recovered.schemaVersion !== 3) throw new Error('expected schema 3');
  if (recovered.provenance.modelSha256 !== modelSha256) throw new Error('model identity changed');
  if (!recovered.latent.values.every((v, i) => v === latent.values[i]))
    throw new Error('latent changed');
}

// Latents of two different checkpoints never combine, even when their shapes are equal.
const other = { modelSha256: 'f'.repeat(64), noiseSha256, latent };
const mixed = checkCombinable(d, [{ modelSha256, noiseSha256, latent }, other]);
if (mixed.ok || mixed.error.code !== 'mixed-model') throw new Error('mixed models must be refused');

console.log(`saved and reopened: PNG ${png.length} bytes, lossless WebP ${webp.length} bytes`);

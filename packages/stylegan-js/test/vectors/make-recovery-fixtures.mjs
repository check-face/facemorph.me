// Regenerates the recovery fixtures: real 1024x1024 PNG and lossless WebP images (ImageMagick)
// carrying envelopes written by the candidate's own embedRecovery (classic a42829b
// src/Next/image-envelope.mjs), so the reader is tested against the real writer, not itself.
//   CLASSIC_CHECKOUT=../facemorph.me-classic node test/vectors/make-recovery-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const classic = process.env.CLASSIC_CHECKOUT ?? join(here, '../../../../../facemorph.me-classic');
const work = mkdtempSync(join(tmpdir(), 'recovery-fixtures-'));
writeFileSync(join(work, 'image-envelope.mjs'), execFileSync('git', ['-C', classic, 'show', 'a42829b:src/Next/image-envelope.mjs']));
const { embedRecovery } = await import(join(work, 'image-envelope.mjs'));

const values = Float32Array.from({ length: 18 * 512 }, (_, i) => Math.sin(i) * 3);
const result = {
  generationKind: 'seed',
  generationSha256: '1'.repeat(64),
  provenance: { bundleVersion: 'fixture', modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64), route: 'webgpu', truncationPsi: 0.7 },
  latent: { values },
};
for (const [ext, mime, args] of [['png', 'image/png', []], ['webp', 'image/webp', ['-define', 'webp:lossless=true']]]) {
  const plain = join(work, `plain.${ext}`);
  execFileSync('magick', ['-size', '1024x1024', 'gradient:#204060-#c08040', ...args, plain]);
  const base = readFileSync(plain);
  writeFileSync(join(here, `plain.${ext}`), base);
  const { blob } = await embedRecovery(new Blob([base], { type: mime }), result, { seed: 42 });
  writeFileSync(join(here, `recovery.${ext}`), Buffer.from(await blob.arrayBuffer()));
}
writeFileSync(join(here, 'recovery-latent.f32'), Buffer.from(values.buffer));
console.log('fixtures written to', here);

// The AFHQ cat 512 morph workload (fm-suaa), shared by afhq-morph.test.ts and the reference step: a closed two-face
// pairwise ellipse at width 0.7, 4 frames per segment (8 frames), between the upstream W+ of seeds 0 and 1 from the
// model's reference (test/vectors/afhq-cat-512/make-reference.py), with every shape from the AFHQ descriptor.
//   node test/morph/afhq-morph.ts latents <dir>   writes latents.f32 [frames,16,512] and latents.json there
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AFHQ_CAT_512_DESCRIPTOR } from '../../src/contracts/descriptor.ts';
import { createLatentPath, type MorphPathSpec } from '../../src/morph/latent-path.ts';

export function afhqMorph(model: string): MorphPathSpec {
  const { layers, width } = AFHQ_CAT_512_DESCRIPTOR.latent;
  return {
    algorithmVersion: 'latent-path-v1',
    kind: 'pairwise-ellipse',
    closed: true,
    pinchCenter: false,
    width: 0.7,
    framesPerSegment: 4,
    framesPerSecond: 16,
    controls: [0, 1].map((seed) => {
      const bytes = readFileSync(join(model, 'reference', `seed-${seed}.w.f32`));
      return {
        visitId: `seed-${seed}`,
        latent: {
          space: 'w-plus' as const,
          shape: [layers, width],
          values: new Float32Array(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ),
        },
      };
    }),
  };
}

/** The path's frame latents as float32 [frames, layers, width], as the engine receives them. */
export function afhqLatents(model: string): { bytes: Uint8Array; shape: number[]; sha256: string } {
  const path = createLatentPath(afhqMorph(model), AFHQ_CAT_512_DESCRIPTOR);
  const { layers, width } = AFHQ_CAT_512_DESCRIPTOR.latent;
  const out = new Float32Array(path.totalFrames * layers * width);
  for (const frame of path.frames())
    out.set(Float32Array.from(frame.values), frame.index * layers * width);
  const bytes = new Uint8Array(out.buffer);
  return {
    bytes,
    shape: [path.totalFrames, layers, width],
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv[2] === 'latents'
) {
  const dir = process.argv[3]!;
  const model = join(dir, '..');
  const { bytes, shape, sha256 } = afhqLatents(model);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latents.f32'), bytes);
  writeFileSync(
    join(dir, 'latents.json'),
    JSON.stringify(
      { shape, sha256, morph: { ...afhqMorph(model), controls: ['seed-0', 'seed-1'] } },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ shape, sha256 }));
}

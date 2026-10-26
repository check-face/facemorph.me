// A morph of a non-FFHQ model (fm-suaa): AFHQ cat 512 (16 W+ layers) through renderMorph, with the path from the
// package geometry on the AFHQ descriptor (afhq-morph.ts) and every frame synthesized by the package's CPU generator
// on the converted model, against the pinned upstream implementation rendering the same latents on the original
// checkpoint (afhq-morph-reference.py), held to the model's own declared tolerance (raw 1e-3, RGB 1). The latents'
// and each reference frame's digests are committed (afhq-morph-reference.json); the weights and arrays are not, and
// where they are absent the case reports untested.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as onnx from 'onnxruntime-web';
import { AFHQ_CAT_512_DESCRIPTOR } from '../../src/contracts/descriptor.ts';
import { loadCpuGenerator } from '../../src/engine/adapters/cpu.ts';
import type { GeneratorManifest } from '../../src/engine/adapters/generator.ts';
import type { OrtModule } from '../../src/engine/adapters/ort.ts';
import { toRgba8 } from '../../src/engine/identity.ts';
import { infillFrames } from '../../src/morph/infill.ts';
import { createLatentPath } from '../../src/morph/latent-path.ts';
import { renderMorph, type MorphImage } from '../../src/morph/render.ts';
import { runtimeReader } from '../engine/support/runtime.ts';
import { afhqLatents, afhqMorph } from './afhq-morph.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
const REF = join(MODEL, 'morph-reference');
const RECORD = JSON.parse(
  readFileSync(new URL('afhq-morph-reference.json', import.meta.url), 'utf8'),
) as {
  tolerance: { rawFloat: number; rgb: number };
  latents: { sha256: string; shape: number[] };
  frames: { index: number; file: string; size: number; sha256: string }[];
};
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const UNTESTED = `untested here: the converted AFHQ cat model and its morph reference are not at ${MODEL} (see afhq-morph-reference.py)`;

test(
  'an AFHQ cat 512 morph renders through renderMorph within the model’s own tolerance of the upstream reference',
  { timeout: 900_000, skip: !existsSync(join(REF, 'latents.f32')) && UNTESTED },
  async (t) => {
    const latents = afhqLatents(MODEL);
    assert.deepEqual(
      [latents.sha256, latents.shape],
      [RECORD.latents.sha256, RECORD.latents.shape],
      'the committed path latents',
    );
    const manifestBytes = readFileSync(join(MODEL, 'manifest.json'));
    const ort = onnx as unknown as OrtModule;
    ort.env.wasm.numThreads = 1;
    const g = await loadCpuGenerator({
      reader: runtimeReader(MODEL),
      manifest: JSON.parse(manifestBytes.toString('utf8')) as GeneratorManifest,
      manifestSha256: sha256(manifestBytes),
      ort: async () => ort,
      descriptor: AFHQ_CAT_512_DESCRIPTOR,
    });
    t.after(() => g.dispose());
    const morph = afhqMorph(MODEL);
    const path = createLatentPath(morph, AFHQ_CAT_512_DESCRIPTOR);
    type RawImage = MorphImage & { raw: Float32Array };
    const produce = async (values: Float32Array) => {
      const raw = await g.synthesizeRaw(values);
      return { blob: { size: raw.byteLength, type: 'raw', raw } as RawImage };
    };
    const checks: { index: number; maxRaw: number; maxRgb: number }[] = [];
    const out = await renderMorph({
      path,
      canonical: () => infillFrames(path, morph),
      descriptor: AFHQ_CAT_512_DESCRIPTOR,
      source: {
        synthesize: (l) => produce(l.values),
        async synthesizeFrames(ls, o) {
          for (let at = 0; at < ls.length; at++) await o.onFrame(at, await produce(ls[at]!.values));
        },
      },
      writer: {
        async add(blob, index) {
          const raw = (blob as RawImage).raw;
          const row = RECORD.frames[index]!;
          const bytes = readFileSync(join(REF, row.file));
          assert.equal(sha256(bytes), row.sha256, `${row.file} matches the committed digest`);
          const ref = new Float32Array(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
          );
          let maxRaw = 0;
          for (let i = 0; i < raw.length; i++)
            maxRaw = Math.max(maxRaw, Math.abs(raw[i]! - ref[i]!));
          const a = toRgba8(raw, 512, 512),
            b = toRgba8(ref, 512, 512);
          let maxRgb = 0;
          for (let i = 0; i < a.length; i++)
            if (i % 4 !== 3) maxRgb = Math.max(maxRgb, Math.abs(a[i]! - b[i]!));
          checks.push({ index, maxRaw, maxRgb });
        },
        finish: async () => ({ size: checks.length, type: 'video/mp4' }),
        dispose() {},
      },
    });
    t.diagnostic(
      `AFHQ morph ${out.status} on ${out.branch}: ${checks.length} frames, max raw ${Math.max(...checks.map((c) => c.maxRaw)).toExponential(2)}, max RGB ${Math.max(...checks.map((c) => c.maxRgb))}`,
    );
    assert.deepEqual([out.status, out.branch, checks.length], ['complete', 'blob-stream', 8]);
    for (const c of checks)
      assert.ok(
        c.maxRaw <= RECORD.tolerance.rawFloat && c.maxRgb <= RECORD.tolerance.rgb,
        JSON.stringify(c),
      );
  },
);

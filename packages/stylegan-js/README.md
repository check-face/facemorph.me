# stylegan-js

StyleGAN2 mapping, synthesis and e4e photo encoding in the browser, with morphs, blends and saved files that
reopen exactly. It runs a converted StyleGAN2 generator in a web page or worker on the CPU (ONNX Runtime WASM) or
on WebGPU, from model bytes that you host and it verifies.

Using a new dataset means acquiring or training a compatible StyleGAN2 checkpoint first; this project does not train models.

What it is not:
- **Not a server or Node inference library.** The documented deployment is a browser app with static model assets.
  Node, headless and server inference are unsupported: no provider for them has its own evidence.
- **Not bundled with weights.** You host converted model files (see [Models](#models)); this package never fetches
  anything by itself.
- **Not a trainer or converter.** Checkpoints are converted by `model-conv` (see
  [compatibility](../model-conv/docs/compatibility.md)).

Entry points: `.` (contracts, media, blend, morph), `./engine` (the engine core: loading, canaries, mapping,
synthesis, the e4e encoder, worker helpers) and `./engine/webgpu` (just the two WebGPU generator loaders, so a worker
can `import()` them only when it takes a WebGPU route). Every export is listed in the [API reference](docs/api.md).
See also [capabilities](docs/capabilities.md) and [saved file formats](docs/formats.md).

## Install

<!-- docs-test: install -->
```sh
npm install stylegan-js
```

The package is ESM only, with `.d.ts` declarations, no runtime dependencies and `"sideEffects": false`. Importing
it does no I/O and touches no globals.

## Quick start: load a model and make a face

[`examples/caller-loaded`](examples/caller-loaded) is the complete, tested quick start: a page that loads a model
capability from a runtime directory you serve, maps two seeds, synthesizes them and their W+ midpoint, shows
progress and Abort, and disposes. Its `test/engine/caller-loaded-example.test.ts` runs it from the packed tarball in
Chromium on the CPU (and on WebGPU where a hardware adapter exists) and checks every face against the runtime's
references.

The order of calls is always the same:

1. **Read bytes only through a verifying reader.** `createVerifyingReader` in the example checks each chunk's size
   and SHA-256 before the engine sees it. With `browser-model-manager`, its verified local reader takes
   that place.
2. **Load a generator for one route**: `loadCpuGenerator` (ONNX Runtime WASM), or `loadOrtWebGpuGenerator` /
   `loadDirectWebGpuGenerator` from `./engine/webgpu`.
3. **Admit it**: `createEngine({ generator, qualification })` and `engine.admit()` run the model's product canaries
   against its own references before any user work. A route that fails them is not used.
4. **Map and synthesize**: `engine.map` turns a seed's z into a W+ latent and `engine.synthesize` turns a W+ latent
   into RGBA pixels.
5. **Dispose** when done; it releases sessions, GPU devices and buffers.

Constructing the engine and reading its status make no request. Every model read is one your reader performs.

## Browsers, providers and build targets

| Route | Engine | Qualified on |
| --- | --- | --- |
| CPU | `ort-wasm` | Chromium, Firefox and WebKit (Linux, Playwright builds) |
| WebGPU | `ort-webgpu` (ONNX Runtime WebGPU EP) | Desktop Chromium with an NVIDIA adapter |
| WebGPU | `direct-webgpu` (WGSL kernels) | Desktop Chromium with an NVIDIA adapter, within `DIRECT_LIMITS` (`directSupported`) |

Everything else is **unqualified**; [capabilities](docs/capabilities.md) lists each cell and its evidence. Falling
back to the CPU never counts as a WebGPU pass.

- **Threads and COOP/COEP.** The CPU route uses ONNX Runtime threads only when the page is cross-origin isolated
  (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so
  `SharedArrayBuffer` exists). Without isolation it runs single-threaded, correctly but more slowly; `cpuThreads`
  reports which.
- **WASM paths.** There is no `wasmPaths` setting. ONNX Runtime's JS and WASM are model assets named in your
  runtime manifest; they are read through your verifying reader and imported from those verified bytes.
- **Workers.** Run the engine in a dedicated worker with `serveEngine(port, engine)` and talk to it from the page
  with `connectEngine(port)`. Bundlers need nothing special: the package has no `new Worker` of its own and no
  asset URLs. A CPU-only worker should import the WebGPU loaders with `import('stylegan-js/engine/webgpu')`
  so they are bundled into a separate chunk.

## Resources, cancellation, errors and progress

- **Ownership.** Whoever loads a generator owns it and calls `dispose()` once. A disposed engine refuses work with a
  typed error.
- **Abort.** Loads and operations take an `AbortSignal`. An aborted read stops at once; a late result after abort is
  discarded, never delivered.
- **Errors.** Failures are typed values, never strings: `engineError(error)` gives a clone-safe
  `{ code, message, cause }` (for example a missing or corrupt asset, an unavailable provider, a lost device).
- **Progress.** Loads report each asset read through the reader; operations accept a `StageTimingHook` that reports
  each stage with its timing.
- **First use and warm use.** The first load on a device reads the whole route's model files (about 150 MB for the
  FFHQ CPU route) and runs the admission canaries. Later loads read verified bytes from local storage when a model
  manager caches them, and a warm face costs only mapping and synthesis.

## Models

A model is described by a `ModelDescriptor`: its identity (model and noise digests), latent shape, output shape,
noise planes, truncation and conditioning. Latents are W+ tensors of the descriptor's `[layers, width]`.

Supported model shapes (the qualified rows of the [model-conv compatibility table](../model-conv/docs/compatibility.md)):

<!-- docs-test: supported-shapes -->
| Model | Resolution / channels | Z / W / W+ layers |
| --- | --- | --- |
| FFHQ config-F (`FFHQ_1024_DESCRIPTOR`) | 1024 / 3 | 512 / 512 / 18 |
| AFHQ cat (`AFHQ_CAT_512_DESCRIPTOR`) | 512 / 3 | 512 / 512 / 16 |
<!-- docs-test: end -->

Acquire checkpoints yourself from NVIDIA under their terms: StyleGAN2 config-F
([NVlabs/stylegan2](https://github.com/NVlabs/stylegan2)) and StyleGAN2-ADA
([NVlabs/stylegan2-ada-pytorch](https://github.com/NVlabs/stylegan2-ada-pytorch)). The compatibility table names
the exact files and digests that were converted and verified. No weights are bundled.

### Numerical qualification

A route is admitted only when the model's product canaries pass the frozen tolerances against references made
independently of this package: decoded RGB within 1/255 per channel and sampled raw floats within 0.002 of the
reference. The e4e photo encoder must reproduce the reference W+ within 0.0001. Other models declare their own
tolerance in their descriptor's conversion record, fixed before their verification run (AFHQ cat: raw 1e-3, RGB 1).

### Photo encoding

Photo-to-latent inversion needs a separately trained encoder compatible with the generator. The shipped FFHQ e4e encoder works only for the FFHQ face generator; it is not a generic encoder. Non-face generation and morphs load no face detector and no e4e encoder.

### Non-face models

Non-face support is **unqualified** until the joint non-face proof passes: converted AFHQ cat loaded through
`browser-model-manager`, mapped, synthesized, morphed and saved from the packed packages (bead
`fm-tqub`). This package is extracted from a face app; that is not generic dataset support.

[`examples/non-face`](examples/non-face) loads converted AFHQ cat on the CPU, manager-loaded or caller-loaded, maps
and synthesizes two seeds, morphs between them with `renderMorph`, and saves and reopens PNG and lossless WebP. Its
test (`test/engine/nonface-example.test.ts`) runs it from the packed tarballs and checks that no request names a face
detector or the e4e encoder.

## Morphs and blends

`createLatentPath` interpolates W+ latents along the path a morph takes, `infillFrames` orders frames so a preview
fills in coarse-to-fine, and `renderMorph` drives a morph end to end through a frame source you supply (your
engine's `synthesize`), a writer and an optional frame store. `blend` mixes W+ latents of one model with clamped
weights. All of them refuse latents whose shape is not the descriptor's.

## Saved files and recovery metadata

Saved stills carry the exact W+ latent and the identity of the generator that made it, so a file reopens as the
same face:

<!-- docs-test: run examples/readme/save-and-reopen.ts -->
```ts
import {
  checkCombinable,
  encodeLosslessWebp,
  encodePng,
  FFHQ_1024_DESCRIPTOR,
  latentDigest,
  readRecovery,
  type LatentTensor,
  type RgbaPixels,
} from 'stylegan-js';

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
```

Recovery semantics: stills are written as schema 3 (dynamic shape: the generator record and the W+ shape come from the model descriptor). Schema-1 PNG and schema-2 PNG and WebP files are still read. Combining equal-shaped latents from different checkpoints is refused with a typed error (`mixed-model`). A file from a model you do not have stays viewable as media, without editable inference, and URLs found in its metadata are never followed.

`encodePng` and `encodeLosslessWebp` are lossless library helpers; they do not change the FaceMorph app's lossy WebP
quality 0.8 policy. The exact model, latent and provenance values in a file are separate from its decoded pixel
quality. [Saved file formats](docs/formats.md) gives every format, limit and damage case.

## Troubleshooting

- **The CPU route is slow.** Check `cpuThreads`: without cross-origin isolation the CPU route is single-threaded.
- **WebGPU is not chosen.** The route is admitted only after its canaries pass on this adapter; an unsupported
  adapter or failed canary leaves the CPU route, and that is reported, not hidden.
- **A load fails with a cache-miss or corrupt-asset error.** Your reader's bytes did not match the manifest's size
  or SHA-256; the model host is serving different files from the ones the manifest names.
- **A saved file does not reopen.** `readRecovery` says why: `missing`, `damaged` (with the reason) or
  `incompatible-schema` (with the version the file claims).

## Related packages

- [browser-model-manager](../browser-model-manager/README.md) asks the person before any download, then acquires,
  verifies and caches the model files; the engine loads them through its verified local reader.
- [cloudflare-model-host](../cloudflare-model-host/README.md) stages converted models for any HTTPS static host, with
  an optional Cloudflare guide.
- [model-conv](../model-conv/README.md) converts a trusted StyleGAN2 checkpoint into the files this package loads. The
  [compatibility table](../model-conv/docs/compatibility.md) lists the checkpoints that are qualified.

## Licence and model weights

The code is MIT licensed (`LICENSE`; bundled third-party code in `THIRD_PARTY_NOTICES`). **The model weights are
not included.** A model host supplies them, and they come under their own terms, separate from this package's
licence and limited to non-commercial use:

<!-- model-terms:start -->
- NVIDIA StyleGAN2 licence: [upstream text](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-NC.txt`
- NVIDIA StyleGAN2-ADA licence: [upstream text](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-ADA.txt`
- FFHQ dataset terms: [upstream text](https://github.com/NVlabs/ffhq-dataset#licenses); served beside the weights as `notices/FFHQ-terms.txt`
- e4e MIT licence: [upstream text](https://github.com/omertov/encoder4editing/blob/main/LICENSE); served beside the weights as `notices/e4e-MIT.txt`
- dlib landmark model notice: [upstream text](https://www.dlib.net/face_landmark_detection_ex.cpp.html); served beside the weights as `notices/index.html#dlib-landmarks`
<!-- model-terms:end -->

A host publishes these texts beside the weights, under `notices/` next to the runtime manifest, and the manifest's
`distribution.notices` points at their index.

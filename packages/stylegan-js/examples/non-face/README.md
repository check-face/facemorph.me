# Non-face example (AFHQ cat 512)

`@facemorph/stylegan-js` with a model that is not a face: the AFHQ cat 512 generator converted by
`packages/model-conv` (16 W+ layers, 512 x 512 output), described by `AFHQ_CAT_512_DESCRIPTOR`. On the CPU, the
page:

1. reads the converted model's `manifest.json` and the CPU runtime from the runtime manifest,
2. loads the generator with `loadCpuGenerator({ descriptor: AFHQ_CAT_512_DESCRIPTOR, … })`,
3. maps seeds 0 and 1 with the descriptor's truncation and synthesizes both,
4. renders a five-frame morph between them with `createLatentPath` and `renderMorph`, with a small writer that
   keeps the frames in memory (no video encoder),
5. exports seed 0 with `encodePng` and `encodeLosslessWebp` (schema-3 recovery metadata), reopens both with
   `readRecovery` and decodes them with the browser's own decoder,
6. reports every check as JSON: the morph's first and last frames are the two faces exactly, and the reopened
   latent, model identity and pixels are exact.

**No face detector and no e4e encoder are loaded.** Non-face generation and morph read only the converted model
and the CPU runtime. A non-face descriptor cannot carry a photo encoder, and nothing in this example requests the
detector, the e4e encoder, its shards or any photo-pipeline asset. The runtime manifest is read only for its
`runtime` section.

**Non-face support is unqualified.** AFHQ cat support stays unqualified until the joint non-face proof (fm-tqub)
passes. The descriptor's providers say so, and `status()` reports it.

Two variants, chosen by `?variant=`:

- `manager` (the default), in `src/manager-loaded.ts`: `@facemorph/browser-model-manager` acquires the AFHQ assets
  and the CPU runtime under one grant, verifies them and stores them in this origin's Cache Storage. The engine
  reads only through the manager's verified local reader (`cache.local`), which never fetches.
- `caller`, in `src/caller-loaded.ts`: no manager. The caller's own reader fetches each asset from its manifest URL
  and checks every chunk and the whole asset for size and SHA-256 on every read. The page imports only this
  module, so the manager is never requested.

`src/nonface.ts` holds the shared steps. `src/main.ts` and `index.html` are the page, and the import map points at
the installed packages' `dist/`.

Run it from a project that has both packed tarballs installed:

```sh
npm run build -w packages/stylegan-js -w packages/browser-model-manager
npm pack -w packages/stylegan-js -w packages/browser-model-manager --pack-destination /tmp/pack
mkdir app && cd app && npm init -y && npm pkg set type=module
npm install /tmp/pack/facemorph-stylegan-js-0.0.0.tgz /tmp/pack/facemorph-browser-model-manager-0.0.0.tgz typescript
cp -r <repo>/packages/stylegan-js/examples/non-face/. .
npx tsc -p tsconfig.json
```

Serve `app/` over HTTPS with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, which the CPU route needs for its threads. Serve the converted model
directory and the runtime directory with CORS and `Cross-Origin-Resource-Policy: cross-origin`. Then open
`/?variant=manager&model=<model base URL>&runtime=<runtime base URL>` (or `variant=caller`) and press the button.
The report is also on `window.nonfaceReport`.

`test/engine/nonface-example.test.ts` does all of this automatically from freshly packed tarballs. It checks the
faces against the upstream reference at AFHQ cat's declared tolerance, and checks that no request at any step names
a detector or e4e asset.

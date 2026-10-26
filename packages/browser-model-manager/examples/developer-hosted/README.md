# Developer-hosted model example

`@facemorph/browser-model-manager` acquiring a converted model from a static origin you host, only after the
person has approved the exact bytes, and `@facemorph/stylegan-js` running it from the manager's verified local
reader. The model is the AFHQ cat 512 generator converted by `packages/model-conv`; non-face support is
unqualified. The CPU runtime (ONNX Runtime's WASM build) comes from the same origin.

The page, step by step (`src/example.ts`; `src/main.ts` wires the buttons; the example is also on
`window.example`):

1. **Construct and read status.** `createDeveloperHostedExample()` does no I/O. `status()` opens this origin's
   storage (an OPFS shard store if one works here, and the app's own Cache Storage namespace) and reads
   persistence and quota. Neither makes a request.
2. **Review download.** Fetches the two small manifests from your origin and builds the `AcquisitionGrant`: every
   asset's digest and bytes, and `remainingBytes`, which leaves out what is already stored. The page shows that
   figure and the origin; no model byte has moved.
3. **Approve and download.** `authorize()` records the approval and `acquire()` downloads, verifies and stores each
   asset under that grant, with a progress bar. Calling `acquire()` without approval is refused by the manager
   before any request. **Abort** cancels; verified chunks already on OPFS are kept, nothing partial is readable,
   and continuing needs a new review and approval.
4. **Generate.** Reads every asset through `cache.local` (digested on each read, never fetched), loads the CPU
   runtime and `loadCpuGenerator` from those reads alone, wraps the generator in `createLoadedHandle` with leases on
   every asset it read, maps seed 0 and synthesizes one 512 x 512 image.
5. **Release** disposes the engine's sessions and releases the leases. **Remove from this device** calls
   `evictUnleased`, which keeps anything still leased (try it before Release) and otherwise removes each asset's
   OPFS units and Cache Storage entry.

The example builds its cache with `createModelCache` and its own `BlobStore` over Cache Storage, so it can remove
what it stored. `createBrowserModelCache()` sets up the same pieces when you do not need that.

## Run it

From a project with both packed tarballs installed:

```sh
npm run build -w packages/stylegan-js -w packages/browser-model-manager
npm pack -w packages/stylegan-js -w packages/browser-model-manager --pack-destination /tmp/pack
mkdir app && cd app && npm init -y && npm pkg set type=module
npm install /tmp/pack/facemorph-stylegan-js-0.0.0.tgz /tmp/pack/facemorph-browser-model-manager-0.0.0.tgz typescript
cp -r <repo>/packages/browser-model-manager/examples/developer-hosted/. .
npx tsc -p tsconfig.json
```

Serve `app/` over HTTPS with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, so the CPU route can use threads. On your model origin, serve:

- `afhq/`: the converted model directory (`manifest.json` and the files it names, relative to it);
- `runtime/`: a `manifest.json` whose `runtime` section is `{ moduleUrl, assets: [{ sha256, size, url }] }` for
  `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs` and `ort-wasm-simd-threaded.wasm`, with the files under the same
  paths below `runtime/`;

with `Access-Control-Allow-Origin` for the app and `Cross-Origin-Resource-Policy: cross-origin`. Then open
`/?model=<model origin>/afhq/&runtime=<model origin>/runtime/`.

`test/example.test.ts` does all of this from freshly packed tarballs, with two local HTTPS origins, in Playwright
Chromium on the CPU, and checks each step by the requests the browser and the model host actually saw.

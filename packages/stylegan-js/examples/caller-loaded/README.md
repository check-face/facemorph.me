# Caller-loaded example

`stylegan-js` with no model manager. The page loads a model capability itself from a runtime
directory you serve (`manifest.json` and the assets it names), maps seed 7, synthesizes it, synthesizes seed
1234 and their W+ midpoint (`blend` with weights 0.5/0.5) through the engine's `map`/`synthesize`, and disposes.
It shows progress, an Abort button, and errors as typed `{ code, message, cause }` values.

- `src/caller-loaded.ts`: the library usage. `createVerifyingReader` is the only path to bytes: the caller's
  own `fetch` of the caller's own URLs, each chunk and asset checked for size and SHA-256 on every read.
  Constructing the demo and calling `status()` make no request.
- `src/main.ts` and `index.html`: the page. The import map points at the installed package's `dist/`.

Run it from a project that has the packed tarball installed:

```sh
npm pack -w packages/stylegan-js --pack-destination /tmp/pack
mkdir app && cd app && npm init -y && npm pkg set type=module
npm install /tmp/pack/stylegan-js-0.1.0.tgz typescript
cp -r <repo>/packages/stylegan-js/examples/caller-loaded/. .
npx tsc -p tsconfig.json
```

Then serve `app/` over HTTPS with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (needed for the CPU route's threads), and serve the runtime
directory with CORS and `Cross-Origin-Resource-Policy: cross-origin`. Open
`/?runtime=<runtime base URL>` (add `&route=webgpu` for the WebGPU route).

`test/engine/caller-loaded-example.test.ts` does all of this automatically and checks the output against the
runtime's references.

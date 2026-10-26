# Hosting models on any static HTTPS host

A converted model is a set of static files. Any HTTPS host can serve it if it sends the exact bytes and the headers
in the README's [serving requirements](../README.md#serving-requirements). Nothing on the host runs code, and no
Cloudflare account is needed. The [README quickstart](../README.md#quickstart-host-manager-engine-on-your-own-machine)
does the same on your own machine; this guide assumes it has been followed in the same directory (it reuses
`./converted`, `terms.json` and `serve.mjs`).

## 1. Choose the origin and a release path

Each release gets its own path, so a new conversion never changes a file an open page is still reading. Set the
origin your files will be served from:

<!-- docs-test: set-origin -->
```sh
export MODEL_ORIGIN=https://models.example.com
```

## 2. Stage, verify and publish into the upload directory

<!-- docs-test: run -->
```sh
npx facemorph-model-host stage --source ./converted --out ./release --base "$MODEL_ORIGIN/models/my-model-v1"
npx facemorph-model-host verify --root ./release --base "$MODEL_ORIGIN/models/my-model-v1"
```

<!-- docs-test: file release-target.json -->
```json
{
  "kind": "directory",
  "path": "./public/models/my-model-v1",
  "terms": { "record": "./terms.json", "acknowledged": "my-model" }
}
```

<!-- docs-test: run -->
```sh
npx facemorph-model-host publish --root ./release --target release-target.json --publish
```

`./public` now holds `models/my-model-v1/` with `manifest.json`, the assets and `chunks/`.

## 3. Set the headers

Hosts that read a `_headers` file (Cloudflare Workers Static Assets and Pages, among others) take the rules this
package generates:

<!-- docs-test: run -->
```sh
node --input-type=module -e "
import { extensionsOf, listFiles, modelHeaders } from 'cloudflare-model-host';
const extensions = extensionsOf(listFiles('./release').map((f) => f.path));
process.stdout.write(modelHeaders({ basePath: '/models/my-model-v1/', immutable: ['chunks/'],
  mutable: ['manifest.json'], extensions }));
" > public/_headers
```

For a model-conv output, `public/_headers` reads:

<!-- docs-test: output public/_headers -->
```text
/models/my-model-v1/*
  Access-Control-Allow-Origin: *
  Cross-Origin-Resource-Policy: cross-origin
  X-Content-Type-Options: nosniff
/models/my-model-v1/chunks/*
  Cache-Control: public, max-age=31536000, immutable
/models/my-model-v1/manifest.json
  Cache-Control: no-cache
/models/my-model-v1/*.f32
  Content-Type: application/octet-stream
/models/my-model-v1/*.onnx
  Content-Type: application/octet-stream
```

On any other server, configure the same headers for the same paths: CORS, `Cross-Origin-Resource-Policy:
cross-origin` and `nosniff` on everything under the release path, a year's immutable caching on `chunks/`,
`no-cache` on the manifest, and `application/octet-stream` for `.onnx`, `.f32` and `.bin`. `serve.mjs` from the
quickstart is a complete example. A host that cannot set response headers is not suitable: a cross-origin isolated
page cannot load files without `Cross-Origin-Resource-Policy`.

## 4. Upload, then qualify the origin

Upload `./public` with your host's own tool. Then check what the origin actually serves, from the staged copy:

<!-- docs-test: run -->
```sh
npx facemorph-model-host qualify-origin --root ./release --origin "$MODEL_ORIGIN" \
  --base-path /models/my-model-v1/ --immutable chunks/ --mutable manifest.json
```

The report's `ok` is `true` only when every file came back byte-identical with every required header, every chunked
asset reconstructs, and the served manifest passes the manager's contract. The manager then loads
`$MODEL_ORIGIN/models/my-model-v1/manifest.json` exactly as in the quickstart's `load.mjs`.

## 5. Keep old releases

An open page keeps the manifest it loaded. Leave a release's files in place for as long as a page may still use it,
and delete only files no retained manifest names. The [Cloudflare guide](cloudflare.md#retention-keeping-older-releases-servable)
has a full policy.

# cloudflare-model-host

Stages, verifies and publishes converted model files for static HTTPS hosting, then checks that an origin serves
them byte for byte with the headers a browser needs. Cloudflare is optional: any static host that can set response
headers works, and Cloudflare Workers Static Assets (with an optional R2 mirror) is the documented deployment.

Where it fits:

1. **Convert** a checkpoint with [model-conv](../model-conv/README.md) (see its
   [compatibility table](../model-conv/docs/compatibility.md)). The output is a `manifest.json` and the files it
   names, with SHA-256 digests and sizes.
2. **Host** it with this package: `stage` gives every file a hosted URL, cuts files over 25 MiB into 16 MiB chunks,
   `verify` reads the result back, `publish` copies it to a static root, and `qualify-origin` checks the served bytes
   and headers.
3. **Acquire** it in the browser with [browser-model-manager](../browser-model-manager/README.md), which
   downloads only after the person authorizes it, verifies every byte and keeps the files in the browser's storage.
4. **Run** it with [stylegan-js](../stylegan-js/README.md), which reads the manager's verified local
   bytes and never fetches by itself.

Guides: [any static HTTPS host](docs/static-hosting.md) and [Cloudflare](docs/cloudflare.md). Every export is listed
in the [API reference](docs/api.md). Where the code came from: [extraction history](#extraction-history).

## Install

<!-- docs-test: install -->
```sh
npm install cloudflare-model-host browser-model-manager
```

Node 24 or newer. The package installs the `facemorph-model-host` command; the manager is the browser half of the
quickstart. The Cloudflare tooling it depends on (the `cf` CLI and the Cloudflare Vite plugin) is used only by
`origin-deploy` and `mirror-deploy`.

## Quickstart: host, manager, engine on your own machine

This publishes a converted model to a local HTTPS static server and has the manager load it in a browser page from a
second local origin. You need a model-conv output directory, here `./converted` (for example the AFHQ cat model from
[model-conv's usage guide](../model-conv/docs/usage.md)), Node 24, `openssl` and a Chromium-based browser.

Stage the model for the origin it will be served from, and verify the staged copy:

<!-- docs-test: run -->
```sh
npx facemorph-model-host stage --source ./converted --out ./staged --base https://localhost:8443/models
npx facemorph-model-host verify --root ./staged --base https://localhost:8443/models
```

Publishing needs a record of the model's terms. One row must name the manifest's `modelSourceSha256`; a row whose
`redistribution` is not `"permitted"` must be acknowledged by id in the target. Set `redistribution` to what your
model's licence actually allows:

<!-- docs-test: run -->
```sh
MODEL_SOURCE=$(node -p "require('./staged/manifest.json').modelSourceSha256")
cat > terms.json <<EOF
{ "rows": [ { "id": "my-model", "modelSourceSha256": "$MODEL_SOURCE", "redistribution": "non-commercial" } ] }
EOF
```

<!-- docs-test: file target.json -->
```json
{
  "kind": "directory",
  "path": "./site/models",
  "terms": { "record": "./terms.json", "acknowledged": "my-model" }
}
```

`publish` is a dry run until `--publish` is given:

<!-- docs-test: run -->
```sh
npx facemorph-model-host publish --root ./staged --target target.json
npx facemorph-model-host publish --root ./staged --target target.json --publish
```

A static HTTPS server with the headers this package requires (save it as `serve.mjs`):

<!-- docs-test: file serve.mjs -->
```js
// A static HTTPS server with the model host's headers: node serve.mjs <directory> <port>
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve, sep } from 'node:path';
import { expectedType, IMMUTABLE_CACHE, MUTABLE_CACHE } from 'cloudflare-model-host';

const [dir, port] = process.argv.slice(2);
const root = resolve(dir);
const tls = { key: readFileSync('tls/key.pem'), cert: readFileSync('tls/cert.pem') };
const shared = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  // A page served from here is cross-origin isolated, so the engine's CPU route may use threads.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

createServer(tls, (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, shared).end();
  const path = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
  const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  let body;
  try {
    if (!file.startsWith(root + sep)) throw new Error('outside the root');
    body = readFileSync(file);
  } catch {
    return res.writeHead(404, shared).end();
  }
  res.writeHead(200, {
    ...shared,
    'Content-Type': expectedType(file),
    'Content-Length': body.length,
    // Chunks are named by their digest and never change; everything else is revalidated.
    'Cache-Control': path.includes('/chunks/') ? IMMUTABLE_CACHE : MUTABLE_CACHE,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(Number(port), () => console.log(`serving ${root} at https://localhost:${port}/`));
```

A certificate for `localhost`, then the model origin:

<!-- docs-test: run -->
```sh
mkdir -p tls
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -keyout tls/key.pem -out tls/cert.pem
```

<!-- docs-test: background 8443 -->
```sh
node serve.mjs ./site 8443
```

Check what the origin serves: every file's bytes and headers, every chunked asset's reconstruction, and the
manager's manifest contract. `NODE_EXTRA_CA_CERTS` lets Node trust the local certificate.

<!-- docs-test: run -->
```sh
NODE_EXTRA_CA_CERTS=tls/cert.pem npx facemorph-model-host qualify-origin --root ./staged \
  --origin https://localhost:8443 --base-path /models/ --immutable chunks/ --mutable manifest.json
```

The page that loads it, served from a second origin. The manager's ES modules are copied next to it, so no bundler
is needed:

<!-- docs-test: run -->
```sh
mkdir -p app
cp -r node_modules/browser-model-manager/dist app/manager
```

<!-- docs-test: file app/index.html -->
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Model host quickstart</title>
    <script type="importmap">
      { "imports": { "browser-model-manager": "./manager/index.js" } }
    </script>
  </head>
  <body>
    <button id="load">Download and verify the model</button>
    <pre id="report"></pre>
    <script type="module" src="./load.mjs"></script>
  </body>
</html>
```

<!-- docs-test: file app/load.mjs -->
```js
import { createBrowserModelCache, parseModelManifest } from 'browser-model-manager';

const MODELS = 'https://localhost:8443/models/';
const OWNER = 'face:quickstart';
const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function load() {
  const text = await (await fetch(`${MODELS}manifest.json`)).text();
  const parsed = parseModelManifest(JSON.parse(text));
  if (!parsed.ok) throw new Error(`${parsed.error.code} at ${parsed.error.path}`);
  const m = parsed.value;
  const assets = [m.mapping, m.synthesis, ...(m.average ? [m.average] : []), ...m.noise];
  // What the person agreed to download: exactly these digests and bytes.
  const grant = {
    manifestSha256: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    route: 'cpu',
    purpose: 'generate',
    owners: [OWNER],
    assets: assets.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
    remainingBytes: assets.reduce((n, a) => n + a.size, 0),
  };
  const cache = await createBrowserModelCache();
  for (const asset of assets) await cache.acquire(asset, { grant, owner: OWNER });
  // The engine reads through cache.local, which never fetches. Read every asset back to show it is held.
  let bytes = 0;
  for (const asset of assets) {
    const read = await cache.local.read(asset);
    if (!read.ok) throw new Error(`${asset.sha256}: ${read.error.code}`);
    const digest = hex(await crypto.subtle.digest('SHA-256', read.value));
    if (digest !== asset.sha256) throw new Error(`digest differs: ${asset.sha256}`);
    bytes += read.value.byteLength;
  }
  return `verified ${assets.length} assets, ${bytes} bytes, from ${MODELS}`;
}

document.querySelector('#load').addEventListener('click', () => {
  const report = document.querySelector('#report');
  load().then(
    (text) => (report.textContent = text),
    (error) => (report.textContent = `failed: ${error.message}`),
  );
});
```

<!-- docs-test: background 8444 -->
```sh
node serve.mjs ./app 8444
```

Open `https://localhost:8443/models/manifest.json` once and accept the certificate warning, then open
`https://localhost:8444/` (accept it there too) and press the button. Nothing is downloaded before the press; the
report reads `verified 18 assets, …` for AFHQ cat.

**Then the engine.** Pass `cache.local` to the engine as its verified reader:
[stylegan-js's quick start](../stylegan-js/README.md#quick-start-load-a-model-and-make-a-face) and its
[non-face section](../stylegan-js/README.md#non-face-models) show the generator load, mapping and synthesis that
follow. The engine's ONNX Runtime JS and WASM files are model assets too: a runtime manifest names them, and they are
staged, published, served and acquired exactly like the model's own files.

## Commands

Every command prints one JSON report on stdout. Exit codes are 0 for ok, 1 for a refusal, findings or failures, and 2
for a usage error. Nothing is written to a host and no Cloudflare API request is made without `--publish`.

- **Stage:** `facemorph-model-host stage --source <dir> --out <dir> --base <https url> [--from-base <url>]
  [--manifest <name>] [--dry-run]`. Every asset the manifest names is checked against its declared SHA-256 and size
  and copied to the same relative path. An asset over the 25 MiB file limit is published only as 16 MiB chunks,
  `chunks/<sha256>.bin`; a chunk is written once and never changed. The manifest is rewritten to hosted URLs under
  `--base`. The source can be an unpublished bundle (assets named by `file`, as model-conv writes them) or an already
  hosted tree being restaged (`--from-base` maps its URLs back to paths). The manifest must pass
  `browser-model-manager`'s contract before and after staging: a newer or unknown major is refused. Local
  paths, `file://` URLs, sibling checkouts and private inventories (`sources.private.json`) never reach the staged
  manifest. `--manifest` names a manifest file other than `manifest.json` in the source.
- **Verify:** `facemorph-model-host verify --root <dir> --base <https url> [--manifest <name>]
  [--plan workers-free|workers-paid]`. Each asset is read back by its URL path, a chunked one through its chunks, and
  must reproduce its digest and size. Every file must fit the per-file limit and the plan's file count (default
  `workers-free`).
- **Qualify an origin:** `facemorph-model-host qualify-origin --root <dir> --origin <url> [--base-path /models/]
  --immutable <prefixes> --mutable <files> [--reference <qualified-manifest.json>]`. Reads every file of the staged
  root from the origin under the base path (default `/`) and checks its bytes, its headers (below), chunk
  reconstruction and the manager's manifest contract. The optional reference requires the served manifest to name
  exactly the reference's asset digests. It publishes nothing.
- **Publish:** `facemorph-model-host publish --root <dir> --target <target.json> [--publish]`. A dry run unless
  `--publish` is given: it reads only, then reports each file it would write. The model terms are checked first
  (below). A target is `{"kind": "directory", "path": ...}` (a static root, or a local mirror) or
  `{"kind": "cloudflare", "project": <dir>, "product": ...}`, which runs `cf deploy` in that project directory. A
  paid product is refused unless the target also names it in `"paidServiceApproved"`. An existing destination file
  that differs is refused, never overwritten.
- **Model origin:** `facemorph-model-host origin-deploy --root <dir> --worker <name> --base-path /models/
  --immutable <list> --mutable <list> [--workers-dev] [--domain <host>] [--compatibility-date <date>]
  [--terms <record> [--acknowledge <row>]] [--publish]`. A staged root as its own origin on Workers Static Assets,
  through `cf` in the package's `model-origin` mode: the root is served under the base path with `_headers` rules
  (`src/headers.ts`), and the Worker has no script, so a model request never runs Worker code. Without `--publish` it
  runs `cf deploy --dry-run`. Model terms are checked before anything is published.
- **Mirror deploy:** `facemorph-model-host mirror-deploy --worker <name> --bucket <r2 bucket> --upstream <url>
  --prefixes <list> [--site <worker>] [--domain <host>] [--workers-dev] [--compatibility-date <date>] [--publish]`.
  Deploys the mirror Worker (below) with the Cloudflare CLI `cf`, never Wrangler: the package root is the cf project
  (`cloudflare.config.ts` reads every value from the arguments, `vite.config.ts` builds through the Cloudflare Vite
  plugin). Without `--publish` it runs `cf deploy --dry-run`, which builds the Worker, lists its bindings and sends no
  API request. The plugin is the 2.0 beta because its latest stable release (1.65.0) depends on Wrangler.
- **Warm:** `facemorph-model-host warm --root <dir> --origin <mirror url> --prefixes <list> [--publish]`. HEAD on
  every immutable path of a staged root under the prefixes, 8 at a time, each retried up to 3 times on a network
  error or 408/429/5xx. Any final non-200 fails the run, naming the path; the report gives the held count. A mirror
  copies a file on HEAD, so without `--publish` nothing is requested.

`--compatibility-date` defaults to `2026-09-16`. `--workers-dev` also serves the Worker on
`<worker>.<account subdomain>.workers.dev`.

## The staged root and its manifest

A staged root holds `manifest.json`, every asset at its relative path, and `chunks/` for assets over 25 MiB. Its
manifest is the manager's model manifest, major version 1
([JSON schema](../browser-model-manager/schema/model-manifest.v1.schema.json)):

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1`. A newer or unknown major is refused by `stage`, `verify` and the manager. |
| `bundleVersion` | The producer's name for this bundle. |
| `modelSourceSha256` | SHA-256 of the source checkpoint; the model terms row must name it. |
| `noiseSha256` | Identity of the noise set. |
| `mapping`, `synthesis` | Required asset descriptors. |
| `average`, `noise[]` | Optional average latent; noise inputs, each an asset descriptor with `name` and `shape`. |
| `encoder`, `encoderStream`, `landmarks`, `kernel` | Optional photo-encoding and kernel entries. |
| anything else | Kept as parsed JSON (model-conv writes `model`, `tolerance`, `provenance`). |

An asset descriptor is `{ "url": "https://…", "sha256": "<64 lowercase hex>", "size": <bytes> }`, plus, when the
asset is chunked, `"chunks": [{ "url", "sha256", "size" }, …]` whose sizes add up to `size`. Before staging,
model-conv writes `"file": "<relative path>"` instead of `url`; a staged manifest has only `url`s, all under
`--base`.

## Serving requirements

`qualify-origin` checks these on every file under the base path; `origin-deploy` writes them as `_headers` rules, and
the mirror Worker sends them itself.

| Header | Value | Why |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | `*` | The page that loads the model is usually on another origin. |
| `Cross-Origin-Resource-Policy` | `cross-origin` | A page with `Cross-Origin-Embedder-Policy: require-corp` can load the file. |
| `X-Content-Type-Options` | `nosniff` | The declared type is the type. |
| `Content-Type` | `application/json` (`.json`), `application/wasm` (`.wasm`), `text/javascript` (`.js`, `.mjs`), `application/octet-stream` (`.bin`, `.onnx`, `.f32`, `.i32` and any extension not listed) | The manager and engine check bytes, not types, but a WASM or module import needs the right one. `expectedType()` gives the full list. |
| `Cache-Control` on immutable prefixes | `public, max-age=31536000, immutable` | Content-addressed files (`chunks/`) never change. |
| `Cache-Control` on mutable files | `no-cache` | The manifest pointer is revalidated on every use. |
| Status | `200` with the exact bytes | Every byte is checked against the manifest digest. |

Only content-addressed paths may be immutable. Other asset names (`mapping.onnx`, `noise_0.f32`) are reused by every
conversion, so publish each release under its own base path (for example `/models/afhqcat-v1/`) rather than caching
them as immutable at a shared path.

**Workers and WASM.** The engine's ONNX Runtime JS and WASM files are assets in a runtime manifest, served from the
same kind of root with the same headers; there is no separate `wasmPaths` location. They are read through the
verifying reader and imported from the verified bytes.

**COOP/COEP.** The page (not the model host) decides threading. A page served with `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp` is cross-origin isolated, and the engine's CPU route
uses threads; every model file must then carry CORS and `Cross-Origin-Resource-Policy: cross-origin`, as above.
Without isolation the CPU route runs single-threaded, correctly but more slowly, and the same model host serves it
unchanged.

## Second origin and warm

A second origin keeps chunk downloads working when the primary fails. It must serve the same files at the same paths;
the manager is told about it with `createBrowserModelCache({ alternateOrigins: ['https://<mirror origin>'] })`, and
every other retry of a chunk then goes to the next origin. This package's mirror Worker is such an origin: an R2
bucket that copies each immutable file from the upstream origin on first request, only under the configured
prefixes, and serves it with CORS, `Cross-Origin-Resource-Policy: cross-origin` and immutable caching. Its
configuration is `UPSTREAM` (the origin copied from), `PREFIXES` (comma-separated immutable prefixes), the `MIRROR`
R2 binding and an optional `SITE` service binding to the upstream Worker. Nothing about any deployment is built in.
`warm --publish` then requests every immutable path once, so the mirror holds them all before it is needed. The
[Cloudflare guide](docs/cloudflare.md#second-origin-an-r2-mirror) has the commands. Its tests run in workerd
(`npm run test:workerd`, which needs glibc 2.32 or newer).

<!-- facemorph-example:start -->
**Example: FaceMorph's own deployment.** FaceMorph serves its runtime from the site Worker at `next.facemorph.me`
under `/runtime/`, and its second origin is `models.facemorph.me`: this package's mirror Worker (Worker
`facemorph-models`) over the R2 bucket `facemorph-runtime-mirror`, with `UPSTREAM` the site origin, a `SITE` service
binding to the site Worker (`facemorph-next`), and `PREFIXES`
`runtime/assets/,runtime/chunks/,runtime/manifests/,runtime/photo/,runtime/encoder-stream/`. Its deploy runs
`mirror-deploy` with those values and then `warm --publish` against `https://models.facemorph.me/`.
<!-- facemorph-example:end -->

## Cloudflare limits and cost

Read from developers.cloudflare.com on **24 October 2026**: Workers platform limits (static assets), Workers pricing,
Pages limits and R2 pricing. `src/limits.ts` holds the same figures; change both together. Rechecked on **27 October
2026** (Cloudflare documentation search): the 25 MiB file limit, 20,000 (Free) and 100,000 (Paid) files per version,
free and unlimited static asset requests with no storage charge, and R2's free 10 GB-month, 1M Class A and 10M Class
B operations with free egress are unchanged.

| | |
| --- | --- |
| Chosen product and tier | Workers Static Assets on **Workers Free**. Pages has the same 25 MiB file limit and 20,000-file Free limit. |
| Per-file limit | 25 MiB on every plan. Larger inputs are published as 16 MiB chunks. |
| Files per version | 20,000 (Free), 100,000 (Paid) |
| Request routing | A request matching a static asset is served without invoking Worker code. Static asset requests are free and unlimited on both plans. The 100,000 requests/day Free limit applies only to Worker invocations. |
| Storage, request and bandwidth allowances | No separate storage charge for static assets; static asset requests free and unlimited; no egress charge. Enabling Workers Caching bills static asset requests at the Worker request rate, so it is not used here. |
| Paid alternatives (refused unless named) | Workers Paid: $5.00 per month subscription. R2 (Standard): $0.015 per GB-month, $4.50 per million Class A and $0.36 per million Class B operations beyond the free 10 GB-month, 1M Class A and 10M Class B per month; egress free. |
| Measured staged set: AFHQ cat 512 | The quickstart's model, staged on 27 October 2026: **26 files, 134,630,462 bytes**, 18 assets of which 1 (`synthesis`, 123,411,406 bytes) is chunked into 8 chunks. The largest file is 16,777,216 bytes (a chunk), under 25 MiB. 26 files fit Workers Free; an R2 mirror of it holds 0.13 GB, inside R2's free 10 GB-month. |
| Measured staged set: the qualified FFHQ runtime | The qualified runtime (manifest `d9e37e50…`) as acquired: **301 files, 2,766,791,005 bytes**, 81 assets of which 5 are chunked into 90 chunks. The largest file is 24,135,856 bytes (`b16-coefficients.bin`), under 25 MiB. 301 files fit Workers Free. `test/host.test.ts` checks this on every run where the runtime is present. |

**Model terms.** Before anything is written, the target must name a terms record: a JSON file with a `rows` list, each
row an object with an `id`. One row must cover the manifest's `modelSourceSha256` (the digest appears in the row). If
that row's `redistribution` is not `"permitted"`, the target must acknowledge the row by id (`"terms": {"record":
..., "acknowledged": "<row id>"}`, or `--terms <record> --acknowledge <row id>` for `origin-deploy`).

<!-- facemorph-example:start -->
**Example: FaceMorph's own deployment.** FaceMorph's terms record is its repository's `import/licences.json`. For its
qualified FFHQ runtime, row `nvidia-stylegan2-ffhq-config-f-derived` is `unresolved` today, so publishing it needs
that explicit acknowledgement.
<!-- facemorph-example:end -->

**Model weights and their licence texts.** This package's code is MIT licensed; no model weights are included. The
weights it stages come under their own terms, separate from that licence and limited to non-commercial use. Publish
these texts beside the weights, under `notices/` next to the manifest, and point the manifest's
`distribution.notices` at their index:

<!-- model-terms:start -->
- NVIDIA StyleGAN2 licence: [upstream text](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-NC.txt`
- NVIDIA StyleGAN2-ADA licence: [upstream text](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-ADA.txt`
- FFHQ dataset terms: [upstream text](https://github.com/NVlabs/ffhq-dataset#licenses); served beside the weights as `notices/FFHQ-terms.txt`
- e4e MIT licence: [upstream text](https://github.com/omertov/encoder4editing/blob/main/LICENSE); served beside the weights as `notices/e4e-MIT.txt`
- dlib landmark model notice: [upstream text](https://www.dlib.net/face_landmark_detection_ex.cpp.html); served beside the weights as `notices/index.html#dlib-landmarks`
<!-- model-terms:end -->

## Testing

`npm test` runs the unit tests and the docs test (`test/docs.test.ts`), which packs this package, the manager and
the engine fresh, installs the tarballs in a clean project outside the repository and runs every code block in this
README and the guides. `npm run test:workerd` runs the mirror Worker and the `cf deploy --dry-run` builds in workerd.
`npm run test:staging` checks deployed test origins (`STAGING_ORIGIN`, `STAGING_MIRROR`). Publishing a real model is
a deployment step, and this package's tests do not run it: the directory target is tested with real writes,
`origin-deploy` and `mirror-deploy` as `cf deploy --dry-run` builds, and the `cloudflare` publish target's `cf deploy`
is untested here.

## Extraction history

This package's code was extracted from an earlier application. Nothing here is needed to use the package; it records
where each file of the earlier hosting tree went, and the repository's inventory check reads the table below.

<!-- facemorph-example:start -->
**Example: FaceMorph's own extraction history.** The package was extracted from classic FaceMorph's
`hosting/next/prepare-runtime.py` (chunking and manifest rewriting) and `src/Next/browser/stage-assets.py`
(content-addressed staging), and the mirror Worker from classic `hosting/next-mirror/` (fm-3osh, fm-fy2.14;
provenance in `mirror/provenance.json`). Application policy stays in the app's `hosting/`: phone admission,
promotion, the photo sub-bundle, frontend staging, and the deploy values it serves with.

### Boundary assignment table

Every file in classic's `hosting/` tree at the frozen revision has one destination: this package, the app's
`hosting/`, `historical` (kept only as history) or `split` (the reason names both homes).

| path | destination | reason |
|---|---|---|
| hosting/gallery/.gitignore | hosting/ | catalogue pipeline support file; moves with hosting/gallery (fm-8tyu) |
| hosting/gallery/README.md | hosting/ | catalogue pipeline documentation |
| hosting/gallery/hello-provenance.md | hosting/ | catalogue pipeline provenance note |
| hosting/gallery/materialize.py | hosting/ | catalogue materialization (name-catalogue.yml) |
| hosting/gallery/names-wrangler.jsonc | hosting/ | catalogue Worker config (facemorph-name-catalogue) |
| hosting/gallery/wrangler.jsonc | hosting/ | seed-gallery Worker config; catalogue pipeline, not model hosting |
| hosting/next-cloudflare/.wrangler/cache/cf.json | historical | committed local wrangler state; junk, kept only as history, not imported |
| hosting/next-cloudflare/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/922797108c590c411b100c31f46f14b4f223ce83273448eaefdac5350561025a.sqlite | historical | committed local miniflare KV state; junk, kept only as history, not imported |
| hosting/next-cloudflare/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/922797108c590c411b100c31f46f14b4f223ce83273448eaefdac5350561025a.sqlite-shm | historical | committed local miniflare KV state; junk, kept only as history, not imported |
| hosting/next-cloudflare/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/922797108c590c411b100c31f46f14b4f223ce83273448eaefdac5350561025a.sqlite-wal | historical | committed local miniflare KV state; junk, kept only as history, not imported |
| hosting/next-cloudflare/README.md | hosting/ | diagnostics collector documentation (collector stays with the app) |
| hosting/next-cloudflare/delete-run.mjs | hosting/ | diagnostics collector retention tool (ws-diag) |
| hosting/next-cloudflare/validation.mjs | hosting/ | diagnostics validation, imported by src/Next/reporting.test.mjs (app-side) |
| hosting/next-cloudflare/worker.mjs | hosting/ | diagnostics collector Worker (stays with the app, not model hosting) |
| hosting/next-cloudflare/worker.test.mjs | hosting/ | collector tests travel with the collector |
| hosting/next-cloudflare/wrangler.toml | hosting/ | collector Worker config (route next.facemorph.me/diagnostics/*) |
| hosting/next-mirror/worker.mjs | packages/cloudflare-model-host | mirror serving Worker (R2 facemorph-runtime-mirror, copies immutable prefixes via SITE binding) |
| hosting/next-mirror/worker.test.mjs | packages/cloudflare-model-host | mirror Worker tests travel with the mirror |
| hosting/next-mirror/wrangler.jsonc | packages/cloudflare-model-host | mirror Worker config (bindings MIRROR + SITE); deploy step itself is re-homed by hosting/ deploy (fm-8tyu) |
| hosting/next-static/.gitignore | hosting/ | staging support file for the next-static staging area |
| hosting/next-static/README.md | hosting/ | staging model documentation (frontend staging stays in hosting/) |
| hosting/next-static/analytics.mjs | hosting/ | pageview counter, app-side (currently disabled) |
| hosting/next-static/analytics.test.mjs | hosting/ | analytics tests travel with analytics |
| hosting/next-static/attach-domain.py | hosting/ | domain attach is an app/domain operation, not model hosting |
| hosting/next-static/catalogue.json | hosting/ | names catalogue data staged into the site; catalogue pipeline (ws-names) |
| hosting/next-static/mirror-runtime.py | packages/cloudflare-model-host | rebuilds the runtime from pinned manifests with digest verification: digest-consistent publication + mirror serving machinery |
| hosting/next-static/promote.py | hosting/ | promotion gates and wrangler publish of the site: promotion stays in hosting/ |
| hosting/next-static/restage-runtime.py | split | overlay writing + chunk/manifest rebuild functions go to packages/cloudflare-model-host; review-artifact orchestration glue stays in hosting/ staging |
| hosting/next-static/runtime-overlay/assets/2d71c033d9812f5fb4f548de7451667cc780f0b4ab311e7c5a929e279b9ceac5/split-segment.json | packages/cloudflare-model-host | content-addressed overlay asset consumed by the manifest/publication machinery |
| hosting/next-static/runtime-overlay/assets/6ee1eb7a0a894488e450242d72cb27b10a22b0b82b9aee9b4127c58efffb52f2/fused-resample-v1.mjs | packages/cloudflare-model-host | content-addressed overlay asset (fused-resample kernel) pinned by the publication manifest |
| hosting/next-static/runtime-overlay/manifest.json | packages/cloudflare-model-host | the production manifest pin: schema + materialization belong to the package's manifest generation |
| hosting/next-static/stage.py | hosting/ | frontend staging (assembles public/ from runtime + frontend + catalogue) |
| hosting/next-static/webgpu_contract.py | split | contract-check functions (served bundle matches shipped engine) go to packages/cloudflare-model-host qualification; runner glue stays in hosting/ staging |
| hosting/next-static/webgpu_contract_test.py | split | tests travel with webgpu_contract.py: assertions to packages/cloudflare-model-host, fixtures/runner glue to hosting/ |
| hosting/next-static/worker.mjs | hosting/ | entry site Worker (assets + /diagnostics routing): app-side |
| hosting/next-static/wrangler.jsonc | hosting/ | entry site Worker config (facemorph-next): app-side |
| hosting/next/.gitignore | hosting/ | support file for the historical preview area |
| hosting/next/compose.yml | historical | preview+tunnel stack; classic-only, must not be referenced by the final site |
| hosting/next/configure-tunnel.py | historical | tunnel provisioning for the retired preview origin |
| hosting/next/notices/NVIDIA-StyleGAN2-ADA.txt | hosting/ | licence notices shipped at /runtime/notices: staging content |
| hosting/next/notices/ONNX-Runtime-1.22-ThirdPartyNotices.txt | hosting/ | licence notices shipped at /runtime/notices: staging content |
| hosting/next/notices/ONNX-Runtime-MIT.txt | hosting/ | licence notices shipped at /runtime/notices: staging content |
| hosting/next/notices/ONNX-Runtime-ThirdPartyNotices.txt | hosting/ | licence notices shipped at /runtime/notices: staging content |
| hosting/next/notices/e4e-MIT.txt | hosting/ | licence notices shipped at /runtime/notices: staging content |
| hosting/next/notices/index.html | hosting/ | notices index page shipped at /runtime/notices: staging content |
| hosting/next/phone-candidate-admission.json | hosting/ | device admission receipt consumed via prepare-runtime --phone-admission; staging input |
| hosting/next/photo-canary-provenance.json | hosting/ | canary fixture provenance; staging input documentation |
| hosting/next/prepare-runtime.py | packages/cloudflare-model-host | chunking (>25 MiB -> 16 MiB verified chunks) + manifest/qualification-manifest generation: core package machinery |
| hosting/next/server.py | historical | private preview origin with bounded diagnostics writer; classic-only |
| hosting/next/test_prepare_runtime.py | packages/cloudflare-model-host | travels with prepare-runtime.py chunking/manifest logic |
| hosting/next/test_server.py | historical | travels with server.py (classic-only preview) |

Run from the repository root:

    node scripts/inventory/check-hosting-boundary.mjs
    node scripts/inventory/check-hosting-boundary.mjs --rev <sha>
<!-- facemorph-example:end -->

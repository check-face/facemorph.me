# @facemorph/cloudflare-model-host

Stages, verifies and publishes verified model bytes for static hosting on Cloudflare (bead fm-3osh). It was
extracted from classic `hosting/next/prepare-runtime.py` (chunking and manifest rewriting) and
`src/Next/browser/stage-assets.py` (content-addressed staging). Application policy stays in the app's `hosting/`:
phone admission, promotion, the photo sub-bundle, frontend staging, serving headers and the mirror Worker.

## What it does

- **Stage:** `facemorph-model-host stage --source <dir> --out <dir> --base <https url> [--from-base <url>] [--dry-run]`.
  Every asset the manifest names is checked against its declared SHA-256 and size and copied to the same relative
  path. An asset over the 25 MiB file limit is published only as 16 MiB chunks, `chunks/<sha256>.bin`; a chunk is
  written once and never changed. The manifest is rewritten to hosted URLs under `--base`. The source can be an
  unpublished bundle (assets named by `file`, as model-conv writes them) or an already hosted tree being restaged
  (`--from-base` maps its URLs back to paths). The manifest must pass `@facemorph/browser-model-manager`'s contract
  before and after staging: a newer or unknown major is refused. Local paths, `file://` URLs, sibling checkouts and
  private inventories (`sources.private.json`) never reach the staged manifest.
- **Verify:** `facemorph-model-host verify --root <dir> --base <https url> [--plan workers-free|workers-paid]`. Each
  asset is read back by its URL path, a chunked one through its chunks, and must reproduce its digest and size.
  Every file must fit the per-file limit and the plan's file count.
- **Publish:** `facemorph-model-host publish --root <dir> --target <target.json> [--publish]`. This is a dry run unless
  `--publish` is given: it reads only, then reports each file it would write. The model terms are checked first
  (below). A target is
  `{"kind": "directory", "path": ...}` (a static root, or a local mirror) or
  `{"kind": "cloudflare", "project": <dir>, "product": ...}`, which runs `cf deploy` in that project directory. A paid
  product is refused unless the target also names it in `"paidServiceApproved"`. An existing destination file that
  differs is refused, never overwritten.

Exit codes are 0 for ok, 1 for a refusal or findings, and 2 for a usage error. Each command prints one JSON report.

## Cloudflare limits and cost

Read from developers.cloudflare.com on **24 October 2026**: Workers platform limits (static assets), Workers pricing,
Pages limits and R2 pricing. `src/limits.ts` holds the same figures; change both together.

| | |
| --- | --- |
| Chosen product and tier | Workers Static Assets on **Workers Free**. Pages has the same 25 MiB file limit and 20,000-file Free limit. |
| Per-file limit | 25 MiB on every plan. Larger inputs are published as 16 MiB chunks. |
| Files per version | 20,000 (Free), 100,000 (Paid) |
| Request routing | A request matching a static asset is served without invoking Worker code. Static asset requests are free and unlimited on both plans. The 100,000 requests/day Free limit applies only to Worker invocations. |
| Storage, request and bandwidth allowances | No separate storage charge for static assets; static asset requests free and unlimited; no egress charge. Enabling Workers Caching bills static asset requests at the Worker request rate, so it is not used here. |
| Paid alternatives (refused unless named) | Workers Paid: $5.00 per month subscription. R2 (Standard): $0.015 per GB-month, $4.50 per million Class A and $0.36 per million Class B operations beyond the free 10 GB-month, 1M Class A and 10M Class B per month; egress free. |
| Measured staged set | The qualified runtime the candidate serves (manifest `d9e37e50…`) as acquired on eris: **301 files, 2,766,791,005 bytes**, 81 assets of which 5 are chunked into 90 chunks. The largest file is 24,135,856 bytes (`b16-coefficients.bin`), under 25 MiB. 301 files fit Workers Free. `test/host.test.ts` checks this on every run where the runtime is present. |

**Model terms.** Before anything is written, the target must name a terms record with rows shaped like the
repository's `import/licences.json`. One row must cover the manifest's `modelSourceSha256`. If that row's
`redistribution` is not `"permitted"`, the target must acknowledge the row by id (`"terms": {"record": ...,
"acknowledged": "<row id>"}`). For the qualified runtime, row `nvidia-stylegan2-ffhq-config-f-derived` is
`unresolved` today, so publishing it needs that explicit acknowledgement.

Publishing the real runtime is the delivery step, and this package's tests do not run it. The directory target is
tested with real writes. The `cf deploy` path is untested here.

## Boundary assignment table

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

Run locally:

```sh
node scripts/inventory/check-hosting-boundary.mjs              # default: sibling classic @ 6107f80
node scripts/inventory/check-hosting-boundary.mjs --rev <sha>  # another revision
```

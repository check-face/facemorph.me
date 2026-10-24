# @facemorph/cloudflare-model-host (skeleton)

Status: **not implemented** (bead fm-3osh builds it; this README is fm-p7v's hosting-boundary
assignment table, which `scripts/inventory/check-hosting-boundary.mjs` enforces against
`git ls-tree hosting/` in `check-face/facemorph.me-classic` at the frozen revision
`6107f80fbc5acc6019c1d22d90523cca3b02001b`).

## Purpose (from the plan; nothing built yet)

The package owns the model-hosting machinery that is independent of the FaceMorph app:
runtime **chunking** (>25 MiB inputs -> 16 MiB verified chunks, `hosting/next/prepare-runtime.py`),
**manifest generation** (content-addressed `manifest.json` + `manifests/<sha>.json` pins),
**digest-consistent publication** (content-addressed paths, publication receipts),
the **header contract** (`_headers` for `/runtime/*`: immutable caching, CORS) and
**mirror serving** (the `hosting/next-mirror/` Worker over R2 that copies immutable
`runtime/{assets,chunks,manifests,photo,encoder-stream}/` prefixes from the site origin on first
request). Application-side machinery stays in the app's `hosting/`: frontend staging, promotion,
the diagnostics collector, the catalogue pipeline, domain attach and analytics.

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

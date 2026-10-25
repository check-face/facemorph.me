# @facemorph/cloudflare-model-host

Stages, verifies and publishes verified model bytes for static hosting on Cloudflare (bead fm-3osh). It was
extracted from classic `hosting/next/prepare-runtime.py` (chunking and manifest rewriting) and
`src/Next/browser/stage-assets.py` (content-addressed staging), and the mirror Worker from classic
`hosting/next-mirror/` (fm-fy2.14, provenance in `mirror/provenance.json`). Application policy stays in the app's
`hosting/`: phone admission, promotion, the photo sub-bundle, frontend staging, and the deploy values it serves with.

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
- **Qualify an origin:** `facemorph-model-host qualify-origin --root <dir> --origin <url> --base-path /runtime/
  --immutable assets/,chunks/ --mutable manifest.json [--reference <qualified-manifest.json>]`. Reads every served
  file and checks its bytes, headers, chunk reconstruction and the manager's manifest contract. The optional
  reference requires the served set to retain the qualified engine's exact asset digests. It publishes nothing.
- **Publish:** `facemorph-model-host publish --root <dir> --target <target.json> [--publish]`. This is a dry run unless
  `--publish` is given: it reads only, then reports each file it would write. The model terms are checked first
  (below). A target is
  `{"kind": "directory", "path": ...}` (a static root, or a local mirror) or
  `{"kind": "cloudflare", "project": <dir>, "product": ...}`, which runs `cf deploy` in that project directory. A paid
  product is refused unless the target also names it in `"paidServiceApproved"`. An existing destination file that
  differs is refused, never overwritten.

- **Mirror Worker:** `src/mirror/worker.ts`, a second origin for the immutable runtime files, held in R2. A file it
  does not hold is copied from the configured upstream on first request, only under the configured prefixes, and
  served with CORS, `Cross-Origin-Resource-Policy: cross-origin` and immutable caching. Configuration: `UPSTREAM`
  (the origin copied from), `PREFIXES` (comma-separated immutable prefixes), the `MIRROR` R2 binding and an optional
  `SITE` service binding to the upstream Worker. Nothing about FaceMorph is built in. Its tests run in workerd
  (`npm run test:workerd`, which needs glibc 2.32 or newer).
- **Warm:** `facemorph-model-host warm --root <dir> --origin <mirror url> --prefixes <list> [--publish]`. HEAD on every
  immutable path of a staged root, 8 at a time, each retried up to 3 times on a network error or 408/429/5xx. Any
  final non-200 fails the run, naming the path; the report gives the held count. A mirror copies a file on HEAD, so
  without `--publish` nothing is requested.

- **Mirror deploy:** `facemorph-model-host mirror-deploy --worker <name> --bucket <r2 bucket> --upstream <url>
  --prefixes <list> [--site <worker>] [--domain <host>] [--compatibility-date <date>] [--publish]`. Deploys the mirror
  Worker with the Cloudflare CLI `cf`, never Wrangler: the package root is the cf project (`cloudflare.config.ts`
  reads every value from the arguments, `vite.config.ts` builds through the Cloudflare Vite plugin). Without
  `--publish` it runs `cf deploy --dry-run`, which builds the Worker, lists its bindings and sends no API request. The
  plugin is the 2.0 beta because its latest stable release (1.65.0) depends on Wrangler.

- **Model origin:** `facemorph-model-host origin-deploy --root <dir> --worker <name> --base-path /runtime/ --immutable
  <list> --mutable <list> [--workers-dev] [--domain <host>] [--terms <record> [--acknowledge <row>]] [--publish]`. A
  staged root as its own origin on Workers Static Assets, through `cf` in the project's `model-origin` mode: the root
  is served under the base path with `_headers` rules (`src/headers.ts`), and the Worker has no script, so a model
  request never runs Worker code. The rules are CORS, `Cross-Origin-Resource-Policy: cross-origin` and `nosniff`
  on the root, a year's immutable caching on the immutable prefixes, `no-cache` on the mutable files, and
  `application/octet-stream` for extensions the asset upload leaves untyped (`.f32`, `.i32` and `.onnx` had no
  Content-Type at all before the rule). Model terms are checked before anything is published.

Exit codes are 0 for ok, 1 for a refusal, findings or failures, and 2 for a usage error. Each command prints one JSON
report.

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

## Retention policy (fm-fy2.14)

An open tab keeps the one manifest it loaded for as long as it runs, so a new release must not take away the
immutable files an older release still names. Retention is by reference, never by age alone:

- **Retained manifests.** The live release's manifest, every declared rollback target's manifest (the delivery
  runbook's rollback targets), and every manifest published within the **retention window** before the live one.
  The window is a deploy parameter; the default is **30 days and at least the 2 previous releases**, whichever
  covers more. An operator decision replaces the default; until one is recorded, the default is the policy.
- **Retained files.** Every immutable path (content-addressed asset, chunk and manifest under the mirrored
  prefixes) that any retained manifest names. Mutable paths (the unversioned manifest pointer, pages) are never
  retained; they always point at the live release.
- **Primary host (Workers Static Assets).** A deployment serves only the files uploaded with it, so each release's
  staged root carries forward every retained file as well as its own. Staging adds them before the app that uses
  them is published: files first, app second.
- **Mirror (R2).** The mirror holds every retained file. Before a rollback is claimed, the rollback target's paths
  are confirmed held there (`facemorph-model-host warm --publish` against the mirror, or the delivery dry run's
  read-only listing).
- **Garbage collection.** Only a file no retained manifest names may be deleted, and only from the mirror bucket
  (the primary host drops it by not carrying it forward). Nothing is collected without listing the retained
  manifests and the deletions first; the same `--publish` rule as every other write applies.
- **Never user data.** Retention and model-cache eviction act only on model-cache keys and hosted model files.
  Completed user exports and application recovery records are outside both, always.
- **Cost.** Static assets have no storage charge, and a retained set costs only files per version: one qualified
  set is 301 files of the 20,000 Workers Free allows. On the mirror, one set is 2.77 GB, so three retained sets fit
  R2's free 10 GB-month; beyond that it is $0.015 per GB-month (figures as in the table above).

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

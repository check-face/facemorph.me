# Hosting models on Cloudflare

The documented Cloudflare deployment is a model origin on **Workers Static Assets** (no Worker script runs for a
model request) and, optionally, a second origin: this package's mirror Worker over an **R2** bucket. Cloudflare's own
tooling is optional: the files can be uploaded with any tool and checked with `qualify-origin`, as in the
[static hosting guide](static-hosting.md). This package deploys with the Cloudflare CLI `cf` (installed with it),
never Wrangler.

This guide assumes the [README quickstart](../README.md#quickstart-host-manager-engine-on-your-own-machine) has been
followed in the same directory (it reuses `./converted` and `terms.json`). Commands that change your Cloudflare
account are marked as such; everything else runs without an account.

## Limits for this model

Workers Static Assets allows 25 MiB per file and 20,000 files per version on Workers Free (100,000 on Paid); static
asset requests are free and unlimited, with no storage charge. The AFHQ cat model stages to 26 files and 134,630,462
bytes, largest file 16,777,216 bytes, so it fits Workers Free. The README's
[limits table](../README.md#cloudflare-limits-and-cost) has the figures, their sources and check dates, and the paid
alternatives. `verify --plan workers-free` fails when a staged set does not fit.

## 1. Name the origins

A Worker deployed with `--workers-dev` is served at `https://<worker>.<your account subdomain>.workers.dev`; with
`--domain` it is served on a custom domain in your account. Set the two origins this guide uses:

<!-- docs-test: set-origin -->
```sh
export MODEL_ORIGIN=https://my-model-origin.your-subdomain.workers.dev
export MIRROR_ORIGIN=https://my-model-mirror.your-subdomain.workers.dev
```

## 2. Stage for the origin

The staged release sits at the path it will be served from, inside `./cf-public`:

<!-- docs-test: run -->
```sh
npx facemorph-model-host stage --source ./converted --out ./cf-public/models/my-model-v1 \
  --base "$MODEL_ORIGIN/models/my-model-v1"
npx facemorph-model-host verify --root ./cf-public/models/my-model-v1 \
  --base "$MODEL_ORIGIN/models/my-model-v1" --plan workers-free
```

## 3. Deploy the model origin

Without `--publish`, `origin-deploy` builds the assets-only Worker with `cf deploy --dry-run` and sends no API
request, so it needs no account. The build output, under the installed package's `.cloudflare/output/`, holds the
staged release at its base path and the `_headers` rules:

<!-- docs-test: cloudflare-dry-run -->
```sh
npx facemorph-model-host origin-deploy --root ./cf-public/models/my-model-v1 --worker my-model-origin \
  --base-path /models/my-model-v1/ --immutable chunks/ --mutable manifest.json --workers-dev
```

To deploy, sign in once and add `--publish` with the model terms. **This changes your Cloudflare account.**

<!-- docs-test: needs-test-origin -->
```sh
npx cf auth login
npx facemorph-model-host origin-deploy --root ./cf-public/models/my-model-v1 --worker my-model-origin \
  --base-path /models/my-model-v1/ --immutable chunks/ --mutable manifest.json --workers-dev \
  --terms terms.json --acknowledge my-model --publish
```

Then qualify what the deployed origin serves:

<!-- docs-test: needs-test-origin -->
```sh
npx facemorph-model-host qualify-origin --root ./cf-public/models/my-model-v1 --origin "$MODEL_ORIGIN" \
  --base-path /models/my-model-v1/ --immutable chunks/ --mutable manifest.json
```

A deployment serves only the files uploaded with it. To serve a second release beside the first, stage both into
one root and deploy that root (see [retention](#retention-keeping-older-releases-servable)).

The `publish` command's `{"kind": "cloudflare", "project": <dir>, "product": "workers-static-assets-free"}` target
runs `cf deploy` in a cf project directory of your own, for a site that already deploys its assets that way.

## Second origin: an R2 mirror

The mirror Worker answers for the immutable prefixes only. A file it does not hold is copied from `UPSTREAM` on first
request into the R2 bucket, then served from there with CORS, `Cross-Origin-Resource-Policy: cross-origin` and
immutable caching; anything outside the prefixes is refused without a fetch. Its paths equal the primary's, so the
manager can retry a chunk there: `createBrowserModelCache({ alternateOrigins: [MIRROR_ORIGIN] })`.

R2 is a paid product with a free allowance (10 GB-month of storage, 1M Class A and 10M Class B operations a month,
free egress, read on 24 October and rechecked 27 October 2026); this model's 0.13 GB fits inside it.

The dry run builds the Worker with its bindings and needs no account:

<!-- docs-test: cloudflare-dry-run -->
```sh
npx facemorph-model-host mirror-deploy --worker my-model-mirror --bucket my-model-mirror \
  --upstream "$MODEL_ORIGIN/" --prefixes models/my-model-v1/chunks/ --workers-dev
```

To deploy it, create the bucket and add `--publish`. **This changes your Cloudflare account.** When the upstream is a
Worker in the same account, `--site <worker>` fetches through a service binding instead of the public origin.

<!-- docs-test: needs-test-origin -->
```sh
npx cf r2 buckets create --name my-model-mirror
npx facemorph-model-host mirror-deploy --worker my-model-mirror --bucket my-model-mirror \
  --upstream "$MODEL_ORIGIN/" --prefixes models/my-model-v1/chunks/ --workers-dev --publish
```

### Warm the mirror

`warm` lists every immutable path of the public root under the prefixes. Without `--publish` it requests nothing and
reports how many paths a warm would request:

<!-- docs-test: run -->
```sh
npx facemorph-model-host warm --root ./cf-public --origin "$MIRROR_ORIGIN" --prefixes models/my-model-v1/chunks/
```

With `--publish` it sends a HEAD for each, which makes the mirror copy the file; it fails naming any path that does not
end in a 200:

<!-- docs-test: needs-test-origin -->
```sh
npx facemorph-model-host warm --root ./cf-public --origin "$MIRROR_ORIGIN" \
  --prefixes models/my-model-v1/chunks/ --publish
```

## Retention: keeping older releases servable

An open tab keeps the one manifest it loaded for as long as it runs, so a new release must not take away the immutable
files an older release still names. Retention is by reference, never by age alone:

- **Retained manifests.** The live release's manifest, every declared rollback target's manifest, and every manifest
  published within the **retention window** before the live one. The window is a deploy parameter; the default is
  **30 days and at least the 2 previous releases**, whichever covers more.
- **Retained files.** Every immutable path (content-addressed asset, chunk and manifest under the mirrored prefixes)
  that any retained manifest names. Mutable paths (the unversioned manifest pointer, pages) are never retained; they
  always point at the live release.
- **Primary host (Workers Static Assets).** A deployment serves only the files uploaded with it, so each release's
  staged root carries forward every retained file as well as its own. Staging adds them before the app that uses them
  is published: files first, app second.
- **Mirror (R2).** The mirror holds every retained file. Before a rollback is claimed, the rollback target's paths are
  confirmed held there (`warm --publish` against the mirror).
- **Garbage collection.** Only a file no retained manifest names may be deleted, and only from the mirror bucket (the
  primary host drops it by not carrying it forward). Nothing is collected without listing the retained manifests and
  the deletions first; the same `--publish` rule as every other write applies.
- **Never user data.** Retention and model-cache eviction act only on model-cache keys and hosted model files.
  Completed user exports and application recovery records are outside both, always.
- **Cost.** Static assets have no storage charge, and a retained set costs only files per version. On the mirror,
  storage is what the retained sets add up to, inside R2's free 10 GB-month until they exceed it, then $0.015 per
  GB-month.

<!-- facemorph-example:start -->
**Example: FaceMorph's own deployment.** FaceMorph applies this policy to its qualified FFHQ runtime (fm-fy2.14): one
set is 301 files of the 20,000 Workers Free allows, and 2.77 GB on its mirror (`models.facemorph.me`, R2 bucket
`facemorph-runtime-mirror`), so three retained sets fit R2's free 10 GB-month. Its rollback targets are those its
delivery runbook declares, and an operator decision replaces the default window; until one is recorded, the default
is the policy.
<!-- facemorph-example:end -->

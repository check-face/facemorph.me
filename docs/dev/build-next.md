# `build:next` and the `deploy-next/` artifact contract (fm-5ey)

## Command

Repository `check-face/facemorph.me`, working directory: the repository root.

```sh
npm run build:next             # writes deploy-next/ and its identity files at the root
npm run build:next -- --check  # reads them back and verifies every file against the identity
```

Run `npm ci` first; Node 24 or newer. `build:next` runs the workspace build, then stages
its actual Vite output. It does not install dependencies or publish anything.
Classic still serves next.facemorph.me until release qualification and cutover.

## Destination and retained control

`build:next` builds the mounted React controller and views from this repository. The
retained classic control is independent:

```sh
node scripts/import/fetch-control.mjs --dest .cache/control
```

This verifies the pinned release ZIP and every file against `import/control-artifact.json`.
Research drivers read `.cache/control/tree/deploy-next` and verify its frozen tree digest.
Parity self-tests fetch and verify that control independently; they never treat a destination
build as its own baseline or change committed control goldens.

## Artifact layout and identity

`deploy-next/` contains the Vite site, worker inventory, catalogue, historic hello preview,
production `_headers` and SPA `_redirects`. Vite's private `.vite` build metadata is excluded.
Three sibling files are never served: `next-site-SHA256SUMS`, `next-site-source.txt`, and
`next-site-identity.json`. All are ignored by Git.

The identity (`facemorph.next-site-identity/1`) has `kind` and `label` **destination**,
`deploySource` naming check-face/facemorph.me, its commit/build ID, clean/dirty state and
source-tree digest, plus `importedFrom` naming the frozen classic import and ZIP digest.
Its file list records sizes and SHA-256 for the complete artifact. `--check` refuses missing,
changed or extra files, invalid provenance, and unknown identities. Building refuses to replace
an unknown or modified existing artifact. The reader also verifies retained control identities
for independent comparisons.

## Canonical CI artifact

The site lane builds once and uploads `next-site-<commit>` with explicit repository ID,
workflow/run/commit provenance. E2E, shell, Android components, iOS components and iOS product
lanes use the shared download-and-verify action against those exact bytes. Digest/source
mismatches fail before browser tests. Release-only hosted/device lanes accept the same explicit
provenance. Dependency caches use lockfile hashes; runtime caches use the immutable manifest SHA.

`hosting/next-static/headers.json` is the production header policy used by staging and local
preview servers. Check actual preview/staged responses, including worker/WASM MIME, isolation,
CORS, runtime digests and SPA fallback:

```sh
node scripts/hosting/check-headers.mjs --url http://127.0.0.1:<port> --artifact deploy-next
```

## Runtime acquisition (clean clone)

The runtime the application loads (overlay manifest `d9e37e50…`, every file it pins, nested manifests and photo worker
siblings) is acquired into the ignored `.cache/runtime/`, each file checked against `import/build-inputs.json`.
It downloads model weights (about 2.8 GB), so it needs explicit acceptance of the terms in `import/licences.json`:

```sh
ACCEPT_MODEL_TERMS=yes node scripts/runtime/acquire.mjs
node scripts/inventory/check-build-inputs.mjs --acquired .cache/runtime   # exits 0: 301 files, no findings
```

## Destination checks and the exact-artifact harness

```sh
npm run build:next
node scripts/import/destination-checks.mjs   # classic's next-site.yml artifact checks, in this repository
python3 scripts/import/control-harness.py --runtime .cache/runtime --out control-harness-evidence
```

The harness needs openssl, Chromium or Chrome, and Python with `browser-harness==0.1.8` and `playwright`. It serves
`deploy-next/` and the acquired runtime under the production origin with classic's `next-e2e-server.py`, runs classic's
`next-e2e-browser.py` in a headless Chrome it starts on a free debugging port (never 9222: on eris that is the device
lab's adb forward to the phone), records every browser request by host class, then cancels a running morph and reads
worker and heap figures. Hosts other than the artifact origin and the two project catalogue Workers are made unresolvable, so the control's analytics calls
are recorded as attempts and never delivered. `report.json`, logs and, on failure, a trace and screenshot land in
`--out`.

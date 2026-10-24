# `build:next` and the `deploy-next/` artifact contract (fm-5ey)

## Command

Repository `check-face/facemorph.me`, working directory: the repository root.

```sh
npm run build:next             # writes deploy-next/ and its identity files at the root
npm run build:next -- --check  # reads them back and verifies every file against the identity
```

No dependencies are installed; Node 22 or newer. In `facemorph.me-classic`, `npm run build` builds the historical
app and is no substitute.

## What it builds today: the control

Until the rendering port, `build:next` does **not** bundle this repository's source (`apps/web/src/Next/product-bridge.mjs`
still imports the absent `./ProjectJson.fs.js`). It fetches the pinned control artifact, classic's candidate build
recorded in `import/control-artifact.json`, from this repository's release asset (`scripts/import/fetch-control.mjs`),
verifies the zip digest and every file, and lays it out exactly as classic's `next-site.yml` job `artifact` did.

## Layout

| Path (repository root) | Content |
| --- | --- |
| `deploy-next/` | The static site: `index.html`, hashed `app/runtime/vendors/style` bundles and maps, fonts, icons, `catalogue.json`, `preview/hello-1024.webp`. Served as is; nothing else may be added. |
| `next-site-SHA256SUMS` | Classic's `sha256sum` of every `deploy-next/` file. |
| `next-site-source.txt` | The commit the site was built from: classic's `551b6072…` for the control. |
| `next-site-identity.json` | Identity and label (below). Beside `deploy-next/`, never inside it, so it is never served. |

All four are ignored by Git.

## Identity file

`schema: facemorph.next-site-identity/1`, with:

- `kind: "control"` and `label`: "control (classic candidate build; not built by this repository)";
- `deploySource`: the repository, commit, build id and CI run the site's bytes come from (classic, for the control);
- `control`: the release URL, the zip's SHA-256 and the file count;
- `assembledBy`: this repository's commit, recorded only as the commit that fetched and verified the control. A control
  build never names it as the deploy source, and the reader fails one that does;
- `files`: path, SHA-256 and size of every artifact file.

`--check` (and `readIdentity()` in `scripts/import/build-next.mjs`) fails on a missing identity, a control digest that is
not the pinned one, any missing, changed or extra file under `deploy-next/`, or a control build without the control label
or classic's identity. The later Vite build writes `kind: "monorepo"` with its own commit and import provenance; until
then no other kind is accepted.

## Runtime acquisition (clean clone)

The runtime the control loads (overlay manifest `d9e37e50…`, every file it pins, nested manifests and photo worker
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
worker and heap figures. Hosts other than the artifact origin are made unresolvable, so the control's analytics calls
are recorded as attempts and never delivered. `report.json`, logs and, on failure, a trace and screenshot land in
`--out`.

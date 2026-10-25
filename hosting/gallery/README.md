# Synthetic asset collection

This static-only Workers deployment uses no paid object storage or inference. The staged `public/` directory is deliberately ignored; reconstruct it from the verified selection, never from the full Triton directory.

Published 16 September 2026 at https://facemorph-seed-gallery.cdilga.workers.dev, version `93f60a7a-d703-4fd9-9132-209d45cddee1`:

- 5,055 public-name previews at 200px.
- 2,911 available historic full-size name images.
- Numeric seeds0–999 at1024px.
- 8,966 images /364,039,372bytes; all historic lossy originals.

Every public-name identity was recomputed from its exact lowercase request with SHA-256; every numeric identity and source shard was derived from its seed. Every copied file was checked against its measured size and SHA-256 before publication. No recovered-photo/GUID identities are permitted.

The workspace's `review-artifacts/static-assets-2026-09-16/verified-selection.json` is the complete file ledger. `cloudflare-publication.json` records three public byte/hash checks. New1024 PNG canonical originals belong in the device cache and are not substituted by these historic images.

The seed gallery is retained unchanged. Cloudflare publication uses the installed `cf` CLI.

## Public-name supplement, 10 October 2026

Published at https://facemorph-name-catalogue.cdilga.workers.dev by
[run 38029582696](https://github.com/check-face/facemorph.me/actions/runs/38029582696).
All 5,055 public names have pinned W+ assets; the 2,144 missing full-size previews
are now published. Existing historic full-size previews retain their origin.
The published catalogue matches the CI artifact and its SHA-256 ledger exactly;
see the [publication receipt](../../docs/review/candidate-2026-10-10/name-publication.json).

NumPy independently verified all input Z identities; pinned CPU mapping generated
the W+ assets. On-device synthesis produces canonical PNGs from verified W+,
while hosted JPEGs remain display previews. Identity/hash verification is not a
claim of numerical parity across every device. The delivery CPU gate exercises
a published name without accepting silent mapping fallback.

## Recovery-bearing catalogue publication

`.github/workflows/name-catalogue.yml` consumes the checked names generator manifest and result
files, resumed on eris. Provision its snapshot once using the R2 restore command in
`tools/names-generator/README.md`; CI checks every cached file against the committed snapshot
manifest with `restore.mjs --check-local`, without administrator token permissions or network
access. Missing or corrupted snapshot inputs fail before publication. No retiring API is used. The publisher
checks every result's file, image, latent and model/generation identity before deploying anything.
It keeps the legacy tree byte-identical and all earlier published immutable manifests/results.

From the repository root, after generating the complete catalogue:

```sh
node scripts/names-publish/publish.mjs \
  --generated="$HOME/.cache/facemorph-names-generator/out" \
  --legacy="$HOME/.cache/facemorph-names-generator/snapshot/facemorph-name-catalogue.cdilga.workers.dev" \
  --origin=https://facemorph-name-catalogue.cdilga.workers.dev --publish
```

Omit `--publish` for a `cf deploy --dry-run`; `--check` only validates. The publisher stages
`results/<sha256>.webp` and `catalogues/<sha256>.json` first, verifies fetched objects, then
switches `catalogue-v2.json` in a second atomic Workers asset deployment and verifies it again.
`publication.json` retains the inventory needed by the next publication. An unchanged pointer
only runs verification. Counts, bytes, Free-tier limits and all identities appear in job output.
The local cf project uses the same Vite-plugin beta as the model-host package because stable v1
does not produce the Build Output Specification required by `cf`.

Tests: `node --test scripts/names-publish/publish.test.mjs`. Set
`PUBLICATION_BROWSER=/usr/bin/chromium` to additionally retain an actual browser tab across the
local pointer switch. These tests use planted file inputs and real envelopes/HTTP, not inference
evidence. A task-owned staging directory is retained under `/tmp/facemorph-names-publish-*` for
inspection; it can be removed after publication evidence is recorded.

# Synthetic asset collection

This static-only Workers deployment uses no paid object storage or inference. The staged `public/` directory is deliberately ignored; reconstruct it from the verified selection, never from the full Triton directory.

Published 16 September 2026 at https://facemorph-seed-gallery.cdilga.workers.dev, version `93f60a7a-d703-4fd9-9132-209d45cddee1`:

- 5,055 public-name previews at 200px.
- 2,911 available historic full-size name images.
- Numeric seeds0–999 at1024px.
- 8,966 images /364,039,372bytes; all historic lossy originals.

Every public-name identity was recomputed from its exact lowercase request with SHA-256; every numeric identity and source shard was derived from its seed. Every copied file was checked against its measured size and SHA-256 before publication. No recovered-photo/GUID identities are permitted.

The workspace's `review-artifacts/static-assets-2026-09-16/verified-selection.json` is the complete file ledger. `cloudflare-publication.json` records three public byte/hash checks. New1024 PNG canonical originals belong in the device cache and are not substituted by these historic images.

Deploy with `wrangler deploy --config hosting/gallery/wrangler.jsonc` only after reconstructing and validating the explicit allowlist. Keep this origin static-only; no worker code or upload endpoint is required.

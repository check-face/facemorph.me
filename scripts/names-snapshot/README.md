# Names snapshot (bead fm-old)

A copy of every object the two public static Workers publish, kept in the R2 bucket
`facemorph-names-snapshot` so the names catalogue can be rebuilt after `api.facemorph.me` is retired.
Nothing here calls the hosted API.

- `facemorph-seed-gallery`: `manifest.json` and its 8,966 entries (5,055 name previews at 200px,
  2,911 historic 1024px name images, seeds 0-999 at 1024px).
- `facemorph-name-catalogue`: `ledger.json` and its 7,200 files (`catalogue.json`, 2,144 1024px
  previews, 5,055 W+ latents).

`manifest.tsv` has one row per object (`source_url`, `name`, `bytes`, `sha256`). The object key in the
bucket is the source URL without `https://`. `manifest-summary.json` holds the counts, bytes,
inventory digests, the manifest digest (cited by the API-retirement receipt), known defects, and the
results of the last verified store run and restore check.

```sh
npm ci
node snapshot.mjs plan                                     # re-read both inventories; rewrites the manifest
node snapshot.mjs run --mint-r2=<account id> --record-summary
node snapshot.mjs verify --mint-r2=<account id>            # reads the bucket only; fetches nothing
node check-restore.mjs --sample=200 --mint-r2=<account id> --record-summary
node restore.mjs --out=<dir> --names=charlotte,saanvi --mint-r2=<account id>
```

`run` never fetches an object that is already in the bucket with the right digest. A missing or
corrupted object is fetched from its source, checked against the manifest, written and read back.
`--mint-r2` creates short-lived Cloudflare API tokens scoped to the bucket through `cf` and revokes them
afterwards. Without it, the scripts read `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
`restore.mjs` writes `<out>/<object key>` only after the size and SHA-256 match. `check-restore.mjs`
runs it with every outbound connection recorded and fails on any connection to a retired API host
or a source Worker.

Tests: `node --test plan.test.mjs snapshot.test.mjs`. They need Docker for SeaweedFS and skip, reported
as skipped, without it.

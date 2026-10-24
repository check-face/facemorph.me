# Names data shape: measurement, choice and bars (fm-zg31)

`names.spike` measured candidate shapes for the static names picker and chose the smallest that meets the
product's needs. `names.generator` (fm-a40f), `names.publish` (fm-e6yj), `names.picker` (fm-96if) and
`names.static-result` build to the shape and the numeric bars below. `catalogue.json` is not a requirement
(decided 16 October); the candidate's file stays served, unchanged, while the candidate or control artifact
reads it.

## What the product needs

1. The ordered list of selectable names, for the grid's first paint.
2. A grid preview per name, fetched as the grid scrolls (today 5,055 separate 200 px historic JPEGs on the
   `facemorph-seed-gallery` Worker).
3. One validated recovery-bearing result for the picked name: a 1,024 px WebP carrying the exact W+ in the
   candidate's v2 envelope, integrity-checked before use.
4. One small atomic pointer naming the published set: version, model/generation identity, URL scheme and the
   hashes that pin everything else.

Everything else in the candidate's 5,055 per-row records is constant or derivable, and the measurement script
refuses a catalogue where that is not so (`parseCatalogue` in `tools/names-spike/shapes.mjs`): `value` is
`name.toLowerCase()` for every row, `id` is SHA-256(`value`), the latent URL follows from `id`, and
`modelSha256`, `generationSha256`, size, space and shape are one constant each.

## Measured (24 October 2026, eris, Chromium 156)

`tools/names-spike/measure.mjs` against the pinned candidate catalogue (SHA-256 `4a9e1c19…`, live at
next.facemorph.me), its 5,055 published previews and 12 sampled historic faces with their published W+
latents. Full output: [spike-results-2026-10-24.json](spike-results-2026-10-24.json). CI reruns it
(`.github/workflows/names-spike.yml`). Text sizes are brotli quality 5, which matches Cloudflare's live
encoding of the candidate file to about 1% (569,887 B live, 562,977 B local).

**Names and integrity** (first paint = names file + manifest; a pick adds the result object):

| Shape | First paint | First pick | Note |
| --- | ---: | ---: | --- |
| Candidate `catalogue.json` | 1 req, 570 KB | latent fetch + synthesis | 3.4 MB parsed |
| Names text + manifest, envelope-only integrity | 2 req, 17.6 KB | 1 req | no per-name binding |
| … + digest list on first pick | 2 req, 17.7 KB | 2 req, +158 KB | lookup larger than the result |
| … + 64 block shards (chosen) | 2 req, 19.5 KB | 2 req in parallel, +2.5 KB | manifest pins each shard |
| … + digests inline in names file | 2 req, 204 KB | 1 req | 162 KB floor at first paint |

Names as plain text: 35,404 B raw, 17,224 B brotli (a JSON array is 18,313 B). Shard counts 16–256 were
measured; 64 minimises first-paint plus lookup bytes.

**Result object:** WebP q0.8 (the candidate's default) of 12 historic 1,024 px faces plus the exact v2
envelope for each name's real latent (50,046 B): median 121,537 B, range 103,998–134,968 B. names.generator
replaces this estimate with the real figure.

**Previews:** 5,055 files, 36.5 MB, median 7,152 B. Byte-exact packs of 12/24/48 save only per-file
requests (422/211/106 files, same bytes). Re-encoded 24-tile atlases are 4.5% larger (37.3 MB at JPEG q0.85)
and change the pixels (PSNR 41.1 dB, max channel difference 93), so they fail "the grid's look unchanged".

**Asset count** (Workers Free: 20,000 files per version, 25 MiB each): the chosen layout is 5,121 files
(manifest, names, 64 shards, 5,055 results), 10,241 while two result sets coexist during a model change.
Moving the previews beside it as files gives 15,296. Both fit.

**Not measured:** scroll smoothness (long tasks and dropped frames per alternative). The scripted-scroll
harness exists (`--viewports desktop,phone`) but the operator stopped that measurement on 24 October as
low value; packaging is chosen on bytes, requests and look instead.

## Chosen shape

```
names/manifest.json                     the atomic pointer; the only mutable path (short cache)
names/<version>/names.txt               UTF-8, one display name per line, grid order
names/<version>/integrity/<k>.bin       64 block shards: 32-byte result digests, rows 79k .. 79k+78
results/<set>/<id>.webp                 recovery-bearing v2 WebP; <set> = first 16 hex of the result-set digest
previews: unchanged                     the existing 200 px JPEG per name, by id, as today
```

- `value = name.toLowerCase()`, `id = SHA-256(value)`; nothing per row is published except the name and,
  in the shards, its result digest.
- The manifest holds the version, `modelSha256`, `generationSha256`, `latentIdentity`, the URL patterns,
  the names file's SHA-256 and all 64 shard SHA-256s (`shapes.manifest` sketches them).
- A pick knows the name's index from the list, so it requests the result and its shard at once; the
  client checks the shard against the manifest, the result against the shard digest, then the envelope's
  own image/latent hashes and its model/generation identity against the manifest. Any failure is shown,
  never replaced by synthesis.
- Result URLs are immutable: a new result set (model change or re-encode) gets a new `<set>` directory.

## Bars

1. **First grid paint** transfers only the names file (≤ 20 KB brotli; 17.2 KB measured), the manifest
   (≤ 4 KB; 2.8 KB) and previews for tiles in the viewport, which load before any lookahead (1,280×800:
   24 tiles, about 170 KB; 390×844: 10 tiles, about 70 KB). No other request grows with the catalogue.
2. **A pick** is one result fetch (≤ 160 KB) plus at most one shard fetch (≤ 4 KB; 2,528 B), issued
   together, and no model download or inference.
3. **Assets:** steady and transition counts reported by names.publish stay ≤ 20,000 per Worker version
   (5,121 / 10,241 for this layout).
4. **Generator/publication:** every row satisfies the derivation rules above or publication refuses;
   every result carries the manifest's `generationSha256` and `modelSha256`.

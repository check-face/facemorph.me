# Saved file formats and recovery metadata

`@facemorph/stylegan-js` writes and reads the recovery metadata that makes a saved FaceMorph file reopenable:
the exact W+ latent and the identity of the generator that made it. This page lists the formats, what each
one carries and does not carry, its limits, and what happens when a file is damaged or stripped.

Source: `src/media/envelope.ts` (still envelopes), `src/media/recovery-v3.ts` (schema 3 records),
`src/blend/recipe.ts` (blend recipe), `src/media/mp4-project.ts` (MP4 projects), `src/media/inspect-still.ts`
(classification). Nothing in these modules fetches anything, including URLs found in metadata.

## Formats

| Format | Use | Pixels | Recovery metadata |
| --- | --- | --- | --- |
| WebP, quality 0.8 | default saved still | lossy | `FMRP` RIFF chunk after the image |
| PNG | explicit lossless choice; fallback where the browser cannot encode WebP | exact | `tEXt` chunk keyed `FaceMorph`, before `IEND` |
| Lossless WebP (VP8L) | package writer `encodeLosslessWebp` | exact | `FMRP` chunk |
| MP4 (H.264 `avc1.42002A`) | saved morph video | lossy | top-level `uuid` box, user type `FaceMorphProject`, after the movie |

There is no quality setting a person can change. MP4 encoding is unchanged from the candidate: WebCodecs at
1024 × 1024, then 512 × 512, then FFmpeg (libx264 baseline) at 512 × 512; bitrate
`round(size × size × fps × 0.25 / 1000) × 1000`, framerate = fps. `videoFileResult` reports the produced file's
`{width, height, route: 'webcodecs' | 'ffmpeg', reason}` so the app can show the actual resolution.

MP4 help text: "Video; reopening this file as a project is not available in this release." The internal
reader (`readMp4Project`) exists to validate produced files; opening an MP4 as a project is deferred.

## Still schemas

| Schema | Written by | Read | Notes |
| --- | --- | --- | --- |
| 1 (`facemorph-image-v1`) | the classic candidate (`decorateImage`) | yes, PNG only | latent as a JSON number array; no generator shape |
| 2 (`facemorph-image-v2`) | classic candidate; `embedRecovery` | yes, PNG and WebP | float32-le-base64 latent with its own `[layers, width]` |
| 3 (`facemorph-image-v3`) | `embedRecoveryV3`, `encodePng`/`encodeLosslessWebp` given a descriptor | yes, PNG and WebP | adds the generator record and blends |

Any other `schema` value is the typed result `incompatible-schema` with the version the file claims. The file
stays viewable and its bytes are handed over unchanged by Save/Share.

Schema 3 records, from the model descriptor:

- `model`: `name`, `architecture`, `subject` (`face` or `non-face`), `modelSha256`, `noiseSha256`, the W+ shape
  `latent: {space: 'w-plus', layers, width}` and the full output frame `output: {width, height}`;
- `latent`: `space`, `shape` (must equal the model record's), `encoding: 'float32-le-base64'`, `data`;
- `generationKind` (`seed`, `photo`, `latent` or `blend`), `generationSha256`, optional `seed` (seed stills
  only), `provenance` (the listed provenance keys only; model and noise digests must equal the model record);
- `width`, `height`, `mime` (must equal the container), `imageSha256` (the image bytes without the envelope)
  and `latentSha256` (the raw float32 bytes).

A saved still is always the model's full output frame (1024 × 1024 for FFHQ, 512 × 512 for AFHQ cat).

### Model identity and combination

A latent belongs to one checkpoint (model and noise digests). `inspectStill` returns `matching` only for the
loaded checkpoint and, when the caller passes the descriptor's W+ shape, only for that shape. A latent from
another known checkpoint is `incompatible-model` even when its shape is equal; one from an unknown checkpoint is
`unknown-model`. Neither exposes the latent, so no editable inference runs on it; the image stays viewable.
`checkCombinable(descriptor, inputs)` refuses mixed checkpoints (`mixed-model`) and wrong shapes
(`shape-mismatch`) before a morph or blend.

### Blend recipe

A saved blend (`generationKind: 'blend'`) carries the blended W+ latent and `blend: {kind: 'blend-v1', slots}`,
each slot `{kind: 'word' | 'seed' | 'name' | 'photo', latentSha256, weight}` with the weight as used (clamped to
[-2, 2]). Typed words, seed numbers and file names are never embedded. `generationSha256` is the recipe digest
(SHA-256 of the model digest and each slot's latent digest and weight; equal to `blend()`'s `cacheKey`), so an
edited recipe fails as `integrity`. `blendExportInputs(recipe)` gives the export identity's ordered inputs and
the label `blend-<n>-faces` (filename e.g. `blend-3-faces-k4p7s2.webp`); blends that differ in any weight get
different identities. `recipeSlotsFor(recipe, latent)` finds slots whose latent digest matches, to restore their
weights. A blend is an ordinary face: same full frame, WebP 0.8 default or PNG.

## MP4 projects

| Schema | Written by | Read | Notes |
| --- | --- | --- | --- |
| 1 | classic candidate (`decorateVideo`) | yes | `project-v1.fixture.json` shape; latents as number arrays; no integrity hash; `text` is returned for the app's project codec |
| 2 (`facemorph-project-v2`) | `embedMp4Project` | yes | generator record, controls as float32-le-base64 with SHA-256, `video: {width, height, frameCount, route, reason}`, `videoSha256` |

Schema 2 keeps the ordered controls (`visitId`, latent) and the morph settings (`algorithmVersion`, `kind`,
`closed`, `width`, `pinchCenter`, `framesPerSegment`, `framesPerSecond`), plus `bundle`, `truncationPsi` and
`truncationCutoff`. The reader checks the recorded size and frame count against the movie's video track
(`stsd` sample entry and `stsz` sample count) and `videoSha256` against the MP4 bytes without the project box.

## Limits

| Limit | Value |
| --- | --- |
| Still file | 64 MiB |
| Any still envelope before its schema is known | 512 KiB |
| Schema 2 metadata | 128 KiB |
| Schema 3 metadata | 384 KiB |
| Latent values | 24,576 (W+ 18 × 512 is 9,216) |
| W+ layers / width | 64 / 4,096 |
| Image edge | 16,384 px |
| Blend recipe slots | 1,024 |
| MP4 file | 512 MiB |
| MP4 project payload | 16 MiB |
| MP4 boxes | 10,000 top-level or per container |
| Morph controls | 2 to 64 |
| Morph frames | 4,096 |

Sizes measured in Chromium 156 (test/browser/mp4-project-browsers.mjs): a 1024 × 1024 lossy WebP 0.8 test
image of 6,592 bytes plus a 50,124-byte schema-3 envelope (18 × 512 latent); a 2-control 32-frame 512 × 512
MP4 adds a 99.6 KB schema-2 project box. Real faces have larger image payloads (about 10⁵ bytes for WebP).

## Corruption behaviour

Every reader returns a typed result and never throws on bad input:

- `missing`: no FaceMorph metadata (also every non-PNG/WebP/MP4 file);
- `damaged` with a reason: `file-too-large`, `container` (malformed PNG/WebP/MP4), `truncated` (an MP4 box runs
  past the end), `checksum` (PNG chunk CRC), `duplicate-metadata`, `metadata-too-large`, `unreadable-json`,
  `invalid-fields`, `dimensions`, `video-mismatch`, `integrity` (a hash does not match this file's own payload);
- `incompatible-schema` with the claimed version;
- `parsed` with the values.

Writers regenerate the envelope over the actual payload on every save and never copy an old hash: a recovery
chunk or project box copied onto other pixels or another movie fails as `integrity`. A file whose existing
envelope is damaged is refused rather than silently re-labelled.

## Receiving apps that strip metadata

Messaging apps, photo libraries and social sites often re-encode images or video and drop unknown chunks and
boxes. The re-encoded copy is still a normal picture or video but reads as `missing`; FaceMorph cannot recover
its latent from the pixels and never infers one when valid metadata exists. Keep the untouched saved file (or
share it as a file, not as a photo) as the recovery source.

## Lossy compatibility policy

Saved stills are WebP 0.8 by default, PNG when lossless is chosen or WebP cannot be encoded; MP4 settings are
unchanged; there is no quality slider. Lossy pixels need no exact parity between builds or browsers: checks are
dimensions, upright orientation, valid decode or playback to the last frame with the expected frame count, and
practical visual quality under the retained quality policy (`autoresearch/reviews/2026-10-10/quality-policy.md`).
Model, latent and provenance values are always exact, and lossless writers preserve pixels exactly.

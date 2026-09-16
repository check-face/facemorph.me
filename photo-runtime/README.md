# Browser-local photo preprocessing and bounded e4e candidate

`align-photo.mjs` now executes the original dlib 68-point detector/predictor,
FFHQ crop/pad geometry, Pillow resampling and e4e normalization in a disposable
browser Worker. It does not call a photo preparation server. No replacement
landmark model or prealigned-upload assumption is used.

The first exact qualification is `evidence/verification.json`: 14 cases passed using the
actual unshared WebAssembly artifact in Node. Both synthetic seed photos,
1280-pixel shrinking, edge padding, JPEG, transparent PNG and no-face fallback
were tested aligned and unaligned. All detector landmarks, all 196,608 RGB
bytes and every normalized tensor hash matched independent controls produced
by the unchanged original Python preprocessing. This is preprocessing evidence;
it does not qualify browser execution, e4e encoding or a physical phone.

The initial IJG9f JPEG decoder failed this comparison. The artifact instead
uses libjpeg-turbo 3.1.4.1, matching the independent Pillow installation. That
change made both JPEG cases exact without changing acceptance thresholds.

## Integration

```js
import {createPhotoAligner} from '/runtime/photo/align-photo.mjs';
const alignPhoto = createPhotoAligner({manifestUrl:'/runtime/photo/manifest.json'});
const prepared = await alignPhoto(blob, {signal, onProgress, tryAlign:true});
// prepared.tensor: Float32Array, NCHW [1,3,256,256]
// prepared.provenance.preprocessingSha256 identifies the complete preprocessing.
```

The caller must terminate its synthesis Worker before calling this function.
The aligner terminates its own Worker before resolving, rejecting or cancelling.
Only then may an encoder Worker start; it must terminate before synthesis starts
again. Releasing an ONNX session does not shrink a WebAssembly heap.

Run `stage.py --out <local directory> --runtime-manifest <main manifest>` to
copy a checksummed bundle. Set the main manifest's `alignmentSha256` to the
returned preprocessing identity **before** constructing photo cache keys.
Staging does not mark the runtime qualified.

Input admission currently accepts 8-bit PNG and grayscale/RGB JPEG, up to
25 MiB encoded and four megapixels. Oversized or unsupported images fail
recoverably before native decode. EXIF orientation is deliberately ignored,
matching the original path; it is reported in provenance. Hidden RGB values
in transparent PNG pixels are preserved as Pillow's RGB conversion does.
Product calls reject zero or multiple detected faces before any encoder allocation. The explicit diagnostic option `requireSingleFace:false` retains the historical largest-face/no-face behavior solely for numerical controls.

The original 99,693,937-byte landmark asset is streamed directly into WASM,
verified incrementally, and optionally cached in OPFS by SHA-256. A failed or
partial cache entry is removed. No explicit stream `releaseLock` or awaited
error cancellation is used, avoiding the documented Simulator WebKit reader/GC
deadlock. Private image bytes and derived tensors remain in the browser.

## Memory and remaining qualification

The native heap starts at 32 MiB and has a hard 256 MiB maximum. The completed
14-case Node run reached 211,812,352 bytes of WASM capacity; the two 512-pixel
seed cases initially needed 176,488,448 bytes. This is **not total browser RSS**.
Decoded image storage, encoded Blob/JS bytes, response chunks, compiled runtime,
browser/driver overhead and garbage awaiting collection still need actual
browser measurement. Each product alignment call gets a fresh Worker rather
than retaining the largest previous heap.

`test-wrapper.mjs` checks header admission and Worker teardown after success,
abort, stall and malformed results. `verify-local.py`, run through the shared
`autoresearch/run.py --device local-mac` lease, builds the real artifact and
runs the independent numerical comparisons. Run `make-fixtures.py` using
`hf-trial/.venv/bin/python`.

Actual browser and Simulator checks must verify module loading, streaming
cache miss/hit, exact reference tensors, cancellation/retry and Worker teardown.
Full photo acceptance additionally requires unchanged e4e W+ error ≤0.0001,
1024 reconstruction, original cache reuse, repeated use, recovery and physical
device coverage. The completed Simulator subset is documented below. None of these follows from a preprocessing-only pass.

## Streamed encoder work

`encoder-stream/export.py` partitions the existing FP32 e4e ONNX graph into
small sequential graphs while preserving every original node and initializer.
All crossing values retain explicit dtype and shape; values may be INT64,
INT32 or BOOL as well as FLOAT. One live ORT session is permitted. Boundary
tensors remain until their declared final consumer. No quantization, alternate
landmarks, extra latent average, mapping or truncation is introduced.

The original 1,068,862,265-byte encoder cannot be admitted on phones merely
because alignment works. The exported partition target is 16 MiB of initializers
per graph; an indivisible oversized operator is reported. Total download remains
about one gigabyte. Export metadata is only an allocation schedule, and session
release alone does not demonstrate bounded heap capacity. `encoder-stream/verify.py`
compares the candidate against independent original PyTorch W+ and historic
aligned controls. Actual browser heap and W+ gates are still mandatory before
phone admission.

## Provenance

- Original dlib20.0.1 source and predictor; source receipt in `vendor/dlib-source.json`.
- Unmodified Pillow12.3.0 `Geometry.c` and `Resample.c`, with a small RGB-only
  allocation support layer; receipt in `vendor/pillow-source.json`.
- libjpeg-turbo3.1.4.1 scalar decoder, receipt in `vendor/jpeg-source.json`.
- SciPy1.18.1 symmetric Gaussian arithmetic port and original e4e alignment geometry.
- Emscripten4.0.23, unshared WASM, `-ffp-contract=off` for the alignment code.

See `THIRD_PARTY_NOTICES.txt`. Code licenses and landmark/model distribution
provenance remain separate concerns; possession of a model is not a new license.

## Completed streamed-encoder measurements

The unchanged graph export contains108 shards and all1,723 source nodes. The
largest file is16,682,645 bytes; the declared maximum simultaneous boundary
storage is12,664,832 bytes. Total model bytes remain1,068,886,382.

Independent native ORT qualification passed both seed photos aligned and
unaligned plus the no-face fallback. The original aligned PyTorch controls
matched historic W+ exactly. Native shard maximum W+ error was2.81334e-5.

The actual browser ORT Web1.24.3 unshared binary is capped at256MiB by changing
only its internal WASM memory-section maximum (65,536→4,096 pages; initial256
pages retained). No code, data, operator or arithmetic section is rewritten.
`stage.py` records original/patched hashes and copies the original licenses.
Node execution of this real WASM passed all five W+ cases, worst2.83718e-5.
One runtime reused across five calls grew from98,435,072 to118,161,408 bytes.

The actual desktop Chromium browser then passed all five original-photo
controls using a fresh alignment Worker and fresh encoder Worker per photo.
Report: `evidence/desktop-browser-five-photos.json`,
run `f2f32aa2-dea8-4bb7-b2d7-40111a6e5ff2`. Every prepared tensor was exact,
worst W+ error2.83718e-5, each encoder heap98,435,072 bytes, one live session,
and both Worker termination boundaries were checked. Landmark OPFS write and
subsequent cache-hit paths worked. The first verified Blob-module import exposed
an Emscripten relative-URL issue; explicit `locateFile` fixed it before this pass.

Encoder wall time was20.8–24.8 seconds:15.5–19.1 seconds in verified asset
acquisition,0.74–0.78 seconds creating sessions, and4.14–4.39 seconds running
inference. These are functional test timings with focus emulation, not clean
performance benchmarks. The next speed investigation should remove redundant
bounded-shard cache reads/hash overhead while retaining integrity, before
rewriting encoder arithmetic. No physical iPhone performance is claimed.

The desktop result above used preprocessing identity `236a343ae5d8d824c3703fb5c0da88a89625aea5944abbd7fd6e017881906b07`. The current strict single-face + chunk transport identity is `3cc958b232e8616db831b8429eea4446c990a845738320270b47121a2d2dbdfe`; its additional Simulator/transport tests are recorded separately.
The completed Simulator and full reconstruction/cache evidence is below. Physical
phone coverage remains a separate gate; a friends-and-family candidate admission
is not full release qualification.


## Repository delivery and rebuilding

This directory contains the deliverable source and numerical evidence. No
TrueNAS service, Hugging Face endpoint, user account or photo upload is required.
The historical `experiment/hf` directory is local model/source provenance only.
The product uses the repository's static immutable asset bundle and disposable
browser workers.

`python3 photo-runtime/bootstrap.py` obtains checksummed upstream C/C++ sources
and Emscripten4.0.23 at the pinned SDK commit. `python3 photo-runtime/build.py`
rebuilds the small unshared alignment artifact. Use the shared local build lease
when operating inside the migration workspace. Toolchains and extracted vendor
build trees are ignored; compiled WASM/glue, receipts and license notices are
included. The original predictor is an external checksummed model asset, not a
newly licensed or substituted model.

The immutable landmark asset may be transported as `chunks:[{url,size,sha256}]`.
Each chunk is at most16MiB, fetched sequentially directly into the preallocated
native serialized-model buffer. Every chunk hash and the original complete
model hash must pass before dlib deserialization. OPFS still stores the original
full asset by its original hash. `test-chunks.mjs` covers integrity, bounds and
failure cleanup with deliberately non-resolving cancellation.

The encoder exporter accepts `--source` for the original1.069GB ONNX file. Only
its lightweight graph schedule is tracked here; generated `.onnx` shard files
and build intermediates are ignored. The exported weights ship through the
normal static asset bundle. `encoder-stream/stage.py` packages the capped runtime,
source checksums, shards, executor and independent W+ controls. The main manifest
must pin the resulting descriptor and its matching preprocessing identity.


## Actual iPhone Simulator photo gate (16 September 2026)

The dedicated iPhone 18 Pro Max/iOS 27.0 Simulator passed the browser-local
photo workflow in Safari. This is the actual Simulator WebKit process, with
`navigator.platform=iPhone`, a simctl launch receipt and screenshot. It is not
physical-device performance evidence. See
`evidence/sim-photo-927e4446-d5db-49aa-9d6e-b9dcc6d20204/report.json`
(run `f44c1007-203f-4059-8c92-a734a45fb1da`).

- The default policy rejected the no-face fixture (count 0) and two-face fixture
  (count 2) before e4e ran.
- All five independent raw numerical controls produced exact prepared tensors;
  maximum W+ error was 2.83718e-5 against the unchanged 0.0001 threshold. The
  explicit legacy diagnostic switch permits the no-face arithmetic control;
  the product continues to reject that input.
- Each disposable encoder worker reached 98,435,072 bytes of actual WASM capacity
  with a hard 256 MiB cap and at most one live ORT session. Boundary storage peaked
  at 12,664,832 bytes. The conservative enumerated estimate was 220,057,237 bytes,
  including one shard, runtime assets and a 64 MiB overhead reserve; this is not RSS.
- A fresh `encodePhoto` result went through strict alignment, real streamed e4e
  and WebGL synthesis to 1024×1024. Every RGB channel was within one level of the
  independent original-PyTorch reconstruction. Repetition reused the original,
  and a fresh CPU-selected runtime returned that same cached result with no new
  inference worker or alignment call.

The raw encoder wall times were 32.5–41.8 seconds. Verified shard acquisition
accounted for 26.5–34.4 seconds, session creation for 0.71–1.04 seconds and actual
inference for 4.12–5.23 seconds. These functional run timings include cache/hash
and browser overhead; they do not establish a physical iPhone speedup. The product
flow also included synthesis admission canaries and took 71.1 seconds in this run.

The six-chunk landmark network path was then tested separately on a fresh local
origin, without deleting any existing cache. It passed in the actual Simulator:
`evidence/sim-chunks-e13968df-775d-4744-8b5c-eb78e484aabf/report.json`.
The loader consumed all 99,693,937 bytes through six individually verified chunks,
verified the complete original checksum, wrote OPFS, used reads of at most 1 MiB,
and produced the exact same aligned tensor. WASM capacity was 176,488,448 bytes;
alignment worker termination was checked. No encoder or synthesis ran in that
transport test.

`evidence/qualified-photo-manifest.json` and
`evidence/qualified-encoder-stream-manifest.json` record the tested immutable
identities. Paths in those evidence receipts are historical local-test URLs.
The repository's portable build recipe may generate a new source identity even
when its C/C++ kernels are unchanged; do not relabel a rebuilt artifact as the
older tested bundle.

## Device admission and canonical originals

The shipping runtime now checks a pinned synthetic prepared tensor through the
actual capped encoder before the first uncached user photo. A W+ mismatch,
nonfinite output, invalid fixture or missing qualification receipt stops before
user encoding/synthesis. The exact encoder manifest SHA identifies admission;
that admission is retained only in the current runtime instance and is cleared
on disposal. This adds one encoder pass to the first uncached photo. Later photo
calls retain disposable workers and the hard WASM cap. Cached originals are
returned before any model admission or worker allocation.

Seed/photo originals now also receive a small W+ cache alias in the same IndexedDB
transaction. It references the canonical PNG/latent record and its checksums,
so reopening a saved W+ project does not duplicate the PNG or regenerate the face.
The original provider/provenance remains attached to the reused image.
`src/Next/browser/runtime.test.mjs` covers seed→new-runtime latent reuse with no
new worker; `test-runtime-admission.mjs` covers remembered and rejected encoder
receipts. Real Simulator preflight/alias regression evidence is recorded separately.


The final actual-Simulator regression also passed after adding encoder admission
and the W+ alias. See
`evidence/sim-photo-7cc2bb9a-81e7-445a-9aeb-655f60658ffa/report.json`
(run `f631143a-5cf9-4212-80f0-33f246dd6335`). The first-use encoder canary
matched within 2.563e-6; only then did the actual photo encode. With both passes
in the disposable worker, actual WASM capacity reached 118,161,408 bytes under
the same 256 MiB hard cap. Enumerated managed peak estimate was 239,783,573 bytes
including the reserve, still not process RSS. The 1024 reconstruction retained
RGB maximum error 1. Repeat-photo, fresh-runtime photo and reopened-W+ cache
lookups all passed without new inference workers. Strict no-face/two-face
rejections were repeated. Only a standard ancillary PNG text field was added
to the synthetic source to ensure a fresh cache identity; original pixel chunks
were retained unchanged.

The first-use canary took 29.9 seconds in this functional Simulator run. Total
product qualification/photo/cache work took 101.5 seconds, including synthesis
canaries and the new encoder check. After it, the actual user-photo encoder took
25.3 seconds in verified acquisition, 0.54 seconds creating sessions and 4.62
seconds executing inference. These timings argue for a future bounded asset
acquisition optimization; they are not advertised phone performance.

This evidence supports allowing an explicitly experimental friends-and-family
phone route guarded by on-device checks and recoverable errors. It does not
make the release qualified, test a physical iPhone, expand admitted image formats,
or establish photo-to-MP4 performance. Shipping source identities for this final
run are in `evidence/final-source-receipt.json`.

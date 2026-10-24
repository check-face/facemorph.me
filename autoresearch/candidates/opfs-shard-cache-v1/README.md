# opfs-shard-cache-v1 — eris iteration 5 (8 October 2026)

**Hypothesis.** A warm visit (every model already on the device) spends most of its model-loading time proving the
stored bytes are intact, not loading them. On eris the 150 MiB WebGPU prefix took ~1.7 s of a 2.46 s `model-loaded`
(lease run `ar3/lease1`). That time is spent in the pure-JS SHA-256 in `model-cache.mjs` `openVerified`, about 6 ms per MiB,
plus a second full Cache Storage read. Since 19 September the "verified" mark is in memory only, so this repeats on
every visit, and on the first photo of every session for the ~1 GiB streamed encoder.

Store each pinned unit (a manifest chunk, or a small unchunked asset) as its own file in the Origin Private File System,
committed by a trailer written after its payload. Digest every unit on every read with the platform SHA-256 against
its manifest pin. That should cut the integrity cost to tens of milliseconds without any durable marker: nothing
vouches for bytes except a hash of those bytes taken when they are handed out. Corruption, truncation, uncommitted
writes and eviction then cost one 16 MiB unit's re-fetch instead of the whole asset.

**Candidate.** Product source on `candidate/next-delivery-20260916` (working tree):

| File | SHA-256 at first measurement |
|---|---|
| `src/Next/Assets/shard-store.mjs` (new) | 979c60d33954624e046962a20810cf459676c6ce0b674b7fb31d37fd83b02f20 (05b81127… before the exact-length fix below) |
| `src/Next/Assets/model-cache.mjs` | 6ea2bcd038cb911a6fb568fdd9845bd621c11d93613e09ee8642abf2c1b89b45 |
| `src/Next/browser/ort-worker.mjs` (`handle.bytes()`) | 2f7f88489ae0fa9d8d8b35928f81b6d18849724aea4dc5b3dc507f85dba92710 (rebased on ea8450b) |
| `src/Next/video-worker.mjs` (`handle.bytes()`) | bec91cdc08c64f1da9259cbc1fb75d7ba5aaec7cf905d90aa11f93a352d71614 |
| `src/Next/model-inventory.mjs` (descriptors, not bare hashes) | e4cfb13262d8d0f35a870176084f55b55db24b40e88e8ecdf6165a852f9483f7 |

Control is a worktree at `~/Work/runs/ar5/control-tree`. The first series used `de32bc3`; the kept series uses `ea8450b`, the direct WebGPU engine that landed mid-experiment, with the candidate rebased onto it in `~/Work/runs/ar5/cand-tree`.

Behaviour:
- Without OPFS (Firefox private windows, old engines, Tauri origins, refused writes), or with an unchunked asset above
  64 MiB, it falls back to the existing Cache Storage path unchanged.
- Bytes already in Cache Storage move into OPFS on first acquisition without a download. Each unit is checked on the
  way, and the old entry is then removed, so the model is never stored twice.
- The whole-asset digest is not recomputed. The chunk list and the whole digest come from the same pinned manifest,
  so every byte is already bound to it through its chunk.

**Measurement.** The bench (`run-product.sh` and `product.mjs`, copied from `morph-frame-pipeline-v1` and extended)
runs a fresh Chromium session over a warm private profile (`~/Work/runs/ar5/chrome-product`). Inputs are fixed and
originals are cleared, so every face and photo is computed and comparable across trees. Each run records:
- `qualify` (full qualification forced, 7 canaries): time to `model-loaded` and to first synthesis;
- 3 faces, plus 2 photo encodes (the first pays the encoder's acquisition);
- the storage state and the forwarded cache-trouble statuses.

Then: corruption injection (a flipped payload byte under an intact trailer, a cut-short write, a deleted unit), and a
re-qualify. ABBA x4 under the `browser-gpu` lease. Gates: 7/7 canaries, the encoder reference check, and
face/photo output digests identical to control.

## Result

**Keep.** On a warm visit, the model is ready 2.2-2.6x sooner and the first face comes 0.8 s sooner. The first photo of
a session is ~5.5 s faster. Outputs are byte-identical and no network bytes are used.

Kept series: `ea8450b` control vs rebased candidate, ABBA x4 under the `browser-gpu` lease, fresh browser session per run, warm
storage (evidence in `../../artifacts/opfs-shard-cache-v1/r*`).

| Metric (ms) | Control A (r1, r4, r5, r8) | Candidate B (r2, r3, r6, r7) |
|---|---|---|
| `model-loaded` (direct engine) | 1423, 1490, 1433, 1427 (median 1430) | 551, 598, 871, 681 (median 640) |
| qualify start -> first synthesis | 1671, 1751, 1698, 1670 (median 1685) | 776, 795, 1149, 922 (median 859) |
| first photo of the session (encode + face) | 17448, 17805, 18214, 17378 (median 17627) | 11742, 11802, 14795, 12383 (median 12093) |
| second photo | 9047, 9496, 11162, 9439 | 9444, 9867, 10272, 11134 (no change expected: the session has already verified) |
| warm faces | 78-122 | 82-160 (no change expected) |

- **Correctness.** All 10 sessions in the series pass 7/7 canaries. The fixed-input faces (`eecd18`/`c1bcb8`/`9188b7`)
  and the encoder latents (`51c66c`/`b80eec`) are identical in every A and B run. The encoder reference check passes.
  Network bytes are 0 in every warm run, with no forwarded cache trouble.
- **Load.** Pairs 1-2 ran at load 1.6-3.0. Pairs 3-4 ran at 6.4-7.1 (another session's headless Chromium); B is still
  faster there, but those B values are the slow ones. The first series (`de32bc3` base, `ab*`) ran at load 7-18; its
  direction agrees and it is not used for the numbers.
- **Migration.** The first candidate session on a profile filled by the old backend (`warm-B2`) moved 175 units
  (1.31 GB) from Cache Storage into OPFS with 0 network bytes and left 0 Cache Storage model entries. That session's
  `model-loaded` was already 1340 ms, against 2.5-4.2 s for control on the same base.
- **Bug found on the way.** The first candidate session failed canary `frame-00` (`warm-B`). For single-unit assets, `read()`
  returned a subarray of a buffer that still held the 48-byte trailer, and consumers that build typed arrays over
  `.buffer` read the trailer as weights. The fix reads the payload and trailer separately, so the payload is an
  exact-length buffer. Every later session passes.

**Storage suite across engines** (`xbrowser/`, run under the lease; real `model-cache.mjs` and `shard-store.mjs`, no
inference). Steps:
- one file per unit;
- a no-network later session;
- a flipped byte under an intact trailer, a cut-short write and a deleted unit, each repaired by refetching exactly
  those 3 units;
- the repaired units stay hits;
- migration from Cache Storage drops the old entry;
- a 160 MiB round trip.

| Engine | Worker | Main thread | 160 MiB read + verify | Old JS SHA-256 of the same bytes |
|---|---|---|---|---|
| Chromium 152 | OPFS, all pass | OPFS, all pass | 337-403 ms | 1114-1907 ms |
| Firefox 141 (Playwright build) | OPFS, all pass | OPFS, all pass | 213-243 ms | 3672-3680 ms |
| WebKit 26 (Playwright Linux build) | fell back to Cache Storage | fell back to Cache Storage | — | — |

Playwright's Linux WebKit does not expose `navigator.storage` at all, so this does **not** test Safari's OPFS. Safari
15.2+ ships it. It only shows that the fallback engages cleanly.

**Not established.**
- Safari, macOS and iOS (needs the iOS simulator or macOS lane).
- Android Chrome on a phone.
- The real-device read and verify cost on phones.
- Quota behaviour when OPFS is near full.
- Two tabs repairing the same unit at once (Web Locks serialise it in code; not exercised).
- Inventory sizing for the direct engine, which reads `manifest.webgl` (checkface-78 will align `model-inventory.mjs`).

The remaining ~600 ms of `model-loaded` is the direct engine's own setup plus reading and verifying 124 MB. Eager loading on
capable desktops, the next step, hides it.

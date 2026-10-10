# Round journal — 10 October 2026

Append-only from creation. Existing earlier observations remain in their frozen
reports and the evaluation ledger; the initialization entries below summarize
them without reconstructing a fictional earlier event stream. Corrections append
a new entry with the superseded ID. Follow [record standards](../../records.md).

### 2026-10-10T05:50:00Z — review-20261010-001

- Phase / status: observed / coverage incomplete; no paired performance decision
- Round / experiment / correction: 2026-10-10 / reporting coverage / not_applicable
- Hypothesis / decision: recent actual reports must support current latency claims; no matched photo or ordinary-policy warm-hydration control found
- Identity: source `b322a26858275f0e361127836d0fd1854e868ef9`; app `6f67e921bae679214856`; diagnostic build `next-2ff6791800ad7dbf`; runtime manifest SHA-256 in [round README](README.md)
- Context: R2 query at 05:31:09 UTC; receipts since 8 October 00:00 UTC through 9 October 05:07:53 UTC; 303 listed objects, 78 selected, 48 run IDs; only one matching-build macOS Chromium 151 morph/auto run; hardware/workload/cache unknown; no controlled order/load
- Boundary / samples: diagnostic job completion, n=1, 13,168 ms; model-loaded stage events 465/824 ms; not decoded/paint/playable output; paired control/candidate not_measured
- Correctness / workflow: user job reported completed; full31 and exact current user journey not established by reporting
- Resources / failures: peak memory/storage not_measured; R2-only, excludes KV/GA4; three starts absent in window; duplicate terminal events exist in other cohorts, no failure rate inferred
- Evidence: [aggregate JSON](reporting-coverage.json), [collector](reporting-coverage.py), [round analysis](README.md); private raw reports retain existing expiry
- Conclusion / next action: freeze qualified UI revision, instrument/match ordinary-policy warm hydration and photo journeys; automated eris observations remain separate diagnostic evidence

### 2026-10-10T05:50:01Z — review-20261010-002

- Phase / status: proposed / operator-added direct-RGBA experiment
- Round / experiment / correction: 2026-10-10 / R03 and R04 / not_applicable
- Hypothesis / decision: bypass per-frame PNG encode/decode for display/video; encode downloadable/cacheable PNG or lossless WebP in a bounded worker and embed recovery metadata there
- Identity: control/candidate source and artifact hashes pending qualified UI freeze; inspected runtime/frame/media source is concurrent work, not a measured control
- Context: target available desktop browser lanes first; exact GPU/browser/route recorded at run time; 1024 output, identical single/photo/morph workloads; actual WebCodecs/FFmpeg lane and cache state separate; ABBA ≥3/side planned
- Boundary / samples: request → visible frame, playable video, file-ready/save handoff and cache commit separately; control/candidate not_measured
- Correctness / workflow: existing synthesis gates plus pixel/color/alpha/order, sparse scrub, cancellation/revisions, immediate Download/Share, cached restoration and metadata recovery; all candidate gates pending
- Resources / failures: 4 MiB/raw1024 frame; bounded queues/explicit ownership required; worker/copy contention, quota, interrupted persistence, encoding failure and user-activation risks to measure
- Evidence: operator instruction this session; [R03/R04 specification](experiments.md); [handoff](next-pass.md); agent-mail message 14 to BlueHarbor
- Conclusion / next action: coordinate interfaces after UI freeze, isolate direct delivery using background PNG first, then pair encoding choice; no format switch or speed claim yet

### 2026-10-10T05:50:02Z — review-20261010-003

- Phase / status: implemented / documentation split and prospective record format
- Round / experiment / correction: 2026-10-10 / documentation / not_applicable
- Hypothesis / decision: historical timings must stay separate from active evidence/queue; standardize new records without rewriting legacy outcome rows
- Identity: documentation working revision; commit identity pending; no application/artifact/model changes by this event
- Context: documentation only; device/engine/cache/network/order/load not_applicable
- Boundary / samples: not_applicable; no experiment timings collected for cleanup
- Correctness / workflow: history/current split, Luna coherence reviews and local-link/TSV preservation checks required before publication
- Resources / failures: not_applicable; legacy mixed timing/prose cells retained, no uniform numeric schema claimed
- Evidence: [history README](../../history/performance-through-2026-10-09/README.md), [round registry](../README.md), [record standards](../../records.md), [templates](../../templates/round.md)
- Conclusion / next action: complete coherence and integrity checks, commit only research-owned changes and publish; no benchmark row or product deployment implied

### 2026-10-10T05:53:22Z — review-20261010-004

- Phase / status: implemented / development source committed; artifact/live verification pending
- Round / experiment / correction: 2026-10-10 / UI integration / freshness update to review-20261010-003 context, no timing correction
- Hypothesis / decision: record product-source progress separately from the old deployed snapshot
- Identity: development commit `f506892`; live HTML recheck still `app.6f67e921bae679214856.js`, matching snapshot `b322a26`; new promoted build unknown
- Context: source/live identity observation only; timing device/cache/network/order/load not_applicable
- Boundary / samples: not_measured; no new performance samples
- Correctness / workflow: source commit includes queue/restore/recovery changes; research has not qualified its artifact or frozen its measurement control
- Resources / failures: not_measured; application deployment status not inferred from commit
- Evidence: [development commit](https://github.com/check-face/facemorph.me/commit/f506892), [handoff](next-pass.md); Luna final pass found coherent history/current separation and requested this freshness event
- Conclusion / next action: obtain development qualification/live receipt; retain old snapshot claims until bytes are verified

### 2026-10-10T05:53:23Z — review-20261010-005

- Phase / status: proposed / operator clarification: practical video quality
- Round / experiment / correction: 2026-10-10 / R03-R04 / clarifies review-20261010-002 video acceptance
- Hypothesis / decision: faster video encoder settings may be worthwhile; exact pixel parity is not required for lossy video
- Identity: candidate/control pending freeze; no source change
- Context: same dimensions/frame schedule/FPS/codec for matched comparison; bitrate/CRF/latency setting changes explicitly recorded; device/cache/network/order/load pending run
- Boundary / samples: playable MP4 and encoder speed/bytes; control/candidate not_measured
- Correctness / workflow: correct order/duration/playback, normal-size visual spot-check for obvious corruption, distracting color changes or unacceptable artifacts; no new strict numeric video threshold; lossless face-image and latent/synthesis gates separate
- Resources / failures: quality/size tradeoffs to report; not_measured
- Evidence: operator clarification this session; [experiment gates](experiments.md)
- Conclusion / next action: include faster WebCodecs/FFmpeg settings as measured candidates with practical video acceptance

### 2026-10-10T05:55:14Z — review-20261010-006

- Phase / status: proposed / operator quality ruling recorded
- Round / experiment / correction: 2026-10-10 / R03-R04 / supersedes lossless-download assumption in review-20261010-002 and review-20261010-005; no historical timing correction
- Hypothesis / decision: face downloads may be lossy; video exact parity is unnecessary. Operator: “They don't have to be lossless. make the OOM close to what we deliver over the api.” Interpret OOM as delivered file-size order of magnitude and API-like visual quality, not an out-of-memory allowance.
- Identity: API reference `hello` WebP SHA-256 `0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615`; candidate/control freeze pending
- Context: measured reference is 1024 WebP, 92,624 bytes; one image, not a universal payload ceiling. Retained API source uses Pillow WEBP save defaults; deployed library/default settings unknown. Initial browser quality 0.8 is a candidate, not claimed API parity.
- Boundary / samples: no new encoding samples; report encode/display/file-ready/cache timing plus image/metadata/total bytes separately
- Correctness / workflow: practical visual acceptance for lossy images/video, no exact compressed-pixel parity; latent/raw synthesis checks and metadata integrity/re-import unchanged; any lossy cache format needs explicit identity/version/migration
- Resources / failures: target API-like size scale, roughly 10^5-byte image payload where practical; metadata can add size, preserve recovery; original raw-memory budgets unchanged
- Evidence: [quality policy](quality-policy.md), [API observations](api-hello.json), [hello provenance](../../../hosting/gallery/hello-provenance.md), [updated experiments](experiments.md)
- Conclusion / next action: try lossy WebP first against background PNG, choose fastest acceptable output with metadata; visual/size tradeoffs are permitted and must be reported

### 2026-10-10T05:58:00Z — review-20261010-007

- Phase / status: proposed / development confirms RGBA experiment compatibility; control freeze pending
- Round / experiment / correction: 2026-10-10 / R03 / not_applicable
- Hypothesis / decision: direct RGBA/deferred encoding fits the UI increment provided sparse availability retains canonical indices and video receives presentation order
- Identity: provisional development source `f506892`; qualified artifact/live build pending; research documentation published as `e5b04bc`
- Context: agent-mail message 15 from BlueHarbor; local 270 component tests/build/compiled controls and Android emulator controls reported by development, not physical inference qualification or research timing
- Boundary / samples: control/candidate not_measured; no codec or ordinary-policy latency claim
- Correctness / workflow: keep bounded memory, source privacy, immediate save/recovery/cancellation and canonical-order gates; exact-artifact CI/live identity still required before freeze
- Resources / failures: not_measured; GA access/registration reported in progress, receipt/performance unverified
- Evidence: [UI source commit](https://github.com/check-face/facemorph.me/commit/f506892), [handoff](next-pass.md), message 15 in UI/research thread
- Conclusion / next action: preserve proposed experiment contract; obtain qualified/promoted identity and recent matching analytics before controlled measurement

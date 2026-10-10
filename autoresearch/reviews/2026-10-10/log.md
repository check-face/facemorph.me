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

### 2026-10-10T06:35:04Z — review-20261010-008

- Phase / status: observed / component correctness passed; performance inconclusive
- Round / experiment / correction: 2026-10-10 / R03-R04 direct-rgba-media-v1 / not_applicable
- Hypothesis / decision: bypass foreground PNG and defer compact recoverable image encoding; screen lossy WebP and encoder latency settings before product integration
- Identity: frozen source `b322a26858275f0e361127836d0fd1854e868ef9`; candidate file hashes in [source snapshot](../../candidates/direct-rgba-media-v1/source-snapshot.json); API hello fixture SHA-256 `0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615`
- Context: eris / Linux / Chromium 152 / NVIDIA Turing for raw synthesis; isolated headless profile; contended correctness runs, load ~14–19; 7 canaries/runtime, single plus 31 synthetic W+ samples; codec hello fixture only
- Boundary / samples: speed not_measured; correctness-report timings not qualified; benchmark attempts refused above load 4. Raw report's early control firstDrawMs includes subsequent validation decode and must not be used; harness fixed before any speed experiment.
- Correctness / workflow: 9 Node tests pass; raw RGBA agrees for 31 synthetic samples; PNG/WebP decode1024 and recovery pass; 32-frame/16 FPS H.264 outputs playable2s; fixed full31/compiled UI/save/re-upload/phone gates pending
- Resources / failures: hello PNG+metadata 4,245,531 B; WebP q0.8+metadata 129,932 B; client peak reserved raw4MiB/cap8MiB, external surfaces unmeasured; rejected archived512 fixtures establish no full1024 coverage
- Evidence: [candidate](../../candidates/direct-rgba-media-v1/README.md), [codec report](../../candidates/direct-rgba-media-v1/correctness-browser.json), [raw report](../../candidates/direct-rgba-media-v1/correctness-raw.json); runner IDs `20261010T061226Z-c7899f5c`, `20261010T061801Z-02cc46bd`, `20261010T062309Z-8530827a`, refusals `20261010T062459Z-e8fd956b`/`20261010T062617Z-50611334`, latest tests `20261010T063402Z-d79be2ea`
- Conclusion / next action: correctness/size evidence supports bounded CI codec screening; no speed keep or deployment claim. Preserve sparse indices and ordered video; all32 raw frames would violate the budget.

### 2026-10-10T06:35:04Z — review-20261010-009

- Phase / status: proposed / bounded experimental CI and qualified UI control handoff
- Round / experiment / correction: 2026-10-10 / R03-R04 / not_applicable
- Hypothesis / decision: isolated CI can measure codec costs while eris is contended; it does not establish desktop GPU/phone E2E speed
- Identity: versioned [experimental workflow](../../../.github/workflows/research-rgba-screen-v1.yml); current development source `e0b2192` passed [artifact run38030647695](https://github.com/check-face/facemorph.me/actions/runs/38030647695); exact live identity still being requested
- Context: Ubuntu24.04 GitHub runner / stable Chrome actual version reported / Playwright1.55.0; ABBA×3 after fixed warmup; new image worker per sample, per-clip video worker
- Boundary / samples: display draw+RAF, file-ready, decoded playable video; not_measured until reports; no compositor/OS-share claim
- Correctness / workflow: Node and actual browser decode/recovery/playback before timing; separate experimental workflow, no required-check changes
- Resources / failures: 20min job, bounded60/240/360s steps, artifacts14days; triggers retired after screen; report load and bounded queue separately from total memory
- Evidence: [candidate recipe](../../candidates/direct-rgba-media-v1/README.md); agent-mail message26 requests stable Product/media integration and final live control
- Conclusion / next action: publish prepared screen and collect scoped results, integrate only qualified useful candidates, then verify built/deployed UI

### 2026-10-10T06:49:54Z — review-20261010-010

- Phase / status: observed / paired codec results; scoped keeps and discard
- Round / experiment / correction: 2026-10-10 / R03-R04 / not_applicable
- Hypothesis / decision: remove foreground PNG round trips; evaluate WebP size and realtime H.264 settings independently
- Identity: experimental source `afb20d9c9aae0ac5e99e9c2ee6309927a0490efc`; exact input/source hashes in [CI report](../../candidates/direct-rgba-media-v1/ci-paired-codec.json); workflow [run38031453811](https://github.com/check-face/facemorph.me/actions/runs/38031453811)
- Context: Ubuntu24.04 GitHub runner / headless Chrome155 / visible document / public hello1024 / fixed warmup, ABBA×3,6 observations per side per question; load0.27→0.58
- Boundary / samples: draw+RAF65.31→5.02ms; file-ready PNG55.36/WebP113.17ms; 32-frame1024/16FPS H.264 decoded playable PNG1,316.24/raw186.07ms; quality153.36/realtime158.22ms medians; excludes synthesis/compiled UI/compositor/OS share
- Correctness / workflow:9 integrity tests and browser image/recovery/playback pass; quality spot-check public fixture; fixed full31 not applicable to isolated codec screen, product qualification still separate
- Resources / failures: PNG4,245,531B/WebP129,932B; two-frame worker copy budget; codec/GPU surface memory not measured; no errors; new image worker per sample, video worker per clip
- Evidence: [grouped analysis](../../candidates/direct-rgba-media-v1/ci-analysis.md), durable JSON/PNG in candidate folder; reports retained in Git beyond14-day CI expiry
- Conclusion / next action: keep direct transport at component scope; WebP slower but smaller, choose deferred downloads with PNG cache compatibility; discard realtime settings. Retire automatic CI trigger; integrate and verify actual artifact next.

### 2026-10-10T06:54:02Z — review-20261010-011

- Phase / status: implemented / raw display, deferred cache/download encoding and ordered raw video prepared for artifact qualification
- Round / experiment / correction: 2026-10-10 / R03-R04 / not_applicable
- Hypothesis / decision: transfer measured transport benefit without making WebP encode part of foreground display; preserve exact PNG originals and legacy recovery
- Identity: application changes based on qualified development control `e0b2192c26f6b921b9fb5e24c94be358c508c052`; report [product-correctness.json](../../candidates/direct-rgba-media-v1/product-correctness.json) binds tested source modules; subsequent runtime edit only suppresses late background storage progress; bridge integration gated separately
- Context: eris / Linux / Chromium152 / NVIDIA Turing / visible isolated source screen /7 original canaries, generated seed31719, changing32-frame1024/16FPS video / contended load21–22; no timing qualification
- Boundary / samples: speed not_measured; canonical/cache/download/recovery and decoded playable checks only
- Correctness / workflow: raw display agrees with exact canonical PNG; deferred cache reused; WebP download109,188B decoded1024 and recovers exact W+; MP4 project recovers and2s video decodes1024; all289 product/hosting Node tests pass before final revision test, targeted followup passes; import/progress gates pass; actual compiled UI pending
- Resources / failures: global worker raw copies capped8MiB across image/video/download encoders; foreground/readback/surfaces accounted separately, total process/GPU peaks unmeasured. Video retains4 sparse anchors then streams ordered frames; no all-frame raw array. Report's after-add reservation snapshot0 is not a queue peak.
- Evidence: [source screen](../../candidates/direct-rgba-media-v1/product-screen.mjs), [screenshot](../../candidates/direct-rgba-media-v1/product-correctness.png), tests run `20261010T065053Z-d81473c9`/`20261010T065232Z-79721cd0`; BlueHarbor agent-mail27/28 releases stable paths and confirms qualified live control
- Conclusion / next action: commit integration and let unchanged required artifact/CPU/mobile workflows qualify the real UI before deployment; new paired product/live reporting still separate from component benefit

### 2026-10-10T07:07:27Z — review-20261010-012

- Phase / status: observed then implemented / exact-artifact repeat reuse failure corrected; qualification pending
- Round / experiment / correction: 2026-10-10 / R03-R04 / followup to review-20261010-011
- Hypothesis / decision: preserve the completed download on an unchanged per-face request; never repeat inference or background file encoding for that retained result
- Identity: failed candidate `d0d8d7a6332652dbc09cc7418520f8863aed11f8`; control `e0b2192`; [CI run38032536121](https://github.com/check-face/facemorph.me/actions/runs/38032536121)
- Context: hosted Linux Chrome154 CI, replicated on contended eris Chrome152 exact artifact; correctness only, no speed claim
- Boundary / samples: one CI failure and one instrumented reproduction; after baseline only the image encoder worker posted blob/format/quality/recovery, no inference worker creation or inference messages
- Correctness / workflow: build and compiled UI passed; real CPU UI failed and deployment skipped. Per-face same-input reuse and deferred last-result remembrance corrected, including superseded-result rejection; focused regression tests pass
- Resources / failures: redundant download worker, not a numerical/GPU failure. First local diagnostic attempt had a harness quoting syntax error; subsequent attempt reproduced the product fault. Existing zero-worker check remains unchanged
- Evidence: [worker trace](../../candidates/direct-rgba-media-v1/repeat-failure.json); runner `20261010T070519Z-79aca28e`, regression tests `20261010T070644Z-f8c00fd7`
- Conclusion / next action: qualify corrected exact artifact; retain failure evidence and separate deployed state from pushed source

### 2026-10-10T07:13:39Z — review-20261010-013

- Phase / status: implemented / download worker transport corrected; new exact-artifact qualification required
- Round / experiment / correction: 2026-10-10 / R03-R04 / followup to review-20261010-012
- Hypothesis / decision: the worker receives only cloneable latent/provenance/generation identity; displayed face promises and UI/source state must remain on the page
- Identity: correction follows `e590de2`; initial built-UI experiment [run38033537996](https://github.com/check-face/facemorph.me/actions/runs/38033537996) cancelled by research before accepting measurements
- Context: actual bridge-ready result includes `fileReady`; source codec screen used a pure canonical record and did not cover this structured-clone boundary
- Boundary / samples: no new speed claim; worker-transport regression reproduces Promise clone rejection and confirms successful WebP dispatch after correction
- Correctness / workflow: focused metadata/bridge tests pass; Chrome exact-artifact gate now requires WebP and checks downloaded-face re-upload bypasses processing workers; PNG fallback retained for unsupported encoders
- Resources / failures: silent PNG fallback from DataCloneError meant the earlier WebP source-screen result did not establish compiled UI WebP behavior; cloneable recovery descriptor omits raw pixels, promises and source files
- Evidence: `src/Next/recovery-metadata.test.mjs`; runner `20261010T071304Z-9ee61b65`; corrected exact artifact pending
- Conclusion / next action: rebuild/qualify and refreeze paired CPU artifacts before continuing measurement

### 2026-10-10T07:29:00Z — review-20261010-014

- Phase / status: deployed / corrected raw media candidate qualified and live bytes verified
- Round / experiment / correction: 2026-10-10 / R03-R04 / follows review-20261010-013
- Hypothesis / decision: deliver direct display/video pixels with deferred PNG persistence and recoverable WebP downloads; retain video quality/queue8
- Identity: `bce320418a694bc48f25a609217bb81861ee6e47`, diagnostic build `next-995b477854d97c7a`, app `app.25b21e2904ae5841d01e.js`, runtime `d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c`, [successful run38033695234](https://github.com/check-face/facemorph.me/actions/runs/38033695234)
- Context: exact built UI Linux Chrome154 CPU; unchanged numerical/privacy/asset tests and compiled UI pass; iOS/Android component lanes pass, exact iOS simulator still running; physical phone unmeasured
- Boundary / samples: correctness only; paired built UI screen remains in progress, no product speed claim
- Correctness / workflow: named face synthesis, named rejection, repeated originals with zero workers/messages, real WebP download/re-upload without processing workers, metadata-free photo e4e, crop, decoded1024 playable2s MP4 pass. Hidden project-file controls are explicitly skipped, not passed; serialization is separately checked
- Resources / failures: actual downloaded face126,158B =76,116B image +50,042B exact metadata; repeat file identical. Saved MP4 1,419,362B contains two-control16FPS/16-frames-per-segment project. Initial live HTML verifier saw the existing injected Cloudflare beacon; exact application HTML verified after separating that one known platform tag, all app/worker/style/catalogue/hello asset bytes match
- Evidence: [CPU qualification](../../candidates/direct-rgba-media-v1/cpu-qualification.json), [live identity](live-bce-identity.json), [verification recipe](verify-live.py)
- Conclusion / next action: deployment is verified; finish paired product transfer screen and record remaining GPU/phone/analytics coverage without assigning component timings to users

### 2026-10-10T07:29:00Z — review-20261010-015

- Phase / status: observed / reporting refresh and research harness corrections
- Round / experiment / correction: 2026-10-10 / R01-R05 / not_applicable
- Hypothesis / decision: accept timings only for their actual workload/cache/boundary; require photo encoder events rather than rely on an upload nonce
- Identity: live build `next-995b477854d97c7a`; paired control/candidate remain e0/bce; no application changes in these research harness corrections
- Context: R2 receipt query07:23:21UTC, window10October00:00UTC onward;339 listed objects,36 selected/21 run IDs, zero current-build runs; observed provider values kept distinct from requested route in prospective collector schema2
- Boundary / samples: no current-user latency baseline; no accepted paired built UI outcome yet. Warmup diagnostic timings are discarded
- Correctness / workflow: run38033742264 failed before candidate artifact upload, bounded wait added. Run38033815020 completed both warmups then stopped because restored project input is disabled; mode now changes through the actual menu. Run38034284294 cancelled after the warmup report exposed normalized-photo cache reuse; ignored RIFF nonce was stripped by selection, so next photo had no encoder events. Deterministic whole-image RGB-offset variants and encode-aligned/encoding-complete gates replace that faulty cache assumption; bounded command1800s/job35min
- Resources / failures: explicit GPU control run38033339860 reached GTX1050/Chrome141 processing then failed invalid command buffer; no successful face or timing, separate from earlier obsolete-selector failures and from the raw-media candidate
- Evidence: [non-identifying reporting](reporting-coverage-bce.json), [GPU control failure](../../candidates/direct-rgba-media-v1/gpu-control-failure.json), [paired recipe](../../candidates/direct-rgba-media-v1/built-ui-paired.mjs); current experiment run38034405920
- Conclusion / next action: complete corrected paired screen; keep current user/device latency unknown where reporting does not establish it; GPU compatibility and physical coverage remain explicit follow-up directions

### 2026-10-10T07:48:36+00:00 — review-20261010-016

- Phase / status: observed / corrected iOS simulator product screen passed
- Round / experiment / correction: 2026-10-10 / R03-R04 / follows pending mobile coverage in review-20261010-014
- Hypothesis / decision: accept drawn full-resolution canvas as the delivered face surface; retain decoded-image compatibility without weakening error/idle checks
- Identity: harness-only follow-up `549ecdf`; [successful run 38034719345](https://github.com/check-face/facemorph.me/actions/runs/38034719345); artifact hashes retained in the receipt, different bundle identity from live `bce3204`
- Context: macOS 15 hosted runner / iPhone 16 Pro Simulator / Safari iOS 18.5 / CPU after no WebGPU adapter; one first-face functional attempt, acquisition/setup included
- Boundary / samples: Generate click → full 1024px drawn canvas and idle; 500 ms polling; diagnostic 34,876 ms is unpaired and not warm/physical-phone performance
- Correctness / workflow: faceProduced and completed true, RGBA canvas, errors empty; Android/iOS component checks passed; photo/download/video/total-memory not qualified by this one-face screen
- Resources / failures: memory fields unavailable; cache.bytes 0 reflects missing Content-Length and does not establish zero retained bytes; simulator is not physical-device evidence
- Evidence: [iOS receipt](../../candidates/direct-rgba-media-v1/ios-qualification.json)
- Conclusion / next action: simulator functional gap closed; physical-phone resource/recovery coverage remains follow-up, not a barrier to the already qualified candidate delivery

### 2026-10-10T07:59:07+00:00 — review-20261010-017

- Phase / status: observed then proposed / built-UI budget timeout; unchanged comparison restarted with a larger bounded budget
- Round / experiment / correction: 2026-10-10 / R01-R05 / amends the run budget in review-20261010-015, not the workload or qualification gates
- Hypothesis / decision: complete the originally planned six matched cases per side; do not select incomplete samples as a general speed win
- Identity: control `e0b2192c26f6b921b9fb5e24c94be358c508c052`; candidate `bce320418a694bc48f25a609217bb81861ee6e47`; timed-out harness `2f3e54770ba72d621ea7435783e9b6dd47fcb550`, [run 38034405920](https://github.com/check-face/facemorph.me/actions/runs/38034405920)
- Context: Ubuntu 24.04 / visible headless Chrome 155 / CPU, retained independent profiles, explicit ordinary-policy admission emulation; same source/artifacts/inputs and fixed warmup → ABBA ×3 on rerun
- Boundary / samples: two warmups and eight complete measured visits plus partial ninth; original 1800 s command limit reached during video, exit 124; accepted performance outcome inconclusive
- Correctness / workflow: completed visits passed full 1024px faces, matching downloads, metadata-free photo encoder events and 2 s playable video; planned campaign is incomplete
- Resources / failures: video wall about 110 s on this runner, above prior warmup estimate; no product correctness failure recorded; total memory unmeasured
- Evidence: [retained timeout report](../../candidates/direct-rgba-media-v1/built-ui-timeout.json); CI runner journal downloaded to `/tmp/facemorph-rgba-built-budget` (raw JSON durable in Git)
- Conclusion / next action: restart complete campaign with command 3000 s / job 55 min, within runner maximum; all source, workload, order and correctness checks unchanged; retain failure rather than relaxing gates

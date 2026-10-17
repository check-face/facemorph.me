# Diagnostics learnings, read 18 October 2026

What the consented debug reports in the `facemorph-diagnostics` bucket say about how the
`next.facemorph.me` candidate behaved on real devices. Aggregates only: no device, session or
run identifiers and no raw report bytes appear here, and the reports are deleted after this note
is committed (see "What happens to the raw reports").

## Source and method

- Every object under `runs/` in the bucket, read with a read-only listing and per-object get; nothing
  was written to the bucket. 801 objects, 5.2 MB, uploaded between 22 September and 17 October 2026
  (08:02 UTC). Key-list digest (SHA-256 of the sorted keys, one per line): `c3833f1f056ae0700e82d997a592e9009114d014a7b1ce8ae21c45cd8c07e0fb`.
- 12,057 events in 309 runs, 71 browser sessions, 22 devices. Event kinds: 11,427 stage, 284 start,
  195 completed, 81 failed, 54 interrupted, 16 cancelled.
- Fields available: route offered (`gpu`), route used (`provider`), stage, per-stage and elapsed
  milliseconds, route outcome, error kind/code/stage, storage quota/usage/persistence, download plan
  and progress in MB. There is no byte-level throughput, no image size and no user step counts.

## How far to trust it

- The reports are opt-in and mostly test bursts. Four devices produced 61% of the runs (76, 43, 34 and 34);
  one device produced 32 of the 81 failures. These are engineering signals, not visitor rates.
- Runs by operating system: Windows 96, Android 93, macOS 56, Linux 52, iOS 4, unknown 8 (no start event).
  **There is almost no iPhone evidence** (4 runs). Nothing here can baseline iPhone behavior.
- Browsers in the 284 start events: Chromium 266, Firefox 15, Safari 3.

## Findings

### 1. Outcomes and failures

- Terminal outcome of the 309 runs: 195 completed (63%), 81 failed (26%), 16 cancelled, 11 interrupted,
  6 with no terminal event.
- Failures are concentrated, not general. One build, live on 8 October only, failed 26 of its 34 runs and
  was replaced the next day. Among the 140 runs of the build live from 10 October, 38 failed, and 11 of those
  came from one Windows device that offered only WebGL (all 11 failed at route admission; its 12th run
  was interrupted, so no run on that device completed).
- **All 81 failed events carry the same error code (`operation_failed`).** The error kind is `unknown` for 47,
  `decode` for 25 and `unsupported` for 9. 21 failures carry no stage at all; the rest name the stage as
  `face` (37), `route-admitted` (14), `original-cache-hit` (5) and four others. This is too coarse to triage:
  it cannot separate an undecodable photo from a route that was refused, a storage failure or a download
  that broke. Seven of the nine `unsupported` failures, from three devices, happened at the `face` or
  `original-cache-hit` stage; the fields say nothing more, so they are a lead nobody can diagnose from them.
- 54 runs recorded an `interrupted` event and 11 ended that way. The last stage before an interruption was
  alignment (11), asset acquisition (10), encoding (7), synthesis (7) and synthesis-complete (7): the
  longest waits. Cancels cluster at synthesis (10 of 16).

### 2. Routes (this also fills the WebGL receipt)

- Events by route used: WebGPU 8,608, CPU 2,412, WebGL 384, auto 645. Route outcomes: admitted 64,
  canary failed 23 (22 of them on the one WebGL-only Windows device), engine stopped 2, unsupported 1.
- Per-face synthesis, median (90th percentile): desktop WebGPU 50 ms (600 ms, n=2,334); Android WebGPU 738 ms
  (1.6 s, n=616); desktop CPU 1.28 s (7.2 s, n=358); desktop WebGL 7.85 s (8.0 s, n=37); Android WebGL
  19.7 s (n=7).
- Other stages, median: alignment 7.1 s on desktop WebGPU, 8.0 s on Android WebGPU, 24.6 s on desktop CPU;
  encoding 4.7 s, 5.6 s and 11.1 s on the same three; model load 1.5 s desktop WebGPU, 2.4 s desktop CPU,
  3.5 s Android WebGPU.
- WebGL was never better than the alternative that was also available, except in download size on the
  one iPhone (see 4). The route-read figures recorded in the plan (17 October) hold.

### 3. Storage and cache

- Persistent storage was granted in 94 of 1,259 storage checks (7%), from 6 devices (92 of the 94 on
  Windows). Treat the model cache as evictable.
- Reported storage quota, by platform: iOS 1,000 MB in all 143 checks and **zero usage in all 143**; macOS
  1,000 MB to 10 GB (median 10 GB); Android 10 GB in all 141; Windows and Linux from 2 GB up. The full model
  package is 1,040 MB, so the quota iOS reports is smaller than the package it would have to cache, and
  nothing was ever stored there.
- Cache trouble events: cache unavailable 4 (two macOS WebGPU, two iOS), and three single reports of save
  failed, missing after acquire and quota exceeded.
- Original-photo cache: 93 hits against 60 stores.

### 4. Downloads

- Only 12 of 309 runs fetched any bytes from the network; the rest used an existing cache.
- A cold full package (1,040 MB planned) was attempted in 6 runs: 3 completed (download 92 s on Linux,
  243 s on Windows, 286 s on macOS; first face 104 s, 265 s and 310 s after start) and 3 did not (stopped at
  141 MB after 121 s, at 586 MB after 377 s with a failure, and on the iPhone at 678 MB after 19 s with
  no terminal event).
- A 134 MB plan failed 11 times, all on the one WebGL-only Windows device, with 0 MB loaded each time.
- A phone-sized plan (158 MB, iPhone WebGL) completed twice with 150 MB loaded.

## What these findings change in the plan

1. **Typed failure causes** (requirement): every failed event needs a specific cause code from a closed list
   and the stage; "unknown" is a defect to count, not a normal value. Folded into the diagnostics
   consent-control and operation-controller sections.
2. **iPhone cache capacity** (requirement): the reported iOS quota (1,000 MB) is below the 1,040 MB package and
   usage was 0, so a phone with no admitted WebGPU cannot be assumed to cache the CPU package. The device
   check must measure what the phone can actually keep, and the consent text must state the real bytes and
   whether they will be kept. Folded into provider simplification (the acceptance consequence).
3. Leads without a requirement yet: the seven unexplained `unsupported` failures; interruptions concentrated in
   alignment and downloads; the half of cold full downloads that did not finish. Better causes (item 1) are
   what turns these into answers.
4. Field data cannot stand in for the performance matrix, and there is no iPhone baseline: the matrix needs
   its own lab runs.

## What happens to the raw reports

The reports that this note read were collected under the wording "Deleted after 30 days". The operator ruled
(18 October) that they are deleted once mined and that only this note is kept. The deletion is a one-off script
bounded by the key list above and by the moment the corrected consent wording goes live; it is recorded in a
receipt with the count and the key-list digest. Working copies of the raw reports made for this read are deleted
at the same step.

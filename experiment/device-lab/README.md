# Facemorph device lab

Temporary, isolated client-side inference research. Hosted on TrueNAS at
`/mnt/vessel/files/facemorph-device-lab`, served over a dedicated Cloudflare Quick
Tunnel. No inference runs on the server. Classic Facemorph, Triton, the HF trial,
DNS and retirement gates are unchanged.

Open the plain HTTPS page address and press **Run experiments**. No account,
fragment key or copied browser session is required. The server automatically reserves
a fresh run and issues a credential scoped only to that run. The lab confirms its
initial report is saved before starting model downloads/inference. Old invitation
links and legacy authenticated PUT clients remain compatible.

Reports save automatically after progress, checks and completion, atomically to
`results/<UUID>.json` on the TrueNAS dataset. An offline outbox retries every 30
seconds and on reconnection; JSON download is only a backup. The random persistent
device ID identifies a browser profile, not a hardware serial number; clearing site
storage, another browser, or a changed tunnel origin creates a new ID. Reports
include optional device label, browser build/platform/architecture, exposed GPU
renderer/limits/features, CPU thread count, memory hint, screen, battery state where
available, visibility changes, suite settings, artifact manifest hash, timings,
checks and errors. Browser privacy restrictions can omit hardware details.

## Current retest candidate — 15 September, suite25

The current default is `2026-09-15.25`. It includes actual unshared SIMD CPU
qualification/reload, canonical PNG comparisons, a separate native-canvas
diagnostic, saved loading/reference/GPU checkpoints and tap-to-play MP4 fallback.
Keep the page visible until DONE confirms results are saved; tap the MP4 button
if it appears. Model loading time remains recorded separately from inference.

Both configured iOS Simulators passed full31, reload and normal-suite compatibility
checks; the Mac GPU candidate passed full31. Physical iPhone GPU reliability still
needs the new handset run. These are research checks, not product admission or
proof of support for every device/architecture. See [suite25 evidence](../../../autoresearch/candidates/png-reference-v1/README.md)
and [Jeff-derived runtime adoption](../../../autoresearch/candidates/iphone-simulator-v1/jeff-iphone-research.md).

## Automatic suite

The ongoing selection criteria and instrumentation backlog are maintained in
[the shared tester research policy](../../../autoresearch/program.md#shared-tester-suite-research-value-policy).
Review that policy and current device evidence whenever changing defaults.

The historical initial suite, version 2026-09-14.14, used `automaticSuite.rules` in `experiments.json` and
`suite-policy-v1.js` to choose an intentional suite in one click. No tester choices
or query parameters are needed. Reports retain capabilities, exact rules and all
22 candidate selection/skip reasons. A skipped experiment is not a failed check.

All devices get FFmpeg encode/decode/playback and a common single-thread CPU
baseline. Isolated browsers compare one available multi-thread setting (two or
four), not redundant thread configurations. Weight-modulated CPU graphs are paired
with a spatial control at the same thread count.

GPU buffer limits select the ordinary baseline (at least 134742528 bytes) or tiled
baseline (at least 134217728 bytes). Bounded GPUs also compare the newer ORT runtime.
Video and eligible style-cache follow-ups require their synthesis baseline to pass.
The independent spatial compatibility route runs when the ordinary baseline fails.
GPU colour diagnostics run whenever an adapter is reported. Missing limits are
recorded conservatively, with GPU synthesis skipped and CPU checks retained. No
phone model or GPU vendor is assumed to guarantee support.

Historical controls, simulated caps, queue/graph tuning, alternate adapter hints
and legacy CPU runtimes stay in the catalog with explicit exclusion reasons.
Researchers can enable them through a new versioned policy for a concrete question.
Preserve old clients/configurations/manifests for active runs. Selection is research
screening only, never product admission. Each selected experiment has the existing
eight-minute limit; unsupported/failing cases do not stop independent later tests.

The suite currently uses existing screening coverage (seven ordinary GPU fixtures,
three CPU fixtures, and the cached-path references), not full 31-case qualification.
Qualification coverage is a researcher setting, never a tester decision. Model
setup is shown from existing `loadMs`: session loading/initialization, including
model fetch when needed, but excluding earlier runtime/fixture loads. Separate
cold-download, cached-load and first-result measurements remain future work.

GPU paths use batch one, 1024px, original FP32 weights/noise. Three warmups, three
single-face samples (0, 1, 25), three 26-frame sequence repetitions. Version 2 validates before timing: all RGB pixels, 4091 float samples, and full-output finiteness.
The default ordinary checks cover seven endpoints/photo-W+/noise/truncation fixtures;
full qualification covers all 31. Cached checks cover frames 0, 12 and 25 against
round 8's independently validated uncached output. No historic JPEG parity claim. Version 4 rejects graphs with known intermediates
above the device storage-binding limit before loading them. The tiled GPU
candidate tiles the oversized phase tensor and reads two buffers directly; its
separate 128 MiB cap experiment verifies the actual ORT device limit.

Every experiment gets a fresh worker; current GPU workers explicitly destroy
their device after releasing sessions and buffers. A failure does not prevent later cases,
including explicit CPU fallback, from running. Stop terminates the current worker;
180 seconds without progress terminates it and records the timeout. This does not
prove all mobile memory budgets or driver failure modes. Keep the tab visible;
backgrounding and thermal/load effects remain measurement confounders.

Researchers maintain the automatic suite in `experiments.json`. Versioned suite
changes can alter ordering and qualification coverage for follow-up research. Do not promote a candidate from one
warm run or a correctness failure.

## Build and deploy

From the workspace root:

```sh
npm ci --prefix facemorph.me/experiment/device-lab --ignore-scripts
python3 facemorph.me/experiment/device-lab/build.py
rsync -az review-artifacts/device-lab-deploy/assets/ truenas:facemorph-device-lab/assets/
scp facemorph.me/experiment/device-lab/server.py facemorph.me/experiment/device-lab/compose.yml truenas:facemorph-device-lab/
ssh truenas 'cd ~/facemorph-device-lab && sudo -n docker compose up -d'
```

The existing `.env` contains the experiment signing/legacy submission key; never
commit it or publish it in client code. Per-run credentials never enter report JSON. Build uses an explicit asset list, with per-file SHA-256 provenance. Only that
bundle is exposed; result GETs, source server code, workspace and directory listings
are denied. JSON updates require their run-specific credential (or the legacy operator key),
valid UUID/schema, <=2 MiB,
and are capped at 2,000 runs. Container has a read-only asset mount and 512 MiB RAM
limit. Results live outside the container. The lab binds only localhost:8147.

Do not update model/runtime/worker assets during active measurement runs. Record a
new suite version and preserve the corresponding asset manifest when changing them.

The Quick Tunnel URL changes if its container restarts. The app can restart without
restarting the tunnel. Find the current URL with:

```sh
ssh truenas 'cd ~/facemorph-device-lab && sudo -n docker compose logs tunnel | rg trycloudflare.com'
```

Run API integration checks using `LAB_URL` and `LAB_KEY` environment variables:
`python3 facemorph.me/experiment/device-lab/test_server.py`.

Retrieve all device results directly, without asking testers for files:

```sh
python3 facemorph.me/experiment/device-lab/pull_results.py
```

This writes immutable-named run copies and a combined `summary.json` under
`review-artifacts/device-lab-runs/`. It uses read-only SSH access to the app's report
directory. Reports may grow as active runs progress; pull again to refresh them.

To stop only this experiment, `docker compose stop` in its dedicated host directory.
Keep the `results/` directory for research. No cleanup of other services is needed.

## Candidate reproduction

From the workspace root, with the existing research model/reference assets:

```sh
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/mobile_phase_split.py
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/lab_mod64.py
FUSION_MODEL=browser-onnx-lab-mod64/polyphase-high.onnx FUSION_OUT=browser-onnx-lab-mod64-fusion hf-trial/.venv/bin/python facemorph.me/experiment/onnx/split_fusion.py
hf-trial/.venv/bin/python facemorph.me/experiment/device-lab/cache_references.py
```

Old numbered workers remain bundled so in-flight experiments continue using their
original code. Active worker versions are selected by `experiments.json`; old
reports retain their original experiment names/settings. The Mac's enforced cap
is a resource-limit test, not proof of a Samsung driver or universal mobile support.


## Suite 2026-09-14.9: S21 and cross-platform research

Use **S21 / phone research set** for exact colour conversion, tiled ORT 1.22/1.24,
CPU 1/2-thread spatial and 1-thread weight-modulation comparisons, plus FFmpeg.
The expandable research list also retains 4-thread controls/weight modulation and
a low-power GPU adapter request. These are candidates, not S21-qualified winners.
Select full31 for release-review correctness; shorter checks are screening only.
All cases save automatically. Bad outputs show a red INVALID label beside their
expected reference, and reports include channel ranges/clipping/non-finite counts.

The original S21 run had genuine GPU numerical failures (RGB max255) and a valid
CPU path. Tiled GPU binding checks address a known incompatibility, not a complete
claim of driver compatibility. The cheap RGB test runs without a model to separate
colour conversion/readback from synthesis. Noise stress fixtures are labelled.

Versioned worker, UI, config and manifest URLs preserve old active runs. New lab
versions explicitly integrate candidates after checking active reports; never
replace a running worker/model in place. Browser experiments must appear in the
hosted registry, including optional and rejected comparisons. Desktop research
uses packaging-neutral native adapters with its own OS/architecture evidence.

Before production user generation, require release full31/reliability evidence,
actual-device reference canaries and workload resource admission. An unvalidated
route stays disabled; GPU failure requires independent CPU validation or desktop
transfer. Slow correct routes should offer desktop with measured expectations.
The lab is screening/research and issues no product readiness certificate.


## Automatic saving repair — September 14

The old fragment/sessionStorage key was fragile across devices and tabs. Stale keys
caused401s after expensive work had already started. The current plain URL works
from a fresh browser without the key. `POST /api/runs` reserves a random server run
ID and returns a write-only, per-run HMAC capability. PUT and POST updates to that
run require its credential; another run's token cannot overwrite it. Reports stay
unreadable over public HTTP. Origin checks, schema/body limits and the2000-run cap
remain in place. Legacy-key clients continue to work during transition.

The browser stores credentials separately from diagnostics, coalesces pending
snapshots, limits save request duration and retries on reconnection. Old pending
results or expired credentials recover into a new run with `recoveredFromRunId`,
preserving data without granting access to the old report. Revision checks prevent
older queued snapshots overwriting newer saved results. Clearing site storage still
removes local pending data; saved server reports remain intact.

Runner failures, startup exceptions, interruption and bounded timeouts are explicit
rows. The summary shows pass/fail counts and device/run IDs; the Details column
retains errors and latest progress. Failed/incomplete paths do not display a speed
score. GPU absence is useful compatibility evidence, not a report-saving failure.
FFmpeg attempts muted playback and records visibility; it includes explicit
foreground guidance if a browser defers background decoding. A background timeout
is not evidence that the encoded file is corrupt.

Regression commands: `python3 experiment/device-lab/test_saving_v2.py` from the
frontend repo tests fresh sessions, scoped writes, legacy auth, stale revisions,
private reports, offline recovery and credential separation. Browser checks also
exercise the real Web API implementations, since Node alone cannot catch browser
receiver-binding errors. Never expose credentials in test output.

### 14 September suite .15: phone stage diagnostic

The same shared link now automatically selects `mobile-stage-256` and
`mobile-stage-64` on bounded 128 MiB binding devices. Each has a 90-second budget,
one reference face, nine sampled intermediate outputs, and full final pixel error
localization; checkpoints save automatically. These replace redundant tiled
runtime/video tests for this investigation, while CPU/FFmpeg controls remain.
Diagnostic completion is not synthesis qualification. See the workspace
`s24_ultra_findings_2026-09-14.md` for the measured Mac baseline and advisory
intermediate-threshold caveat. Phone rerun is pending.

### 14 September suite .16: bounded-padding GPU candidates

The existing link now selects `mobile-boundary-bounded` and
`mobile-boundary-unrolled` on bounded-binding phones. These replace redundant
workgroup-only diagnostics. Both preserve 1024px FP32 generation and existing
numerical acceptance. Seven reference cases gate latency and 26-frame timing;
failures retain sampled intermediate and spatial pixel errors. Four-minute limits
include loading. Runtime import, fixtures, prefix/suffix session durations and
first validated output are now recorded by these workers. Session timing still
combines transfer and initialization, with no asserted cold/cache distinction.

Both passed all31 on Mac (RGB max1, sampled float max6.06e-5), then completed timing.
The local verification was saved through ResultStore; shared collector copy is
`aa6ab9f0-9fe5-4f75-b114-d302867c74cc`. Phone correctness/speed remains pending.
No model weights, precision, resolution, old worker URLs or tunnel were changed.

### Suite .17 — qualify the passing phone GPU path

Phone suite .16 now passes both boundary candidates at RGB max1. The bounded path
measures ~618ms single-face / ~686ms sequence face versus ~2582ms CPU4. Suite .17
retains it, enables all31 via its per-experiment `fullQualification` override, and
skips the duplicate unrolled case. It is a qualification run, not product admission.
`video-compat-v3.js` replaces immediate post-seek sampling with timestamped presented
frames and bounded retries. Three visible Mac playback checks passed; phone pending.

### Suite .18 — reload-save bookkeeping repair

The S24 full31 and revised playback checks passed. Inference remains unchanged.
The new save client persists scoped credentials outside diagnostic reports so a
flushed run can be marked interrupted under the same ID after reload. The UI queues
a newer interruption snapshot even if an older pending entry exists. Live reload
verification and save regressions pass. Pulled summaries mark superseded recovery
IDs while retaining original reports. See `device_audit_2026-09-14_full31.md`.

### Suite 2026-09-15.19 — concise progress UI

Sticky running/completion banner, elapsed time and completed-experiment count;
separate pending-save and saved completion states; explicit stopped, interrupted
and failed-to-start messages. A finished experiment is not a finished suite, and
completion does not imply every path passed. Reload preserves interruption status
locally and the latest confirmed save revision. Prior reports without save receipts
show that status as unavailable rather than implying ongoing work.

Main page is controls, current status, previews and results. Explanations,
collection/download notes, detailed selection and optional tools are behind ⓘ.
Empty preview/results areas stay hidden. State tests and a 390px layout check pass;
no inference or performance policy changed.

### Suite 2026-09-15.20 — first-face failure logs

The primary GPU path now records detailed startup / first-inference checkpoints,
fetch failures and error details. Critical markers briefly wait for a save ACK;
partial logs survive a later tab interruption where storage/network allow it.
Main-page heartbeats, worker-message age, lifecycle events and reload metadata help
distinguish last observable activity. A browser/OS kill cannot report its own cause.
Compact UI and existing numerical policy remain. Mac success and missing-model
failure paths verified; next real iPhone run is needed.

### Optional iPhone WebGL face + video experiment — 15 September

`webgl-hybrid-v1.html` runs CPU early layers plus custom WebGL2 final1024 synthesis, all31 references, persistent full1024-original reuse, generated-frame FFmpeg encode/decode and native MP4 playback. It does not require WebGPU. `webgl2-capability-v1.html` is the smaller model-free convolution check. Both save automatically and are linked under ⓘ. A preview is not completion; wait for **DONE — tests finished and results saved**.

The actual iPhone18ProMax/iOS27 Simulator passed the complete chain. Physical-iPhone speed/memory remain pending; this is opt-in research, not a promoted default or fully GPU model. Reports label Simulator separately. Exact sources, hashes, review tests and memory limitations are in `autoresearch/candidates/iphone-webgl-e2e-v1/` at the workspace root. Other device/native routes and qualification gates are unchanged.

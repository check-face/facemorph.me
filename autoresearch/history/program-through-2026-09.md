# Historical autoresearch protocol and decisions

Archived on 10 October 2026 from the earlier `program.md`. This preserves dated
requirements, findings, and pending work. Some links refer to an older workspace
and are unavailable here. Later operator decisions and the [current protocol](../program.md)
supersede conflicting instructions. Status claims describe their recorded date.

> **15 September executable release tests:** The [release test framework](../release-tests/README.md) maps the complete browser, Docker, desktop, UX, photo/video, caching, recovery and N-point morph requirements to versioned acceptance scenarios. Component passes support development; missing integrated target evidence blocks RC qualification. Candidate and public-trial/cutover gates remain distinct.

# CheckFace performance autoresearch

Updated 16 September 2026. Continue performance research independently of UI, CI and packaging. Adapted from [Karpathy's autoresearch protocol](https://github.com/karpathy/autoresearch/blob/master/program.md); this is inference research, not its NVIDIA-only training setup.

## Core CI verifies the new product — operator direction, 16 September

Core CI serves actual verification of the real new-site version and its shipped
artifacts against the [governing delivery plan](../web_checkface_delivery_plan.md)
and [release tests](../release-tests/README.md). It must exercise the selected,
pinned product build and runtime/model bundles, including real synthesis, e4e,
morphs, cache behavior, export and recovery on the required targets. Component
checks support that purpose; a green component-only pipeline does not establish
that the new site works or that the phase is complete.

This does not prevent autoresearch. Prefer available local compute for experiments
and use the cooperative device lease for heavy local work. Temporary CI workflows
are appropriate when they answer a concrete research question or provide a target
environment unavailable locally. Give them an explicit experimental name, bounded
triggers/time budget, versioned inputs and retained results; disable or remove
their triggers once the experiment is finished, preserving the evidence.

Do not repurpose, weaken or replace core product checks with candidate benchmarks,
mock inference or a research-only harness. Do not change required status checks
to make an experiment pass. Coordinate shared CI changes with the delivery work;
research hands off immutable winners for deliberate product integration and
verification. Research results remain separately scoped until the actual product
build passes the relevant acceptance tests. The existing Android/iOS component
jobs are a foundation to extend toward product verification, not the final scope
of mobile CI. Physical-device gates remain wherever emulation is insufficient.

## Objective and fixed evaluation

Maintain four independent lanes: **browser CPU, browser GPU, native CPU, native GPU**. Never compare different devices/providers as a paired speedup. Track single-face latency, 26-frame ordinary morph throughput, full video export time, cold load and memory separately. Prefix-cache timings are a separate eligible style-mixing workload, not an ordinary/custom morph optimisation.

Keep full 1024px synthesis, deployed model provenance, fixed W+/noise fixtures and reference outputs. Qualify all 31 synthesis cases before promotion: finiteness, all RGB pixels (maximum error 1), existing sampled-float tolerance, and additional workflow-specific tests. Geometry/custom morphs require their own fixtures. Do not weaken evaluation, silently reduce resolution, or change precision/quality acceptance to manufacture a speedup. New metrics/evaluation changes start a separately reviewed experiment series.

Baseline/evidence: `../browser_onnx_research_log.md`, `../preserved-inference/2026-09-14-best-known/`, and `../review-artifacts/device-lab-runs/`. The frozen snapshot is immutable. The historical native benchmark was MPS-only without equivalent correctness gates. `candidates/native-portable-v1/benchmark.py` now supplies explicit native backend selection and all31 checks; initial Mac CPU/MPS results are numerically valid but timing-inconclusive, not promoted winners. Local code under `experiment/hf` is currently reused for models; that directory name does not authorize HF hosting, authentication or inference.

## Isolation and parallel delivery

- Own only `autoresearch/`, candidate experiment code, and new versioned research artifacts. Copy scripts into `candidates/<experiment-id>/` before editing. Preserve original relative layout where needed; record source hashes and exact asset paths. Never edit shared UI, CI, packaging, deployment, fixed references or the frozen snapshot during a candidate.
- Existing ONNX/device-lab code is integration input. Coordinate any shared harness fixes explicitly with its owning task; do not reset, clean, stash, switch branches or commit someone else's work. The current research sources are largely untracked, so a HEAD-only worktree would omit them.
- Hand off winners as versioned source/model/checksum bundles plus runtime settings and evidence. UI/CI/packaging pin that bundle and keep progressing; they do not consume files being mutated by the researcher. Promotion to product/deployed lab is a separate integration action.
- Use `run.py` for command experiments. Its device lock is shared by browser/native and CPU/GPU lanes on one machine. Other hardware can run independently. Browser interactive sessions can hold the same lease by running their dedicated local server under the wrapper; stop it when done. A lease does not detect non-cooperating processes or stop browser work automatically.
- Request quiet measurement windows for heavy builds/tests on the same machine. Editing and remote CI can continue. Record visibility, concurrent load, memory/swap and thermals where available; mark hidden-tab or contended timings inconclusive and rerun. Do not close user apps or interrupt another task's benchmark.
- No Triton writes, other service changes, paid resources or HF dependency. Hosted lab integration is operator-authorized below; never mutate assets used by active testers.

## Experiment loop

1. Read the journal and latest reports; select the next unfinished lane. Alternate lanes so native/CPU work is not indefinitely displaced by browser GPU tuning.
2. Write one hypothesis and candidate/source hashes before measurement. Establish a same-device control under the current environment first.
3. Acquire the device lease. Run fixed correctness checks before timing, warm up, then at least three repeats of control/candidate and reverse their order. Default command budget is 10 minutes; split slow CPU qualification into recorded bounded chunks rather than removing cases. Respect existing worker no-progress timeouts.
4. Save raw output and append the evaluation to `results.tsv`: `keep`, `discard`, `crash`, `inconclusive` or `blocked`. No samples or failed correctness is never zero latency or a speed win. The command journal records execution only; exit zero is not qualification.
5. Keep a candidate only after correctness and repeatable paired benefit on the same workload/device, without unacceptable memory cost. Prefer simplicity for tiny differences. Rejected code/results remain available; move to the next hypothesis without destructive git operations.
6. Freeze a winning bundle and record its limits for product integration. Continue the next bounded experiment while the research task is active. At interruption, checkpoint the next action; on resume inspect interrupted runs before proceeding. Do not assume a Markdown protocol or running lab server keeps an agent alive.

## Device coverage and pre-generation admission (operator requirement, 14 September)

**15 September operator clarification:** CPU fallback is the baseline support
objective across the entire planned browser/native OS/device/architecture matrix,
not just iPhone. Track CPU gaps as implementation/qualification work, not an
automatic reason to require desktop transfer. After GPU failure use an independently
qualified CPU route wherever feasible; slow-but-correct CPU execution may continue
with honest estimates. Record concrete memory/runtime/correctness limits when no
route is viable. Preserve fixed evaluation and safety admission; do not reinterpret
this objective as proof that every device already works. GPU qualification remains
independent, including the required native GPU app test on Oliver's Manjaro machine.

Support every device through a validated route where feasible, including S21-class
phones. Track browser CPU/GPU and native CPU/GPU separately across macOS, Windows,
Linux, x86-64, ARM64 and other requested architectures. “All architectures” is a
coverage objective, not a support promise: untested architectures remain unknown;
32-bit/address-space constrained targets may need desktop transfer. Packaging is
undecided and must not constrain runtime research prematurely.

Before **user generation**, the product must run a local synthetic preflight:

1. Verify the exact model/runtime/kernel/fixture hashes and supported operator,
   dtype, dimension and buffer requirements. Reject known incompatible bindings
   before allocating/loading the full model. Feature presence or phone model alone
   is insufficient. Browser hardware IDs may be privacy-masked.
2. A release path must first pass all 31 fixed cases plus cold-start, reload,
   repeated-session, bounded video/export, cancellation, memory-pressure and GPU
   loss/recovery qualification on its declared device/provider class. Seven-case
   screening or one successful face is not a release certificate.
3. On the actual device, before enabling user requests, run known full-resolution
   synthetic endpoint and stress/noise canaries and compare numerical/reference
   output, full finiteness and colour output. Test the export codec before video.
   These are diagnostic inference, not user generation. Keep a single active job,
   bounded buffers/queue, and estimate workload memory/latency before admission.
4. Cache a positive preflight only against model/runtime/kernel/precision/shape,
   provider/adapter/driver/browser build and policy version. Missing/masked identity
   requires conservative session-scoped revalidation. Invalidate on update, device
   loss, failure, changed provider/settings or suspected stale state. Persistent
   random device IDs correlate reports; they do not certify hardware capabilities.
5. On GPU failure, clear its eligibility, release resources and try a separately
   qualified CPU route with its own canary. Never display an invalid face as usable
   or rank failed output by speed. Retry only within a bounded recovery policy.
6. If no local route is validated, keep generation disabled and offer transfer to
   a supported desktop, preserving the project/latents locally. For correct-but-slow
   routes, show measured estimated time and offer desktop for more speed; do not
   promise desktop acceleration until that native device's route passes preflight.

The draft packaging-neutral admission contract and negative tests live in
`candidates/browser-diagnostics-v9/admission-policy-v1.js` and
`admission-policy.test.mjs`. The lab reports screening only; this contract is not
yet wired into the production frontend and no release certificate is issued.

No preflight proves arbitrary future memory/driver success. Reliability evidence,
resource admission and runtime monitoring are separate mandatory gates. Track
unknown, unsupported, correctness-failed, screened, reliability-pending, ready and
ready-but-slow distinctly. Thresholds for “slow” must be explicit workload/product
policy, not an excuse to relax correctness. No hosted paid inference/HF fallback.

## Browser and engine comparison matrix (15 September operator addition)

Record browser product/build separately from rendering engine, OS/runtime,
architecture, adapter/provider and physical-device versus Simulator provenance.
A shared browser-profile ID is not a cross-browser hardware identifier. Use an
operator comparison label to pair the same device across browser profiles.

| Target | Browser comparison | Engine comparison | Evidence requirement |
| --- | --- | --- | --- |
| macOS ARM64 / Intel | Safari versus Chrome (Chromium); Brave/Edge supplementary | WebKit versus Blink | Same physical Mac, exact build, identical candidate and fixtures |
| iPhone 11 / high-end iPhone, iPad | Safari versus Chrome for iOS | Standard Chrome iOS uses WebKit; browser integration comparison | Physical runs required; iOS Simulator recorded separately |
| Android S21 / S24 Ultra and other devices | Chrome versus Samsung Internet; other Chromium browsers when available | Chromium/Blink versions and GPU backend | Same physical phone; no Safari support claim |
| Windows / Linux x86-64 / ARM64 | Chrome/Chromium versus Edge/Brave where supported | Blink versions and GPU backend | Independent OS/architecture qualification; Safari unavailable |

Run the same full31 correctness, cold model loading, warm single-face/sequence,
CPU fallback and separate FFmpeg compatibility cases. Preserve failed and
interrupted results, repeat-session/reload/cancellation evidence, and save status.
Do not rank invalid output by speed. Browser or OS updates invalidate prior
admission according to the policy above. Matrix inclusion is planned coverage,
not proof that every row has run or passed.

Standard Chrome iOS uses WebKit per Google's [iOS implementation documentation](https://developer.chrome.com/blog/chromium-chronicle-28).
Apple permits [entitled alternative engines in the EU](https://developer.apple.com/support/alternative-browser-engines/);
count such a build as Blink only with independently verified build/engine evidence.
Installing a Chrome-branded app is not proof of Blink. Desktop Chromium evidence
must never be relabelled as iOS Simulator or physical-iPhone evidence.

## Best-in-class per matrix cell — 18 September

Latest device evidence (results.tsv, refreshed `benchmark-v2-inventory.json`, runs through
2026-09-15; nothing newer was collected as of 18 September):

| Matrix cell | Best measured correct route | Correctness | Notes |
| --- | --- | --- | --- |
| Windows x86-64, Chrome 153 | GPU, 96.7 ms/face | full31 | Best in matrix; MP4 encode 2.6 s/26 chunks |
| macOS ARM64, Chrome 151/Brave | GPU 254–300 ms/face | full31 | Chrome 144 measured 486 ms — browser version is a real variable. WASM cpu-4 control 25.7 s |
| Android S24 Ultra, Chrome (operator) | `mobile-boundary-bounded` 616 ms single / 682 ms sequence | full31 (later run) | Earlier row 686 ms was 7/7 with full31 pending; now covered. CPU control 2582 ms |
| Samsung s2r ultra, Chrome 152 | cpu-4 control only, ~2774 ms | GPU candidate failed frame-00 (RGB max 184, `Conv_output_0`) | Same kernel family passes on S24 Ultra — build-level kernel variance is real |
| Android 10, Chrome 152 | cpu-4 ~2300–2400 ms | cpu passes | cpu-1 stalls (no progress 180 s); tiled stage candidates fail RGB max 24 at `conv0/ConvTranspose__polyphase_conv__tile0` |
| Physical iPhone (414×896, iOS 18.7, Safari 26.6.1, 4 threads) | **none measured correct end to end** | colour passed; cpu-1/cpu-4 failed frame-00; ffmpeg playback denied (NotAllowedError) | WebGPU adapter **is** present with `shader-f16`, BC/ASTC compression, `timestamp-query`; selection policy `ios-memory-recovery-v1` caps bindings at 1 GiB (`ios-conservative`) |
| iPhone Simulator (11/26.5, 18 Pro Max/27) | cpu-4 1.2–3.5 s/face | full31 | Simulator timing is host-Mac CPU, never phone evidence. `iphone-memory-v1` candidate: 290–300 ms/face on Mac, 710 MiB GPUBuffer peak, WebGPU unavailable in Simulator, physical run pending |
| Pure WebGL (no ORT/WASM), Simulator | 8.5–10.9 s/face, full31 + cache + encode | full31 | Proven fallback, not a perf path: ~3× slower than WASM cpu-4 on Simulator; warm coefficient stage is only 0.662 s, convolution stages ~2.9 s each dominate |

Structural findings that gate the whole matrix:

1. **One kernel family is the cross-device blocker.** Polyphase ConvTranspose boundary
   handling diverges on Android (RGB max 24), Samsung s2r (RGB max 184) and real-iPhone WASM
   (frame-00) while passing on Mac and Simulator. Bounded zero-padding fixed the GPU side
   (S24 keep row). The same bounded-boundary treatment is still missing from the shipped
   bundle (`fused-resample-v1.mjs` keeps the `continue` — work order C-01) and from the
   WASM/CPU route, which fails on physical iPhone despite passing on Mac and Simulator.
   Landing C-01 and its CPU-route counterpart unlocks correctness in at least four matrix
   cells at once.
2. **The physical iPhone measurement path must be eviction-proof before speed work counts.**
   Two runs were lost to tab eviction ("Previous tab closed or reloaded before completion"),
   and the ffmpeg case dies on playback policy. Checkpoint/resume with durable partial
   reports and a user-gesture/playsinline playback check are prerequisites for any physical
   iPhone speed claim.
3. **Direct WebGPU compute without the ORT/JSEP heap is the main iOS lever.** The iPhone 11
   -class adapter exposes `shader-f16` and timestamp queries; `iphone-memory-v1` (Mac: 290 ms
   full31, 710 MiB peak) is Mac-validated and unmeasured on the physical device. Simulator
   evidence says coefficient residency alone yields at most ~1.1× (counterfactual); convolution
   scheduling is the dominant cost.

Ordered plan to unlock best-in-class per cell (each step names the cell it unlocks):

- **P0 — Promote the boundary kernel everywhere (C-01).** Byte-identical
  `fused-resample-boundary-v2.js` into the bundle, plus the analogous fix for the WASM/CPU
  route. Unlocks: S24 (already keep), Samsung s2r GPU, Android 10 tiled candidates, real
  iPhone CPU route. Fixed gates unchanged: RGB max 1, sampled float 0.002.
- **P0 — Make physical iPhone runs survive.** Checkpoint/restart + durable partial reports +
  gesture-gated playback in the device-lab suite. Unlocks: physical iPhone rows at all.
- **P1 — Physical iPhone `iphone-memory-v1` run** against the 1 GiB binding cap, paired with
  cpu-4 control on the same device. Unlocks: first physical iPhone GPU number; decides
  WebGPU-direct versus WASM cpu-4 as the iOS release route.
- **P1 — Direct WebGPU compute candidate (no ORT/JSEP heap)** targeting convolution
  scheduling; compare against cpu-4 and pure-WebGL on the same physical device. Unlocks:
  iPhone speed beyond the memory-lean fallback.
- **P2 — S24 Ultra full31 completion and s2r kernel-variance characterization** (same
  candidate, both Samsung builds) before any per-build routing rules.
- **P2 — Desktop spread:** pin Chrome-version sensitivity (96→486 ms across 153→144) into
  minimum-version admission guidance; run native Windows/Linux photo qualification per the
  campaign v2 contract. Unlocks: Windows/Linux rows beyond browser CI.

Standing rules unchanged: physical rows only for admission; Simulator stays separate;
`speedRankingEligible:false` and `releaseQualified:false` in the inventory until a route
passes full31 on that physical cell; CPU fallback remains required across the matrix.

## Hosted experiment integration

The operator authorizes ongoing additive updates to the shared TrueNAS lab. Every
new browser candidate must have an ID, hypothesis, versioned worker/assets and a
entry in the hosted research registry; default inclusion follows the shared tester
suite policy below, and rejected candidates stay accessible and
labelled. Record source hashes, runtime settings and automatic result collection.
Research preparation stays isolated; deployment is a deliberate integration step,
with active-run checks and immutable versioned worker/config/manifest URLs. Do not
replace a running tester's worker, model or fixed reference. Native candidates use
packaging-neutral adapters and the same ledger; do not count browser results as
native OS/architecture qualification.

## Shared tester suite: research value policy

Operator clarification, 14 September 2026: the shared link should answer **given
what we already know, which tests most usefully reduce uncertainty on this device?**
Maintain this policy as candidates improve; do not default to running the entire
historical catalog. One click starts the useful automatic suite, with automatic
report storage and no tester experiment choices, device presets or JSON handoff.

- Select by observed capabilities and reference results. Different devices may
  run different suites. Vendor/model names alone neither establish support nor
  justify exclusions. Missing diagnostics remain unknown, not passing evidence.
- Every default candidate needs a concrete unresolved question, a relevant control
  or reference, useful output metrics, and a bounded execution budget. Record why
  it belongs on the selected devices. Remove redundant or answered experiments
  from the default; retain them in the research registry for targeted follow-up.
- Keep shared baselines where useful for cross-device comparison. Compatibility
  probes may intentionally fail, but must answer an unresolved question; do not
  repeatedly load a path already ruled out by known hard limits. A Mac loss alone
  does not rule out value on other architectures.
- Save policy/version, exact candidate configuration, selection and skip reasons,
  device/browser/adapter diagnostics, correctness, failures, timing scope and
  visibility alongside automatically persisted partial and completed results.
  Skipped, failed, unsupported and unmeasured are distinct from successful tests.
- Prioritize correctness and independent fallback, time to first validated face,
  steady-state face/sequence throughput, real encode/playback compatibility, and
  bounded reliability evidence. Dependent video/cache follow-ups require a passing
  synthesis baseline. Screening remains separate from release qualification.
- Startup measurements should separate runtime/fixture fetch, model transfer,
  session initialization/compilation, warmup and first validated output. Record
  bytes/cache evidence where exposed; label cold versus cached only with evidence.
  Report unavailable stages explicitly and avoid adding overlapping durations.
- Longer unattended runs should answer remaining questions through bounded repeats,
  fresh sessions/reloads or sustained workloads on promising passing paths. Do not
  fill time with redundant candidates. Preserve cancellation, progress, timeouts
  and automatic saving; interrupted/hidden/contended runs are not clean speedups.
- On each optimisation cycle, review the latest device evidence, document the next
  uncertainty and update versioned selection rules deliberately. Check routing and
  failure handling cheaply; run real benchmarks only to answer an open question.
  Preserve active-run assets and the fixed numerical acceptance criteria.

Implementation checkpoint (suite 2026-09-14.14): capability/result-based selection,
per-candidate reasons, automatic diagnostics/storage, existing reference screening,
CPU controls and FFmpeg compatibility are implemented. Selection orchestration was
verified with simulated workers; that does not validate inference on new hardware.
`loadMs` currently combines model session loading/initialization and excludes earlier
runtime/fixture loading. Separate cold/cache/first-result instrumentation and targeted
reload/sustained reliability probes are **pending**, not completed capabilities.
Keep this checkpoint accurate when implementing them. See
`../facemorph.me/experiment/device-lab/README.md` and `../device-lab-status.json`.

## Immediate queue

1. Promote the bounded-boundary kernel (work order C-01) and apply the same treatment to the WASM/CPU route; it is the shared correctness blocker for Samsung s2r, Android 10 and physical-iPhone rows. See "Best-in-class per matrix cell".
2. Make the device-lab suite survive physical iPhone runs (checkpoint/restart, durable partial reports, gesture-gated playback); two September runs were lost to tab eviction.
3. Reconcile latest device reports: tile/cap candidate correctness versus real mobile qualification; hidden-tab measurements cannot promote a winner.
4. Isolate Mac CPU slowdown using dedicated WASM versus asyncify, fresh workers, controlled threads and quiet load; retain Samsung CPU evidence separately.
5. Native CPU/MPS controls now pass all31 in ABBA; repeat in quiet conditions with true cold-load and peak-memory instrumentation. Probe CoreML placement/correctness next, then actual Windows/Linux/other-architecture CPU/GPU runs. See `../desktop_inference_research.md`.
6. Compare memory-bounded graph/kernel candidates and complete exports. Preserve constant-workload comparisons for ordinary and custom morph paths.
7. Photo encoder precision and packaging (H-E1 fp16, H-E2 retire the monolith). See "Photo encoder precision and packaging"; acquisition is 79% of the e4e run, so precision is the lever that matters there.

## Photo encoder precision and packaging — 21 September

Operator direction, 21 September: add these to the tested hypotheses, gate promotion on a real
device matrix, and accept a little quality degradation if it buys a materially smaller or faster
encoder.

**The measurement that motivates them.** `photo-runtime/evidence/desktop-browser-five-photos.json`
splits the 108-shard e4e run on a desktop browser:

| Phase | Time | Share |
|---|---|---|
| `acquireMs` (materialising 1019 MiB of weights) | 19.1 s | **79%** |
| `runMs` (108 inference calls) | 4.4 s | 18% |
| `createMs` (108 ORT session creations) | 0.8 s | 3% |

The iOS Simulator row agrees: 25.3 s / 4.6 s / 0.5 s. Two conclusions follow, and the second
overturns a standing assumption.

**H-E1 — fp16 e4e.** The dominant cost is moving weights, so halving them attacks 79% of the
work rather than a rounding error. Export e4e at fp16, re-shard, and measure `acquireMs`,
`runMs`, peak WASM bytes and W+ error against the pinned `seed-0-aligned` reference. Expect
acquire to roughly halve; `runMs` may not improve at all, because a WASM execution provider can
widen fp16 back to fp32 internally — that is a result, not a failure, and must be reported as
measured rather than assumed. Quality: the existing tolerance is `maxAbs <= 1e-4` against the
reference W+. The operator permits widening it; a new tolerance must be proposed with the
reconstructed images beside the fp32 ones, never silently raised to make a candidate pass.

**H-E2 — retire the monolithic 1019 MiB encoder.** It was kept as a faster single-session path
for desktops. The data says it is not one: session creation across all 108 shards is 0.8 s, 3% of
the run, so a single session saves under a second while asking a phone for a gigabyte-wide
allocation it cannot make. Sharding is close to free. Unless a measurement contradicts this,
`manifest.encoder` should stop being reachable wherever `encoderStream` exists.

**H-E1 first result, 21 September (`autoresearch/candidates/e4e-fp16-v1/`, two `proposed` rows).**
fp16 export is exactly half the bytes (1,068,886,382 -> 534,562,500). On a Node harness using the
product's own onnxruntime-web WASM EP: acquire -47%, run +3%, **create +75%**, **peak WASM heap
+99% (98.4 MB -> 195.6 MB)**. A shard-count-matched 108-shard control reproduces the regression
(+96% create, +84% heap), so it is fp16, not shard packing. The candidate reports no end-to-end
speedup.

That last sentence does not transfer, and the reason is the whole point of measuring acquisition
separately. In that harness `acquireMs` is a local `fs.readFile` and accounts for **17%** of the
run (962 ms of 5,608 ms). In the browser it is **79%** (19.1 s of 24.2 s). The harness compressed
the one term fp16 attacks until it could not matter, so the result says "fp16 does not help when
acquisition is already free" — which is true and not the question. Applying its measured deltas to
the browser baseline *projects* 24.2 s -> ~16 s (-34%), or ~18 s (-25%) for the 108-shard variant,
plus half the download and half the cache pressure. **That is a projection across environments,
not a measurement, and must not be recorded as one.** It is the reason the browser lane is now
the deciding experiment rather than a confirmation.

Two real findings stand regardless of environment, because neither depends on acquisition:

- **The heap regression is the promotion risk, not the speed.** 195.6 MB peak against the
  268,435,456-byte ceiling leaves little room on the devices this path exists for. The likely
  cause is the EP widening fp16 weights back to fp32 for compute and holding both, which would
  also explain flat `runMs`. Root-cause it before any promotion discussion; a candidate that
  halves the download and doubles the heap is the wrong trade on an iPhone.
- **The tolerance question is not a quality preference.** All five canaries fail 1e-4 at maxAbs
  0.0017-0.0048, while reconstructions differ by 3-4/255 per channel — visually near-identical.
  The operator permits some degradation, but 1e-4 is a *correctness canary*, not a quality knob:
  widening it to 5e-3 globally would also let a genuinely broken fp32 encoder pass. If fp16 is
  adopted, it needs its own recorded tolerance tied to that precision, not a relaxed global one.

**Promotion gate for H-E1.** Three lanes, no substitutions: a physical Android device, a physical
Mac, and Linux with a real GPU (the CI GPU lane or the TrueNAS runner). An emulator or Simulator
row is a control, never one of the three. Report per lane: `acquireMs`, `runMs`, `createMs`, peak
WASM bytes, W+ `maxAbs` against the reference, and the reconstructed image beside the fp32 one.

## Running and resuming

From the workspace root:

```sh
python3 autoresearch/run.py --lane native-cpu --device local-mac --timeout 600 -- python3 path/to/candidate.py
```

Use the same device name `local-mac` for **all** heavy work on this Mac. GPU packaging smoke tests and local CI should also use this wrapper when measurements might be running. Busy exits 75 immediately by default; use `--wait 240` for a bounded wait when handing the device between lanes. The command timeout starts after acquisition. Waiting is cooperative polling, not a strict FIFO scheduler; never overlap or interrupt an existing measurement. Commands run without a shell, in a dedicated process group; timeout kills that group. Each run saves metadata/output and appends `runs.jsonl`. Unexpected runner termination releases the lock but may leave child/browser work: inspect before resuming.

Resume the existing task **Deploy facemorph experiment site** with: “Read autoresearch/program.md, inspect the journal, and continue the next bounded experiment.” An agent session drives the loop; no unattended scheduler has been installed. Source code in `candidates/` is private research state until explicitly handed off.

## Durable product learning — output reuse (14 September)

Full 1024×1024 generated originals must be cached on-device and reused for repeated
requests; resizing derives from the original and must not trigger synthesis again.
Look up valid persisted outputs before model/runtime initialization. Model-file and
style-prefix caches are separate optimizations. The full key, provenance, eviction,
concurrent-request deduplication and validation requirements are in
`../inference_learnings.md`. This is an implementation requirement, not a claim that
the product cache already exists. The operator accepts genuinely small numerical
differences; record any revised acceptance policy explicitly with spatial/error
metrics rather than silently weakening the existing reference checks.

## Whole-pipeline research — operator clarification, 16 September

Autoresearch must be able to execute and optimize the whole pipeline: image
decode/alignment → actual e4e → full1024 synthesis → retained originals → morph
and export, including repeats, cancellation, recovery and CPU/GPU transitions.
There is no rule excluding e4e or phones from experiments. Historical wording
that a synthesis benchmark did not execute e4e describes that run, not a scope
restriction on future research. The operator further confirmed that all processing
areas are now in scope; there is no remaining stage-level exclusion to seek
permission for. This includes model loading/retention, preprocessing, encoders,
all synthesis providers, morph generation, export and end-to-end scheduling.

Product admission and research admission are distinct. A missing product
`phoneAdmitted` certificate must not circularly prevent bounded synthetic-fixture
experiments from obtaining the evidence needed for that certificate. Use a
separate explicit research runner with fixed fixtures, progress/checkpoints,
resource accounting and timeouts; do not enable unqualified user photo processing
or relabel an experimental pass as product qualification.

For iPhone memory work, optimize complete useful workflows, not just isolated
encoder/synthesis peaks. Compare sequential worker teardown against justified
residency/reuse options, account overlapping JS/WASM/GPU/codec allocations, retain
partial reports on tab reset, and test recovery. Explore larger memory budgets
when there is a concrete performance hypothesis; existing caps are controls,
not universal ceilings. Record actual stage execution, correctness and failures
rather than hiding an unimplemented or skipped stage behind a whole-pipeline pass.

## Mandatory e4e coverage per path — operator clarification, 15 September

Every browser/native CPU/GPU route must register separate e4e tests alongside synthesis tests. A precomputed photo-derived W+ fixture and an MP4 encoder test do not execute e4e. Never describe a synthesis-only pass as photo workflow qualification. Track actual encoder and synthesis providers separately: a CPU encoder plus GPU synthesis is a legitimate hybrid route only with its own evidence.

Use `candidates/e4e-coverage-v1/coverage.json` and regenerate it when adding routes. Required stages are image decode/alignment, actual e4e inference, full1024 reconstruction, original-cache reuse, repeated input and failure/recovery. Run at least two fixed synthetic photos, aligned and unaligned cases, no-face handling and malformed input. Keep model/preprocessing hashes, W+ finiteness and independent reference comparisons; preserve the existing CPU encoder max-W+ tolerance0.0001 and full1024 synthesis RGBmax1/float0.002 gates. Fix or separately review a failed gate; do not loosen it silently. Log transfer/setup, alignment/e4e/synthesis times, actual providers, memory, cancellation and partial completion independently.

Existing Linux self-host CPU photo tests do not qualify Windows, macOS, browser WASM or a different GPU runtime. Browser e4e demonstrations with host alignment do not qualify browser-only uploads. Simulator evidence is separate from physical-device qualification. Missing implementations/hardware are recorded as pending or unsupported, never passes. Do not add the old roughly1GB monolithic e4e graph to phone defaults without a bounded-memory candidate and explicit stage diagnostics. This is required coverage work, not permission to omit phone e4e permanently.

`coverage.py` supplies a fail-closed evidence contract (not yet product admission wiring), and `native_check.py` runs the real portable Torch CPU encoder regressions with durable partial stage reports. New candidate handoffs must include the e4e status and test mapping, even while synthesis optimization continues independently.


## iPhone memory/performance objective — 16 September

Follow [the reality check](../iphone_optimisation_reality_check_2026-09-16.md). Minimise useful workflow time subject to correctness/reliability; do not minimise memory for its own sake. The384 MiB experimental allowance is not a permanent cap. Compare concrete higher-memory residency/tile/dispatch candidates when they can plausibly improve speed, using paired same-device tests and full workflow memory/recovery evidence. Never report a hypothetical2× gain as measured. Physical CPU/GPU qualification remains separate from Simulator, and feature integration proceeds alongside this bounded research.


## Broad synthesis/e4e campaign — 16 September

Use [benchmark campaign v2](benchmark-campaign-v2/README.md), its shared contract and both proposal portfolios for the next experiments. The generated matrix is planned/unexecuted. Missing browser alignment/CPU encoder controls and physical-phone photo qualification are explicit work, not inferred from synthesis. Preserve original numerical gates and independent references. Larger-memory residency is eligible when measured speed and reliability justify it. Research owns isolated candidate bundles; the operator owns parallel packaging and separate-site deployment. Hand off immutable, checksummed winners with exact tested scope; metadata updates alone establish no new hardware support.

### WebGPU in-product status (18 September)

The served bundle's WebGPU route failed on first use: ORT's JSEP loader resolves a relative
`ort-wasm-simd-threaded.jsep.mjs` specifier against a blob: base and dies before any
inference. Fixed in `facemorph.me/src/Next/browser/webgpu-engine.mjs` (verified pinned bytes,
specifier rewritten to the verified factory blob URL). The route then acquires and verifies
its full pinned asset set locally. Outstanding before a matrix WebGPU row can be claimed:
cold `Cache.put` commit phases emit no progress and can exceed the 300 s per-operation stall
watchdog; qualification on a WebGPU-capable device (CI runners cannot run it).

### Route fallback policy (19 September operator direction)

A fallback must never select a route whose recorded per-face cost is higher than another
route still available on the device. Concretely: when WebGPU fails admission on an S24 Ultra,
the runtime now falls back to CPU (2,582 ms measured) — never WebGL (~13,000 ms) — because the
fallback order is the measured priors in `facemorph.me/src/Next/browser/route-priors.mjs`, and
each prior's `measured` table pins its order (ascending cost, enforced by
`route-priors.test.mjs`). The former hardcoded WebGPU→WebGL→CPU chain, which could land the S24
on its slowest measured route, is removed. New keep rows update `measured` and `order`
together; an ordering without measurements must state its justification (for example iOS WebGL
for working-set reasons) in the prior's `because` field.

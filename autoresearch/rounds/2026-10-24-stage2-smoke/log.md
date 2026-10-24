# Stage-2 smoke log

Append-only. Entry format: [the entry template](../templates/log-entry.md). Smoke runs are not evaluated outcomes and
add no `results.tsv` row.

### 2026-10-24T12:26:30+00:00 — 20261024T122630Z-524a1b8c

- Phase / status: observed / eris worker recipe executed once: ready for browser-cpu and browser-gpu; a software adapter refused
- Round / experiment / correction: 2026-10-24-stage2-smoke / readiness / not_applicable
- Hypothesis / decision: the maintained eris recipe (`autoresearch/workers/eris/README.md`) is executable on eris; refuted by any failing readiness check other than load
- Identity: monorepo working tree on `ce1252d` with fm-qqh's uncommitted drivers; control tree `ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe` (62 files, 10,314,864 bytes); runtime manifest `d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c` (301 files)
- Context: eris, Chromium 152.0.7977.82, Playwright 1.64.1, Node 26.8.2; lease run `20261024T122630Z-524a1b8c` (lane browser-gpu); lease dir `/home/cdilga/.local/state/facemorph/lease`
- Boundary / samples: not_measured
- Correctness / workflow: `check.mjs --lane browser-gpu`: checkout, node, browser controller, browser, lease directory, acquired runtime, control artifact, load and WebGPU adapter all pass (adapter `nvidia turing`, not fallback; exit 0). With `--software` (SwiftShader forced) the adapter check fails "fallback (software) adapter", exit 1. `requestAdapter()` returned null for the first seconds after launch; the probe now retries for 15 s
- Resources / failures: TrueNAS not executed: its runners serve classic only (fm-ip6g) and eris has no SSH access to it (`autoresearch/workers/truenas/README.md`)
- Evidence: `/home/cdilga/.local/state/facemorph/lease/20261024T122630Z-524a1b8c/output.log` (local-only on eris)
- Conclusion / next action: eris runs both maintained drivers; TrueNAS stays blocked on fm-ip6g

### 2026-10-24T12:27:35+00:00 — 20261024T122735Z-cc7b4b56

- Phase / status: observed / built-UI paired driver revision 2 smoke against the control passed
- Round / experiment / correction: 2026-10-24-stage2-smoke / smoke-built-ui / not_applicable
- Hypothesis / decision: the maintained driver runs the whole journey on an artifact verified by digest; refuted by any failed step
- Identity: control/control, both sides tree `ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe` (classic `551b6072`); runtime manifest `d9e37e50…`; driver file SHA-256 `556de7453eba3147ea54ed15bc517e41605e389743adfcd23ad61a74ea7127ca` (the revision before profiles were deleted at the end of a run); photo inputs `316c2cff…` (first) and `b3a37ef0…` (next), derived from the artifact's public `preview/hello-1024.webp`
- Context: eris, CPU route, headless Chromium 152, smoke mode (one sample per side, no warmup); load 5.82 at start (contended; recorded, not refused, because a smoke is not measured); lease run `20261024T122735Z-cc7b4b56` (lane browser-cpu)
- Boundary / samples: action → filled tile and idle, download complete, playable video, photo with `encode-aligned` and `encoding-complete`. Control ms: new-face-1 25219, new-face-2 1586, first-download 80, repeat-original 696, repeat-download 61, video32 55615, video-download 98, photo-first 37633, photo-next 22404, photo-download 60. Candidate (the same control): 16402, 1805, 96, 101, 59, 55181, 93, 39951, 21239, 61. Not an evaluated sample
- Correctness / workflow: repeat Save bytes identical on both sides; videos 1024×1024, 2 s, readyState 4; both photos ran the encoder; no page errors; only the origin was requested (no blocked host)
- Resources / failures: origin bytes 773,962,468 (control, cold profile) and 929,138,128 (candidate); the 2.8 GB of browser profiles were deleted by hand afterwards, as the driver now does
- Evidence: `/home/cdilga/Work/runs/facemorph-research/stage2-smoke-built-ui-eris-20261024/report.json` (local-only on eris); journal event `20261024T122735Z-cc7b4b56` in `/home/cdilga/.local/state/facemorph/lease/runs.jsonl`, whose command carries `--control-digest ecc4c357…`
- Conclusion / next action: the driver is usable for a targeted round; any timing claim needs a paired run on a quiet host

### 2026-10-24T12:32:24+00:00 — 20261024T123224Z-22e375a7

- Phase / status: observed / morph-frame product driver revision 2 smoke against the control passed on WebGPU
- Round / experiment / correction: 2026-10-24-stage2-smoke / smoke-morph-frame / not_applicable
- Hypothesis / decision: the maintained driver measures morph frames at the product boundary of an artifact verified by digest; refuted by no observed frame or a failed step
- Identity: control/control, tree `ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe`; runtime manifest `d9e37e50…`; driver file SHA-256 `c27645ed83573759bcab35a97c60b40389dd131708522164e3793a1e1fa4bec7`
- Context: eris RTX 2080 SUPER (driver 610.57.04), WebGPU through Vulkan/ANGLE, adapter `nvidia turing` admitted; route caption "Ready · this device's GPU (webgpu)."; smoke mode; load 5.16 at start (contended, recorded); lease run `20261024T123224Z-22e375a7` (lane browser-gpu)
- Boundary / samples: Create morph → playable 1024×1024 video and idle; per-frame from the 3rd to the last synthesized frame. Control: 28 synthesized frames, 32 written, first frame 730 ms, last 15380 ms, 577 ms/frame, morph step 15750 ms. Candidate (the same control): first 2697 ms, last 10394 ms, 302 ms/frame, morph step 11496 ms. Under contention; not an evaluated sample
- Correctness / workflow: videos 1024×1024, 2 s; Save video `facemorph.mp4` 1,420,348 bytes (`a399eb2a…`) and 1,420,526 bytes (`71e5ec58…`): the encoded bytes differ between runs of the same artifact, so output identity is not a byte comparison here; frames were not compared numerically
- Resources / failures: origin bytes 30,652,667 and 97,775,080; classic's eris limit (`Invalid Buffer` on a served artifact) did not reproduce
- Evidence: `/home/cdilga/Work/runs/facemorph-research/stage2-smoke-morph-frame-eris-20261024/report.json` (local-only on eris); journal event `20261024T123224Z-22e375a7`, command with `--control-digest ecc4c357…`
- Conclusion / next action: the driver is usable for a targeted round on eris; per-frame numbers need a quiet host and paired order

### 2026-10-24T12:34:41+00:00 — 20261024T123441Z-3731806f

- Phase / status: observed / first recorded run of the re-homed `research-rgba-screen` workflow passed (morph-frame product driver smoke on WebGPU)
- Round / experiment / correction: 2026-10-24-stage2-smoke / ci-research-rgba-screen / not_applicable
- Hypothesis / decision: the re-homed workflow runs the maintained driver, leased, on eris from a clean CI checkout; refuted by a failed job
- Identity: monorepo `4b995ac`; control/control tree `ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe` (re-verified by `npm run build:next -- --check` in the job); runtime manifest `d9e37e50…`; driver SHA-256 `c27645ed…`
- Context: GitHub Actions run 40094483823 on the eris runner; readiness probe leased as `20261024T123438Z-5d9fae4c` (browser-gpu, hardware adapter); driver leased as `20261024T123441Z-3731806f` (browser-gpu); WebGPU route; load 2.90 at start
- Boundary / samples: control 28 synthesized and 32 written frames, first frame 748 ms, last 3515 ms, 101.7 ms/frame, morph step 3640 ms; candidate (same control) first 559 ms, last 2000 ms, 52.2 ms/frame, morph step 2128 ms. Smoke, not an evaluated sample
- Correctness / workflow: driver tests 11/11 in the job; playable videos; Save video digests `aee86781…` and `47349d20…`
- Resources / failures: none; profiles deleted at the end of the run
- Evidence: `/home/cdilga/Work/runs/facemorph-research/ci-morph-frame-40094483823-1/report.json` (eris); copy in the run's artifact `research-rgba-screen-40094483823` (14 days); https://github.com/check-face/facemorph.me/actions/runs/40094483823
- Conclusion / next action: workflow recorded; path-filter and lease-wrapping follow-ups are carried by fm-7ge and fm-wzy

### 2026-10-24T12:35:31+00:00 — 20261024T123531Z-75bbd668

- Phase / status: observed / first recorded run of the re-homed `research-built-ui-media` workflow passed (built-UI paired driver smoke on CPU)
- Round / experiment / correction: 2026-10-24-stage2-smoke / ci-research-built-ui-media / not_applicable
- Hypothesis / decision: the re-homed workflow runs the maintained driver, leased, on eris from a clean CI checkout; refuted by a failed job
- Identity: monorepo `4b995ac`; control/control tree `ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe`; runtime manifest `d9e37e50…`; driver SHA-256 `5f2ea65c…`
- Context: GitHub Actions run 40094483846 on the eris runner; readiness (browser-cpu) passed; driver leased as `20261024T123531Z-75bbd668` (browser-cpu); CPU route; load 3.18 at start
- Boundary / samples: control ms: new-face-1 16436, new-face-2 2031, first-download 91, repeat-original 97, repeat-download 65, video32 54788, video-download 72, photo-first 39138, photo-next 20711, photo-download 89; candidate (same control): 15160, 1850, 73, 71, 47, 56666, 76, 36712, 21688, 64. Smoke, not an evaluated sample
- Correctness / workflow: driver tests 11/11 in the job; repeat Save identical; both photos ran the encoder; no page errors
- Resources / failures: none; profiles deleted at the end of the run
- Evidence: `/home/cdilga/Work/runs/facemorph-research/ci-built-ui-40094483846-1/report.json` (eris); copy in the run's artifact `research-built-ui-media-40094483846` (14 days); https://github.com/check-face/facemorph.me/actions/runs/40094483846
- Conclusion / next action: workflow recorded; neither workflow is a required status (the repository has no branch protection or rulesets on `main`)

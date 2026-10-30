# Phone GPU class journal

### 2026-10-30T13:59:33+10:00 — E1-OBSERVED

- Phase / status: observed / discard
- Round / experiment / correction: 2026-10-30-phone-gpu-class / E1 / not_applicable
- Hypothesis / decision: admitting the direct WGSL engine on ARM phones (adapter limits suffice) beats ORT JSEP on the P30; refuted if warm face is not faster.
- Identity: candidate = local build with runtime.mjs gpuEngine() admitting mobile when adapter vendor is `arm` (never committed); control = local build of main; runtime d9e37e50…
- Context: P30 Pro, Chrome 150 with lab WebGPU flags; lab.py matrix --cells phone-webgpu --journey cold-face,warm-face; order candidate, control, control, candidate; phone lab lock held; camera held off.
- Boundary / samples: cold face s: candidate 46, 46; control 30, 29. Warm face s: candidate 39, 38; control 22, 24. Candidate warm-face journeys 57.1 s and 56.4 s exceeded the 50 s budget.
- Correctness / workflow: route reported GPU (webgpu) in all runs; the lab summary does not name the engine, so direct-engine use is inferred from the build, not observed.
- Resources / failures: not_measured.
- Evidence: tools/device-lab/out/20261030-135436-fm-ve6a-direct, 20261030-135643-fm-ve6a-control, 20261030-135808-fm-ve6a-control, 20261030-135933-fm-ve6a-direct (eris local).
- Conclusion / next action: the desktop-tuned direct engine is ~1.7x slower than ORT JSEP on Mali; change reverted. Next: E2 (CPU first on Mali).

### 2026-10-30T15:07:00+10:00 — E2-OBSERVED

- Phase / status: observed / keep
- Round / experiment / correction: 2026-10-30-phone-gpu-class / E2 / not_applicable
- Hypothesis / decision: ordering the CPU route first for Android phones whose WebGPU adapter vendor is `arm` (stylegan-js ROUTE_PRIORS, the existing Android/iOS/desktop table) makes a P30 face faster with WebGPU enabled; refuted if warm face is not faster than control.
- Identity: candidate = local build with routes.ts prior + runtime.mjs capability() passing the probed adapter vendor; control = local build of main; runtime d9e37e50…
- Context: P30 Pro, Chrome 150 with lab WebGPU flags (phone-webgpu cell), LAB_ANY_ROUTE=1 so the lab times the route the product chose; order candidate, control, control, candidate; phone lab lock held; camera held off. A first attempt without LAB_ANY_ROUTE failed by design (the cell asserts WebGPU; candidate chose CPU).
- Boundary / samples: cold face s: candidate 23, 22; control 29, 28. Warm face s: candidate 17, 17; control 22, 21. Candidate route "Ready · this device's CPU", control "GPU (webgpu)".
- Correctness / workflow: CPU route canaries at qualification (unchanged gates); stylegan-js routes tests 10/10 including the new prior (Adreno, unnamed vendor and desktop keep WebGPU first).
- Resources / failures: not_measured.
- Evidence: tools/device-lab/out/20261030-150210-fm-ve6a-e2-mali, 150326-…-e2-control, 150449-…-e2-control, 150609-…-e2-mali (eris local).
- Conclusion / next action: keep; desktop, iPhone and Adreno unchanged by construction. Samsung report stays pending with the operator.

### 2026-10-30T15:38:00+10:00 — E2-DEPLOYED

- Phase / status: deployed / route choice observed on live next
- Round / experiment / correction: E2 / not_applicable
- Hypothesis / decision: the deployed build (release on 5286d6c, includes 880557f) chooses the CPU route on the P30 with WebGPU enabled.
- Identity: live https://next.facemorph.me; release run on 5286d6c passed go/no-go, deploy and the post-delivery check.
- Context: P30 Pro phone-webgpu cell, LAB_ANY_ROUTE=1, live mode (real internet download), one run.
- Boundary / samples: cold face 73 s (live download, not comparable with local runs), warm face 17 s; route "Ready · this device's CPU".
- Correctness / workflow: lab marks live runs untested (no deployed-artifact attestation); cold-face journey 83.6 s over the local 70 s budget because of the live download.
- Resources / failures: not_measured.
- Evidence: tools/device-lab/out/20261030-153642-fm-ve6a-e2-live (eris local).
- Conclusion / next action: deployed behaviour matches E2. Samsung report pending with the operator.

### 2026-10-30T15:55:00+10:00 — E2-NOREGRESSION-OBSERVED

- Phase / status: observed / no regression on eris-webgpu and phone-cpu
- Round / experiment / correction: E2 / not_applicable
- Hypothesis / decision: the E2 prior changes nothing on desktop WebGPU or on the phone's CPU cell; refuted by a warm-face difference beyond the control pair's spread.
- Identity: candidate art-mali (E2 build), control main build; runtime d9e37e50…
- Context: lab.py matrix --cells phone-cpu,eris-webgpu --journey cold-face,warm-face, order candidate, control, control, candidate; then eris-webgpu alone again in the same order. .locks/eris-browser-1 and the phone lab lock held; eris load 6–20 from other sessions.
- Boundary / samples: phone-cpu warm face s: candidate 17, 18; control 18, 17 (cold 23, 23 vs 23, 22). eris-webgpu warm face s, first round: candidate 4, 10; control 5, 4. The 10 s run was during a load spike; that journey took 13.9 s and failed its 10 s budget. Second round: candidate 4, 5; control 4, 4. Cold faces 5–11 s on both sides, load-dominated.
- Correctness / workflow: all other journeys passed; routes as expected (phone-cpu CPU, eris-webgpu GPU).
- Resources / failures: one load-spike outlier, named above.
- Evidence: tools/device-lab/out/20261030-1540..1546-fm-ve6a-nr-*, 20261030-1552..1554-fm-ve6a-nr2-* (eris local).
- Conclusion / next action: no regression beyond noise. On desktop, by construction, the prior needs Android plus an arm adapter.

### 2026-10-30T15:58:00+10:00 — E2-NARROWED-IMPLEMENTED

- Phase / status: implemented / rule narrowed to the measured architecture
- Round / experiment / correction: E2 / narrows E2 (vendor-wide `arm` → `arm` + `bifrost`)
- Hypothesis / decision: one measured Mali (P30 Pro: Kirin 980, Mali-G76) cannot speak for Valhall/5th-gen Malis, so CPU-first applies only where GPUAdapterInfo reports vendor `arm` and architecture `bifrost`.
- Identity: GPUAdapterInfo on the P30, probed 30 Oct (Chrome 150, lab WebGPU flags): vendor `arm`, architecture `bifrost`, device "", description "". routes.ts condition plus runtime.mjs passing adapter.info.architecture; routes tests updated (Bifrost CPU first; Valhall and vendor-only `arm` keep WebGPU first).
- Context: no new timing; the P30 reports `bifrost`, so its route is unchanged from E2.
- Boundary / samples: not_measured (the route choice for the P30 is identical by its reported fields).
- Correctness / workflow: stylegan-js routes tests 10/10.
- Resources / failures: not_applicable.
- Evidence: this log; the probe output is recorded in the round README identity.
- Conclusion / next action: live route check after deploy.

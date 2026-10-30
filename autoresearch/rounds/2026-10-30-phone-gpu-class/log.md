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

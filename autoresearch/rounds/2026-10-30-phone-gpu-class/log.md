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

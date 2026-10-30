# ORT 1.31.1 adoption journal

### 2026-10-30T14:30:00+10:00 — Q1-OBSERVED

- Phase / status: observed / built
- Round / experiment / correction: 2026-10-30-ort1311-serial / Q1 / supersedes the lost tempmoarcpu build (2026-10-27-ort1311 next step)
- Hypothesis / decision: the 1.30 serial recipe builds 1.31.1 with an unshared 16 MiB→256 MiB memory and no threads; refuted by any other memory shape.
- Identity: source v1.31.1 HEAD asserted 6af1a932e2286d5c58166085d24c68783033edee; emsdk c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56 (4.0.23); command = 1.30 recipe plus --allow_running_as_root (container) and pip cmake 3.31.6; CMakeCache THREADS=OFF, SIMD=ON, EMSCRIPTEN_SETTINGS MAXIMUM_MEMORY=268435456;MALLOC=dlmalloc;STACK_SIZE=5242880.
- Context: triton, disposable docker container (playwright:v1.64.1-noble), 8 CPUs; no other container touched.
- Boundary / samples: not_applicable (build).
- Correctness / workflow: parsed WASM memory: defined, unshared, initial 256 pages, maximum 4096 pages. generateSerialCompanion/verifySerialCompanion pass against control descriptor 3d27df84….
- Resources / failures: ort-wasm-simd.wasm 20,631,277 B sha256 afabd18de5fbd022d9bd3150bb9f5127ec97030fe430d66c91ebac2532ef0c07; ort-wasm-simd.mjs 39,466 B a917f93911386d120e15e4e572a1792a8535cf0c7394d40b8bb635a06682bfa7; wrapper npm ort.wasm.min.mjs. First attempts failed before compiling (pip cmake 3.28.6 absent; build.py refuses root).
- Evidence: draft release runtime-ort-1.31.1-serial-5caaaaa2f9be (companion, build metadata, build-command.sh, regenerated link command, CMakeCache, LICENSE, ThirdPartyNotices); eris ~/.cache/facemorph-ort-staging/1.31.1-serial-20261030/.
- Conclusion / next action: companion bundle 5caaaaa2…; next Q2 numerics.

### 2026-10-30T15:05:00+10:00 — Q2-OBSERVED

- Phase / status: observed / CPU and JSEP pass; native WebGPU EP fails
- Round / experiment / correction: Q2 / not_applicable
- Hypothesis / decision: 1.31.1 passes the synthesis canaries on every route at unchanged gates (RGB ≤ 1, sampled float ≤ 0.002).
- Identity: classic qualifier tools/ort-qualify (classic a42829bb…, control d9e37e50…) with --ort the staged 1.31.1 package; monorepo full31 (packages/stylegan-js/test/full31) on candidate runtime 775fab8f….
- Context: eris, Chromium/Chrome, RTX 2080 SUPER, .locks/eris-browser-1 held.
- Boundary / samples: correctness only.
- Correctness / workflow: classic CPU 7/7 (max float 5.3e-6); classic webgpu-ort JSEP build 7/7 (max float 1.9e-5); classic webgpu-ort native EP build: error "Can't bind input[0] … no data transfer registered … DeviceId:0 → DeviceId:1", reproduced twice. Monorepo full31 CPU chromium 31/31, max RGB 1, max float 9.36e-6; monorepo full31 webgpu-ort (native EP) 0/31, same binding error.
- Resources / failures: as above.
- Evidence: scratch logs (session-local); summary here.
- Conclusion / next action: a 1.31 regression in this app's GPU-buffer binding; Q3 tests a fix.

### 2026-10-30T15:20:00+10:00 — Q3-OBSERVED

- Phase / status: observed / fix passes on candidate and control
- Round / experiment / correction: Q3 / not_applicable
- Hypothesis / decision: creating the suffix session with the prefix's options (ORT's own device) instead of an explicit `{name:'webgpu', device}` removes the second device context; refuted if binding still fails or control regresses.
- Identity: packages/stylegan-js/src/engine/adapters/ort-webgpu.ts change (uncommitted at this entry); runtimes 775fab8f… and d9e37e50….
- Context: eris Chrome, RTX 2080 SUPER, full31 webgpu-ort cell.
- Boundary / samples: correctness only.
- Correctness / workflow: candidate 1.31.1 native EP 31/31, max RGB 1, max float 3.83e-5; control JSEP 1.22 31/31, max float 3.73e-5; stylegan-js npm test 186 pass, 1 skipped.
- Resources / failures: not_measured.
- Evidence: this log.
- Conclusion / next action: keep the fix; next paired desktop timing, encoder canaries, phone rows.

### 2026-10-30T15:30:00+10:00 — Q4-OBSERVED

- Phase / status: observed / desktop ORT-WebGPU regression on 1.31.1 native EP; CPU timing not measured
- Round / experiment / correction: Q4 / not_applicable
- Hypothesis / decision: 1.31.1 (native WebGPU EP, ort.webgpu.min.mjs) is not worse than control (JSEP 1.22) on the ORT WebGPU engine, the engine phones use; refuted by a not-worse failure beyond control/control noise.
- Identity: control runtime d9e37e50…, candidate composed runtime 775fab8f… (overlay evidence/runtime-mirror-webgpu.candidate.json.raw, serial source evidence/runtime-serial-source.candidate.json.raw); numerics receipts evidence/full31-*.json; package dist with the Q3 fix.
- Context: eris, Chrome (google-chrome), RTX 2080 SUPER, tools/ort-qualify/paired.mjs under run.py --exclusive gpu-timing, disk profiles, load ceiling 12; two discarded warmups then ABBA x3; .locks/eris-browser-1 held.
- Boundary / samples: noise (control/control) margins: warm ms/frame 1.05%, cold start 0.25%. Compare medians control → candidate: warm ms/frame 69.9 → 74.5 (ratio 1.066, interval 1.060–1.073: failed); cold start 3541 → 3900 ms (inconclusive); runtime download 34,710,491 → 43,799,252 B (+26%, failed); peak browser RSS 2.51 → 2.76 GB (+10%, failed).
- Correctness / workflow: both sides passed full31 31/31 before timing.
- Resources / failures: the CPU noise run was refused twice by the load guard (eris load 19–34 from other agents' browser runs); no CPU timing scored.
- Evidence: evidence/noise-gpu.report.json.raw, evidence/compare-gpu.report.json.raw.
- Conclusion / next action: measured no-go for adopting 1.31.1 on the WebGPU route; the overlay bumps all six npm assets together, so the CPU route cannot move alone. Keep the current runtime; the Q3 binding fix stays (it is a no-op on JSEP and required by any native-EP release).

### 2026-10-30T16:10:00+10:00 — Q5-OBSERVED

- Phase / status: observed / CPU-only candidate numerics pass; CPU timing stopped (budget)
- Round / experiment / correction: Q5 / not_applicable
- Hypothesis / decision: a CPU-route-only overlay (3d0f1e7 `cpu` build) moves the CPU route to 1.31.1 and leaves WebGPU on the pinned 1.22 control.
- Identity: overlay bundle 2536109f8cda699cc60135f9531b34291f073b289296fa9f13bd2bd535cfbaa9 with serial companion 5caaaaa2…; composed runtime 7986cb9c16ed52e47fe45100e2abc8d855f00912f9f15507a4c471a83061d6f6.
- Context: eris Chromium/Chrome; full31 cells.
- Boundary / samples: CPU paired timing not scored: control/control noise was refused once by the load guard (load 18.9) and stopped once mid-measurement (load ceiling exceeded); the work was then stopped for token budget.
- Correctness / workflow: full31 CPU chromium 31/31 (max float 9.36e-6); full31 webgpu-ort 31/31 (3.73e-5, identical to control because the GPU runtime is unchanged).
- Resources / failures: as above.
- Evidence: this log (receipts session-local).
- Conclusion / next action: the runtime stays pinned. Next: CPU paired timing on a quiet host, then encoder canaries (encode-browsers, FACEMORPH_FULL_QUALIFY=1), a phone-cpu warm face and a commit of import/runtime-mirror.json (cpu build) plus import/runtime-serial-source.json.

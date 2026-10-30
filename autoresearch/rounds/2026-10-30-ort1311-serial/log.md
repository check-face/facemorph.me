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

# Research round: ONNX Runtime Web 1.31.1 adoption — 2026-10-30

Status: measuring.
Journey and bottleneck: every face and photo encode runs on ONNX Runtime Web; fm-qeh moves all routes to the latest
release (1.31.1) or records a measured no-go.
Exclusions: tolerances and retained cells (unchanged); nightly builds.
Budget: eris under a .locks/eris-browser-* reservation for browser numerics/timings; triton containers for builds
(no restarts); phone rows under the lab lock.

## Identity and evidence

npm onnxruntime-web 1.31.1 (integrity sha512-5GeH+bWQ…, staged at ~/.cache/facemorph-ort-staging/1.31.1-e46787f9b590f87c).
Serial encoder companion built from v1.31.1 (6af1a932e2286d5c58166085d24c68783033edee) with Emsdk 4.0.23 (gitlink
c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56): bundle 5caaaaa2f9be523672b7837b9298c7f92cd661d4334f5835061aba2fd350aa8e,
draft release runtime-ort-1.31.1-serial-5caaaaa2f9be. Control runtime d9e37e50… (CPU 1.24.3, WebGPU 1.22.0 JSEP).
Candidate composed runtime (native WebGPU EP build): 775fab8f06ee97f03efa1825d7d7bfb4b7f1b8f6c64974f3dfbbadf00b6f34e2.

## Candidates

See experiments.md.

## Integration and remaining gates

Owner bead fm-qeh. Adoption = import/runtime-mirror.json + import/runtime-serial-source.json + lock bump on main.

## Records

`log.md` (append-only) · `experiments.md` · `../../results.tsv` · `../../records.md` · `../../program.md`.

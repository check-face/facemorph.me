# Experiments

## Q1: 1.31.1 serial companion build provenance
Rebuild of the unshared 256 MiB serial SIMD encoder runtime from source (the tempmoarcpu build was lost).

## Q2: synthesis numerics per set and provider
Classic qualifier (tools/ort-qualify) and the monorepo full31 cells on the composed candidate runtime.

## Q3: native WebGPU EP input binding on 1.31.1
The suffix session registered `{name:'webgpu', device}` as a second device context; GPU-buffer tensors failed to bind.
Candidate fix: create the suffix session with the same options as the prefix (ORT's own device).

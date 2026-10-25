# Maintained research drivers

Stage 2 of the research re-homing (fm-qqh): drivers that measure the new application and its packages through the
`build:next` / `deploy-next/` artifact contract. They are versioned copies; the originals under `candidates/` are
frozen and never edited.

| Driver | Revision | Derived from (frozen) | Measures |
| --- | --- | --- | --- |
| [built-ui-paired.mjs](built-ui-paired.mjs) | 2 | `candidates/direct-rgba-media-v1/built-ui-paired.mjs` | the built-UI journey: two new faces, first and repeat Save (identical bytes), a 32-frame morph to playable video, Save video, a first and a next photo through the encoder, Save |
| [morph-frame-product.mjs](morph-frame-product.mjs) | 2 | `candidates/morph-frame-pipeline-v1/` product harness | morph frame throughput at the product boundary: synthesized frames, frames written to video, per-frame time after 3 warm-up frames, playable video, Save video |

Revision 1 of the product harness imported `runtime.mjs` from a source tree; an artifact bundles its runtime, so
revision 2 drives the built UI and times the worker's `frame` messages instead.

## Contract

- **Artifacts by digest.** `--control DIR --control-digest SHA` and `--candidate DIR --candidate-digest SHA`. The digest
  is the tree SHA-256 of the directory (`scripts/hosting/stage.mjs` `treeDigest`). A mismatch is refused before a
  timing lock, server or a browser is touched. The default control is the pinned control artifact
  ([control.json](control.json)), never F# source or a rebuilt candidate. Without a candidate the run is control/control.
- **Origin.** The artifact is served at `https://next.facemorph.me` by classic's qualification server through the parity
  specs' `apps/web/test/parity/control-server.ts`, with the verified acquired runtime, and the browser reaches it
  through a host mapping. Measuring a deployed origin directly is not supported by revision 2: its bytes could not be
  verified against the digest first.
- **Timing admission.** A measured driver requires `autoresearch/run.py --exclusive gpu-timing` and checks `FACEMORPH_EXCLUSIVE` plus `FACEMORPH_RUN`. Correctness checks take no machine-wide lock.
- **Fresh label, no overwrite.** Outputs go to `<out root>/<label>/`; an existing label is refused. The out root is
  `--out-root`, else `$FACEMORPH_RESEARCH_RUNS`, else `~/Work/runs/facemorph-research` (the worker recipe names it).
- **Network.** Every request goes through the interception helper (`lib/session.mjs` `guardNetwork`): the origin and the
  project's catalogue Workers resolve, everything else is aborted; requests and bytes are counted by host class.
- **Failure evidence.** A failed sample keeps `trace.zip` and `failure.png` in its sample directory (local-only raw
  files); `report.json` is shareable.
- **Route and adapter.** `--route cpu|webgpu|auto` selects Processing mode. A WebGPU run needs a hardware adapter
  (`lib/adapter.mjs`); SwiftShader, llvmpipe and fallback adapters are rejected.
- **Load.** `--mode paired` refuses a host with load above 4 (before and between samples); `--mode smoke` records the
  load only. A smoke is not an evaluated outcome and never becomes a `results.tsv` row.

The driver supplies consent, the download dialog and files programmatically, so it cannot establish native chooser
latency; that needs the evaluator's adapters (deferred, fm-fy2.3).

Workers and their launch recipes: [eris](../workers/eris/README.md), [TrueNAS](../workers/truenas/README.md)
(blocked: fm-ip6g). Readiness: `node autoresearch/workers/check.mjs`. Tests: `node --test autoresearch/drivers/drivers.test.mjs`.

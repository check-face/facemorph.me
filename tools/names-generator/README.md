# Catalogue result generator (bead fm-a40f)

Makes one canonical, recovery-bearing 1024 px WebP for every catalogue name. Picking a name then needs no
inference and gives exactly what typing it gives. The producer is the pinned candidate runtime (classic
`a42829b`, runtime manifest `d9e37e50…`) in Chromium, driven through the candidate's own typed-name path
(`runtime.generate({mode: 'text'})`) and its own Save path (`downloadImage`: WebP q0.8 with the v2
envelope). Nothing calls `api.facemorph.me` or `checkface.facemorph.me`. Every browser request is recorded
by host, and a run that saw one fails.

Inputs: the published `catalogue.json` and the published W+ latents, restored from the names snapshot
(`scripts/names-snapshot/restore.mjs`, bead fm-old).

```sh
npm ci
node ../../scripts/names-snapshot/restore.mjs --out=$HOME/.cache/facemorph-names-generator/snapshot --all --mint-r2=<account id>
python3 ../../autoresearch/run.py --lane browser-gpu --device eris --timeout 3600 -- \
  node tools/names-generator/generate.mjs \
    --catalogue=$HOME/.cache/facemorph-names-generator/snapshot/facemorph-name-catalogue.cdilga.workers.dev/catalogue.json \
    --latents=$HOME/.cache/facemorph-names-generator/snapshot
```

The output is `results/<set>/<id>.webp` plus `manifest.jsonl` (one header line, then one line per row).
`<set>` is the first 16 hex characters of the result-set digest (runtime manifest, model and generation
identity, image encoding). Re-running resumes: a row already in the manifest for this set, with passing
checks and its file intact, is never regenerated.

Per-row checks, all recorded in the manifest:

- **latentCheck `exact`**: the W+ inside the written file, read back with the candidate's envelope reader,
  is byte-identical to the typed-name path's output, under the catalogue's generation identity.
- **referenceLatent**: that W+ is within 0.0001 (the frozen latent tolerance) of the published latent,
  which was derived independently with NumPy and the pinned CPU mapping. Runtimes differ only in the last
  float bits (2.8e-6 measured).
- **synthesisCheck**: the reference route's RGBA8 for the same W+ is within a max channel difference of 1
  of the producer's lossless output. By default the producer is the CPU route and the reference is
  WebGPU (direct WGSL; headless Chromium with Vulkan via ANGLE on eris, after waiting for a hardware adapter). Sampled raw-float error is covered by each route's
  canary qualification at start-up, which the candidate does not expose per face.

## Sampled typed-vs-catalogue check

```sh
python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 3600 -- \
  node tools/names-generator/sample-check.mjs --out=$HOME/.cache/facemorph-names-generator/out --samples=25
```

For a deterministic sample of valid rows (seed `fm-a40f`, `--seed` to change), in a fresh browser profile: the
name is typed through the candidate's typed-name path, the catalogue file's envelope is read with the
candidate's own reader, and the latent (SHA-256), generation and model identity must be identical; the catalogue
latent's raw synthesis must be within a max RGBA channel difference of 1 of the typed result's lossless output.
Every request is recorded by host; any API host fails the check.

Tests: `npm test`. These are the pure logic, plus a real kill-and-resume run on two names. That run
needs Chromium, the classic checkout (`FACEMORPH_CLASSIC`) and network access to the runtime assets.

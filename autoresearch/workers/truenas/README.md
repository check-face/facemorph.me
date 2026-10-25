# TrueNAS: research worker recipe, revision 2 (fm-qqh)

Revision 1 does not exist as a recipe: classic only documented TrueNAS as a CI lane (`PLAN.md`, development workers).
This is the first recipe for this repository, and it is **not yet executable**.

## Blocker (named, 24 October 2026)

- **No runner for this repository.** The TrueNAS runners `truenas` (labels `truenas, gpu-gtx1050, linux-x64`) and
  `truenas-gpu` (`truenas, linux-x64, gpu-vulkan`) are registered to `facemorph-me/facemorph.me-classic` only
  (`gh api repos/facemorph-me/facemorph.me-classic/actions/runners`, both online). This repository's runners are
  `eris-device-lab` and `triton`. Registering them is fm-ip6g, assigned to the operator.
- **No agent access.** eris has no SSH key accepted by the NAS (`root@` and `truenas_admin@192.168.11.12` refuse
  publickey), so no checkout, Node, browser or timing lock directory on it could be verified. Nothing here assumes them.
- **Timing configuration untested.** Its future runner account must share one `FACEMORPH_LOCK_DIR` for timing campaigns; correctness work needs no lease config.

So the recipe below has not been executed. Untested is not passed.

## Recipe, once fm-ip6g lands

| Field | Value |
| --- | --- |
| Worker and checkout | the `truenas-gpu` runner's job workspace (a clean clone of this repository per job); no standing checkout |
| Readiness | `node autoresearch/workers/check.mjs --lane browser-gpu --runtime "$RUNTIME"`: Node 24 or later, `npm ci` at the root (Playwright from `apps/web`), `CHROMIUM_PATH`, a shared timing lock directory, the verified acquired runtime, the pinned control artifact, load, and a **hardware** WebGPU adapter |
| Adapter | the GTX 1050's Vulkan ICD. The older `gpu-gtx1050` host configuration lacks the NVIDIA ICD and falls back to llvmpipe; `check.mjs` rejects llvmpipe/SwiftShader/lavapipe/fallback adapters, so that host is CPU-only until the ICD is present |
| Timing lock | `FACEMORPH_LOCK_DIR` or the runner account's `~/.cache/facemorph/locks` |
| Command | `python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 3600 -- node autoresearch/drivers/morph-frame-product.mjs --label "$LABEL" --route webgpu --runtime "$RUNTIME" --out-root "$OUT"` (or `built-ui-paired.mjs --route cpu`) |
| Fixtures | none beyond the control artifact's public preview face; no personal photos |
| Browser profile | a fresh profile per side under the run directory, deleted with it; never a shared or desktop profile |
| Durable outputs | a dataset path on the NAS outside the runner's work directory (to be named with fm-ip6g); the CI artifact is only a copy |

.NET/Fable: none needed; the drivers consume `deploy-next/` and build nothing.

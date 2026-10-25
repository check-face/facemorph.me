# eris: research worker recipe, revision 2 (fm-qqh)

Revision 1 is the frozen [`autoresearch/devices/eris/`](../../devices/eris/README.md) (classic `b2d945a`, byte-identical,
never edited). This revision is the maintained recipe for this repository: its paths, its drivers, the machine's
absolute lease directory. Verified on eris itself on 24 October 2026; the readiness output and the smoke runs are in
the [stage-2 smoke round](../../rounds/2026-10-24-stage2-smoke/log.md).

## Machine

Linux x86-64 (Omarchy), RTX 2080 SUPER 8 GB (Turing, driver 610.57), 12 threads, 31 GB, system Chromium 152, Node 26.
It is also the operator's desktop: check load first, never drive the desktop browser, and never use CDP port 9222
(an adb forward to the USB P30 Pro's Chrome). Every browser here is headless, with its own profile.

## Concurrency and measurements

Correctness builds, browser checks and GPU adapter probes share compute without a
machine-wide lease. Physical phone sessions serialize only against that device.
Timing alone requires the exclusive gpu-timing lock. The runner/drivers are being
updated: check `run.py --help` for `--exclusive` and use it for every measured
smoke/paired driver below once supported; defer timing until then. The older
`--lane`/`--device` arguments are not evidence of an exclusive lock.

## Launch recipe

| Field | Value |
| --- | --- |
| Checkout | `/home/cdilga/Work/dev/checkface/facemorph.me` (this repository; a CI job uses its runner workspace instead) |
| Dependencies | `npm ci` at the repository root (Playwright 1.64.1 resolves from `apps/web`); system `/usr/bin/chromium` (`CHROMIUM_PATH` overrides); Python 3 for `run.py` and classic's qualification server |
| Artifacts | `npm run build:next` fetches and verifies the pinned control into `deploy-next/` (`autoresearch/drivers/control.json`, tree SHA-256 `ecc4c357…a0fe`); a candidate is any deploy-next-shaped directory with its tree digest |
| Runtime | the verified acquired runtime `/home/cdilga/.cache/facemorph-runtime` (manifest `d9e37e50…`); the drivers re-verify every pinned file and fetch nothing |
| Readiness | `node autoresearch/workers/check.mjs --lane browser-cpu\|browser-gpu --runtime /home/cdilga/.cache/facemorph-runtime` |
| Device identity | `--device eris` (`p30pro` is the attached phone, locked separately by the lab) |
| Lease directory | `/home/cdilga/.local/state/facemorph/lease` (from `~/.config/facemorph/lease.json`; shared with classic, the device lab and CI on this machine) |
| Fixtures | the control artifact's public `preview/hello-1024.webp`, shifted per case outside timing; no personal photos |
| Browser profile | a fresh profile per side under the run directory (`profiles/<side>/`), never shared across runs |
| Durable outputs | `/home/cdilga/Work/runs/facemorph-research/<label>/` (`report.json`; `samples/NN-<side>/` with the server log, and the trace and screenshot of a failed sample). A label that already exists is refused. CI uploads a copy; the copy is a convenience, this directory is the record |

Commands (a fresh label each time; the digest is passed explicitly so the machine journal records it):

```sh
D=ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe
R=/home/cdilga/.cache/facemorph-runtime O=/home/cdilga/Work/runs/facemorph-research
# built-UI paired screen, CPU route (smoke: one sample per side; paired: warmup + ABBA x3, refuses load > 4)
python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 3600 -- \
  node autoresearch/drivers/built-ui-paired.mjs --label "LABEL" --mode smoke --route cpu \
  --control deploy-next --control-digest "$D" [--candidate DIR --candidate-digest SHA] --runtime "$R" --out-root "$O"
# morph frames on the RTX 2080 SUPER through WebGPU
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 3600 -- \
  node autoresearch/drivers/morph-frame-product.mjs --label "LABEL" --mode smoke --route webgpu \
  --control deploy-next --control-digest "$D" [--candidate DIR --candidate-digest SHA] --runtime "$R" --out-root "$O"
```

## Adapter

`check.mjs --lane browser-gpu` launches the drivers' Chromium with their GPU flags (Vulkan through ANGLE, as revision 1's
`launch-chromium.sh`) and admits only a hardware adapter: on eris `nvidia turing`. With SwiftShader forced
(`--software`) it reports a fallback adapter and refuses, exit 1. `requestAdapter()` answers null for the first
seconds after launch while the GPU process starts, so the probe asks again for up to 15 s.

Revision 1's known limit (the served CI artifact failing WebGPU with `Invalid Buffer`) did not reproduce on 24 October:
the served control ran its morph on WebGPU (`Ready · this device's GPU (webgpu).`).

## What revision 1 assumed, and where it stands

| Revision 1 assumption | Status here |
| --- | --- |
| No .NET SDK, so the F# site cannot be built; use the CI artifact | Still true and no longer a limit: this repository builds no F#, and the drivers consume `deploy-next/` |
| `gpu-bench.sh` and `gpu-bench-inpage.py` call classic's `scripts/next-gpu-benchmark.py` | Imported under `apps/web/scripts/`; the frozen scripts still name the classic path, so they run only from classic. Use `morph-frame-product.mjs` for the WebGPU route here |
| `artifact-bench.sh` serves with classic's `scripts/next-e2e-server.py`, `hosting/next-static/runtime-overlay` and `~/Work/runs/runtime-mirror` | Replaced by the drivers' server: `apps/web/test/parity/control-server.ts` with the verified acquired runtime |
| `png-stage-bench.mjs`, `png-variants.py`, `sha-bench.mjs` import `src/Next/...` | Those modules are under `apps/web/src/Next/` here; the frozen benches keep classic paths and run from classic |
| browser-harness in `~/Work/runs/venv-bh` with a per-run `BU_NAME` daemon | Not used by the maintained drivers (Playwright, one browser per sample); still present on eris for the frozen scripts |
| `autoresearch/state` (relative) as the lease directory | Replaced by the absolute machine lease directory above |
| Evidence in `~/Work/runs/<label>/`, copied into `autoresearch/artifacts/` | Durable outputs in `~/Work/runs/facemorph-research/<label>/`, cited by path from the round log; nothing copied into Git |
| Git rules: commit research to classic's candidate branch | Superseded: research happens in this repository on `main`, path-scoped commits; no new rounds in classic |

# Local device lab — verifiable GPU/CPU lanes on this Mac (+ triton)

Standing up **19 September 2026**, operator-authorised. Purpose: run the real product
pipelines (upload → crop → align → e4e, seed generation, morph/export) on phone-class
engines **locally and quickly**, with the route/GPU actually in use **verified and
recorded**, before assuming anything works. End-state matrix per operator direction:

| Lane | Engine | GPU path | Status |
|---|---|---|---|
| **iOS simulator** | Safari on the iOS 27.0 sim runtime (26.5 also installed; UA reports Version/27) | CPU expected; suite recorded `webgpuExposed` capability per run | **7/7 after the R2-15 repair fix** (was 4/7 with `Repair failed`) |
| **Android emulator** | Chrome 124 on API 35 `google_apis;arm64-v8a` (SwiftShader GPU, matching CI's `-gpu swiftshader_indirect`) | **WebGPU exposed ✓** (`capabilities.webgpuExposed` true) | **7/7 after the R2-15 repair fix** (was 4/7 with the identical `Repair failed` — the bug was never iOS-specific) |
| **Mac browsers** | Real Chrome 153 headless (Metal → M1 Pro GPU) via CDP; Playwright Chromium/WebKit/Firefox available | **WebGPU verified ✓**: adapter `vendor: apple, architecture: metal-3`, non-fallback (`scripts/gpu-probe.py`) | **Full `next-e2e-browser.py`: 5/6 stages pass** (seed+determinism, cache-hit repeat, **local crop**, photo e4e path, project reopen); `morphVideo` needs iteration (page context lost at the morph stage — likely headless renderer timing) |
| **TrueNAS GPU runner (GitHub self-hosted)** | Chrome-for-Testing on the TrueNAS host (x86_64, 24 cores, 125 GB RAM) with the **GTX 1050 (GP107)** via Vulkan/ANGLE | WebGPU on NVIDIA Pascal — verified by adapter info + admitted route | **LIVE 19 September**: runner `truenas` online on `check-face/facemorph.me` (labels `self-hosted,linux-x64,truenas,gpu-gtx1050`), installed as the systemd service `actions.runner.check-face-facemorph.me.truenas` (boot-durable), work dir `/mnt/tank/github-runner-work`. Lane jobs target `runs-on: [self-hosted, truenas]` |
| **triton** | GTX 1080 (no Intel iGPU exists there — `lspci` shows only the NVIDIA VGA) | same verification | When needed, the right shape is **another self-hosted GitHub runner** on triton (user-level install), not an ad-hoc tunnel; operator direction 19 September |

## The recipe (one harness, many lanes)

The CI qualification already solves "drive the real built site in a real browser":
`next-e2e-server.py` serves the artifact bytes with the pinned runtime overlay on
`https://127.0.0.1:8443` (self-signed), and the browser under test resolves
`next.facemorph.me` to it via `--host-resolver-rules`, with CDP exposed. `browser-harness`
attaches through `BU_CDP_URL` — **any** Chromium-with-CDP is therefore drivable by the same
e2e script, wherever it runs:

```sh
# server (once): python3 scripts/next-e2e-server.py \
#   --manifest-sha <sha256 of hosting/next-static/runtime-overlay/manifest.json> \
#   --runtime-overlay hosting/next-static/runtime-overlay --cert /tmp/next.crt --key /tmp/next.key

# Mac lane (real Chrome):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --ignore-certificate-errors --no-proxy-server --no-first-run \
  --host-resolver-rules='MAP next.facemorph.me:443 127.0.0.1:8443' \
  --remote-debugging-port=9222 --user-data-dir=/tmp/next-e2e-chrome-mac \
  --enable-unsafe-webgpu about:blank &
BU_CDP_URL=http://127.0.0.1:9222 browser-harness < scripts/next-e2e-browser.py

# Android lane (emulator booted, Chrome installed):
adb forward tcp:9222 localabstract:chrome_devtools_remote   # Chrome's devtools socket
BU_CDP_URL=http://127.0.0.1:9222 browser-harness < scripts/next-e2e-browser.py

# triton lane (Chrome-for-Testing unzipped under ~/, GPU = GTX 1080):
ssh -L 9222:127.0.0.1:9222 -N triton &                     # tunnel its CDP home
BU_CDP_URL=http://127.0.0.1:9222 browser-harness < scripts/next-e2e-browser.py
#   chrome flags on triton: --enable-unsafe-webgpu --use-angle=vulkan --use-gl=angle
```

Local heavy runs share the cooperative lease: `python3 autoresearch/run.py --lane
browser-cpu --device local-mac --wait 300 -- <command>`.

Component suite (cache/worker/PNG machinery) per phone-class lane:

```sh
python3 tests/mobile/run.py --platform ios --port 8766    # creates its own Simulator
python3 tests/mobile/run.py --platform android --port 8766 # needs booted emulator + Chrome
```

`--port` was added 19 September because the hard-coded 8765 collides with the operator's
`am` service; CI keeps the default.

## First findings from the lab (19 September)

**Fixed same-day:** the R2-15 repair fix (durable verified marker removed; digest once per
session; corrupt/vanished entries repaired on open) took both failing engines from 4/7 to
**7/7** — Android emulator Chrome 124 and iOS 27 sim Safari, verified by rerunning the suite.
The product also now repairs instead of dying on the operator's exact fatal
("Stored asset disappeared; acquire again" → honest `missing-after-acquire` event, visible
"repairing" state, re-download). Unit tests pin the repair contract and the stale-marker
regression (`model-cache.test.mjs`).

1. **iOS 27 sim Safari fails `corrupt-cache-repair`** (4/7 checks pass, then `Repair
   failed` at `suite.mjs:76`). Chrome semantics: a retained entry whose bytes fail the
   digest is discarded and re-acquired. This divergence sits directly beside
   `model-cache.mjs:234` — *"Stored asset disappeared; acquire again"* — the exact fatal
   error in the operator's iPhone screenshot. Working hypothesis: on iOS, entries written
   and re-read under storage pressure (or the repair path itself) behave differently, and
   the product turns a recoverable cache state into a **fatal** photo-workflow stopper.
   Test on a physical iPhone once the instrumented build exists.
2. **"failed to crop .jpg" is not a string in any shipped code** (tree, deployed bundle,
   git history). The visible fatal error in the operator's screenshot is the cache one; the
   crop message was either a transient engine error string surfaced via `PhotoError`
   (`Product.fs:215` shows the raw `e.message`) or a paraphrase. Action recorded in
   R2-15: engine errors on the photo path must be captured with context (exact stage,
   underlying message) instead of being shown raw, or iOS reports stay undiagnosable.
3. The audit's A-3 (faint dash remove control) and R2-8 (accent-bordered error box) are
   both visible in the operator's screenshot — already scheduled.

## Evidence discipline

Every lane run lands a JSON row: lane, UA, `webgpuExposed`, adapter
vendor/architecture/device, route admitted/refused, checks passed, timings, screenshot.
Simulator/emulator rows qualify **behaviour on that engine**, never a physical device —
same honesty rule as CI (`e4eExecuted`/`inferenceExecuted` stay false for component runs;
the e2e pipeline runs mark which stages executed). Physical iPhone/Android verification
remains a separate, required gate.

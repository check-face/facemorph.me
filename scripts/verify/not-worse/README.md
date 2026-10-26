# Not-worse workload lanes (fm-0q4h)

One scripted visitor workload with fixed finish boundaries, run against the pinned control artifact and any build
under test in ABBA order, so the strictly-not-worse gate (fm-mc27, `scripts/verify/not-worse.mjs`) is a run and not a
build project. The comparison math and the verdict are fm-mc27's; this directory produces the runs.

- `workload.ts`: boundaries, per-build selector maps, `measures`, `reliability`, `abbaSchedule`.
- `run.schema.json`: one run document per scheduled run.
- `run.ts`: the desktop-browser runner (below).
- `mobile.py`: the hosted mobile runner (Android emulator, iOS Simulator): each scheduled run is one execution of the
  hosted lane's own journeys (`tools/device-lab/hosted.py`), turned into the same run document.
- `summary.mjs`: `summary.json` for a run directory: medians per side, every scored pair's raw values, the per-pair
  ratio spread and, for control/control, the cell's noise margin per measure (`not-worse.mjs` `noiseMargin`).
- `plant.mjs`: planted copies of an artifact for proving the lanes see a defect: `slow` holds every Generate press for
  `--delay-ms` (cold, next and warm face each grow by it), `crash` exhausts the renderer heap on Create morph.
- `sides.sh`: the hosted jobs' control (fetched and verified) and planted build side.
- `fixtures/recorded/<cell>.json`: one control-side trace recorded on a real device, the input of the recorded-trace
  tests. `fixtures/trace-planted.json` is a planted input, not a recording.

## What a run does

A fresh profile and context per run. Visit 1 (cold): navigate, usable page, first face (word 1, including model
download), next face (word 2), first Save, repeat Save, Create morph (32 frames) to `canplaythrough`, the committed
one-face photo to its rendered photo face. Visit 2 (same profile, its models kept; the saved session and local storage dropped as the device lab's warm face
does, since a restored session disables the field): navigate, warm face (word 3). Boundaries are read
from the DOM through the selector map (a face boundary is a new face surface in its tile: a decoded image whose URL
changed or a drawn canvas whose 8x8 downsample changed, the tile no longer working) (`CONTROL_SELECTORS` for the control, `BUILD_SELECTORS` for a build), polling
every 10 ms in the page; timestamps are `performance.timeOrigin + performance.now()` taken in the page, so CDP
latency never enters one. Save's file-ready boundary is the browser download completing (Node clock, same wall
clock). Nothing is mocked or wrapped: the page side only listens (pointer, key, input, change), runs a
`requestAnimationFrame` gap observer and a `PerformanceObserver` for long tasks. The consent toast and download
dialog are answered by an in-page poll; the time each stayed up is a `wait` event and is excluded from every measure.

- A lockup is an input whose next paint came more than 1 s later, or a gap between animation frames over 1 s.
  Long tasks are kept in the trace's `observations` (not a measure).
- Bytes per visit are the response body sizes of every request the browser finished (Playwright `requestfinished`,
  the research drivers' network guard), summed per visit. Playwright's request interception turns the HTTP cache off,
  so the return visit re-fetches static assets; only models and storage the app keeps itself are warm.
- Peak memory is `performance.measureUserAgentSpecificMemory()` sampled after the morph, the photo and the return
  visit; `unreported` when the browser does not answer.
- Reliability: produced face, photo face and video; `crash` (page `crash`); unscripted navigations; `oom` only when
  the page reports an out-of-memory error (Linux Chromium gives no crash reason to Playwright, so a silent OOM kill
  shows up as `crash`); fallback when the caption's `data-next-route` differs from the requested provider; uncaught
  page errors.
- A stage that fails (timeout, app error, crop dialog) ends the run, which keeps its measures so far, the failure text
  in `<run>.trace.json`, and the Playwright trace and a screenshot.

## Running the desktop lanes

```sh
python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 3600 -- \
  node scripts/verify/not-worse/run.ts --control deploy-next --pairs 5 --provider cpu \
    --browser chromium --label <fresh label> --out /home/cdilga/Work/runs/facemorph-research
```

`--build <root> --build-digest <sha256>` adds the build under test; without it both sides are the control
(control/control noise). `--device <label>` names the cell's device where the host name would not (a container).
Outputs land in `<out>/<label>/`: `NN-<side>-<order>[-pK].json` (schema document), `.trace.json` (raw events and
observations, the failure text), `NN-*/failure.png` and `NN-*/trace.zip` for a failed run, `summary.json`
(`summary.mjs`), `untested.json` when a cell cannot run. Every run's log line names the cell, the side's digest, the
pair index and the order. Labels are never overwritten. The command cap is 3600 s per command, so a 5-pair CPU cell
(11 runs including the warmup) is the practical ceiling for one bounded command; a larger one is split across labels.

Planted defects (row 3 of fm-0q4h): `node scripts/verify/not-worse/plant.mjs --kind slow|crash --from <control
deploy-next> --out <dir>` prints the planted tree digest; pass it as `--build <dir> --build-digest <digest>`.

## Lanes

| Lane | How it runs | Status |
| --- | --- | --- |
| eris CPU | `run.ts --provider cpu --browser chromium`, the timing lock | run (see the bead comment for the pairs completed) |
| eris WebGPU | `run.ts --provider webgpu --browser system-chromium`, headed system Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-angle=vulkan --ignore-gpu-blocklist`, the timing lock. Without an adapter the cell writes `untested.json` with the reason and runs nothing | run, or untested with the adapter reason |
| Ubuntu CPU | `run.ts --provider cpu --browser chromium` on an Ubuntu 24.04 host (Playwright's Chromium headless shell), the timing lock. GitHub-hosted runners have no acquired runtime (CI never accepts model terms), so this cell runs on a development worker | run (see the bead comment) |
| Mac WebGPU | the same command on a self-hosted Mac, `--browser chromium`, under the timing lock | untested: no self-hosted Mac runner is registered |
| iOS Simulator | `.github/workflows/not-worse-mobile.yml` `ios` (dispatch): `mobile.py ios`, Safari in the iOS 18 Simulator through the hosted lane's injected journeys, the published runtime verified against the pinned manifest | dispatch on main |
| Physical iPhone | a scheduled job on the Mac the phone is connected to, Safari through `safaridriver`. Setup (not an approval step): Settings > Safari > Advanced > Remote Automation on the phone, `safaridriver --enable` once on the Mac. With no iPhone connected the job records the cell `untested` ("no iPhone connected") and exits | untested: no phone attached to a runner; driver not written |
| Android emulator | `not-worse-mobile.yml` `android` (dispatch): `mobile.py android`, Chrome on the API 35 emulator over CDP (the hosted lane's `AndroidChrome`) | dispatch on main |
| P30 Pro | through `tools/device-lab/lab.py`'s `phone-webgpu` and `phone-cpu` cells extended for ABBA pairs, under the lab lock; no second adb/Chrome loop | untested: lab.py extension not written |

Mobile safety: a lane uses only the routes the app admits on that device and never forces WebGPU on a phone the app
did not admit; a cell's requested provider is `auto` there, and `reliability().fallback` ignores `auto`.

The hosted mobile cells measure what their journeys reach: usable page, cold face, warm face, morph to a playable video
and per frame. Next face, photo encode and Save are null there, lockups and bytes are not observed (named in each
trace's `unmeasured`), peak memory is `unreported`.

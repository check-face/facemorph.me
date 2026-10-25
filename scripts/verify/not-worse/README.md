# Not-worse workload lanes (fm-0q4h)

One scripted visitor workload with fixed finish boundaries, run against the pinned control artifact and any build
under test in ABBA order, so the strictly-not-worse gate (fm-mc27, `scripts/verify/not-worse.mjs`) is a run and not a
build project. The comparison math and the verdict are fm-mc27's; this directory produces the runs.

- `workload.ts`: boundaries, per-build selector maps, `measures`, `reliability`, `abbaSchedule`.
- `run.schema.json`: one run document per scheduled run.
- `run.ts`: the desktop-browser runner (below). Every other lane records the same trace events and calls the same
  `measures()` and `reliability()`.
- `fixtures/recorded/<cell>.json`: one control-side trace recorded on a real device, the input of the recorded-trace
  tests. `fixtures/trace-planted.json` is a planted input, not a recording.

## What a run does

A fresh profile and context per run. Visit 1 (cold): navigate, usable page, first face (word 1, including model
download), next face (word 2), first Save, repeat Save, Create morph (32 frames) to `canplaythrough`, the committed
one-face photo to its rendered photo face. Visit 2 (same profile): navigate, warm face (word 1). Boundaries are read
from the DOM through the selector map (`CONTROL_SELECTORS` for the control, `BUILD_SELECTORS` for a build), polling
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
(control/control noise). Outputs land in `<out>/<label>/`: `NN-<side>-<order>[-pK].json` (schema document),
`.trace.json` (raw events and observations), `summary.json` (per-measure medians per side, n, the min and max of the
per-pair build/control ratio), `untested.json` when a cell cannot run. Labels are never overwritten. The command cap
is 3600 s per command, so a 5-pair CPU cell (11 runs including the warmup) is the practical ceiling for one bounded command; a
larger one is split across labels.

## Lanes

| Lane | How it runs | Status |
| --- | --- | --- |
| eris CPU | `run.ts --provider cpu --browser chromium`, the timing lock | run (see the bead comment for the pairs completed) |
| eris WebGPU | `run.ts --provider webgpu --browser system-chromium`, headed system Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-angle=vulkan --ignore-gpu-blocklist`, the timing lock. Without an adapter the cell writes `untested.json` with the reason and runs nothing | run, or untested with the adapter reason |
| Hosted Ubuntu CPU | the same command as eris CPU on a GitHub-hosted runner, an isolated hosted worker (local timing uses the timing lock) | untested: no workflow yet; wiring waits for the CI rebuild |
| Mac WebGPU | the same command on the self-hosted Mac, `--browser chromium`, under the timing lock | untested: not run on a Mac in this slice; wiring waits for the CI rebuild |
| iOS Simulator | the `mobile-browser.yml` `ios` lane gains a paired job driving Mobile Safari; the trace events and `measures()` are the same, the boundary reads go through WebDriver instead of `page.waitForFunction` | untested: needs a WebDriver driver for the simulator, not written in this slice |
| Physical iPhone | a scheduled job on the Mac the phone is connected to, Safari through `safaridriver`. Setup (not an approval step): Settings > Safari > Advanced > Remote Automation on the phone, `safaridriver --enable` once on the Mac. With no iPhone connected the job records the cell `untested` ("no iPhone connected") and exits | untested: no phone attached to a runner; driver not written |
| Android emulator | the `mobile-browser.yml` `android` lane gains a paired job (Chrome over CDP/adb) | untested: driver not written in this slice |
| P30 Pro | through `tools/device-lab/lab.py`'s `phone-webgpu` and `phone-cpu` cells extended for ABBA pairs, under the lab lock; no second adb/Chrome loop | untested: lab.py extension not written in this slice |

Mobile safety: a lane uses only the routes the app admits on that device and never forces WebGPU on a phone the app
did not admit; a cell's requested provider is `auto` there, and `reliability().fallback` ignores `auto`.

Wiring any lane as a workflow job waits for the CI rebuild (workflows are frozen while it is rebuilt); until then the
runs are made by hand under the timing lock, as above.

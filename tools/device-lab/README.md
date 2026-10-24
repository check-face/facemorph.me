# Device lab

The same end-to-end journeys on four cells, with no human in the loop. Agents run it on demand whenever their work
needs it, including on candidate builds before anything reaches next.facemorph.me. It is best effort: an unavailable
device never blocks a deploy or new work (PLAN.md "Device lab, deploy gates and CI policy"). There is no schedule.

| Cell | Device | Route it must take |
| --- | --- | --- |
| `eris-webgpu` | Chromium on eris (RTX 2080 SUPER), headed: headless Chromium gets no adapter there | WebGPU |
| `eris-cpu` | the same Chromium, headless, WebGPU switched off | CPU |
| `phone-webgpu` | Chrome on the USB Huawei P30 Pro, with `--enable-unsafe-webgpu --ignore-gpu-blocklist` | WebGPU |
| `phone-cpu` | Chrome on the same phone without flags: what a real visitor on this phone gets | CPU |

Chrome blocklists the phone's Android 10 Mali-G76 driver, so real visitors on it get CPU. The flagged cell
shows what works on devices that do have WebGPU enabled. Forcing Vulkan compositing as well
(`--enable-features=Vulkan`) left pages white and untouchable, so only the two flags above are used.

Journeys: `cold-face` (site data and models cleared), `warm-face` (models kept, session cleared), and
`morph` (two faces to a playable video). Each cell fails if the route shown differs from the one it must take.

## How agents use it (on demand)

The swarm is fungible: no tester or shipping agent. Any agent whose bead needs device evidence runs the lab itself.
- **On eris:** run `lab.py` directly. The lab's lock is the device lease: a second session waits its turn.
- **From anywhere:** dispatch the workflow,
  `gh workflow run device-lab.yml -R check-face/facemorph.me -f artifact_run=<run id> -f artifact_name=next-site-<sha>`,
  or `-f url=...`.
- **A candidate before it deploys:** `lab.py qualify --run <CI run id>` fetches that build's artifact and runs all
  four cells against it, served locally under the production origin. A local build directory works with
  `matrix --artifact DIR`.
- **Scheduling:** through beads, not cron. When a candidate needs checking, create or pick up a bead for it, and
  close it with the run's `summary.md`.

## Use

```sh
cd tools/device-lab
uv run --with playwright python lab.py preflight
uv run --with playwright python lab.py matrix                                   # all cells, production
uv run --with playwright python lab.py matrix --cells phone-webgpu --journey cold-face,warm-face
uv run --with playwright python lab.py matrix --artifact DIR --runtime-sha SHA  # an exact candidate build
uv run --with playwright python lab.py camera status|pause|resume|off|on
uv run --with playwright python lab.py recover
```

`--artifact` serves a candidate's `next-site-<sha>` artifact (a `deploy-next/` directory) under the production
origin with classic's qualification server (`CLASSIC_CHECKOUT`, default `../../../facemorph.me-classic`).
eris Chromium reaches it through host-resolver rules, and the phone reaches it through `adb reverse`. The runtime
tree is cached in `~/.cache/facemorph-device-lab/` (2.8 GB on first build). Local-mode cold faces skip the internet
download, so compare their times only with other local runs.

Each run writes `out/<timestamp>-<label>/`: `summary.md` and `summary.json`, one JSON per cell (device facts,
per-iteration timings, route, `typedExactly`, peak Chrome memory on the phone, temperatures), a screen recording
(phone) or Playwright trace (eris) of each failed iteration, and screenshots. In CI the summary also goes to the
job summary.

## CI

- `.github/workflows/device-lab.yml` runs on the self-hosted runner `eris-device-lab` (label `device-lab`): on
  demand (dispatch, with an optional candidate artifact) and as a reusable workflow for release validation and
  post-deploy checks. It is not a hard gate on classic's candidate deploys. It has no `pull_request` trigger, so fork code never reaches eris.
- The runners are systemd user services on eris: `gh-runner-facemorph` and `gh-runner-facemorph-classic` in
  `~/gh-runners/`. They have the desktop display in their environment, for headed Chromium.
- Concurrency: one `device-lab` run at a time, newest waiting run next; the lab's own lock also waits up to
  `LAB_LOCK_WAIT` seconds (default 3600) behind a local session.

## How it works

- **Real input:** taps on the phone are OS taps (`adb shell input tap`) and clicks on eris are mouse clicks, both
  at the control's visible centre. Before each action, `elementFromPoint` must be the intended control; afterwards,
  the real pointer's target must be inside it. A tap Chrome dropped before the first paint is retried, and one that
  hit the wrong element fails. Text goes in through the real keyboard; the run records whether the field holds
  exactly what was typed.
- **Clean data:** every page gets `navigator.globalPrivacyControl = true`, so Google Analytics and the changeover
  statistics ignore lab runs.
- **Phone session:** Chrome cold-starts (clearing leftover dialogs), the screen stays on, rotation is locked to
  portrait, pop-up notifications are off, and Chrome's debug flags are set for the cell. Everything is restored
  afterwards, on SIGTERM/SIGHUP, or by the next run (`recover`). Each iteration waits for the battery to cool to
  40 °C, because heat throttles the CPU.
- **Frigate camera:** currently **held off** at the operator's request (24 October 2026) until they ask for it back
  (`camera on`). The phone is also the `p30pro` camera IP Webcam on :8080 with the
  `dev.dilger.camera.watchdog` app): sessions pause and restore it (about 17 s) unless it is held off
  (`camera off`; `camera on` resumes). Pausing makes Huawei drop the watchdog's accessibility service, so its
  settings are saved and restored. With that service bound, uiautomator dumps omit popups, so the restore taps
  IP Webcam's ⋮ > Start server by offset. Stream check from the server VLAN: `ssh triton 'curl -s -o /dev/null -w
  %{http_code} http://192.168.20.7:8080/'` (401 means serving).

## Known limits

- Android 10 is this phone's last OS and the bootloader is locked; Chrome updates independently. Google Play
  services are deliberately disabled on the phone.
- The phone reports battery temperature only.

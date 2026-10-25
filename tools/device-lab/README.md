# Device lab

The lab has adapters for six named cells, sharing the existing journeys and real-input helpers.
Agents run it on demand for affected work, including candidate builds. Unavailable hardware does not block
ordinary development; it is recorded untested. There is no schedule.

**Release target (operator, 25 October 2026): six local cells**, CPU and WebGPU in Chrome on Linux eris,
Firefox on Linux eris, and Chrome on the actual Huawei P30 Pro, against the deployed next.facemorph.me
artifact, plus normal applicable CI. Adapter support is not six-cell release qualification. Missing local
evidence leaves handover incomplete. The table below names the implemented adapters. Record the actual
executable/version/distribution; system Chromium is refused as Chrome. Hosted iOS Simulator/Android emulator lanes are additional, best effort for
runner availability; a real executed test failure requires repair.

During iteration, reuse existing scripts and direct browser-protocol helpers before interactive harnesses
or coordinate taps. Use actual input where the journey tests operated controls; scripts must not bypass
that contract. Reuse warm setup only when the case permits it. Disposable probes stay outside Git, and
task-owned servers, profiles, ADB mappings and device flags are cleaned up/restored after use.

| Cell | Device | Route it must take |
| --- | --- | --- |
| `eris-webgpu` | Google Chrome on eris, headed, `--enable-unsafe-webgpu --ignore-gpu-blocklist` | WebGPU |
| `eris-cpu` | Google Chrome, headless, `--disable-features=WebGPU` | CPU |
| `eris-firefox-webgpu` | Firefox on eris, headed, `dom.webgpu.enabled=true`, `dom.webgpu.force-enabled=true` | WebGPU |
| `eris-firefox-cpu` | Firefox, headless, both WebGPU preferences false | CPU |
| `phone-webgpu` | Chrome on the USB Huawei P30 Pro, with `--enable-unsafe-webgpu --ignore-gpu-blocklist` | WebGPU |
| `phone-cpu` | Chrome on the same phone without flags: what a real visitor on this phone gets | CPU |

Chrome blocklists the phone's Android 10 Mali-G76 driver, so real visitors on it get CPU. The flagged cell
shows what works on devices that do have WebGPU enabled. Forcing Vulkan compositing as well
(`--enable-features=Vulkan`) left pages white and untouchable, so only the two flags above are used.

`LAB_CHROME` selects an explicit Google Chrome executable; otherwise the lab searches `google-chrome`
and `google-chrome-stable` on PATH. It does not fall back to `/usr/bin/chromium`. A cached executable
that actually reports **Google Chrome for Testing** can be selected explicitly and is labelled with that
version and its distribution. `LAB_FIREFOX` selects a Playwright-compatible Firefox executable;
otherwise the Python Playwright package selects its cached Firefox build. An arbitrary stock
Firefox binary may lack Playwright's protocol; a launch failure is not substituted evidence.
Reports include launcher, version, lab flags/preferences, observed process command line when readable,
secure-context adapter probe and actual journey URLs. Unsupported WebGPU remains untested.
Both desktop Chrome cells include `--enable-automation` so CDP can record their full command line.

Journeys: `cold-face` (site data and models cleared), `warm-face` (models kept, session cleared), and
`morph` (two faces to a playable video). Each cell fails if the route shown differs from the one it must take.

## How agents use it (on demand)

The swarm is fungible: no tester or shipping agent. Any agent whose bead needs device evidence runs the lab itself.
- **On eris:** run `lab.py` directly against the exact artifact. Physical phone sessions
  serialize against the phone only; eris cells serialize against eris lab sessions only.
  `LAB_LOCK_WAIT` defaults to 300 seconds; a busy device exits 75. Ordinary CI, builds,
  browser/GPU correctness checks and research work do not take this lab lock.
- **Physical phones never run in CI.** Run them locally during development and at
  release handover. Hosted Android/iOS simulator coverage currently lives in the release gate.
- **A candidate before it deploys:** `lab.py qualify --run <CI run id>` fetches that build's artifact and runs all
  six cells against it. Evidence goes to every bead named in any
  commit since the last qualified one (CI is newest-only, so one build can carry several beads); `--since <sha>`
  overrides the starting point. Without a recorded start, or when the compare is unusable, only the head commit is
  scanned and the log says why. `summary.md` names the beads, and the tested commit is recorded per repository
  (`qualified.json` beside the lab state) after every run, pass or fail. A local build directory works with
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
LAB_CHROME=/path/to/google-chrome uv run --with playwright python lab.py run --cell eris-cpu --journey operated
uv run --with playwright python lab.py run --cell eris-firefox-cpu --journey operated
uv run --with playwright python lab.py camera status|pause|resume|off|on
uv run --with playwright python lab.py recover
```

`--artifact` accepts an artifact root containing `deploy-next/` and `next-site-identity.json`, or its
`deploy-next/` subdirectory. The existing build identity verifier checks every artifact file before launch.
`--artifact-digest SHA` additionally requires the integrated-verification digest (SHA256 of sorted
`<file-sha256>  deploy-next/<path>\n` lines). Each face journey hashes the document actually loaded and
rejects a mismatch with that verified artifact. The qualification server comes from this checkout
(`FACEMORPH_CHECKOUT` overrides it). Chrome reaches its production origin through host-resolver rules,
and the phone through `adb reverse`. Firefox reaches the same TLS server at `https://localhost:8443/`;
that actual origin is explicitly recorded. This is local candidate evidence, not post-deploy evidence. The runtime
tree is cached in `~/.cache/facemorph-device-lab/` (2.8 GB on first build). Local-mode cold faces skip the internet
download, so compare their times only with other local runs.

Each run writes `out/<timestamp>-<label>/`: `summary.md` and `summary.json`, one JSON per cell (device facts,
per-iteration timings, route, `typedExactly`, peak Chrome memory on the phone, temperatures), a screen recording
(phone) or Playwright trace (eris) of each failed iteration, and screenshots. In CI the summary also goes to the
job summary.

An `operated`-only run hashes the real fixture and reports `kind=operated-fixture`; it does not qualify a
product artifact or prove synthesis used WebGPU. Live URL runs currently lack deployed-artifact attestation:
their journeys can execute, but missing verified artifact identity leaves the result untested/incomplete.
Post-deploy identity binding and release-summary consumption still need implementation. A targeted matrix
also lists missing required cells; passing its subset is not a six-cell release pass.

Targeted checks: `python -m unittest test_browsers test_journeys test_lab_lock`. For real Firefox operated
and cold/warm storage contracts: `LAB_REAL_BROWSERS=1 uv run --with playwright python -m unittest test_browsers`.
These use real processes, temporary artifact files and browser storage; no network response replay.

### The operated-input contract (`--journey operated`, fm-48bj)

`lab.py run --cell <cell> --journey operated` runs the verification harness's operated-input contract on real input.
It uses the defect-1 regression page (`apps/web/test/fixtures/verify/operated.html`), served from this checkout,
and reaches the phone through `adb reverse`. A real OS tap (phone) or mouse click (eris) must press:
- the visible Remove;
- a transformed control;
- a nested control;
- a control far down the page.

Three controls must be refused before any input is sent:
- the Remove covered by the mode-menu button (defect 1);
- a control its container clips;
- an off-screen control.

The TS harness (`apps/web/test/verify/operated.ts`) applies the same rules in Playwright:
- scroll only as a person can (never inside an `overflow: hidden` container);
- the centre must be inside the viewport;
- `elementFromPoint` there must be the control;
- after the press, the pointer must land inside it.

Every tap in every journey follows these rules. Each step is recorded in the cell's JSON under `operated.steps`.

## Cold full-package downloads

`download.py` (fm-vf9l) runs the download a first visitor starts from the model toast ("Plus photo encoder",
about 1.3 GB) from an empty origin on `eris-cpu`, `eris-webgpu` and `phone-cpu`. It records bytes reached over
time, every runtime request with the origin that answered it, each retried chunk and who finally served it, the
terminal event and its stage, the served app bundle, and on eris the host's own network changes (Chromium aborts
in-flight requests on any of them). Interruptions are real: Wi-Fi off and on through adb on the phone (it has
no SIM), and on eris a local CONNECT proxy with a throttle and a fault switch that either resets open tunnels
(`--cut drop`) or silences them for good (`--cut blackhole`). It takes the same per-device lab lock as
`lab.py`, and the Frigate camera must be held off for the phone cell.
This download diagnostic retains its existing Chromium adapter and reports that browser explicitly;
it is not named Chrome/Firefox release evidence. Firefox cells are rejected before device access.

```sh
uv run --with playwright python download.py --cells eris-cpu,eris-webgpu,phone-cpu --repeat 3
uv run --with playwright python download.py --cells phone-cpu --interrupt 0.35:30
uv run --with playwright python download.py --cells eris-cpu --interrupt 0.35:30 --cut blackhole
uv run --with playwright python download.py --cells eris-cpu --throttle-kbps 3000
```

## CI

- `.github/workflows/device-lab.yml` runs on the self-hosted runner `eris-device-lab` (label `device-lab`): on
  demand (dispatch, with an optional candidate artifact) and as a reusable workflow for release validation and
  post-deploy checks. It is not a hard gate on classic's candidate deploys. It has no `pull_request` trigger, so fork code never reaches eris.
- The runners are systemd user services on eris: `gh-runner-facemorph` and `gh-runner-facemorph-classic` in
  `~/gh-runners/`. They have the desktop display in their environment, for headed Chromium.
- Concurrency: main.yml controls the main queue. Lab per-device locks have bounded waits;
  a phone run never holds up an eris cell. CI does not use the physical phone.
- Implemented journey names are cold-face, warm-face, morph and operated. Unknown names
  fail. Frozen per-cell wall-clock budgets are not implemented yet; do not claim them.

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

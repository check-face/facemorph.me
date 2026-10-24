# Physical Android device lab

A human-free, repeatable test loop on a real phone: the Huawei P30 Pro (VOG-L29, Android 10 / EMUI 11,
Kirin 980, 8 GB) connected to eris over USB. It is a cell of the strictly-not-worse gate (PLAN.md
"Strictly not worse than the candidate") and of any check that needs a physical Android phone.

The same phone is the `p30pro` Frigate camera (IP Webcam on port 8080, kept alive by the
`dev.dilger.camera.watchdog` app and its accessibility service). Every session pauses the camera
and restores it, including after a failure or a kill.

## Use

```sh
cd tools/device-lab/android
uv run --with playwright python lab.py preflight            # device, battery, temperature, Chrome, camera
uv run --with playwright python lab.py run --url https://next.facemorph.me/ \
    --journey cold-face,warm-face,morph --repeat 5 --label candidate
uv run --with playwright python lab.py camera status|pause|resume
uv run --with playwright python lab.py recover               # undo whatever a killed session left behind
```

Each run writes `out/<timestamp>-<label>/report.json` (device facts, per-iteration timings, route,
`typedExactly`, peak Chrome memory, battery temperature, camera state before and after) and
screenshots on failure.

## How it works

- **Control:** adb from `~/Android/Sdk/platform-tools/adb` (override with `ADB`, `ANDROID_SERIAL`).
  USB debugging is authorized permanently for eris's key (one-time "Always allow" on the phone).
- **Browser:** the phone's own Chrome over the DevTools protocol (`adb forward tcp:9222
  localabstract:chrome_devtools_remote`), driven by Playwright `connect_over_cdp`. Each session uses a
  fresh tab brought to the front.
- **Operated input:** taps are real OS taps (`adb shell input tap`) at the element's visible centre,
  mapped from CSS to screen pixels by a calibration tap. Before every tap, `elementFromPoint` must be
  the intended element, or the step fails. Text goes in through the phone's real keyboard
  (`input text`), and the run records whether the field holds exactly what was typed.
- **Clean data:** each page gets `navigator.globalPrivacyControl = true` before load, so Google
  Analytics and the changeover statistics ignore lab runs. Cold runs clear the origin's site data and
  Chrome's cache.
- **Session:** screen kept on and rotation locked to portrait during the run; the previous settings are
  saved to `~/.cache/facemorph-device-lab/session.json` and restored at the end, on SIGTERM/SIGHUP/Ctrl-C,
  or by the next run (`recover`). A lock file stops two sessions driving the phone at once.
- **Camera pause:** force-stop the watchdog, then IP Webcam. Huawei then drops the watchdog's
  accessibility service from the enabled list, so its settings are saved first.
- **Camera restore:** restore the accessibility settings, launch the watchdog, open IP Webcam and pick
  overflow menu > Start server (by keyboard, because uiautomator dumps omit popup windows while the
  watchdog's accessibility service is bound). Done when port 8080 listens and the recovery service is
  bound; measured at 16–17 s per cycle. Reachability from the server VLAN (where Frigate is) can be
  checked with `ssh triton 'curl -s -o /dev/null -w %{http_code} http://192.168.20.7:8080/'` (401 means
  serving, login required).

## Known limits

- Android 10 is this phone's last OS (EMUI 12 is still Android 10 underneath; the bootloader cannot be
  unlocked). Chrome updates independently and is what the app runs in.
- The phone reports battery temperature only; runs refuse to start above 42 °C and record it per
  iteration.

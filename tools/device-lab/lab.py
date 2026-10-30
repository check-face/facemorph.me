#!/usr/bin/env python3
"""FaceMorph device lab: shared end-to-end journeys on six named local cells.

Cells: eris-webgpu, eris-cpu (Google Chrome on eris), eris-firefox-webgpu, eris-firefox-cpu,
phone-webgpu, phone-cpu
(Chrome on the USB-connected Huawei P30 Pro, VOG-L29). Every cell asserts the route that actually ran.

  uv run --with playwright python lab.py matrix [--url URL | --artifact DIR --runtime-sha SHA] [--cells ...]
  uv run --with playwright python lab.py run --cell phone-cpu --journey cold-face,warm-face,morph --repeat 3

The rest of this docstring describes the phone side.

The phone doubles as the `p30pro` Frigate camera (IP Webcam + the dev.dilger.camera.watchdog app).
Every session pauses the camera, runs, and restores it, even on failure, then proves the stream is
back on port 8080.

  uv run --with playwright python lab.py preflight
  uv run --with playwright python lab.py run --url https://next.facemorph.me/ --journey cold-face,warm-face,morph --repeat 3 --label candidate
  uv run --with playwright python lab.py camera status|pause|resume

Runs drive real Chrome over the DevTools protocol (adb forward to chrome_devtools_remote) and act
with real OS taps (`adb shell input tap`) at the element's visible position, after checking with
elementFromPoint that the element there is the intended control. Analytics and the changeover
statistics are kept clean: every page gets navigator.globalPrivacyControl = true before load.
Results: out/<timestamp>-<label>/report.json plus screenshots.
"""
import argparse, hashlib, json, os, re, shutil, socket, subprocess, sys, threading, time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ADB = os.environ.get('ADB', str(Path.home() / 'Android/Sdk/platform-tools/adb'))
SERIAL = os.environ.get('ANDROID_SERIAL', 'DUM0220115002146')
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CHROMIUM = os.environ.get('CHROMIUM', '/usr/bin/chromium')
CHECKOUT = Path(os.environ.get('FACEMORPH_CHECKOUT', HERE.parents[1]))
ORIGIN_HOST = 'next.facemorph.me'
LOCAL_PORT = 8443
CHROME_FLAGS_FILE = '/data/local/tmp/chrome-command-line'
# Chrome blocklists this Android 10 / Mali-G76 driver, so real visitors on this phone get the CPU
# route. These two debug flags give pages a WebGPU adapter while Chrome keeps its normal GL
# compositing; also forcing Vulkan compositing (--enable-features=Vulkan) left pages painted white
# and untouchable after navigation (24 Oct 2026).
PHONE_WEBGPU_FLAGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
CELLS = {'eris-webgpu': ('desktop', True), 'eris-cpu': ('desktop', False),
         'eris-firefox-webgpu': ('desktop', True), 'eris-firefox-cpu': ('desktop', False),
         'phone-webgpu': ('phone', True), 'phone-cpu': ('phone', False)}
PHONE_LEASE = 'p30pro'  # the phone, for the devices a session reports
# The authoritative journey list and per-cell budgets (fm-journey-registry-5cpg).
REGISTRY = json.loads((HERE / 'journeys.json').read_text())['journeys']
JOURNEYS = frozenset(name for name, entry in REGISTRY.items() if entry.get('implemented'))


class Untested(RuntimeError):
    """A required browser/capability is unavailable; this is never a passing cell."""


def browser_identity(executable, family):
    if not executable or not Path(executable).is_file():
        raise Untested(f'{family} executable missing: {executable!r}')
    result = subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=15, check=True)
    version = result.stdout.strip()
    pattern = r'^Google Chrome(?: for Testing)? \d' if family == 'chrome' else r'^Mozilla Firefox \d'
    if not re.search(pattern, version):
        raise Untested(f'{executable} identifies as {version!r}, not {family}')
    return {'family': family, 'executable': str(Path(executable).resolve()), 'version': version}


def artifact_evidence(artifact, expected=None):
    """Reuse the build's complete identity verifier and the integrated verification digest format."""
    path = Path(artifact).resolve()
    root = path.parent if path.name == 'deploy-next' else path
    script = """import {readIdentity} from './scripts/import/build-next.mjs';
const {identity,findings}=readIdentity(process.argv[1]);
if(!identity||findings.length)throw Error(JSON.stringify(findings));
console.log(JSON.stringify(identity));"""
    result = subprocess.run(['node', '--input-type=module', '-e', script, str(root)], cwd=REPO,
                            capture_output=True, text=True, timeout=60, check=True)
    identity = json.loads(result.stdout)
    lines = sorted(f"{f['sha256']}  {f['path']}\n" for f in identity['files'] if f['path'].startswith('deploy-next/'))
    digest = hashlib.sha256(''.join(lines).encode()).hexdigest()
    if expected and digest != expected:
        raise ValueError(f'artifact digest {digest} is not expected {expected}')
    return {'digest': digest, 'kind': identity['kind'], 'source': identity['deploySource'],
            'directory': str(root / 'deploy-next'), 'files': identity['files']}


HOSTING_CONFIG = {'_headers', '_redirects'}  # read by the host, never served


def fetch_bytes(url):
    import urllib.request
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'facemorph-device-lab'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# Cloudflare's zone Web Analytics beacon, injected into served HTML at the edge on the facemorph.me zone, outside the
# artifact (scripts/delivery/post-delivery-check.mjs PLATFORM_BEACON). It is removed, at most once per page, before
# the bytes are compared; everything else must match exactly.
# The edge inserts `<script …></script>\n` right before `</body>`, after the page's own indentation, which stays.
PLATFORM_BEACON = re.compile(rb'<script[^>]*\bsrc="https://static\.cloudflareinsights\.com/beacon\.min\.js[^"]*"[^>]*></script>\n?')


def without_platform_beacon(rel, body):
    """The served bytes as built: an HTML page loses the edge's one beacon element; a second one is not removed. Pure."""
    if not rel.endswith('.html'):
        return body, 0
    stripped, n = PLATFORM_BEACON.subn(b'', body, count=1)
    return stripped, n


def deployed_evidence(artifact, url, expected=None, fetch=fetch_bytes):
    """The artifact's digest, bound to a live URL only when that URL serves every one of its files byte for byte
    (apart from the zone's platform beacon in HTML pages)."""
    evidence = artifact_evidence(artifact, expected)
    base, differ, beacons = url.rstrip('/') + '/', [], 0
    for f in evidence['files']:
        rel = f['path'].removeprefix('deploy-next/')
        if rel == f['path'] or rel in HOSTING_CONFIG:
            continue
        try:
            body, n = without_platform_beacon(rel, fetch(base + rel))
            served, beacons = hashlib.sha256(body).hexdigest(), beacons + n
        except Exception as e:
            served = str(e)
        if served != f['sha256']:
            differ.append(rel)
    if differ:
        raise ValueError(f'{url} does not serve this artifact: {len(differ)} files differ, e.g. {", ".join(differ[:5])}')
    return {**evidence, 'kind': 'deployed', 'url': url, 'platformBeaconPages': beacons}


def validate_journeys(value):
    names = value.split(',')
    unknown = set(names) - set(REGISTRY)
    if unknown:
        raise ValueError('unknown journey (not in journeys.json): ' + ', '.join(sorted(unknown)))
    pending = [n for n in names if n not in JOURNEYS]
    if pending:
        raise ValueError('pending journey, not implemented yet: ' +
                         ', '.join(f"{n} ({REGISTRY[n].get('owner', 'unowned')})" for n in pending))
    return names


def budget_findings(cell, runs):
    """Each executed journey's wall-clock duration against its frozen budget for this cell."""
    findings = []
    for run in runs:
        for journey, seconds in (run.get('durationsS') or {}).items():
            entry = REGISTRY.get(journey)
            if not entry or not entry.get('implemented'):
                findings.append(f'journey {journey} is not in the registry')
                continue
            budget = (entry.get('budgetsS') or {}).get(cell)
            if budget is not None and seconds > budget:
                findings.append(f'{journey} took {seconds:.1f}s on {cell}, over its {budget}s budget')
    return findings


def budget_rows(reports):
    """Markdown rows: every executed journey's durations against its budget, or unbudgeted."""
    rows = []
    for r in reports:
        seen = {}
        for run in r.get('runs') or []:
            for journey, seconds in (run.get('durationsS') or {}).items():
                seen.setdefault(journey, []).append(seconds)
        for journey, durations in seen.items():
            budget = ((REGISTRY.get(journey) or {}).get('budgetsS') or {}).get(r['cell'])
            verdict = ('unbudgeted' if budget is None else
                       'over budget' if max(durations) > budget else 'within budget')
            shown = '/'.join(f'{s:.0f}s' for s in durations)
            rows.append(f"| {r['cell']} | {journey} | {shown} | {'–' if budget is None else f'{budget}s'} | {verdict} |")
    return rows


# A phone cell over its absolute budget on a live site still passes when it is not worse than the pinned control measured
# back to back on the same phone and link, by the release timing rule: worse means over 1.15x AND more than 50 ms
# slower (scripts/verify/not-worse/median-check.mjs; operator, 28 October 2026). The budgets themselves never change.
# Three alternating pairs, control first, and their medians decide, as in the CPU timing; a pair is never retried.
NOT_WORSE_RATIO, NOT_WORSE_FLOOR_S, NOT_WORSE_PAIRS = 1.15, 0.05, 3
OVER_BUDGET = re.compile(r'^(?P<journey>[\w-]+) took [\d.]+s on [\w-]+, over its \d+s budget$')


def _median(xs):
    s = sorted(xs)
    return (s[len(s) // 2] + s[(len(s) - 1) // 2]) / 2


def not_worse_rows(candidate, control):
    """Per journey: its budget, the candidate's and the control's median durations, and the verdict. Pure."""
    rows = []
    for journey in candidate.get('journeys') or []:
        mine = [r['durationsS'][journey] for r in candidate.get('runs') or [] if journey in (r.get('durationsS') or {})]
        if not mine:
            continue
        theirs = [r['durationsS'][journey] for r in control.get('runs') or []
                  if r.get('ok') and journey in (r.get('durationsS') or {})]
        budget = ((REGISTRY.get(journey) or {}).get('budgetsS') or {}).get(candidate['cell'])
        c, k = _median(mine), (_median(theirs) if theirs else None)
        if budget is None or c <= budget:
            verdict = 'within budget'
        elif k is not None and not (c > k * NOT_WORSE_RATIO and c - k > NOT_WORSE_FLOOR_S):
            verdict = 'not worse than the control'
        else:
            verdict = 'over budget and worse than the control' if k is not None else 'over budget; control unmeasured'
        rows.append({'journey': journey, 'budgetS': budget, 'candidateS': round(c, 1),
                     'controlS': None if k is None else round(k, 1), 'verdict': verdict})
    return rows


def defer_budgets(report, journeys):
    """A phone cell's absolute-budget breaches on these journeys are judged by the phone pairs against the pinned
    control (a later step), not here; every other finding stands. Pure apart from the report it updates."""
    errors = report.get('evidenceErrors') or []
    deferred = [e for e in errors if (m := OVER_BUDGET.match(e)) and m['journey'] in journeys]
    if deferred:
        report['budgetDeferredToPairs'] = deferred
        report['evidenceErrors'] = [e for e in errors if e not in deferred]
        report['ok'] = not report['evidenceErrors'] and all(r.get('ok') for r in report.get('runs') or [])
        if report['ok']:
            report['status'] = 'pass'
    return report


def merge_pairs(reports):
    """One report from a cell's alternating runs on one side: every run, every finding except per-run budget breaches
    (the medians decide those), and ok only if each run was. Pure."""
    merged = {**reports[0], 'runs': [run for r in reports for run in r.get('runs') or []]}
    merged['evidenceErrors'] = list(dict.fromkeys(e for r in reports for e in r.get('evidenceErrors') or []))
    merged['ok'] = all(r.get('ok') for r in reports)
    merged['status'] = 'pass' if merged['ok'] else next((r['status'] for r in reports if not r.get('ok')), 'fail')
    return merged


def apply_not_worse(candidate, control):
    """Attach the comparison; a budget breach on a journey judged not worse stops counting against the cell."""
    rows = not_worse_rows(candidate, control)
    candidate['controlComparison'] = {'url': control.get('url'), 'controlStatus': control.get('status'), 'rows': rows}
    excused = {r['journey'] for r in rows if r['verdict'] in ('within budget', 'not worse than the control')}
    kept = [e for e in candidate.get('evidenceErrors') or []
            if not ((m := OVER_BUDGET.match(e)) and m['journey'] in excused)]
    if kept != (candidate.get('evidenceErrors') or []):
        candidate['evidenceErrors'] = kept
        candidate['ok'] = not kept and all(r.get('ok') for r in candidate.get('runs') or [])
        if candidate['ok']:
            candidate['status'] = 'pass'
    return candidate


CHROME = 'com.android.chrome'
WEBCAM, WATCHDOG = 'com.pas.webcam', 'dev.dilger.camera.watchdog'
CDP_PORT = 9222

# The candidate's locator contract (facemorph.me-classic scripts/next-e2e-browser.py, S).
S = {
    'product': '.next-product',
    'faceImage': '.next-face-image img:not([data-public-preview]), .next-face-image canvas[data-face-drawn="true"]',
    'faceText': '.next-face input[type=text]',
    'generate': '.next-face-generate',
    'route': '.next-route-caption',
    'video': '.next-video-slot video',
    'error': '.next-error',
}
GUARD = """
Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:()=>true,configurable:true});
if(!window.__labGate){window.__labGate=0;setInterval(()=>{
 const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__labGate++;b.click();}
 const t=document.querySelector('.next-consent-toast button[aria-label="Ask me later"]');if(t)t.click();},250);}
"""


def adb(*args, check=True, timeout=60):
    r = subprocess.run([ADB, '-s', SERIAL, *args], capture_output=True, text=True, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(f"adb {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout.strip()


def sh(cmd, **kw):
    return adb('shell', cmd, **kw)


def log(event, **data):
    print(json.dumps({'t': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'event': event, **data}), flush=True)


# ---------------------------------------------------------------- device state
def device_facts():
    batt = sh('dumpsys battery')
    num = lambda k: int(re.search(rf'{k}: (\d+)', batt).group(1))
    return {
        'model': sh('getprop ro.product.model'), 'android': sh('getprop ro.build.version.release'),
        'build': sh('getprop ro.build.display.id'),
        'chrome': re.search(r'versionName=(\S+)', sh(f'dumpsys package {CHROME}')).group(1),
        'batteryPct': num('level'), 'batteryTempC': num('temperature') / 10,
        'acPowered': 'AC powered: true' in batt or 'USB powered: true' in batt,
    }


def port_8080_listening():
    out = sh("cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4==\"0A\"{print $2}'", check=False)
    return any(line.upper().endswith(':1F90') for line in out.split())


def ui_find(text, retries=1):
    for _ in range(retries):
        sh('uiautomator dump /sdcard/lab-ui.xml >/dev/null 2>&1', check=False)
        xml = sh('cat /sdcard/lab-ui.xml', check=False)
        m = re.search(r'(?:text|content-desc)="%s"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(text), xml)
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            return (x1 + x2) // 2, (y1 + y2) // 2
        time.sleep(1)
    return None


def wake():
    sh('input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard', check=False)


STATE = Path(os.environ.get('LAB_STATE', Path.home() / '.cache/facemorph-device-lab/session.json'))
SAVED = {}


HOLD = STATE.parent / 'camera-hold'  # present: the operator wants the camera off; sessions leave it off


def camera_off():
    HOLD.parent.mkdir(parents=True, exist_ok=True)
    HOLD.write_text(datetime.now(timezone.utc).isoformat())
    if camera_status()['streaming'] or camera_status()['watchdogPid']:
        camera_pause()
    log('camera_held_off')
    return camera_status()


def camera_on():
    HOLD.unlink(missing_ok=True)
    return camera_resume()


def save_state(**kw):
    SAVED.update(kw)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(SAVED))


def recover():
    """Undoes whatever a previous session left behind (killed runs skip their own cleanup)."""
    if not STATE.exists():
        phone_chrome_reset()
        return False
    SAVED.update(json.loads(STATE.read_text()))
    log('recovering_stale_session', **SAVED)
    session_end()
    if SAVED.get('cameraPaused') and not HOLD.exists():
        camera_resume()
    STATE.unlink(missing_ok=True)
    SAVED.clear()
    return True


def local_port(port):
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('local port must be an integer from 1 to 65535')
    return port


def local_flags(port=LOCAL_PORT):
    return [f'--host-resolver-rules=MAP {ORIGIN_HOST}:443 127.0.0.1:{local_port(port)}', '--ignore-certificate-errors']


def phone_chrome_flags(gpu, local, *, port=LOCAL_PORT):
    """Chrome reads its debug command line at start (Chrome is the persistent debug app)."""
    port = local_port(port)
    flags = (PHONE_WEBGPU_FLAGS if gpu else []) + (local_flags(port) if local else [])
    if flags:
        sh('am set-debug-app --persistent com.android.chrome', check=False)
        line = '_ ' + ' '.join(f"'{f}'" if ' ' in f else f for f in flags)
        sh(f'echo "{line}" > {CHROME_FLAGS_FILE}')
    else:
        sh(f'rm -f {CHROME_FLAGS_FILE}', check=False)
    save_state(chromeFlags=flags, localReversePort=None if local else SAVED.get('localReversePort', LOCAL_PORT))
    if local:
        # Custom listeners never replace another task's mapping. Record ownership only after
        # success, so cleanup after a refused mapping cannot remove that other task's reverse.
        if port == LOCAL_PORT:
            adb('reverse', f'tcp:{port}', f'tcp:{port}')
        else:
            adb('reverse', '--no-rebind', f'tcp:{port}', f'tcp:{port}')
        save_state(localReversePort=port)


def phone_chrome_reset():
    """Resting state: no debug flags, no reverse port, like a real visitor's phone."""
    sh(f'rm -f {CHROME_FLAGS_FILE}', check=False)
    port = SAVED.get('localReversePort', LOCAL_PORT)  # old session files used only 8443
    if port is not None:
        adb('reverse', '--remove', f'tcp:{local_port(port)}', check=False)


def session_begin():
    """Screen on and portrait for the session; remembers the settings it changes."""
    save_state(rotation=sh('settings get system accelerometer_rotation', check=False),
               user_rotation=sh('settings get system user_rotation', check=False),
               headsUp=sh('settings get global heads_up_notifications_enabled', check=False))
    # Pop-up notifications (Chrome nags about the disabled Play services) cover the top of the
    # screen and can swallow taps; off for the session, restored at the end.
    sh('settings put global heads_up_notifications_enabled 0', check=False)
    sh('svc power stayon true')
    wake()
    sh('input keyevent KEYCODE_HOME', check=False)  # clear leftovers such as an open system photo picker
    sh('settings put system accelerometer_rotation 0; settings put system user_rotation 0', check=False)


def session_end():
    phone_chrome_reset()
    if SAVED.get('headsUp') not in (None, '', 'null'):
        sh(f"settings put global heads_up_notifications_enabled {SAVED['headsUp']}", check=False)
    if 'rotation' in SAVED:
        sh(f"settings put system accelerometer_rotation {SAVED['rotation']}; settings put system user_rotation {SAVED['user_rotation']}", check=False)
    sh('svc power stayon false', check=False)


# ---------------------------------------------------------------- camera (Frigate p30pro)
RECOVERY_SVC = f'{WATCHDOG}/{WATCHDOG}.RecoveryAccessibilityService'


def accessibility_bound():
    return RECOVERY_SVC in sh('dumpsys accessibility | grep -i "Bound services" -A1', check=False) or \
        'Camera Watchdog' in sh('dumpsys accessibility | grep -i "Bound services"', check=False)


def camera_status():
    return {'streaming': port_8080_listening(), 'webcamPid': sh(f'pidof {WEBCAM}', check=False),
            'watchdogPid': sh(f'pidof {WATCHDOG}', check=False), 'recoveryServiceBound': accessibility_bound()}


def camera_pause():
    # Huawei drops a force-stopped app's accessibility service from the enabled list; keep both
    # settings so resume can put the watchdog's unattended recovery back exactly as it was.
    save_state(cameraPaused=True,
               a11yServices=sh('settings get secure enabled_accessibility_services', check=False),
               a11yEnabled=sh('settings get secure accessibility_enabled', check=False))
    # The watchdog relaunches IP Webcam, so it stops first.
    sh(f'am force-stop {WATCHDOG}; am force-stop {WEBCAM}')
    for _ in range(10):
        if not port_8080_listening():
            break
        time.sleep(1)
    st = camera_status()
    log('camera_paused', **st)
    if st['streaming']:
        raise RuntimeError('camera still streaming after pause')


def camera_resume(attempts=3):
    """Watchdog first (its service and accessibility recovery), then IP Webcam's overflow menu > Start server."""
    stay = sh('dumpsys power | grep mStayOn=', check=False)
    sh('svc power stayon true', check=False)  # taps on a sleeping screen do nothing
    try:
        return _camera_resume(attempts)
    finally:
        if 'true' not in stay:
            sh('svc power stayon false', check=False)


def restore_accessibility():
    services = SAVED.get('a11yServices')
    if not services or services == 'null':
        services = RECOVERY_SVC  # the watchdog's recovery service is the known-good baseline
    if RECOVERY_SVC not in services:
        services = f'{services}:{RECOVERY_SVC}'
    sh(f"settings put secure enabled_accessibility_services '{services}'; settings put secure accessibility_enabled 1", check=False)


def _camera_resume(attempts):
    for attempt in range(1, attempts + 1):
        wake()
        restore_accessibility()
        sh(f'am start -n {WATCHDOG}/.MainActivity >/dev/null', check=False)
        time.sleep(3)
        if not port_8080_listening():
            sh(f'monkey -p {WEBCAM} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1', check=False)
            time.sleep(4)
            wake()
            menu = ui_find('More options', retries=3)  # the overflow icon's content-desc, any orientation
            if menu:
                sh(f'input tap {menu[0]} {menu[1]}', check=False)
            time.sleep(1.5)
            # With the watchdog's accessibility service bound, uiautomator dumps omit popup windows,
            # so the menu item is chosen by keyboard: Cheats, then Start server.
            start = ui_find('Start server', retries=1)
            if start:
                sh(f'input tap {start[0]} {start[1]}', check=False)
            elif menu:
                # The popup's second item sits at a fixed offset from the overflow icon (measured in
                # portrait: icon 1020,159 -> item 774,302; landscape: 2242,147 -> 2026,290).
                start = (menu[0] - 230, menu[1] + 143)
                sh(f'input tap {start[0]} {start[1]}', check=False)
                time.sleep(2)
                if not port_8080_listening():  # last resort: choose it by keyboard
                    sh('input keyevent KEYCODE_DPAD_DOWN; input keyevent KEYCODE_DPAD_DOWN; input keyevent KEYCODE_ENTER', check=False)
                    start = 'keyboard'
            log('camera_resume_step', attempt=attempt, menu=menu, start=start,
                focus=sh('dumpsys window | grep mCurrentFocus', check=False)[-60:])
        for _ in range(20):
            if port_8080_listening() and accessibility_bound():
                st = camera_status()
                if STATE.exists():
                    save_state(cameraPaused=False)
                log('camera_restored', attempt=attempt, **st)
                return st
            time.sleep(3)
    raise RuntimeError(f'camera did not restore: {camera_status()}')


# ---------------------------------------------------------------- browser
def focus():
    return sh('dumpsys window | grep mCurrentFocus', check=False)


def chrome_front(tries=5):
    """Back out of anything stacked on Chrome's task (e.g. a system photo picker left open), so OS
    taps reach the page."""
    for _ in range(tries):
        f = focus()
        if f'{CHROME}/' in f and 'ChromeTabbedActivity' in f or 'com.google.android.apps.chrome' in f:
            return True
        sh('input keyevent KEYCODE_BACK', check=False)
        time.sleep(1)
    log('chrome_not_front', focus=focus()[-80:])
    return False


# Scrolls as a person can: the page and user-scrollable containers (overflow auto/scroll), never an
# overflow-hidden one, so a control its container clips stays clipped and fails the hit check (the same rule as
# apps/web/test/verify/operated.ts, fm-48bj). scrollIntoView would scroll the clipping container and tap a control
# no person can reach.
SCROLL_AS_PERSON = """([sel,i])=>{const el=document.querySelectorAll(sel)[i];if(!el)return null;
  const centre=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
  for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){const s=getComputedStyle(a);
    const sx=/auto|scroll/.test(s.overflowX)&&a.scrollWidth>a.clientWidth,sy=/auto|scroll/.test(s.overflowY)&&a.scrollHeight>a.clientHeight;
    if(!sx&&!sy)continue;const c=centre(el.getBoundingClientRect()),b=a.getBoundingClientRect();
    if(sx)a.scrollLeft+=c.x-(b.left+a.clientWidth/2);if(sy)a.scrollTop+=c.y-(b.top+a.clientHeight/2);}
  const r=el.getBoundingClientRect();
  if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth){const c=centre(r);scrollBy({left:c.x-innerWidth/2,top:c.y-innerHeight/2,behavior:'instant'});}
  return true}"""


class Phone:
    """Real Chrome on the phone over CDP, acting with OS-level taps."""

    # Before a tap: the element must be visible, sized and the topmost element at its centre; it
    # then arms a one-shot listener recording where the real pointer actually landed.
    PROBE = """([sel,i])=>{const e=document.querySelectorAll(sel)[i];if(!e)return null;const r=e.getBoundingClientRect();
          const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
          const inView=x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight;
          const ok=inView&&r.width>0&&r.height>0&&!!hit&&(hit===e||e.contains(hit));
          if(ok){window.__labHit=null;addEventListener('pointerdown',ev=>{window.__labHit={inside:e.contains(ev.target),
            what:ev.target.outerHTML.slice(0,80)}},{capture:true,once:true});}
          return {x,y,ok,inView,hit:hit?hit.outerHTML.slice(0,80):null}}"""

    def __init__(self, pw, *, init_script=GUARD):
        # A cold Chrome start each session: clears dialogs left by earlier runs (Chrome's own photo
        # picker sits inside Chrome's activity, so focus checks cannot see it).
        sh(f'am force-stop {CHROME}', check=False)
        sh(f'am start -n {CHROME}/com.google.android.apps.chrome.Main -d about:blank >/dev/null', check=False)
        for _ in range(20):
            if 'chrome_devtools_remote' in sh('cat /proc/net/unix', check=False):
                break
            time.sleep(0.5)
        time.sleep(2)
        chrome_front()
        self.forward_port = int(adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'))
        try:
            self.browser = pw.chromium.connect_over_cdp(f'http://localhost:{self.forward_port}')
            ctx = self.browser.contexts[0]
            # A fresh tab, brought to the front: OS taps land on the visible tab, not on ctx.pages[0].
            self.page = ctx.new_page()
            self.page.bring_to_front()
            time.sleep(1)
            self.page.add_init_script(init_script)
            self.cdp = ctx.new_cdp_session(self.page)
        except BaseException:
            self.close()
            raise

    def js(self, expr, arg=None):
        return self.page.evaluate(expr) if arg is None else self.page.evaluate(expr, arg)

    def clear_origin(self, url):
        origin = re.match(r'https?://[^/]+', url).group(0)
        self.cdp.send('Storage.clearDataForOrigin', {'origin': origin, 'storageTypes': 'all'})
        self.cdp.send('Network.clearBrowserCache')

    def screen_point(self, x, y):
        """CSS viewport point -> screen pixels, measured fresh: Chrome's toolbar hides and shows as the
        page scrolls, so a one-time calibration goes stale. The phone uses gesture navigation (no
        bottom bar) and the soft keyboard is closed before taps, so the viewport's top on screen is
        (screen height - viewport height)."""
        m = self.js("({dpr:devicePixelRatio,sh:screen.height,ih:innerHeight,sw:screen.width,iw:innerWidth})")
        top = (m['sh'] - m['ih']) * m['dpr']
        left = (m['sw'] - m['iw']) * m['dpr'] / 2
        return round(left + x * m['dpr']), round(top + y * m['dpr'])

    def tap(self, selector, index=0):
        """Real OS tap at the element's visible centre. Before: elementFromPoint must be the element.
        After: the real touch's pointerdown target must be inside the element, or the step fails."""
        info = self.js(SCROLL_AS_PERSON, [selector, index])
        if not info:
            raise RuntimeError(f'no element {selector}[{index}]')
        time.sleep(0.6)  # let the toolbar settle after the scroll
        probe = self.PROBE
        end = time.time() + 8  # a control may appear or move as state settles; it must become hittable
        while True:
            info = self.js(probe, [selector, index])
            if (info and info['ok']) or time.time() > end:
                break
            time.sleep(0.4)
        if not info or not info['ok']:
            raise RuntimeError(f'{selector}[{index}] is not hittable at its centre ('
                               + ('outside the viewport' if info and not info.get('inView') else f'covered by {info and info["hit"]}') + ')')
        # Chrome drops touches until a page has presented its first frame (the DOM can be ready
        # earlier, notably on the WebGPU path after a heavy run). A tap that reached nothing changed
        # nothing, so it is retried; a tap that reached the wrong element fails at once.
        for attempt in range(5):
            sx, sy = self.screen_point(info['x'], info['y'])
            sh(f'input tap {sx} {sy}')
            time.sleep(0.4)
            landed = self.js('window.__labHit')
            if landed:
                break
            log('tap_not_delivered', selector=selector, attempt=attempt + 1)
            time.sleep(1.5)
            info = self.js(probe, [selector, index]) or info  # re-arm the listener
        if not landed or not landed['inside']:
            raise RuntimeError(f'tap on {selector}[{index}] at CSS ({info["x"]:.0f}, {info["y"]:.0f}), screen ({sx}, {sy}) '
                               f'landed on {landed and landed["what"]}')

    def type_into(self, selector, text, index=0):
        """Types like a person: tap the field, delete its text with real key presses, type on the
        phone's keyboard, close the keyboard. (Clearing through script re-renders the field and
        drops focus.) Returns what the field holds afterwards."""
        self.tap(selector, index)
        time.sleep(0.5)
        n = len(self.js("([s,i])=>document.querySelectorAll(s)[i].value", [selector, index]) or '')
        if n:
            sh('input keyevent KEYCODE_MOVE_END ' + ' '.join(['KEYCODE_DEL'] * (n + 2)), check=False)
        sh(f"input text {text}")
        time.sleep(0.5)
        sh('input keyevent 111', check=False)  # ESC hides the soft keyboard without navigating back
        time.sleep(1.2)
        return self.js("([s,i])=>document.querySelectorAll(s)[i].value", [selector, index])

    def wait(self, expr, timeout_s, arg=None):
        end = time.time() + timeout_s
        while time.time() < end:
            v = self.js(expr) if arg is None else self.page.evaluate(expr, arg)
            if v:
                return v
            err = self.js(f"document.querySelector('{S['error']}')?.innerText||''")
            if err:
                raise RuntimeError(f'app error: {err[:200]}')
            time.sleep(0.5)
        raise TimeoutError(f'timed out after {timeout_s}s waiting for {expr[:80]}')

    def close(self):
        try:
            self.page.close()
        except Exception:
            pass
        finally:
            adb('forward', '--remove', f'tcp:{self.forward_port}', check=False)

    def screenshot(self, path):
        with open(path, 'wb') as f:
            f.write(subprocess.run([ADB, '-s', SERIAL, 'exec-out', 'screencap', '-p'], capture_output=True).stdout)


class Desktop:
    """Named Chrome/Firefox on eris, sharing the real-input journey implementation."""

    def __init__(self, pw, gpu, local, profile, family='chrome'):
        self.pw, self.gpu, self.local, self.profile, self.family = pw, gpu, local, Path(profile), family
        self.profiles, self.n = [], 0
        if family == 'chrome':
            executable = os.environ.get('LAB_CHROME') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        else:
            executable = os.environ.get('LAB_FIREFOX', pw.firefox.executable_path)
        self.identity = browser_identity(executable, family)
        args = (['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] if gpu else ['--disable-features=WebGPU']) if family == 'chrome' else []
        if family == 'chrome':
            args.insert(0, '--enable-automation')  # CDP command-line provenance requires this explicit flag.
        if local and family == 'chrome':
            args += local_flags()
        self.options = dict(executable_path=executable, headless=not gpu, args=args,
                            ignore_https_errors=local, viewport={'width': 1280, 'height': 900})
        prefs = {'dom.webgpu.enabled': gpu, 'dom.webgpu.force-enabled': gpu} if family == 'firefox' else {}
        if prefs:
            self.options['firefox_user_prefs'] = prefs
        self.identity.update(flags=args, preferences=prefs, headless=not gpu,
                             ignoreHttpsErrors=local,
                             distribution='playwright' if 'ms-playwright' in executable else 'installed')
        try:
            self._open()
        except Exception:
            self.close()
            raise

    def _open(self):
        self.n += 1
        profile = self.profile.with_name(self.profile.name + f'-{self.n}')
        self.profiles.append(profile)
        engine = self.pw.firefox if self.family == 'firefox' else self.pw.chromium
        self.ctx = engine.launch_persistent_context(str(profile), **self.options)
        self.identity.setdefault('launches', [])
        for cmdline in Path('/proc').glob('[0-9]*/cmdline'):
            try:
                argv = cmdline.read_bytes().decode().rstrip('\0').split('\0')
                if str(profile) in argv or f'--user-data-dir={profile}' in argv:
                    self.identity['launches'].append({'commandLine': argv,
                        'executable': str((cmdline.parent / 'exe').resolve())})
                    break
            except (OSError, UnicodeError):
                continue
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.add_init_script(GUARD)
        if self.family == 'firefox':
            from hosted import OriginStorage
            self.cdp = OriginStorage(self)
        else:
            self.cdp = self.ctx.new_cdp_session(self.page)
            command = self.cdp.send('Browser.getBrowserCommandLine')['arguments']
            self.identity['launches'] = [{'commandLine': command, 'executable': str(Path(command[0]).resolve())}]
        self.crashed = False
        self.page.on('crash', lambda *_: setattr(self, 'crashed', True))

    js = Phone.js
    wait = Phone.wait

    def clear_origin(self, url):
        if getattr(self, 'family', 'chrome') == 'firefox':
            # No CDP on Firefox: a new empty profile is the cold-state boundary (same as hosted).
            self.ctx.close()
            self._open()
        else:
            Phone.clear_origin(self, url)

    def tap(self, selector, index=0):
        """A real mouse click at the element's visible centre, with the same before/after checks as the phone."""
        self.js(SCROLL_AS_PERSON, [selector, index])
        time.sleep(0.3)
        end = time.time() + 8
        while True:
            info = self.js(Phone.PROBE, [selector, index])
            if (info and info['ok']) or time.time() > end:
                break
            time.sleep(0.4)
        if not info or not info['ok']:
            raise RuntimeError(f'{selector}[{index}] is not hittable at its centre ('
                               + ('outside the viewport' if info and not info.get('inView') else f'covered by {info and info["hit"]}') + ')')
        self.page.mouse.click(info['x'], info['y'])
        time.sleep(0.3)
        landed = self.js('window.__labHit')
        if not landed or not landed['inside']:
            raise RuntimeError(f'click on {selector}[{index}] landed on {landed and landed["what"]}')

    def type_into(self, selector, text, index=0):
        self.tap(selector, index)
        n = len(self.js("([s,i])=>document.querySelectorAll(s)[i].value", [selector, index]) or '')
        self.page.keyboard.press('End')
        for _ in range(n + 2):
            self.page.keyboard.press('Backspace')
        self.page.keyboard.type(text, delay=30)
        time.sleep(0.5)
        return self.js("([s,i])=>document.querySelectorAll(s)[i].value", [selector, index])

    def screenshot(self, path):
        self.page.screenshot(path=str(path))

    def close(self):
        try:
            if hasattr(self, 'ctx'):
                self.ctx.close()
        finally:
            for profile in getattr(self, 'profiles', []):
                shutil.rmtree(profile, ignore_errors=True)


def chrome_pss_mb():
    """Sum of Chrome browser and renderer PSS in MB (dumpsys meminfo)."""
    total = 0
    for line in sh('dumpsys meminfo | grep -i chrome', check=False).splitlines():
        m = re.match(r'\s*([\d,]+)K: (com\.android\.chrome\S*)', line)
        if m:
            total += int(m.group(1).replace(',', ''))
    return round(total / 1024)


class ScreenBuffer(threading.Thread):
    """The phone's last N screenshots (one every ~2 s), kept in memory and written out on failure."""

    def __init__(self, keep=20):
        super().__init__(daemon=True)
        self.frames, self.keep, self.stop = [], keep, threading.Event()

    def run(self):
        while not self.stop.is_set():
            try:
                png = subprocess.run([ADB, '-s', SERIAL, 'exec-out', 'screencap', '-p'], capture_output=True, timeout=10).stdout
                self.frames = (self.frames + [(time.time(), png)])[-self.keep:]
            except Exception:
                pass
            self.stop.wait(2)

    def dump(self, folder):
        folder.mkdir(parents=True, exist_ok=True)
        for t, png in self.frames:
            (folder / f"{datetime.fromtimestamp(t).strftime('%H%M%S')}.png").write_bytes(png)
        return str(folder)


class MemorySampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak, self.stop = 0, threading.Event()

    def run(self):
        while not self.stop.is_set():
            try:
                self.peak = max(self.peak, chrome_pss_mb())
            except Exception:
                pass
            self.stop.wait(2)


# ---------------------------------------------------------------- journeys
FACES = "(sel)=>[...document.querySelectorAll(sel)].filter(i=>(i.naturalWidth||i.width)===1024).length"


def check_route(route, gpu):
    r = str(route or '').lower()
    # LAB_ANY_ROUTE=1 times whatever route the product chose under the cell's browser flags (route-choice
    # experiments, fm-ve6a); the chosen route is still recorded in each journey's result.
    if os.environ.get('LAB_ANY_ROUTE') == '1':
        return
    if gpu and ('webgpu' not in r or 'cpu' in r):
        raise RuntimeError(f'expected the WebGPU route, got {route!r}')
    if not gpu and ('cpu' not in r or 'webgpu' in r):
        raise RuntimeError(f'expected the CPU route, got {route!r}')


def capture_capabilities(dev):
    """Probe the real page in its secure context, without loading a model or timing a workload."""
    return dev.js("""async () => {
      const result = {userAgent:navigator.userAgent, secureContext:isSecureContext,
        webgpu:!!navigator.gpu, adapter:false, url:location.href};
      if(navigator.gpu) {
        const adapter = await Promise.race([navigator.gpu.requestAdapter(),
          new Promise((_,reject)=>setTimeout(()=>reject(Error('adapter probe timed out')),10000))]);
        result.adapter = !!adapter;
        if(adapter?.info) result.adapterInfo = {vendor:adapter.info.vendor, architecture:adapter.info.architecture,
          device:adapter.info.device, description:adapter.info.description};
      }
      return result;
    }""")


def journey_face(phone, url, cold, word, gpu=None):
    if cold:
        phone.clear_origin(url)  # everything, including downloaded models
    else:
        # Warm models, fresh session: drop the saved session (IndexedDB checkface-originals-v1) and
        # local storage, keep Cache Storage and OPFS where the models live.
        # Leave the page first: an open page holds the database open and blocks deletion.
        phone.page.goto('about:blank')
        origin = re.match(r'https?://[^/]+', url).group(0)
        phone.cdp.send('Storage.clearDataForOrigin', {'origin': origin, 'storageTypes': 'indexeddb,local_storage'})
    t0 = time.time()
    response = phone.page.goto(url, wait_until='domcontentloaded')
    # The document as built: on the facemorph.me zone the edge injects its analytics beacon into it.
    html_digest = hashlib.sha256(without_platform_beacon('index.html', response.body())[0]).hexdigest() if response else None
    if getattr(phone, 'expected_index', None) and html_digest != phone.expected_index:
        raise RuntimeError(f'executed document digest {html_digest} differs from the artifact index')
    phone.capabilities = capture_capabilities(phone)
    if gpu and not phone.capabilities['adapter']:
        raise Untested('no WebGPU adapter in the actual page; CPU fallback cannot qualify this cell')
    phone.wait(f"!!document.querySelector('{S['product']}')", 120)
    usable = time.time() - t0
    # A warm visit restores the previous session and re-renders the tiles; typing before that
    # settles is lost. Wait for the app to report idle, then a short settle.
    phone.wait("document.querySelector('.next-product')?.getAttribute('data-next-busy')!=='true'", 120)
    time.sleep(1.5)
    before = phone.page.evaluate(FACES, S['faceImage'])
    typed = phone.type_into(S['faceText'], word, 0)
    if typed.lower() != word.lower():  # lost to a re-render: type once more, then judge
        log('retype', got=typed)
        time.sleep(1)
        typed = phone.type_into(S['faceText'], word, 0)
    if typed.lower() != word.lower():
        raise RuntimeError(f'field holds {typed!r} after typing {word!r}')
    t1 = time.time()
    busy = "document.querySelector('.next-product')?.getAttribute('data-next-busy')==='true'||[...document.querySelectorAll('.next-face-generate')][0]?.disabled"
    for attempt in range(2):
        phone.tap(S['generate'], 0)
        try:
            phone.wait(f"({busy})||({FACES})('{S['faceImage']}')>{before}", 15)
            break
        except TimeoutError:
            if attempt:
                raise RuntimeError('Generate tap did not start a job')
            log('generate_tap_retry')
    phone.page.wait_for_function(f"([sel,n])=>({FACES})(sel)>n", arg=[S['faceImage'], before], timeout=900_000, polling=500)
    face = time.time() - t1
    route = phone.js(f"document.querySelector('{S['route']}')?.innerText||''").strip()
    if gpu is not None:
        check_route(route, gpu)
    return {'usableS': round(usable, 2), 'faceS': round(face, 2), 'route': route.strip()[:80], 'url': phone.page.url,
            'documentSha256': html_digest,
            'typed': word, 'fieldValue': typed, 'typedExactly': typed == word}


def journey_morph(phone, gpu=None):
    t0 = time.time()
    # Result-file controls can mount between the warm face and tap's scroll/hit
    # probe. A global button index would then identify a different real control.
    selector = 'button.next-primary-action'
    if not phone.js("sel=>{const buttons=document.querySelectorAll(sel);return buttons.length===1&&buttons[0].textContent.trim()==='Create morph'}", selector):
        raise RuntimeError('no Create morph button')
    phone.tap(selector)
    phone.wait(f"(()=>{{const v=document.querySelector('{S['video']}');return !!v&&v.readyState>=2&&v.duration>0}})()", 1800)
    route = phone.js(f"document.querySelector('{S['route']}')?.innerText||''").strip()
    if gpu is not None:
        check_route(route, gpu)
    return {'videoS': round(time.time() - t0, 2), 'route': route, 'url': phone.page.url}


def journey_blend(phone, gpu=None):
    """The blend view (fm-2kse) from the two faces the earlier journeys made: More options, Blend faces and Blend,
    each a real tap at its visible position; the blended face shown is the result. Then Morph (the mode switch)."""
    t0 = time.time()
    toggle = 'button[aria-controls="next-overflow"]'
    if phone.js(f"document.querySelector('{toggle}')?.getAttribute('aria-expanded')") != 'true':
        phone.tap(toggle)
    phone.wait("!!document.querySelector('.next-blend-open')", 30)
    phone.tap('.next-blend-open')
    phone.wait("!!document.querySelector('.next-blend')", 60)
    slots = int(phone.js("document.querySelector('.next-blend')?.dataset.nextBlendSlots||'0'"))
    if slots < 2:
        raise RuntimeError(f'blend view opened with {slots} slot(s); two generated faces were expected')
    t1 = time.time()
    phone.tap('.next-blend-action')
    phone.wait("(()=>{const b=document.querySelector('.next-blend');const r=document.querySelector('.next-blend-result');"
               "return b?.dataset.nextBlendRunning==='false'&&r?.dataset.nextBlendResult==='shown'})()", 900)
    blendS = time.time() - t1
    error = phone.js("document.querySelector('.next-blend-error')?.innerText||''").strip()
    if error:
        raise RuntimeError(f'blend failed: {error[:200]}')
    route = phone.js(f"document.querySelector('{S['route']}')?.innerText||''").strip()
    if gpu is not None and route:
        check_route(route, gpu)
    phone.tap('.next-mode-morph')
    phone.wait("!document.querySelector('.next-blend')", 60)
    return {'blendS': round(blendS, 2), 'totalS': round(time.time() - t0, 2), 'slots': slots, 'route': route[:80],
            'url': phone.page.url}


MANY_FACES = 6
# The face count: a strip names its last face on its trailing connector (a long strip renders only the tiles in view,
# so the fields on the page are not a count); two faces are the pair layout ("Add a face after Morph to").
FACE_COUNT = """(()=>{const l=document.querySelector('.next-connector-add[aria-label^="Add a face after Face"]');
  if(l)return +l.getAttribute('aria-label').match(/\\d+$/)[0];
  if(document.querySelector('.next-connector-add[aria-label="Add a face after Morph to"]'))return 2;
  return document.querySelectorAll('[data-next-face]').length})()"""
TRAILING_ADD = '.next-connector-add[aria-label^="Add a face after"]'
# The morph was accepted: queued behind face work, or running.
MORPH_STARTED = """(()=>{const b=document.querySelector('button.next-primary-action');
  const r=document.querySelector('#next-morph-reason')?.innerText||'';
  return b?.textContent.trim()==='Morph queued'||/morph is running|morph queued/i.test(r)})()"""
MARK = """t=>{document.querySelectorAll('[data-lab-target]').forEach(e=>e.removeAttribute('data-lab-target'));
  const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===t&&e.getClientRects().length);
  if(b)b.setAttribute('data-lab-target','');return !!b}"""


def tap_text(dev, text):
    """A real tap on the visible button labelled exactly `text`."""
    if not dev.js(MARK, text):
        raise RuntimeError(f'no visible {text!r} button')
    dev.tap('[data-lab-target]')


def journey_many_faces(dev, gpu=None):
    """Many faces on one device, every step a real tap (operator, 29 October 2026): from the faces the earlier journeys
    left, Add face and the strip's trailing + in turn until six faces, a word in each empty field in view, Create morph,
    any download question answered as a person does, then Cancel once the run has started. The morph is not waited
    for: this is the many-face UI (layout, hit targets, the strip, Create morph, Cancel), not synthesis."""
    t0 = time.time()
    start = dev.js(FACE_COUNT)
    if start < 1:
        seen = dev.js("[...document.querySelectorAll('.next-connector-add,[data-next-face],.next-face')].map(e=>e.getAttribute('aria-label')||e.className).slice(0,8).join(' | ')")
        raise RuntimeError(f'no faces on the page (saw: {seen[:200]})')
    added = 0
    while (n := dev.js(FACE_COUNT)) < MANY_FACES:
        if added % 2:
            dev.tap(TRAILING_ADD)
        else:
            tap_text(dev, 'Add face')
        dev.wait(f"({FACE_COUNT})>{n}", 15)
        added += 1
        empty = dev.js(f"[...document.querySelectorAll('{S['faceText']}')].findIndex(i=>!i.value)")
        if empty >= 0:
            word = f'lab{n}many'
            typed = dev.type_into(S['faceText'], word, empty)
            if typed.lower() != word:
                raise RuntimeError(f'face field holds {typed!r} after typing {word!r}')
    if dev.js(MORPH_STARTED):
        raise RuntimeError('a morph was already queued or running before Create morph was pressed')
    layout = dev.js('({w: document.documentElement.scrollWidth, iw: innerWidth})')
    if layout['w'] > layout['iw'] + 1:
        raise RuntimeError(f'the page scrolls sideways with {MANY_FACES} faces: {layout}')
    dev.tap('button.next-primary-action')
    t1 = time.time()
    busy = "document.querySelector('.next-product')?.getAttribute('data-next-busy')==='true'"
    answered = 0  # the first morph may ask before it downloads anything
    while True:
        if dev.js("!!document.querySelector('.next-download-accept')"):
            dev.tap('.next-download-accept')
            answered += 1
            dev.wait("!document.querySelector('.next-download-accept')", 30)
            continue
        if dev.js(MORPH_STARTED):
            break
        if time.time() - t1 > 60:
            reason = dev.js("document.querySelector('#next-morph-reason')?.innerText||''")
            raise RuntimeError(f'Create morph with {MANY_FACES} faces did not start: {reason[:200]!r}')
        time.sleep(0.5)
    started = time.time() - t1
    time.sleep(3)  # a few seconds of the running state: an error or a layout break shows here
    dev.wait(f"!document.querySelector('{S['error']}')", 1)
    tap_text(dev, 'Cancel')
    dev.wait(f"!({busy})", 120)
    error = dev.js(f"document.querySelector('{S['error']}')?.innerText||''").strip()
    if error:
        raise RuntimeError(f'app error after Cancel: {error[:200]}')
    return {'faces': dev.js(FACE_COUNT), 'added': added, 'downloadQuestions': answered, 'startS': round(started, 2),
            'totalS': round(time.time() - t0, 2), 'url': dev.page.url}


OPERATED_PORT = 8461  # the operated-input fixture page, reached by the phone through adb reverse


def journey_operated(dev, cell):
    """The verification harness's operated-input contract on real input (fm-48bj): the defect-1 regression page
    (apps/web/test/fixtures/verify/operated.html) served from this checkout. A real OS tap (phone) or mouse click
    (eris) must press the visible Remove and the transformed, nested and scrolled controls; the Remove covered by
    the mode-menu button, the control its container clips and the off-screen one must be refused before any input
    is sent, naming the element actually hit. One record per step, as the TS harness's step log."""
    import functools, http.server
    root = REPO / 'apps/web/test/fixtures'
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None
    server = http.server.ThreadingHTTPServer(('127.0.0.1', OPERATED_PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    phone = CELLS[cell][0] == 'phone'
    if phone:
        adb('reverse', f'tcp:{OPERATED_PORT}', f'tcp:{OPERATED_PORT}')
    steps = []
    try:
        url = f'http://127.0.0.1:{OPERATED_PORT}/verify/operated.html'
        dev.clear_origin(url)  # the phone's Chrome keeps an earlier copy of the page otherwise
        response = dev.page.goto(f'{url}?run={int(time.time())}', wait_until='load')
        digest = hashlib.sha256(response.body()).hexdigest()
        if digest != hashlib.sha256((root / 'verify/operated.html').read_bytes()).hexdigest():
            raise RuntimeError('executed operated fixture digest differs from checkout')
        dev.capabilities = capture_capabilities(dev)
        layout = dev.js('({w: document.documentElement.scrollWidth, iw: innerWidth, scale: visualViewport.scale})')
        if layout['w'] > layout['iw'] or layout['scale'] != 1:
            raise RuntimeError(f'the fixture page does not fit this viewport: {layout}')
        pressed = lambda: dev.js("document.querySelector('#pressed').value")
        for sel in ['#remove-visible', '#transformed', '#nested', '#scrolled']:
            dev.tap(sel)
            got = pressed()
            steps.append({'step': f'verify.harness/lab/{sel[1:]}', 'expect': 'pressed', 'ok': got == sel[1:], 'pressed': got})
        for sel, hit in [('#remove-covered', 'mode-menu'), ('#clipped', None), ('#off-screen', None)]:
            before = pressed()
            try:
                dev.tap(sel)
                steps.append({'step': f'verify.harness/lab/{sel[1:]}', 'expect': 'refused', 'ok': False,
                              'detail': 'was pressed', 'pressed': pressed()})
            except RuntimeError as e:
                ok = pressed() == before and (hit is None or hit in str(e))
                steps.append({'step': f'verify.harness/lab/{sel[1:]}', 'expect': 'refused', 'ok': ok, 'detail': str(e)[:200]})
    finally:
        server.shutdown()
        server.server_close()
        if phone:
            adb('reverse', '--remove', f'tcp:{OPERATED_PORT}', check=False)
    failed = [s for s in steps if not s['ok']]
    if failed:
        raise RuntimeError(f'operated contract failed on {cell}: {json.dumps(failed)[:400]}')
    return {'steps': steps, 'url': dev.page.url, 'documentSha256': digest}


def cool_down(limit_c=40.0, max_wait_s=900):
    """Heat throttles the CPU and would skew paired comparisons: wait (screen dimmed) until the
    battery temperature is at or below the limit, up to max_wait_s, and return the start temperature."""
    end = time.time() + max_wait_s
    t = device_facts()['batteryTempC']
    if t > limit_c:
        log('cooling', tempC=t, limitC=limit_c)
        sh('svc power stayon false; input keyevent KEYCODE_SLEEP', check=False)
        while t > limit_c and time.time() < end:
            time.sleep(30)
            t = device_facts()['batteryTempC']
        sh('svc power stayon true', check=False)
        wake()
    return t


def _terminate(signum, frame):
    raise SystemExit(f'signal {signum}')


@contextmanager
def lab_lock(cells, *, state_dir=None):
    """Per-device lab locks: the phone is one physical device, so phone runs serialize against phone
    runs; eris browser cells serialize only against other eris runs (operator, 25 October 2026: a CI
    eris cell or a second pane never waits behind an unrelated device's session). Locks are taken in
    sorted device order, so concurrent mixed runs cannot deadlock. LAB_LOCK_WAIT (default 300 s)
    bounds each wait; past it the run exits 75 (busy) and the caller defers honestly — the lock is
    never a long block. The machine-wide device lease is gone (operator, 25 October 2026); research
    and CI no longer queue here."""
    import fcntl
    wait_s = float(os.environ.get('LAB_LOCK_WAIT', '300'))
    unknown = [c for c in cells if c not in CELLS]
    if unknown:
        raise SystemExit(f"unknown cell(s) {', '.join(unknown)}; cells are {', '.join(CELLS)}")
    devices = sorted({socket.gethostname().split('.')[0] if CELLS[c][0] == 'desktop' else PHONE_LEASE for c in cells})
    # Tests exercise real flock files in a temporary directory, never the live device leases.
    lock_dir = Path(state_dir) if state_dir is not None else STATE.parent
    lock_dir.mkdir(parents=True, exist_ok=True)
    held = []
    try:
        for device in devices:
            lock = open(lock_dir / f'lab-{device}.lock', 'w')
            held.append(lock)
            deadline = time.time() + wait_s
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.time() >= deadline:
                        print(f'device lab busy: lab-{device}.lock still held after {wait_s:.0f} s', file=sys.stderr)
                        raise SystemExit(75)
                    log('waiting_for_device_lock', device=device)
                    time.sleep(15)
        yield devices
    finally:
        for h in held:
            try:
                fcntl.flock(h, fcntl.LOCK_UN)
            finally:
                h.close()


def run_journeys(dev, args, cell, gpu, out, report, memory=None):
    for i in range(args.repeat):
        rec = {'iteration': i + 1}
        if CELLS[cell][0] == 'phone':
            rec['startTempC'] = cool_down()
        mem = MemorySampler() if memory else None
        if mem:
            mem.start()
        rec_proc = None
        if CELLS[cell][0] == 'phone':
            # This phone has no screenrecord (Huawei removed it): keep a rolling buffer of the last
            # screenshots instead, written out only if the iteration fails.
            rec_proc = ScreenBuffer()
            rec_proc.start()
        elif hasattr(dev, 'ctx'):
            dev.ctx.tracing.start(screenshots=True, snapshots=True)
        try:
            for j in validate_journeys(args.journey):
                started = time.monotonic()
                if j == 'cold-face':
                    rec['cold'] = journey_face(dev, args.url, True, f'lab{i}cold', gpu)
                elif j == 'warm-face':
                    rec['warm'] = journey_face(dev, args.url, False, f'lab{i}warm', gpu)
                elif j == 'morph':
                    rec['morph'] = journey_morph(dev, gpu)
                elif j == 'blend':
                    rec['blend'] = journey_blend(dev, gpu)
                elif j == 'many-faces':
                    rec['manyFaces'] = journey_many_faces(dev, gpu)
                elif j == 'operated':
                    rec['operated'] = journey_operated(dev, cell)
                rec.setdefault('durationsS', {})[j] = round(time.monotonic() - started, 1)
                log('journey_done', cell=cell, iteration=i + 1, journey=j, seconds=rec['durationsS'][j])
                report['url'] = dev.page.url
            rec['ok'] = True
        except Exception as e:
            rec['ok'], rec['error'] = False, f'{type(e).__name__}: {e}'[:400]
            rec['status'] = 'untested' if isinstance(e, Untested) else 'fail'
            if getattr(dev, 'crashed', False):
                rec['error'] = 'PageCrashed: the page process died (often memory pressure) - ' + rec['error']
                rec['crashed'] = True
            try:
                dev.screenshot(out / f'{cell}-fail-{i + 1}.png')
            except Exception as screenshot_error:
                rec['screenshotError'] = str(screenshot_error)[:200]
            if CELLS[cell][0] == 'phone':
                chrome_front()
            log('journey_failed', cell=cell, iteration=i + 1, error=rec['error'])
        finally:
            # Action completion and budget qualification are separate: preserve rec.ok,
            # but keep diagnostics before report_findings later rejects an over-budget run.
            budget_errors = budget_findings(cell, [rec])
            retain_diagnostics = not rec.get('ok') or bool(budget_errors)
            if budget_errors:
                rec['budgetBreaches'] = budget_errors
                if rec.get('ok'):
                    try:
                        dev.screenshot(out / f'{cell}-fail-{i + 1}.png')
                    except Exception as screenshot_error:
                        rec['screenshotError'] = str(screenshot_error)[:200]
            if rec_proc:
                rec_proc.stop.set()
                rec_proc.join(10)
                if retain_diagnostics:
                    rec['frames'] = rec_proc.dump(out / f'{cell}-fail-{i + 1}-frames')
            elif hasattr(dev, 'ctx'):
                try:
                    dev.ctx.tracing.stop(path=str(out / f'{cell}-trace-{i + 1}.zip') if retain_diagnostics else None)
                except Exception:
                    pass
            if mem:
                mem.stop.set()
                mem.join(5)
                rec['peakChromePssMb'] = mem.peak
            if CELLS[cell][0] == 'phone':
                rec['batteryTempC'] = device_facts()['batteryTempC']
        report['runs'].append(rec)
        report['capabilities'] = getattr(dev, 'capabilities', None)
        (out / f'{cell}.json').write_text(json.dumps(report, indent=2))


def report_findings(report, journeys, digest=None):
    """Plain evidence validation: a requested backend, browser label or empty run is insufficient."""
    findings = []
    cell = report.get('cell')
    if cell not in CELLS:
        return ['unknown cell']
    browser = report.get('browser') or {}
    family = 'firefox' if 'firefox' in cell else 'chrome'
    if not isinstance(browser, dict) or browser.get('family') != family or not browser.get('version') or not browser.get('executable'):
        findings.append('missing or wrong browser identity')
    elif not isinstance(browser.get('flags'), list):
        findings.append('missing browser flags')
    elif family == 'firefox' and not re.search(r'^Mozilla Firefox \d', browser['version']):
        findings.append('wrong Firefox version identity')
    elif family == 'chrome' and not (re.search(r'^Google Chrome(?: for Testing)? \d', browser['version']) or
            (browser.get('package') == CHROME and re.fullmatch(r'\d+(?:\.\d+)+', browser['version']))):
        findings.append('wrong Chrome version identity')
    artifact = report.get('artifact') or {}
    if not re.fullmatch('[a-f0-9]{64}', artifact.get('digest', '')) or (digest and artifact.get('digest') != digest):
        findings.append('missing or wrong artifact digest')
    if CELLS[cell][1] and not (report.get('capabilities') or {}).get('adapter'):
        findings.append('WebGPU adapter unavailable; required capability untested')
    runs = report.get('runs') or []
    if not runs:
        findings.append('no executed journeys')
    keys = {'cold-face': 'cold', 'warm-face': 'warm', 'morph': 'morph', 'blend': 'blend', 'many-faces': 'manyFaces',
            'operated': 'operated'}
    for run in runs:
        if not run.get('ok'):
            findings.append('journey failed or untested')
        for journey in journeys:
            result = run.get(keys[journey])
            if not result:
                findings.append(f'missing {journey} evidence')
            elif journey in ('cold-face', 'warm-face', 'morph'):
                if not result.get('url'):
                    findings.append(f'missing executed URL for {journey}')
                if journey != 'morph' and not re.fullmatch('[a-f0-9]{64}', result.get('documentSha256', '')):
                    findings.append(f'missing document digest for {journey}')
                try:
                    check_route(result.get('route', ''), CELLS[cell][1])
                except RuntimeError as e:
                    findings.append(str(e))
            elif journey == 'blend':
                if not result.get('url') or (result.get('slots') or 0) < 2:
                    findings.append('blend: missing executed URL or fewer than two slots')
                if result.get('route'):
                    try:
                        check_route(result['route'], CELLS[cell][1])
                    except RuntimeError as e:
                        findings.append(str(e))
            elif journey == 'many-faces':
                if not result.get('url') or (result.get('faces') or 0) < MANY_FACES:
                    findings.append(f'many-faces: missing executed URL or fewer than {MANY_FACES} faces')
            elif not result.get('steps') or not all(s.get('ok') for s in result['steps']):
                findings.append('operated steps failed or missing')
    return findings + budget_findings(cell, runs)


def run_cell(cell, args, out, report=None):
    """One cell, start to finish, always leaving the devices in their resting state."""
    from playwright.sync_api import sync_playwright
    kind, gpu = CELLS[cell]
    local = bool(getattr(args, 'local', False))
    artifact = getattr(args, 'artifact_evidence', None)
    if args.journey == 'operated':
        fixture = REPO / 'apps/web/test/fixtures/verify/operated.html'
        artifact = {'digest': hashlib.sha256(fixture.read_bytes()).hexdigest(), 'kind': 'operated-fixture'}
    report = {} if report is None else report
    report.update({'cell': cell, 'label': args.label, 'url': args.url, 'requestedUrl': args.url,
              'local': local, 'runs': [], 'journeys': validate_journeys(args.journey),
              'artifact': {k: v for k, v in (artifact or {}).items() if k != 'files'},
              'requestedRoute': 'webgpu' if gpu else 'cpu'})
    log('cell_start', cell=cell, url=args.url, local=local)
    if kind == 'desktop':
        with sync_playwright() as pw:
            family = 'firefox' if 'firefox' in cell else 'chrome'
            dev = Desktop(pw, gpu, local, out / f'profile-{cell}', family)
            try:
                report['browser'] = dev.identity
                dev.expected_index = next((f['sha256'] for f in (artifact or {}).get('files', []) if f['path'] == 'deploy-next/index.html'), None)
                if local and family == 'firefox':
                    # Firefox has no Chromium host-resolver port remapping. Use the same TLS server,
                    # at its real localhost origin, and record the URL actually executed.
                    args = argparse.Namespace(**vars(args))
                    args.url = f'https://localhost:{LOCAL_PORT}/'
                    report['url'] = args.url
                run_journeys(dev, args, cell, gpu, out, report)
                dev.screenshot(out / f'{cell}-last.png')
            finally:
                dev.close()
    else:
        recover()
        report['device'] = device_facts()
        report['cameraBefore'] = camera_status()
        paused = False
        try:
            if HOLD.exists():
                if camera_status()['streaming'] or camera_status()['watchdogPid']:
                    sh(f'am force-stop {WATCHDOG}; am force-stop {WEBCAM}', check=False)
                log('camera_held_off')
            elif not args.keep_camera:
                camera_pause()
                paused = True
            session_begin()
            phone_chrome_flags(gpu, local)
            report['browser'] = {'family': 'chrome', 'executable': sh(f'pm path {CHROME}'),
                                 'version': report['device']['chrome'], 'package': CHROME,
                                 'flags': SAVED.get('chromeFlags', []), 'commandLine': sh(f'cat {CHROME_FLAGS_FILE}', check=False)}
            report['startTempC'] = cool_down()  # the camera role warms the phone; start cool
            with sync_playwright() as pw:
                dev = Phone(pw)
                try:
                    dev.expected_index = next((f['sha256'] for f in (artifact or {}).get('files', []) if f['path'] == 'deploy-next/index.html'), None)
                    run_journeys(dev, args, cell, gpu, out, report, memory=True)
                    dev.screenshot(out / f'{cell}-last.png')
                finally:
                    dev.close()
        finally:
            sh(f'am force-stop {CHROME}', check=False)
            session_end()
            if paused:
                report['cameraAfter'] = camera_resume()
            STATE.unlink(missing_ok=True)
    report['evidenceErrors'] = report_findings(report, validate_journeys(args.journey), (artifact or {}).get('digest'))
    report['ok'] = not report['evidenceErrors']
    failed_journey = any(not r.get('ok') and r.get('status') != 'untested' for r in report['runs'])
    unavailable = not artifact or (gpu and not (report.get('capabilities') or {}).get('adapter')) or any(
        r.get('status') == 'untested' for r in report['runs'])
    if report['ok']:
        report['status'] = 'pass'
    elif failed_journey:
        report['status'] = 'fail'
    else:
        report['status'] = 'untested' if unavailable else 'fail'
    (out / f'{cell}.json').write_text(json.dumps(report, indent=2))
    log('cell_end', cell=cell, ok=report['ok'])
    return report


def run_cell_report(cell, args, out):
    rep = {'cell': cell, 'runs': []}
    try:
        rep = run_cell(cell, args, out, rep)
    except Exception as e:
        rep.update(ok=False, status='untested' if isinstance(e, Untested) else 'fail', error=f'{type(e).__name__}: {e}')
        (out / f'{cell}.json').write_text(json.dumps(rep, indent=2))
        log('cell_unavailable' if isinstance(e, Untested) else 'cell_failed', cell=cell, error=rep['error'])
    return rep


def run_cell_retrying(cell, args, out):
    """A page crash gets one more full attempt, recorded in the report; any other failure stands."""
    rep = run_cell_report(cell, args, out)
    if not rep['ok'] and any(r.get('crashed') for r in rep['runs']):
        log('cell_retry_after_crash', cell=cell)
        first = rep
        rep = run_cell_report(cell, args, out)
        rep['retriedAfterCrash'] = first['runs']
        (out / f'{cell}.json').write_text(json.dumps(rep, indent=2))
    return rep


def port_listening(port):
    """Whether a process listens on the port. SO_REUSEADDR lets the probe ignore TIME-WAIT sockets a
    just-finished run leaves behind (the server itself reuses the address), while a live listener still
    refuses the bind."""
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            return True
    return False


class LocalServer:
    """Serves an exact candidate artifact under the production origin (classic's qualification server),
    reached by eris Chromium through host-resolver rules and by the phone through adb reverse."""

    def __init__(self, artifact, runtime_sha, out, *, port=LOCAL_PORT):
        self.artifact, self.runtime_sha, self.out = Path(artifact).resolve(), runtime_sha, out
        self.port = local_port(port)
        if self.artifact.name == 'deploy-next':
            self.artifact = self.artifact.parent

    def __enter__(self):
        # Refuse an occupied port rather than probing another session's server as our artifact.
        if port_listening(self.port):
            raise OSError(f'127.0.0.1:{self.port} is already served by another process')
        runtime = Path(os.environ.get('RUNTIME_FILES', self.artifact / '.runtime-public'))
        if not runtime.exists():
            raise RuntimeError(f'No acquired runtime at {runtime}; set RUNTIME_FILES to a verified runtime directory')
        key, crt = self.out / 'next.key', self.out / 'next.crt'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
                        '-days', '1', '-subj', f'/CN={ORIGIN_HOST}'], check=True, capture_output=True)
        cmd = [sys.executable, CHECKOUT / 'apps/web/scripts/next-e2e-server.py', '--manifest-sha', self.runtime_sha,
               '--runtime-overlay', runtime, '--runtime-files', runtime,
               '--cert', crt, '--key', key, '--port', self.port]
        self.log = open(self.out / 'server.log', 'w')
        self.proc = subprocess.Popen([str(c) for c in cmd], cwd=self.artifact, stdout=self.log, stderr=subprocess.STDOUT)
        try:
            for _ in range(60):
                if self.proc.poll() is not None:
                    raise RuntimeError('local server exited; see server.log')
                if subprocess.run(['curl', '-kfsS', '--max-time', '2', f'https://127.0.0.1:{self.port}/runtime/manifest.json'],
                                  capture_output=True).returncode == 0:
                    log('local_server_ready', artifact=str(self.artifact))
                    return self
                time.sleep(1)
            raise RuntimeError('local server did not become ready')
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self, *exc):
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(10)
        finally:
            self.log.close()
            (self.out / 'next.key').unlink(missing_ok=True)
            (self.out / 'next.crt').unlink(missing_ok=True)


def summarise(reports, out, title, beads=()):
    def cellrow(r):
        def fmt(j, k):
            v = [x.get(j, {}).get(k) for x in r['runs'] if x.get(j)]
            return '/'.join(f'{t:.0f}s' for t in v) if v else '–'
        route = next((x[j]['route'] for x in r['runs'] for j in ('warm', 'cold') if x.get(j)), '–')
        err = next((x['error'] for x in r['runs'] if x.get('error')), r.get('error') or '; '.join(r.get('evidenceErrors', [])))
        err = err.replace('\n', ' ').replace('|', '/')
        res = r.get('status', 'pass' if r.get('ok') else 'FAIL') + (' (after a crash retry)' if r.get('retriedAfterCrash') else '')
        return f"| {r['cell']} | {res} | {fmt('cold', 'faceS')} | {fmt('warm', 'faceS')} | {fmt('morph', 'videoS')} | {route} | {err[:120]} |"
    md = [f'## {title}', '', '| Cell | Result | Cold face | Warm face | Morph video | Route | Error |', '|---|---|---|---|---|---|---|']
    md += [cellrow(r) for r in reports]
    budgets = budget_rows(reports)
    if budgets:
        md += ['', '| Cell | Journey | Duration | Budget | Verdict |', '|---|---|---|---|---|'] + budgets
    for r in reports:
        if r.get('budgetDeferredToPairs'):
            md += ['', f"{r['cell']}: judged by the phone pairs against the pinned control, not here: "
                   + '; '.join(r['budgetDeferredToPairs']) + '.']
    compared = [r for r in reports if r.get('controlComparison')]
    if compared:
        md += ['', f"Phone cells against the pinned control, back to back on the same phone and link "
               f"({compared[0]['controlComparison']['url']}): within the absolute budget, or not worse than the control "
               f"(worse = over {NOT_WORSE_RATIO}x and more than {NOT_WORSE_FLOOR_S * 1000:.0f} ms slower).", '',
               '| Cell | Journey | Budget | Candidate | Control | Verdict |', '|---|---|---|---|---|---|']
        md += [f"| {r['cell']} | {x['journey']} | {'–' if x['budgetS'] is None else f"{x['budgetS']}s"} | {x['candidateS']}s | "
               f"{'–' if x['controlS'] is None else f"{x['controlS']}s"} | {x['verdict']} |"
               for r in compared for x in r['controlComparison']['rows']]
    for r in reports:
        browser = r.get('browser') or {}
        artifact = r.get('artifact') or {}
        md += ['', f"{r['cell']}: browser `{json.dumps(browser)}`; artifact `{artifact.get('digest', 'unbound')}` ({artifact.get('kind', 'unbound')}); URL `{r.get('url', 'unknown')}`."]
    if beads:
        md += ['', f"Beads in the tested build: {', '.join(beads)}."]
    text = '\n'.join(md) + '\n'
    (out / 'summary.md').write_text(text)
    (out / 'summary.json').write_text(json.dumps({'title': title, 'ok': bool(reports) and all(r.get('ok') for r in reports),
        'requiredCells': list(CELLS), 'missingCells': sorted(set(CELLS) - {r['cell'] for r in reports}),
        'beads': list(beads), 'cells': reports}, indent=2))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
            f.write(text)
    print(text)


BEADS_REPO = HERE.parents[1]
BEAD_ID = re.compile(r'\bfm-[a-z0-9]{2,}(?:\.[0-9]+)*\b')


QUALIFIED = STATE.parent / 'qualified.json'


def beads_in(messages, extra=()):
    """Every bead ID named across these commit messages, plus any given, deduplicated and sorted. Pure."""
    return sorted(set(extra or ()) | {b for m in messages for b in BEAD_ID.findall(m)})


def record_qualified(path, repo, sha):
    """The tested commit becomes this repository's base for the next qualify; other repositories keep theirs."""
    seen = json.loads(path.read_text()) if path.exists() else {}
    path.write_text(json.dumps(seen | {repo: sha}, indent=2))


def commit_messages(repo, sha, since):
    """Messages of every commit a build carries since the last qualified commit, so beads from earlier commits
    in a newest-only build still get their evidence. Falls back to the head commit alone, with the reason logged."""
    head = subprocess.run(['gh', 'api', f'repos/{repo}/commits/{sha}', '-q', '.commit.message'],
                          capture_output=True, text=True).stdout
    if not since:
        log('qualify_range', base=None, commits=1, reason='no earlier qualified commit recorded')
        return [head]
    r = subprocess.run(['gh', 'api', f'repos/{repo}/compare/{since}...{sha}', '-q',
                        '{status, msgs: [.commits[].commit.message]}'], capture_output=True, text=True)
    d = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {}
    if d.get('status') not in ('ahead', 'identical'):
        log('qualify_range', base=since, commits=1, reason=f"compare unusable ({d.get('status') or r.stderr.strip()[:80]})")
        return [head]
    log('qualify_range', base=since, commits=len(d['msgs']))
    return d['msgs'] or [head]


def br(*a):
    return subprocess.run(['br', *a, '--lock-timeout', '60000'], cwd=BEADS_REPO, capture_output=True, text=True)


LAB_FIX_ITEM = 'device-lab failure fixed and a later lab run passed (ticked by lab.py on that pass)'


def passback(beads, ok, out, title):
    """Device evidence goes to the beads it concerns. A failure hands each bead back: reopened if closed,
    labelled device-lab-failed and reopened, with the evidence as a comment and an unchecked acceptance item
    that the closure policy will not let anyone close past until a later lab run passes. A pass records the
    evidence, ticks that item and clears the failure label."""
    if not beads:
        return
    summary = (out / 'summary.md').read_text()
    where = os.environ.get('GITHUB_SERVER_URL', '') and f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    evidence = (f"Device lab {'passed' if ok else 'FAILED'}: {title}\n\n{summary}\n"
                f"Evidence: {where or out} (summary.json, per-cell JSON, failure frames/traces)\n")
    for b in beads:
        info = br('show', b, '--json')
        if info.returncode:
            log('passback_unknown_bead', bead=b)
            continue
        d = json.loads(info.stdout)
        d = d[0] if isinstance(d, list) else d
        pending = f'- [ ] {LAB_FIX_ITEM}' in (d.get('acceptance_criteria') or '')
        if ok:
            br('comments', 'add', b, evidence)
            br('update', b, '--remove-label', 'device-lab-failed')
            if pending:
                br('update', b, '--check-acceptance', LAB_FIX_ITEM)
        else:
            if d.get('status') == 'closed':
                br('reopen', b, '--reason', f'device lab failed: {title}')
            br('update', b, '--add-label', 'device-lab-failed', '--add-label', 'reopened')
            if LAB_FIX_ITEM not in (d.get('acceptance_criteria') or ''):
                br('update', b, '--add-acceptance', LAB_FIX_ITEM)
            elif not pending:
                br('update', b, '--uncheck-acceptance', LAB_FIX_ITEM)
            br('comments', 'add', b, evidence)
        log('passback', bead=b, ok=ok, status=d.get('status'), assignee=d.get('assignee'))
    br('sync', '--flush-only')


def run_matrix(args):
    validate_journeys(args.journey)  # refuse before locks, browser/device I/O or an empty success report
    if args.repeat < 1:
        raise ValueError('repeat must be at least 1')
    deployed = getattr(args, 'deployed', None)
    if args.artifact and getattr(args, 'control_url', None):
        raise ValueError('--control-url compares live sites; it does not apply to a locally served --artifact')
    if args.artifact and deployed:
        raise ValueError('--artifact serves a build locally; --deployed checks the one the URL serves; pass one')
    if getattr(args, 'artifact_digest', None) and not (args.artifact or deployed):
        raise ValueError('--artifact-digest needs --artifact or --deployed')
    import signal
    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGHUP, _terminate)
    cells = args.cells.split(',') if getattr(args, 'cells', None) else [args.cell]
    with lab_lock(cells):
        out = HERE / 'out' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + args.label)
        out.mkdir(parents=True, exist_ok=True)
        reports = []
        if args.artifact:
            args.artifact_evidence = artifact_evidence(args.artifact, getattr(args, 'artifact_digest', None))
            args.artifact = args.artifact_evidence['directory']
            args.local, args.url = True, f'https://{ORIGIN_HOST}/'
            with LocalServer(args.artifact, args.runtime_sha, out):
                for c in cells:
                    reports.append(run_cell_retrying(c, args, out))
        else:
            args.local = False
            if deployed:
                args.artifact_evidence = deployed_evidence(deployed, args.url, getattr(args, 'artifact_digest', None))
            control_url = getattr(args, 'control_url', None)
            if control_url:
                ctrl = argparse.Namespace(**{**vars(args), 'url': control_url, 'artifact_evidence': None,
                                             'label': args.label + '-control'})
                (out / 'control').mkdir(exist_ok=True)
            for c in cells:
                if not (control_url and CELLS[c][0] == 'phone'):
                    report = run_cell_retrying(c, args, out)
                    deferred = getattr(args, 'phone_budgets_from_pairs', None)
                    if deferred and CELLS[c][0] == 'phone':
                        defer_budgets(report, deferred.split(','))
                        (out / f'{c}.json').write_text(json.dumps(report, indent=2))
                    reports.append(report)
                    continue
                # Control, candidate, control, ...: the same phone and link, alternating so drift lands on both.
                mine, theirs = [], []
                for i in range(NOT_WORSE_PAIRS):
                    theirs.append(run_cell_retrying(c, ctrl, out / 'control'))
                    mine.append(run_cell_retrying(c, args, out))
                report = apply_not_worse(merge_pairs(mine), merge_pairs(theirs))
                (out / f'{c}.json').write_text(json.dumps(report, indent=2))
                reports.append(report)
    title = f'Device lab: {args.label} ({args.url})'
    beads = sorted(set(getattr(args, 'bead', None) or []))
    summarise(reports, out, title, beads)
    ok = all(r.get('ok') for r in reports)
    if os.environ.get('GITHUB_ACTIONS'):
        if beads and os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
                f.write(f"\nBeads in the tested commit: {', '.join(beads)}. "
                        + ('' if ok else f"Pass them back with: `lab.py qualify --run <this build's run id> --bead {' --bead '.join(beads)}`\n"))
    else:
        passback(beads, ok, out, title)
    return ok


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('preflight')
    sub.add_parser('recover', help='undo whatever a killed session left behind')
    cam = sub.add_parser('camera')
    cam.add_argument('action', choices=['status', 'pause', 'resume', 'off', 'on'])
    def common(p, default_journey):
        p.add_argument('--url', default='https://next.facemorph.me/')
        p.add_argument('--artifact', help='serve this exact candidate artifact locally under the production origin')
        p.add_argument('--deployed', help='the artifact --url should serve: every file is fetched and compared before the run')
        p.add_argument('--control-url', help='the pinned control live: each phone cell is measured there straight after --url')
        p.add_argument('--phone-budgets-from-pairs', help='journeys (e.g. cold-face,warm-face) whose phone budget the later phone pairs judge')
        p.add_argument('--artifact-digest', help='require this integrated-verification artifact SHA256')
        p.add_argument('--runtime-sha', help='runtime manifest SHA256 for --artifact (fails closed if it differs)')
        p.add_argument('--journey', default=default_journey)
        p.add_argument('--repeat', type=int, default=1)
        p.add_argument('--label', default='run')
        p.add_argument('--keep-camera', action='store_true', help='do not pause the Frigate camera')
        p.add_argument('--bead', action='append', help='bead(s) this run is evidence for: a failure passes them back')
    r = sub.add_parser('run', help='one cell')
    r.add_argument('--cell', choices=list(CELLS), default='phone-cpu')
    common(r, 'cold-face,warm-face')
    q = sub.add_parser('qualify', help='fetch a candidate build by CI run id and run the matrix on it (any agent, any time, before deploying)')
    q.add_argument('--run', required=True, help='GitHub Actions run id of the build (classic: New site artifact)')
    q.add_argument('--repo', default='facemorph-me/facemorph.me-classic')
    q.add_argument('--runtime-sha', default='d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c')
    q.add_argument('--cells', default=','.join(CELLS))
    q.add_argument('--artifact-digest')
    q.add_argument('--journey', default='cold-face,warm-face,morph')
    q.add_argument('--repeat', type=int, default=1)
    q.add_argument('--keep-camera', action='store_true')
    q.add_argument('--bead', action='append', help='beads to pass back; every commit since the last qualified one is also scanned for fm-... ids')
    q.add_argument('--since', help='scan commits after this one instead of the last qualified commit')
    m = sub.add_parser('matrix', help='several cells, one summary (the deploy gate)')
    m.add_argument('--cells', default=','.join(CELLS))
    common(m, 'cold-face,warm-face,morph')
    a = ap.parse_args()
    if a.cmd == 'preflight':
        state = adb('get-state', check=False)
        print(json.dumps({'adb': state, **(device_facts() if state == 'device' else {}), 'camera': camera_status() if state == 'device' else None}, indent=2))
        sys.exit(0 if state == 'device' else 1)
    if a.cmd == 'recover':
        print(json.dumps({'recovered': recover(), 'camera': camera_status()}, indent=2))
        return
    if a.cmd == 'camera':
        fn = {'status': camera_status, 'pause': camera_pause, 'resume': camera_resume, 'off': camera_off, 'on': camera_on}[a.action]
        print(json.dumps((fn() or camera_status()) | {'heldOff': HOLD.exists()}, indent=2))
        return
    if a.cmd == 'qualify':
        name = subprocess.run(['gh', 'api', f'repos/{a.repo}/actions/runs/{a.run}/artifacts', '-q',
                               '.artifacts[] | select(.name|startswith("next-site-")) | .name'],
                              capture_output=True, text=True, check=True).stdout.split()[0]
        dest = Path.home() / '.cache/facemorph-device-lab/artifacts' / name
        if not (dest / 'deploy-next').exists():
            dest.mkdir(parents=True, exist_ok=True)
            subprocess.run(['gh', 'run', 'download', a.run, '-R', a.repo, '-n', name, '-D', str(dest)], check=True)
        mirror = Path.home() / '.cache/facemorph-device-lab/runtime-mirror'
        mirror.mkdir(parents=True, exist_ok=True)
        if not (dest / '.runtime-mirror').exists():
            (dest / '.runtime-mirror').symlink_to(mirror)
        os.environ.setdefault('RUNTIME_FILES', str(Path.home() / '.cache/facemorph-device-lab/runtime-public'))
        a.artifact, a.url, a.label = str(dest), f'https://{ORIGIN_HOST}/', f'qualify-{name}'
        sha = name.removeprefix('next-site-')
        seen = json.loads(QUALIFIED.read_text()) if QUALIFIED.exists() else {}
        a.bead = beads_in(commit_messages(a.repo, sha, a.since or seen.get(a.repo)), a.bead)
        log('qualify_beads', repo=a.repo, sha=sha, beads=a.bead)
        ok = run_matrix(a)
        # The passback has covered this range, pass or fail; the next qualify starts after it.
        record_qualified(QUALIFIED, a.repo, sha)
        sys.exit(0 if ok else 1)
    if a.artifact and not a.runtime_sha:
        raise SystemExit('--artifact needs --runtime-sha')
    sys.exit(0 if run_matrix(a) else 1)


if __name__ == '__main__':
    main()

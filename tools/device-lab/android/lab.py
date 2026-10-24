#!/usr/bin/env python3
"""Physical Android device lab: a human-free, repeatable loop on the Huawei P30 Pro (VOG-L29).

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
import argparse, json, os, re, subprocess, sys, threading, time
from datetime import datetime, timezone
from pathlib import Path

ADB = os.environ.get('ADB', str(Path.home() / 'Android/Sdk/platform-tools/adb'))
SERIAL = os.environ.get('ANDROID_SERIAL', 'DUM0220115002146')
HERE = Path(__file__).resolve().parent
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


def save_state(**kw):
    SAVED.update(kw)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(SAVED))


def recover():
    """Undoes whatever a previous session left behind (killed runs skip their own cleanup)."""
    if not STATE.exists():
        return False
    SAVED.update(json.loads(STATE.read_text()))
    log('recovering_stale_session', **SAVED)
    session_end()
    if SAVED.get('cameraPaused'):
        camera_resume()
    STATE.unlink(missing_ok=True)
    SAVED.clear()
    return True


def session_begin():
    """Screen on and portrait for the session; remembers the settings it changes."""
    save_state(rotation=sh('settings get system accelerometer_rotation', check=False),
               user_rotation=sh('settings get system user_rotation', check=False))
    sh('svc power stayon true')
    wake()
    sh('input keyevent KEYCODE_HOME', check=False)  # clear leftovers such as an open system photo picker
    sh('settings put system accelerometer_rotation 0; settings put system user_rotation 0', check=False)


def session_end():
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


class Phone:
    """Real Chrome on the phone over CDP, acting with OS-level taps."""

    def __init__(self, pw):
        # A cold Chrome start each session: clears dialogs left by earlier runs (Chrome's own photo
        # picker sits inside Chrome's activity, so focus checks cannot see it).
        sh(f'am force-stop {CHROME}', check=False)
        sh(f'am start -n {CHROME}/com.google.android.apps.chrome.Main -d about:blank >/dev/null', check=False)
        adb('forward', f'tcp:{CDP_PORT}', 'localabstract:chrome_devtools_remote')
        for _ in range(20):
            if 'chrome_devtools_remote' in sh('cat /proc/net/unix', check=False):
                break
            time.sleep(0.5)
        time.sleep(2)
        chrome_front()
        self.browser = pw.chromium.connect_over_cdp(f'http://localhost:{CDP_PORT}')
        ctx = self.browser.contexts[0]
        # A fresh tab, brought to the front: OS taps land on the visible tab, not on ctx.pages[0].
        self.page = ctx.new_page()
        self.page.bring_to_front()
        time.sleep(1)
        self.page.add_init_script(GUARD)
        self.cdp = ctx.new_cdp_session(self.page)

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
        info = self.js("""([sel,i])=>{const e=document.querySelectorAll(sel)[i];if(!e)return null;
          e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});return true}""", [selector, index])
        if not info:
            raise RuntimeError(f'no element {selector}[{index}]')
        time.sleep(0.6)  # let the toolbar settle after the scroll
        probe = """([sel,i])=>{const e=document.querySelectorAll(sel)[i];const r=e.getBoundingClientRect();
          const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
          const ok=r.width>0&&r.height>0&&!!hit&&(hit===e||e.contains(hit));
          if(ok){window.__labHit=null;addEventListener('pointerdown',ev=>{window.__labHit={inside:e.contains(ev.target),
            what:ev.target.outerHTML.slice(0,80)}},{capture:true,once:true});}
          return {x,y,ok,hit:hit?hit.outerHTML.slice(0,80):null}}"""
        end = time.time() + 8  # a control may appear or move as state settles; it must become hittable
        while True:
            info = self.js(probe, [selector, index])
            if info['ok'] or time.time() > end:
                break
            time.sleep(0.4)
        if not info['ok']:
            raise RuntimeError(f'{selector}[{index}] is not hittable at its centre (covered by {info["hit"]})')
        sx, sy = self.screen_point(info['x'], info['y'])
        sh(f'input tap {sx} {sy}')
        time.sleep(0.4)
        landed = self.js('window.__labHit')
        if not landed or not landed['inside']:
            raise RuntimeError(f'tap on {selector}[{index}] landed on {landed and landed["what"]}')

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

    def screenshot(self, path):
        with open(path, 'wb') as f:
            f.write(subprocess.run([ADB, '-s', SERIAL, 'exec-out', 'screencap', '-p'], capture_output=True).stdout)


def chrome_pss_mb():
    """Sum of Chrome browser and renderer PSS in MB (dumpsys meminfo)."""
    total = 0
    for line in sh('dumpsys meminfo | grep -i chrome', check=False).splitlines():
        m = re.match(r'\s*([\d,]+)K: (com\.android\.chrome\S*)', line)
        if m:
            total += int(m.group(1).replace(',', ''))
    return round(total / 1024)


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


def journey_face(phone, url, cold, word):
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
    phone.page.goto(url, wait_until='domcontentloaded')
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
    route = phone.js(f"document.querySelector('{S['route']}')?.innerText||''")
    return {'usableS': round(usable, 2), 'faceS': round(face, 2), 'route': route.strip()[:80],
            'typed': word, 'fieldValue': typed, 'typedExactly': typed == word}


def journey_morph(phone):
    t0 = time.time()
    btn = phone.js("[...document.querySelectorAll('button')].findIndex(b=>b.textContent.trim()==='Create morph')")
    if btn < 0:
        raise RuntimeError('no Create morph button')
    phone.tap('button', btn)
    phone.wait(f"(()=>{{const v=document.querySelector('{S['video']}');return !!v&&v.readyState>=2&&v.duration>0}})()", 1800)
    return {'videoS': round(time.time() - t0, 2)}


def _terminate(signum, frame):
    raise SystemExit(f'signal {signum}')


def run_session(args):
    import signal
    from playwright.sync_api import sync_playwright
    import fcntl
    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGHUP, _terminate)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    lock = open(STATE.parent / 'lab.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # the device lease: one session at a time
    except BlockingIOError:
        raise SystemExit('another device-lab session holds the phone')
    recover()
    out = HERE / 'out' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + args.label)
    out.mkdir(parents=True, exist_ok=True)
    report = {'label': args.label, 'url': args.url, 'device': device_facts(), 'runs': [], 'cameraBefore': camera_status()}
    log('session_start', **report['device'])
    if report['device']['batteryTempC'] > 42:
        raise SystemExit('phone too hot; refusing to start')
    paused = False
    try:
        if not args.keep_camera:
            camera_pause()
            paused = True
        session_begin()
        with sync_playwright() as pw:
            phone = Phone(pw)
            journeys = args.journey.split(',')
            for i in range(args.repeat):
                rec = {'iteration': i + 1}
                mem = MemorySampler()
                mem.start()
                try:
                    for j in journeys:
                        if j == 'cold-face':
                            rec['cold'] = journey_face(phone, args.url, True, f'lab{i}cold')
                        elif j == 'warm-face':
                            rec['warm'] = journey_face(phone, args.url, False, f'lab{i}warm')
                        elif j == 'morph':
                            rec['morph'] = journey_morph(phone)
                        log('journey_done', iteration=i + 1, journey=j)
                    rec['ok'] = True
                except Exception as e:
                    rec['ok'], rec['error'] = False, f'{type(e).__name__}: {e}'[:400]
                    phone.screenshot(out / f'fail-{i + 1}.png')
                    chrome_front()
                    log('journey_failed', iteration=i + 1, error=rec['error'])
                finally:
                    mem.stop.set()
                    mem.join(5)
                    rec['peakChromePssMb'] = mem.peak
                    rec['batteryTempC'] = device_facts()['batteryTempC']
                report['runs'].append(rec)
                (out / 'report.json').write_text(json.dumps(report, indent=2))
            phone.screenshot(out / 'last.png')
            try:
                phone.page.close()
            except Exception:
                pass
    finally:
        sh(f'am force-stop {CHROME}', check=False)
        session_end()
        if paused:
            report['cameraAfter'] = camera_resume()
        STATE.unlink(missing_ok=True)
        (out / 'report.json').write_text(json.dumps(report, indent=2))
        log('session_end', report=str(out / 'report.json'), ok=all(r.get('ok') for r in report['runs']))
    return report


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('preflight')
    sub.add_parser('recover', help='undo whatever a killed session left behind')
    cam = sub.add_parser('camera')
    cam.add_argument('action', choices=['status', 'pause', 'resume'])
    r = sub.add_parser('run')
    r.add_argument('--url', default='https://next.facemorph.me/')
    r.add_argument('--journey', default='cold-face,warm-face')
    r.add_argument('--repeat', type=int, default=1)
    r.add_argument('--label', default='run')
    r.add_argument('--keep-camera', action='store_true', help='do not pause the Frigate camera')
    a = ap.parse_args()
    if a.cmd == 'preflight':
        state = adb('get-state', check=False)
        print(json.dumps({'adb': state, **(device_facts() if state == 'device' else {}), 'camera': camera_status() if state == 'device' else None}, indent=2))
        sys.exit(0 if state == 'device' else 1)
    if a.cmd == 'recover':
        print(json.dumps({'recovered': recover(), 'camera': camera_status()}, indent=2))
        return
    if a.cmd == 'camera':
        print(json.dumps({'status': camera_status, 'pause': camera_pause, 'resume': camera_resume}[a.action]() or camera_status(), indent=2))
        return
    report = run_session(a)
    sys.exit(0 if all(x.get('ok') for x in report['runs']) else 1)


if __name__ == '__main__':
    main()

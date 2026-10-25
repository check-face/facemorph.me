#!/usr/bin/env python3
"""Hosted platform lanes (fm-5klw): the device lab's journeys on GitHub-hosted runners.

The same journeys as lab.py (cold face, warm face, morph to a playable video), with the same
real-pointer checks (the control under the click is the intended one), against the exact candidate
artifact, reporting the route each face used:

  python hosted.py browser --lane macos-webkit --browser webkit --artifact DIR --runtime-sha SHA --out DIR
  python hosted.py android --lane android-emulator-chrome --artifact DIR --runtime-sha SHA --out DIR
  python hosted.py ios --lane ios-simulator-safari --device 'iPhone 16 Pro' --artifact DIR --runtime-sha SHA --out DIR
  python hosted.py summary DIR          (markdown table of every <lane>.json under DIR)

`--browser` is a Playwright engine (chromium, firefox, webkit) or a branded channel (chrome, msedge).

Serving: the artifact is served over plain HTTP on localhost, a secure context in every browser, so
cross-origin isolation, workers and storage behave as in production without certificates or host
remapping; responses carry production's isolation headers. The runtime is the published one: the
lane first checks that the deployed manifest's digest is the runtime the artifact was qualified
with (a mismatch fails the lane instead of measuring another runtime), serves /runtime/ requests by
proxying the deployed origin, and the model files load from that origin by the manifest's absolute
URLs.

Hosted runners rarely expose a GPU adapter to pages, so lanes do not demand a route; each journey
records the route it used, and a lane fails when a journey fails. The iOS Simulator cannot be driven
over a debugging protocol, so its lane injects the journeys into the served page, which reports back
(classic scripts/next-ios-sim.py does the same for one face); its clicks are synthetic.
"""
import argparse, hashlib, http.server, json, mimetypes, platform, re, socketserver, subprocess, sys, uuid
import threading, time, types, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / 'scripts/hosting'))
from response_headers import headers_for  # noqa: E402
try:
    import fcntl  # noqa: F401  lab.py's device lease needs it
except ImportError:
    # Windows runners: hosted lanes never take the device lease (lab_lock is not called here), so
    # lab.py's import of it is satisfied by an empty module rather than a Unix-only one.
    sys.modules['lease'] = types.ModuleType('lease')
import lab  # noqa: E402

ORIGIN = 'https://next.facemorph.me'
CHANNELS = {'chrome': 'chromium', 'msedge': 'chromium', 'chromium': 'chromium', 'firefox': 'firefox', 'webkit': 'webkit'}
HOSTED_LANES = ('macos-webkit', 'macos-firefox', 'macos-chrome', 'windows-chrome',
                'windows-msedge', 'android-emulator-chrome', 'ios-simulator-safari')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('image/webp', '.webp')


# ---------------------------------------------------------------- the exact artifact, served
def manifest_sha(origin=ORIGIN):
    with urllib.request.urlopen(urllib.request.Request(origin + '/runtime/manifest.json', headers={'User-Agent': 'curl/8'}), timeout=60) as r:
        return hashlib.sha256(r.read()).hexdigest()


class ArtifactServer:
    """The artifact directory on http://127.0.0.1:<port>/ with /runtime/ proxied (and cached) from the
    deployed origin. `inject(html)` may rewrite index.html per request (the iOS lane's journeys)."""

    def __init__(self, artifact, runtime_sha, port, cache, inject=None, on_post=None):
        self.artifact = Path(artifact).resolve()
        self.runtime_sha, self.port, self.cache = runtime_sha, port, Path(cache)
        self.inject, self.on_post = inject, on_post
        assert (self.artifact / 'index.html').exists(), f'no built artifact at {self.artifact}'

    def __enter__(self):
        live = manifest_sha()
        if live != self.runtime_sha:
            raise SystemExit(f'the deployed runtime manifest is {live}, not the pinned {self.runtime_sha}: refusing to measure another runtime')
        self.cache.mkdir(parents=True, exist_ok=True)
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def send(self, status, body, kind, extra=()):
                self.send_response(status)
                for k, v in [('Content-Type', kind), ('Content-Length', str(len(body))),
                             *headers_for(self.path.split('?')[0]).items(), *extra]:
                    self.send_header(k, v)
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(body)

            def body_for(self, path):
                if path.startswith('/runtime/'):
                    return server.runtime(path)
                if path in ('/', '/index.html'):
                    html = (server.artifact / 'index.html').read_text()
                    return (server.inject(html) if server.inject else html).encode(), 'text/html; charset=utf-8'
                file = (server.artifact / path.lstrip('/')).resolve()
                if (server.artifact in file.parents and not file.exists() and not file.suffix
                        and 'text/html' in self.headers.get('Accept', '')):
                    html = (server.artifact / 'index.html').read_text()
                    return (server.inject(html) if server.inject else html).encode(), 'text/html; charset=utf-8'
                if server.artifact not in file.parents or not file.is_file():
                    return None, None
                return file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream'

            def do_GET(self):
                try:
                    body, kind = self.body_for(self.path.split('?')[0])
                except Exception as e:  # an origin fetch that failed: the page sees a 502, the log says why
                    lab.log('serve_failed', path=self.path, error=str(e)[:200])
                    return self.send(502, b'', 'text/plain')
                if body is None:
                    return self.send(404, b'', 'text/plain')
                m = re.match(r'bytes=(\d+)-(\d*)$', self.headers.get('Range', ''))
                if m:
                    start, end = int(m[1]), int(m[2]) if m[2] else len(body) - 1
                    end = min(end, len(body) - 1)
                    return self.send(206, body[start:end + 1], kind, [('Content-Range', f'bytes {start}-{end}/{len(body)}'), ('Accept-Ranges', 'bytes')])
                self.send(200, body, kind, [('Accept-Ranges', 'bytes')])

            do_HEAD = do_GET

            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/__lane' or not server.on_post or not 0 < size < 4 << 20:
                    return self.send(404, b'', 'text/plain')
                server.on_post(json.loads(self.rfile.read(size)))
                self.send(200, b'{}', 'application/json')

        class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True
            allow_reuse_address = True

        self.httpd = Server(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        lab.log('artifact_server_ready', artifact=str(self.artifact), port=self.port, runtime=self.runtime_sha)
        return self

    def runtime(self, path):
        """One runtime file from the deployed origin, fetched once per lane."""
        key = self.cache / hashlib.sha256(path.encode()).hexdigest()
        if not key.exists():
            with urllib.request.urlopen(urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'curl/8'}), timeout=300) as r:
                data, kind = r.read(), r.headers.get('Content-Type', 'application/octet-stream')
            tmp = key.with_suffix('.part')
            tmp.write_bytes(data)
            tmp.rename(key)
            key.with_suffix('.type').write_text(kind)
        return key.read_bytes(), key.with_suffix('.type').read_text()

    @property
    def url(self):
        return f'http://localhost:{self.port}/'

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


# ---------------------------------------------------------------- devices
WARM_RESET = """async () => {
  const names = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : ['checkface-originals-v1'];
  await Promise.all(names.map(n => new Promise((done,fail) => {
    const q = indexedDB.deleteDatabase(n);
    q.onsuccess = () => done();
    q.onerror = () => fail(q.error);
    q.onblocked = () => fail(Error('warm reset blocked: ' + n));
  })));
  localStorage.clear();
  return names;
}"""


class OriginStorage:
    """For engines without the DevTools protocol: the one call the warm journey makes,
    Storage.clearDataForOrigin for IndexedDB and local storage, done from a page on the origin."""

    def __init__(self, dev):
        self.dev = dev

    def send(self, method, params):
        if method != 'Storage.clearDataForOrigin' or set(params['storageTypes'].split(',')) != {'indexeddb', 'local_storage'}:
            raise NotImplementedError(f'{method} {params} is not available without the DevTools protocol')
        # The journey has already left the app. Reset storage from a short-lived
        # same-origin page, keeping Firefox's journey tab out of competing blank
        # navigations and always releasing the reset page if deletion fails.
        reset = self.dev.page.context.new_page()
        try:
            reset.goto(params['origin'] + '/robots.txt')
            reset.evaluate(WARM_RESET)
        finally:
            reset.close()


class HostedBrowser(lab.Desktop):
    """A Playwright browser on the hosted runner, with lab.Desktop's real-mouse tap and typing. A cold
    journey starts from an empty profile; a warm one keeps it and clears only the saved session."""

    def __init__(self, pw, browser, out):
        self.pw, self.browser, self.out, self.n = pw, browser, out, 0
        self._open()

    def _open(self):
        self.n += 1
        engine = getattr(self.pw, CHANNELS[self.browser])
        kw = {'headless': True, 'viewport': {'width': 1280, 'height': 900}}
        if self.browser in ('chrome', 'msedge'):
            kw['channel'] = self.browser
        self.ctx = engine.launch_persistent_context(str(self.out / f'profile-{self.n}'), **kw)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.add_init_script(lab.GUARD)
        self.page.add_init_script(PROGRESS_OBSERVER)
        self.browser_errors = []
        self.page.on('pageerror', lambda error: self.browser_errors.append(str(error)[:800]) if len(self.browser_errors) < 40 else None)
        self.cdp = self.ctx.new_cdp_session(self.page) if CHANNELS[self.browser] == 'chromium' else OriginStorage(self)
        self.crashed = False
        self.page.on('crash', lambda *_: setattr(self, 'crashed', True))

    def clear_origin(self, url):
        self.ctx.close()
        self._open()

    def type_into(self, selector, text, index=0):
        """lab.Desktop's typing clears with End then Backspace; on macOS End does not move the caret
        to the end of an input, so clear by select-all with the platform's modifier instead."""
        self.tap(selector, index)
        self.page.keyboard.press('ControlOrMeta+A')
        self.page.keyboard.press('Backspace')
        self.page.keyboard.type(text, delay=30)
        time.sleep(0.5)
        return self.js("([s,i])=>document.querySelectorAll(s)[i].value", [selector, index])

    def version(self):
        return self.page.evaluate('navigator.userAgent')


class AndroidChrome(lab.Desktop):
    """Chrome in the Android emulator over the DevTools protocol (adb forward), reaching the runner's
    server through adb reverse, so localhost is the page's origin there too."""

    def __init__(self, pw, port):
        def adb(*a):
            return subprocess.run(['adb', *a], capture_output=True, text=True, timeout=120).stdout

        adb('reverse', f'tcp:{port}', f'tcp:{port}')
        adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome')
        adb('shell', "echo 'chrome --no-first-run --disable-fre --no-default-browser-check' > /data/local/tmp/chrome-command-line")
        adb('shell', 'am', 'force-stop', 'com.android.chrome')
        adb('shell', 'am', 'start', '-W', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', 'about:blank')
        adb('forward', f'tcp:{lab.CDP_PORT}', 'localabstract:chrome_devtools_remote')
        for _ in range(60):
            if 'chrome_devtools_remote' in adb('shell', 'cat', '/proc/net/unix'):
                break
            time.sleep(2)
        self.adb = adb
        self.browser_cdp = pw.chromium.connect_over_cdp(f'http://127.0.0.1:{lab.CDP_PORT}')
        self.context = self.browser_cdp.contexts[0]
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        self.page.add_init_script(lab.GUARD)
        self.page.add_init_script(PROGRESS_OBSERVER)
        self.browser_errors = []
        self.page.on('pageerror', lambda error: self.browser_errors.append(str(error)[:800]) if len(self.browser_errors) < 40 else None)
        self.cdp = self.context.new_cdp_session(self.page)
        self.crashed = False
        self.page.on('crash', lambda *_: setattr(self, 'crashed', True))

    clear_origin = lab.Phone.clear_origin

    def version(self):
        return self.page.evaluate('navigator.userAgent')

    def screenshot(self, path):
        with open(path, 'wb') as f:
            f.write(subprocess.run(['adb', 'exec-out', 'screencap', '-p'], capture_output=True, timeout=30).stdout)

    def close(self):
        try:
            self.browser_cdp.close()
        finally:
            self.adb('shell', 'am', 'force-stop', 'com.android.chrome')


# ---------------------------------------------------------------- lanes
def lane_report(lane, kind, url, extra):
    return {'lane': lane, 'kind': kind, 'url': url, 'os': f'{platform.system()} {platform.release()} {platform.machine()}', 'runs': [], **extra}


def finish(report, out):
    report['ok'] = bool(report['runs']) and all(r.get('ok') for r in report['runs'])
    report['routes'] = {k: r[k]['route'] for r in report['runs'] for k in ('cold', 'warm') if isinstance(r.get(k), dict) and 'route' in r[k]}
    (out / f"{report['lane']}.json").write_text(json.dumps(report, indent=2))
    lab.log('lane_end', lane=report['lane'], ok=report['ok'], routes=report['routes'])
    return 0 if report['ok'] else 1


# Bounded failure context for real hosted browser runs. A mutation observer sees
# actual status changes; it neither injects results nor sends visitor diagnostics.
PROGRESS_OBSERVER = r"""
(() => {
  const history = window.__hostedProgress = [];
  let previous = '';
  const capture = () => {
    const product = document.querySelector('.next-product');
    const video = document.querySelector('video');
    const state = {
      busy: product?.getAttribute('data-next-busy'),
      status: [...document.querySelectorAll('[role="status"], [role="alert"], .next-status')]
        .map(el => el.textContent.slice(0, 400)).slice(0, 8),
      images: document.querySelectorAll('img').length,
      video: video ? {readyState: video.readyState, networkState: video.networkState,
        error: video.error?.code, width: video.videoWidth, height: video.videoHeight} : null
    };
    const signature = JSON.stringify(state);
    if (signature === previous) return;
    previous = signature;
    history.push({at: Math.round(performance.now()), ...state});
    if (history.length > 120) history.shift();
  };
  new MutationObserver(capture).observe(document, {subtree: true, childList: true,
    characterData: true, attributes: true, attributeFilter: ['data-next-busy', 'src']});
})();
"""


def run_driven(args, make_device, kind):
    """A lane whose browser Playwright drives: lab.run_journeys with a hosted device."""
    from playwright.sync_api import sync_playwright
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    lab.CELLS[args.lane] = (kind, None)  # run_journeys keys its per-cell handling on the kind
    with ArtifactServer(args.artifact, args.runtime_sha, args.port, out / 'runtime-cache') as srv:
        args.url = srv.url
        report = lane_report(args.lane, kind, srv.url, {'browser': getattr(args, 'browser', 'chrome-android')})
        with sync_playwright() as pw:
            dev = make_device(pw, srv)
            try:
                report['userAgent'] = dev.version()
                # Keep real browser errors and progress leading up to a failed journey.
                # This observes DOM/media state; it does not replace browser APIs or
                # change the app's timers, model routes or media readiness checks.
                lab.run_journeys(dev, args, args.lane, None, out, report)
                if not all(run.get('ok') for run in report['runs']):
                    report['browserErrors'] = dev.browser_errors
                    try:
                        report['progress'] = dev.page.evaluate('window.__hostedProgress || []')
                    except Exception as error:
                        report['progressError'] = str(error)[:400]
                dev.screenshot(out / f'{args.lane}-last.png')
            finally:
                dev.close()
    return finish(report, out)


def cmd_browser(args):
    return run_driven(args, lambda pw, srv: HostedBrowser(pw, args.browser, Path(args.out)), 'hosted-desktop')


def cmd_android(args):
    return run_driven(args, lambda pw, srv: AndroidChrome(pw, args.port), 'hosted-android')


# The iOS Simulator lane: the journeys run inside the served page and post each result back.
IOS_JOURNEYS = r"""
<script>
(async () => {
  const STAGE = sessionStorage.getItem('__laneStage') || 'cold';
  let doing = STAGE;  // the journey under way, named in a failure report
  const post = (body) => fetch('/__lane', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).catch(() => {});
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const FACES = (sel) => [...document.querySelectorAll(sel)].filter(i => (i.naturalWidth || i.width) === 1024).length;
  const S = __SELECTORS__;
  const wait = async (check, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const err = document.querySelector(S.error);
      if (err && err.innerText) throw Error('app error: ' + err.innerText.slice(0, 200));
      if (check()) return;
      await sleep(500);
    }
    throw Error('timed out waiting for ' + what);
  };
  // The control at its own visible centre must be the one clicked (elementFromPoint), as on the lab.
  const click = (el) => {
    el.scrollIntoView({block: 'center'});
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!(r.width > 0 && hit && (hit === el || el.contains(hit)))) throw Error('control covered by ' + (hit && hit.outerHTML.slice(0, 80)));
    el.click();
  };
  setInterval(() => { const b = document.querySelector('.next-download-dialog .next-download-accept'); if (b) b.click();
    const t = document.querySelector('.next-consent-toast button[aria-label="Ask me later"]'); if (t) t.click(); }, 250);
  const face = async (word) => {
    const t0 = performance.now();
    await wait(() => document.querySelector(S.product) && document.querySelector('.next-product').getAttribute('data-next-busy') !== 'true', 120000, 'the app');
    const usable = (performance.now() - t0) / 1000;
    await sleep(1500);
    const before = FACES(S.faceImage);
    const input = document.querySelector(S.faceText);
    click(input);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, word);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(500);
    const t1 = performance.now();
    click(document.querySelector(S.generate));
    await wait(() => FACES(S.faceImage) > before, 900000, 'the generated face');
    return {usableS: +usable.toFixed(2), faceS: +((performance.now() - t1) / 1000).toFixed(2),
            route: (document.querySelector(S.route)?.innerText || '').trim().slice(0, 80), typed: word, fieldValue: input.value};
  };
  try {
    if (STAGE === 'cold') {
      for (const k of await caches.keys()) await caches.delete(k);
      sessionStorage.setItem('__laneStage', 'warm');
      const cold = await face('lab0cold');
      await post({stage: 'cold', ok: true, result: cold, userAgent: navigator.userAgent});
      // Warm: models stay; the saved session (IndexedDB) and local storage go, then a fresh visit.
      const names = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : ['checkface-originals-v1'];
      await Promise.all(names.map(n => new Promise(done => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => done(); })));
      localStorage.clear();
      location.reload();
      return;
    }
    if (STAGE === 'warm') {
      sessionStorage.setItem('__laneStage', 'done');
      const warm = await face('lab0warm');
      await post({stage: 'warm', ok: true, result: warm});
      doing = 'morph';
      const t0 = performance.now();
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create morph');
      if (!btn) throw Error('no Create morph button');
      click(btn);
      const end = Date.now() + 1800000;
      await wait(() => !!document.querySelector(S.video)?.src, end - Date.now(), 'the encoded morph file');
      const video = document.querySelector(S.video);
      // Mobile Safari may leave a completed local Blob unbuffered until it is
      // requested. Exercise its real media loader; do not fabricate readiness.
      video.scrollIntoView({block: 'center'});
      video.load();
      await wait(() => {
        if (video.error) throw Error('morph media error ' + video.error.code + ': ' + video.error.message);
        return video.readyState >= 2 && video.duration > 0;
      }, Math.max(1, end - Date.now()), 'a playable morph video');
      await post({stage: 'morph', ok: true, result: {videoS: +((performance.now() - t0) / 1000).toFixed(2),
        duration: video.duration, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState}, done: true});
    }
  } catch (e) {
    const v = document.querySelector(S.video);
    await post({stage: doing, ok: false, error: String(e && e.message || e).slice(0, 400),
      media: v ? {readyState:v.readyState, networkState:v.networkState, error:v.error?.code,
        duration:Number.isFinite(v.duration)?v.duration:null, width:v.videoWidth, height:v.videoHeight,
        sourceAssigned:!!v.src, paused:v.paused, hidden:document.hidden} : null, done: true});
  }
})();
</script>
"""


def cmd_ios(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rec, done, stages = {'iteration': 1}, threading.Event(), []

    def on_post(msg):
        stages.append(msg)
        lab.log('ios_stage', stage=msg.get('stage'), ok=msg.get('ok'), error=msg.get('error'), media=msg.get('media'))
        if msg.get('ok'):
            rec[msg['stage']] = msg['result']
        else:
            rec['error'] = f"{msg.get('stage')}: {msg.get('error')}"
            if 'media' in msg:
                rec['media'] = msg['media']
        if msg.get('userAgent'):
            report['userAgent'] = msg['userAgent']
        if msg.get('done'):
            done.set()

    inject = lambda html: html.replace('</body>', IOS_JOURNEYS.replace('__SELECTORS__', json.dumps(lab.S)) + '</body>')
    with ArtifactServer(args.artifact, args.runtime_sha, args.port, out / 'runtime-cache', inject, on_post) as srv:
        report = lane_report(args.lane, 'hosted-ios-simulator', srv.url, {'browser': 'safari', 'device': args.device})

        def sim(*a, timeout=300):
            try:
                return subprocess.run(['xcrun', 'simctl', *a], capture_output=True, text=True, timeout=timeout)
            except subprocess.TimeoutExpired:
                return None  # slowness on a cold runner; the retry loop decides

        devices = json.loads(sim('list', 'devices', 'available', '--json').stdout)['devices']
        match = next((d for group in devices.values() for d in group if d['name'] == args.device), None)
        if not match:
            report.update(status='untested', ok=False, reason=f'no available Simulator named {args.device!r}')
            (out / f'{args.lane}.json').write_text(json.dumps(report, indent=2))
            return 0  # explicit unavailable evidence; never a passing journey
        udid = match['udid']
        if match['state'] != 'Booted':
            assert sim('boot', udid).returncode == 0
            sim('bootstatus', udid, '-b', timeout=600)
        sim('launch', udid, 'com.apple.mobilesafari')
        for _ in range(6):
            r = sim('openurl', udid, srv.url)
            if r is not None and r.returncode == 0:
                break
            time.sleep(10)
            sim('launch', udid, 'com.apple.mobilesafari')
        done.wait(timeout=args.timeout)
        sim('io', udid, 'screenshot', str(out / f'{args.lane}-last.png'), timeout=60)
    rec['ok'] = all(s.get('ok') for s in stages) and {s.get('stage') for s in stages} >= set(args.journey_stages)
    if not stages:
        rec['error'] = 'the Simulator page never reported'
    elif not rec['ok'] and 'error' not in rec:
        rec['error'] = f"journeys incomplete: reported {[s.get('stage') for s in stages]}"
    report['runs'].append(rec)
    return finish(report, out)


# The authoritative journey registry (fm-journey-registry-5cpg); hosted lanes have no frozen budgets yet.
REGISTRY = json.loads((HERE / 'journeys.json').read_text())['journeys']
TIMED = (('cold', 'cold-face', 'faceS'), ('warm', 'warm-face', 'faceS'), ('morph', 'morph', 'videoS'))


def budget_cell(report, run):
    """Each executed journey's duration against its registry budget for this lane."""
    if report.get('status') == 'untested' and not report.get('ok'):
        return 'untested'
    parts = []
    for key, journey, field in TIMED:
        if not isinstance(run.get(key), dict) or not isinstance(run[key].get(field), (int, float)):
            continue
        seconds = run[key][field]
        budget = ((REGISTRY.get(journey) or {}).get('budgetsS') or {}).get(report['lane'])
        verdict = 'unbudgeted' if budget is None else f"{'over' if seconds > budget else 'within'} {budget}s"
        parts.append(f'{journey} {seconds:.0f}s ({verdict})')
    return '; '.join(parts) or 'no timed journey'


def summarise(reports, expect=()):
    """Markdown rows, one per lane: outcome, routes and times as reported, nothing inferred. An
    expected lane with no report is a failed row, never a missing one."""
    seen = {r['lane'] for r in reports}
    reports = list(reports) + [{'lane': l, 'ok': False, 'runs': [{'error': 'no report (the lane did not finish)'}]} for l in expect if l not in seen]
    rows = ['| Lane | Result | Cold face (route, s) | Warm face (route, s) | Morph s | Duration vs budget | Browser |', '| --- | --- | --- | --- | --- | --- | --- |']
    for r in sorted(reports, key=lambda r: r['lane']):
        run = r['runs'][-1] if r.get('runs') else {}
        cell = lambda j: f"{run[j]['route'] or 'no route shown'}, {run[j]['faceS']}" if isinstance(run.get(j), dict) else 'not run'
        result = ('untested: ' + r['reason'] if r.get('status') == 'untested' and r.get('reason') and not r.get('ok')
                  else 'pass' if r.get('ok') else f"fail: {run.get('error', 'no run')}")
        result = result.replace('\n', ' ').replace('|', '/')[:160]
        morph = run['morph']['videoS'] if isinstance(run.get('morph'), dict) else 'not run'
        agent = (r.get('userAgent') or r.get('browser') or '')[:90]
        rows.append(f"| {r['lane']} | {result} | {cell('cold')} | {cell('warm')} | {morph} | {budget_cell(r, run)} | {agent} |")
    return '\n'.join(rows) + '\n'


def cmd_summary(args):
    reports = [json.loads(p.read_text()) for p in Path(args.dir).rglob('*.json') if p.parent.name != 'runtime-cache']
    reports = [r for r in reports if isinstance(r, dict) and 'lane' in r and 'runs' in r]
    expect = [l for l in args.expect.split(',') if l]
    print(summarise(reports, expect), end='')
    return 0 if reports and all(r.get('ok') or (r.get('status') == 'untested' and r.get('reason')) for r in reports) and {r['lane'] for r in reports} >= set(expect) else 1


def runner_unavailable_reason(job, annotations):
    """Only an explicit provider notice on a job with no executed steps establishes
    a terminal runner-availability failure. Generic startup/test errors still fail."""
    if job.get('steps') or job.get('conclusion') not in ('failure', 'startup_failure'):
        return None
    for annotation in annotations:
        message = annotation.get('message', '')
        if (re.search(r'job was not started because.*(?:spending limit|account payments)', message, re.I | re.S)
            or re.search(r'runner image.*(?:has been removed|is retired|is no longer supported)', message, re.I | re.S)):
            return message.strip()
    return None


def hosted_outcomes(jobs, reports, *, queue_expired=False, run_completed=False, unavailable=None):
    """Pure policy over actual API job fields and lane reports. Missing evidence fails
    closed, except a lane still awaiting a runner after the bounded queue attempt.
    Any executed failure wins over an unavailable report or another lane's pass."""
    rows = []
    for lane in HOSTED_LANES:
        matches = [j for j in jobs if lane in re.split(r'[\s(),]+', j['name'])
                   or (lane == 'android-emulator-chrome' and j['name'] == 'android')
                   or (lane == 'ios-simulator-safari' and j['name'] == 'ios')]
        found = [r for r in reports if r.get('lane') == lane]
        job = matches[0] if len(matches) == 1 else None
        report = found[0] if len(found) == 1 else None
        status, reason = 'fail', 'missing or ambiguous job/report evidence'
        if job:
            failures = [s['name'] for s in job.get('steps', []) if s.get('conclusion') in ('failure', 'timed_out', 'cancelled')]
            if not job.get('steps') and (unavailable or {}).get(job.get('id')):
                status, reason = 'untested', unavailable[job['id']]
            elif failures or job.get('conclusion') in ('failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required'):
                reason = 'executed job failed: ' + (', '.join(failures) or str(job.get('conclusion')))
            elif (queue_expired and not run_completed and job.get('status') == 'queued'
                  and not job.get('runner_name') and not job.get('steps')):
                status, reason = 'untested', 'no hosted runner allocated within the bounded queue attempt'
            elif job.get('status') != 'completed':
                status, reason = 'pending', 'allocated or running lane has not finished'
            elif job.get('conclusion') == 'success' and report:
                if report.get('status') == 'untested' and report.get('reason') and not report.get('ok') and not report.get('runs'):
                    status, reason = 'untested', report['reason']
                elif report.get('ok') and report.get('runs') and all(r.get('ok') for r in report['runs']):
                    status, reason = 'pass', 'requested journeys reported complete'
                else:
                    reason = 'lane reported a failed or incomplete journey'
        rows.append({'lane': lane, 'status': status, 'reason': reason, 'job': job.get('id') if job else None})
    return rows


def github_api(path, payload=None):
    command = ['gh', 'api', path]
    if payload is not None:
        command += ['--method', 'POST', '--input', '-']
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, check=True, timeout=60)
    return json.loads(result.stdout) if result.stdout.strip() else None


def cmd_release(args):
    """Dispatch hosted work separately so a runner that never starts cannot hold the
    reusable release workflow forever. Never cancel a run. Started tests must finish
    successfully; a bounded queue absence is untested, and late work stays linked."""
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    inputs = json.loads(Path(args.inputs).read_text())
    inputs['qualification_id'] = 'release-' + uuid.uuid4().hex
    root = f'repos/{args.repository}'
    github_api(root + '/actions/workflows/hosted-lanes.yml/dispatches', {'ref': args.ref, 'inputs': inputs})
    start = time.monotonic()
    run = None
    while time.monotonic() - start < args.queue_seconds:
        listing = github_api(root + '/actions/workflows/hosted-lanes.yml/runs?event=workflow_dispatch&per_page=100')
        run = next((r for r in listing['workflow_runs'] if r['display_title'] == 'hosted-' + inputs['qualification_id']), None)
        if run:
            break
        time.sleep(10)
    if not run:
        raise RuntimeError('dispatch was accepted but no correlated workflow run was found; availability is unknown')
    run_id = run['id']
    url = run['html_url']
    print('Hosted attempt: ' + url, flush=True)
    unavailable, inspected = {}, set()
    while True:
        run = github_api(root + f'/actions/runs/{run_id}')
        jobs = github_api(root + f'/actions/runs/{run_id}/jobs?per_page=100')['jobs']
        for job in jobs:
            if job['id'] not in inspected and not job.get('steps') and job.get('conclusion') in ('failure', 'startup_failure'):
                check = job.get('check_run_url')
                annotations = github_api(check.replace('https://api.github.com/', '', 1) + '/annotations?per_page=100') if check else []
                reason = runner_unavailable_reason(job, annotations)
                if reason:
                    unavailable[job['id']] = reason
                inspected.add(job['id'])
        elapsed = time.monotonic() - start
        rows = hosted_outcomes(jobs, [], queue_expired=elapsed >= args.queue_seconds,
                               run_completed=run['status'] == 'completed', unavailable=unavailable)
        # Missing reports become decisive only after their jobs finish; the API is
        # authoritative for which tests have actually started, not a guessed delay.
        waiting = any(r['status'] == 'pending' for r in rows)
        unknown = any(r['job'] is None and r['status'] != 'untested' for r in rows)
        if run['status'] == 'completed' or (elapsed >= args.queue_seconds and (unknown or not waiting)):
            break
        if elapsed >= args.timeout_seconds:
            raise TimeoutError(f'hosted attempt did not finish within {args.timeout_seconds}s: {url}')
        time.sleep(15)
    artifacts = github_api(root + f'/actions/runs/{run_id}/artifacts?per_page=100')['artifacts']
    for artifact in artifacts:
        if artifact['name'].startswith('lane-') and not artifact['expired']:
            subprocess.run(['gh', 'run', 'download', str(run_id), '--repo', args.repository,
                            '--name', artifact['name'], '--dir', str(out / artifact['name'])], check=True, timeout=120)
    reports = [json.loads(p.read_text()) for p in out.glob('lane-*/*.json')]
    reports = [r for r in reports if isinstance(r, dict) and 'lane' in r and 'runs' in r]
    rows = hosted_outcomes(jobs, reports, queue_expired=elapsed >= args.queue_seconds,
                           run_completed=run['status'] == 'completed', unavailable=unavailable)
    report = {'run': run_id, 'url': url, 'artifactDigest': args.artifact_digest, 'inputs': inputs, 'lanes': rows,
              'ok': all(r['status'] in ('pass', 'untested') for r in rows)}
    (out / 'hosted-release.json').write_text(json.dumps(report, indent=2))
    print(summarise(reports), end='')
    print('\n| Hosted lane | Qualification | Reason |\n| --- | --- | --- |')
    for row in rows:
        print(f"| {row['lane']} | {row['status']} | {row['reason'].replace('|', '/')} |")
    print('\nUntested hosted lanes are unavailable evidence, never passes. Six local cells remain required.\n'
          'Late queued work is not cancelled; inspect the linked attempt before handover and repair executed failures.')
    return 0 if report['ok'] else 1


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('browser', 'android', 'ios'):
        s = sub.add_parser(name)
        s.add_argument('--lane', required=True)
        s.add_argument('--artifact', required=True)
        s.add_argument('--runtime-sha', required=True)
        s.add_argument('--out', required=True)
        s.add_argument('--port', type=int, default=8791)
        s.add_argument('--journey', default='cold-face,warm-face,morph')
        s.add_argument('--repeat', type=int, default=1)
        if name == 'browser':
            s.add_argument('--browser', required=True, choices=sorted(CHANNELS))
        if name == 'ios':
            s.add_argument('--device', default='iPhone 16 Pro')
            s.add_argument('--timeout', type=int, default=3600)
    s = sub.add_parser('summary')
    s.add_argument('dir')
    s.add_argument('--expect', default='', help='comma-separated lanes that must have reported')
    s = sub.add_parser('release')
    s.add_argument('--repository', required=True)
    s.add_argument('--ref', default='main')
    s.add_argument('--inputs', required=True)
    s.add_argument('--artifact-digest', required=True)
    s.add_argument('--out', required=True)
    s.add_argument('--queue-seconds', type=int, default=300)
    s.add_argument('--timeout-seconds', type=int, default=6000)
    args = p.parse_args()
    if args.cmd == 'ios':
        args.journey_stages = ['cold', 'warm', 'morph']
    sys.exit({'browser': cmd_browser, 'android': cmd_android, 'ios': cmd_ios, 'summary': cmd_summary, 'release': cmd_release}[args.cmd](args))


if __name__ == '__main__':
    main()

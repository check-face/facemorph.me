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
import argparse, hashlib, http.server, json, mimetypes, platform, re, socketserver, subprocess, sys
import threading, time, types, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    import fcntl  # noqa: F401  lab.py's device lease needs it
except ImportError:
    # Windows runners: hosted lanes never take the device lease (lab_lock is not called here), so
    # lab.py's import of it is satisfied by an empty module rather than a Unix-only one.
    sys.modules['lease'] = types.ModuleType('lease')
import lab  # noqa: E402

ORIGIN = 'https://next.facemorph.me'
CHANNELS = {'chrome': 'chromium', 'msedge': 'chromium', 'chromium': 'chromium', 'firefox': 'firefox', 'webkit': 'webkit'}
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
                             ('Cross-Origin-Opener-Policy', 'same-origin'), ('Cross-Origin-Embedder-Policy', 'require-corp'),
                             ('Cross-Origin-Resource-Policy', 'cross-origin'), ('Cache-Control', 'no-cache'), *extra]:
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
  await Promise.all(names.map(n => new Promise(done => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => done(); })));
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
        self.dev.page.goto(params['origin'] + '/robots.txt')
        self.dev.page.evaluate(WARM_RESET)
        self.dev.page.goto('about:blank')


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
                lab.run_journeys(dev, args, args.lane, None, out, report)
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
      await wait(() => { const v = document.querySelector(S.video); return !!v && v.readyState >= 2 && v.duration > 0; }, 1800000, 'a playable morph video');
      await post({stage: 'morph', ok: true, result: {videoS: +((performance.now() - t0) / 1000).toFixed(2)}, done: true});
    }
  } catch (e) {
    await post({stage: doing, ok: false, error: String(e && e.message || e).slice(0, 400), done: true});
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
        lab.log('ios_stage', stage=msg.get('stage'), ok=msg.get('ok'), error=msg.get('error'))
        if msg.get('ok'):
            rec[msg['stage']] = msg['result']
        else:
            rec['error'] = f"{msg.get('stage')}: {msg.get('error')}"
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
        assert match, f'no available Simulator named {args.device!r}'
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


def summarise(reports, expect=()):
    """Markdown rows, one per lane: outcome, routes and times as reported, nothing inferred. An
    expected lane with no report is a failed row, never a missing one."""
    seen = {r['lane'] for r in reports}
    reports = list(reports) + [{'lane': l, 'ok': False, 'runs': [{'error': 'no report (the lane did not finish)'}]} for l in expect if l not in seen]
    rows = ['| Lane | Result | Cold face (route, s) | Warm face (route, s) | Morph s | Browser |', '| --- | --- | --- | --- | --- | --- |']
    for r in sorted(reports, key=lambda r: r['lane']):
        run = r['runs'][-1] if r.get('runs') else {}
        cell = lambda j: f"{run[j]['route'] or 'no route shown'}, {run[j]['faceS']}" if isinstance(run.get(j), dict) else 'not run'
        result = 'pass' if r.get('ok') else f"fail: {run.get('error', 'no run')}".replace('\n', ' ').replace('|', '/')[:160]
        morph = run['morph']['videoS'] if isinstance(run.get('morph'), dict) else 'not run'
        agent = (r.get('userAgent') or r.get('browser') or '')[:90]
        rows.append(f"| {r['lane']} | {result} | {cell('cold')} | {cell('warm')} | {morph} | {agent} |")
    return '\n'.join(rows) + '\n'


def cmd_summary(args):
    reports = [json.loads(p.read_text()) for p in Path(args.dir).rglob('*.json') if p.parent.name != 'runtime-cache']
    reports = [r for r in reports if isinstance(r, dict) and 'lane' in r and 'runs' in r]
    expect = [l for l in args.expect.split(',') if l]
    print(summarise(reports, expect), end='')
    return 0 if reports and all(r.get('ok') for r in reports) and {r['lane'] for r in reports} >= set(expect) else 1


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
    args = p.parse_args()
    if args.cmd == 'ios':
        args.journey_stages = ['cold', 'warm', 'morph']
    sys.exit({'browser': cmd_browser, 'android': cmd_android, 'ios': cmd_ios, 'summary': cmd_summary}[args.cmd](args))


if __name__ == '__main__':
    main()

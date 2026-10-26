#!/usr/bin/env python3
"""Cold full-package downloads on the device lab (fm-vf9l).

The field diagnostics (docs/findings/diagnostics-learnings-2026-10-18.md, finding 4) saw half of the cold full-package
downloads (face model plus photo encoder) stop or fail, and every failure carried only `operation_failed`. This runs
the download a first visitor starts from the model toast ("Plus photo encoder · N GB"), from an empty origin, and
records what the reports could not: bytes reached over time, every runtime request with the origin that answered it,
each retried chunk and the origin that finally served it, and the terminal event with its stage.

  uv run --with playwright python download.py --cells eris-cpu,eris-webgpu,phone-cpu --repeat 3
  uv run --with playwright python download.py --cells phone-cpu --interrupt 0.35:30     # Wi-Fi off for 30 s at 35 %
  uv run --with playwright python download.py --cells eris-cpu --interrupt 0.35:30      # every tunnel cut for 30 s
  uv run --with playwright python download.py --cells eris-cpu --interrupt 0.35:30 --cut blackhole  # silent dead link
  uv run --with playwright python download.py --cells eris-cpu --throttle-kbps 4000     # a 4 Mbit/s link
  uv run --with playwright python download.py --client package --cells eris-cpu,phone-cpu --interrupt 0.35:30

`--client package` runs the same cold download through browser-model-manager instead of the deployed app
(fm-fr9s): this checkout's package, built fresh, is served into a page of the real origin (the runtime manifest's own
document, so no app code runs beside it), and acquires the runtime manifest's face model and photo encoder from the
real origins under one grant, with the app's alternate-origin configuration. Its progress comes from the package's
own whole-acquisition counter; the summary adds every verified chunk fetched more than once (there must be none).

Interruptions are real. On the phone, Wi-Fi is switched off through adb and back on (the phone has no SIM, so it is
offline in between). On eris, Chromium goes through a local CONNECT proxy with a fault switch, which refuses new
tunnels for the duration and either resets every open one (`--cut drop`, a lost link) or leaves them open and silent
for good (`--cut blackhole`, what a sleeping laptop or a changed network leaves behind: no reset ever arrives). The
same proxy throttles the link. TLS stays end to end, so the origins answer exactly as they do for anyone. A run
without --interrupt or --throttle-kbps uses no proxy at all.

It takes the lab's lock and leaves the phone as lab.py does. Results go to out/<timestamp>-download-<label>/:
summary.md, summary.json, one <cell>-<n>.requests.jsonl network log per run, and a screenshot of each failure.
"""
import argparse, asyncio, inspect, json, re, signal, subprocess, threading, time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import lab
from lab import CELLS, log, sh

TOAST = '.next-model-toast'
ROOT = Path(__file__).resolve().parents[2]
# The full package a first visitor's "Plus photo encoder" takes: the CPU face model and the photo encoder.
PACKAGE_PARTS = ('runtime', 'mapping', 'synthesis', 'average', 'noise', 'encoder', 'landmarks')
HOSTS = ('next.facemorph.me', 'models.facemorph.me')
# The toast's own words for each phase (src/Next/Product.fs, model toast). Sizes are binary megabytes.
PHASES = (('Downloading the face model', 'route'), ('Downloading the photo encoder', 'photo'),
          ('Download paused', 'waiting'), ('The download stopped', 'failed'), ('Ready.', 'done'))
SIZE = r'([\d.]+) (MB|GB)'
MIB = 1024 * 1024


def mib(number, unit):
    return float(number) * (1024 if unit == 'GB' else 1)


def read_toast(text):
    """(phase, loaded MiB, total MiB) from the model toast's text; sizes are None when it shows none."""
    phase = next((p for words, p in PHASES if text.startswith(words)), 'idle' if text else 'hidden')
    m = re.search(SIZE + ' of ' + SIZE, text)
    return (phase, mib(*m.group(1, 2)), mib(*m.group(3, 4))) if m else (phase, None, None)


def parse_interrupt(value):
    """'0.35:30' -> (0.35, 30.0): cut the network once 35 % of the planned bytes have arrived, for 30 s."""
    at, _, seconds = value.partition(':')
    at, seconds = float(at), float(seconds or 30)
    if not 0 < at < 1 or seconds <= 0:
        raise argparse.ArgumentTypeError('--interrupt wants FRACTION:SECONDS with 0 < FRACTION < 1')
    return at, seconds


def retried_chunks(requests):
    """Every runtime file asked for more than once, with each attempt and the origin that finally served it. (App
    scripts load twice by design, once for the page and once for the worker, so only /runtime/ counts.)"""
    by_path = {}
    for r in requests:
        if r['path'].startswith('/runtime/'):
            by_path.setdefault(r['path'], []).append(r)
    out = []
    for path, attempts in by_path.items():
        if len(attempts) < 2:
            continue
        served = next((a['host'] for a in reversed(attempts) if a.get('status') == 200 and a.get('finished')), None)
        out.append({'path': path, 'servedBy': served,
                    'attempts': [{k: a.get(k) for k in ('t', 'host', 'query', 'status', 'failure', 'endT')} for a in attempts]})
    return out


def verified_refetches(requests):
    """Runtime files served whole (HTTP 200, finished) more than once: a verified chunk fetched again."""
    served = {}
    for r in requests:
        if r['path'].startswith('/runtime/') and r.get('status') == 200 and r.get('finished'):
            served[r['path']] = served.get(r['path'], 0) + 1
    return sorted(path for path, n in served.items() if n > 1)


def by_host(requests):
    out = {}
    for r in requests:
        h = out.setdefault(r['host'], {'requests': 0, 'finishedMb': 0.0, 'failed': 0})
        h['requests'] += 1
        h['finishedMb'] += (r.get('bytes') or 0) / MIB if r.get('finished') else 0
        h['failed'] += 1 if r.get('failure') else 0
    return {k: v | {'finishedMb': round(v['finishedMb'], 1)} for k, v in out.items()}


# ---------------------------------------------------------------- eris: a real link with a fault switch
class Proxy(threading.Thread):
    """HTTP CONNECT proxy on 127.0.0.1. `rate` (bytes/s, shared by every tunnel) throttles what comes down.
    `cut(True)` refuses new tunnels until `cut(False)`, and resets the open ones (mode 'drop') or silences them for
    good (mode 'blackhole': they forward nothing more and never close)."""

    def __init__(self, kbps=None, mode='drop'):
        super().__init__(daemon=True)
        self.rate, self.mode = (kbps * 125 if kbps else None), mode
        self.down, self.tunnels, self.dead, self.port, self.bytes = False, set(), set(), None, 0
        self.free_at = 0.0  # the shared link is busy until this monotonic time
        self.loop, self.ready = asyncio.new_event_loop(), threading.Event()

    def run(self):
        asyncio.set_event_loop(self.loop)
        server = self.loop.run_until_complete(asyncio.start_server(self.handle, '127.0.0.1', 0))
        self.port = server.sockets[0].getsockname()[1]
        self.ready.set()
        self.loop.run_forever()

    async def handle(self, reader, writer):
        try:
            head = await reader.readuntil(b'\r\n\r\n')
            m = re.match(rb'CONNECT ([^\s:]+):(\d+) HTTP/1\.[01]\r\n', head)
            if not m or self.down:
                raise ConnectionRefusedError
            up_r, up_w = await asyncio.open_connection(m[1].decode(), int(m[2]))
        except Exception:
            writer.transport.abort()
            return
        writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        pair = (writer, up_w)
        self.tunnels.add(pair)
        try:
            await asyncio.gather(self.pipe(reader, up_w, False), self.pipe(up_r, writer, True))
        finally:
            self.tunnels.discard(pair)

    async def pipe(self, reader, writer, downstream):
        try:
            while data := await reader.read(16384):
                while writer in self.dead:  # blackholed: hold everything, send nothing, close nothing
                    await asyncio.sleep(3600)
                if downstream:
                    self.bytes += len(data)
                    if self.rate:
                        now = time.monotonic()
                        self.free_at = max(self.free_at, now) + len(data) / self.rate
                        await asyncio.sleep(self.free_at - now)
                writer.write(data)
                await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    def cut(self, down):
        def apply():
            self.down = down
            if down:
                for pair in list(self.tunnels):
                    for w in pair:
                        if self.mode == 'drop':
                            w.transport.abort()
                        else:
                            self.dead.add(w)
        self.loop.call_soon_threadsafe(apply)

    def stop(self):
        def close():
            for pair in list(self.tunnels):
                for w in pair:
                    w.transport.abort()
            for task in asyncio.all_tasks(self.loop):
                task.cancel()
            self.loop.call_later(0.5, self.loop.stop)
        self.loop.call_soon_threadsafe(close)
        self.join(5)


class Desktop(lab.Desktop):
    """lab.Desktop with the proxy in front when there is one (the launch arguments are lab.Desktop's)."""

    def __init__(self, pw, gpu, profile, proxy_port=None):
        args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] if gpu else ['--disable-features=WebGPU']
        if proxy_port:
            args.append(f'--proxy-server=http://127.0.0.1:{proxy_port}')
        self.ctx = pw.chromium.launch_persistent_context(str(profile), executable_path=lab.CHROMIUM, headless=not gpu,
                                                          args=args, viewport={'width': 1280, 'height': 900})
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.add_init_script(lab.GUARD)
        self.cdp = self.ctx.new_cdp_session(self.page)
        self.crashed = False
        self.page.on('crash', lambda *_: setattr(self, 'crashed', True))


class Cut:
    """The interruption for a cell: the phone's Wi-Fi, or the eris proxy's fault switch."""

    def __init__(self, kind, proxy):
        self.kind, self.proxy = kind, proxy

    def set(self, down):
        if self.kind == 'phone':
            sh(f"svc wifi {'disable' if down else 'enable'}")
        else:
            self.proxy.cut(down)

    def online(self):
        if self.kind == 'phone':
            return 'bytes from' in sh('ping -c1 -W2 1.1.1.1', check=False)
        return not self.proxy.down


class HostNetwork(threading.Thread):
    """eris's own link and address changes while a run is going (`ip monitor`). Chromium aborts requests in flight on
    any of them with ERR_NETWORK_CHANGED, and other work on eris (a container starting or stopping) causes them."""

    def __init__(self, t0):
        super().__init__(daemon=True)
        self.t0, self.changes = t0, []
        self.proc = subprocess.Popen(['ip', 'monitor', 'link', 'address'], stdout=subprocess.PIPE, text=True)

    def run(self):
        for line in self.proc.stdout:
            self.changes.append({'t': round(time.time() - self.t0, 2), 'change': line.strip()[:100]})

    def stop(self):
        self.proc.terminate()
        self.join(5)
        return self.changes


# ---------------------------------------------------------------- the journey
class NetLog:
    """Every request to a FaceMorph origin, from the page and its workers, with status, bytes and failure."""

    def __init__(self, ctx, t0):
        self.t0, self.rows, self.open = t0, [], {}
        ctx.on('request', self.request)
        ctx.on('response', self.response)
        ctx.on('requestfinished', self.finished)
        ctx.on('requestfailed', self.failed)

    def now(self):
        return round(time.time() - self.t0, 2)

    def request(self, req):
        u = urlsplit(req.url)
        if u.hostname in HOSTS:
            row = {'t': self.now(), 'host': u.hostname, 'path': u.path, 'query': u.query}
            self.rows.append(row)
            self.open[req] = row

    def response(self, res):
        row = self.open.get(res.request)
        if row:
            row['status'] = res.status
            length = res.headers.get('content-length')
            row['bytes'] = int(length) if length and length.isdigit() else None

    def finished(self, req):
        row = self.open.pop(req, None)
        if row:
            row['finished'], row['endT'] = True, self.now()

    def failed(self, req):
        row = self.open.pop(req, None)
        if row:
            row['failure'], row['endT'] = req.failure, self.now()

    def finished_mib(self):
        return sum((r.get('bytes') or 0) for r in self.rows if r.get('finished')) / MIB


def journey_download(dev, ctx, url, cut, interrupt, stall_s, cap_s, out, name):
    dev.clear_origin(url)  # everything, models included, and the HTTP cache (both origins)
    t_load = time.time()
    dev.page.goto(url, wait_until='domcontentloaded')
    dev.wait(f"!!document.querySelector('{lab.S['product']}')", 120)
    button = """(sel)=>[...document.querySelectorAll(sel+' button')].findIndex(b=>b.textContent.trim().startsWith('Plus photo encoder'))"""
    end = time.time() + 120
    while (index := dev.js(button, TOAST)) < 0:
        if time.time() > end:
            raise RuntimeError(f"no 'Plus photo encoder' in the model toast: {dev.js(f'document.querySelector({TOAST!r})?.innerText||null')!r}")
        time.sleep(0.5)
    offer = dev.js("([sel,i])=>document.querySelectorAll(sel+' button')[i].textContent.trim()", [TOAST, index])
    planned = mib(*re.search(SIZE, offer).group(1, 2))
    t0 = time.time()
    net = NetLog(ctx, t0)
    host = HostNetwork(t0) if cut.kind == 'desktop' else None
    if host:
        host.start()
    dev.tap(f'{TOAST} button', index)
    build = dev.js("[...document.scripts].map(s=>s.src).find(s=>/\\/app\\.[0-9a-f]+\\.js$/.test(s))||null")
    rec = {'offer': offer, 'plannedMb': round(planned), 'usableS': round(t0 - t_load, 1), 'build': build, 'timeline': []}
    probe = f"document.querySelector({TOAST!r})?.innerText.replace(/\\s+/g,' ').trim()||''"
    last, last_change, cut_at, terminal = None, t0, None, None
    while terminal is None:
        now = time.time()
        if getattr(dev, 'crashed', False):
            terminal = 'crashed'
            break
        text = dev.js(probe)
        phase, loaded, total = read_toast(text)
        key = (phase, loaded, round(net.finished_mib()))
        if key != last:
            last, last_change = key, now
            rec['timeline'].append({'t': round(now - t0, 1), 'phase': phase, 'loadedMb': loaded, 'totalMb': total,
                                    'networkMb': key[2]})
        if phase in ('done', 'failed'):
            terminal = phase
        elif interrupt and cut_at is None and net.finished_mib() >= interrupt[0] * planned:
            cut.set(True)
            cut_at = now
            rec['interrupt'] = {'atS': round(now - t0, 1), 'atMb': round(net.finished_mib()), 'forS': interrupt[1]}
            log('interrupt_on', at_mb=rec['interrupt']['atMb'])
        elif cut_at and 'backS' not in rec.get('interrupt', {}) and now - cut_at >= interrupt[1]:
            cut.set(False)
            rec['interrupt']['backS'] = round(now - t0, 1)
            last_change = now  # the stall clock starts again when the link is back
            log('interrupt_off')
        elif now - last_change > stall_s and not (cut_at and 'backS' not in rec['interrupt']):
            terminal = 'stalled'
        elif now - t0 > cap_s:
            terminal = 'cap'
        time.sleep(1)
    if cut_at and 'backS' not in rec['interrupt']:
        cut.set(False)
    if 'interrupt' in rec and cut.kind == 'phone':
        back = time.time() + 60
        while not cut.online() and time.time() < back:
            time.sleep(2)
        rec['interrupt']['onlineAfter'] = cut.online()
    if host:
        rec['hostNetworkChanges'] = host.stop()
    final = next((p for p in reversed(rec['timeline']) if p['loadedMb'] is not None), {})
    stage = next((p['phase'] for p in reversed(rec['timeline']) if p['phase'] in ('route', 'photo')), None)
    with open(out / f'{name}.requests.jsonl', 'w') as f:
        for row in net.rows:
            f.write(json.dumps(row) + '\n')
    rec.update(terminal=terminal, stage=stage, elapsedS=round(time.time() - t0, 1), toast=last and last[0],
               appLoadedMb=final.get('loadedMb'), networkMb=round(net.finished_mib()), requests=len(net.rows),
               byHost=by_host(net.rows), retried=retried_chunks(net.rows),
               failures=[r for r in net.rows if r.get('failure') or (r.get('status') or 200) != 200][:200],
               stillOpen=len(net.open))
    return rec


def build_package(out):
    """This checkout's browser-model-manager as browsers load it (its build output), and the app's alternate-origin
    configuration with its types stripped, into out/manager/."""
    target = out / 'manager'
    subprocess.run(['node', str(ROOT / 'node_modules/typescript/bin/tsc'), '-p',
                    str(ROOT / 'packages/browser-model-manager/tsconfig.build.json'), '--outDir', str(target)], check=True)
    strip = ("const m=require('node:module'),fs=require('node:fs');"
             "process.stdout.write(m.stripTypeScriptTypes(fs.readFileSync(process.argv[1],'utf8')))")
    config = subprocess.run(['node', '-e', strip, str(ROOT / 'apps/web/src/contracts/model-origins.ts')],
                            capture_output=True, text=True, check=True).stdout
    (target / 'config').mkdir(exist_ok=True)
    (target / 'config' / 'model-origins.js').write_text(config)
    return target


# In the page: start the acquisition and return what is planned; window.__mgr carries its progress.
START_PACKAGE = """async (parts) => {
  const m = await import('/__manager/index.js');
  const { modelAlternateOrigins } = await import('/__manager/config/model-origins.js');
  const manifest = await (await fetch('/runtime/manifest.json', { cache: 'no-store' })).json();
  const parsed = m.parseModelManifest(manifest);
  const assets = [...new Map(parts.flatMap((p) => m.collectAssets(manifest[p])).map((a) => [a.sha256, a])).values()];
  const total = assets.reduce((n, a) => n + a.size, 0);
  const grant = { manifestSha256: 'device-lab', route: 'cpu', purpose: 'generate-and-encode',
    assets: assets.map((a) => ({ sha256: a.sha256, bytes: a.size, priority: 'foreground-required' })),
    remainingBytes: Math.ceil(total * 1.5), owners: ['face:lab'] };
  const st = (window.__mgr = { total, loaded: 0, fetched: 0, done: false, error: null, spent: null });
  const progress = m.createAcquisitionBudget();
  progress.planAsset(assets);
  progress.attach((t) => { st.loaded = t.loaded; st.fetched = t.fetched; });
  const alternateOrigins = modelAlternateOrigins(location.hostname);
  const cache = await m.createBrowserModelCache({ alternateOrigins, report: (e) => progress.cacheEvent(e) });
  const settle = () => (st.spent = grant.remainingBytes - m.grantRemaining(grant));
  Promise.all(assets.map((a) => cache.acquire(a, { grant, owner: 'face:lab' }))).then(
    () => { settle(); st.done = true; },
    (e) => { settle(); st.error = String((e && e.message) || e); });
  return { total, assets: assets.length, manifestOk: parsed.ok, alternateOrigins };
}"""


def journey_package(dev, ctx, url, cut, interrupt, stall_s, cap_s, out, name, package):
    origin = re.match(r'https?://[^/]+', url).group(0)
    dev.clear_origin(url)
    ctx.route(f'{origin}/__manager/**', lambda route: route.fulfill(
        path=str(package / urlsplit(route.request.url).path[len('/__manager/'):]),
        headers={'content-type': 'text/javascript', 'cache-control': 'no-store'}))
    t_load = time.time()
    dev.page.goto(f'{origin}/runtime/manifest.json', wait_until='load')  # the origin's document, no app code
    t0 = time.time()
    net = NetLog(ctx, t0)
    host = HostNetwork(t0) if cut.kind == 'desktop' else None
    if host:
        host.start()
    plan = dev.js(START_PACKAGE, list(PACKAGE_PARTS))
    planned = plan['total'] / MIB
    rec = {'client': 'package', 'plannedMb': round(planned), 'assets': plan['assets'], 'manifestOk': plan['manifestOk'],
           'alternateOrigins': plan['alternateOrigins'], 'usableS': round(t0 - t_load, 1), 'timeline': []}
    last, last_change, cut_at, terminal = None, t0, None, None
    while terminal is None:
        now = time.time()
        if getattr(dev, 'crashed', False):
            terminal = 'crashed'
            break
        st = dev.js('window.__mgr')
        key = (round(st['loaded'] / MIB), round(net.finished_mib()))
        if key != last:
            last, last_change = key, now
            rec['timeline'].append({'t': round(now - t0, 1), 'loadedMb': key[0], 'networkMb': key[1]})
        if st['done']:
            terminal = 'done'
        elif st['error']:
            terminal, rec['packageError'] = 'failed', st['error'][:300]
        elif interrupt and cut_at is None and net.finished_mib() >= interrupt[0] * planned:
            cut.set(True)
            cut_at = now
            rec['interrupt'] = {'atS': round(now - t0, 1), 'atMb': round(net.finished_mib()), 'forS': interrupt[1]}
            log('interrupt_on', at_mb=rec['interrupt']['atMb'])
        elif cut_at and 'backS' not in rec.get('interrupt', {}) and now - cut_at >= interrupt[1]:
            cut.set(False)
            rec['interrupt']['backS'] = round(now - t0, 1)
            last_change = now
            log('interrupt_off')
        elif now - last_change > stall_s and not (cut_at and 'backS' not in rec['interrupt']):
            terminal = 'stalled'
        elif now - t0 > cap_s:
            terminal = 'cap'
        time.sleep(1)
    if cut_at and 'backS' not in rec['interrupt']:
        cut.set(False)
    if host:
        rec['hostNetworkChanges'] = host.stop()
    st = dev.js('window.__mgr')
    with open(out / f'{name}.requests.jsonl', 'w') as f:
        for row in net.rows:
            f.write(json.dumps(row) + '\n')
    rec.update(terminal=terminal, stage='package', elapsedS=round(time.time() - t0, 1), appLoadedMb=round(st['loaded'] / MIB),
               grantSpentMb=st['spent'] and round(st['spent'] / MIB), networkMb=round(net.finished_mib()),
               requests=len(net.rows), byHost=by_host(net.rows), retried=retried_chunks(net.rows),
               verifiedRefetched=verified_refetches(net.rows),
               failures=[r for r in net.rows if r.get('failure') or (r.get('status') or 200) != 200][:200],
               stillOpen=len(net.open))
    return rec


def run_cell(cell, args, out):
    from playwright.sync_api import sync_playwright
    kind, gpu = CELLS[cell]
    report = {'cell': cell, 'label': args.label, 'url': args.url, 'client': args.client, 'throttleKbps': args.throttle_kbps,
              'interrupt': args.interrupt, 'cut': (args.cut if kind == 'desktop' else 'wifi') if args.interrupt else None,
              'runs': []}
    proxy = None
    if kind == 'desktop' and (args.interrupt or args.throttle_kbps):
        proxy = Proxy(args.throttle_kbps, args.cut)
        proxy.start()
        proxy.ready.wait(10)
    cut = Cut(kind, proxy)

    def runs(dev, ctx):
        for i in range(args.repeat):
            name = f'{cell}-{i + 1}'
            rec = {'iteration': i + 1}
            mem = lab.MemorySampler() if kind == 'phone' else None
            if kind == 'phone':
                rec['startTempC'] = lab.cool_down()
                mem.start()
            try:
                if args.client == 'package':
                    rec |= journey_package(dev, ctx, args.url, cut, args.interrupt, args.stall_s, args.cap_s, out, name,
                                           args.package)
                    rec['ok'] = rec['terminal'] == 'done' and not rec['verifiedRefetched']
                else:
                    rec |= journey_download(dev, ctx, args.url, cut, args.interrupt, args.stall_s, args.cap_s, out, name)
                    rec['ok'] = rec['terminal'] == 'done'
            except Exception as e:
                rec['ok'], rec['error'] = False, f'{type(e).__name__}: {e}'[:400]
            finally:
                if mem:
                    mem.stop.set()
                    mem.join(5)
                    rec['peakChromePssMb'] = mem.peak
            if not rec['ok']:
                dev.screenshot(out / f'{name}-fail.png')
            log('download_done', cell=cell, iteration=i + 1, terminal=rec.get('terminal'), error=rec.get('error'),
                elapsed_s=rec.get('elapsedS'), network_mb=rec.get('networkMb'))
            report['runs'].append(rec)
            (out / f'{cell}.json').write_text(json.dumps(report, indent=2))

    try:
        if kind == 'desktop':
            report['browser'] = 'chromium ' + subprocess.run([lab.CHROMIUM, '--version'], capture_output=True, text=True).stdout.strip()
            with sync_playwright() as pw:
                dev = Desktop(pw, gpu, out / f'profile-{cell}', proxy and proxy.port)
                try:
                    runs(dev, dev.ctx)
                finally:
                    dev.close()
        else:
            lab.recover()
            report['device'] = lab.device_facts()
            if not lab.HOLD.exists():
                raise SystemExit('the Frigate camera is not held off; this tool switches Wi-Fi off, so hold it off first (lab.py camera off)')
            try:
                lab.session_begin()
                lab.phone_chrome_flags(gpu, False)
                with sync_playwright() as pw:
                    dev = lab.Phone(pw)
                    try:
                        runs(dev, dev.browser.contexts[0])
                    finally:
                        dev.close()
            finally:
                sh('svc wifi enable', check=False)
                sh(f'am force-stop {lab.CHROME}', check=False)
                lab.session_end()
                lab.STATE.unlink(missing_ok=True)
    finally:
        if proxy:
            proxy.cut(False)
            proxy.stop()
    report['ok'] = bool(report['runs']) and all(r['ok'] for r in report['runs'])
    (out / f'{cell}.json').write_text(json.dumps(report, indent=2))
    return report


def summarise(reports, out, title):
    md = [f'## {title}', '', '| Cell | Run | Terminal | Stage | Elapsed | Reached (app / network) | Planned | Interrupt | '
          'Retried chunks (served by) | First failure |', '|---|---|---|---|---|---|---|---|---|---|']
    for rep in reports:
        for r in rep['runs']:
            served = {}
            for c in r.get('retried', []):
                served[c['servedBy'] or 'none'] = served.get(c['servedBy'] or 'none', 0) + 1
            first = next((f"{f['host']} {f.get('failure') or f.get('status')}" for f in r.get('failures', [])), '')
            cut = r.get('interrupt')
            cut = '%.0f s at %s MB' % (cut['forS'], cut['atMb']) if cut else '–'
            hosts = ', '.join('%s: %d' % kv for kv in served.items()) or '–'
            terminal = r.get('terminal') or 'ERROR'
            if 'verifiedRefetched' in r:
                terminal += f" ({len(r['verifiedRefetched'])} verified refetched)"
            md.append(f"| {rep['cell']} | {r['iteration']} | {terminal} | {r.get('stage') or '–'} | "
                      f"{r.get('elapsedS', '–')} s | {r.get('appLoadedMb') or '–'} / {r.get('networkMb', '–')} MB | "
                      f"{r.get('plannedMb', '–')} MB | {cut} | {len(r.get('retried', []))} ({hosts}) | "
                      f"{(r.get('error') or first)[:90]} |")
    text = '\n'.join(md) + '\n'
    (out / 'summary.md').write_text(text)
    (out / 'summary.json').write_text(json.dumps({'title': title, 'ok': all(r['ok'] for r in reports), 'cells': reports}, indent=2))
    print(text)


@contextmanager
def devices_held(cells):
    """The lab's lock, plus the device lease of every device these cells use where lab.py takes one
    (lab_lock(cells), a context manager); the older lab_lock() returns the held lock file."""
    if inspect.signature(lab.lab_lock).parameters:
        with lab.lab_lock(cells):
            yield
    else:
        held = lab.lab_lock()
        try:
            yield
        finally:
            held.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--cells', default='eris-cpu,eris-webgpu,phone-cpu')
    ap.add_argument('--url', default='https://next.facemorph.me/')
    ap.add_argument('--repeat', type=int, default=1)
    ap.add_argument('--interrupt', type=parse_interrupt, help='FRACTION:SECONDS, e.g. 0.35:30')
    ap.add_argument('--cut', choices=['drop', 'blackhole'], default='drop',
                    help="eris only: what --interrupt does to open connections (the phone's is always Wi-Fi off)")
    ap.add_argument('--throttle-kbps', type=int, help='eris only: link speed in kbit/s through the local proxy')
    ap.add_argument('--stall-s', type=float, default=180, help='no progress for this long ends the run as stalled')
    ap.add_argument('--cap-s', type=float, default=3600, help='longest a run may take')
    ap.add_argument('--label', default='run')
    ap.add_argument('--client', choices=['app', 'package'], default='app',
                    help="who downloads: the deployed app (its model toast) or this checkout's browser-model-manager")
    args = ap.parse_args()
    cells = args.cells.split(',')
    unsupported = [c for c in cells if c not in CELLS or 'firefox' in c]
    if unsupported:
        ap.error('download.py has Chromium/Huawei adapters only; unsupported cell(s): ' + ', '.join(unsupported))
    signal.signal(signal.SIGTERM, lab._terminate)
    signal.signal(signal.SIGHUP, lab._terminate)
    with devices_held(cells):
        out = lab.HERE / 'out' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-download-' + args.label)
        out.mkdir(parents=True, exist_ok=True)
        args.package = build_package(out) if args.client == 'package' else None
        reports = [run_cell(c, args, out) for c in cells]
    extra = ', '.join(x for x in (args.throttle_kbps and f'{args.throttle_kbps} kbit/s',
                                  args.interrupt and f'{args.cut} interrupt {args.interrupt[1]:.0f} s at {args.interrupt[0]:.0%}') if x)
    who = ', browser-model-manager' if args.client == 'package' else ''
    summarise(reports, out, f"Cold full-package download: {args.label} ({args.url}{who}{', ' + extra if extra else ''})")
    raise SystemExit(0 if all(r['ok'] for r in reports) else 1)


if __name__ == '__main__':
    main()

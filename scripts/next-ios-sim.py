#!/usr/bin/env python3
"""Run the built product in a real iOS Simulator and record what the constrained tier does.

Every iPhone number on record is from a Simulator, and the Simulator exposes no WebGPU adapter,
so this lane cannot rank the fast path and never claims to. What it *can* answer is the question
that actually drives the architecture: what does the memory-constrained tier do with a change —
which route it admits, whether a face appears at all, and how much memory it takes to get there.
That is the tier with no physical evidence and the one every memory decision is made for, so it
runs per change rather than once a release.

Safari in a Simulator cannot be driven over CDP, so the page reports on itself: the harness serves
the real built artifact with a campaign script injected at serve time, and the page POSTs its
findings back. Nothing in `deploy-next` is modified; the injection exists only in this server's
response, so the bytes under test are the bytes that shipped apart from one appended script tag.

    python3 scripts/next-ios-sim.py --device 'iPhone 17 Pro' --evidence next-ios-evidence
"""
import argparse, http.server, json, mimetypes, socketserver, subprocess, sys, threading, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://next.facemorph.me'

CAMPAIGN = """
<script>
(async () => {
  const report = {stages: [], errors: [], startedAt: Date.now()};
  const say = (k, v) => { report[k] = v; };
  addEventListener('error', e => report.errors.push(String(e.message || e)));
  addEventListener('unhandledrejection', e => report.errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  const post = async done => {
    report.completed = !!done;
    report.elapsedMs = Date.now() - report.startedAt;
    try { await fetch('/__campaign', {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(report)}); } catch (e) {}
  };
  try {
    const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null);
    say('webgpu', adapter ? {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize} : null);
    say('agent', navigator.userAgent);
    say('crossOriginIsolated', crossOriginIsolated);
    say('deviceMemory', navigator.deviceMemory ?? null);
    say('hardwareConcurrency', navigator.hardwareConcurrency ?? null);
    const mem = () => performance.memory ? {used: performance.memory.usedJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit} : null;
    say('memoryAtStart', mem());

    new MutationObserver(() => {
      const t = document.body.innerText;
      for (const re of [/Using the \\w+ route[^\\n]*/, /Getting photo tools ready[^\\n]*/,
                        /Downloading model files[^\\n]*/, /Generating[^\\n]*/, /Face generated[^\\n]*/,
                        /[^\\n]*much slower[^\\n]*/, /[^\\n]*rejected a graphics route[^\\n]*/]) {
        const m = t.match(re);
        if (m && !report.stages.includes(m[0])) report.stages.push(m[0]);
      }
    }).observe(document.body, {subtree: true, childList: true, characterData: true});

    // One face is the whole product path: acquisition, route admission, a canary and synthesis.
    const wait = async (check, ms, what) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) { if (check()) return true; await new Promise(r => setTimeout(r, 500)); }
      report.errors.push('timed out waiting for ' + what);
      return false;
    };
    await wait(() => [...document.querySelectorAll('button')]
      .some(b => b.textContent.trim().toLowerCase() === 'generate'), 60000, 'the interface');
    const began = Date.now();
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase() === 'generate').click();
    const made = await wait(() => document.querySelector('img[src^="blob:"]'), 900000, 'the first face');
    say('firstFaceMs', made ? Date.now() - began : null);
    say('faceProduced', made);
    say('memoryAfterFace', mem());
    say('route', (document.querySelector('.next-route-caption')?.innerText || '').trim());
    say('speeds', localStorage.getItem('facemorph-route-speed-v2'));
    say('cpuFallbackShown', document.body.innerText.includes('much slower'));
    let cached = null;
    try {
      const c = await caches.open('checkface-model-blobs-v1');
      const keys = await c.keys(); let bytes = 0;
      for (const r of keys) { const m = await c.match(r); const l = m?.headers.get('Content-Length'); if (l) bytes += Number(l); }
      cached = {entries: keys.length, bytes};
    } catch (e) { report.errors.push('cache read: ' + e.message); }
    say('cache', cached);
    try { const est = await navigator.storage.estimate(); say('storage', {quota: est.quota, usage: est.usage}); } catch (e) {}
    await post(made);
  } catch (error) {
    report.errors.push('campaign: ' + (error && error.message || String(error)));
    await post(false);
  }
})();
</script>
"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--device', default='iPhone 17 Pro')
    p.add_argument('--artifact', type=Path, default=ROOT / 'deploy-next')
    p.add_argument('--evidence', type=Path, default=ROOT / 'next-ios-evidence')
    p.add_argument('--port', type=int, default=8543)
    p.add_argument('--timeout', type=int, default=1200)
    a = p.parse_args()
    artifact = a.artifact.resolve()
    assert (artifact / 'index.html').exists(), f'No built artifact at {artifact}'
    a.evidence.mkdir(parents=True, exist_ok=True)

    # Plain HTTP on localhost, deliberately. `localhost` is a secure context in Safari, so
    # cross-origin isolation, workers and the Cache API all behave exactly as they do in
    # production — and it avoids `simctl keychain add-root-cert`, which hangs indefinitely
    # against a freshly booted device and is the only thing TLS would have bought here.

    received = {}
    ready = threading.Event()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(artifact), **kwargs)

        def log_message(self, *args):
            pass

        def _headers(self, kind, length):
            # The product requires cross-origin isolation for its threaded runtime.
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(length))
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

        def do_POST(self):
            if self.path != '/__campaign':
                self.send_error(404); return
            size = int(self.headers.get('content-length', '0'))
            if not 0 < size < 4 * 1024 * 1024:
                self.send_error(400); return
            received.update(json.loads(self.rfile.read(size)))
            (a.evidence / 'report.json').write_text(json.dumps(received, indent=2))
            self.send_response(200); self._headers('application/json', 2); self.wfile.write(b'{}')
            if received.get('completed') is not None:
                ready.set()

        def do_GET(self):
            path = self.path.split('?')[0]
            if path.startswith('/runtime/'):
                # The runtime is proxied from the deployed origin: this lane measures the product
                # against the bundle that is actually published, not a local rebuild of it.
                try:
                    with urllib.request.urlopen(urllib.request.Request(
                            ORIGIN + path, headers={'User-Agent': 'curl/8.7.1'}), timeout=120) as r:
                        body = r.read()
                        kind = r.headers.get('Content-Type', 'application/octet-stream')
                except Exception as error:
                    self.send_error(502, str(error)); return
                self.send_response(200); self._headers(kind, len(body)); self.wfile.write(body)
                return
            if path in ('/', '/index.html'):
                html = (artifact / 'index.html').read_text()
                body = html.replace('</body>', CAMPAIGN + '</body>').encode()
                self.send_response(200); self._headers('text/html; charset=utf-8', len(body))
                self.wfile.write(body); return
            super().do_GET()

        def end_headers(self):
            # SimpleHTTPRequestHandler's own path for static files still needs isolation headers.
            if not self.headers.get('__patched'):
                pass
            super().end_headers()

        def send_head(self):
            self.send_response(200)
            path = self.translate_path(self.path.split('?')[0])
            try:
                data = Path(path).read_bytes()
            except OSError:
                self.send_error(404); return None
            import mimetypes
            kind = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            self._headers(kind, len(data))
            import io
            return io.BytesIO(data)

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    server = Server(('127.0.0.1', a.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://localhost:{a.port}/'

    def sim(*args, timeout=180):
        return subprocess.run(['xcrun', 'simctl', *args], capture_output=True, text=True, timeout=timeout)

    devices = json.loads(sim('list', 'devices', 'available', '--json').stdout)['devices']
    match = next((d for group in devices.values() for d in group if d['name'] == a.device), None)
    assert match, f'No available Simulator named {a.device!r}'
    udid = match['udid']
    try:
        if match['state'] != 'Booted':
            boot = sim('boot', udid); assert boot.returncode == 0, boot.stderr
            assert sim('bootstatus', udid, '-b').returncode == 0
        launch = sim('openurl', udid, url)
        assert launch.returncode == 0, launch.stderr
        print(json.dumps({'device': a.device, 'udid': udid, 'url': url}), flush=True)
        ready.wait(timeout=a.timeout)
        sim('io', udid, 'screenshot', str(a.evidence / 'screen.png'))
    finally:
        server.shutdown(); server.server_close()

    report = received
    (a.evidence / 'report.json').write_text(json.dumps(report, indent=2))
    summary = {k: report.get(k) for k in
               ('completed', 'faceProduced', 'firstFaceMs', 'route', 'webgpu', 'cpuFallbackShown',
                'memoryAfterFace', 'cache', 'storage', 'agent')}
    summary['errors'] = report.get('errors', [])[:4]
    summary['device'] = a.device
    print(json.dumps(summary, indent=2), flush=True)
    if not report:
        print('No report was returned by the Simulator.', file=sys.stderr); sys.exit(1)
    # A lane that cannot produce a face on the constrained tier is the finding, and it fails.
    if not report.get('faceProduced'):
        print('The constrained tier did not produce a face.', file=sys.stderr); sys.exit(1)


if __name__ == '__main__':
    main()

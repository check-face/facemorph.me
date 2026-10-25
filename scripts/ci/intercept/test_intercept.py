"""Request-interception helper, Python/CDP side (fm-o8xn).

The primitives run on the shared vectors (vectors.json, the same file the TypeScript tests use), so both sides give
identical verdicts. The CDP helper then runs the fixture page in a real headless Chromium through browser-harness
0.1.8: its own profile, its own free CDP port (the WebSocket URL is checked against the browser's own log, never a
guessed port: 127.0.0.1:9222 on eris is the phone) and its own daemon name, stopped afterwards.
Needs browser-harness (BROWSER_HARNESS, default ~/Work/runs/venv-bh/bin/browser-harness) and Chromium
(CHROMIUM_PATH, default /usr/bin/chromium); without them the browser cases are reported untested.
    python3 scripts/ci/intercept/test_intercept.py
"""
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import intercept  # noqa: E402

VECTORS = json.loads((HERE / 'vectors.json').read_text())
HARNESS = os.environ.get('BROWSER_HARNESS', str(Path.home() / 'Work/runs/venv-bh/bin/browser-harness'))
CHROMIUM = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
LOG_DIR = os.environ.get('INTERCEPT_LOG_DIR') or tempfile.mkdtemp(prefix='intercept-log-')


def quiet(_line):
    pass


def run_case(c, rec):
    a = c['args']
    if c['call'] == 'requestsIn':
        return intercept.requestsIn(rec, a[0], quiet)
    if c['call'] == 'assertNoRequests':
        return intercept.assertNoRequests(rec, a[0], a[1], quiet)
    if c['call'] == 'assertOrder':
        return intercept.assertOrder(rec, a[0], a[1], quiet)
    return intercept.bytesBy(rec, a[0], a[1], quiet)


class Vectors(unittest.TestCase):
    def test_primitives_match_the_shared_vectors(self):
        for c in VECTORS['cases']:
            r = run_case(c, json.loads(json.dumps(VECTORS['records'][c['record']])))
            self.assertEqual((r['verdict'], r['count'], r['bytes']), (c['verdict'], c['count'], c['bytes']), c)
        for url, cls in VECTORS['classify']:
            self.assertEqual(intercept.classify(url, intercept.DEFAULT_HOST_MAP), cls, url)
        for url, t in VECTORS['template']:
            self.assertEqual(intercept.template(url), t, url)

    def test_a_run_binds_its_own_origins_ahead_of_the_default_map(self):
        run = intercept.bindOrigins(intercept.DEFAULT_HOST_MAP, {
            'app': ['http://127.0.0.1:8443'], 'model-host': ['https://models.preview.example']})
        self.assertEqual(intercept.classify('http://127.0.0.1:8443/runtime/manifest.json', run), 'app')
        self.assertEqual(intercept.classify('https://models.preview.example/a.bin', run), 'model-host')
        self.assertEqual(intercept.classify('https://models.facemorph.me/a.bin', run), 'model-host')
        self.assertEqual(intercept.classify('https://facemorph-seed-gallery.cdilga.workers.dev/preview/42.webp', run), 'names-host')
        self.assertEqual(intercept.classify('https://unrelated.cdilga.workers.dev/preview/42.webp', run), 'third-party')
        self.assertEqual(intercept.classify('http://127.0.0.1:9000/x', run), 'third-party')

    def test_one_json_line_per_primitive(self):
        lines = []
        intercept.assertNoRequests(VECTORS['records']['early'], 'model-host', {'toStep': 'load'}, lines.append)
        self.assertEqual(lines, [{
            'event': 'network-assertion', 'primitive': 'assertNoRequests', 'hostClass': 'model-host',
            'window': {'fromStep': None, 'toStep': 'load'}, 'count': 1, 'bytes': 4096, 'verdict': 'fail',
            'reason': '1 model-host request(s): https://models.facemorph.me/model.bin'}])


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def stop_daemon(name):
    """Stops only this run's browser-harness daemon (other sessions share the machine)."""
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            cmd = Path(f'/proc/{pid}/cmdline').read_bytes()
            env = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
        except OSError:
            continue
        if b'browser_harness' in cmd and f'BU_NAME={name}'.encode() in env:
            os.kill(int(pid), signal.SIGTERM)


def journey(early, navigation_delay=0):
    fixture = subprocess.Popen(['node', str(HERE / 'fixture.ts')], stdout=subprocess.PIPE, text=True)
    profile = tempfile.mkdtemp(prefix='intercept-cdp-')
    port = free_port()
    chrome = subprocess.Popen([CHROMIUM, '--headless=new', '--no-sandbox', f'--remote-debugging-port={port}',
                               f'--user-data-dir={profile}', 'about:blank'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, start_new_session=True)
    name = f'intercept-{os.getpid()}-{"early" if early else "approved"}'
    try:
        info = fixture.stdout.readline()
        if navigation_delay:
            delayed = json.loads(info)
            for key in ('page', 'early'):
                delayed[key] += f'&delay={navigation_delay}'
            info = json.dumps(delayed)
        ws, end = None, time.time() + 30
        while ws is None and time.time() < end:
            m = re.search(r'DevTools listening on (ws://127\.0\.0\.1:(\d+)/\S+)', chrome.stderr.readline())
            if m and int(m.group(2)) == port:
                ws = m.group(1)
        if ws is None:
            raise RuntimeError('Chromium did not report its DevTools endpoint on the chosen port')
        env = dict(os.environ, BU_NAME=name, BU_CDP_WS=ws, FIXTURE=info, EARLY='1' if early else '0',
                   LOG_DIR=LOG_DIR, INTERCEPT_DIR=str(HERE))
        env.pop('BU_CDP_URL', None)
        out = subprocess.run([HARNESS], input=(HERE / 'cdp_journey.py').read_text(), env=env, text=True,
                             capture_output=True, timeout=120)
        lines = [l for l in out.stdout.splitlines() if l.startswith('{"record"')]
        if not lines:
            raise RuntimeError(f'browser-harness gave no result: {out.stdout[-2000:]} {out.stderr[-2000:]}')
        return json.loads(lines[-1])
    finally:
        stop_daemon(name)
        fixture.terminate()
        # This Chrome's descendants share only its task-owned process group. Drain its pipe
        # while stopping it; a full stderr pipe otherwise blocks graceful shutdown.
        try:
            os.killpg(chrome.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            chrome.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(chrome.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            chrome.communicate(timeout=10)
        fixture.wait(10)
        chrome.stderr.close()
        fixture.stdout.close()
        shutil.rmtree(profile, ignore_errors=True)


AVAILABLE = os.path.exists(HARNESS) and os.path.exists(CHROMIUM) and shutil.which('node')


@unittest.skipUnless(AVAILABLE, 'untested: browser-harness, Chromium or Node missing')
class CdpHelper(unittest.TestCase):
    def test_slow_navigation_keeps_collecting_real_worker_events(self):
        r = journey(False, navigation_delay=6500)
        self.assertEqual([v['verdict'] for v in r['verdicts']], ['pass', 'pass', 'pass', 'pass', 'fail'])
        self.assertTrue(any(q['initiator'] == 'worker' for q in r['record']['requests']))
        self.assertTrue(any(q['initiator'] == 'service-worker' for q in r['record']['requests']))

    def test_fixture_page_attribution_failures_console_and_the_approved_model(self):
        r = journey(False)
        rec = r['record']

        def at(path):
            return [q for q in rec['requests'] if q['url'].endswith(path)]
        self.assertEqual(at('/worker-data.json')[0]['initiator'], 'worker')
        self.assertEqual(at('/sw-asset.json')[0]['initiator'], 'service-worker')
        self.assertEqual(at('/app.json')[0]['initiator'], 'page')
        self.assertEqual([q['fromCache'] for q in at('/cached.json')], [False, True])
        self.assertEqual((at('/missing.json')[0]['status'], at('/missing.json')[0]['failed']), (404, False))
        self.assertTrue(at('/unreachable.json')[0]['failed'])
        self.assertIn('ERR_CONNECTION_REFUSED', at('/unreachable.json')[0]['errorText'])
        self.assertTrue(any(c['text'] == 'fixture console error' for c in rec['console']))
        model = [(rec['steps'][q['step']]['name'], q['status'], q['bytes'])
                 for q in rec['requests'] if q['hostClass'] == 'model-host']
        self.assertEqual(model, [('approve', 200, 4096)])
        # fromCache is observable over CDP, so that claim passes here (Playwright reports it untested).
        self.assertEqual([v['verdict'] for v in r['verdicts']], ['pass', 'pass', 'pass', 'pass', 'fail'])
        self.assertTrue((Path(LOG_DIR) / 'cdp-approved.jsonl').exists())

    def test_model_before_approval_fails_and_keeps_a_screenshot(self):
        r = journey(True)
        self.assertEqual((r['verdicts'][0]['verdict'], r['verdicts'][0]['count']), ('fail', 1))
        self.assertEqual(r['verdicts'][1]['verdict'], 'fail')
        self.assertTrue(r['shot'] and Path(r['shot']).exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)

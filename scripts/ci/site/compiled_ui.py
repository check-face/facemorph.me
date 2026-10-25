#!/usr/bin/env python3
"""compiled-ui (fm-aa8): the exact artifact in Chromium, as classic's next-site.yml ran it, with its network
checked by host class.

Serves the artifact directory on a free 127.0.0.1 port, starts Chromium headless on its own free CDP port (the
WebSocket URL is taken from the browser's own log: 127.0.0.1:9222 on eris is the USB phone's Chrome), runs
classic's apps/web/scripts/check-next-artifact.sh unchanged through browser-harness 0.1.8, then drains every CDP
event the harness daemon recorded and folds them with the interception helper (scripts/ci/intercept/intercept.py):
zero 'third-party' requests, or the run fails with them listed. Evidence: next-artifact-ui.json (the classic
script's), network.json and the per-assertion JSONL.

    python3 scripts/ci/site/compiled_ui.py --artifact site/deploy-next [--out next-artifact-ui-evidence]
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'scripts' / 'ci' / 'intercept'))
import intercept  # noqa: E402

HARNESS = os.environ.get('BROWSER_HARNESS', str(Path.home() / 'Work/runs/venv-bh/bin/browser-harness'))
CHROMIUM = os.environ.get('CHROMIUM_PATH', shutil.which('chromium') or shutil.which('google-chrome') or '')
CHECK = REPO / 'apps' / 'web' / 'scripts' / 'check-next-artifact.sh'


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


# Folded inside browser-harness: every event its daemon buffered since the page opened.
DRAIN = """
import json, os, sys
sys.path.insert(0, os.environ['INTERCEPT_DIR'])
import intercept
att = intercept.Attached(cdp, drain_events, json.loads(os.environ['HOST_MAP']))
intercept.step(att.rec, 'artifact')
att.collect()
print('RECORD ' + json.dumps(att.rec))
"""


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--artifact', required=True)
    p.add_argument('--out', default='next-artifact-ui-evidence')
    a = p.parse_args(argv)
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    site_port, cdp_port = free_port(), free_port()
    origin = f'http://127.0.0.1:{site_port}'
    server = subprocess.Popen([sys.executable, str(REPO / 'scripts/hosting/response_headers.py'), '--port', str(site_port),
                               '--directory', a.artifact], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    profile = tempfile.mkdtemp(prefix='compiled-ui-')
    chrome = subprocess.Popen([CHROMIUM, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions',
                               f'--remote-debugging-port={cdp_port}', f'--user-data-dir={profile}', 'about:blank'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    name = f'compiled-ui-{os.getpid()}'
    code = 1
    try:
        ws, end = None, time.time() + 30
        while ws is None and time.time() < end:
            m = re.search(r'DevTools listening on (ws://127\.0\.0\.1:(\d+)/\S+)', chrome.stderr.readline())
            if m and int(m.group(2)) == cdp_port:
                ws = m.group(1)
        if ws is None:
            raise SystemExit('Chromium did not report its DevTools endpoint on the chosen port')
        host_map = intercept.bindOrigins(intercept.DEFAULT_HOST_MAP, {'app': [origin]})
        identity = json.loads((Path(a.artifact).resolve().parent / 'next-site-identity.json').read_text())
        kind = identity['kind']
        if kind not in ('control', 'destination'):
            raise ValueError(f'Unknown artifact kind: {kind}')
        env = dict(os.environ, BU_NAME=name, BU_CDP_WS=ws, NEXT_ARTIFACT_KIND=kind, NEXT_ARTIFACT_ORIGIN=f'{origin}/',
                   INTERCEPT_DIR=str(REPO / 'scripts' / 'ci' / 'intercept'), HOST_MAP=json.dumps(host_map))
        env.pop('BU_CDP_URL', None)
        env['PATH'] = f"{Path(HARNESS).parent}:{env.get('PATH', '')}"  # the classic script calls browser-harness
        check = subprocess.run(['bash', str(CHECK)], env=env, cwd=out, capture_output=True, text=True, timeout=600)
        (out / 'check-next-artifact.log').write_text(check.stdout + check.stderr)
        drained = subprocess.run([HARNESS], input=DRAIN, env=env, capture_output=True, text=True, timeout=120)
        line = next((l for l in drained.stdout.splitlines() if l.startswith('RECORD ')), None)
        if line is None:
            raise SystemExit(f'no network record: {drained.stdout[-1000:]} {drained.stderr[-1000:]}')
        rec = json.loads(line[7:])
        (out / 'network.json').write_text(json.dumps(rec, indent=1))
        log = intercept.file_log(str(out / 'network-assertions.jsonl'))
        verdict = intercept.assertNoRequests(rec, 'third-party', {}, log)
        app = intercept.requestsIn(rec, {'hostClass': 'app'}, log)
        print(json.dumps({'checkExit': check.returncode, 'appRequests': app['count'],
                          'thirdParty': verdict['count'], 'verdict': verdict['verdict']}))
        if check.returncode != 0:
            print(check.stdout[-3000:], check.stderr[-3000:])
        code = 0 if check.returncode == 0 and verdict['verdict'] == 'pass' and app['count'] > 0 else 1
    finally:
        stop_daemon(name)
        chrome.terminate()
        server.terminate()
        chrome.wait(10)
        server.wait(10)
        chrome.stderr.close()
        shutil.rmtree(profile, ignore_errors=True)
    return code


if __name__ == '__main__':
    sys.exit(main())

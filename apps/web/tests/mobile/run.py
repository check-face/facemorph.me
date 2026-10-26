"""Real mobile browser component checks. No model inference or handset qualification."""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import ssl
import tempfile
import time
from urllib.parse import urlsplit
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[1]
EXPECTED = {'worker-module-hash', 'integrity-rejection', 'cancel-partial-retry',
            'concurrent-download-dedup', 'corrupt-cache-repair',
            'png-1024-roundtrip', 'portrait-exif-crop', 'reload-retained-offline'}
MANAGER_CASES = {'no-grant', 'cold', 'model-cached', 'output-cached',
                 'missing-local', 'corrupt-local', 'cancel', 'leased-eviction',
                 'quota', 'loaded-handle-disposal', 'cross-tab'}
MANAGER_EXPECTED = {f'{backend}.{case}' for backend in ('opfs', 'cache-storage')
                    for case in MANAGER_CASES} | {'worker.native-sync-handles'}


def manager_matrix_valid(report):
    rows = report.get('managerMatrix')
    capabilities = report.get('managerCapabilities')
    if (not isinstance(rows, list) or len(rows) != len(MANAGER_EXPECTED)
            or not isinstance(capabilities, dict)
            or any(type(capabilities.get(key)) is not bool
                   for key in ('opfs', 'cacheStorage', 'workerSync'))
            or any(not isinstance(row, dict) or not isinstance(row.get('id'), str) for row in rows)
            or {row.get('id') for row in rows} != MANAGER_EXPECTED):
        return False
    for row in rows:
        backend, case = row['id'].split('.', 1)
        network = row.get('network')
        if (row.get('backend') != backend or not isinstance(row.get('lane'), str)
                or not row['lane'].strip() or row.get('error')
                or row.get('status') not in ('pass', 'untested')
                or not isinstance(network, dict)
                or network.get('measurement') != 'native-server-ledger'
                or network.get('hostSeparation') is not False
                or any(type(network.get(key)) is not int or network[key] < 0
                       for key in ('requests', 'bytes'))
                or not isinstance(network.get('paths'), list)
                or any(not isinstance(path, str) for path in network['paths'])
                or len(network['paths']) != network['requests']):
            return False
        if row['status'] == 'untested':
            reason = row.get('reason')
            reason_code = row.get('reasonCode')
            absent = {
                'opfs': ('native-opfs-unavailable', 'opfs'),
                'cache-storage': ('native-cache-storage-unavailable', 'cacheStorage'),
                'worker': ('native-worker-sync-unavailable', 'workerSync'),
            }[backend]
            allowed = {absent[0]} if capabilities[absent[1]] is False else set()
            if case == 'quota':
                allowed.add('native-quota-control-unavailable')
            elif case == 'loaded-handle-disposal':
                allowed.add('loaded-runtime-unavailable')
            elif case == 'cross-tab':
                allowed.add('second-tab-unavailable')
            if (reason_code not in allowed or not isinstance(reason, str) or not reason.strip()
                    or network['requests'] != 0 or network['bytes'] != 0):
                return False
        elif case == 'quota':
            details = row.get('details', {})
            if (network['requests'] != 2 or network['bytes'] != 6
                    or network['paths'] != ['/fixture/good', '/fixture/good']
                    or details.get('quotaReset') is not True
                    or details.get('failure', {}).get('typed', {}).get('code') != 'quota'
                    or details.get('retry', {}).get('remainingBytes') != 0):
                return False
        elif case in ('cold', 'cancel'):
            if network['requests'] < 1 or network['bytes'] < 1:
                return False
        elif network['requests'] != 0 or network['bytes'] != 0:
            return False
    return True


def assess(report, run_id):
    if not isinstance(report, dict):
        return False
    rows = report.get('results', [])
    return (report.get('runId') == run_id and report.get('completed') is True
            and not report.get('error') and report.get('secureContext') is True
            and report.get('inferenceExecuted') is False and report.get('e4eExecuted') is False
            and report.get('evidenceLevel') == 'browser-component'
            and isinstance(rows, list) and len(rows) == len(EXPECTED)
            and all(isinstance(row, dict) and isinstance(row.get('id'), str)
                    and row.get('passed') is True for row in rows)
            and {row.get('id') for row in rows} == EXPECTED
            and manager_matrix_valid(report))


def command(*args, check=True, timeout=90):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout).stdout.strip()


def native_controller(component, endpoint, origin, run_id, output):
    script = {'cross-tab': 'manager-tabs.mjs', 'quota': 'manager-quota.mjs'}[component]
    process = subprocess.Popen(
        ['node', str(ROOT/'tests/mobile'/script), endpoint, origin, run_id, str(output.resolve())],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=90)
    except subprocess.TimeoutExpired:
        timed_out = True
        # Give the driver its cleanup handler before using SIGKILL as a final bound.
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
    (output/(component+'-controller.log')).write_text(stdout+'\n'+stderr)
    if timed_out or process.returncode != 0:
        raise RuntimeError('Native '+component+' controller '+('timed out' if timed_out else 'failed')
                           +'; inspect '+component+'-controller.log and '+component+'-failure.json')
    return stdout.strip()


def open_chrome(url):
    # A fresh emulator's Chrome can swallow the first VIEW intent behind its first-run promos
    # (main run 40284140320: the notifications sheet over the new-tab page). Record it; only the
    # subsequent browser report may establish success.
    result = subprocess.run(['adb', 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url,
                             'com.android.chrome'], capture_output=True, text=True, timeout=90)
    return {'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}


def open_safari(udid, url):
    # Fresh Simulator SpringBoard can report launch failure before Safari becomes
    # usable. Record it; only the subsequent browser report may establish success.
    try:
        result = subprocess.run(['xcrun', 'simctl', 'openurl', udid, url],
                                capture_output=True, text=True, timeout=90)
        return {'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
    except subprocess.TimeoutExpired:
        return {'timedOut': True}


def simulator_options(devices, sdk_version):
    # Runner images can contain newer runtimes than the selected Xcode supports.
    sdk_major = int(sdk_version.split('.')[0])
    options = []
    for runtime, group in devices.items():
        match = re.search(r'\.iOS-(\d+)-(\d+)', runtime)
        if not match or int(match[1]) != sdk_major:
            continue
        version = tuple(map(int, match.groups()))
        for device in group:
            if device['name'].startswith('iPhone') and device.get('isAvailable'):
                options.append((version, runtime, device))
    return sorted(options, key=lambda item: (item[0], 'SE' not in item[2]['name'], item[2]['name']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', required=True, choices=['android', 'ios', 'desktop'])
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--port', type=int, default=8765,
                        help='Loopback port for the test origin. CI keeps the default; local machines may need another port when a developer service already holds 8765.')
    parser.add_argument('--output', type=Path, default=ROOT/'mobile-evidence')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    started = time.monotonic()

    def phase(name):
        # Startup phases on stderr, so a stalled cold runner says where it stalled.
        print(json.dumps({'phase': name, 'seconds': round(time.monotonic()-started, 3)}), file=sys.stderr, flush=True)
    phase('evidence')
    evidence = {'runId': run_id, 'executionEnvironment': {'android':'android-emulator','ios':'ios-simulator','desktop':'desktop-component-only'}[args.platform],
                'physicalDeviceQualified': False, 'inferenceQualified': False, 'photoWorkflowQualified': False,
                'networkObservation': 'model fixture endpoint ledger on the app TLS origin; no host separation or complete external-request interception',
                'traceAvailability': 'untested: native mobile controller records browser reports/screenshots/logs; no browser trace API',
                'sourceCommit': command('git', '-C', str(ROOT), 'rev-parse', 'HEAD'),
                'sourceSha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for folder in ['tests/mobile', 'src/Next/Assets', 'src/Next/photo']
                                 for p in (ROOT/folder).glob('*') if p.suffix in ['.py', '.mjs', '.html']},
                'runnerImage': os.environ.get('ImageVersion'), 'completed': False}
    state = {'report': None}
    requests = {}
    transfers = []
    requests_lock = threading.Lock()

    def ledger():
        # Body writes accepted by this server's socket, not a claim about bytes the
        # browser consumed. The fixture and app use the same TLS origin.
        with requests_lock:
            return {'version': 1,
                    'classification': 'resource-endpoint (same origin; no host separation)',
                    'bodyBytesMeaning': 'successful socket body writes; not browser-received bytes',
                    'transfers': [dict(row) for row in transfers]}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            super().end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith('/fixture/'):
                name = path.removeprefix('/fixture/')
                transfer = None
                if name == 'stats':
                    with requests_lock:
                        body = json.dumps(requests).encode()
                elif name == 'ledger':
                    body = json.dumps(ledger()).encode()
                elif name in ('good', 'bad', 'slow', 'offline'):
                    body = b'abd' if name == 'bad' else b'abc'
                    with requests_lock:
                        requests[name] = requests.get(name, 0) + 1
                        transfer = {'id': len(transfers), 'path': path, 'url': self.path,
                                    'resourceClass': 'model-fixture',
                                    'status': 410 if name == 'offline' else 200,
                                    'expectedBytes': len(body), 'bytes': 0,
                                    'finished': False, 'aborted': False}
                        transfers.append(transfer)
                else:
                    self.send_error(404); return
                def write_body(part):
                    written = self.wfile.write(part)
                    if transfer is not None:
                        with requests_lock:
                            transfer['bytes'] += written
                try:
                    self.send_response(410 if name == 'offline' else 200)
                    self.send_header('Content-Type', 'application/json' if name in ('stats', 'ledger') else 'application/octet-stream')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    if name == 'slow':
                        write_body(body[:1]); self.wfile.flush()
                        with requests_lock:
                            requests['slowStarted'] = True
                        time.sleep(1)
                        write_body(body[1:])
                    else:
                        write_body(body)
                    self.wfile.flush()
                    if transfer is not None:
                        with requests_lock:
                            transfer['finished'] = transfer['bytes'] == transfer['expectedBytes']
                except OSError:
                    if transfer is not None:
                        with requests_lock:
                            transfer['aborted'] = True
                return
            mounts = json.loads((ROOT/'tests/mobile/mounts.json').read_text())
            prefix = next((prefix for prefix in mounts if path.startswith(prefix)), None)
            if prefix:
                package = (ROOT/mounts[prefix]).resolve()
                source = (package/path.removeprefix(prefix)).resolve()
                if package not in source.parents or not source.is_file() or source.suffix != '.js':
                    self.send_error(404); return
                body = source.read_bytes()
                self.send_response(200); self.send_header('Content-Type', 'text/javascript')
                self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            # Serve only test/component sources, never arbitrary checkout files.
            path = (ROOT/urlsplit(self.path).path.lstrip('/')).resolve()
            allowed = any(path.is_relative_to(ROOT/folder) for folder in ['tests/mobile', 'src/Next/Assets', 'src/Next/photo'])
            if not allowed or not path.is_file() or path.suffix not in ['.html', '.mjs']:
                self.send_error(404)
                return
            super().do_GET()

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/report' or not 0 < size <= 1024*1024:
                    raise ValueError('Invalid request')
                report = json.loads(self.rfile.read(size))
                if not isinstance(report, dict) or report.get('runId') != run_id:
                    raise ValueError('Wrong run')
                state['report'] = report
                (args.output/'browser.json').write_text(json.dumps(report, indent=2))
                self.send_response(204)
                self.end_headers()
            except (ValueError, TypeError):
                self.send_error(400)

    phase('certificate')
    certificate_dir = tempfile.TemporaryDirectory(prefix='facemorph-mobile-tls-')
    cert = Path(certificate_dir.name)/'localhost.pem'
    key = Path(certificate_dir.name)/'localhost-key.pem'
    command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-keyout', str(key), '-out', str(cert), '-subj', '/CN=localhost',
            '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1')
    phase('server')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT)))
    args.port = server.server_address[1]
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    udid = None
    cdp_port = None
    url = f'https://127.0.0.1:{args.port}/tests/mobile/index.html?run={run_id}'
    try:
        if args.platform == 'android':
            evidence['device'] = command('adb', 'shell', 'getprop')
            evidence['browser'] = command('adb', 'shell', 'dumpsys', 'package', 'com.android.chrome')
            command('adb', 'reverse', f'tcp:{args.port}', f'tcp:{args.port}')
            command('adb', 'shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome')
            command('adb', 'shell', "echo 'chrome --no-first-run --disable-fre --no-default-browser-check --ignore-certificate-errors --remote-debugging-socket-name=chrome_devtools_remote --remote-debugging-port=9222' > /data/local/tmp/chrome-command-line")
            # Android 13+ Chrome asks for notifications on first launch (--disable-fre does not cover it);
            # granting the permission up front skips that sheet. Older images have no such permission.
            command('adb', 'shell', 'pm', 'grant', 'com.android.chrome', 'android.permission.POST_NOTIFICATIONS', check=False)
            command('adb', 'shell', 'am', 'force-stop', 'com.android.chrome')
            evidence['launchAttempts'] = [open_chrome(url)]
        elif args.platform == 'ios':
            evidence['xcode'] = command('xcodebuild', '-version')
            evidence['simulatorSdk'] = command('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version')
            # First contact with CoreSimulator on a cold runner is the slow one: the service has
            # to start before it can answer, and 22 September it took longer than 90 seconds and
            # failed the lane before a browser was ever involved. The wait is generous because
            # what it protects against is a machine warming up, not a hang.
            devices = json.loads(command('xcrun', 'simctl', 'list', 'devices', 'available', '--json', timeout=300))['devices']
            options = simulator_options(devices, evidence['simulatorSdk'])
            if not options:
                raise RuntimeError('No installed iPhone Simulator matching selected Xcode SDK; no silent skip')
            _, runtime, device = options[-1]
            # Use a newly created simulator; leave any existing user/CI device alone.
            udid = command('xcrun', 'simctl', 'create', 'FaceMorph-CI-'+run_id,
                           device['deviceTypeIdentifier'], runtime)
            evidence['device'] = {'udid': udid, 'runtime': runtime, 'profile': device['name']}
            command('xcrun', 'simctl', 'boot', udid)
            command('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=180)
            command('xcrun', 'simctl', 'keychain', udid, 'add-root-cert', str(cert), timeout=60)
            evidence['launchAttempts'] = [open_safari(udid, url)]
        if args.platform == 'desktop':
            print(json.dumps({'url':url}), flush=True)
        deadline = time.monotonic()+args.timeout
        retry_at = time.monotonic()+30
        while time.monotonic() < deadline:
            report = state['report']
            if report and (report.get('completed') is True or report.get('error')):
                break
            if report is None and time.monotonic() >= retry_at and len(evidence.get('launchAttempts', [])) == 1:
                evidence['launchAttempts'].append(open_safari(udid, url) if udid else open_chrome(url))
            time.sleep(0.5)
        if args.platform == 'android' and assess(state['report'], run_id):
            # Preserve the unmodified page/worker report, then supplement its two
            # cross-tab placeholders with real independently controlled Chrome tabs.
            (args.output/'browser-components.json').write_text(json.dumps(state['report'], indent=2))
            cdp_port = command('adb', 'forward', 'tcp:0', 'localabstract:chrome_devtools_remote')
            for component in ['cross-tab', 'quota']:
                phase('native-'+component)
                evidence[component+'Controller'] = native_controller(
                    component, 'http://127.0.0.1:'+cdp_port, f'https://127.0.0.1:{args.port}', run_id, args.output)
                supplement = json.loads((args.output/(component+'.json')).read_text())
                replacements = supplement.get('rows', [])
                if (supplement.get('runId') != run_id or len(replacements) != 2
                        or {row.get('id') for row in replacements} != {'opfs.'+component, 'cache-storage.'+component}
                        or any(row.get('status') != 'pass' for row in replacements)):
                    raise RuntimeError('Native '+component+' controller returned incomplete or stale evidence')
                by_id = {row['id']: row for row in replacements}
                state['report']['managerMatrix'] = [by_id.get(row['id'], row)
                                                   for row in state['report']['managerMatrix']]
            (args.output/'browser.json').write_text(json.dumps(state['report'], indent=2))
        evidence['passed'] = assess(state['report'], run_id)
        evidence['completed'] = bool(state['report'] and state['report'].get('completed'))
        if not evidence['passed']:
            raise RuntimeError('Mobile browser failed, reset, or timed out; inspect browser.json and screenshot')
    except Exception as error:
        evidence['error'] = str(error)
        raise
    finally:
        try:
            if args.platform == 'android':
                with (args.output/'screen.png').open('wb') as f:
                    subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=f, timeout=20)
                (args.output/'logcat.txt').write_text(command('adb', 'logcat', '-d', '-t', '1000', check=False))
            elif udid:
                command('xcrun', 'simctl', 'io', udid, 'screenshot', str(args.output/'screen.png'), check=False)
        except Exception as error:
            evidence['diagnosticError'] = str(error)
        finally:
            if args.platform == 'android':
                # Diagnostic collection must never prevent task-owned tunnel cleanup.
                for kind, port in [('reverse', str(args.port)), ('forward', cdp_port)]:
                    if port:
                        try:
                            command('adb', kind, '--remove', 'tcp:'+port, check=False, timeout=15)
                        except Exception as error:
                            evidence.setdefault('cleanupErrors', []).append(str(error))
            if udid:
                command('xcrun', 'simctl', 'shutdown', udid, check=False)
                command('xcrun', 'simctl', 'delete', udid, check=False)
            server.shutdown(); server.server_close()
            certificate_dir.cleanup()
            evidence['fixtureRequests'] = requests
            evidence['fixtureLedger'] = ledger()
            evidence['tls'] = 'ephemeral localhost certificate; iOS Simulator trusts this root, Android emulator explicitly ignores certificate errors'
            evidence['componentPackageSha256'] = {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (REPO/'packages/browser-model-manager/dist').rglob('*.js')}
            (args.output/'host.json').write_text(json.dumps(evidence, indent=2))
            print(json.dumps({k: evidence.get(k) for k in ['runId', 'executionEnvironment', 'passed', 'error']}))


if __name__ == '__main__':
    main()

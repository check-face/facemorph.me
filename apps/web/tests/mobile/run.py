"""Real mobile components with optional pinned CPU lifecycle inference; no handset qualification."""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
import re
import shlex
from pathlib import Path
import subprocess
import threading
import ssl
import tempfile
import time
from urllib.parse import urlsplit, parse_qs, urlencode
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


def loaded_lifecycle_valid(result):
    if not isinstance(result, dict):
        return False
    warm = result.get('warm', {})
    canary = warm.get('canary', {})
    if (result.get('manifestSha256') != 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c'
            or warm.get('rgbaBytes') != 1024*1024*4 or canary.get('passed') is not True
            or any(type(canary.get(key)) not in (int, float) or not math.isfinite(canary[key])
                   or not 0 <= canary[key] <= limit for key, limit in [('maxRgb', 1), ('maxFloat', .002)])):
        return False
    operations = result.get('rows', [])
    if (not isinstance(operations, list) or len(operations) != 3
            or any(not isinstance(row, dict) for row in operations)
            or [row.get('cause') for row in operations] != ['release', 'browser-eviction', 'corruption']):
        return False
    for operation, code in zip(operations, ['invalidated', 'evicted', 'corrupt']):
        after = operation.get('after', {})
        generator = after.get('generator', {})
        before = operation.get('before', {})
        if (operation.get('error', {}).get('code') != code
                or before.get('handle', {}).get('pending') != 1
                or before.get('generator', {}).get('pending') != 1
                or generator.get('disposed') is not True or generator.get('liveSessions') != 0
                or generator.get('pending') != 0 or after.get('leases') != []
                or after.get('handle', {}).get('pending') != 0
                or operation.get('nativeLocksReleased') is not True):
            return False
    return True


def inference_evidence_valid(report):
    loaded = [row for row in report.get('managerMatrix', [])
              if isinstance(row, dict) and row.get('id') in
              ('opfs.loaded-handle-disposal', 'cache-storage.loaded-handle-disposal')]
    if report.get('inferenceExecuted') is False:
        return (report.get('evidenceLevel') == 'browser-component'
                and len(loaded) == 2 and all(row.get('status') == 'untested' for row in loaded))
    return (report.get('inferenceExecuted') is True
            and report.get('evidenceLevel') == 'browser-component-with-cpu-lifecycle'
            and len(loaded) == 2 and all(row.get('status') == 'pass'
                and row.get('details', {}).get('controller') == 'actual-native-mobile-worker'
                and loaded_lifecycle_valid(row.get('details', {}).get('lifecycle')) for row in loaded))


def assess(report, run_id):
    if not isinstance(report, dict):
        return False
    rows = report.get('results', [])
    return (report.get('runId') == run_id and report.get('completed') is True
            and not report.get('error') and report.get('secureContext') is True
            and report.get('e4eExecuted') is False
            and inference_evidence_valid(report)
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


def chrome_intent(url):
    # adb shell joins argv into a shell command. Quote the complete URL so query
    # separators stay in the intent instead of starting background shell commands.
    return shlex.join(['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url,
                       'com.android.chrome'])


def open_chrome(url):
    # A fresh emulator's Chrome can swallow the first VIEW intent behind its first-run promos
    # (main run 40284140320: the notifications sheet over the new-tab page). Record it; only the
    # subsequent browser report may establish success.
    result = subprocess.run(['adb', 'shell', chrome_intent(url)],
                            capture_output=True, text=True, timeout=90)
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


def simulator_certificate(udid, certificate, attempts):
    # bootstatus can finish before native keychain services answer a cold Simulator.
    # Retry only a timed-out setup IPC, on the same device and exact same certificate.
    # Browser deadlines and every component assertion are created after this setup.
    for attempt in (1, 2):
        entry = dict(phase='simulator-certificate', attempt=attempt, timeoutSeconds=60)
        attempts.append(entry)
        print(json.dumps(entry), file=sys.stderr, flush=True)
        started = time.monotonic()
        try:
            result = subprocess.run(['xcrun', 'simctl', 'keychain', udid, 'add-root-cert', str(certificate)],
                                    capture_output=True, text=True, timeout=60)
            entry.update(returncode=result.returncode, stdout=result.stdout[-1000:], stderr=result.stderr[-1000:])
            result.check_returncode()
            return
        except subprocess.TimeoutExpired:
            entry['timedOut'] = True
            if attempt == 2:
                raise
        finally:
            entry['seconds'] = round(time.monotonic()-started, 3)
        readiness = dict(phase='simulator-bootstatus-recheck', timeoutSeconds=60)
        attempts.append(readiness)
        print(json.dumps(readiness), file=sys.stderr, flush=True)
        started = time.monotonic()
        try:
            result = subprocess.run(['xcrun', 'simctl', 'bootstatus', udid, '-b'],
                                    capture_output=True, text=True, timeout=60)
            readiness.update(returncode=result.returncode, stdout=result.stdout[-1000:], stderr=result.stderr[-1000:])
            result.check_returncode()
        except subprocess.TimeoutExpired:
            readiness['timedOut'] = True
            raise
        finally:
            readiness['seconds'] = round(time.monotonic()-started, 3)


def ios_tab_controller(origin, run_id, udid, state, fixture_ledger, navigations, output, lock):
    before = fixture_ledger()
    primary_url = origin+'/tests/mobile/manager-tab.html?'+urlencode({'run': run_id, 'role': 'primary'})
    launches = [open_safari(udid, primary_url)]
    seen = 0
    opened = {}
    deadline = time.monotonic()+150
    while time.monotonic() < deadline:
        with lock:
            error, events, report = state.get('error'), state['events'][:], state.get('report')
        if error:
            raise RuntimeError('Native Safari cross-tab failed: '+str(error))
        for event in events[seen:]:
            if event['action'] == 'open-helper':
                backend = event.get('backend')
                if (backend not in ('opfs', 'cache-storage') or backend in opened
                        or event.get('name') != 'mobile-ios-tabs-'+run_id+'-'+backend
                        or not isinstance(event.get('primaryIdentity'), str)):
                    raise RuntimeError('Native Safari requested an invalid or duplicate helper')
                opened[backend] = event
                query = {'run': run_id, 'role': 'helper', 'backend': backend,
                         'name': event['name'], 'primaryIdentity': event['primaryIdentity']}
                launches.append(open_safari(udid, origin+'/tests/mobile/manager-tab.html?'+urlencode(query)))
        seen = len(events)
        if report:
            rows = report.get('rows', [])
            if (len(rows) != 2 or {row.get('id') for row in rows} != {'opfs.cross-tab', 'cache-storage.cross-tab'}
                    or any(row.get('status') != 'pass' for row in rows)):
                raise RuntimeError('Native Safari returned incomplete cross-tab evidence')
            for backend in ('opfs', 'cache-storage'):
                deleted = [event for event in events if event['action'] == 'helper-deleted'
                           and event.get('backend') == backend]
                if (backend not in opened or len(deleted) != 1
                        or deleted[0].get('primaryIdentity') != opened[backend]['primaryIdentity']
                        or not deleted[0].get('helperIdentity')
                        or deleted[0]['helperIdentity'] == deleted[0]['primaryIdentity']):
                    raise RuntimeError('Native Safari did not prove independent helper deletion')
            primary_requests = [url for url in navigations if parse_qs(urlsplit(url).query).get('role') == ['primary']]
            if primary_requests != [primary_url] or fixture_ledger() != before:
                raise RuntimeError('Native Safari reloaded its primary or transferred model bytes')
            evidence = dict(runId=run_id, rows=rows, events=events, launches=launches,
                            primaryNavigations=primary_requests, fixtureLedgerBefore=before,
                            fixtureLedgerAfter=fixture_ledger())
            (output/'cross-tab.json').write_text(json.dumps(evidence, indent=2))
            return rows
        time.sleep(.1)
    raise RuntimeError('Native Safari did not return to its original cross-tab document within150seconds')


def loaded_mobile_controller(origin, run_id, opener, state, transfers, output):
    rows = []
    for backend in ('opfs', 'cache-storage'):
        state['active'] = backend
        state[backend] = {'phase': 'acquiring', 'report': None}
        launch = opener(origin+'/tests/mobile/manager-loaded.html?'+urlencode({'run': run_id, 'backend': backend}))
        deadline = time.monotonic()+300
        while time.monotonic() < deadline and state[backend]['report'] is None:
            time.sleep(.1)
        report = state[backend]['report']
        if not report or report.get('error') or report.get('phase') != 'complete':
            raise RuntimeError('Native '+backend+' loaded runtime failed: '+str(report))
        result = report.get('result', {})
        setup = report.get('setup', {})
        if (report.get('secureContext') is not True or not report.get('userAgent')
                or setup.get('bytes') != 157405379 or setup.get('remainingBytes') != 0
                or not loaded_lifecycle_valid(result)):
            raise RuntimeError('Native '+backend+' returned incomplete real CPU/canary/lifecycle evidence')
        native_transfers = [dict(row) for row in transfers if row['backend'] == backend]
        if (not native_transfers or any(row['phase'] != 'acquiring' or not row['finished']
                                        or row['aborted'] for row in native_transfers)):
            raise RuntimeError('Native loaded execution transferred bytes after admission or had incomplete acquisition')
        rows.append(dict(id=backend+'.loaded-handle-disposal', backend=backend,
                         lane=report['userAgent'], status='pass',
                         network=dict(requests=0, bytes=0, paths=[], measurement='native-server-ledger', hostSeparation=False),
                         details=dict(controller='actual-native-mobile-worker', launch=launch,
                                      acquisitionRequests=len(native_transfers),
                                      acquisitionBytes=sum(row['bytes'] for row in native_transfers),
                                      lifecycle=result,
                                      scope='real CPU/WASM native worker; runtime endpoint ledger, no external HTTP interception claim')))
    (output/'loaded.json').write_text(json.dumps(dict(runId=run_id, rows=rows, transfers=transfers), indent=2))
    return rows


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
    parser.add_argument('--runtime', type=Path,
                        help='Verified pinned CPU runtime directory for native loaded-handle components')
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
    tabs_state = {'events': [], 'report': None}
    tabs_lock = threading.Lock()
    tab_navigations = []
    loaded_state = {'active': None}
    loaded_transfers = []
    if args.runtime:
        args.runtime = args.runtime.resolve()
        if hashlib.sha256((args.runtime/'manifest.json').read_bytes()).hexdigest() != 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c':
            raise RuntimeError('Loaded component runtime manifest is not the pinned runtime')
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
            if path == '/tests/mobile/manager-tab.html':
                tab_navigations.append('https://127.0.0.1:'+str(args.port)+self.path)
            aliases = {
                '/manager-loaded-driver.mjs': REPO/'packages/browser-model-manager/test/support/loaded-runtime-browser.mjs',
                '/manager-loaded-worker.mjs': ROOT/'tests/mobile/manager-loaded-worker.mjs',
            }
            source = aliases.get(path)
            for prefix, package in [('/stylegan/', 'stylegan-js'), ('/manager/', 'browser-model-manager')]:
                if path.startswith(prefix):
                    directory = (REPO/'packages'/package/'dist').resolve()
                    candidate = (directory/path.removeprefix(prefix)).resolve()
                    if candidate.is_relative_to(directory) and candidate.suffix == '.js': source = candidate
            if source:
                if not source.is_file(): self.send_error(404); return
                body = source.read_bytes()
                self.send_response(200); self.send_header('Content-Type', 'text/javascript')
                self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            if path.startswith('/loaded-runtime/'):
                if not args.runtime or not loaded_state['active']: self.send_error(404); return
                source = (args.runtime/path.removeprefix('/loaded-runtime/')).resolve()
                if not source.is_relative_to(args.runtime) or not source.is_file(): self.send_error(404); return
                backend = loaded_state['active']
                phase = loaded_state[backend]['phase']
                transfer = dict(path=path, backend=backend, phase=phase, bytes=0, finished=False, aborted=False)
                loaded_transfers.append(transfer)
                if phase != 'acquiring': self.send_error(410); return
                content_type = 'application/wasm' if source.suffix == '.wasm' else 'text/javascript' if source.suffix == '.mjs' else 'application/octet-stream'
                self.send_response(200); self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(source.stat().st_size)); self.end_headers()
                try:
                    with source.open('rb') as body:
                        while part := body.read(65536): transfer['bytes'] += self.wfile.write(part)
                    self.wfile.flush(); transfer['finished'] = True
                except OSError: transfer['aborted'] = True
                return
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
                if self.path not in ('/report', '/tabs-control', '/loaded-report') or not 0 < size <= 1024*1024:
                    raise ValueError('Invalid request')
                report = json.loads(self.rfile.read(size))
                if not isinstance(report, dict) or report.get('runId') != run_id:
                    raise ValueError('Wrong run')
                if self.path == '/loaded-report':
                    backend = report.get('backend')
                    if backend != loaded_state['active'] or backend not in ('opfs', 'cache-storage'):
                        raise ValueError('Wrong native loaded backend')
                    if report.get('error'):
                        loaded_state[backend]['report'] = report
                    elif report.get('phase') == 'acquired':
                        if loaded_state[backend]['phase'] != 'acquiring': raise ValueError('Duplicate acquisition')
                        loaded_state[backend]['phase'] = 'loaded'
                    else:
                        if report.get('phase') == 'complete' and loaded_state[backend]['phase'] != 'loaded':
                            raise ValueError('Native loaded execution has no acknowledged admission boundary')
                        loaded_state[backend]['report'] = report
                    (args.output/('loaded-'+backend+'.json')).write_text(json.dumps(report, indent=2))
                elif self.path == '/tabs-control':
                    if report.get('action') not in ('open-helper', 'helper-deleted', 'complete', 'failed'):
                        raise ValueError('Invalid native tab action')
                    with tabs_lock:
                        tabs_state['events'].append(report)
                        if report['action'] == 'complete': tabs_state['report'] = report
                        if report['action'] == 'failed': tabs_state['error'] = report
                        (args.output/'cross-tab-events.json').write_text(json.dumps(tabs_state, indent=2))
                else:
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
    # Native module workers open a graph of connections together. Keep a slow TLS
    # peer out of the accept loop and retain the burst until handler threads take it.
    class MobileServer(ThreadingHTTPServer):
        request_queue_size = 256
    server = MobileServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT)))
    args.port = server.server_address[1]
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
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
            evidence['certificateAttempts'] = []
            simulator_certificate(udid, cert, evidence['certificateAttempts'])
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
        elif args.platform == 'ios' and assess(state['report'], run_id):
            phase('native-cross-tab')
            (args.output/'browser-components.json').write_text(json.dumps(state['report'], indent=2))
            rows = ios_tab_controller(f'https://127.0.0.1:{args.port}', run_id, udid,
                                      tabs_state, ledger, tab_navigations, args.output, tabs_lock)
            by_id = {row['id']: row for row in rows}
            state['report']['managerMatrix'] = [by_id.get(row['id'], row)
                                               for row in state['report']['managerMatrix']]
            (args.output/'browser.json').write_text(json.dumps(state['report'], indent=2))
        if args.runtime and args.platform in ('android', 'ios') and assess(state['report'], run_id):
            phase('native-loaded-runtime')
            opener = (lambda url: open_safari(udid, url)) if udid else open_chrome
            rows = loaded_mobile_controller(f'https://127.0.0.1:{args.port}', run_id, opener,
                                           loaded_state, loaded_transfers, args.output)
            by_id = {row['id']: row for row in rows}
            state['report']['managerMatrix'] = [by_id.get(row['id'], row)
                                               for row in state['report']['managerMatrix']]
            state['report']['inferenceExecuted'] = True
            state['report']['evidenceLevel'] = 'browser-component-with-cpu-lifecycle'
            (args.output/'browser.json').write_text(json.dumps(state['report'], indent=2))
        evidence['inferenceExecuted'] = bool(state['report'] and state['report'].get('inferenceExecuted'))
        evidence['evidenceLevel'] = state['report'].get('evidenceLevel') if state['report'] else None
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
            evidence['loadedRuntimeTransfers'] = loaded_transfers
            evidence['tls'] = 'ephemeral localhost certificate; iOS Simulator trusts this root, Android emulator explicitly ignores certificate errors'
            evidence['componentPackageSha256'] = {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (REPO/'packages/browser-model-manager/dist').rglob('*.js')}
            (args.output/'host.json').write_text(json.dumps(evidence, indent=2))
            print(json.dumps({k: evidence.get(k) for k in ['runId', 'executionEnvironment', 'passed', 'error']}))


if __name__ == '__main__':
    main()

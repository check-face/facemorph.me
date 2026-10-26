import copy
import importlib.util
import json
import shlex
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen
spec=importlib.util.spec_from_file_location('ios_product',Path(__file__).resolve().parents[2]/'scripts/next-ios-sim.py')
ios_product=importlib.util.module_from_spec(spec);spec.loader.exec_module(ios_product)
import unittest
from run import chrome_intent, assess, open_safari, EXPECTED, MANAGER_EXPECTED, simulator_options


def manager_rows():
    rows = []
    limitations = {'quota': 'native-quota-control-unavailable',
                   'loaded-handle-disposal': 'loaded-runtime-unavailable',
                   'cross-tab': 'second-tab-unavailable'}
    for name in sorted(MANAGER_EXPECTED):
        backend, case = name.split('.', 1)
        transfer = case in ('cold', 'cancel')
        row = dict(id=name, backend=backend, lane='test browser', status='pass',
                   network=dict(requests=int(transfer), bytes=3 if transfer else 0,
                                paths=['/fixture/good'] if transfer else [],
                                measurement='native-server-ledger', hostSeparation=False))
        if case in limitations:
            row.update(status='untested', reasonCode=limitations[case],
                       reason='This native controller cannot observe this capability.')
        rows.append(row)
    return rows


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.report = dict(runId='test', completed=True, secureContext=True,
                           inferenceExecuted=False, e4eExecuted=False, evidenceLevel='browser-component',
                           results=[dict(id=name, passed=True) for name in EXPECTED],
                           managerMatrix=manager_rows(),
                           managerCapabilities=dict(opfs=True, cacheStorage=True, workerSync=True))

    def test_android_intent_preserves_backend_query_as_one_shell_argument(self):
        for backend in ['opfs', 'cache-storage']:
            url = 'https://127.0.0.1:8765/tests/mobile/manager-loaded.html?run=run123&backend='+backend
            args = shlex.split(chrome_intent(url))
            self.assertEqual(args, ['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d',
                                    url, 'com.android.chrome'])
            # Exercise the native host shell's word expansion, including characters that
            # would be executable if the URL were merely interpolated or JSON encoded.
            literal = url+"&literal=$(exit 73);`exit 74`'"
            suffix = chrome_intent(literal).split(' -d ', 1)[1]
            words = subprocess.run(['/bin/sh', '-c', 'printf \"%s\\n\" '+suffix],
                                   capture_output=True, text=True, check=True, timeout=5)
            self.assertEqual(words.stdout, literal+'\ncom.android.chrome\n')

    def test_safari_is_launched_before_openurl_and_a_cold_exit_60_is_retried(self):
        calls, sleeps = [], []
        # launch, openurl exits 60, relaunch, openurl times out, relaunch, openurl succeeds.
        replies = iter([{'returncode': 0}, {'returncode': 60, 'stderr': 'NSPOSIXErrorDomain 60'}, {'returncode': 0},
                        {'timedOut': True}, {'returncode': 0}, {'returncode': 0}])
        def run(*args, timeout):
            calls.append((args[0], timeout))
            return next(replies)
        result = open_safari('UDID', 'https://127.0.0.1:1/x?a=1&b=2', run=run, sleep=sleeps.append)
        self.assertEqual([c[0] for c in calls], ['launch', 'openurl', 'launch', 'openurl', 'launch', 'openurl'])
        self.assertEqual(result['returncode'], 0)
        self.assertEqual([c['step'] for c in result['calls']], [c[0] for c in calls])
        self.assertEqual(sleeps, [10, 10])

    def test_safari_open_is_bounded_and_reports_the_last_failure(self):
        calls = []
        def run(*args, timeout):
            calls.append((args[0], timeout))
            return {'returncode': 0} if args[0] == 'launch' else {'returncode': 60, 'stderr': 'Operation timed out'}
        result = open_safari('UDID', 'https://127.0.0.1:1/x', run=run, sleep=lambda s: None)
        self.assertEqual([c[0] for c in calls].count('openurl'), 4)
        self.assertEqual(calls[-1][0], 'openurl')
        self.assertEqual(result['returncode'], 60)
        self.assertIn('timed out', result['stderr'])
        # About six minutes at most: two-minute first launch, four one-minute openurls, three relaunches, 30 s sleep.
        self.assertLessEqual(sum(t for _, t in calls) + 30, 600)

    def test_complete_components_only(self):
        self.assertTrue(assess(self.report, 'test'))

    def test_missing_duplicate_failed_or_stale(self):
        for change in ['missing', 'extra', 'duplicate', 'failed', 'stale', 'error', 'inference', 'insecure']:
            report = copy.deepcopy(self.report)
            if change == 'missing': report['results'].pop()
            if change == 'extra': report['results'].append(dict(id='unexpected',passed=True))
            if change == 'duplicate': report['results'][-1] = report['results'][0]
            if change == 'failed': report['results'][0]['passed'] = False
            if change == 'stale': report['runId'] = 'old'
            if change == 'error': report['error'] = 'reset'
            if change == 'inference': report['e4eExecuted'] = True
            if change == 'insecure': report['secureContext'] = False
            self.assertFalse(assess(report, 'test'), change)

    def test_missing_duplicate_failed_or_malformed_manager_cells_fail(self):
        for change in ['missing', 'duplicate', 'failed', 'unknown-status', 'malformed-id',
                       'no-network', 'negative-bytes', 'wrong-lane', 'wrong-backend',
                       'claims-host-separation', 'missing-cold-transfer', 'hidden-local-request']:
            report = copy.deepcopy(self.report)
            rows = report['managerMatrix']
            row = next(row for row in rows if row['id'] == 'opfs.cold')
            if change == 'missing': rows.pop()
            if change == 'duplicate': rows[-1] = rows[0]
            if change == 'failed': row['status'] = 'fail'
            if change == 'unknown-status': row['status'] = 'unavailable'
            if change == 'malformed-id': row['id'] = []
            if change == 'no-network': row.pop('network')
            if change == 'negative-bytes': row['network']['bytes'] = -1
            if change == 'wrong-lane': row['lane'] = ''
            if change == 'wrong-backend': row['backend'] = 'cache-storage'
            if change == 'claims-host-separation': row['network']['hostSeparation'] = True
            if change == 'missing-cold-transfer':
                row['network'].update(requests=0, bytes=0, paths=[])
            if change == 'hidden-local-request':
                row = next(row for row in rows if row['id'] == 'opfs.model-cached')
                row['network'].update(requests=1, bytes=3, paths=['/fixture/good'])
            self.assertFalse(assess(report, 'test'), change)

    def test_native_absence_is_explicit_and_cannot_hide_executed_failures(self):
        self.report['managerCapabilities']['opfs'] = False
        for row in self.report['managerMatrix']:
            if row['backend'] == 'opfs':
                row.update(status='untested', reasonCode='native-opfs-unavailable',
                           reason='This worker exposes no native OPFS API.')
                row['network'].update(requests=0, bytes=0, paths=[])
        self.assertTrue(assess(self.report, 'test'))
        for change in ['api-exposed', 'missing-reason', 'unknown-reason', 'executed-error',
                       'executed-transfer', 'wrong-capability']:
            report = copy.deepcopy(self.report)
            row = next(row for row in report['managerMatrix'] if row['backend'] == 'opfs')
            if change == 'api-exposed': report['managerCapabilities']['opfs'] = True
            if change == 'missing-reason': row['reason'] = ''
            if change == 'unknown-reason': row['reasonCode'] = 'test-failed'
            if change == 'executed-error': row['error'] = 'Native write failed'
            if change == 'executed-transfer':
                row['network'].update(requests=1, bytes=3, paths=['/fixture/good'])
            if change == 'wrong-capability': row['reasonCode'] = 'native-cache-storage-unavailable'
            self.assertFalse(assess(report, 'test'), change)

    def test_executed_quota_requires_one_refused_save_then_one_authorized_retry(self):
        row = next(row for row in self.report['managerMatrix'] if row['id'] == 'opfs.quota')
        row.update(status='pass', details=dict(quotaReset=True,
                   failure=dict(typed=dict(code='quota')), retry=dict(remainingBytes=0)))
        row['network'].update(requests=2, bytes=6, paths=['/fixture/good', '/fixture/good'])
        self.assertTrue(assess(self.report, 'test'))
        for change in ['no-quota-error', 'no-reset', 'incomplete-bytes', 'repeated-transfer', 'unspent-retry']:
            report = copy.deepcopy(self.report)
            row = next(row for row in report['managerMatrix'] if row['id'] == 'opfs.quota')
            if change == 'no-quota-error': row['details']['failure']['typed']['code'] = 'capability'
            if change == 'no-reset': row['details']['quotaReset'] = False
            if change == 'incomplete-bytes': row['network']['bytes'] = 3
            if change == 'repeated-transfer': row['network'].update(requests=3, bytes=9, paths=['/fixture/good']*3)
            if change == 'unspent-retry': row['details']['retry']['remainingBytes'] = 3
            self.assertFalse(assess(report, 'test'), change)

    def test_loaded_inference_requires_both_real_lifecycle_results(self):
        report = copy.deepcopy(self.report)
        report.update(inferenceExecuted=True, evidenceLevel='browser-component-with-cpu-lifecycle')
        self.assertFalse(assess(report, 'test'), 'a flag cannot substitute for execution')
        for row in report['managerMatrix']:
            if not row['id'].endswith('.loaded-handle-disposal'):
                continue
            operations = []
            for cause, code in [('release', 'invalidated'), ('browser-eviction', 'evicted'), ('corruption', 'corrupt')]:
                operations.append(dict(cause=cause, error=dict(code=code), nativeLocksReleased=True,
                    before=dict(handle=dict(pending=1), generator=dict(pending=1)),
                    after=dict(handle=dict(pending=0), leases=[],
                               generator=dict(disposed=True, liveSessions=0, pending=0))))
            result = dict(manifestSha256='d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c',
                          warm=dict(rgbaBytes=1024*1024*4, canary=dict(passed=True, maxRgb=1, maxFloat=.002)),
                          rows=operations)
            row.update(status='pass', details=dict(controller='actual-native-mobile-worker', lifecycle=result))
        self.assertTrue(assess(report, 'test'))
        for change in ['denied-inference', 'wrong-scope', 'missing-backend', 'missing-component',
                       'bad-canary', 'nan-canary', 'bool-canary', 'wrong-pin', 'wrong-typed-error',
                       'no-pending-operation', 'live-session', 'retained-lease', 'locked']:
            broken = copy.deepcopy(report)
            row = next(row for row in broken['managerMatrix'] if row['id'] == 'opfs.loaded-handle-disposal')
            lifecycle = row['details']['lifecycle']
            if change == 'denied-inference': broken['inferenceExecuted'] = False
            if change == 'wrong-scope': broken['evidenceLevel'] = 'product-qualified'
            if change == 'missing-backend': row.update(status='untested', reasonCode='loaded-runtime-unavailable', reason='No runtime')
            if change == 'missing-component': broken['results'].pop()
            if change == 'bad-canary': lifecycle['warm']['canary']['maxFloat'] = .002001
            if change == 'nan-canary': lifecycle['warm']['canary']['maxFloat'] = float('nan')
            if change == 'bool-canary': lifecycle['warm']['canary']['maxRgb'] = True
            if change == 'wrong-pin': lifecycle['manifestSha256'] = 'other'
            if change == 'wrong-typed-error': lifecycle['rows'][1]['error']['code'] = 'invalidated'
            if change == 'no-pending-operation': lifecycle['rows'][0]['before']['handle']['pending'] = 0
            if change == 'live-session': lifecycle['rows'][0]['after']['generator']['liveSessions'] = 1
            if change == 'retained-lease': lifecycle['rows'][0]['after']['leases'] = ['asset']
            if change == 'locked': lifecycle['rows'][0]['nativeLocksReleased'] = False
            self.assertFalse(assess(broken, 'test'), change)

    def test_native_https_fixture_ledger_measures_complete_and_partial_body_writes(self):
        context = ssl._create_unverified_context()
        with tempfile.TemporaryDirectory(prefix='mobile-ledger-controller-') as scratch:
            scratch = Path(scratch)
            with (scratch/'stdout').open('w') as stdout, (scratch/'stderr').open('w') as stderr:
                process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('run.py')),
                                            '--platform', 'desktop', '--port', '0', '--timeout', '30',
                                            '--output', str(scratch/'evidence')], stdout=stdout, stderr=stderr)
                try:
                    # A cold hosted macOS runner is slow to its first openssl/git call; the controller logs each
                    # startup phase to stderr, which a timeout reports instead of discarding.
                    deadline = time.monotonic()+90
                    while time.monotonic() < deadline:
                        lines = (scratch/'stdout').read_text().splitlines()
                        if lines:
                            break
                        if process.poll() is not None:
                            self.fail((scratch/'stderr').read_text())
                        time.sleep(.02)
                    self.assertTrue(lines, 'controller never published its ephemeral HTTPS URL; its stderr: '
                                    + (scratch/'stderr').read_text())
                    url = json.loads(lines[0])['url']
                    parts = urlsplit(url)
                    origin = f'{parts.scheme}://{parts.netloc}'
                    def get(path):
                        return urlopen(origin+path, context=context, timeout=5)
                    def ledger():
                        with get('/fixture/ledger') as response:
                            return json.load(response)
                    self.assertEqual(ledger()['transfers'], [])
                    with get('/fixture/good?probe=native') as response:
                        self.assertEqual(response.read(), b'abc')
                    with self.assertRaises(HTTPError) as gone:
                        get('/fixture/offline')
                    self.assertEqual(gone.exception.read(), b'abc')
                    gone.exception.close()
                    with get('/fixture/slow') as response:
                        self.assertEqual(response.read(1), b'a')
                        partial = ledger()['transfers'][-1]
                        self.assertEqual(partial['bytes'], 1)
                        self.assertFalse(partial['finished'])
                        self.assertFalse(partial['aborted'])
                        self.assertEqual(response.read(), b'bc')
                    observed = ledger()
                    self.assertEqual([row['status'] for row in observed['transfers']], [200, 410, 200])
                    self.assertEqual([row['bytes'] for row in observed['transfers']], [3, 3, 3])
                    self.assertEqual([row['id'] for row in observed['transfers']], [0, 1, 2])
                    self.assertTrue(all(row['finished'] and not row['aborted']
                                        and row['resourceClass'] == 'model-fixture'
                                        for row in observed['transfers']))
                    self.assertIn('no host separation', observed['classification'])
                    self.assertIn('not browser-received', observed['bodyBytesMeaning'])
                    with get('/fixture/stats') as response:
                        self.assertEqual(json.load(response), dict(good=1, offline=1, slow=1, slowStarted=True))
                    report = copy.deepcopy(self.report)
                    report['runId'] = parse_qs(parts.query)['run'][0]
                    request = Request(origin+'/report', data=json.dumps(report).encode(),
                                      headers={'Content-Type': 'application/json'})
                    with urlopen(request, context=context, timeout=5) as response:
                        self.assertEqual(response.status, 204)
                    self.assertEqual(process.wait(timeout=5), 0, (scratch/'stderr').read_text())
                    host = json.loads((scratch/'evidence/host.json').read_text())
                    self.assertEqual(host['fixtureLedger'], observed)
                    self.assertTrue(host['passed'])
                finally:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=5)

    def test_product_requires_real_inference_and_cpu_layout(self):
        report=dict(completed=True,faceProduced=True,errors=[],secureContext=True,crossOriginIsolated=True,
                    route='CPU',faceLayout=dict(fitsTile=True,fitsViewport=True),
                    inferenceEvents=[dict(op='generate',reply='complete')])
        self.assertTrue(ios_product.assess(report))
        for patch in [dict(inferenceEvents=[]),dict(route='webgpu'),dict(errors=['failure']),
                      dict(faceLayout=dict(fitsTile=True,fitsViewport=False)),dict(crossOriginIsolated=False)]:
            self.assertFalse(ios_product.assess({**report,**patch}))

    def test_no_handshake_not_success(self):
        for report in [None, {}, {'completed': True}]:
            self.assertFalse(assess(report, 'test'))

    def test_runtime_matches_selected_xcode_sdk(self):
        device = dict(name='iPhone 16', isAvailable=True)
        devices = {'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [device],
                   'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [device]}
        options = simulator_options(devices, '18.5')
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0][0], (18, 5))
        self.assertEqual(simulator_options(devices, '17.0'), [])


if __name__ == '__main__': unittest.main()

"""Registry decisions use plain values; invalid CLI input fails before device access."""
import hashlib
import shutil
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
import threading

import lab


class Journeys(unittest.TestCase):
    def test_known_names_preserve_order(self):
        self.assertEqual(lab.validate_journeys('morph,cold-face,warm-face,operated'),
                         ['morph', 'cold-face', 'warm-face', 'operated'])

    def test_unknown_and_empty_names_refused(self):
        for value in ('', 'cold-face,', 'typo', 'cold-face,typo'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'unknown journey'):
                lab.validate_journeys(value)

    def test_cli_unknown_journey_fails_without_success_report(self):
        result = subprocess.run([sys.executable, str(Path(lab.__file__)), 'run',
                                 '--cell', 'phone-cpu', '--journey', 'typo'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unknown journey', result.stderr)
        self.assertNotIn('journey_done', result.stdout)

    def test_zero_iterations_cannot_report_success(self):
        result = subprocess.run([sys.executable, str(Path(lab.__file__)), 'run',
                                 '--repeat', '0'], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('repeat must be at least 1', result.stderr)
        self.assertNotIn('cell_start', result.stdout)


class MorphAction(unittest.TestCase):
    def test_real_mouse_keeps_morph_target_when_result_buttons_change(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest('real-browser regression requires uv run --with playwright')

        class ReachedVideoWait(Exception):
            """Stop after the real click; this fixture does not pretend to produce a morph."""

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                # Exercise Desktop.tap itself without a device, lab lease or inference runtime.
                dev = lab.Desktop.__new__(lab.Desktop)
                dev.page = browser.new_page()
                dev.page.set_content('''<div style="height:1200px"></div>
                  <button id="result">Save image</button>
                  <button class="next-primary-action" onclick="window.clicked='morph';window.trusted=event.isTrusted">Create morph</button>
                  <button onclick="window.clicked='more'">More options</button>
                  <script>window.clicked=null;window.reordered=false;
                  addEventListener('scroll',()=>{document.querySelector('#result').remove();window.reordered=true;},{once:true});</script>''')
                # The real scroll delivers an asynchronous result-control update before tap's
                # hit probe. Stop at the video wait, preserving its real 1800-second deadline.
                with patch.object(dev, 'wait', side_effect=ReachedVideoWait) as video_wait:
                    with self.assertRaises(ReachedVideoWait):
                        lab.journey_morph(dev)
                self.assertTrue(dev.js('window.reordered'))
                self.assertEqual(dev.js('window.clicked'), 'morph')
                self.assertTrue(dev.js('window.trusted'))
                self.assertTrue(dev.js('window.__labHit.inside'))
                self.assertIn('next-primary-action', dev.js('window.__labHit.what'))
                self.assertEqual(video_wait.call_args.args[1], 1800)
                self.assertIn(lab.S['video'], video_wait.call_args.args[0])
            finally:
                browser.close()


class BudgetDiagnostics(unittest.TestCase):
    """Simulated journey durations exercise actual retention paths without device/browser I/O."""

    def run_timed(self, seconds, cell='eris-webgpu', error=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        out = Path(temporary.name)

        class TraceSink:
            def start(self, **options):
                self.options = options

            def stop(self, path=None):
                self.path = path
                if path:
                    Path(path).write_bytes(b'simulated trace sink')

        class FrameSink:
            def __init__(self):
                self.stop = threading.Event()
                self.started, self.joined = False, False

            def start(self):
                self.started = True

            def join(self, timeout):
                self.joined = True

            def dump(self, folder):
                folder.mkdir()
                (folder / 'last.png').write_bytes(b'simulated buffered frame')
                return str(folder)

        trace, frames, screenshots = TraceSink(), FrameSink(), []

        def screenshot(path):
            screenshots.append(path)
            path.write_bytes(b'simulated screenshot sink')

        dev = SimpleNamespace(ctx=SimpleNamespace(tracing=trace),
                              page=SimpleNamespace(url='https://next.facemorph.me/'),
                              capabilities={'adapter': True}, screenshot=screenshot)
        report = {**Evidence.report(self), 'cell': cell, 'runs': []}
        warm = {'route': 'Ready · this device’s GPU (webgpu).' if cell == 'eris-webgpu'
                else 'Ready · this device’s CPU.', 'url': dev.page.url,
                'documentSha256': 'b' * 64, 'faceS': 3.0}
        args = SimpleNamespace(repeat=1, journey='warm-face', url=dev.page.url, local=True)
        with patch.object(lab.time, 'monotonic', side_effect=[100, 100 + seconds]), \
                patch.object(lab, 'journey_face', return_value=warm, side_effect=error), \
                patch.object(lab, 'ScreenBuffer', return_value=frames), \
                patch.object(lab, 'cool_down', return_value=30), \
                patch.object(lab, 'device_facts', return_value={'batteryTempC': 31}), \
                patch.object(lab, 'chrome_front'):
            lab.run_journeys(dev, args, cell, cell == 'eris-webgpu', out, report)
        return out, report, trace, frames, screenshots

    def test_budget_breach_retains_trace_and_screenshot_without_relabelling_action(self):
        out, report, trace, _, screenshots = self.run_timed(11)
        run = report['runs'][0]
        self.assertTrue(run['ok'], 'the real action-completion field remains distinct from budget verdict')
        self.assertEqual(run['warm']['faceS'], 3.0)
        self.assertNotIn('error', run)
        self.assertNotIn('status', run)
        self.assertEqual(lab.report_findings(report, ['warm-face'], 'a' * 64),
                         ['warm-face took 11.0s on eris-webgpu, over its 10s budget'])
        self.assertEqual(trace.path, str(out / 'eris-webgpu-trace-1.zip'))
        self.assertTrue(Path(trace.path).is_file())
        self.assertEqual(screenshots, [out / 'eris-webgpu-fail-1.png'])
        self.assertTrue(screenshots[0].is_file())

    def test_exact_budget_pass_discards_trace_and_takes_no_failure_screenshot(self):
        out, report, trace, _, screenshots = self.run_timed(10)
        self.assertTrue(report['runs'][0]['ok'])
        self.assertEqual(lab.report_findings(report, ['warm-face'], 'a' * 64), [])
        self.assertIsNone(trace.path)
        self.assertFalse(list(out.glob('*.zip')))
        self.assertEqual(screenshots, [])

    def test_phone_budget_breach_retains_buffered_frames_and_stops_sampler(self):
        out, report, _, frames, screenshots = self.run_timed(46, 'phone-cpu')
        run = report['runs'][0]
        self.assertTrue(run['ok'])
        self.assertEqual(run['startTempC'], 30)
        self.assertEqual(run['batteryTempC'], 31)
        self.assertTrue(frames.started and frames.joined and frames.stop.is_set())
        self.assertEqual(run['frames'], str(out / 'phone-cpu-fail-1-frames'))
        self.assertTrue((Path(run['frames']) / 'last.png').is_file())
        self.assertEqual(screenshots, [out / 'phone-cpu-fail-1.png'])
        self.assertEqual(lab.budget_findings('phone-cpu', [run]),
                         ['warm-face took 46.0s on phone-cpu, over its 45s budget'])

    def test_action_failure_still_retains_existing_diagnostics(self):
        out, report, trace, _, screenshots = self.run_timed(0, error=RuntimeError('actual action failed'))
        run = report['runs'][0]
        self.assertFalse(run['ok'])
        self.assertEqual(run['status'], 'fail')
        self.assertIn('actual action failed', run['error'])
        self.assertEqual(trace.path, str(out / 'eris-webgpu-trace-1.zip'))
        self.assertEqual(screenshots, [out / 'eris-webgpu-fail-1.png'])


class Evidence(unittest.TestCase):
    def report(self):
        return {'cell': 'eris-cpu', 'local': True, 'browser': {'family': 'chrome', 'version': 'Google Chrome 150.0',
                'executable': '/opt/google/chrome/chrome', 'flags': []},
                'artifact': {'digest': 'a' * 64},
                'runs': [{'ok': True, 'warm': {'route': 'Ready · this device’s CPU.',
                    'url': 'https://localhost:8443/', 'documentSha256': 'b' * 64}}]}

    def test_exact_six_named_cells(self):
        self.assertEqual(set(lab.CELLS), {'eris-cpu', 'eris-webgpu', 'eris-firefox-cpu',
                         'eris-firefox-webgpu', 'phone-cpu', 'phone-webgpu'})

    def test_missing_wrong_or_failed_evidence_refused(self):
        self.assertEqual(lab.report_findings(self.report(), ['warm-face'], 'a' * 64), [])
        for field in ('browser', 'artifact', 'runs'):
            report = self.report()
            del report[field]
            self.assertTrue(lab.report_findings(report, ['warm-face']))
        for field, value in [('cell', 'unknown'), ('browser', {'family': 'chromium'}),
                             ('runs', [{'ok': False}])]:
            report = self.report()
            report[field] = value
            self.assertTrue(lab.report_findings(report, ['warm-face']))
        self.assertTrue(lab.report_findings(self.report(), ['warm-face'], 'b' * 64))
        for version in ('Chromium 152.0', 'Google Chrome invented'):
            report = self.report()
            report['browser']['version'] = version
            self.assertTrue(lab.report_findings(report, ['warm-face']))
        report = self.report()
        report['runs'][0]['warm']['route'] = 'Requested WebGPU; fell back to CPU'
        self.assertTrue(lab.report_findings(report, ['warm-face']))
        report['cell'] = 'eris-webgpu'
        self.assertTrue(lab.report_findings(report, ['warm-face']))

    def test_real_chromium_is_not_chrome(self):
        executable = shutil.which('chromium')
        if not executable:
            self.skipTest('system Chromium unavailable')
        with self.assertRaisesRegex(lab.Untested, 'not chrome'):
            lab.browser_identity(executable, 'chrome')

    def test_missing_browser_is_untested(self):
        with self.assertRaises(lab.Untested):
            lab.browser_identity('/no/such/browser', 'chrome')

    def test_unknown_cli_cell_refused_before_browser_io(self):
        result = subprocess.run([sys.executable, lab.__file__, 'matrix', '--cells', 'eris-neon'],
                                text=True, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unknown cell', result.stderr)
        self.assertNotIn('cell_start', result.stdout)

    def test_real_artifact_verifier_rejects_changed_bytes_and_wrong_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            built = root / 'built'
            built.mkdir()
            (built / 'index.html').write_text('<!doctype html><title>lab artifact input</title>')
            artifact = root / 'artifact'
            script = """import {stageBuilt} from './scripts/import/build-next.mjs';
stageBuilt({out:process.argv[1],built:process.argv[2],source:{commit:'a'.repeat(40),
buildId:'test-input',sourceTreeSha256:'b'.repeat(64),sourceTreeClean:true}});"""
            subprocess.run(['node', '--input-type=module', '-e', script, str(artifact), str(built)],
                           cwd=lab.REPO, capture_output=True, text=True, check=True, timeout=30)
            evidence = lab.artifact_evidence(artifact)
            lines = sorted(f"{f['sha256']}  {f['path']}\n" for f in evidence['files'] if f['path'].startswith('deploy-next/'))
            self.assertEqual(evidence['digest'], hashlib.sha256(''.join(lines).encode()).hexdigest())
            with self.assertRaisesRegex(ValueError, 'not expected'):
                lab.artifact_evidence(artifact, '0' * 64)
            site = {'https://x.test/' + p.relative_to(artifact / 'deploy-next').as_posix(): p.read_bytes()
                    for p in (artifact / 'deploy-next').rglob('*') if p.is_file()}
            served = lab.deployed_evidence(artifact, 'https://x.test', evidence['digest'], site.__getitem__)
            self.assertEqual((served['digest'], served['kind']), (evidence['digest'], 'deployed'))
            site['https://x.test/index.html'] = b'the previous build'
            with self.assertRaisesRegex(ValueError, '1 files differ, e.g. index.html'):
                lab.deployed_evidence(artifact, 'https://x.test', None, site.__getitem__)
            (artifact / 'deploy-next/index.html').write_text('different actual bytes')
            with self.assertRaises(subprocess.CalledProcessError):
                lab.artifact_evidence(artifact)


class Registry(unittest.TestCase):
    """journeys.json is the authoritative list; budgets are enforced from it."""

    def test_registry_names_the_runnable_and_pending_journeys(self):
        self.assertEqual(lab.JOURNEYS, {'cold-face', 'warm-face', 'morph', 'operated'})
        for name, entry in lab.REGISTRY.items():
            with self.subTest(name=name):
                self.assertTrue(entry['flow'])
                if not entry['implemented']:
                    self.assertRegex(entry['owner'], r'^fm-')

    def test_pending_journey_refused_with_its_owner(self):
        with self.assertRaisesRegex(ValueError, r'pending journey.*photo-face \(fm-ejwq\)'):
            lab.validate_journeys('warm-face,photo-face')

    def with_budget(self, journey, cell, seconds):
        original = lab.REGISTRY[journey].get('budgetsS', {})
        lab.REGISTRY[journey]['budgetsS'] = {**original, cell: seconds}
        self.addCleanup(lambda: lab.REGISTRY[journey].__setitem__('budgetsS', original))

    def test_over_budget_journey_fails_the_evidence_with_the_breach_named(self):
        self.with_budget('warm-face', 'eris-cpu', 20)
        report = Evidence.report(self)
        report['runs'][0]['durationsS'] = {'warm-face': 19.0}
        self.assertEqual(lab.report_findings(report, ['warm-face'], 'a' * 64), [])
        report['runs'][0]['durationsS'] = {'warm-face': 31.4}
        self.assertEqual(lab.report_findings(report, ['warm-face'], 'a' * 64),
                         ['warm-face took 31.4s on eris-cpu, over its 20s budget'])
        # The budgets were measured on the local destination; a live site's run adds the network download.
        self.assertEqual(lab.report_findings({**report, 'local': False}, ['warm-face'], 'a' * 64), [])

    def test_unregistered_journey_in_a_report_is_named(self):
        report = Evidence.report(self)
        report['runs'][0]['durationsS'] = {'warm-face': 5.0, 'mystery': 1.0}
        self.assertIn('journey mystery is not in the registry',
                      lab.report_findings(report, ['warm-face'], 'a' * 64))

    def test_summary_prints_duration_versus_budget(self):
        self.with_budget('warm-face', 'eris-cpu', 20)
        report = {**Evidence.report(self), 'ok': True}
        warm = {**report['runs'][0]['warm'], 'faceS': 9.0}
        report['runs'] = [{'ok': True, 'warm': warm, 'durationsS': {'warm-face': 12.0}},
                          {'ok': True, 'warm': warm, 'durationsS': {'warm-face': 14.0, 'operated': 3.0}}]
        with tempfile.TemporaryDirectory() as tmp:
            lab.summarise([report], Path(tmp), 'budget check')
            text = (Path(tmp) / 'summary.md').read_text()
        self.assertIn('| eris-cpu | warm-face | 12s/14s | 20s | within budget |', text)
        self.assertIn('| eris-cpu | operated | 3s | – | unbudgeted |', text)


class LocalPort(unittest.TestCase):
    def test_a_live_listener_is_refused_but_time_wait_is_not(self):
        import socket
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(('127.0.0.1', 0))
        server.listen()
        port = server.getsockname()[1]
        self.assertTrue(lab.port_listening(port), 'a live server owns the port')
        # A completed connection closed by the server side leaves TIME-WAIT on the server port.
        client = socket.create_connection(('127.0.0.1', port))
        accepted, _ = server.accept()
        accepted.close()
        client.close()
        server.close()
        self.assertFalse(lab.port_listening(port), 'TIME-WAIT from a finished run is not a listener')


if __name__ == '__main__':
    unittest.main()

"""Registry decisions use plain values; invalid CLI input fails before device access."""
import hashlib
import shutil
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path

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


class Evidence(unittest.TestCase):
    def report(self):
        return {'cell': 'eris-cpu', 'browser': {'family': 'chrome', 'version': 'Google Chrome 150.0',
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
                          {'ok': True, 'warm': warm, 'durationsS': {'warm-face': 14.0, 'morph': 70.0},
                           'morph': {'videoS': 70.0, 'route': 'Ready', 'url': 'https://localhost/'}}]
        with tempfile.TemporaryDirectory() as tmp:
            lab.summarise([report], Path(tmp), 'budget check')
            text = (Path(tmp) / 'summary.md').read_text()
        self.assertIn('| eris-cpu | warm-face | 12s/14s | 20s | within budget |', text)
        self.assertIn('| eris-cpu | morph | 70s | – | unbudgeted |', text)


if __name__ == '__main__':
    unittest.main()

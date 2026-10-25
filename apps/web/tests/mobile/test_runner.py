import copy
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('ios_product',Path(__file__).resolve().parents[2]/'scripts/next-ios-sim.py')
ios_product=importlib.util.module_from_spec(spec);spec.loader.exec_module(ios_product)
import unittest
from run import assess, EXPECTED, simulator_options


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.report = dict(runId='test', completed=True, secureContext=True,
                           inferenceExecuted=False, e4eExecuted=False, evidenceLevel='browser-component',
                           results=[dict(id=name, passed=True) for name in EXPECTED])

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

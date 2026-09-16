import copy
import unittest
from run import assess, EXPECTED


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.report = dict(runId='test', completed=True, secureContext=True,
                           inferenceExecuted=False, e4eExecuted=False, evidenceLevel='browser-component',
                           results=[dict(id=name, passed=True) for name in EXPECTED])

    def test_complete_components_only(self):
        self.assertTrue(assess(self.report, 'test'))

    def test_missing_duplicate_failed_or_stale(self):
        for change in ['missing', 'duplicate', 'failed', 'stale', 'error', 'inference', 'insecure']:
            report = copy.deepcopy(self.report)
            if change == 'missing': report['results'].pop()
            if change == 'duplicate': report['results'][-1] = report['results'][0]
            if change == 'failed': report['results'][0]['passed'] = False
            if change == 'stale': report['runId'] = 'old'
            if change == 'error': report['error'] = 'reset'
            if change == 'inference': report['e4eExecuted'] = True
            if change == 'insecure': report['secureContext'] = False
            self.assertFalse(assess(report, 'test'), change)

    def test_no_handshake_not_success(self):
        for report in [None, {}, {'completed': True}]:
            self.assertFalse(assess(report, 'test'))


if __name__ == '__main__': unittest.main()

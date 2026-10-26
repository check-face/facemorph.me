"""mobile.py (fm-0q4h): a hosted lane report becomes a run.schema.json document; failures and crashes are reliability."""
import json, subprocess, sys, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mobile  # noqa: E402

RUN = {'index': 1, 'side': 'control', 'pair': 0, 'order': 'AB'}
CELL = {'device': 'iPhone 16 Pro', 'os': 'Darwin 24 host', 'browser': 'safari', 'browserVersion': '18.5',
        'provider': 'auto', 'cacheState': 'cold'}
DIGESTS = {'control': 'a' * 64, 'build': 'a' * 64}


def validate(doc):
    """Validates against run.schema.json with the same Ajv the TS test uses."""
    code = ("import Ajv from 'ajv/dist/2020.js'; import { readFileSync } from 'node:fs';"
            "const a = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync('scripts/verify/not-worse/run.schema.json','utf8')));"
            "const ok = a(JSON.parse(process.argv[1])); console.log(JSON.stringify({ ok, errors: a.errors }));")
    out = subprocess.run(['node', '--input-type=module', '-e', code, json.dumps(doc)], cwd=mobile.ROOT,
                         capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else {'ok': None, 'errors': out.stderr[-500:]}


class RunDocument(unittest.TestCase):
    def test_lane_report_records_the_side_digest(self):
        import inspect
        params = list(inspect.signature(mobile.hosted.lane_report).parameters)
        self.assertEqual(params, ['lane', 'kind', 'url', 'extra', 'artifact', 'runtime_sha'],
                         'hosted.lane_report changed shape; side_lane_report must follow it')
        side = str(Path('/tmp/side/deploy-next').resolve())
        r = mobile.side_lane_report({side: 'c' * 64})('l', 'k', 'u', {'browser': 'b'}, '/tmp/side/deploy-next', 'r' * 64)
        self.assertEqual(r['artifact']['treeSha256'], 'c' * 64)
        self.assertEqual((r['lane'], r['runs'], r['browser']), ('l', [], 'b'))

    def test_complete_journeys(self):
        report = {'runs': [{'ok': True, 'cold': {'usableS': 1.5, 'faceS': 25.3}, 'warm': {'faceS': 4.7},
                            'morph': {'videoS': 64.0}}]}
        doc = mobile.run_document(report, RUN, CELL, DIGESTS)
        v = doc['runs'][0]['measures']['values']
        self.assertEqual((v['usablePageMs'], v['coldFaceMs'], v['warmFaceMs'], v['morphPlayableMs']), (1500.0, 25300.0, 4700.0, 64000.0))
        self.assertEqual(v['morphPerFrameMs'], 2000.0)
        self.assertIsNone(v['nextFaceMs'])
        r = doc['runs'][0]['reliability']
        self.assertTrue(r['faceProduced'] and r['videoProduced'] and not r['crash'])
        result = validate(doc)
        if result['ok'] is None:
            self.skipTest('ajv unavailable: ' + str(result['errors']))
        self.assertTrue(result['ok'], result['errors'])

    def test_crash_is_reliability(self):
        report = {'runs': [{'ok': False, 'crashed': True, 'cold': {'usableS': 1, 'faceS': 2}, 'warm': {'faceS': 1},
                            'error': 'PageCrashed: the page process died (often memory pressure) - TargetClosedError'}],
                  'browserErrors': ['RangeError: x']}
        r = mobile.run_document(report, RUN, CELL, DIGESTS)['runs'][0]['reliability']
        self.assertTrue(r['crash'])
        self.assertFalse(r['videoProduced'])
        self.assertEqual(r['uncaughtErrors'], 1)

    def test_browser_version(self):
        self.assertEqual(mobile.browser_version('Mozilla/5.0 (Linux; Android 15) Chrome/131.0.6778.39 Mobile Safari/537.36'), '131.0.6778.39')
        self.assertEqual(mobile.browser_version('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5) Version/18.5 Mobile/15E148 Safari/604.1'), '18.5')


if __name__ == '__main__':
    unittest.main()

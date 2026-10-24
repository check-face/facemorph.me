"""hosted.py (fm-5klw): the summary called with plain values, and the real artifact server on a planted
artifact against the live runtime manifest (python3 -m unittest test_hosted, from this folder; needs network)."""
import hashlib, json, tempfile, unittest, urllib.error, urllib.request
from pathlib import Path

from hosted import ArtifactServer, OriginStorage, manifest_sha, summarise

RUN = {'cold': {'route': 'Ready · this device’s CPU.', 'faceS': 22.2}, 'warm': {'route': 'Ready · this device’s CPU.', 'faceS': 16.7},
       'morph': {'videoS': 57.5}, 'ok': True}


class Summary(unittest.TestCase):
    def test_rows_report_what_ran(self):
        table = summarise([
            {'lane': 'macos-webkit', 'ok': True, 'runs': [RUN], 'userAgent': 'Safari-ish'},
            {'lane': 'windows-msedge', 'ok': False, 'runs': [{'cold': RUN['cold'], 'ok': False, 'error': 'RuntimeError: app error: stopped\nTRY | AGAIN'}]},
        ])
        rows = table.strip().split('\n')
        self.assertEqual(len(rows), 4)
        self.assertIn('| macos-webkit | pass | Ready · this device’s CPU., 22.2 | Ready · this device’s CPU., 16.7 | 57.5 |', rows[2])
        self.assertIn('fail: RuntimeError: app error: stopped TRY / AGAIN', rows[3])
        self.assertIn('| not run | not run |', rows[3])  # warm and morph never ran
        self.assertEqual(rows[3].count('|'), rows[2].count('|'), 'an error message cannot add columns')

    def test_an_expected_lane_without_a_report_fails(self):
        table = summarise([{'lane': 'a', 'ok': True, 'runs': [RUN]}], expect=['a', 'ios-simulator-safari'])
        self.assertIn('| ios-simulator-safari | fail: no report (the lane did not finish) |', table)

    def test_storage_shim_does_only_the_warm_reset(self):
        with self.assertRaises(NotImplementedError):
            OriginStorage(None).send('Storage.clearDataForOrigin', {'origin': 'http://localhost:1', 'storageTypes': 'all'})
        with self.assertRaises(NotImplementedError):
            OriginStorage(None).send('Network.clearBrowserCache', {})


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        (cls.dir / 'art').mkdir()
        (cls.dir / 'art' / 'index.html').write_text('<html><body><p>planted</p></body></html>')
        (cls.dir / 'art' / 'app.0123.js').write_bytes(bytes(range(256)) * 4)
        (cls.dir / 'secret.txt').write_text('outside the artifact')
        cls.posts = []
        cls.sha = manifest_sha()

    def get(self, srv, path, headers=None, method='GET', data=None):
        req = urllib.request.Request(srv.url.rstrip('/') + path, headers=headers or {}, method=method, data=data)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), b''

    def test_serves_the_artifact_with_isolation_headers_ranges_and_the_published_runtime(self):
        inject = lambda html: html.replace('</body>', '<script>/*lane*/</script></body>')
        with ArtifactServer(self.dir / 'art', self.sha, 8797, self.dir / 'cache', inject, self.posts.append) as srv:
            status, headers, body = self.get(srv, '/')
            self.assertEqual(status, 200)
            self.assertEqual((headers['Cross-Origin-Opener-Policy'], headers['Cross-Origin-Embedder-Policy']), ('same-origin', 'require-corp'))
            self.assertIn(b'<script>/*lane*/</script></body>', body)
            status, headers, body = self.get(srv, '/app.0123.js', {'Range': 'bytes=256-511'})
            self.assertEqual((status, headers['Content-Range'], body), (206, 'bytes 256-511/1024', bytes(range(256))))
            self.assertEqual(self.get(srv, '/../secret.txt')[0], 404)
            self.assertEqual(self.get(srv, '/missing.js')[0], 404)
            status, headers, body = self.get(srv, '/runtime/manifest.json')
            self.assertEqual(status, 200)
            self.assertEqual(hashlib.sha256(body).hexdigest(), self.sha)
            self.assertEqual(self.get(srv, '/__lane', {'Content-Type': 'application/json'}, 'POST', json.dumps({'stage': 'cold'}).encode())[0], 200)
            self.assertEqual(self.posts, [{'stage': 'cold'}])

    def test_refuses_a_runtime_other_than_the_pinned_one(self):
        with self.assertRaises(SystemExit) as e:
            with ArtifactServer(self.dir / 'art', '0' * 64, 8798, self.dir / 'cache'):
                pass
        self.assertIn('refusing to measure another runtime', str(e.exception))


if __name__ == '__main__':
    unittest.main()

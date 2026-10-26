"""hosted.py (fm-5klw): the summary called with plain values, and the real artifact server on a planted
artifact against the live runtime manifest (python3 -m unittest test_hosted, from this folder; needs network)."""
import hashlib, json, subprocess, tempfile, unittest, urllib.error, urllib.request
from pathlib import Path

from hosted import lane_report, lab, ArtifactServer, HOSTED_LANES, OriginStorage, hosted_outcomes, manifest_sha, release_reports, runner_unavailable_reason, summarise

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

    def test_unavailable_report_is_explicit_and_not_a_pass(self):
        table = summarise([{'lane': 'ios-simulator-safari', 'status': 'untested', 'reason': 'runtime absent', 'ok': False, 'runs': []}])
        self.assertIn('| untested: runtime absent | not run | not run |', table)
        self.assertIn('| not run | untested |', table, 'no duration or budget is claimed for it')

    def test_duration_versus_budget_for_executed_journeys(self):
        table = summarise([{'lane': 'macos-webkit', 'ok': True, 'runs': [RUN]}])
        self.assertIn('cold-face 22s (unbudgeted); warm-face 17s (unbudgeted); morph 58s (unbudgeted)', table)


class Availability(unittest.TestCase):
    def jobs(self):
        return [{'id': i + 1, 'name': lane, 'status': 'completed', 'conclusion': 'success',
                 'steps': [{'name': 'Journeys', 'conclusion': 'success'}], 'runner_name': 'hosted'}
                for i, lane in enumerate(HOSTED_LANES)]

    def reports(self):
        return [{'lane': lane, 'ok': True, 'runs': [RUN]} for lane in HOSTED_LANES]

    def test_success_requires_every_executed_lane_report(self):
        self.assertEqual({r['status'] for r in hosted_outcomes(self.jobs(), self.reports())}, {'pass'})
        rows = hosted_outcomes(self.jobs(), self.reports()[:-1], queue_expired=True)
        self.assertEqual(rows[-1]['status'], 'fail')
        self.assertIn('missing', rows[-1]['reason'])

    def test_release_requires_the_verified_artifact_commit_and_runtime_in_each_report(self):
        reports = self.reports()
        for report in reports:
            report.update(artifact=dict(digest='a'*64, source=dict(commit='b'*40)), runtimeSha256='c'*64)
        expected = dict(expected_digest='a'*64, expected_commit='b'*40, expected_runtime='c'*64)
        self.assertEqual({r['status'] for r in hosted_outcomes(self.jobs(), reports, **expected)}, {'pass'})
        for field in ['missing-artifact', 'wrong-digest', 'wrong-commit', 'wrong-runtime']:
            changed = json.loads(json.dumps(reports))
            if field == 'missing-artifact': changed[0].pop('artifact')
            if field == 'wrong-digest': changed[0]['artifact']['digest'] = 'd'*64
            if field == 'wrong-commit': changed[0]['artifact']['source']['commit'] = 'd'*40
            if field == 'wrong-runtime': changed[0]['runtimeSha256'] = 'd'*64
            rows = hosted_outcomes(self.jobs(), changed, **expected)
            self.assertEqual(rows[0]['status'], 'fail', field)
            self.assertIn('verified release artifact', rows[0]['reason'])
        jobs = self.jobs()
        jobs[0].update(status='queued', conclusion=None, runner_name='', steps=[])
        self.assertEqual(hosted_outcomes(jobs, [], queue_expired=True, **expected)[0]['status'], 'untested')

    def test_failure_wins_over_passing_or_unavailable_report(self):
        for verdict in ('failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required'):
            jobs = self.jobs()
            jobs[0]['conclusion'] = verdict
            self.assertEqual(hosted_outcomes(jobs, self.reports())[0]['status'], 'fail')
        jobs, reports = self.jobs(), self.reports()
        jobs[0]['steps'][0]['conclusion'] = 'failure'
        reports[0] = {'lane': HOSTED_LANES[0], 'ok': False, 'status': 'untested', 'reason': 'unavailable', 'runs': []}
        self.assertEqual(hosted_outcomes(jobs, reports)[0]['status'], 'fail')

    def test_only_an_unallocated_queued_job_can_expire_as_unavailable(self):
        jobs = self.jobs()
        jobs[0].update(status='queued', conclusion=None, runner_name='', steps=[])
        self.assertEqual(hosted_outcomes(jobs, [])[0]['status'], 'pending')
        self.assertEqual(hosted_outcomes(jobs, [], queue_expired=True)[0]['status'], 'untested')
        jobs[0]['runner_name'] = 'allocated'
        self.assertEqual(hosted_outcomes(jobs, [], queue_expired=True)[0]['status'], 'pending')
        jobs[0].update(status='in_progress', runner_name='')
        self.assertEqual(hosted_outcomes(jobs, [], queue_expired=True)[0]['status'], 'pending')

    def test_no_jobs_remains_unknown_not_runner_unavailability(self):
        self.assertEqual({r['status'] for r in hosted_outcomes([], [], queue_expired=True)}, {'fail'})
        self.assertEqual({r['status'] for r in hosted_outcomes([], [], queue_expired=True, run_completed=True)}, {'fail'})

    def test_missing_simulator_is_untested_but_incomplete_journeys_fail(self):
        reports = self.reports()
        reports[-1] = {'lane': HOSTED_LANES[-1], 'ok': False, 'status': 'untested', 'reason': 'runtime absent', 'runs': []}
        self.assertEqual(hosted_outcomes(self.jobs(), reports)[-1]['status'], 'untested')
        reports[-1]['runs'] = [{'ok': False}]
        self.assertEqual(hosted_outcomes(self.jobs(), reports)[-1]['status'], 'fail')

    def test_duplicate_reports_or_jobs_are_not_success(self):
        self.assertEqual(hosted_outcomes(self.jobs(), self.reports() + self.reports()[:1])[0]['status'], 'fail')
        self.assertEqual(hosted_outcomes(self.jobs() + self.jobs()[:1], self.reports())[0]['status'], 'fail')

    def test_downloaded_artifacts_keep_nested_desktop_and_flat_mobile_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for report in self.reports():
                lane = report['lane']
                folder = root / ('lane-' + lane)
                if lane not in ('android-emulator-chrome', 'ios-simulator-safari'):
                    # Desktop upload also includes test-results/manager-cache, so
                    # upload-artifact preserves the lane/ directory beneath its common root.
                    folder /= 'lane'
                folder.mkdir(parents=True)
                (folder / (lane + '.json')).write_text(json.dumps(report))
            component = root / 'lane-macos-webkit/test-results/manager-cache/webkit'
            component.mkdir(parents=True)
            (component / 'loaded-browser.json').write_text(json.dumps({'ok': True, 'inferenceExecuted': True}))
            (root / 'unrelated.json').write_text(json.dumps(self.reports()[0]))
            reports = release_reports(root)
            self.assertEqual(len(reports), len(HOSTED_LANES))
            self.assertEqual({r['status'] for r in hosted_outcomes(self.jobs(), reports)}, {'pass'})
            duplicate = root / 'lane-macos-webkit/duplicate.json'
            duplicate.write_text(json.dumps(self.reports()[0]))
            self.assertEqual(hosted_outcomes(self.jobs(), release_reports(root))[0]['status'], 'fail')

    def test_terminal_unavailability_needs_provider_evidence_and_no_executed_steps(self):
        jobs = self.jobs()
        jobs[0].update(conclusion='startup_failure', steps=[])
        note = [{'message': 'The runner image macos-13 is no longer supported.'}]
        reason = runner_unavailable_reason(jobs[0], note)
        self.assertIsNotNone(reason)
        self.assertEqual(hosted_outcomes(jobs, [], unavailable={1: reason})[0]['status'], 'untested')
        self.assertIsNone(runner_unavailable_reason(jobs[0], [{'message': 'Runner failed unexpectedly'}]))
        jobs[0]['steps'] = [{'name': 'Journeys', 'conclusion': 'failure'}]
        self.assertIsNone(runner_unavailable_reason(jobs[0], note))
        self.assertEqual(hosted_outcomes(jobs, [], unavailable={1: reason})[0]['status'], 'fail')

    def test_old_job_names_still_match_actual_historical_runs(self):
        jobs = self.jobs()
        jobs[0]['name'] = 'desktop (macos-15, webkit, macos-webkit, webkit)'
        jobs[2]['name'] = 'desktop (macos-15, chrome, macos-chrome)'
        jobs[-2]['name'], jobs[-1]['name'] = 'android', 'ios'
        self.assertEqual({r['status'] for r in hosted_outcomes(jobs, self.reports())}, {'pass'})


class ArtifactIdentity(unittest.TestCase):
    def test_report_uses_real_build_identity_and_refuses_corrupt_bytes_before_browser_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            built = root/'built'
            built.mkdir()
            (built/'index.html').write_text('<!doctype html><title>hosted identity input</title>')
            artifact = root/'artifact'
            script = """import {stageBuilt} from './scripts/import/build-next.mjs';
stageBuilt({out:process.argv[1],built:process.argv[2],source:{commit:'b'.repeat(40),
buildId:'hosted-input',sourceTreeSha256:'c'.repeat(64),sourceTreeClean:true}});"""
            subprocess.run(['node', '--input-type=module', '-e', script, str(artifact), str(built)],
                           cwd=lab.REPO, capture_output=True, text=True, check=True, timeout=30)
            report = lane_report('macos-webkit', 'hosted-desktop', 'http://localhost:1/',
                                 {'browser': 'webkit'}, artifact/'deploy-next', 'd'*64)
            self.assertEqual(report['artifact']['source']['commit'], 'b'*40)
            self.assertEqual(report['runtimeSha256'], 'd'*64)
            files = sorted(p for p in (artifact/'deploy-next').rglob('*') if p.is_file())
            listing = ''.join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(artifact/'deploy-next').as_posix()}\n" for p in files)
            self.assertEqual(report['artifact']['digest'], hashlib.sha256(listing.encode()).hexdigest())
            (artifact/'deploy-next/index.html').write_text('actually corrupted bytes')
            with self.assertRaises(subprocess.CalledProcessError):
                lane_report('macos-webkit', 'hosted-desktop', 'http://localhost:1/',
                            {'browser': 'webkit'}, artifact, 'd'*64)


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

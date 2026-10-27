"""hosted.py (fm-5klw): the summary called with plain values, and the real artifact server on a planted
artifact against the live runtime manifest (python3 -m unittest test_hosted, from this folder; needs network)."""
import hashlib, json, os, subprocess, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from hosted import IOS_JOURNEYS, IOS_POST, IosAttempt, ios_reset_page, ios_script, ios_simulator, observe_request_failures, AndroidChrome, lane_report, lab, ArtifactServer, HOSTED_LANES, OriginStorage, dispatch_inputs, hosted_outcomes, manifest_sha, release_reports, runner_unavailable_reason, summarise

RUN = {'cold': {'route': 'Ready · this device’s CPU.', 'faceS': 22.2}, 'warm': {'route': 'Ready · this device’s CPU.', 'faceS': 16.7},
       'morph': {'videoS': 57.5}, 'ok': True}


class AndroidKeyboard(unittest.TestCase):
    def device(self, state):
        dev = AndroidChrome.__new__(AndroidChrome)
        dev.adb = Mock(return_value=state)
        dev.js = Mock(return_value='the actual field')
        dev.page = SimpleNamespace(wait_for_function=Mock())
        return dev

    def test_visible_keyboard_is_hidden_before_reading_final_field(self):
        dev = self.device('  mInputShown=true\n  mIsInputViewShown=true')
        with patch.object(lab.Desktop, 'type_into') as typed:
            self.assertEqual(dev.type_into('input', 'word', 2), 'the actual field')
        typed.assert_called_once_with('input', 'word', 2)
        self.assertEqual(dev.adb.call_args_list[-1].args, ('shell', 'input', 'keyevent', '4'))
        dev.page.wait_for_function.assert_called_once()
        self.assertEqual(dev.page.wait_for_function.call_args.kwargs, dict(timeout=8000, polling=100))
        self.assertIn('visualViewport.height-innerHeight', dev.page.wait_for_function.call_args.args[0])
        dev.js.assert_called_once_with("([s,i])=>document.querySelectorAll(s)[i].value", ['input', 2])

    def test_hidden_keyboard_never_sends_back_even_if_input_view_remains(self):
        dev = self.device('  mInputShown=false\n  mIsInputViewShown=true')
        with patch.object(lab.Desktop, 'type_into'):
            dev.type_into('input', 'word')
        dev.adb.assert_called_once_with('shell', 'dumpsys', 'input_method')
        dev.page.wait_for_function.assert_not_called()

    def test_unsettled_viewport_fails_without_continuing_the_journey(self):
        dev = self.device('  mInputShown=true')
        dev.page.wait_for_function.side_effect = TimeoutError('keyboard did not settle')
        with patch.object(lab.Desktop, 'type_into'), self.assertRaisesRegex(TimeoutError, 'keyboard did not settle'):
            dev.type_into('input', 'word')
        dev.js.assert_not_called()


class RequestFailures(unittest.TestCase):
    def test_observation_is_bounded_and_removes_query_and_fragment(self):
        dev = SimpleNamespace(page=Mock())
        observe_request_failures(dev)
        event, callback = dev.page.on.call_args.args
        self.assertEqual(event, 'requestfailed')
        request = SimpleNamespace(url='https://models.example/weights.bin?secret=value#part',
                                  failure='net::ERR_CONNECTION_RESET', resource_type='fetch')
        for _ in range(45):
            callback(request)
        self.assertEqual(len(dev.request_failures), 40)
        self.assertEqual(dev.request_failures[0], dict(url='https://models.example/weights.bin',
                         failure='net::ERR_CONNECTION_RESET', resourceType='fetch'))

    def test_android_exposes_its_actual_context_for_failure_tracing(self):
        pw = Mock()
        ctx = SimpleNamespace(pages=[Mock()], new_cdp_session=Mock())
        pw.chromium.connect_over_cdp.return_value.contexts = [ctx]
        with patch('hosted.subprocess.run', return_value=SimpleNamespace(stdout='chrome_devtools_remote')):
            dev = AndroidChrome(pw, 8791)
        self.assertIs(dev.ctx, ctx)
        self.assertIs(dev.ctx, dev.context)
        self.assertTrue(any(c.args[0] == 'requestfailed' for c in dev.page.on.call_args_list))


class IosProtocol(unittest.TestCase):
    def setUp(self):
        self.report = {}
        self.attempt = IosAttempt('current', self.report)

    def post(self, **body):
        return self.attempt.post(dict(attempt='current', **body))

    def test_stale_reports_cannot_advance_or_finish_current_attempt(self):
        self.assertFalse(self.attempt.post(dict(attempt='old', stage='cold', ok=True, result={})))
        self.assertEqual(self.attempt.stages, [])
        self.assertFalse(self.attempt.done.is_set())

    def test_ordered_three_journeys_are_required(self):
        self.assertTrue(self.post(event='start', stage='cold', userAgent='real browser'))
        self.assertTrue(self.post(stage='cold', ok=True, result=RUN['cold']))
        self.assertFalse(self.attempt.done.is_set())
        self.assertTrue(self.post(event='start', stage='warm'))
        self.assertTrue(self.post(stage='warm', ok=True, result=RUN['warm']))
        self.assertFalse(self.attempt.done.is_set())
        self.assertTrue(self.post(stage='morph', ok=True, result=RUN['morph'], done=True))
        self.assertTrue(self.attempt.done.is_set())
        self.assertEqual([s['stage'] for s in self.attempt.stages], ['cold', 'warm', 'morph'])

    def test_reopened_cold_page_fails_instead_of_measuring_a_partially_warm_visit(self):
        self.assertTrue(self.post(event='start', stage='cold'))
        self.assertFalse(self.post(event='start', stage='cold'))
        self.assertTrue(self.attempt.done.is_set())
        self.assertIn('protocol violation', self.attempt.rec['error'])
        self.assertFalse(self.post(stage='cold', ok=True, result=RUN['cold']))
        self.assertNotIn('cold', self.attempt.rec)

    def test_the_first_violation_is_kept_with_every_later_one(self):
        self.post(event='start', stage='cold', navigation='navigate')
        self.assertFalse(self.post(event='start', stage='cold', navigation='reload'))
        self.assertFalse(self.post(stage='cold', ok=False, error='journey report rejected: HTTP 409'))
        self.assertEqual(self.attempt.rec['error'], 'journey protocol violation: unexpected start cold')
        self.assertEqual([(v['event'], v['navigation'], v['error']) for v in self.attempt.rec['violations']],
                         [('start', 'reload', None), ('result', None, 'journey report rejected: HTTP 409')])

    def test_missing_cold_or_unstarted_results_fail(self):
        self.assertFalse(self.post(stage='cold', ok=True, result={}))
        attempt = IosAttempt('current', {})
        self.assertFalse(attempt.post(dict(attempt='current', event='start', stage='warm')))
        self.assertTrue(attempt.done.is_set())

    def test_reset_failure_after_cold_is_a_real_failure_without_warm_visit(self):
        self.post(event='start', stage='cold')
        self.post(stage='cold', ok=True, result=RUN['cold'])
        self.assertTrue(self.post(stage='warm', ok=False, error='warm reset blocked: session', done=True))
        self.assertTrue(self.attempt.done.is_set())
        self.assertIn('warm reset blocked', self.attempt.rec['error'])
        self.assertNotIn('warm', self.attempt.rec)

    def test_post_rejects_non_2xx_and_transport_failure(self):
        script = """import assert from 'node:assert/strict';
const ATTEMPT='current', post=eval('('+process.argv[1]+')');
let sent;
globalThis.fetch=async (_url, options)=>{sent=JSON.parse(options.body);return {ok:false,status:409}};
await assert.rejects(post({stage:'cold'}), /HTTP 409/);
assert.deepEqual(sent,{stage:'cold',attempt:'current'});
globalThis.fetch=async ()=>{throw Error('network failed')};
await assert.rejects(post({stage:'cold'}), /network failed/);
globalThis.fetch=async ()=>({ok:true,status:200});
await post({stage:'cold'});
"""
        subprocess.run(['node', '--input-type=module', '-e', script, IOS_POST], check=True, capture_output=True, text=True, timeout=10)

    def test_reset_database_error_reports_failure_without_advancing_or_clearing_models(self):
        script = """import assert from 'node:assert/strict';
import vm from 'node:vm';
let stage='reset', posted, cleared=false, navigated=false;
const context={AbortController,setTimeout,clearTimeout,
  sessionStorage:{getItem:()=>stage,setItem:(_key,value)=>{stage=value}},
  localStorage:{clear:()=>{cleared=true}},
  indexedDB:{databases:async()=>[{name:'session'}],deleteDatabase:()=>{
    const q={error:Error('native deletion failed')};queueMicrotask(()=>q.onerror());return q}},
  fetch:async(_url,options)=>{posted=JSON.parse(options.body);return {ok:true}},
  location:{replace:()=>{navigated=true}}};
await vm.runInNewContext(process.argv[1],context);
assert.equal(stage,'reset');assert.equal(cleared,false);assert.equal(navigated,false);
assert.equal(posted.ok,false);assert.match(posted.error,/native deletion failed/);
assert.equal(posted.stage,'warm');assert.equal(posted.attempt,'current');
"""
        source = ios_reset_page('current').split('<script>', 1)[1].split('</script>', 1)[0]
        subprocess.run(['node', '--input-type=module', '-e', script, source], check=True, capture_output=True, text=True, timeout=10)


class IosSimulatorOwnership(unittest.TestCase):
    def simulator(self, fail=None):
        devices = {'devices': {'runtime-ios-18': [{'name': 'iPhone 16 Pro', 'udid': 'existing-user-device',
                                                 'deviceTypeIdentifier': 'device-type-16-pro'}]}}
        def command(*args, **kwargs):
            if args[0] == fail:
                raise RuntimeError('injected ' + fail + ' failure')
            return SimpleNamespace(stdout=json.dumps(devices) if args[0] == 'list' else 'owned-simulator\n')
        return Mock(side_effect=command)

    def test_fresh_device_uses_selected_type_and_runtime_and_only_owned_cleanup(self):
        sim = self.simulator()
        with ios_simulator(sim, 'iPhone 16 Pro', 'token') as udid:
            self.assertEqual(udid, 'owned-simulator')
        sim.assert_any_call('create', 'FaceMorph-Hosted-token', 'device-type-16-pro', 'runtime-ios-18')
        self.assertEqual(sim.call_args_list[-2].args, ('shutdown', 'owned-simulator'))
        self.assertEqual(sim.call_args_list[-1].args, ('delete', 'owned-simulator'))
        self.assertFalse(any('existing-user-device' in c.args for c in sim.call_args_list))

    def test_setup_and_journey_failures_still_delete_owned_device(self):
        for fail in ['boot', 'bootstatus', 'journey', 'shutdown']:
            with self.subTest(fail=fail):
                sim = self.simulator(fail)
                with self.assertRaisesRegex(RuntimeError, fail):
                    with ios_simulator(sim, 'iPhone 16 Pro', 'token'):
                        raise RuntimeError('injected journey failure')
                self.assertEqual(sim.call_args_list[-1].args, ('delete', 'owned-simulator'))

    def test_missing_device_has_no_setup_or_cleanup_side_effects(self):
        sim = self.simulator()
        with ios_simulator(sim, 'missing device', 'token') as udid:
            self.assertIsNone(udid)
        self.assertEqual(len(sim.call_args_list), 1)

    def test_failed_creation_does_not_delete_an_existing_device(self):
        sim = self.simulator('create')
        with self.assertRaisesRegex(RuntimeError, 'create'):
            with ios_simulator(sim, 'iPhone 16 Pro', 'token'):
                self.fail('failed creation cannot yield a Simulator')
        self.assertFalse(any(c.args[0] in ('shutdown', 'delete') for c in sim.call_args_list))


@unittest.skipUnless(os.environ.get('LAB_REAL_BROWSERS') == '1', 'opt-in real browser storage/lifecycle checks')
class IosBrowserLifecycle(unittest.TestCase):
    def test_reset_keeps_model_storage_and_fails_on_an_actual_blocked_database(self):
        from playwright.sync_api import sync_playwright
        with tempfile.TemporaryDirectory() as tmp, patch('hosted.manifest_sha', return_value='a'*64), sync_playwright() as pw:
            root = Path(tmp)
            (root / 'index.html').write_text('<!doctype html><title>app-free test landing</title>')
            posts = []
            with ArtifactServer(root, 'a'*64, 0, root/'cache', on_post=posts.append,
                                pages={'/__lane-reset': ios_reset_page('current')}) as srv:
                origin = f'http://127.0.0.1:{srv.httpd.server_port}'
                for engine in ['chromium', 'firefox']:
                    with self.subTest(engine=engine):
                        browser = getattr(pw, engine).launch()
                        try:
                            context = browser.new_context()
                            page = context.new_page()
                            page.goto(origin)
                            page.evaluate("""async () => {
                              sessionStorage.setItem('__laneStage:current','reset');
                              localStorage.setItem('saved-session','present');
                              await new Promise((done,fail)=>{const q=indexedDB.open('session',1);
                                q.onsuccess=()=>{q.result.close();done()};q.onerror=()=>fail(q.error)});
                              await caches.open('model');
                              const root=await navigator.storage.getDirectory();
                              await root.getFileHandle('model',{create:true});
                            }""")
                            page.goto(origin+'/__lane-reset?attempt=current')
                            page.wait_for_url(origin+'/?attempt=current')
                            state = page.evaluate("""async () => ({stage:sessionStorage.getItem('__laneStage:current'),
                              local:localStorage.length, databases:(await indexedDB.databases()).map(d=>d.name),
                              caches:await caches.keys(), files:await Array.fromAsync((await navigator.storage.getDirectory()).keys())})""")
                            self.assertEqual(state, dict(stage='warm', local=0, databases=[], caches=['model'], files=['model']))
                            blocker = context.new_page()
                            blocker.goto(origin)
                            blocker.evaluate("""() => new Promise(done=>{const q=indexedDB.open('blocked',1);
                              q.onsuccess=()=>{window.held=q.result;done()}})""")
                            page.evaluate("sessionStorage.setItem('__laneStage:current','reset')")
                            n = len(posts)
                            page.goto(origin+'/__lane-reset?attempt=current')
                            deadline = time.monotonic()+10
                            while len(posts) == n and time.monotonic() < deadline:
                                page.wait_for_timeout(50)
                            self.assertGreater(len(posts), n)
                            self.assertEqual(posts[-1]['attempt'], 'current')
                            self.assertFalse(posts[-1]['ok'])
                            self.assertIn('warm reset blocked', posts[-1]['error'])
                            self.assertEqual(page.evaluate("sessionStorage.getItem('__laneStage:current')"), 'reset')
                        finally:
                            browser.close()

    def test_rejected_cold_report_cannot_advance_to_reset_or_warm(self):
        from playwright.sync_api import sync_playwright
        with tempfile.TemporaryDirectory() as tmp, patch('hosted.manifest_sha', return_value='a'*64), sync_playwright() as pw:
            root = Path(tmp)
            (root/'index.html').write_text("""<!doctype html><body><div class='next-product' data-next-busy='false'>
              <div class='next-face'><input type='text'><button class='next-face-generate' onclick="const c=document.createElement('canvas');c.width=1024;c.dataset.faceDrawn='true';document.querySelector('.next-face-image').append(c)">Generate</button>
              <div class='next-face-image'></div></div></div></body>""")
            posts = []
            def receive(body):
                posts.append(body)
                return not (body.get('stage') == 'cold' and body.get('ok') is True)
            inject = lambda html: html.replace('</body>', ios_script(IOS_JOURNEYS, 'current')+'</body>')
            with ArtifactServer(root, 'a'*64, 0, root/'cache', inject=inject, on_post=receive) as srv:
                browser = pw.chromium.launch()
                try:
                    page = browser.new_page()
                    page.goto(f'http://localhost:{srv.httpd.server_port}/?attempt=current')
                    deadline = time.monotonic()+10
                    while not any(p.get('ok') is False for p in posts) and time.monotonic() < deadline:
                        page.wait_for_timeout(50)
                    self.assertTrue(any(p.get('ok') is False and 'HTTP 409' in p['error'] for p in posts), posts)
                    self.assertEqual(page.evaluate("sessionStorage.getItem('__laneStage:current')"), None)
                    self.assertFalse(any(p.get('stage') in ('warm', 'morph') for p in posts))
                    self.assertNotIn('/__lane-reset', page.url)
                finally:
                    browser.close()


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


class Dispatch(unittest.TestCase):
    def test_only_declared_hosted_inputs_are_dispatched(self):
        caller = {'target': 'staging', 'artifact_source_repo_id': '1413979666', 'artifact_workflow': '.github/workflows/main.yml',
                  'artifact_commit': 'a' * 40, 'artifact_run': '40302561246', 'artifact_name': 'next-site-x', 'runtime_sha': 'd9e3'}
        sent = dispatch_inputs(caller)
        self.assertNotIn('target', sent)
        self.assertEqual(set(sent), set(caller) - {'target'})

    def test_missing_artifact_input_refuses_before_dispatch(self):
        with self.assertRaises(SystemExit):
            dispatch_inputs({'artifact_name': 'next-site-x'})


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

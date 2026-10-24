"""Device lease tests: decisions with plain values; everything else with real processes, real flocks,
classic's real run.py at its pinned revision and the device lab's real lab_lock.

  python3 autoresearch/test_lease.py

The classic cases need a classic checkout (CLASSIC_CHECKOUT, default ../facemorph.me-classic) that
contains the pinned revision; without one they are reported skipped, i.e. untested.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import lease  # noqa: E402

RUN = HERE / 'run.py'
LAB = REPO / 'tools' / 'device-lab'
CLASSIC_PINNED = 'b2d945a8c7f0ff9f382fbfefaecc2651943077a3'
HOST = lease.host()
PHONE = 'p30pro'


class Decisions(unittest.TestCase):
    def test_state_dir_order_flag_then_environment_then_config(self):
        config = {'stateDir': '/srv/lease'}
        self.assertEqual(lease.resolve_state_dir('/srv/lease/', {lease.STATE_DIR_ENV: '/srv/lease'}, config), Path('/srv/lease'))
        self.assertEqual(lease.resolve_state_dir(None, {lease.STATE_DIR_ENV: '/a'}, {}), Path('/a'))
        self.assertEqual(lease.resolve_state_dir('/b', {lease.STATE_DIR_ENV: '/a'}, {}), Path('/b'))
        self.assertEqual(lease.resolve_state_dir(None, {}, config), Path('/srv/lease'))

    def test_state_dir_refusals(self):
        with self.assertRaisesRegex(lease.Refused, 'no lease directory'):
            lease.resolve_state_dir(None, {}, {})
        with self.assertRaisesRegex(lease.Refused, 'not absolute'):
            lease.resolve_state_dir('autoresearch/state', {}, {})
        with self.assertRaisesRegex(lease.Refused, 'not absolute'):
            lease.resolve_state_dir(None, {}, {'stateDir': 'state'})
        with self.assertRaisesRegex(lease.Refused, "not this machine's lease directory"):
            lease.resolve_state_dir('/elsewhere', {}, {'stateDir': '/srv/lease'})
        with self.assertRaisesRegex(lease.Refused, "not this machine's lease directory"):
            lease.resolve_state_dir(None, {lease.STATE_DIR_ENV: '/elsewhere'}, {'stateDir': '/srv/lease'})

    def test_devices_this_host_may_lease(self):
        config = {'devices': ['eris', 'p30pro']}
        lease.check_device('eris', 'eris', config)
        lease.check_device('p30pro', 'eris', config)
        lease.check_device('triton', 'triton', {})
        with self.assertRaisesRegex(lease.Refused, 'neither this machine'):
            lease.check_device('triton', 'eris', config)
        with self.assertRaisesRegex(lease.Refused, 'neither this machine'):
            lease.check_device('p30pro', 'triton', {})
        with self.assertRaisesRegex(lease.Refused, 'unsafe device name'):
            lease.check_device('../eris', 'eris', {'devices': ['../eris']})

    def test_enclosing_lease(self):
        chain = [(300, 9), (200, 7), (100, 5)]
        held = {'device': 'eris', 'pid': 200, 'start': 7}
        self.assertEqual(lease.enclosing_lease({}, chain, [held]), held)
        # A reused pid with another start time is not the holder.
        self.assertIsNone(lease.enclosing_lease({}, chain, [dict(held, start=8)]))
        self.assertIsNone(lease.enclosing_lease({}, chain, []))
        self.assertEqual(lease.enclosing_lease({lease.HELD_ENV: 'eris'}, chain, [])['device'], 'eris')
        self.assertIsNone(lease.enclosing_lease({lease.HELD_ENV: ''}, chain, []))

    def test_held_by_ancestor(self):
        chain = [(300, 9), (200, 7)]
        holders = [{'device': 'eris', 'pid': 200, 'start': 7}, {'device': 'p30pro', 'pid': 999, 'start': 1}]
        self.assertTrue(lease.held_by_ancestor('eris', chain, holders))
        self.assertFalse(lease.held_by_ancestor('p30pro', chain, holders))
        self.assertFalse(lease.held_by_ancestor('triton', chain, holders))

    def test_describe(self):
        self.assertIn('no holder record', lease.describe(None))
        text = lease.describe({'holder': 'run.py', 'run': 'r1', 'lane': 'build', 'pid': 4, 'since': 'now', 'repo': '/r'})
        self.assertEqual(text, 'held by run.py, r1, lane build, pid 4, since now, /r')


def wait_for(predicate, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def alive(pid):
    """True while pid is a live (non-zombie) process."""
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[0] != 'Z'
    except OSError:
        return False


class Machine(unittest.TestCase):
    """A temporary machine lease directory named by a planted lease config file (an input, not a
    fake), and an environment cleared of any lease these tests themselves might run under."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='lease-test-'))
        self.state = self.tmp / 'lease'
        self.config = self.tmp / 'lease.json'
        self.config.write_text(json.dumps({'stateDir': str(self.state), 'devices': [HOST, PHONE]}))
        self.env = {k: v for k, v in os.environ.items() if k not in (lease.STATE_DIR_ENV, lease.HELD_ENV)}
        self.env[lease.CONFIG_ENV] = str(self.config)
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)  # both runners, classic's too, clean up their command's group
                try:
                    p.wait(15)
                except subprocess.TimeoutExpired:
                    p.kill()
            p.communicate()
        subprocess.run(['rm', '-rf', str(self.tmp)], check=True)

    def run_py(self, *args, device=HOST, env=None, timeout=60):
        return subprocess.run([sys.executable, str(RUN), '--lane', 'build', '--device', device, *args],
                              env=env or self.env, capture_output=True, text=True, timeout=timeout)

    def start(self, argv, env=None):
        p = subprocess.Popen(argv, env=env or self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(p)
        return p

    def hold_with_run_py(self, seconds, device=HOST):
        p = self.start([sys.executable, str(RUN), '--lane', 'build', '--device', device, '--', 'sleep', str(seconds)])
        self.assertTrue(wait_for(lambda: lease.live_holder(self.state, device)), 'holder never took the lease')
        return p

    def journal(self):
        return [json.loads(line) for line in (self.state / 'runs.jsonl').read_text().splitlines()]


class Runner(Machine):
    def test_runs_and_journals_like_classic(self):
        r = self.run_py('--', sys.executable, '-c', 'import os; print(os.environ["FACEMORPH_LEASE_HELD"], os.environ["FACEMORPH_LEASE_DIR"])')
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out['status'], 'completed')
        self.assertEqual((Path(out['run']) / 'output.log').read_text().split(), [HOST, str(self.state)])
        [record] = self.journal()
        self.assertEqual((record['status'], record['exit_code'], record['device'], record['host']), ('completed', 0, HOST, HOST))
        self.assertEqual(record['qualification'], 'not_evaluated')
        self.assertFalse(lease.holder_path(self.state, HOST).exists(), 'holder record left behind')

    def test_busy_without_wait_exits_75(self):
        holder = self.hold_with_run_py(30)
        t0 = time.monotonic()
        r = self.run_py('--', 'true')
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertLess(time.monotonic() - t0, 5)
        self.assertIn('Device busy; no experiment started.', r.stderr)
        self.assertIn('held by run.py', r.stderr)
        self.assertIn(f'pid {holder.pid}', r.stderr)
        self.assertEqual(len(list(self.state.glob('*Z-*'))), 1, 'the busy run started something')

    def test_bounded_wait_acquires(self):
        self.hold_with_run_py(1.5)
        r = self.run_py('--wait', '30', '--', 'true')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('Waiting for', r.stderr)
        self.assertEqual([x['status'] for x in self.journal()], ['completed', 'completed'])

    def test_bounded_wait_gives_up(self):
        self.hold_with_run_py(30)
        t0 = time.monotonic()
        r = self.run_py('--wait', '1', '--', 'true')
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertGreaterEqual(time.monotonic() - t0, 1)
        self.assertLess(time.monotonic() - t0, 10)

    def test_nested_lease_refused(self):
        inner = [sys.executable, str(RUN), '--lane', 'build', '--device']
        for device in (HOST, PHONE):  # the same device would wait on itself; another double-books
            r = self.run_py('--', *inner, device, '--', 'true')
            self.assertEqual(r.returncode, 2, r.stderr)
            log = (Path(json.loads(r.stdout)['run']) / 'output.log').read_text()
            self.assertIn('already holds the', log)
        # A nested run that clears its environment is still found through its ancestry.
        r = self.run_py('--', 'env', '-i', f'{lease.CONFIG_ENV}={self.config}', sys.executable, str(RUN),
                        '--lane', 'build', '--device', HOST, '--state-dir', str(self.state), '--', 'true')
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('already holds the', (Path(json.loads(r.stdout)['run']) / 'output.log').read_text())

    def test_device_other_than_this_host_refused(self):
        r = self.run_py('--', 'true', device='not-' + HOST)
        self.assertEqual(r.returncode, 2)
        self.assertIn('neither this machine', r.stderr)
        self.config.write_text(json.dumps({'stateDir': str(self.state)}))
        r = self.run_py('--', 'true', device=PHONE)  # not attached here
        self.assertEqual(r.returncode, 2)
        self.assertIn('neither this machine', r.stderr)
        self.assertFalse(self.state.exists(), 'a refused run touched the lease directory')

    def test_lease_directory_refusals(self):
        r = self.run_py('--state-dir', 'relative/state', '--', 'true')
        self.assertEqual(r.returncode, 2)
        self.assertIn('not absolute', r.stderr)
        r = self.run_py('--state-dir', str(self.tmp / 'other'), '--', 'true')
        self.assertEqual(r.returncode, 2)
        self.assertIn("not this machine's lease directory", r.stderr)
        env = dict(self.env, **{lease.CONFIG_ENV: str(self.tmp / 'absent.json')})
        r = self.run_py('--', 'true', env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn('no lease directory is configured', r.stderr)

    def test_budget_limits(self):
        for args in (['--timeout', '3601'], ['--timeout', '0'], ['--wait', '3601'], []):
            r = self.run_py(*args, *([] if not args else ['--', 'true']))
            self.assertEqual(r.returncode, 2, args)

    def test_timeout_cleans_up_the_owned_process_group(self):
        pid_file = self.tmp / 'worker.pid'
        # The worker ignores SIGTERM, so only the SIGKILL after the grace period ends it.
        script = f'trap "" TERM; sleep 300 & echo $! > {pid_file}; wait'
        t0 = time.monotonic()
        r = self.run_py('--timeout', '1', '--', 'sh', '-c', script)
        self.assertEqual(r.returncode, 124, r.stderr)
        self.assertGreater(time.monotonic() - t0, 1)
        worker = int(pid_file.read_text())
        self.assertTrue(wait_for(lambda: not alive(worker), 5), 'worker survived the timeout')
        self.assertEqual(self.journal()[-1]['status'], 'timeout')
        self.assertEqual(self.run_py('--', 'true').returncode, 0, 'lease not released')

    def test_workers_outliving_the_command_are_reaped(self):
        pid_file = self.tmp / 'worker.pid'
        r = self.run_py('--', 'sh', '-c', f'sleep 300 & echo $! > {pid_file}')
        self.assertEqual(r.returncode, 0, r.stderr)
        worker = int(pid_file.read_text())
        self.assertTrue(wait_for(lambda: not alive(worker), 5), 'worker outlived the run')

    def test_sigterm_to_the_runner_cleans_up_and_releases(self):
        pid_file = self.tmp / 'worker.pid'
        runner = self.start([sys.executable, str(RUN), '--lane', 'build', '--device', HOST, '--',
                             'sh', '-c', f'sleep 300 & echo $! > {pid_file}; wait'])
        self.assertTrue(wait_for(lambda: pid_file.exists() and pid_file.read_text().strip()), 'command never started')
        worker = int(pid_file.read_text())
        runner.send_signal(signal.SIGTERM)
        self.assertEqual(runner.wait(30), 128 + signal.SIGTERM)
        self.assertTrue(wait_for(lambda: not alive(worker), 5), 'worker survived SIGTERM to the runner')
        self.assertEqual(self.journal()[-1]['status'], 'interrupted')
        self.assertEqual(self.run_py('--', 'true').returncode, 0, 'lease not released')


def classic_run_py(dest):
    """classic's autoresearch/run.py at the pinned revision: (path, None), or (None, why not)."""
    checkout = Path(os.environ.get('CLASSIC_CHECKOUT', REPO.parent / 'facemorph.me-classic'))
    head = subprocess.run(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    if head.stdout.strip() == CLASSIC_PINNED:  # CI checks out exactly the pinned revision
        source = (checkout / 'autoresearch' / 'run.py').read_text()
    else:
        r = subprocess.run(['git', '-C', str(checkout), 'show', f'{CLASSIC_PINNED}:autoresearch/run.py'],
                           capture_output=True, text=True)
        if r.returncode:
            return None, f'{checkout}: {(r.stderr or head.stderr).strip()}'
        source = r.stdout
    path = dest / 'classic' / 'autoresearch' / 'run.py'
    path.parent.mkdir(parents=True)
    path.write_text(source)
    return path, None


class CrossRepo(Machine):
    """This repository's run.py and classic's, on one machine with its one lease directory (classic
    invocations pass it as --state-dir; ops/lease/README.md)."""

    def setUp(self):
        super().setUp()
        self.classic, why = classic_run_py(self.tmp)
        if not self.classic:
            self.skipTest(f'untested: no classic checkout with {CLASSIC_PINNED[:8]} (set CLASSIC_CHECKOUT): {why}')

    def classic_argv(self, *args):
        return [sys.executable, str(self.classic), '--lane', 'build', '--device', HOST,
                '--state-dir', str(self.state), *args]

    def test_classic_waits_or_is_busy_behind_this_repository(self):
        self.hold_with_run_py(30)
        r = subprocess.run(self.classic_argv('--', 'true'), env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertIn('Device busy', r.stderr)
        t0 = time.monotonic()
        r = subprocess.run(self.classic_argv('--wait', '1', '--', 'true'), env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertLess(time.monotonic() - t0, 10)

    def test_this_repository_waits_or_is_busy_behind_classic(self):
        self.start(self.classic_argv('--', 'sleep', '30'))
        self.assertTrue(wait_for(lambda: any(p.is_dir() for p in self.state.glob('*Z-*'))), 'classic never started')
        r = self.run_py('--', 'true')
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertIn('no holder record', r.stderr)
        t0 = time.monotonic()
        r = self.run_py('--wait', '1', '--', 'true')
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertLess(time.monotonic() - t0, 10)

    def test_either_direction_acquires_within_the_bound(self):
        self.hold_with_run_py(1.5)
        r = subprocess.run(self.classic_argv('--wait', '30', '--', 'true'), env=self.env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.start(self.classic_argv('--', 'sleep', '1.5'))
        self.assertTrue(wait_for(lambda: len(list(self.state.glob('*Z-*'))) == 3), 'classic never started')
        r = self.run_py('--wait', '30', '--', 'true')
        self.assertEqual(r.returncode, 0, r.stderr)
        # One shared journal: every run, from either repository, completed in turn.
        self.assertEqual([x['status'] for x in self.journal()], ['completed'] * 4)


LAB_SESSION = """
import json, sys, time
sys.path.insert(0, sys.argv[1])
import lab
with lab.lab_lock(sys.argv[2].split(',')) as devices:
    print(json.dumps({'event': 'held', 'devices': devices}), flush=True)
    time.sleep(float(sys.argv[3]))
    print(json.dumps({'event': 'leaving', 'time': time.time()}), flush=True)
"""


class DeviceLab(Machine):
    """The real lab_lock against leased research runs (desktop cells lease this machine)."""

    def setUp(self):
        super().setUp()
        self.env['LAB_STATE'] = str(self.tmp / 'lab' / 'session.json')

    def lab_argv(self, cells, seconds):
        return [sys.executable, '-c', LAB_SESSION, str(LAB), cells, str(seconds)]

    @staticmethod
    def events(text):
        return [json.loads(line) for line in text.splitlines() if line.startswith('{')]

    def test_lab_waits_then_gives_up_behind_a_research_run(self):
        self.hold_with_run_py(30)
        t0 = time.monotonic()
        r = subprocess.run(self.lab_argv('eris-cpu,eris-webgpu', 0), env=dict(self.env, LAB_LOCK_WAIT='2'),
                           capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertGreaterEqual(time.monotonic() - t0, 2)
        self.assertIn(f'device lease: {HOST} is busy, held by run.py', r.stderr)
        events = [e['event'] for e in self.events(r.stdout)]
        self.assertIn('waiting_for_device_lease', events)
        self.assertNotIn('held', events)
        # The phone is a different device: a phone-only session is not held up by an eris run.
        r = subprocess.run(self.lab_argv('phone-cpu', 0), env=dict(self.env, LAB_LOCK_WAIT='2'),
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.events(r.stdout)[-2]['devices'], [PHONE])

    def test_research_run_waits_for_the_lab(self):
        lab = self.start(self.lab_argv('phone-cpu,eris-cpu', 2))
        self.assertTrue(wait_for(lambda: lease.live_holder(self.state, HOST) and lease.live_holder(self.state, PHONE)),
                        'lab never took its leases')
        self.assertEqual(lease.live_holder(self.state, HOST)['holder'], 'device-lab')
        r = self.run_py('--', 'true')
        self.assertEqual(r.returncode, 75, r.stderr)
        self.assertIn('held by device-lab', r.stderr)
        r = self.run_py('--wait', '30', '--', sys.executable, '-c', 'import time; print(time.time())', device=PHONE)
        self.assertEqual(r.returncode, 0, r.stderr)
        started = float((Path(json.loads(r.stdout)['run']) / 'output.log').read_text())
        out, err = lab.communicate(timeout=30)
        self.assertEqual(lab.returncode, 0, err)
        left = [e for e in self.events(out) if e['event'] == 'leaving'][0]['time']
        self.assertGreaterEqual(started, left, 'the research run overlapped the lab session')

    def test_lab_under_a_research_run_honours_its_lease(self):
        r = self.run_py('--', *self.lab_argv('eris-cpu,phone-cpu', 0))
        self.assertEqual(r.returncode, 0, r.stderr)
        events = self.events((Path(json.loads(r.stdout)['run']) / 'output.log').read_text())
        self.assertIn(('device_lease_honoured', HOST), [(e['event'], e.get('device')) for e in events])
        self.assertIn(('device_lease_held', PHONE), [(e['event'], e.get('device')) for e in events])
        self.assertIn(sorted([HOST, PHONE]), [e.get('devices') for e in events])

    def test_lab_refuses_without_a_lease_directory(self):
        env = dict(self.env, **{lease.CONFIG_ENV: str(self.tmp / 'absent.json')})
        r = subprocess.run(self.lab_argv('eris-cpu', 0), env=env, capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('device lease: no lease directory is configured', r.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)

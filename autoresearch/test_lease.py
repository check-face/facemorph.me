"""run.py and lease.py tests: decisions with plain values; everything else with real processes. No device lock is
taken any more (operator, 25 October 2026), so two runs of one device run at the same time.

  python3 autoresearch/test_lease.py
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
        self.env = {k: v for k, v in os.environ.items() if k not in (lease.STATE_DIR_ENV, lease.HELD_ENV, 'GITHUB_ACTIONS')}
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

    def journal(self):
        return [json.loads(line) for line in (self.state / 'runs.jsonl').read_text().splitlines()]


class Runner(Machine):
    def test_runs_and_journals_like_classic(self):
        r = self.run_py('--', sys.executable, '-c', 'import os; print(os.environ["FACEMORPH_LEASE_HELD"], os.environ["FACEMORPH_LEASE_DIR"], os.environ["FACEMORPH_LEASE_RUN"])')
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out['status'], 'completed')
        self.assertEqual((Path(out['run']) / 'output.log').read_text().split(), [HOST, str(self.state), Path(out['run']).name])
        [record] = self.journal()
        self.assertEqual((record['status'], record['exit_code'], record['device'], record['host']), ('completed', 0, HOST, HOST))
        self.assertEqual(record['qualification'], 'not_evaluated')

    def test_two_runs_of_one_device_run_at_the_same_time(self):
        first = self.start([sys.executable, str(RUN), '--lane', 'browser-gpu', '--device', HOST, '--', 'sleep', '3'])
        t0 = time.monotonic()
        r = self.run_py('--', 'true')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(time.monotonic() - t0, 2.5, 'the second run waited for the first')
        self.assertEqual(first.wait(15), 0)
        self.assertEqual(sorted(x['status'] for x in self.journal()), ['completed', 'completed'])

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
        self.assertEqual(self.run_py('--', 'true').returncode, 0, 'the next run did not start')

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
        self.assertEqual(self.run_py('--', 'true').returncode, 0, 'the next run did not start')


if __name__ == '__main__':
    unittest.main(verbosity=2)

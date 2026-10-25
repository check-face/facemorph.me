"""The bounded runner and physical-device locks, using real processes, files and flocks.

    python3 autoresearch/test_run.py

No model, GPU or phone is operated. Correctness overlap, exclusive measurement admission, streamed
stdout/stderr, failure, signal/timeout cleanup and bounded phone serialization are exercised directly.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
RUN = HERE / 'run.py'
LAB = HERE.parent / 'tools/device-lab'


def wait_for(predicate, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def alive(pid):
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[0] != 'Z'
    except OSError:
        return False


class Runner(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='command-runner-test-'))
        self.env = dict(os.environ, FACEMORPH_LOCK_DIR=str(self.tmp / 'locks'))
        self.env.pop('FACEMORPH_EXCLUSIVE', None)
        self.procs = []

    def tearDown(self):
        for child in self.procs:
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                try:
                    child.wait(20)
                except subprocess.TimeoutExpired:
                    child.kill()
            child.communicate()
        shutil.rmtree(self.tmp)

    def run_py(self, *args, env=None):
        return subprocess.run([sys.executable, str(RUN), *args], env=env or self.env,
                              capture_output=True, text=True, timeout=30)

    def start(self, args):
        child = subprocess.Popen(args, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(child)
        return child

    def holding(self, *options):
        ready, release = self.tmp / 'ready', self.tmp / 'release'
        script = ('import pathlib,sys,time; ready,release=map(pathlib.Path,sys.argv[1:]); '
                  'ready.touch();\nwhile not release.exists(): time.sleep(0.02)')
        child = self.start([sys.executable, str(RUN), *options, '--', sys.executable, '-c',
                            script, str(ready), str(release)])
        self.assertTrue(wait_for(ready.exists), 'command never started')
        return child, release

    def test_output_and_identity_are_streamed_without_journal_files(self):
        result = self.run_py('--', sys.executable, '-c',
                             'import os,sys,json; print(json.dumps({"run":os.environ["FACEMORPH_RUN"],'
                             '"exclusive":os.environ.get("FACEMORPH_EXCLUSIVE")})); print("stderr",file=sys.stderr)')
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertRegex(record['run'], r'^\d{8}T\d{6}Z-[0-9a-f]{8}$')
        self.assertIsNone(record['exclusive'])
        self.assertEqual(result.stderr.strip(), 'stderr')
        self.assertEqual(list(self.tmp.iterdir()), [])

    def test_stdout_arrives_before_command_finishes(self):
        release = self.tmp / 'release'
        script = ('import pathlib,sys,time; release=pathlib.Path(sys.argv[1]); print("first",flush=True);'
                  '\nwhile not release.exists(): time.sleep(0.02)')
        child = self.start([sys.executable, str(RUN), '--', sys.executable, '-u', '-c', script, str(release)])
        import select
        ready, _, _ = select.select([child.stdout], [], [], 10)
        self.assertTrue(ready, 'stdout was buffered until command exit')
        self.assertEqual(child.stdout.readline().strip(), 'first')
        self.assertIsNone(child.poll())
        release.touch()
        self.assertEqual(child.wait(20), 0)

    def test_command_failure_is_preserved(self):
        self.assertEqual(self.run_py('--', 'sh', '-c', 'exit 3').returncode, 3)
        self.assertEqual(self.run_py('--', str(self.tmp / 'missing')).returncode, 127)

    def test_correctness_commands_overlap_even_while_timing_lock_is_held(self):
        child, release = self.holding('--exclusive', 'gpu-timing', '--wait', '0')
        result = self.run_py('--', sys.executable, '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).touch()', str(release))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(child.wait(20), 0)

    def test_busy_timing_exits_75_without_starting_and_lock_releases(self):
        child, release = self.holding('--exclusive', 'gpu-timing', '--wait', '0')
        result = self.run_py('--exclusive', 'gpu-timing', '--wait', '0', '--', 'echo', 'must-not-start')
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertIn('nothing started', result.stderr)
        release.touch()
        self.assertEqual(child.wait(20), 0)
        self.assertEqual(self.run_py('--exclusive', 'gpu-timing', '--wait', '0', '--', 'true').returncode, 0)

    def test_bounded_wait_acquires_after_the_holder_releases(self):
        child, release = self.holding('--exclusive', 'gpu-timing', '--wait', '0')
        next_child = self.start([sys.executable, str(RUN), '--exclusive', 'gpu-timing', '--wait', '10', '--', 'true'])
        # The real runner emits this only after flock reports contention.
        self.assertIn('Waiting for the gpu-timing lock', next_child.stderr.readline())
        release.touch()
        self.assertEqual(child.wait(20), 0)
        self.assertEqual(next_child.wait(20), 0)

    def test_ordinary_commands_do_not_inherit_a_timing_lock_claim(self):
        result = self.run_py('--', sys.executable, '-c', 'import os; print(os.environ.get("FACEMORPH_EXCLUSIVE"))',
                             env=dict(self.env, FACEMORPH_EXCLUSIVE='gpu-timing'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'None')

    def test_invalid_budgets_names_and_retired_arguments_fail(self):
        for options in (['--timeout', '3601'], ['--timeout', '0'], ['--exclusive', '../escape'],
                        ['--exclusive', 'gpu-timing', '--wait', '3601'], ['--wait', '0'],
                        ['--device', 'eris'], ['--lane', 'build'], ['--state-dir', '/tmp/unused']):
            result = self.run_py(*options, '--', 'true')
            self.assertEqual(result.returncode, 2, options)
        self.assertEqual(self.run_py('--exclusive', 'gpu-timing', '--', 'true', env=dict(self.env, FACEMORPH_LOCK_DIR='relative')).returncode, 2)
        self.assertEqual(self.run_py().returncode, 2)

    def test_timeout_kills_the_entire_owned_process_group(self):
        pid_file = self.tmp / 'worker.pid'
        result = self.run_py('--timeout', '0.5', '--', 'sh', '-c',
                             f'trap "" TERM; sleep 300 & echo $! > {pid_file}; wait')
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertTrue(wait_for(lambda: not alive(int(pid_file.read_text()))))

    def test_workers_outliving_the_command_are_reaped(self):
        pid_file = self.tmp / 'worker.pid'
        result = self.run_py('--', 'sh', '-c', f'sleep 300 & echo $! > {pid_file}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(wait_for(lambda: not alive(int(pid_file.read_text()))))

    def test_sigterm_cleans_up_and_releases_the_timing_lock(self):
        pid_file = self.tmp / 'worker.pid'
        child = self.start([sys.executable, str(RUN), '--exclusive', 'gpu-timing', '--wait', '0', '--',
                            'sh', '-c', f'sleep 300 & echo $! > {pid_file}; wait'])
        self.assertTrue(wait_for(lambda: pid_file.exists() and pid_file.read_text().strip()))
        child.send_signal(signal.SIGTERM)
        self.assertEqual(child.wait(20), 128 + signal.SIGTERM)
        self.assertTrue(wait_for(lambda: not alive(int(pid_file.read_text()))))
        self.assertEqual(self.run_py('--exclusive', 'gpu-timing', '--wait', '0', '--', 'true').returncode, 0)

    def test_phone_lock_is_bounded_and_does_not_block_desktop(self):
        # Only the real flock API is exercised. No device, camera or browser is opened.
        script = ('import pathlib,sys; sys.path.insert(0,sys.argv[1]); import lab; '
                  '\n'
                  'with lab.lab_lock(sys.argv[2].split(",")):\n'
                  ' print("locked",flush=True)\n'
                  ' sys.stdin.read()\n')
        env = dict(self.env, LAB_LOCK_WAIT='0', LAB_STATE=str(self.tmp / 'lab/state.json'))
        command = [sys.executable, '-c', script, str(LAB)]
        first = subprocess.Popen([*command, 'phone-cpu'], env=env, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(first)
        self.assertEqual(first.stdout.readline().strip(), 'locked')
        blocked = subprocess.run([*command, 'phone-webgpu'], env=env, input='', capture_output=True, text=True, timeout=10)
        self.assertEqual(blocked.returncode, 75, blocked.stderr)
        desktop = subprocess.run([*command, 'eris-cpu'], env=env, input='', capture_output=True, text=True, timeout=10)
        self.assertEqual(desktop.returncode, 0, desktop.stderr)
        first.stdin.close()
        first.stdin = None
        self.assertEqual(first.wait(10), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)

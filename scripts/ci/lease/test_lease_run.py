"""The CI wrapper around run.py (fm-wzy), with real processes on a temporary machine run directory
(autoresearch/test_lease.py's Machine fixture): a timeout ends the whole owned process group and fails with the
journal saying so; a device other than this host is refused; the command's output reaches the job log and the run's
folder and id reach $GITHUB_OUTPUT; two concurrent wrapped jobs run at the same time (no device lock).

    python3 scripts/ci/lease/test_lease_run.py
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / 'autoresearch'))
import lease  # noqa: E402
from test_lease import HOST, Machine, alive, wait_for  # noqa: E402

WRAP = HERE / 'lease_run.py'


class Wrapper(Machine):
    def wrap(self, *args, device=HOST, lane='build', timeout=60):
        out = self.tmp / 'github-output'
        r = subprocess.run([sys.executable, str(WRAP), '--device', device, '--lane', lane, '--github-output',
                            str(out), *args], env=self.env, capture_output=True, text=True, timeout=timeout)
        outputs = dict(l.split('=', 1) for l in out.read_text().splitlines()) if out.exists() else {}
        return r, outputs

    def test_output_reaches_the_job_log_and_the_run_reaches_github_output(self):
        r, outputs = self.wrap('--', 'sh', '-c', 'echo first; sleep 1; echo second')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('first\nsecond', r.stdout)
        record = json.loads(r.stdout.strip().splitlines()[-1])['lease']
        self.assertEqual((record['status'], record['exit_code'], record['qualification']),
                         ('completed', 0, 'not_evaluated'))
        self.assertEqual(outputs['run_id'], record['id'])
        self.assertTrue((Path(outputs['run_dir']) / 'run.json').is_file())
        self.assertEqual(self.journal()[-1]['id'], record['id'])

    def test_the_commands_failure_is_the_jobs(self):
        r, _ = self.wrap('--', 'sh', '-c', 'exit 3')
        self.assertEqual(r.returncode, 3)
        self.assertEqual(self.journal()[-1]['status'], 'failed')

    def test_timeout_ends_the_owned_process_group_and_fails(self):
        pid_file = self.tmp / 'worker.pid'
        r, outputs = self.wrap('--timeout', '1', '--', 'sh', '-c',
                               f'trap "" TERM; sleep 300 & echo $! > {pid_file}; wait')
        self.assertEqual(r.returncode, 124, r.stderr)
        worker = int(pid_file.read_text())
        self.assertTrue(wait_for(lambda: not alive(worker), 10), 'a child survived the timeout')
        self.assertEqual(subprocess.run(['pgrep', '-f', f'sleep 300'], capture_output=True, text=True).stdout.split()
                         .count(str(worker)), 0)
        self.assertEqual(self.journal()[-1]['status'], 'timeout')
        self.assertEqual(outputs['status'], 'timeout')

    def test_other_device_refused(self):
        r, _ = self.wrap('--', 'true', device='not-' + HOST)
        self.assertEqual(r.returncode, 2)
        self.assertIn('neither this machine', r.stderr)

    def test_two_concurrent_wrapped_jobs_run_at_the_same_time(self):
        out = self.tmp / 'order'
        cmd = lambda tag: [sys.executable, str(WRAP), '--device', HOST, '--lane', 'build', '--wait', '30', '--',
                           'sh', '-c', f'echo start-{tag} >> {out}; sleep 1; echo end-{tag} >> {out}']
        a = self.start(cmd('a'))
        b = self.start(cmd('b'))
        self.assertEqual((a.wait(60), b.wait(60)), (0, 0))
        lines = out.read_text().split()
        # No device lock (operator, 25 October 2026): both start before either ends.
        self.assertEqual(len(lines), 4)
        self.assertEqual(sorted(lines[:2]), ['start-a', 'start-b'], lines)


if __name__ == '__main__':
    unittest.main(verbosity=2)

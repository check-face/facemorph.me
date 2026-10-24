"""The device-lease CI wrapper (fm-wzy), with real processes and real flocks on a temporary machine lease
directory (autoresearch/test_lease.py's Machine fixture): busy without --wait exits 75; a bounded wait acquires
or gives up non-zero; a timeout ends the whole owned process group and fails with the journal saying so; a nested
lease and a device other than this host are refused; the command's output reaches the job log and the run's
folder and id reach $GITHUB_OUTPUT; two concurrent wrapped jobs serialize.

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

    def test_busy_without_wait_exits_75(self):
        self.hold_with_run_py(30)
        r, outputs = self.wrap('--', 'true')
        self.assertEqual(r.returncode, lease.BUSY, r.stderr)
        self.assertIn('Device busy', r.stderr)
        self.assertEqual(outputs, {}, 'a busy run produced a run folder')

    def test_bounded_wait_acquires_or_gives_up(self):
        self.hold_with_run_py(1.5)
        r, _ = self.wrap('--wait', '30', '--', 'true')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.hold_with_run_py(30)
        t0 = time.monotonic()
        r, _ = self.wrap('--wait', '1', '--', 'true')
        self.assertEqual(r.returncode, lease.BUSY)
        self.assertLess(time.monotonic() - t0, 15)

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

    def test_nested_lease_and_other_device_refused(self):
        r, _ = self.wrap('--', sys.executable, str(WRAP), '--device', HOST, '--lane', 'build', '--', 'true')
        self.assertEqual(r.returncode, 2)
        self.assertIn('already holds the', r.stdout)
        r, _ = self.wrap('--', 'true', device='not-' + HOST)
        self.assertEqual(r.returncode, 2)
        self.assertIn('neither this machine', r.stderr)

    def test_two_concurrent_wrapped_jobs_serialize(self):
        out = self.tmp / 'order'
        cmd = lambda tag: [sys.executable, str(WRAP), '--device', HOST, '--lane', 'build', '--wait', '30', '--',
                           'sh', '-c', f'echo start-{tag} >> {out}; sleep 1; echo end-{tag} >> {out}']
        a = self.start(cmd('a'))
        b = self.start(cmd('b'))
        self.assertEqual((a.wait(60), b.wait(60)), (0, 0))
        lines = out.read_text().split()
        # Never interleaved: each job's end comes right after its start.
        self.assertEqual(len(lines), 4)
        self.assertTrue(lines[0].replace('start', 'end') == lines[1] and lines[2].replace('start', 'end') == lines[3],
                        lines)


if __name__ == '__main__':
    unittest.main(verbosity=2)

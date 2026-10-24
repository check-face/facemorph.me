#!/usr/bin/env python3
"""Device-lease wrapper for self-hosted CI (fm-wzy), behind .github/actions/device-lease.

Runs one heavy command through autoresearch/run.py, the same per-machine lease local agents, research and the
device lab take, so a CI job and a local run never share a GPU or the phone. What it adds for CI:
- the command's output is streamed into the job log while it runs (run.py writes it to the run folder);
- the run's journal entry (run.json) is printed at the end and its folder and id are written to
  $GITHUB_OUTPUT (run_dir, run_id, status) so a later step can upload them;
- run.py's exit status is the job's: busy (75), refused (2), timeout (124), the command's own failure; a
  busy device is never a silent pass, and exit zero is execution, not qualification.

    python3 scripts/ci/lease/lease_run.py --device eris --lane browser-gpu [--timeout 600] [--wait 0] -- <command>

Budget: --timeout defaults to 600 s, at most 3600; --wait is bounded by run.py the same way. Every run.py
refusal stands: a nested lease in this process tree, a device other than this host (or one attached to it),
a lease directory that is not the machine's.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'autoresearch'))
import lease  # noqa: E402

RUN = REPO / 'autoresearch' / 'run.py'


def find_run(state, runner_pid, deadline):
    """The run folder run.py made for this runner (matched by runner_pid in its run.json), or None."""
    while time.monotonic() < deadline:
        if state.is_dir():
            for meta in sorted(state.glob('*/run.json'), reverse=True)[:20]:
                try:
                    if json.loads(meta.read_text()).get('runner_pid') == runner_pid:
                        return meta.parent
                except (OSError, ValueError):
                    pass
        time.sleep(0.2)
    return None


def follow(path, stop, out=sys.stdout):
    """Copies path to out as it grows until stop is set and the file is drained."""
    at = 0
    while True:
        done = stop.is_set()
        try:
            with open(path, 'rb') as f:
                f.seek(at)
                chunk = f.read()
        except OSError:
            chunk = b''
        if chunk:
            at += len(chunk)
            out.write(chunk.decode('utf-8', 'replace'))
            out.flush()
        elif done:
            return
        time.sleep(0.2)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--device', required=True)
    p.add_argument('--lane', required=True)
    p.add_argument('--timeout', type=float, default=600)
    p.add_argument('--wait', type=float, default=0)
    p.add_argument('--github-output', default=os.environ.get('GITHUB_OUTPUT'))
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args(argv)
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not command:
        p.error('give the command after --')
    child = subprocess.Popen(
        [sys.executable, str(RUN), '--lane', a.lane, '--device', a.device, '--timeout', str(a.timeout),
         '--wait', str(a.wait), '--', *command],
        stdout=subprocess.PIPE, text=True)
    stop = threading.Event()
    follower = None
    try:
        config = lease.machine_config(os.environ)
        state = lease.resolve_state_dir(None, os.environ, config)
    except lease.Refused:
        state = None  # run.py reports the refusal itself
    run_dir = None
    if state is not None:
        # The folder appears once the lease is held (after any bounded wait); stream it from then on.
        def watch():
            nonlocal run_dir
            run_dir = find_run(state, child.pid, time.monotonic() + a.wait + 30)
            if run_dir:
                follow(run_dir / 'output.log', stop)
        follower = threading.Thread(target=watch, daemon=True)
        follower.start()
    stdout, _ = child.communicate()
    stop.set()
    if follower:
        follower.join(10)
    code = child.returncode
    result = next((json.loads(l) for l in reversed(stdout.splitlines()) if l.startswith('{')), None)
    if result and result.get('run'):
        run_dir = Path(result['run'])
        meta = run_dir / 'run.json'
        record = json.loads(meta.read_text()) if meta.is_file() else {}
        print(json.dumps({'lease': {k: record.get(k) for k in
                                    ('id', 'device', 'lane', 'status', 'exit_code', 'seconds', 'host', 'qualification')}}))
        if a.github_output:
            with open(a.github_output, 'a') as f:
                f.write(f"run_dir={run_dir}\nrun_id={record.get('id', run_dir.name)}\nstatus={record.get('status')}\n")
    else:
        print(json.dumps({'lease': None, 'exit_code': code, 'note': 'run.py started no run (busy or refused)'}))
    return code


if __name__ == '__main__':
    sys.exit(main())

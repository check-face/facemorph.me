#!/usr/bin/env python3
"""Bounded command execution, journalled in the machine's run directory (lease.py, ops/lease/README.md).

  python3 autoresearch/run.py --lane <lane> --device <machine> --state-dir <absolute lease dir> \\
      --timeout <seconds, at most 3600> [--wait <seconds>] -- <driver command>

Seeded from facemorph.me-classic autoresearch/run.py at b2d945a8 and compatible with it: the same
<device>.lock, run folders and runs.jsonl journal, and exit 75 when the device is busy. Added here:
the machine's one absolute run directory; refusal of a device this host does not own; cleanup of the owned
process group on SIGTERM/SIGHUP as well as on timeout. No device lock is taken (operator, 25 October 2026), so
--wait is accepted and ignored. Exit zero means the command completed, not that its result qualifies.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import lease  # noqa: E402

LANES = ['browser-cpu', 'browser-gpu', 'native-cpu', 'native-gpu', 'build']
GRACE_S = 5  # from SIGTERM to SIGKILL for whatever is left of the command's process group


class Stopped(Exception):
    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


def _stop(signum, frame):
    raise Stopped(signum)


def group_gone(child):
    if child.poll() is None:
        return False
    try:
        os.killpg(child.pid, 0)
    except ProcessLookupError:
        return True
    return False


def stop_group(child, grace=GRACE_S):
    """End the command's own process group, workers that outlived it included: SIGTERM, then SIGKILL
    whatever is still there after grace seconds."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if group_gone(child):
            break
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        end = time.monotonic() + grace
        while not group_gone(child) and time.monotonic() < end:
            time.sleep(0.05)
    child.wait()


def execute(command, args, state, run_id, host):
    folder = state / run_id
    folder.mkdir()
    record = dict(id=run_id, lane=args.lane, device=args.device, command=command, cwd=os.getcwd(),
                  timeout=args.timeout, status='running', runner_pid=os.getpid(), host=host, repo=str(ROOT.parent))
    metadata = folder / 'run.json'
    metadata.write_text(json.dumps(record, indent=2) + '\n')
    # The command and its tools see the lease they run inside (the lab honours it).
    env = dict(os.environ, **{lease.HELD_ENV: args.device, lease.STATE_DIR_ENV: str(state), lease.RUN_ENV: run_id})
    start = time.monotonic()
    child, code = None, 1
    try:
        with (folder / 'output.log').open('w') as output:
            child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True, env=env)
            code = child.wait(timeout=args.timeout)
            record['status'] = 'completed' if code == 0 else 'failed'
    except subprocess.TimeoutExpired:
        record['status'], code = 'timeout', 124
    except Stopped as exc:
        record['status'], code = 'interrupted', 128 + exc.signum
    except KeyboardInterrupt:
        record['status'], code = 'interrupted', 130
    except OSError as exc:
        record['status'], record['error'], code = 'failed', str(exc), 127
    finally:
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(sig, signal.SIG_IGN)  # a second signal must not cut the cleanup short
        if child is not None:
            stop_group(child)
        record.update(exit_code=code, seconds=time.monotonic() - start, qualification='not_evaluated')
        metadata.write_text(json.dumps(record, indent=2) + '\n')
        with (state / 'runs.jsonl').open('a') as journal:
            fcntl.flock(journal, fcntl.LOCK_EX)
            journal.write(json.dumps(record) + '\n')
        print(json.dumps({'run': str(folder), 'status': record['status'], 'exit_code': code}))
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--lane', required=True, choices=LANES)
    parser.add_argument('--device', required=True, help='the machine doing the work, or a device attached to it')
    parser.add_argument('--timeout', type=float, default=600, help='budget in seconds, at most 3600 (default 600)')
    parser.add_argument('--wait', type=float, default=0, help='ignored: no device lock is taken any more')
    parser.add_argument('--state-dir', help="the machine's absolute lease directory "
                                            '(default: FACEMORPH_LEASE_DIR, else the lease config)')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 3600 or not 0 <= args.wait <= 3600:
        parser.error('Provide a command, a timeout in (0, 3600] and a wait in [0, 3600].')
    host = lease.host()
    try:
        config = lease.machine_config(os.environ)
        state = lease.resolve_state_dir(args.state_dir, os.environ, config)
        lease.check_device(args.device, host, config)
    except lease.Refused as exc:
        parser.error(str(exc))
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _stop)
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    try:
        with lease.hold(state, args.device, holder='run.py', run=run_id, lane=args.lane, repo=str(ROOT.parent)):
            return execute(command, args, state, run_id, host)
    except Stopped as exc:
        return 128 + exc.signum
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    sys.exit(main())

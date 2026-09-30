#!/usr/bin/env python3
"""Bounded command execution with a cooperative per-device benchmark lease."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lane', required=True, choices=['browser-cpu', 'browser-gpu', 'native-cpu', 'native-gpu', 'build'])
    parser.add_argument('--device', required=True)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--wait', type=float, default=0, help='Wait up to this many seconds for the device lease (default: fail immediately).')
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'state')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not re.fullmatch(r'[a-zA-Z0-9_-]+', args.device) or not 0 < args.timeout <= 3600 or not 0 <= args.wait <= 3600:
        parser.error('Provide a command, safe device name and timeout in (0, 3600].')
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True)
    with (state / (args.device + '.lock')).open('a+') as lease:
        deadline = time.monotonic() + args.wait
        while True:
            try:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    print('Device busy; no experiment started.', file=sys.stderr)
                    return 75
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        folder = state / run_id
        folder.mkdir()
        record = dict(id=run_id, lane=args.lane, device=args.device, command=command,
                      cwd=os.getcwd(), timeout=args.timeout, status='running', runner_pid=os.getpid())
        metadata = folder / 'run.json'
        metadata.write_text(json.dumps(record, indent=2) + '\n')
        start = time.monotonic()
        child = None
        code = 1
        try:
            with (folder / 'output.log').open('w') as output:
                child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                code = child.wait(timeout=args.timeout)
                record['status'] = 'completed' if code == 0 else 'failed'
        except subprocess.TimeoutExpired:
            record['status'], code = 'timeout', 124
        except KeyboardInterrupt:
            record['status'], code = 'interrupted', 130
        except OSError as exc:
            record['status'], record['error'], code = 'failed', str(exc), 127
        finally:
            if child is not None:
                # Also reap descendants of a command that exited before its workers.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            record.update(exit_code=code, seconds=time.monotonic() - start,
                          qualification='not_evaluated')
            metadata.write_text(json.dumps(record, indent=2) + '\n')
            with (state / 'runs.jsonl').open('a') as journal:
                fcntl.flock(journal, fcntl.LOCK_EX)
                journal.write(json.dumps(record) + '\n')
            print(json.dumps({'run': str(folder), 'status': record['status'], 'exit_code': code}))
        return code


if __name__ == '__main__':
    sys.exit(main())

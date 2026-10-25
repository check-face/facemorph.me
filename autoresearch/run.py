#!/usr/bin/env python3
"""Bounded command execution, with an exclusive lock only for runs that time something.

  python3 autoresearch/run.py [--exclusive gpu-timing] [--timeout <seconds, at most 3600>] [--wait <seconds>] \\
      -- <command>

The command's output goes straight to this process's stdout and stderr. A timeout, SIGTERM or SIGHUP ends the
command's whole process group (workers that outlived it included); exit 124 on timeout, 128+signal when stopped,
else the command's own status.

Ordinary work takes no lock (operator, 25 October 2026): eris runs CI, research and agents side by side on its full
CPU and GPU. A run that times the GPU passes --exclusive gpu-timing and runs alone among such runs, waiting up to
--wait seconds (default 3600) for the one ahead; nothing else ever waits on it, so it cannot hold up a CI job. The
command sees FACEMORPH_EXCLUSIVE (the lock it holds) and FACEMORPH_RUN (this run's id), which the timing drivers
require (autoresearch/drivers/lib/artifact.mjs requireTimingLock). --wait is valid only with --exclusive;
ordinary commands never wait for machine capacity.
"""
import argparse
import datetime as dt
import fcntl
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

GRACE_S = 5  # from SIGTERM to SIGKILL for whatever is left of the command's process group
EXCLUSIVE_NAME = re.compile(r'[a-z0-9-]+')
LOCK_DIR_ENV = 'FACEMORPH_LOCK_DIR'
BUSY = 75  # an exclusive lock still held after --wait


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
    """End the command's own process group: SIGTERM, then SIGKILL whatever is still there after grace seconds."""
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


def lock_dir(env):
    return Path(env.get(LOCK_DIR_ENV) or Path.home() / '.cache' / 'facemorph' / 'locks')


def take(name, wait, env):
    """The open, flocked lock file for name, or None if it is still held after wait seconds."""
    folder = lock_dir(env)
    folder.mkdir(parents=True, exist_ok=True)
    f = (folder / f'{name}.lock').open('a+')
    deadline, said = time.monotonic() + wait, False
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return f
        except BlockingIOError:
            if time.monotonic() >= deadline:
                f.close()
                return None
            if not said:
                print(f'Waiting for the {name} lock (another timing run is measuring)', file=sys.stderr)
                said = True
            time.sleep(0.2)


def execute(command, timeout, env):
    child = None
    try:
        child = subprocess.Popen(command, start_new_session=True, env=env)
        return child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f'run.py: timed out after {timeout:g} s', file=sys.stderr)
        return 124
    except Stopped as exc:
        return 128 + exc.signum
    except KeyboardInterrupt:
        return 130
    except OSError as exc:
        print(f'run.py: {exc}', file=sys.stderr)
        return 127
    finally:
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(sig, signal.SIG_IGN)  # a second signal must not cut the cleanup short
        if child is not None:
            stop_group(child)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--exclusive', help='run alone among runs naming this lock (gpu-timing)')
    parser.add_argument('--timeout', type=float, default=600, help='budget in seconds, at most 3600 (default 600)')
    parser.add_argument('--wait', type=float, default=None, help='seconds to wait for an --exclusive lock (default 3600)')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if args.wait is not None and not args.exclusive:
        parser.error('--wait requires --exclusive; ordinary commands take no lock')
    wait = 3600 if args.wait is None else args.wait
    if not command or not 0 < args.timeout <= 3600 or not 0 <= wait <= 3600:
        parser.error('Provide a command, a timeout in (0, 3600] and a wait in [0, 3600].')
    if args.exclusive and not EXCLUSIVE_NAME.fullmatch(args.exclusive):
        parser.error(f'unsafe lock name {args.exclusive!r}')
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _stop)
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    env = dict(os.environ, FACEMORPH_RUN=run_id)
    env.pop('FACEMORPH_EXCLUSIVE', None)  # only a lock this invocation actually holds may be advertised
    lock = None
    try:
        if args.exclusive:
            if not lock_dir(env).is_absolute():
                parser.error('FACEMORPH_LOCK_DIR must be absolute so checkouts share the timing lock')
            lock = take(args.exclusive, wait, env)
            if lock is None:
                print(f'run.py: the {args.exclusive} lock is still held after {wait:g} s; nothing started',
                      file=sys.stderr)
                return BUSY
            env['FACEMORPH_EXCLUSIVE'] = args.exclusive
        return execute(command, args.timeout, env)
    except Stopped as exc:  # while waiting for the lock: nothing was started
        return 128 + exc.signum
    finally:
        if lock:
            lock.close()


if __name__ == '__main__':
    sys.exit(main())

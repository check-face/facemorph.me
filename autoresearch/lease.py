"""One device lease per physical machine.

Research runs (autoresearch/run.py), the device lab (tools/device-lab/lab.py), heavy self-hosted CI
and classic's autoresearch/run.py all take the same lease: an exclusive flock on
<state dir>/<device>.lock, the file classic's run.py locks. Each machine has one absolute state
directory, named by its lease config (ops/lease/README.md), so two checkouts can never hold two
leases for one GPU or the phone. While a lease is held, <device>.holder.json names its holder.

Runs on Python 3.8 (triton) and later.
"""
from contextlib import contextmanager
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import socket
import time

BUSY = 75  # EX_TEMPFAIL, the exit status of classic's run.py when the device is busy
DEVICE_NAME = re.compile(r'[a-zA-Z0-9_-]+')
STATE_DIR_ENV = 'FACEMORPH_LEASE_DIR'
CONFIG_ENV = 'FACEMORPH_LEASE_CONFIG'
HELD_ENV = 'FACEMORPH_LEASE_HELD'  # set for a leased command: the device(s) its process tree holds
RUN_ENV = 'FACEMORPH_LEASE_RUN'  # set for a leased command: its run id (the folder under the lease directory)
# /etc serves a machine shared by several accounts; a machine whose agents and runners all run as
# one account may use that account's file instead.
CONFIG_FILES = (Path('/etc/facemorph/lease.json'), Path.home() / '.config' / 'facemorph' / 'lease.json')
SETUP = 'see ops/lease/README.md'
# CI never waits behind local work (operator, 25 October 2026): a CI waiter asks a local holder to stop with this
# signal, and the holder ends its command and releases. A CI job waiting on local work could run out its
# timeout-minutes and be cancelled in flight, which is never allowed.
PREEMPT = signal.SIGUSR1


class Refused(Exception):
    """This lease must not be taken here."""


class Busy(Exception):
    """Another process still holds the lease."""

    def __init__(self, device, holder):
        super().__init__(f'{device} is busy, {describe(holder)}')
        self.device, self.holder = device, holder


# ------------------------------------------------------------------ decisions (plain values in)
def resolve_state_dir(flag, env, config):
    """The machine's one lease directory: --state-dir, else FACEMORPH_LEASE_DIR, else the lease
    config's stateDir. It must be absolute and, when the config names one, be that one."""
    configured = config.get('stateDir')
    given = [(name, value) for name, value in (('--state-dir', flag), (STATE_DIR_ENV, env.get(STATE_DIR_ENV)),
                                               ('the lease config stateDir', configured)) if value]
    if not given:
        raise Refused(f'no lease directory is configured for this machine ({SETUP})')
    for name, value in given:
        if not os.path.isabs(value):
            raise Refused(f'{name} {value} is not absolute; a relative directory gives each checkout its own lease')
    name, value = given[0]
    if configured and os.path.normpath(value) != os.path.normpath(configured):
        raise Refused(f"{name} {value} is not this machine's lease directory {configured} ({SETUP})")
    return Path(os.path.normpath(value))


def allowed_devices(host, config):
    """This host plus the devices attached to it (the lease config's devices, such as eris's phone)."""
    return {host} | set(config.get('devices', ()))


def check_device(device, host, config):
    if not DEVICE_NAME.fullmatch(device):
        raise Refused(f'unsafe device name {device!r}')
    allowed = allowed_devices(host, config)
    if device not in allowed:
        raise Refused(f'{device} is neither this machine ({host}) nor attached to it; take its lease on the '
                      f'machine that does the work (this one may lease {", ".join(sorted(allowed))})')


def enclosing_lease(env, chain, holders):
    """The lease this process already runs inside, or None. chain: (pid, start) of this process and
    each ancestor; holders: the lease directory's holder records. The ancestry finds a nested run that
    cleared its environment; the environment marker finds one that uses another directory."""
    chain = {tuple(link) for link in chain}
    for record in holders:
        if (record.get('pid'), record.get('start')) in chain:
            return record
    devices = [d for d in env.get(HELD_ENV, '').split(',') if d]
    return {'device': devices[0], 'via': HELD_ENV} if devices else None


def held_by_ancestor(device, chain, holders):
    """Whether an ancestor of this process holds device's lease, so a tool started under it (the lab
    under run.py) honours it rather than waiting on itself."""
    chain = {tuple(link) for link in chain}
    return any(r.get('device') == device and (r.get('pid'), r.get('start')) in chain for r in holders)


def preempts(waiter_ci, holder):
    """Whether a waiter takes the lease from holder: CI always does from a local holder, never from CI."""
    return bool(waiter_ci) and bool(holder) and not holder.get('ci') and bool(holder.get('pid'))


def describe(holder):
    if not holder:
        return 'held by a process that left no holder record (classic run.py, or a runner that just exited)'
    detail = [holder.get('holder'), holder.get('run'), holder.get('lane') and f"lane {holder['lane']}",
              holder.get('pid') and f"pid {holder['pid']}", holder.get('since') and f"since {holder['since']}",
              holder.get('repo')]
    return 'held by ' + ', '.join(str(d) for d in detail if d)


# ------------------------------------------------------------------ the machine
def host():
    return socket.gethostname().split('.')[0]


def machine_config(env):
    """FACEMORPH_LEASE_CONFIG's file if that is set, else the first of CONFIG_FILES that exists; {}
    when there is none."""
    for path in [Path(env[CONFIG_ENV])] if env.get(CONFIG_ENV) else CONFIG_FILES:
        if path.is_file():
            config = json.loads(path.read_text())
            if not isinstance(config, dict):
                raise Refused(f'{path} is not a JSON object ({SETUP})')
            return config
    return {}


def identity(pid):
    """(pid, start time in clock ticks since boot, parent pid), or None when the process is gone or
    there is no /proc."""
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
    except OSError:
        return None
    fields = stat[stat.rindex(')') + 2:].split()  # the command name may hold spaces and parentheses
    return pid, int(fields[19]), int(fields[1])


def ancestry(pid=None):
    """(pid, start) of the process and each of its ancestors below init."""
    chain, pid = [], pid or os.getpid()
    while pid > 1:
        link = identity(pid)
        if not link:
            break
        chain.append(link[:2])
        pid = link[2]
    return chain


def holder_path(state, device):
    return state / f'{device}.holder.json'


def holders(state):
    records = []
    for path in sorted(Path(state).glob('*.holder.json')):
        try:
            records.append(json.loads(path.read_text()))
        except (OSError, ValueError):
            pass  # released meanwhile
    return records


def live_holder(state, device):
    """device's holder record while its process lives, else None."""
    try:
        record = json.loads(holder_path(state, device).read_text())
    except (OSError, ValueError):
        return None
    link = identity(record.get('pid') or 0)
    return record if link and link[1] == record.get('start') else None


@contextmanager
def hold(state, device, wait=0.0, poll=0.1, on_wait=None, on_preempt=None, **owner):
    """Hold device's lease in state for the with-block, or raise Busy if it is still held after wait
    seconds. on_wait(holder record) is called once, when the lease has to be waited for. owner fields
    (holder, run, lane, repo, ci) go into the holder record. An owner with ci=True preempts a local holder
    (PREEMPT, once per holder; on_preempt(holder) is told) and waits for it to release."""
    state.mkdir(parents=True, exist_ok=True)
    with (state / f'{device}.lock').open('a+') as lock:
        deadline, waited, asked = time.monotonic() + wait, False, set()
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Busy(device, live_holder(state, device)) from None
                current = live_holder(state, device)
                if on_wait and not waited:
                    on_wait(current)
                waited = True
                if preempts(owner.get('ci'), current) and (current['pid'], current.get('start')) not in asked:
                    asked.add((current['pid'], current.get('start')))
                    try:
                        os.kill(current['pid'], PREEMPT)
                        if on_preempt:
                            on_preempt(current)
                    except ProcessLookupError:
                        pass
                time.sleep(min(poll, max(0.0, deadline - time.monotonic())))
        me = identity(os.getpid())
        record = dict(owner, device=device, host=host(), pid=os.getpid(), start=me[1] if me else None,
                      since=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
        path = holder_path(state, device)
        partial = path.with_name(f'{path.name}.{os.getpid()}.partial')
        partial.write_text(json.dumps(record) + '\n')
        os.replace(partial, path)
        try:
            yield record
        finally:
            path.unlink(missing_ok=True)  # while still locked, so it can never remove the next holder's record

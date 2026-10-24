"""Where a machine's runs are journalled, and which devices it may run work for.

The device lock this module used to take (an exclusive flock per machine that CI, research runs, the lab and
local agents queued on) is gone (operator, 25 October 2026): a CI job waiting on it ran out its timeout and was
cancelled in flight, and the machines have the resources to run things side by side. What is left is the
machine's one absolute run directory (ops/lease/README.md), the device check and run identities.

Runs on Python 3.8 (triton) and later.
"""
from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import re
import socket

DEVICE_NAME = re.compile(r'[a-zA-Z0-9_-]+')
STATE_DIR_ENV = 'FACEMORPH_LEASE_DIR'
CONFIG_ENV = 'FACEMORPH_LEASE_CONFIG'
HELD_ENV = 'FACEMORPH_LEASE_HELD'  # set for a leased command: the device(s) its process tree holds
RUN_ENV = 'FACEMORPH_LEASE_RUN'  # set for a leased command: its run id (the folder under the lease directory)
# /etc serves a machine shared by several accounts; a machine whose agents and runners all run as
# one account may use that account's file instead.
CONFIG_FILES = (Path('/etc/facemorph/lease.json'), Path.home() / '.config' / 'facemorph' / 'lease.json')
SETUP = 'see ops/lease/README.md'


class Refused(Exception):
    """This lease must not be taken here."""


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


@contextmanager
def hold(state, device, **owner):
    """A run record for the with-block (device, host, pid, start time and the owner fields). No lock is taken."""
    state.mkdir(parents=True, exist_ok=True)
    me = identity(os.getpid())
    yield dict(owner, device=device, host=host(), pid=os.getpid(), start=me[1] if me else None,
               since=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))

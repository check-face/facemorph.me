# Device lease: one per physical machine

A heavy run (research driver, device-lab session, heavy self-hosted CI job) holds the lease of each device
it loads, so two heavy runs never share a GPU or the phone. The lease is an exclusive `flock` on
`<lease dir>/<device>.lock`, the file classic's `autoresearch/run.py` locks too. While it is held,
`<device>.holder.json` beside it names the holder. Code: [`autoresearch/lease.py`](../../autoresearch/lease.py).

Each machine has **one absolute lease directory**. Classic's old default, the relative
`autoresearch/state` of each checkout, gave every checkout its own lease for the same GPU.

## Running something under the lease

```sh
python3 autoresearch/run.py --lane <browser-cpu|browser-gpu|native-cpu|native-gpu|build> --device <machine> \
  --state-dir "<this machine's lease dir>" --timeout <s, at most 3600> [--wait <s>] -- <driver command>
```

- `--state-dir` may be left out; the lease config's `stateDir` (or `FACEMORPH_LEASE_DIR`) supplies it. A
  directory other than the configured one is refused, and so is a relative one.
- Busy: exit 75 at once, or with `--wait <s>` wait up to that bound and then exit 75.
- `--device` is the machine doing the work, or a device attached to it (eris's phone is `p30pro`); a lease for
  another machine is refused.
- The command runs with `FACEMORPH_LEASE_RUN` (its run id), `FACEMORPH_LEASE_HELD` and `FACEMORPH_LEASE_DIR` set.
- A nested lease is refused: those variables mark the leased process tree, and
  holder records are matched against the process's ancestry, so an environment-clearing wrapper is caught too.
- On timeout (default 600 s; exit 124), SIGTERM or SIGHUP, the command's own process group gets SIGTERM, then
  SIGKILL after 5 s. Workers left behind by a command that exited are ended the same way.
- Each run gets `<lease dir>/<run id>/{run.json,output.log}` and a line in `<lease dir>/runs.jsonl`, one
  journal per machine shared with classic. Exit 0 means the command completed, not that it qualifies.

The device lab (`tools/device-lab/lab.py`) takes the same lease: the machine's own for the `eris-*` cells,
`p30pro` for the `phone-*` cells. Started under `run.py`, it honours the lease that run holds.

Classic: on these machines always pass the machine's directory, for example
`python3 autoresearch/run.py --lane browser-gpu --device eris --state-dir /home/cdilga/.local/state/facemorph/lease --timeout 1500 -- ...`.
Classic's `run.py` writes no holder record, so a busy message for a classic holder says only that one exists.

## Lease config

The first file that exists wins:

1. `$FACEMORPH_LEASE_CONFIG`, when that is set.
2. `/etc/facemorph/lease.json`, for a machine shared by several accounts.
3. `~/.config/facemorph/lease.json`, for a machine whose agents and runners all run as one account.

```json
{"stateDir": "/home/cdilga/.local/state/facemorph/lease", "devices": ["eris", "p30pro"]}
```

`stateDir` is the machine's lease directory. `devices` lists what this machine may lease: its own name
(the short hostname, always allowed) and any attached device.

| Machine | Account (agents and runners) | Config | `stateDir` | `devices` |
| --- | --- | --- | --- | --- |
| eris | `cdilga` | `~/.config/facemorph/lease.json` | `/home/cdilga/.local/state/facemorph/lease` | `eris`, `p30pro` (USB P30 Pro) |
| triton | `chris` | `~/.config/facemorph/lease.json` | `/home/chris/.local/state/facemorph/lease` | `triton` |
| TrueNAS | set when its runners land (fm-ip6g) | | | |

## Tests

`python3 autoresearch/test_lease.py` exercises real processes, flocks, classic's `run.py` at its pinned
revision (`CLASSIC_CHECKOUT`, default `../facemorph.me-classic`; skipped and reported untested without one)
and the lab's real `lab_lock`. CI: `.github/workflows/research-lease.yml`.

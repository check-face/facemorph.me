# Bounded commands and timing locks

Correctness builds, tests, browser checks and adapter probes share compute. They take no machine-wide lock.
Use ordinary commands directly, or the bounded runner when process cleanup is useful:

```sh
python3 autoresearch/run.py --timeout 600 -- npm test
# A campaign that measures the GPU runs alone among other GPU timing campaigns.
python3 autoresearch/run.py --exclusive gpu-timing --wait 300 --timeout 1800 -- <measurement command>
```

The runner streams stdout/stderr directly and supplies `FACEMORPH_RUN`, a unique run ID. Exit zero means execution,
not qualification. It preserves command failures, returns 127 if the command cannot start, 124 on timeout, and
128+signal when interrupted. Timeout, SIGTERM and SIGHUP end the command's whole process group, including workers
left behind by a command that exited: SIGTERM first, then SIGKILL after a five-second grace period.
The command timeout defaults to 600 seconds, at most 3600.

Only `--exclusive gpu-timing` takes the timing lock. `--wait` is valid only with an exclusive lock (default 3600 s,
maximum 3600); exit 75 means the lock remained busy and no command started. Ordinary correctness commands do not
wait for that lock. A workflow's job timeout must cover its chosen wait plus command budget and cleanup. The
composite action defaults to zero wait so busy timing work defers immediately rather than filling a CI slot.

Timing locks live in `$FACEMORPH_LOCK_DIR`, otherwise `~/.cache/facemorph/locks`. Runs from the same worker account
and different checkouts share that directory. Only a runner actually holding a lock supplies
`FACEMORPH_EXCLUSIVE=gpu-timing`; measured research drivers require it. There are no machine-wide holder records,
`run.json`, `output.log` or `runs.jsonl` produced by this runner. Capture output or use CI logs for evidence.
The old `--lane`, `--device` and `--state-dir` arguments are rejected, so stale callers fail clearly.

The physical phone has its own bounded lock in `tools/device-lab/lab.py`. Phone CPU and WebGPU sessions serialize
against each other, while eris browser cells use a separate lab lock and do not wait behind phone sessions.
`LAB_LOCK_WAIT` bounds contention (default 300 s); busy exits 75. `LAB_STATE` controls the lab state path; lock
files live alongside it. These lab locks never operate the camera or device by themselves.

Historical classic lease journals are read-only evidence. `scripts/research-ledger/record-handover.py` can still
read those old journals; it does not describe or control current command admission. Classic research stays
read-only and no current correctness job is wrapped in its old protocol.

`python3 autoresearch/test_run.py` tests the real process lifecycle, streaming, correctness overlap, timing
contention/release and phone-vs-desktop lab locks without opening a browser or operating a phone. The reusable
`research-lease.yml` workflow retains its existing path and now runs these current runner tests.

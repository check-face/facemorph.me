# FaceMorph research

Research optimises the new application and packages in this repository: every wait a person sits through, from first
load to a saved or shared file, on the first visit and every later one. Since 24 October 2026 (fm-zxj) this is the
research home. Classic ([facemorph.me-classic](https://github.com/check-face/facemorph.me-classic)) keeps its experiment
history read-only, and **no new round starts there**.

[PLAN.md](../PLAN.md) and the beads govern release scope; where this guide or an older research document differs, they
win. The [protocol](program.md) says how one experiment runs, and the [record standards](records.md) say how it is
written down.

## The one entry command

Every heavy build, correctness run, warmup or measurement runs under the machine's device lease, from the repository
root:

```sh
python3 autoresearch/run.py --lane <browser-cpu|browser-gpu|native-cpu|native-gpu|build> --device <machine> \
  --state-dir "<absolute per-machine lease dir>" --timeout <seconds, at most 3600> -- <driver command with quoted arguments>
```

Worked example on eris (a maintained driver against the pinned control artifact; see the
[eris recipe](workers/eris/README.md) for the candidate arguments and the durable output directory):

```sh
python3 autoresearch/run.py --lane browser-gpu --device eris --state-dir "/home/cdilga/.local/state/facemorph/lease" \
  --timeout 1800 -- node autoresearch/drivers/morph-frame-product.mjs --label "UNIQUE_RUN_LABEL" --route webgpu \
  --control deploy-next --control-digest ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe \
  --runtime /home/cdilga/.cache/facemorph-runtime
```

- The lease is one per physical machine, shared with classic, the device lab and heavy CI. Its directory, machine
  config and refusals are in [ops/lease](../ops/lease/README.md); `--state-dir` may be left out where the machine config
  names it. Busy exits 75; `--wait` is a bounded wait, not a queue.
- That GPU screen is a route benchmark. It is **not** the chooser-overlap benchmark, and the evaluator and its adapters
  do not exist just because the wrapper does. The frozen eris scripts still call classic's paths and run only from
  classic; for this app use the [maintained drivers](drivers/README.md), which measure an artifact by digest, and the
  worker recipes ([eris](workers/eris/README.md), [TrueNAS](workers/truenas/README.md), blocked on fm-ip6g).
- The runner journals every command to `<lease dir>/runs.jsonl` (one journal per machine, shared with classic). Exit
  zero means the command finished, never that it qualified.

## Smoke check

From a clean clone on a worker, this runs the import digest check and the ledger checks through the lease runner, and
journals the run:

```sh
python3 autoresearch/run.py --lane build --device "$(hostname -s)" --timeout 600 -- \
  sh -c 'node scripts/check-research-import.mjs && node scripts/check-research-ledger.mjs'
```

## Where things are

| Record | Path |
| --- | --- |
| Canonical evaluation ledger (append-only, 11 columns) | [results.tsv](results.tsv) |
| New rounds, each with its README, experiments and append-only log | `rounds/<date>-<slug>/`, from [the templates](rounds/templates/round.md) |
| Research handover from classic | [rounds/2026-10-24-handover](rounds/2026-10-24-handover/README.md) |
| Maintained drivers (artifact by digest) | [drivers](drivers/README.md) |
| Worker recipes and readiness | [workers/eris](workers/eris/README.md), [workers/truenas](workers/truenas/README.md), `node workers/check.mjs` |
| Frozen device recipes and drivers (classic paths) | [devices/eris](devices/eris/README.md) |
| Frozen candidates and their reports | `candidates/` |
| Frozen historical rounds and history | [reviews](reviews/README.md), [history](history/performance-through-2026-10-09/README.md), [benchmark campaign v2](benchmark-campaign-v2/README.md) |
| Proposed automation, not implemented | [loop-v3 proposal](loop-v3-proposal.md) |
| Import provenance of everything above | [docs/research-import](../docs/research-import/provenance.md) |

`reviews/`, `history/`, `candidates/`, `devices/`, `benchmark-campaign-v2/` and the old `templates/` are the
byte-identical import of classic at `b2d945a`; they are history, not current instructions. Earlier versions of this
guide, the protocol and the record standards are in classic's Git history.

## Checks

`node scripts/check-research-ledger.mjs` runs in CI on every `autoresearch/**` change: the ledger keeps its header and
every earlier byte, including the handover snapshot; new rows record evaluated outcomes only; round logs only grow at
EOF; the links in these documents and in classic's forward pointer resolve; and with `--classic` a row appended to
classic's ledger after the handover fails as a new round in classic. `node scripts/check-research-import.mjs` keeps the
imported tree intact.

## Starting

Read Cass feedback (`cass search ... --robot`), `git status`, the ledger tail, the newest round log and the machine's
journal, and inspect any interrupted run before resuming. Then follow the [protocol](program.md), one bounded experiment
at a time. An agent session drives the research; `run.py` is not a scheduler.

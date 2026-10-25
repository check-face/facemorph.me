# FaceMorph research

Research optimises the new application and packages in this repository: every wait a person sits through, from first
load to a saved or shared file, on the first visit and every later one. Since 24 October 2026 (fm-zxj) this is the
research home. Classic ([facemorph.me-classic](https://github.com/facemorph-me/facemorph.me-classic)) keeps its experiment
history read-only, and **no new round starts there**.

[PLAN.md](../PLAN.md) and the beads govern release scope; where this guide or an older research document differs, they
win. The [protocol](program.md) says how one experiment runs, and the [record standards](records.md) say how it is
written down.

## The one entry command

Correctness builds and tests run concurrently, without a machine-wide device lock.
Use ordinary npm/test commands directly. `autoresearch/run.py` is a bounded command
runner, not a scheduler or a local interpreter for GitHub Actions.

Timing policy: only GPU measurements take an exclusive `gpu-timing` lock, with a
bounded wait and an honest busy/deferred outcome. Use `python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 1800 -- <command>`. Do not start a timing campaign without the required lock.
Normal correctness work never waits for it. The phone has its own bounded physical
device lock in the lab; eris and CI correctness work may overlap it.

The [maintained drivers](drivers/README.md) measure exact artifacts by digest.
`npm run build:next` supplies the pinned classic control; it does not build the new
app. Frozen scripts in `devices/` still name classic paths and are historical.
See the [eris recipe](workers/eris/README.md) for runtime and browser readiness.
The runner streams output directly and sets `FACEMORPH_RUN`; it creates no journal.
Do not infer qualification from command exit zero. No new research round starts in classic.

## Smoke check

```sh
node scripts/check-research-import.mjs
node scripts/check-research-ledger.mjs
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

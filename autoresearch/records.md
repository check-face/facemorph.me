# Research record standards

Revision of 24 October 2026 (fm-zxj) for this repository. Historical rows and evidence keep their original bytes and
meaning; these standards apply to new records. The imported version is in classic's Git history.

## The records

| Record | Purpose | Update rule |
| --- | --- | --- |
| [Guide](README.md) / [protocol](program.md) | Current workflow and acceptance rules | Edit to keep coherent; PLAN.md and the beads win |
| `rounds/<date>-<slug>/README.md` | One round: journey, bottleneck, exclusions, decisions, remaining gates | Edit the summary |
| `rounds/<date>-<slug>/experiments.md` | Candidates: one falsifiable mechanism each, control, budget, gates | Edit proposals; log material changes |
| `rounds/<date>-<slug>/log.md` | The round's event and decision journal | Append uniquely identified entries at EOF; never rewrite one |
| `candidates/<id>/` | Experiment source, recipe and durable reports | Freeze measured inputs; a changed candidate gets a new identity |
| [results.tsv](results.tsv) | Canonical evaluated outcomes | Append rows only; corrections are new rows citing the earlier ID |
| `<lease dir>/runs.jsonl` | The machine's command journal written by `run.py` | Runner appends under its file lock; exit zero is still `not_evaluated` |
| `reviews/`, `history/`, `benchmark-campaign-v2/` | Frozen history imported from classic | Never edited |

Do not reorder, normalise or fill cells in old ledger rows: the 11-column file holds legacy prose and sample lists, and
it is a parseable evaluation ledger, not a numeric dataset. The journal and round logs do not replace it. A
documentation change or an unrun proposal adds no ledger row. `scripts/check-research-ledger.mjs` enforces these rules
in CI.

## New ledger rows

Keep the 11-column header and order. One scoped outcome per row, a unique `experiment_id`, and no tab or newline inside
a cell.

| Column | Convention |
| --- | --- |
| `experiment_id` | Unique; a correction gets a new ID and cites the superseded one in `hypothesis` |
| `lane` | `browser-cpu`, `browser-gpu`, `native-cpu` or `native-gpu`; the actual route goes in context |
| `device_provider` | Device, OS, browser and engine version, route; unknown fields written as unknown |
| `workload` | Inputs, resolution and frames, cache cohort, finish boundary, warmup, order, pairs and load |
| `source_hash` | Control and candidate source SHA-256 or Git revisions with labels; `not_measured` if unavailable |
| `control_ms`, `candidate_ms` | Scoped values with statistic and boundary; `not_measured`, `not_applicable` or `unpaired`; never zero for missing |
| `correctness` | The gates applied and their results, and the gates missing |
| `status` | `keep`, `discard`, `crash`, `inconclusive` or `blocked`; legacy values stay as they are |
| `evidence` | Durable report links; say when a raw artifact is local-only or gone |
| `hypothesis` | Mechanism, scoped conclusion, costs, correction reference and next gate |

The first evaluated row after the handover cites the [handover](rounds/2026-10-24-handover/README.md) (ledger prefix
hash and last journal IDs) in its `evidence` cell.

## Round logs

Start a round from [the round template](rounds/templates/round.md) and append entries from
[the entry template](rounds/templates/log-entry.md). Each entry heading carries a unique event ID and an ISO timestamp
with a timezone. Phases are `proposed`, `observed`, `implemented` and `deployed`, and describe the event, not a
qualification: a proposal has no samples; implementation cites source; deployment cites the verified live bytes.
Corrections append a superseding entry naming the earlier ID; the original stays. Never insert a backdated entry.

## Reporting claims

Current claims need recent real-visitor statistics or consented diagnostics matched to release, device, route,
workload and cache state, with the query window, coverage and sample count. Publish non-identifying aggregates only;
private reports stay in the diagnostics system with their expiry.

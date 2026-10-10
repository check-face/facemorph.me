# Research record standards

Use these standards for **new records from 10 October 2026 onward**. Historical
rows and evidence retain their original bytes and semantics. This is a prospective
documentation contract, not an implemented v3 decision engine or ledger migration.

## Separate the records

| Record | Purpose | Update rule |
| --- | --- | --- |
| [Guide](README.md) / [protocol](program.md) | Current workflow and acceptance rules | Edit to keep coherent; link to dated decisions |
| [Round registry](reviews/README.md) | Find the active review and closed rounds | Update status with a supporting round-log entry |
| `reviews/<date>/README.md` | One round's evidence, decisions and remaining gates | Edit the summary; no historical benchmark narrative or imported current claims |
| `reviews/<date>/experiments.md` | Proposed hypotheses, controls and gates | Edit proposals; log material goal/decision changes |
| `reviews/<date>/log.md` | Human-readable event/decision journal | Append new uniquely identified entries; never rewrite prior entries |
| `candidates/<id>/` | Experiment source, recipe and durable reports | Freeze measured inputs; a changed candidate gets a new identity/report |
| [results.tsv](results.tsv) | Canonical evaluated experiment outcomes | Append rows only; corrections are new rows referencing the earlier ID |
| `state/runs.jsonl` | Ignored command execution journal from [run.py](run.py) | Runner appends under its file lock; exit zero is still `not_evaluated` |
| `history/` | Dated setup/protocol/performance archive | Historical facts only; corrections identify date/evidence without claiming a current control |

Do not reorder, normalize or fill missing cells in old ledger rows. The existing
TSV has 11 columns and some legacy cells contain prose, sample lists or non-hash
descriptions. It is a parseable evaluation ledger, not a uniform numeric timing
dataset. The execution journal and round log do not replace it. Do not add a
benchmark outcome merely for a documentation cleanup or an unrun proposal.

## New ledger rows

Preserve the existing 11-column header/order. Use unique experiment/result IDs and
one scoped outcome per row. Tabs/newlines are delimiters, never embedded in a cell.

| Column | New-entry convention |
| --- | --- |
| `experiment_id` | Unique ID, consistent with the candidate/report; corrections get a new ID and cite the superseded ID in the hypothesis/conclusion |
| `lane` | `browser-cpu`, `browser-gpu`, `native-cpu`, or `native-gpu`; keep actual route/provider in context |
| `device_provider` | Device/hardware, OS, browser/engine version, route/provider; unknown fields explicitly unknown |
| `workload` | Inputs, resolution/frame count, cache state, timer boundary, warmup/order/sample count and load; full context linked in evidence |
| `source_hash` | Exact control/candidate source SHA-256 or Git revisions with labels; use `not_measured` if unavailable, not a path in place of a hash |
| `control_ms`, `candidate_ms` | Scoped ms values with sample statistic and boundary; `not_measured`/`not_applicable` when appropriate; `unpaired` for an observation without a comparable side. Full samples in the report. Do not substitute zero. |
| `correctness` | Applied gates/results and missing gates, including export/recovery where relevant |
| `status` | `keep`, `discard`, `crash`, `inconclusive`, or `blocked`, qualified by the protocol; legacy values remain unchanged |
| `evidence` | Durable source/report links; state if a cited raw artifact is local-only or unavailable |
| `hypothesis` | Mechanism, scoped conclusion, resource/failure costs, correction reference and next gate |

Do not average incompatible workloads or report paired speedups across different
devices, builds, routes, frame schedules or timer boundaries. Reports retain raw
samples/distributions, artifact/model/fixture identities, resource/failure data and
correctness. A ledger `keep`, integration commit and deployed validation are three
distinct facts.

## Round journal format

Start from [the round template](templates/round.md) and append entries using the
[entry template](templates/log-entry.md). Use an ISO timestamp with timezone and
a unique event ID. Phases are `proposed`, `observed`, `implemented`, `deployed`;
phase describes this event, not automatic qualification. A proposal has no samples.
Implementation cites source; deployment cites receipt and verified live bytes.

Each entry identifies its hypothesis/decision, exact known source/build/assets,
device/engine, workload/cache/network/order/load, start/finish boundary, samples,
correctness, resources/failures, evidence and next action. Use `not_measured`,
`not_applicable` or `unknown` explicitly. Corrections append a superseding entry
with the earlier event/result ID and reason; retain the original. Append at EOF,
never insert a backdated entry among earlier entries. Coordinate log/ledger writes
in the shared checkout so concurrent writers do not lose each other's records.

## Current reporting claims

Require recent actual analytics or consented debug reporting, matched to release,
device/browser, actual route, workload and cache state. Record query time, execution
and receipt windows, coverage/expiry limits, sample count and observable finish.
Receipt time may differ from execution time. Join start context across batches;
deduplicate request lifecycle outcomes before rates. Job completion, image decode,
paint, playable media and share-sheet handoff are different boundaries. Automated
observations remain diagnostic controls, not ordinary-user analytics. Missing
context means unknown, not a performance claim.

Publish only non-identifying aggregates and approved synthetic benchmark evidence;
leave private reports and their expiry in the existing diagnostics system. Do not
overwrite frozen raw evidence with a rerun. Link current rounds to history without
copying historical timings into the active control or queue.

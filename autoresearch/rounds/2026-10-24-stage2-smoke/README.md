# Research round: stage-2 driver smoke: 2026-10-24

Status: closed (smoke only; no evaluated outcome).
Journey and bottleneck: none measured. This round records that the maintained drivers (research stage 2, fm-qqh) run
against the pinned control artifact under the lease on their worker and that their re-homed workflows run; it makes no
performance claim.
Exclusions: candidate comparisons, evaluated rows in `results.tsv`, physical phones, TrueNAS (blocked, fm-ip6g).
Budget: one bounded smoke per driver on eris, plus one recorded run per re-homed workflow.

## Identity and evidence

Control: the pinned control artifact (`autoresearch/drivers/control.json`), tree SHA-256
`ecc4c357d536b5d9ae0f98ce6dea1f2cbe72537f3e124b28108db1449f14a0fe`, classic candidate build `551b6072`, served by
classic's qualification server with the verified acquired runtime (manifest `d9e37e50…`). A smoke without a candidate
is control/control. Outputs are in eris's durable research directory, cited per entry in [log.md](log.md).

## Candidates

None. Smoke runs are not candidates and are not screened.

## Integration and remaining gates

Owner bead fm-qqh. The first targeted round that uses these drivers creates its own dated round directory.

## Records

`log.md` (append-only) · `../../results.tsv` (evaluation ledger; no rows from this round) · `../../program.md` (protocol)

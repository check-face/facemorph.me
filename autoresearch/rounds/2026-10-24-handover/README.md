# Research round: handover from classic — 2026-10-24

Status: closed (a records event, not an experiment).
Journey and bottleneck: not_applicable. This round records the move of the research home from facemorph.me-classic to
this repository (fm-zxj), so the first evaluated row here can cite exactly what it continues from.

## What was handed over

- **Ledger:** `autoresearch/results.tsv`, imported byte-identically from classic `b2d945a` (69 rows, 11 columns). Its
  imported bytes are the prefix every later version must keep; `scripts/check-research-ledger.mjs` checks the prefix hash
  recorded in [the log](log.md) on every `autoresearch/**` change.
- **Journals:** the last command-journal IDs at handover, both the machine journal shared through the lease and
  classic's own relative journal, are recorded in [the log](log.md) and in a `research-handover` event in the machine
  journal.
- **History:** `reviews/`, `history/`, `candidates/`, `devices/`, `benchmark-campaign-v2/` and the old `templates/`
  are frozen imports (provenance in [docs/research-import](../../../docs/research-import/provenance.md)).
- **Classic:** `autoresearch/MOVED.md` in classic points here, and no new round starts in classic.

## Records

[Append-only log](log.md) · [Evaluation ledger](../../results.tsv) · [Record standards](../../records.md) ·
[Protocol](../../program.md) · [Guide](../../README.md)

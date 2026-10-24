# Handover log

Append-only. Entry format: [the entry template](../templates/log-entry.md).

### 2026-10-24T11:20:45+00:00 — 20261024T112045Z-handover-c5362967

- Phase / status: implemented / research handed over from classic to this repository; no new round starts in classic
- Round / experiment / correction: 2026-10-24-handover / not_applicable / not_applicable
- Hypothesis / decision: research home moves here (fm-zxj); classic keeps its history read-only
- Identity: ledger `autoresearch/results.tsv` prefix of 47039 bytes, SHA-256 `ab6877881a770301c12fec7c590f30db032d702b206f1872879d80d85a147f22` (69 rows), imported from classic `b2d945a8c7f0ff9f382fbfefaecc2651943077a3`; monorepo commit `8f6369a7a7a54fb44b6760010b338cdb3a8cf082`
- Context: last machine journal ID `20261024T111010Z-69b94ff3` (/home/cdilga/.local/state/facemorph/lease/runs.jsonl); last classic journal ID `20261024T094801Z-880ba76f` (classic `autoresearch/state/runs.jsonl`)
- Boundary / samples: not_applicable
- Correctness / workflow: `scripts/check-research-ledger.mjs` keeps this prefix and the header; `scripts/check-research-import.mjs` keeps the imported tree
- Resources / failures: not_applicable
- Evidence: journal event `20261024T112045Z-handover-c5362967` in the machine journal; classic forward pointer `autoresearch/MOVED.md`
- Conclusion / next action: the first evaluated row here cites this entry and the prefix hash in its evidence cell

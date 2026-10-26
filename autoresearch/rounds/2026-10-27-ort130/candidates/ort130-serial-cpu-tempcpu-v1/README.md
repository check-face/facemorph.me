# ORT 1.30 serial runtime: temporary-host CPU cell

Owner: fm-qeh. The [round](../../README.md) and its
[experiment](../../experiments.md) define this cell before
measurement. Raw evaluated reports will be retained here; there is no timing
verdict yet.

The candidate is the ORT 1.30 native-EP root with the separately built unshared
encoder runtime. Only CPU synthesis is measured here. Model weights, runtime
binaries, credentials and browser profiles are not committed to this record.

Control and native-serial candidate each passed all 31 Chromium CPU numerical
cases, with identical raw results and no skips. The subsequent single
control/control noise attempt failed its load guard during the first warmup:
zero completed visits, no performance samples, no comparison and no retry.
Timing remains blocked; no improvement or regression is inferred.

The [raw evidence](evidence/) includes both genuine correctness receipts, setup
identities and the refused noise report, exact invocation, logs and resource
samples. [SHA-256 list](evidence-sha256.json) binds these unchanged source files.
Absolute scratch paths in those historical records identify the executed cell;
remote scratch can be removed after copying without altering the records.

This continues the research handover event
`20261024T112045Z-handover-c5362967`: the original 47,039-byte ledger prefix has
SHA-256 `ab6877881a770301c12fec7c590f30db032d702b206f1872879d80d85a147f22`;
last machine journal `20261024T111010Z-69b94ff3`, last classic journal
`20261024T094801Z-880ba76f`. See the
[handover log](../../../2026-10-24-handover/log.md).

The refused [noise report](evidence/noise-v1/report.json.raw) retains the exact
emitted JSON bytes (the `.raw` suffix prevents source formatting from changing
its recorded digest). It parses as JSON; the SHA-256 above remains unchanged.

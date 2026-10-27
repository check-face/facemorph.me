# ORT 1.30 release measurements — 27 October 2026

Status: measuring under fm-qeh. This is package synthesis qualification; no
application or deployed performance result is claimed.

The control is the frozen runtime manifest
`d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c`.
The native-EP/serial-encoder candidate is
`d8ed9d5c44fa8afe0434299a99baf8a64db72b254165726f49a81853271eb858`.
Models, full31 fixtures and numerical tolerances remain unchanged. The copied
package distribution is identified by SHA-256
`5e1397e82d24759e6581453395b9d48f39c0181e1a406a47e12d95e2ec4e9b80`.

The initial measurement cell is the existing Ubuntu fmci container on the
temporary CPU host, with Playwright Chromium 156.0.8078.4 and the WASM provider.
Its browser, fixture and complete runtime graphs are independently verified.
Correctness precedes measurement. Control/control noise precedes the paired
comparison; each visit uses a fresh disk profile and separately measures its
resident warm sequence. Each command has a bounded timeout and a declared load
ceiling; other CI work is never stopped for a measurement.

The [experiment definition](experiments.md) fixes the boundaries, hypothesis and
stop conditions. The [journal](log.md) records observations and refusals. The
[candidate record](candidates/ort130-serial-cpu-tempcpu-v1/README.md) will hold
the durable reports. The canonical ledger is [results.tsv](../../results.tsv).

Remaining fm-qeh acceptance includes the paired results, other provider/device
cells, runtime adoption and exact deployed qualification. This round makes no
claim about the product UI, video, physical phones or GPU memory.

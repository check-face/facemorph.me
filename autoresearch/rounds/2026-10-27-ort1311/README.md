# ORT 1.31.1 — 27 October 2026

Status: measuring under fm-qeh. Latest npm stable was acquired and its pinned
classic CPU synthesis screen passed. This round records that limited result;
monorepo, encoder, device and deployment qualification remain open.

The npm tarball is identified by the registry integrity in
[evidence/registry.json.raw](evidence/registry.json.raw). SHA-512 and SHA-1 were
verified before extraction; [acquisition](evidence/acquisition.json.raw) pins all
58 distribution files by SHA-256 and size. The upstream tag resolves to commit
`6af1a932e2286d5c58166085d24c68783033edee`; the registry supplies no `gitHead`, so
the source tag alone does not establish binary reproducibility.

The [real CPU result](evidence/classic-cpu.json.raw) used classic source
`a42829bb0582b5a7a55ba6b1045a05861612b8a5` and control manifest
`d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c`.
Candidate runtime-set digest:
`a6f61b4d8503dbee2746b5d00a0656248966a45a19467b39ca61c24d7db7c345`.
Its seven canaries pass RGB maximum <=1 and sampled float maximum <=0.002:
observed maxima were 1 and 0.000005304813385009766. The observed provider was
WASM. The tool launched `/usr/bin/chromium` on eris; its post-run version was
Chromium 152.0.7977.82 Arch Linux. In-process browser identity was not captured.

The candidate CPU wrapper/factory/WASM total 14,927,315 bytes. This is file size,
not a measured acquisition or startup improvement. The raw admission duration
was not paired, warmed or load-controlled and supports no performance claim.

The [source audit](evidence/source-pins-summary.json.raw) confirms the same
Emscripten 4.0.23 release and immutable SDK gitlink as the earlier build. The
[source findings](evidence/source-preparation.md) distinguish static flag support
from generated-link and WASM memory checks still to execute.

Next: build and verify the same-release unshared 256 MiB encoder runtime, run
full31 plus encoder and native-EP/device numerics, then control/control noise and
paired timing before grouped adoption. Previous 1.30 evidence remains attributed
to that version. No application runtime pin, npm dependency or deployed bytes
changed here.

[Scope](experiments.md) · [journal](log.md) · [ledger](../../results.tsv).

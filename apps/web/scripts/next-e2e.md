# Exact-artifact CPU UI qualification

Updated **10 October 2026**. Run product commands from the **facemorph.me repo**.
The candidate target is **https://next.facemorph.me**; see the
[development guide](../docs/dev/README.md) for the build/delivery flow.

## Current flow

`.github/workflows/next-site.yml` builds the selected source into a
`next-site-<source SHA>` artifact, then runs compiled UI and real CPU UI
qualification before candidate-branch deployment. The standalone
`.github/workflows/next-e2e.yml` provides a separate qualification entry point.
Use the arguments and artifact/runtime inputs in the selected workflow; this
page does not replace its current invocation.

`scripts/next-e2e-server.py` serves the exact UI artifact and pinned runtime tree.
The qualification browser maps the production origin to its local TLS server;
server-side runtime acquisition still uses the public origin. Runtime overlay
and local mirrored runtime options permit qualification of the bytes that will
be deployed. Preserve production isolation headers, source receipts, file
checksums, and manifest pins. The harness refuses uploads/diagnostic POSTs.

The UI harness exercises name/seed generation, named route rejection, repeated
original-cache reuse with no new inference workers/requests, synthetic photo e4e,
local crop, and a playable saved MP4 morph. Project save/reopen is conditional:
**it is skipped while the product hides project controls**. A skipped check is
not a passed integrated workflow, even if component round-trip tests pass.
Check the actual report and feature state for every run.

## Evidence and limits

The [retained b322a26 CPU report](../docs/review/round-2-2026-10-10/cpu-qualification.json)
passed those enabled scenarios in Linux headless Chromium and saved a decoded
1024×1024 MP4. It explicitly skipped project save/reopen. This supersedes this
page's earlier partial-run descriptions and its old 512px-only account.

The report, synthetic downloads, source/hash receipts and browser/server logs
are workflow artifacts. Retain a durable report/receipt when making a long-lived
claim, since CI artifacts expire. Overall success covers the executed scenarios
only. CPU UI evidence does not establish GPU performance, physical phone memory,
whole-session restore, names-grid visual parity, native packaging, or offline
installation. Shared-runner timing is diagnostic; performance claims require
[autoresearch's controlled measurements](../autoresearch/README.md).

For current deployed/source gaps, use the
[round 2 review](../docs/round-2-gap-2026-10-10.md). Avoid treating an old run,
source-only assertion, or component pass as today's product qualification.

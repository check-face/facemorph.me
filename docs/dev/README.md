# Development

Development implements product behavior, fixes feedback, integrates research
winners, and verifies the artifact people use. Work from the **facemorph.me repo**;
the candidate target is **https://next.facemorph.me**, on branch
`candidate/next-delivery-20260916`. Performance experiments follow the separate
[autoresearch guide](../../autoresearch/README.md).

## Application layout

| Path | Purpose |
| --- | --- |
| `src/Next/` | Candidate UI, product bridges, storage, reporting, media, photo tools, and browser inference |
| `src/` outside `Next/`, `Server/` | Classic application and metadata server |
| `desktop/` | Desktop integration and packaging |
| `photo-runtime/` | Photo alignment runtime, build, and qualification |
| `self-host/` | Optional original API/UI distribution; locally built CPU or NVIDIA GPU Docker images |
| `hosting/next-static/` | Candidate staging, pinned runtime mirror, and Cloudflare configuration |
| `hosting/gallery/` | Reviewed public gallery assets and publication tools |
| `hosting/next-cloudflare/` | Optional diagnostics collector |
| `scripts/`, `.github/workflows/` | Build, artifact, integrated UI, and device verification |
| `autoresearch/` | Experimental candidates, device recipes, run journal, and performance ledger |
| `docs/` | Product requirements, dated feedback, and gap reviews |

## Start and verify

To run your own server API, use the [self-host quickstart](../../self-host/README.md)
and [API reference](../api.md). This is the historical API with a pinned original
frontend. The current `src/Next/` frontend at `next.facemorph.me` runs inference
locally and does not use that API. The application build commands below build
the current frontend, not the self-host compatibility shell.

Inspect existing changes and identify the requirement before editing. Recover
earlier session feedback with [Cass](https://github.com/Dicklesworthstone/coding_agent_session_search).
Refresh with `cass index --json` when needed, then use robot mode:

```sh
cass search "feedback" --workspace /home/cdilga/Work/dev/checkface \
  --mode lexical --robot --limit 5 --max-tokens 2000
```

Use the [plan registry](../plans/README.md), [docs index](../README.md) and [round 2 gap review](../round-2-gap-2026-10-10.md)
to distinguish historical status from current facts. Keep changes in this checkout;
do not create or use worktrees or overwrite concurrent edits.

Build prerequisites are Node/npm and the .NET SDK selected by `global.json`
(currently 5.0.302 with `latestFeature` roll-forward). Fable is restored from
`.config/dotnet-tools.json`. Product CI currently uses Node 22 and .NET 5.

```sh
npm ci
npm run build:next
```

Candidate output is `deploy-next/`. Classic uses `npm run build` (`deploy/`) and
`npm start` (watch server on port 8100). For candidate runtime checks, use the
existing exact-artifact harness with production headers/runtime pins; a basic
static server does not reproduce them. See [integrated UI qualification](../../scripts/next-e2e.md)
and `.github/workflows/next-site.yml` for current invocations and required checks.

Run tests relevant to the changed behavior, for example:

```sh
node --test src/Next/browser/route-priors.test.mjs src/Next/browser/runtime.test.mjs
```

The workflow lists the full required suite. A component pass does not establish
generation, export, or physical phone behavior. Keep heavy local builds/tests out
of a measurement window; use the same device lease as research when sharing a machine.

## Research integration and delivery

Integrate a research candidate using its source/asset hashes, settings, measured
scope, and known limits. Verify the product path and preserve tolerance based
correctness checks. Exact decoded-pixel hashes are not a build parity gate;
artifact/model file checksums still establish which bytes were tested.

`New site artifact` (`.github/workflows/next-site.yml`) builds and checks the
candidate, runs compiled UI and real CPU UI qualification, then deploys qualifying
candidate branch pushes through Cloudflare. Consult its path filters: a docs-only
push does not normally trigger deployment. Build output, runtime mirror,
catalogue, and deployed assets must describe the same candidate.

Before calling a fix shipped, identify the successful deploy run and compare live
asset filenames/checksums with its qualified artifact. State the deployed source
revision and device/workflow limits. Local edits, a successful build, and verified
deployed behavior are separate facts. Physical iPhone trials use this candidate
site with capability checks, canaries, bounded fallback, and consented diagnostics;
record the attempted engine and the route that ultimately succeeded. Physical
iPhone testing is not a pre-promotion gate: qualify with available checks, promote
to `next.facemorph.me`, then use consented diagnostics and feedback to iterate.
Keep missing physical evidence explicit. Contextual desktop browser/binary guidance
follows the [current plan](../plans/candidate-ui-2026-10-10.md); advertise binaries
only for available tested targets, with their verified capabilities.

Never include another session's changes in a commit or weaken required checks.
Preserve archived evidence and public/private asset boundaries when changing hosting.

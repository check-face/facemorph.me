# FaceMorph.me

FaceMorph is a web app for choosing, generating, blending and morphing faces, preparing
photos and exporting recoverable images/video. This monorepo is the active migration
from the classic app to strict TypeScript, React, Vite and npm workspaces.
Implementation is underway; Beads (`br show fm-fy2`) defines executable scope and
[PLAN.md](PLAN.md) preserves architectural background. Read [AGENTS.md](AGENTS.md)
in full before contributing.

Our goal is a working, sustainable replacement that preserves the classic app's
features and performance, completes the agreed product changes, and is deployed
from this monorepo to **https://next.facemorph.me** with a usable rollback.
Calling that handover done requires real post-deploy journey passes on all six
local cells, against the same release artifact, plus normal applicable CI:

| Local browser/device | CPU | WebGPU |
| --- | --- | --- |
| Chrome on Linux eris | pass | pass |
| Firefox on Linux eris | pass | pass |
| Chrome on the Huawei P30 Pro | pass | pass |

Missing local evidence or CPU fallback in a WebGPU cell is not a pass. Hosted CI
also reuses the iOS Simulator on macOS and Android emulator; unavailable hosted
runners are explicitly untested, while real executed failures require repair.
All six local adapters exist; adapter support alone is not release qualification.
The release Beads track remaining exact-artifact evidence. Production promotion is separate.

**https://next.facemorph.me still comes from classic's candidate branch**, in
[facemorph.me-classic](https://github.com/check-face/facemorph.me-classic).
This repo takes over after release qualification. Production promotion is a separate
operator decision. Classic keeps its history and Docker/PyTorch work; new development
and [research](autoresearch/README.md) happen here.

The web-only release preserves CPU/WebGPU selection, bounded fallback, mobile/iPhone
paths and integrated performance optimizations. Native packages and WebGL execution
are retired. Phones remain first-class targets, admitted per operation/capability.
Raw synthesis and exact recovery values are preserved within the plan's tolerances;
compressed export bytes can differ. No model weights or credentials are bundled.

## Development

Use Node 24 or newer. From this directory:

```sh
npm ci
npm run hooks:install
npm run typecheck
npm run build
# Run tests relevant to the change; the full suite is available with npm test.
node --test scripts/ci/changes.test.ts scripts/ci/path-filters.test.ts
```

Workspaces are apps/web, packages/stylegan-js, browser-model-manager,
cloudflare-model-host and model-conv. Oxfmt/Oxlint provide formatting/lint gates.
`npm run build` builds the application; **`npm run build:next` builds its mounted
Vite destination into deploy-next with this repository's source identity**. See
[build details](docs/dev/build-next.md). Classic comparisons fetch an independent, hash-verified control;
control tests validate the harness/control, not feature migration. Use verified external runtime assets for inference checks.

Agent working instructions live only in [AGENTS.md](AGENTS.md). Use the existing
[device lab](tools/device-lab/README.md) for local browser/phone validation and CASS
for session history. Beads hold current scope, acceptance and executed evidence.

Execution records are `.beads/issues.jsonl`, published at https://beads.dilger.dev.
Current GitHub owner is check-face; selected future organization is facemorph-me.

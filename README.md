# FaceMorph.me

FaceMorph is a web app for choosing, generating, blending and morphing faces, preparing
photos and exporting recoverable images/video. This monorepo is the active migration
from the classic app to strict TypeScript, React, Vite and npm workspaces.
Implementation is underway; Beads (`br show fm-fy2`) defines executable scope and
[PLAN.md](PLAN.md) preserves architectural background. Read [AGENTS.md](AGENTS.md)
in full before contributing.

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
`npm run build` builds the new application; **`npm run build:next` currently downloads
a verified pinned CLASSIC CONTROL**, not the edited monorepo app. See
[build details](docs/dev/build-next.md). Control tests validate the harness/control,
not feature migration. Use verified external runtime assets for inference checks.

Work directly on main, validate locally in proportion to the change, then push.
Versioned hooks check format/lint of staged/pushed content; agents run relevant
builds/tests and local browser/device checks themselves. CI runs one workflow at a
time, finishes running work, and replaces only the pending run with the newest push.
The YAML queue and path filters are the authority; no parallel local workflow engine.
Inspect CI once at startup and repair observed failures through Beads; automatic CI
reopening is not implemented. See AGENTS.md for commands and honest coverage limits.

For now one agent operates directly outside NTM, with Agent Mail skipped and
`AGENT_MAIL_GUARD_MODE=warn` on commits/pushes. Preserve existing dirty changes.
The [device lab](tools/device-lab/README.md) provides local phone/eris validation;
physical phones never run in CI. Correctness work shares compute, timing alone uses
exclusive measurement locks. Research and release qualification have stronger
requirements than ordinary slices.

Execution records are `.beads/issues.jsonl`, published at https://beads.dilger.dev.
Current GitHub owner is check-face; selected future organization is facemorph-me.

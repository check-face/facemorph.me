# FaceMorph.me

Fresh monorepo for the **[repo-cleanup-and-architecture-refactor plan](PLAN.md)**.
The plan was converted to an execution graph of beads on 24 October 2026; start from the entry
bead `fm-fy2` (`br show fm-fy2`). `PLAN.md` is frozen background. Implementation has not begun.

The retained application and Docker/PyTorch work live in
[facemorph.me-classic](https://github.com/check-face/facemorph.me-classic)
(local sibling `../facemorph.me-classic/`). Existing candidate delivery continues
from `candidate/next-delivery-20260916` in that repository. The revamp carries
forward its existing features and all integrated performance optimizations, with
the plan’s explicit changes. This repo will deliver **https://next.facemorph.me** after
qualification, then **https://facemorph.me** after production cutover.

This release is web-only; native desktop packages are retired for now. Preserve
browser CPU/WebGPU selection, bounded CPU fallback and the candidate's working
iPhone/mobile paths. Admit each operation by its actual capabilities and memory
policy, with contextual computer guidance where useful. See the plan for evidence
limits and the requirements/research preservation maps.
Phones remain first-class targets; the existing desktop/mobile/GPU CI lanes and
available performance-regression checks are preserved. Use capable workers with
shared device leases for development; Triton-service retirement does not retire
the machine as a worker.
Raw synthesis retains small numerical error margins; image compression and encoded
file bytes may differ, with valid recovery metadata and practical export quality.
The plan minimizes each wait and full choosing/generation/export time: recommend
explicitly approved generate-and-encode models with a Generate choice, prioritize synthesis
downloads and overlap photo preparation. Budgeted warming of verified cached models
is a proposed optimization to qualify. The plan's targeted autoresearch playbook
keeps classic's experiment history and append-only logs/ledger as read-only reference.
Research is moving into this repo as its own workstream, and further rounds will
optimise the new app; the existing commands run only in classic until that lands.

The selected future GitHub organization login is `facemorph-me`; current owner is
`check-face`. Legacy `checkface` is archived as-is.

Planned stack: strict TypeScript, React, Vite and npm workspaces; Python/PyTorch for
model conversion and classic API. Planned packages: `stylegan-js`,
`browser-model-manager`, `cloudflare-model-host` and `model-conv`. Oxfmt/Oxlint and
a conversion Docker environment are specified in the plan, not installed here.

Execution records are in `.beads/issues.jsonl` (about 140 beads, all deferred until
implementation starts) and are browsable at https://beads.dilger.dev. The beads are
self-contained and are the scope authority; where a bead and `PLAN.md` differ, the bead
wins. No model weights, credentials or legacy runtime are bundled.

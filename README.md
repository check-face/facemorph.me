# FaceMorph.me

Fresh monorepo for the **[repo-cleanup-and-architecture-refactor plan](PLAN.md)**.
`PLAN.md` is the single active plan. Start there; implementation has not begun.

The retained application and Docker/PyTorch work live in
[facemorph.me-classic](https://github.com/check-face/facemorph.me-classic)
(local sibling `../facemorph.me-classic/`). Existing candidate delivery continues
from that repository. This repo will deliver **https://next.facemorph.me** after
qualification, then **https://facemorph.me** after production cutover.

The selected future GitHub organization login is `facemorph-me`; current owner is
`check-face`. Legacy `checkface` is archived as-is.

Planned stack: strict TypeScript, React, Vite and npm workspaces; Python/PyTorch for
model conversion and classic API. Planned packages: `stylegan-js`,
`browser-model-manager`, `cloudflare-model-host` and `model-conv`. Oxfmt/Oxlint and
a conversion Docker environment are specified in the plan, not installed here.

Portable execution records are in `.beads/issues.jsonl`; all 20 tasks and epic
remain deferred. They predate the current remaining-work review and are not
synchronized during planning. The plan is the scope authority; execution setup is
a separate later step. No model weights, credentials or legacy runtime are bundled.

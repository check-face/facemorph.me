# FaceMorph agent guide

This repository builds the candidate at **https://next.facemorph.me** from
`candidate/next-delivery-20260916`. Run commands from this directory.

- **Dev:** [development guide](docs/dev/README.md) for implementation, product
  feedback, tests, builds, and delivery.
- **Autoresearch:** [research guide](autoresearch/README.md) for improving the whole
  application from first load through generation and sharing, on first and nth
  visits. Follow its experiment and evidence protocol.

Current UX acceptance and retention overrides are in
[the screenshot/process correction](docs/plans/feedback-process-2026-10-10.md).
Optimize the complete useful journey to playable/save-ready video on first and
return visits, including photo encoding; retain first-face, responsiveness and
restore checks. Component/phone simulator passes are not full phone UX evidence.
Lossy persisted images/video need practical quality and exact latent/provenance
integrity, not decoded-pixel parity. Slow successful routes must not be demoted.

Inspect `git status` and recover relevant feedback with Cass before choosing work
(`cass search ... --robot`; never launch the interactive TUI from an agent).
Preserve concurrent changes. Do not create or use worktrees, reset or clean the
checkout, or include another session's edits in a commit. Read the relevant guide;
report experimental, implemented, and deployed results distinctly.

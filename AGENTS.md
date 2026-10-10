# FaceMorph agent guide

This repository builds the candidate at **https://next.facemorph.me** from
`candidate/next-delivery-20260916`. Run commands from this directory.

- **Dev:** [development guide](docs/dev/README.md) for implementation, product
  feedback, tests, builds, and delivery.
- **Autoresearch:** [research guide](autoresearch/README.md) for improving the whole
  application from first load through generation and sharing, on first and nth
  visits. Follow its experiment and evidence protocol.

Inspect `git status` and recover relevant feedback with Cass before choosing work
(`cass search ... --robot`; never launch the interactive TUI from an agent).
Preserve concurrent changes. Do not create or use worktrees, reset or clean the
checkout, or include another session's edits in a commit. Read the relevant guide;
report experimental, implemented, and deployed results distinctly.

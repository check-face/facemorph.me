# FaceMorph delivery plan for review

Snapshot: 16 September 2026. These documents capture the workspace plan for Oliver and other reviewers; requirements are not claims of completed implementation.

Start with [the governing delivery plan](web_checkface_delivery_plan.md), then [migration and preservation strategy](migration_plan.md). Supporting snapshots: [closeout decisions](delivery_closeout_2026-09-16.md) and [desktop validation](desktop_ci_and_gpu_validation.md).

Latest operator requirements in the governing plan take precedence over earlier conflicting notes:

- First-class native Tauri GPU inference independent of browser/WebView GPU, with actual hardware qualification, CPU fallback and Oliver's Manjaro gate. CPU-only desktop packages do not complete the phase.
- Next and the eventual production site have no local TrueNAS/home-network dependency. Labs should also be independent, with only a minimal documented temporary exception if necessary.
- Click/tap/keyboard photo selection from empty face tiles and image drag-and-drop, using the shared photo/e4e workflow.

This review snapshot includes the four documents above. References to other workspace research files, test evidence and absolute local paths are provenance pointers and may not resolve on GitHub; they are not additional bundled evidence. Historical status sections remain dated and must not override current requirements. Implementation work continues separately; this branch changes documentation only.

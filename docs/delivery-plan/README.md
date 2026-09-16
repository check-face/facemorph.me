> **Latest operator direction:** Stop this round and report READY FOR TESTING once the live site and installed desktop skeleton work. Remaining native GPU backends are required later, but must await the operator resuming work after testing. See the stop gate at the top of the governing plan.

# FaceMorph delivery plan for review

Snapshot: 16 September 2026. These documents capture the workspace plan for Oliver and other reviewers; requirements are not claims of completed implementation.

Start with [the governing delivery plan](web_checkface_delivery_plan.md), then [migration and preservation strategy](migration_plan.md). Supporting snapshots: [closeout decisions](delivery_closeout_2026-09-16.md) and [desktop validation](desktop_ci_and_gpu_validation.md).

Latest operator requirements in the governing plan take precedence over earlier conflicting notes:

- Get the live browser site working first; desktop GPU may remain a labelled skeleton for that milestone. Then implement and qualify native GPU backends across the agreed hardware matrix, independent of browser/WebView GPU, with CPU fallback and Oliver's Manjaro gate. This remains mandatory to complete the overall task; CPU-only packages are insufficient.
- Next and the eventual production site have no local TrueNAS/home-network dependency. Labs should also be independent, with only a minimal documented temporary exception if necessary.
- Click/tap/keyboard photo selection from empty face tiles and image drag-and-drop, using the shared photo/e4e workflow.

This review snapshot includes the four documents above. References to other workspace research files, test evidence and absolute local paths are provenance pointers and may not resolve on GitHub; they are not additional bundled evidence. Historical status sections remain dated and must not override current requirements. Implementation work continues separately; this branch changes documentation only.

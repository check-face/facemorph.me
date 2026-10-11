# Planning tasks

The active specification is
[repo-cleanup-and-architecture-refactor](../PLAN.md).
The single plan is the root `PLAN.md`. The former engine initiative is historical;
its first twelve task IDs were retained and broadened. Epic `fm-fy2` contains twenty tasks, with thirty-five blocking dependencies plus
parent links. All are **deferred** after repository bootstrap. No implementation,
experiment or deployment is implied by these records.

`issues.jsonl` is the portable task/status export. Local SQLite files, locks and
engine sidecars are ignored by this directory's `.gitignore`. Keep the export,
configuration and metadata; do not commit local database files.

With Beads Rust (`br`) available:

```sh
br list --label repo-cleanup-and-architecture-refactor --status deferred --json
br show fm-fy2.9 --json
br ready --json
```

`ready` is intentionally empty while tasks are deferred. When implementation is
explicitly started, change the planned task states to open while preserving all
blocking edges. Execution status belongs here; architectural/scope changes update
the specification and affected task descriptions together, retaining task IDs.

This pass used `br 0.7.4` from an existing local executable; `br` is not currently
on this workstation's PATH. It did not install a global tool. Local invocation:

```sh
BR_TOOL=/home/cdilga/Work/dev/morayfield-house-3d/reconstruction/experiments/2026-10-11-review-resolution-r1/tools/br
"$BR_TOOL" list --label repo-cleanup-and-architecture-refactor --status deferred --json
```

Descriptions include task rationale, acceptance, context, applicable contracts,
stop rules and prerequisites rather than relying on the original conversation.
Markdown links inside descriptions use repository-relative paths.

The 11 October revamp clarification is reflected in these descriptions: idiomatic
TypeScript and the React/Vite recommendation, supplied crop references, ordered
multi-selection/keypoints, per-slot cancellation/retry and hold-to-compare removal.
The browser/desktop alignment ruling remains part of applicable task context.

This fresh repository owns ongoing task execution. The retained classic checkout
contains the historical local task DB/export; do not run two independent task
queues for this initiative. All source migrations must record classic provenance.

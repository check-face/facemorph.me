# Candidate hosting

Updated **16 September 2026**. Scope and acceptance gates: [current candidate plan](current-delivery-scope.md).

| Component | Direction |
|---|---|
| Site and runtime/model assets | Independent Cloudflare static hosting. No home server, TrueNAS or tunnel origin. |
| Large models | Sequential verified chunks of at most 16 MiB, below the static-host 25 MiB file limit. Verify each chunk and the complete original model; keep canonical cache identity unchanged. |
| Public image gallery | Reviewed synthetic seed/name allowlist only. No recovered or uploaded photos. |
| Optional diagnostics | Private Cloudflare Worker/KV, explicit opt-in that persists until turned off, 30-day record expiry. Workers Free confirmed by the operator. Quota failures must not block generation. |
| Temporary diagnostics fallback | TrueNAS allowed only if necessary; document its removal plan. Never use it for required product assets or inference. |
| Desktop downloads | GitHub artifacts/releases appropriate to the skeleton scope; only advertise verified behavior. |
| Labs | Separate research surface; prefer independent hosting and document any temporary local dependency. |

No paid upgrades or overages authorized. Third-party availability cannot be guaranteed forever; the requirement is independence from operator machines. R2 or another model host remains an alternative, not an assumed free-forever dependency.

Before handoff, prove fresh downloads, generation, photo encoding and export without home infrastructure; separately verify optional diagnostic delivery and non-blocking failure. A tunnel-backed holding page or completed upload alone is not acceptance. Leave classic/Triton routes untouched.

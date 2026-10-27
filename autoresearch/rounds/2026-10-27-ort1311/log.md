# ORT 1.31.1 journal

### 2026-10-27T01:24:23+00:00 — ORT1311-CLASSIC-CPU-SCREEN-V1-OBSERVED

- Phase: observed. npm latest was 1.31.1. Its 34,586,352-byte tarball passed registry SHA-512 and SHA-1 checks before extraction; all 58 distribution file digests were retained.
- Scope: the existing frozen classic CPU synthesis screen. Seven canaries passed, provider WASM, max RGB 1 and max sampled float 5.304813385009766e-06; unchanged gates 1 and 0.002.
- Inputs: source, manifests, package identity, all six selected runtime entries and qualifier/harness hashes are in [the raw result](evidence/classic-cpu.json.raw). Exact invocation, output and acquisition receipts are retained beside it.
- No timing samples are scored: the raw admission duration is an unpaired correctness-run diagnostic. Encoder, full31, native EP, device, memory and adoption acceptance remain open.
- Cleanup: the two task-owned browser/TLS directories were removed after browser close and a task-reference audit; inaccessible systemd/pam/sshd daemon entries are identified in the raw cleanup receipt. No privileged audit is claimed. Staged public release bytes are retained outside Git.
- Next: establish release-consistent unshared encoder bytes before encoder qualification and paired comparisons.

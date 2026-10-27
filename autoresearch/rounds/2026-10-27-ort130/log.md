# ORT 1.30 qualification journal

### 2026-10-26T21:32:00+00:00 — QEH-CPU-SETUP-1

- Phase / status: observed / correctness before timing.
- Experiment: ORT130-CPU-TEMPCPU-V1; no correction of a ledger result.
- Identity: control manifest `d9e37e50…`, candidate `d8ed9d5c…`, copied package
  distribution `5e1397e8…`; full hashes in the round summary and raw receipts.
- Context: fmci Ubuntu container, Node 24.22.1, Playwright 1.64.1, actual Chrome
  for Testing 156.0.8078.4 ELF SHA-256
  `377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025`.
- Correctness: both 286-file runtime graphs and 94 fixture files verified;
  control Chromium executed all 31 cases with no skips, maximum RGB difference
  1 and sampled float error `9.357929229736328e-6`. Candidate correctness is
  running. No performance samples have been collected on this cell.
- Resources: about 139 MB of task scratch, reusing existing immutable caches;
  over 6 GB free. No runner or shared cache was changed.
- Failures: earlier eris timing attempts were rejected by their load guard;
  they establish no paired result. A shared-tree Firefox attempt rejected its
  changed distribution identity; fixed-copy Firefox control and JSPI CPU checks
  subsequently passed all 31 cases with identical raw results.
- Evidence: local-only raw setup/correctness files remain in
  `/home/runner/fm-qeh-cpu-measure-20261026T2126` in fmci; parent will retain the
  qualifying reports before removing task scratch.
- Next: candidate correctness, then bounded control/control noise. No timing,
  deployment, physical-phone or full-release result is inferred from setup.

### 2026-10-26T21:41:00+00:00 — QEH-CPU-NOISE-REFUSED-1

- Phase / status: observed / blocked timing, not a performance result.
- Experiment: ORT130-CPU-TEMPCPU-V1; no earlier row is corrected.
- Correctness: candidate and control each passed all 31 Chromium CPU cases,
  no skips. All 31 raw RGB/float errors match; maxima 1 and
  `9.357929229736328e-6`, within unchanged limits 1 and 0.002. Both complete
  286-file runtime graphs, fixed copied distribution and browser ELF verified.
- Attempt: one control/control noise invocation, UID 1001, shared absolute
  `cpu-timing` lock, disk profiles, ceiling 6, timeout 1200 seconds. The existing
  load guard stopped the first warmup. The report records no crossing value,
  zero completed visits and zero scored samples. Default two discarded warmups
  and ABBA x3 were unchanged. No comparison or retry ran.
- Resources: observed task scratch peaked at 307,777,536 bytes with 10-second
  sampling; 139,108,352 bytes after profile cleanup. Minimum observed filesystem
  free space during the attempt was 5,870,637,056 bytes. Shared-host activity
  continued; no CI job, cache or runner was changed to obtain timing.
- Evidence: complete raw reports, invocation, resource samples and separate
  logs are retained in the candidate's `evidence/` directory, with an external
  SHA-256 list. Failed noise report SHA-256 is
  `e2d7d67e8b525c997d01ece6e9ba518c18f9d1d8c4fbc2bf4e883a9dc640d9a2`.
- Conclusion / next: CPU correctness passes on this cell; timing remains blocked
  by load. Preserve the failed attempt and clean only the owned remote scratch.
  CI repair remains the priority; no performance, mobile, application, adoption
  or deployment claim follows from these results.

### 2026-10-26T21:42:00+00:00 — QEH-RECORD-PATH-1

- Phase / status: implemented / records layout corrected before commit.
- Import verification refused new files under the historical frozen
  `autoresearch/candidates/` tree. Moved the complete new candidate record into
  this round's `candidates/ort130-serial-cpu-tempcpu-v1/` and updated its links.
  Imported history and its checker remain unchanged; raw evidence bytes are
  unchanged. Both research checks must pass before pushing.

### 2026-10-26T21:43:00+00:00 — QEH-CPU-CLEANUP-1

- Phase / status: observed / owned remote scratch removed after evidence audit.
- Exact path `/home/runner/fm-qeh-cpu-measure-20261026T2126` was removed using
  symlink-safe directory removal after checking no task process remained and
  profiles were empty. Approximately 139 MB freed. Runtime and dependency-cache
  target directories survived; their manifest and Playwright package hashes
  match before and after. Shared lock metadata remains. No other remote path
  was removed. The candidate retains the unchanged `cleanup-result.json.raw`.

### 2026-10-26T21:49:52+00:00 — QEH-PHONE-NATIVE-GPU-1

- Phase / status: observed / local flagged phone GPU route and budgets pass.
- Exact prior qeh artifact `d10d38fa…` and native serial root `d8ed9d5c…`, actual
  Huawei P30 Pro Android 10 / Chrome 150.0.7871.128. The lab used
  `--enable-unsafe-webgpu --ignore-gpu-blocklist`; unflagged visitors on this
  blocklisted driver are not qualified as GPU by this result.
- Genuine cold then warm face journeys rendered via the GPU, with no CPU
  fallback. Cold face 31.66 s / complete journey 42.1 s within 70 s; warm face
  22.8 s / journey 33.1 s within 50 s. These single visits are not paired
  performance evidence. The loaded document SHA matches the staged artifact.
- Raw reports record `typedExactly: false`: the page capitalized `lab0cold` and
  `lab0warm` to `Lab0cold` and `Lab0warm`. This route/budget check does not establish
  exact-case input preservation or full release acceptance. Peak summed Chrome
  PSS is 6,891 MiB, not encoder heap or GPU allocation; phone photo/e4e remains
  untested. Five other release cells are explicitly missing from this run.
- Evidence: unchanged summary and per-cell JSON in the candidate's
  `evidence/phone-webgpu/`, original output
  `tools/device-lab/out/20261027-074728-fm-qeh-ort130-phone-gpu-verified`.
- Cleanup: camera status confirms streaming false, no webcam/watchdog process
  and heldOff true; the task server no longer listens on 8443. Device lock
  released. The initial launcher failed before device I/O (unset uv shim); an
  incorrectly transcribed runtime digest then refused server startup before
  device I/O. The verified attempt computed SHA-256 from the actual manifest.
  No failed startup is relabelled a passing journey.

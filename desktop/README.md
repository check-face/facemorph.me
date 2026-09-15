# CheckFace desktop source candidate

**Development only; no release published.** This Tauri 2 shell reuses the existing
F# / Fable / Elmish / React frontend. The native CPU worker is independent of
WebGPU. It supports qualified diagnostic synthesis and linear PNG sequences;
seed/photo mapping, custom geometry, MP4, user-facing adapter integration and
production reliability admission remain separate work.

## Build and check

The web owner builds `deploy/` using the existing Fable/webpack toolchain. Staging
copies that shared frontend, excludes server/API/deployment files and source maps,
and generates a SHA-256 inventory. The shell blocks remote network requests; the
classic UI's old API controls therefore remain unavailable until the Next adapter
is integrated. This is a desktop source candidate, not an advertised fallback app.

Verified on Mac ARM64, 14 September 2026: shared-asset staging and manifest checks;
compiled Tauri shell; five supervisor lifecycle/protocol scenarios; updater
verification primitive rejecting tampering; all 31 native CPU cases (maximum RGB
error 1, sampled float error 0.000010014); three linear PNG frames with preserved
project metadata/explicit W+ space; corrupt-bundle and wrong-space rejection.
The app launched and reported rendered Elmish DOM through actual IPC, then closed
its own process. Runs: `060007Z-51d8816b` (source/native) and `060328Z-17396538`
(launch) under `autoresearch/state/20260914T…/`. Detailed native evidence is in
gitignored `local-native/verification.json`.

From the workspace root, with Rust and the local research Python environment:

```sh
python3 autoresearch/run.py --lane build --device local-mac --timeout 600 -- python3 facemorph.me/desktop/scripts/verify-source.py
```

This stages the real frontend, tests packaging, builds/tests Rust, pins local native
assets and runs all 31 CPU reference cases plus a three-frame linear project through
the same Rust supervisor used by the app. The generated `local-native/` manifest
contains local research paths and is gitignored. It is not a distributable model
bundle. `native/requirements.txt` pins the tested Python packages. `Cargo.lock`
pins the shell and updater dependency graph. First dependency download may require
network access; subsequent verification uses Cargo offline.

The separate `tests/startup_smoke.py` requires macOS window access and runs under
the same lease. It waits for positive DOM evidence (maximum 20 seconds), not just
a surviving process. The initial test caught and fixed a real updater-null-config
startup panic; disabled updater configuration now supplies empty endpoints/key.

For local shell startup after building, run `desktop/src-tauri/target/debug/checkface-desktop`.
Configure the host environment with absolute `CHECKFACE_NATIVE_PYTHON`,
`CHECKFACE_NATIVE_WORKER` (`desktop/native/worker.py`) and `CHECKFACE_NATIVE_BUNDLE`
(`desktop/local-native/bundle.json`) paths. Renderer inputs never select executables,
arguments or filesystem paths. A distributable app must replace these development
settings with verified bundled assets and a packaged native runtime.

## Native boundary

The project JSON matches `src/Next/ProjectJson.fs`: explicit schema v1 fields and
stable kind strings and explicit latent `space` (`w-plus` for this adapter).
No F# union serialization is used. Commands are `native_start`
with `{schemaVersion:1,jobId,type,route,...}`, `native_cancel` with `jobId`, and
`native_release`. Events on `native-event` contain schema/version, job ID and
`progress`, `completed`, `failed`, `cancelled` or diagnostic `qualified` type.
Qualification additionally carries a separate `attemptId`; stale attempts are rejected.

The supervisor permits one job, limits requests/events/queues, checks protocol
identity and successful process exit, enforces deadlines and kills cancelled workers.
The worker verifies the bundle, every loaded asset and ORT version, forces CPU,
and checks full-resolution synthetic references before generation. Qualification
runs all 31 cases; generation reruns endpoint/stress canaries. Returned qualification
is explicitly `developmentOnly`; it must **not** dispatch production `Runtime.Qualified`
until reliability/device admission is certified. GPU/custom/video routes are not
advertised. W+ controls already include truncation and are not truncated again.

Generated artifacts use opaque UUIDs in app-local storage, retain the exact project
and frame checksums, and have a `COMPLETE` marker only after success. Interrupted
folders remain incomplete and must never appear as successful exports. Future UI
integration needs save/export and cleanup controls; no private data is logged.

## Updater and release handoff

The updater plugin is linked but has no endpoint/key or frontend permission in the
preview. `CHECKFACE_UPDATER_PUBLIC_KEY=... node desktop/scripts/prepare-release.mjs`
(from the repo root) writes a gitignored release overlay with signed updater
artifacts and the repository's HTTPS `latest.json` endpoint. It does not sign,
build or publish. Supply only a public key; production signing secrets belong in
a protected build environment. Configure platform signing/notarization separately.

Next release stage: protected manual GitHub workflow, build matrix, draft
`desktop-v<semver>` Release, installers and updater payloads/`.sig`, SHA256SUMS,
model/license manifest, release notes and version-matched `latest.json`. Publish
only tested OS/architecture entries and never point the feed at unavailable assets.
All platforms are unqualified for distribution; the source proof is Mac ARM64 CPU.
No production keys or actual releases are created by this task.

The source tests check configuration and the pinned updater's signature-verification
primitive with public test vectors and tampered payload/signature rejection. This
is **not** an updater installation test. UI update checks/download/progress,
save-before-restart, clean install, N→N+1 update, wrong-key rejection, interrupted
transfer and recovery remain mandatory release/integration evidence. Checksums do
not replace artifact signatures. Back up the protected signing key before release.

Primary references checked 14 September 2026:
[Tauri updater](https://v2.tauri.app/plugin/updater/),
[GitHub builds](https://v2.tauri.app/distribute/pipelines/github/),
[native sidecars](https://v2.tauri.app/develop/sidecar/).

## Cross-platform candidate CI (15 September 2026)

`desktop-candidates.yml` builds the **actual shared Elmish frontend** once, then
runs Windows x64 (`windows-2022`), Linux x64 (`ubuntu-22.04`) and Mac ARM64
(`macos-14`) jobs. Candidate branch pushes, relevant pull requests and manual
runs are supported. All jobs have read-only repository permissions; no release,
updater feed, signing secret, live host or deployment is involved.

Each OS runs Rust supervisor/recovery tests and signature primitive tests. Windows
and Linux additionally build the real full-resolution model from the checksum-pinned
original checkpoint and compare native ORT CPU output with independent Torch
references before packaging. Every platform then builds an unsigned NSIS installer, Debian package or zipped macOS app. The job
installs the Windows/Linux package or extracts the Mac app into a path containing
spaces, launches the resulting executable from an unrelated working directory,
and requires actual rendered Elmish DOM plus IPC rejection of a missing native
runtime. Linux uses Xvfb and the runner's software graphics path. Every package
gets a byte-size/SHA-256 inventory and source revision. CI artifacts expire after
14 days; **these are packaging previews, not usable generation releases**.

The candidate deliberately contains no Python runtime or model weights. Missing
model/runtime failure is tested, not hidden. Signed installation, native runtime
bundling, model acquisition/cache integration, updater installation/recovery,
complete workflows, other architectures and real GPU qualification remain open.
An unsigned app launched by CI does not prove Gatekeeper/SmartScreen acceptance.
Ubuntu packaging success does not prove Manjaro install compatibility.

### Required Windows/Linux full-model CPU integration

The default workflow checks out the pinned upstream NVlabs reference implementation,
acquires the official checkpoint with explicit research-license acknowledgement,
exports a portable ONNX graph and creates **31 deterministic CI integration cases**.
These are distinct from the preserved historical research fixture31; passing them
proves real full-model CPU execution on that runner, not historical artifact parity
or research winner admission. The normal Rust supervisor invokes the normal worker
for all31 and a three-frame sequence, checks every PNG hash/dimension, retains exact
project metadata and rejects corrupt bundles and wrong latent space.

Model bytes and checkpoint files are not uploaded as CI artifacts. Only numerical
evidence and package artifacts are uploaded. Windows/Linux CPU checks are required,
not an optional manually supplied bundle. Mac shell packaging remains in the matrix;
its independently recorded local CPU evidence does not stand in for another OS.

### Optional prebuilt-bundle CPU evidence

`desktop-native-inference.yml` takes an operator-approved HTTPS portable ZIP URL
and its independently recorded SHA-256. The ZIP contains `bundle.json`,
`bundle.sha256` and all assets referenced by the existing development schema,
using **relative paths inside the bundle**. Download/extraction and every asset
are bounded and checked; paths outside the bundle and symlinks are rejected.
Check model distribution permission before making a bundle available to CI.
The workflow does not fetch a developer's local paths or silently replace a model.

It compiles the real supervisor, installs pinned CPU requirements and runs all31
full-resolution reference cases plus a three-frame morph and corrupt-bundle /
wrong-space rejection on each runner. Example for an already verified local bundle:

```sh
python desktop/tests/native_integration.py --bundle /path/to/bundle.json --report /path/to/evidence.json
```

This is **development CPU diagnostic evidence**, distinct from simulated protocol
tests and from release admission. No GPU, app UI inference, sustained memory,
photo/video, install-time model download or final bundle qualification is implied.
The optional workflow has not run without an approved portable asset bundle.

### Required physical-device handoff

Oliver's **Manjaro install + actual native GPU generation** remains a mandatory
independent gate. Record exact GPU, driver, desktop/display session, package,
model/runtime versions and checksums, and backend execution evidence. A GPU listed
by `nvidia-smi` or a successfully opened app is not proof of GPU inference. Test
with browser GPU generation unavailable, CPU fallback independently, all31,
retained workflows, project reopening and install/update recovery. A VM with
software rendering can test packaging; it cannot satisfy this GPU gate.

Local checks completed while introducing this CI: three lightweight Python tests
cover package tampering/missing/extra files, portable-path escape rejection and
missing-bundle failure without model dependencies; both Node packaging tests pass.
Remote matrix results are the authority for platform build/install status; do not
infer a pass from the existence of these workflows.

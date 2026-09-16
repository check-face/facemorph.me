# FaceMorph desktop product candidate

Current delivery uses the integrated Next UI and a bundled native CPU runtime for
seed/text synthesis, photo alignment/e4e, full-1024 local originals, editable
projects, morph video and native file export. Six OS/architecture CI jobs test the
actual packaged worker and installed controls. Builds are unsigned research and
evaluation previews; native GPU and complete cross-platform qualification are
still required. See the 16 September product section below for current commands.

## Historical shell milestone (14–15 September)

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
runs Windows x64 (`windows-2022`), Linux x64 (`ubuntu-22.04`) and macOS (`macos-14`; architecture recorded in artifact evidence)
jobs. Candidate branch pushes, relevant pull requests and manual
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

### Executed baseline: 15 September 2026

[Run 34940915155](https://github.com/check-face/facemorph.me/actions/runs/34940915155)
passed at source commit `e3c4b31`. All three OS jobs passed release-mode Rust
protocol/recovery and updater-signature tests, Python integrity/source-acquisition
tests, package checksums and actual packaged Elmish/IPC startup. The frontend job
compiled the shared Fable app and passed packaging plus model-cache boundary tests.

| Target | Artifact installation/launch | Real native CPU diagnostic |
| --- | --- | --- |
| Windows x64 | NSIS installed and executable launched from a path with spaces | CI31 + three-frame sequence passed; maximum RGB error 1, sampled float error 0.0000118018 |
| Linux x64 | Debian package installed; executable launched under Xvfb | CI31 + three-frame sequence passed; maximum RGB error 1, sampled float error 0.0000395179 |
| macOS ARM64 | App archive extracted; actual executable launched | Not part of this CI run; earlier local CPU evidence is separate |

Mac architecture was checked from the actual packaged Mach-O executable. Startup
required rendered Elmish DOM and graceful missing-native-runtime IPC rejection;
that is not app-integrated generation. The native CLI diagnostic used the same
supervisor/worker, real full-resolution synthesis, exact project roundtrip, all
three PNG checksums/dimensions and numerical endpoint comparisons. A proposed
additional numerical midpoint check remains deferred, not part of this result.
No GPU or final release-admission result is claimed.

The workspace record is
`review-artifacts/delivery-followup-2026-09-15/desktop/`: final run metadata,
per-platform installer/app inventories and startup reports, numerical CPU reports,
and a deferred refinement patch. Model bytes were not uploaded with the reports.

## Integrated product runtime (16 September)

`runtime.mjs` implements the same product-facing operations as the browser adapter:
`qualify`, `generate({mode,value})`, `encodePhoto(Blob)`, `synthesize(latent)`,
`cancel`, `dispose`, and `status`. `product_worker.py` performs independent native
ONNX Runtime CPU inference, original NumPy seed/text mapping, native dlib alignment,
e4e encoding, synthesis and persistent full1024 PNG reuse. Encoder and synthesis
sessions are sequential. Photo latents bypass mapping/truncation. Morph frame
geometry/video encoding use the shared product frontend and call native synthesis.

The app resolves `native/checkface-worker[.exe]` and `native/manifest.json` in its
installed resources, never a renderer-controlled executable/path. Python, ORT,
dlib/Pillow/SciPy dependencies are frozen for the target architecture with
`build-native-runtime.py`. Model assets are separately acquired from the bundled
manifest's pinned HTTPS descriptors, verified before use, cached by content hash,
and resumed after interrupted downloads. The resource build needs a manifest with
`mapping`, `synthesis`, `average`, `noise`, `canaries`, `sampleIndices`, `encoder`
and `landmarks`. No source checkout, system Python or Triton is needed by the
frozen worker. This does not grant model distribution/use rights.

The candidate-branch/manual `desktop-product.yml` workflow builds six actual target
architectures, executes seed/text/photo/cache/project-latent workflows against
the frozen native worker, includes those bytes in the desktop package and checks
installed controls. Model-heavy qualification is not added to copy-only deployment
jobs. Frozen Mac ARM64 has passed all 31 cases and native photo alignment/e4e against
an independent Torch latent reference (maximum absolute difference 0.000003517).
Physical native GPU, full matrix execution, signed updater and final installed
UI/video/share evidence remain required. Do not publish these as fully
qualified downloads until those gates pass. CI runner/wheel availability failures
remain explicit, not silently converted into unsupported platform exclusions.

Development helpers:

```sh
python -m pip install -r desktop/native/requirements-product.txt
# Stage the frontend first; runtime packaging adds its pinned manifest/catalogue.
npm run build:next
node desktop/scripts/stage-frontend.mjs --source deploy-next
python desktop/scripts/build-native-runtime.py --manifest /path/to/reviewed/manifest.json
cd desktop
node ci-tools/node_modules/@tauri-apps/cli/tauri.js build --config candidate-config.json --config native-resources-config.json
```

The older `worker.py`/`local-native` diagnostic contract stays separate from the
product worker. Production resource selection takes precedence; the original
environment-based development override is permitted only in debug shell builds.

The six architecture runner labels follow the current
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
(checked 16 September 2026). The build verifies the Python interpreter's OS/architecture
and supplies an explicit Rust target, so an emulated x64 worker cannot be labelled
ARM64. Runner availability is not inference qualification.

Two dependency constraints are handled explicitly in the six-target workflow:

- Upstream ORT 1.24.3 publishes no macOS Intel Python wheel; that job builds the
  matching pinned upstream source commit rather than downgrading the runtime.
- dlib 20.0.1's Windows Python setup hardcodes CMake's x64 architecture. The ARM64
  job verifies the exact source archive and applies a guarded architecture-only
  patch before building. The native interpreter/worker must report ARM64.

These build branches require actual CI success; source availability is not a
claim that their artifacts have run. Dependency metadata was checked against the
[official ORT package](https://pypi.org/project/onnxruntime/1.24.3/) and
[pinned dlib setup source](https://github.com/davisking/dlib/blob/v20.0.1/setup.py).

Linux product packaging includes both DEB and AppImage. The portable AppImage is
also launched in CI with extraction mode, so Manjaro is not offered a DEB-only
installer. Actual Manjaro installation/native GPU remains a required independent
device result; generic Ubuntu/AppImage startup does not substitute for it.

Installed-product rehearsal is now implemented in `tests/installed_product.py`:
it launches the actual package, exercises the real product controls for seed/text,
photo/e4e, editable project reopening, figure-eight video playback and native
filesystem export. Host-only test flags isolate data/export paths and choose a
synthetic photo; they do not replace inference or codecs. Interactive save-dialog
selection/cancellation is a separate manual check. A saved original is checked
before any model qualification/loading; only a cache miss starts admission.

`catalogue-source.json` pins the complete public names catalogue for inclusion in
the desktop frontend. Image CSP permits only the approved seed-gallery origin in
addition to local/blob images. Private photos are never uploaded to that gallery.
Dependency/model notices ship in the frozen runtime's `notices/` directory.
Native asset requests identify the product explicitly and use a bundled certifi
trust store; HTTPS verification and content hashes remain mandatory on every OS.

> **16 September CI test-selection decision:** Routine CI tests active shipping artifacts and meaningful regressions, using dependency-aware triggers. Abandoned research candidates are excluded from deployment jobs; heavy inference/performance work reruns only when relevant or explicitly requested. Preserve full initial qualification and honest artifact-bound evidence. See [purposeful test policy](web_checkface_delivery_plan.md#purposeful-ci-and-research-test-selection--16-september-decision).

> **16 September CI/CD decision:** Adapt the existing pipelines and autoresearch runners to test the real browser bundles, installed desktop packages and Docker image digests. Promote the same verified artifacts; source/unit checks and package startup alone do not close workflow gates. See [artifact testing contract](web_checkface_delivery_plan.md#cicd-tests-the-deliverable-artifacts--16-september-decision).

# Desktop and CPU validation — 15 September 2026

## Acceptance

Windows x64 and Linux x64 must pass **real full-model CPU inference in CI**, in addition to compilation, protocol tests and installer/startup checks. Use each OS's hosted runner; a Linux container cannot validate the Windows binary or installer. macOS can be qualified locally under the cooperative local-mac lease for now. CI timings are diagnostic, not clean performance benchmarks.

The native inference test invokes the same Rust supervisor and ONNX Runtime Python worker used by the desktop source. Deterministic CI fixtures verify the complete 1024px model and output files. They do not replace the frozen research qualification suite, historic-output checks, complete UI workflows or release admission. CI acquires pinned upstream assets on the ephemeral runner; model redistribution through public artifacts is not part of this work.

Candidate packages are unsigned build artifacts. Install/startup success does not establish a signed public release, complete inference runtime installation, updater migration or a usable native GPU route. Those remain delivery gates.

## Read-only GPU host assessment

Observed 15 September 2026 with SSH, PCI/KVM/IOMMU inventory and `nvidia-smi`; no host configuration changed. Utilization is a momentary sample, not spare-capacity proof.

| Host | Observed GPU | Virtualization evidence | Assessment |
|---|---|---|---|
| Triton | GTX 1080, 8,118 MiB; driver 470.256.02 | `/dev/kvm` present; zero visible IOMMU groups | Production GPU services remain active. This is not an available passthrough test GPU; enabling/reassigning it would require separate host changes and approval. |
| TrueNAS | GTX 1050, 2,048 MiB; driver 550.142 | `/dev/kvm` present; 50 IOMMU groups | GPU showed activity. Passthrough feasibility alone does not establish a spare device or sufficient model memory. |

TrueNAS documents GPU isolation before VM assignment, additional GPU requirements and reboots for isolation changes. Do not change the active GPU allocation to satisfy CI. [TrueNAS GPU management](https://www.truenas.com/docs/scale/systemsettings/advanced/managegpu/).

A future dedicated GPU runner or VM must record hardware/driver/provider, prove actual GPU execution and pass unchanged correctness and recovery fixtures. Keep it separate from untrusted public pull-request jobs. GitHub GPU larger runners are a separate provisioned service, not assumed free capacity. [GitHub larger runners](https://docs.github.com/en/actions/concepts/runners/larger-runners).

## Required human qualification

Oliver's actual Manjaro installation and native GPU inference remain mandatory before the first desktop release/cutover. Record his GPU and driver rather than assuming CUDA. Test native generation with the browser GPU route disabled, project transfer, exports and actual update/recovery. Neither a Windows/Linux CPU CI pass nor another Linux GPU host closes this gate.

## Execution status

- Candidate source: `candidate/desktop-ci-20260915` in facemorph.me. Required Windows/Linux full-model CPU checks are implemented. The [current run](https://github.com/check-face/facemorph.me/actions/runs/34940915155), revision `e3c4b31`, has passed the shared Fable frontend, 16 model-cache tests and real native CPU inference on Windows x64 and Linux x64. Each CPU run passed all 31 independent Torch cases (maximum RGB error 1; maximum sampled float error 3.95e-5 Linux / 1.18e-5 Windows), a three-frame linear PNG sequence, project roundtrip and corrupted-bundle/wrong-latent rejection. **The complete run passed:** Linux `.deb` installation/startup, Windows NSIS installation/startup (including paths with spaces), and macOS ARM64 app extraction/startup. Package bytes and checksum inventories were verified. Startup tests ran on CI build hosts; independently provisioned clean-machine install and bundled-runtime generation remain release work. An earlier Fable type-namespace failure was fixed; no CPU success is inferred from compilation.
- Self-host CPU allocation, persistent lossless originals and restart/inference checks: `candidate/self-host-validation-20260915`, tested revision `264356b`, [CI run](https://github.com/check-face/checkface/actions/runs/34940400054) **passed** on Linux amd64. The run included clean image build, real concurrent generation/cache reuse, retained API/photo/media routes and reuse after API restart.
- Browser model cache: 16 isolated Node tests passed. Typed Fable boundary compiled successfully with the app in CI; app wiring remains separate. Partial-download resumption and real-browser/model qualification remain open.

Evidence: `review-artifacts/delivery-followup-2026-09-15/desktop/` and `selfhost/`. Candidate artifacts remain CI artifacts; no stable Release or production deployment was made. The full [delivery plan](web_checkface_delivery_plan.md) still gates preservation, integrated browser/native workflows, lawful distribution, updater testing, diagnostics and the 28-day comparison.

## Next work after the CPU baseline

| Work | Can proceed before inference winners freeze? | Required evidence |
|---|---|---|
| Browser cache integration and download recovery | Yes, against the typed adapter | Actual browser restart/offline/cancellation/quota checks, interrupted-transfer resumption, unchanged bytes across model/app versions |
| New Elmish loading/generation/help/diagnostic flow | Yes, with controlled adapter states | Explicit Generate, preserved style, appropriate dismissible device guidance, sanitized optional report preview/send/offline recovery |
| Archive and names preservation | Yes | Complete census/classification, checksummed export/restore, all 5,055 names resolve, identical names layout/interactions, independent maintainer rehearsal |
| Desktop runtime setup and distribution | Yes, pin a development bundle for setup tests | Portable runtime/model installation, actual installed generation, permitted asset distribution, signed releases and N→N+1 update/recovery; Manjaro-compatible package |
| Native GPU and Oliver's Manjaro test | Hardware details are still needed | Real device/provider execution, unchanged correctness fixtures and complete install/use/update report |
| Final model/worker integration and custom morphs | Final admission waits for versioned winners | Frozen research fixtures, full photo/morph/export/project workflows, memory/cold/warm/recovery evidence across the declared matrix |
| Separate candidate site and public comparison | After integration/review | Useful invitation, optional diagnostics verified, at least 28 useful comparison days, resolved failures and preservation gates |

The result of this pass is a repeatable CPU and artifact validation baseline plus tested independent source improvements. It is not a claim that only model selection remains or that production cutover is ready.

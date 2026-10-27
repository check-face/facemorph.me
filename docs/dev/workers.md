# Development workers (fm-wzy)

Inventory taken on 24 October 2026 from the machines themselves (SSH, `gh api`, a real browser). An installed GPU
or a runner label is not inference evidence; the adapter column is what a real browser reported.

| | eris | triton | TrueNAS | operator's Mac + iPhone |
| --- | --- | --- | --- | --- |
| Access | the workstation itself (`ssh eris`, `eris-remote`) | `ssh triton` (`chris@192.168.11.18`) | unreachable: no SSH key from eris is accepted (`root@`, `truenas_admin@192.168.11.12` refuse publickey) | not registered |
| OS | Omarchy (Arch), kernel 7.2.5 | Ubuntu 20.04.6, kernel 5.4 | not checked (unreachable) | — |
| CPU / RAM | 12 threads / 31 GB | 20 threads / 125 GB | — | — |
| Disk | 1.9 TB, 172 GB free (91 %) | 25 October: root 458 GB, 61 GB free; runner work/cache pool has 3.1 TB free | — | — |
| GPU, driver | RTX 2080 SUPER, 610.57 | GTX 1080, 470.256 | GTX 1050 (classic lane docs) | — |
| Vulkan ICD | `nvidia_icd.json` (+ Intel) | `nvidia_icd.json` (+ lvp, Intel, Radeon) | the host runner lacks the NVIDIA ICD (llvmpipe); the containerised `gpu-vulkan` runner has it (classic) | — |
| Docker / CDI | Docker 29.7.2, nvidia-ctk 1.20.0 | Docker 24.0.2, nvidia-ctk | — | — |
| Node | 26.8.2 system; CI uses setup-node | none system; CI uses setup-node | — | — |
| Browsers | system Chromium 152; Playwright 1.64 browsers; Chrome for Testing 141.0.7390.54 (GPU lane pin); browser-harness 0.1.8 in `~/Work/runs/venv-bh` | none; Playwright 1.64 does not support Ubuntu 20.04 | — | — |
| WebGPU adapter, real browser | `nvidia turing`, hardware (headless, Vulkan via ANGLE; `requestAdapter()` answers once the GPU process is up, a few seconds after launch). SwiftShader forced: fallback adapter, refused (`autoresearch/workers/check.mjs --software`) | not capturable: no supported browser | not captured (unreachable) | untested |
| Timing lock directory | `~/.cache/facemorph/locks` or `FACEMORPH_LOCK_DIR`; phone lock is separate | same account-local default or `FACEMORPH_LOCK_DIR` | untested (fm-ip6g) | — |
| Runners (this repository) | `eris-device-lab` (labels `device-lab, eris, android-p30pro, gpu-rtx2080s`: the only one that takes device-lab jobs), plus `eris-build-2` through `eris-build-5` (labels `eris, eris-build, linux-x64`) | Four: `triton`, `triton-2`, `triton-3`, `triton-4` (all `triton, linux-x64, cpu-20`; the first also `gpu-gtx1080`) | none; its runners (`truenas`, `truenas-gpu`) serve classic only | none |

## Lanes and tasks

- **eris**: the device lab (the phone and the GPU, one `device-lab` instance), the GPU lane (`next-gpu-lane.yml`),
  the research workflows, browser end-to-end and parity, model conversion, hosting staging. Four build/test
  instances run beside the device-lab one. Correctness runs share compute without a
  machine-wide lease; the physical phone is local-only with its own lab lock.
- **triton**: compatible work explicitly assigned to its Triton-specific labels;
  removed from the portable CPU pool on 27 October (fm-kfs5, below). The disk-full inventory above is
  historical; a read-only SSH check on 25 October found 61 GB free on root and
  3.1 TB free in `/mnt/unit/gh-runners` on tank. Runner workspaces, TMPDIR and
  npm/uv/browser caches remain on that pool. Workerd also requires newer glibc
  than Triton's 2.31; its deploy/runtime tests run in the eris hosting lane.
  Four triton runners and five eris runners were online. Ubuntu 20.04 still cannot
  run the current Playwright browser stack.
- **TrueNAS**: optional (fm-ip6g); nothing waits on it.
- **Mac and iPhone**: until the operator registers the Mac as a runner (labels `mac`, `iphone`), the Mac WebGPU
  and physical-iPhone cells are reported untested with that blocker, never skipped silently.

## Opportunistic CPU capacity (fm-sziz)

Operator policy on 25 October allowed compatible work on Triton while available.
The 27 October fm-kfs5 correction removed it from ordinary portable CPU scheduling.
The subsequent fm-jx26 qualification assigns the six scaffold check groups,
the dependency-free change selector and the browser-free checks listed below to
its specific `triton` label. Dependency policy and all browser/workerd jobs retain
the qualified portable pool.
Triton does not regain `linux-x64`.

Observed pool on 27 October after the operator-directed label changes:

- Portable jobs use `runs-on: [self-hosted, linux-x64]`: the four eris build slots
  and `tempcpu-2` through `tempcpu-5` retain that label. The latter also retain `tempcpu`.
- Triton runner IDs 3, 25, 26 and 27 no longer have `linux-x64`; their Triton-specific
  labels remain. The inventory table above records the earlier observation.
- `tempcpu-1` (runner ID 30) has only `facemorph-artifact` as a custom label and is
  reserved for `next-site-artifact.yml`, which uses `[self-hosted, facemorph-artifact]`.
  It is outside the portable and `tempcpu` pools; the device-lab runner is also outside
  the portable pool. Jobs already running when labels changed are allowed to finish.

The portable pool needs GitHub CLI (`gh`) on its service PATH for artifact lookup
tests, in addition to the workflow-provided Node toolchain. After an observed
`spawnSync gh ENOENT` scaffold failure, Triton received the checksum-verified
upstream CLI 2.103.2 in `/usr/local/bin/gh`; the real expired-classic-artifact test
passed there on 25 October. New/rebuilt workers need the same prerequisite.

Pure Node qualification on 27 October used immutable source `35ec8c1`, cached
Node 24.22.1 and the current lockfile store on Triton. All six exact scaffold groups
passed: format 0.9s, lint 0.5s, typecheck 9.9s, seeded violations 15.3s,
format stability 2.5s and package checks/packs 3.0s. The prerequisite workspace
build took 12.1s; the final source diff was empty. The real same-dataset cache
restore was a hardlink hit in 24.9s. A scratch checkout outside the
`/mnt/unit/gh-runners` dataset fell back to a 44.5s copy. Dependency policy stays
on the faster portable cache to keep pipeline startup short. These are standalone
qualification timings, not measured main-pipeline improvement or browser support.
Additional browser-free commands were qualified on immutable source `e082c1d`
(`import-inventory` used `4bf1987`) before moving their jobs to Triton:

| Job | Actual command results on Triton |
| --- | --- |
| identity-check/check | Pinned checksum-verified gh 2.101.0, four sibling clones and 20 tests passed, zero skips (37.3s of tests) |
| rename-check/check | 7 API tests and all 13 rename assertions passed (80.0s + 7.1s) |
| import-checks/checks | Node/Python tests, real app build/identity check and destination checks passed; destination checks 24.6s |
| import-inventory/checks | All eight commands passed with full classic history at the frozen commit; 39 tests, zero skips, 32.6s of checks |
| import-closure/checks | Unit tests, exclusion/resolution scans and independent retained-control download/pin checks passed |
| research-ledger/check | Full-history classic clone, ledger tests and append-only checks passed |
| web-shell/check | Real app inventory and bridge import scans passed (0.5s); browser siblings retain their pools |
| native-retirement/check | 21 tests passed against the real built destination, zero skips |

The same qualification restored the current lockfile's dependency tree by hardlink
in 1.1s and built the actual app in 12.1s. These are executed standalone commands,
not a claim about main wall time. Existing artifact restoration, pinned tools,
checkouts and assertions remain in each workflow. App-contracts stays portable:
its Node command includes real browser cases, and Triton reported those cases
untested because it lacks a supported browser.

GitHub can assign independent portable jobs to the eligible eris and temporary CPU
slots. Four Triton slots share its 20 threads and 125 GiB RAM; they are not four
separate 20-thread machines. Run compatible work concurrently on its specific
labels rather than reserving the whole host for one check.
The main workflow still finishes its running revision before taking the newest
pending revision; it can execute independent jobs within that revision in parallel.

The dedicated `fmci` container keeps runner IPC alive independently of login sessions.
Its GitHub runner services use UID 1001 (`runner`) without a PAM session. With logind's
default `RemoveIPC=yes`, ending a temporary `su - runner` session removed active jobs'
`/dev/shm` compiled modules, browser profiles and trace files after the 10-second user
stop delay. The 27 October repair is `/etc/systemd/logind.conf.d/60-facemorph-runner.conf`:

```ini
[Login]
RemoveIPC=no
```

`systemctl reload systemd-logind` applied the policy to the running container.
`busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager RemoveIPC`
reports `b false`. A UID-1001 `/dev/shm` canary survived runner logout and the full
stop delay. Include this policy when rebuilding the service-runner container.

The pool includes scaffold build/typecheck/test/pack, package contracts, web-shell
builds, import/inventory/identity checks, diagnostics Docker tests, native-retirement checks and
the artifact lookup job. The site artifact build uses its reserved runner; tracker publication
is outside the push path (fm-kfs5). Jobs requiring eris's browsers, qualified model cache,
provider tools or GPU stay there until another runner has those capabilities
verified. Docker is available on both hosts, but that alone is not evidence that
a browser/GPU lane works in a container on Triton. Inference-hosting retirement
does not retire Triton's CI capacity or its monitoring services.

GitHub's shared labels provide availability, not a preference for the fastest
machine or automatic recovery of a running job. If an eligible runner disappears during a job,
that attempt can fail and must be rerun on an available worker; never mark it as
passing. Portable jobs have explicit execution timeouts (at most 45 minutes;
10 for the workflow's change selector), bounding a stalled running attempt. Keep implementing independent work. If the eligible pool is unavailable, CI
waits for capacity while local work can continue. No Triton-specific readiness
job or machine-wide correctness lock is added. Only timing measurements take the
exclusive measurement lock; the physical phone keeps its own local device lock.

## Heavy work moved off hosted minutes

Classic ran `research-built-ui-media-v1.yml` on hosted `ubuntu-24.04` with a 55-minute budget and
`research-rgba-screen-v1.yml` with 20 minutes; both now run on eris (fm-qqh), explicitly dispatched for timing research. The GPU lane has no
hosted equivalent (no hosted GPU), so it only ever ran on a self-hosted machine. They are not correctness gates on each push.

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
| Lease directory | `/home/cdilga/.local/state/facemorph/lease` (devices `eris`, `p30pro`) | `/home/chris/.local/state/facemorph/lease` (device `triton`) | not set (fm-ip6g) | — |
| Runners (this repository) | `eris-device-lab` (labels `device-lab, eris, android-p30pro, gpu-rtx2080s`: the only one that takes device-lab jobs), plus `eris-build-2` through `eris-build-5` (labels `eris, eris-build, linux-x64`) | Four: `triton`, `triton-2`, `triton-3`, `triton-4` (all `triton, linux-x64, cpu-20`; the first also `gpu-gtx1080`) | none; its runners (`truenas`, `truenas-gpu`) serve classic only | none |

## Lanes and tasks

- **eris**: the device lab (the phone and the GPU, one `device-lab` instance), the GPU lane (`next-gpu-lane.yml`),
  the research workflows, browser end-to-end and parity, model conversion, hosting staging. Four build/test
  instances run beside the device-lab one. Correctness runs share compute without a
  machine-wide lease; the physical phone is local-only with its own lab lock.
- **triton**: builds, gates, unit and package tests. The disk-full inventory above is
  historical; a read-only SSH check on 25 October found 61 GB free on root and
  3.1 TB free in `/mnt/unit/gh-runners` on tank. Runner workspaces, TMPDIR and
  npm/uv/browser caches remain on that pool.
  Four triton runners and five eris runners were online. Ubuntu 20.04 still cannot
  run the current Playwright browser stack.
- **TrueNAS**: optional (fm-ip6g); nothing waits on it.
- **Mac and iPhone**: until the operator registers the Mac as a runner (labels `mac`, `iphone`), the Mac WebGPU
  and physical-iPhone cells are reported untested with that blocker, never skipped silently.

## Opportunistic CPU capacity (fm-sziz)

Operator policy, 25 October: use Triton fully for compatible work while it is
available; if it is unavailable, continue on eris. It is not a required dependency
for development or the ordinary CPU CI checks.

Portable jobs use `runs-on: [self-hosted, linux-x64]`. All four Triton runners and
all four eris build runners advertise those labels; the device-lab runner does not.
GitHub can assign independent jobs to either machine, so queued CPU work remains
eligible for eris when every Triton runner is offline. Four Triton slots share its
20 threads and 125 GiB RAM; they are not four separate 20-thread machines. Run useful
builds/tests concurrently rather than reserving the whole host for one check.
The main workflow still finishes its running revision before taking the newest
pending revision; it can execute independent jobs within that revision in parallel.

The pool includes scaffold build/typecheck/test/pack, package contracts, web-shell
builds, import/inventory/identity checks, diagnostics Docker tests, tracker publication, native-retirement checks, the site artifact build and
the artifact lookup job. Jobs requiring eris's browsers, qualified model cache,
provider tools or GPU stay there until another runner has those capabilities
verified. Docker is available on both hosts, but that alone is not evidence that
a browser/GPU lane works in a container on Triton. Inference-hosting retirement
does not retire Triton's CI capacity or its monitoring services.

GitHub's shared labels provide availability, not a preference for the fastest
machine or automatic recovery of a running job. If Triton disappears during a job,
that attempt can fail and must be rerun on an available worker; never mark it as
passing. Portable jobs have explicit execution timeouts (at most 45 minutes;
10 for the workflow's change selector), bounding a stalled running attempt. Keep implementing independent work. If both hosts are unavailable, CI
waits for capacity while local work can continue. No Triton-specific readiness
job or machine-wide correctness lock is added. Only timing measurements take the
exclusive measurement lock; the physical phone keeps its own local device lock.

## Heavy work moved off hosted minutes

Classic ran `research-built-ui-media-v1.yml` on hosted `ubuntu-24.04` with a 55-minute budget and
`research-rgba-screen-v1.yml` with 20 minutes; both now run on eris (fm-qqh), explicitly dispatched for timing research. The GPU lane has no
hosted equivalent (no hosted GPU), so it only ever ran on a self-hosted machine. They are not correctness gates on each push.

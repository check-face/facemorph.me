# Development workers (fm-wzy)

Inventory taken on 24 October 2026 from the machines themselves (SSH, `gh api`, a real browser). An installed GPU
or a runner label is not inference evidence; the adapter column is what a real browser reported.

| | eris | triton | TrueNAS | operator's Mac + iPhone |
| --- | --- | --- | --- | --- |
| Access | the workstation itself (`ssh eris`, `eris-remote`) | `ssh triton` (`chris@192.168.11.18`) | unreachable: no SSH key from eris is accepted (`root@`, `truenas_admin@192.168.11.12` refuse publickey) | not registered |
| OS | Omarchy (Arch), kernel 7.2.5 | Ubuntu 20.04.6, kernel 5.4 | not checked (unreachable) | — |
| CPU / RAM | 12 threads / 31 GB | 20 threads / 125 GB | — | — |
| Disk | 1.9 TB, 172 GB free (91 %) | 458 GB, **0 bytes free (100 %)** | — | — |
| GPU, driver | RTX 2080 SUPER, 610.57 | GTX 1080, 470.256 | GTX 1050 (classic lane docs) | — |
| Vulkan ICD | `nvidia_icd.json` (+ Intel) | `nvidia_icd.json` (+ lvp, Intel, Radeon) | the host runner lacks the NVIDIA ICD (llvmpipe); the containerised `gpu-vulkan` runner has it (classic) | — |
| Docker / CDI | Docker 29.7.2, nvidia-ctk 1.20.0 | Docker 24.0.2, nvidia-ctk | — | — |
| Node | 26.8.2 system; CI uses setup-node | none system; CI uses setup-node | — | — |
| Browsers | system Chromium 152; Playwright 1.64 browsers; Chrome for Testing 141.0.7390.54 (GPU lane pin); browser-harness 0.1.8 in `~/Work/runs/venv-bh` | none; Playwright 1.64 does not support Ubuntu 20.04 | — | — |
| WebGPU adapter, real browser | `nvidia turing`, hardware (headless, Vulkan via ANGLE; `requestAdapter()` answers once the GPU process is up, a few seconds after launch). SwiftShader forced: fallback adapter, refused (`autoresearch/workers/check.mjs --software`) | not capturable: no supported browser | not captured (unreachable) | untested |
| Lease directory | `/home/cdilga/.local/state/facemorph/lease` (devices `eris`, `p30pro`) | `/home/chris/.local/state/facemorph/lease` (device `triton`) | not set (fm-ip6g) | — |
| Runners (this repository) | `eris-device-lab` (labels `device-lab, eris, android-p30pro, gpu-rtx2080s`: the only one that takes device-lab jobs) and, from 24 October, `eris-build-2`, `eris-build-3` (labels `eris, eris-build, linux-x64`) as systemd user services `gh-runner-facemorph-build-{2,3}` | `triton` (labels `triton, linux-x64, gpu-gtx1080, cpu-20`), one instance | none; its runners (`truenas`, `truenas-gpu`) serve classic only | none |

## Lanes and tasks

- **eris**: the device lab (the phone and the GPU, one `device-lab` instance), the GPU lane (`next-gpu-lane.yml`),
  the research workflows, browser end-to-end and parity, model conversion, hosting staging. Two build/test
  instances run beside the device-lab one, so independent jobs no longer queue; every heavy step takes the eris
  device lease (`.github/actions/device-lease`), so a GPU or the phone is never shared, whichever instance runs it.
- **triton**: builds, gates, unit and package tests (scaffold, import checks, inventory, contracts). **Blocked from
  more:** its root filesystem is full (0 bytes free on 24 October), which breaks any job that writes, and Ubuntu
  20.04 is below Playwright 1.64's floor, so it cannot carry CPU end-to-end or the GTX 1080 GPU lane until the
  disk is cleared and the OS upgraded (operator). Extra runner instances there wait for the same.
- **TrueNAS**: optional (fm-ip6g); nothing waits on it.
- **Mac and iPhone**: until the operator registers the Mac as a runner (labels `mac`, `iphone`), the Mac WebGPU
  and physical-iPhone cells are reported untested with that blocker, never skipped silently.

## Heavy work moved off hosted minutes

Classic ran `research-built-ui-media-v1.yml` on hosted `ubuntu-24.04` with a 55-minute budget and
`research-rgba-screen-v1.yml` with 20 minutes; both now run on eris under the lease (fm-qqh). The GPU lane has no
hosted equivalent (no hosted GPU), so it only ever ran on a self-hosted machine. Per push that touches their
paths, the two research workflows save about 75 hosted minutes.

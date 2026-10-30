# Research round: phone WebGPU vs CPU by GPU class — 2026-10-30

Status: measuring.
Journey and bottleneck: a face on the Huawei P30 Pro (ARM Mali-G76, Bifrost) with Chrome's WebGPU enabled, which is
slower than the same phone's CPU route (device lab 28 Oct: warm face 22 s on WebGPU against 16 s on CPU). Finish
boundary: the lab's warm-face and cold-face journeys (face drawn).
Exclusions: desktop routes and engines (unchanged), iPhone and Adreno (Galaxy S24 Ultra) phones (unchanged; the
Samsung row stays pending with the operator), numerical tolerances.
Budget: device-lab phone-webgpu cell under the lab lock, alternating candidate/control artifacts; stop at a clear
win or loss.

## Identity and evidence

Control artifact: local identified build of main before each candidate, runtime manifest
d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c. Device: Huawei P30 Pro (VOG-L29), Android 10,
Chrome 150.0.7871.128 with the lab's `--enable-unsafe-webgpu --ignore-gpu-blocklist`. Adapter (probed 30 Oct): vendor
`arm`, architecture `bifrost`, maxStorageBufferBindingSize 268435456, maxBufferSize 1073741824, shader-f16.
Lab runs: `tools/device-lab/out/20261030-*-fm-ve6a-*` (local to eris).

## Candidates

See experiments.md. E1: direct WGSL engine on ARM phones. E2: ARM Mali phones default to the CPU route.

## Integration and remaining gates

Owner bead fm-ve6a. A kept change still needs the operator's Samsung report before it counts as kept.

## Records

`log.md` (append-only) · `experiments.md` · `../../results.tsv` · `../../records.md` · `../../program.md`.

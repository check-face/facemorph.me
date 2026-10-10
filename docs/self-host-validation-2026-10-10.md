# Self-host API validation — 10 October 2026

Implemented and published source revision
`e7c582bfe172770d96e085bb21bb81461a9439bb` adds NVIDIA GPU Docker support and
repairs the self-host quickstart/API documentation. The bundled historical UI
is pinned to `0abb215f27b16e17e3919cf78b616b6ae4998a5d`; the current
`next.facemorph.me` frontend performs inference locally and does not use this API.

## Local GPU qualification

A full source build, fresh model downloads, and the complete retained API,
photo-encoder, cache and restart suite passed on an RTX 2080 SUPER 8 GiB,
Linux x86_64, NVIDIA driver 610.57.04, PyTorch 2.9.1+cu128 / CUDA 12.8.
[Full result and source hashes](../self-host/validation/2026-10-10/gpu.json).
All 26 Python source files matched the tested image.

A separate clone of the published GitHub branch then followed the documented
GPU build/setup/start commands with a new Compose project and empty volumes.
Host-side curl requests generated JPEG and MP4, uploaded/encoded a synthetic
face, reconstructed its saved GUID, and verified the GUID after restart.
[Fresh public clone receipt](review/self-host-fan-2026-10-10.json).
The clone build reused Docker dependency layers from the first build; model,
Mongo and media volumes were fresh. This proves source packaging and the GPU
installation path, not a second independent cold dependency build.

## CPU qualification

The source revision's independent Linux amd64/arm64 CPU build/inference workflow:
[run 38028133812](https://github.com/check-face/facemorph.me/actions/runs/38028133812).
Both jobs completed successfully: Linux amd64 and arm64. Each built the image
from source, downloaded the real models, verified API generation, encoding, media
and persistence after restart, and retained its exact tested container artifact.

## Delivery scope

This is source-only API delivery. No registry image/model bundle was published,
no production database or media was migrated, and the current candidate website
was not redeployed by this API change. NVIDIA runtime/model terms remain in force;
local building does not grant new usage rights. Other NVIDIA GPUs/drivers, Jetson,
Windows/WSL2 and macOS were not physically tested.

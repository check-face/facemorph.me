# Run your own FaceMorph API

Build and run the original FaceMorph API and UI with Docker. The API supports
seed/text faces, saved latents, photo encoding, morph frames, GIF/WebP/MP4 and link
previews. MongoDB stores saved GUIDs; Docker volumes preserve models and media.
The newer browser-inference site is a separate application.

The bundled UI is built from historical commit
`0abb215f27b16e17e3919cf78b616b6ae4998a5d` plus the
[recorded overlay](frontend-overlay/README.md). The current candidate frontend
at `next.facemorph.me` performs inference locally and does **not** use this API.
Checking out the candidate branch below retrieves the self-host packaging;
Docker separately builds that pinned historical UI.

## NVIDIA GPU quickstart (Linux)

Install Git, Docker Engine with Compose v2, a current NVIDIA driver, and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
Follow NVIDIA's installation instructions for your distribution, including:

```sh
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
nvidia-smi
```

Restarting Docker can interrupt other containers. Your host needs a driver
compatible with CUDA 12.8 (Linux driver 570 or newer), an NVIDIA GPU supported by
PyTorch's CUDA 12.8 wheels, and sufficient free VRAM. Start with an 8 GB GPU,
8 GiB system RAM and 30 GiB free disk; leave room for generated media. The first
build downloads dependencies and compiles dlib/the original UI; allow several
minutes, longer on a small machine. No host Python, .NET SDK or CUDA toolkit is
needed. NVIDIA drivers and the Container Toolkit remain host-installed.

Review the model/source terms below, then:

```sh
git clone --branch candidate/next-delivery-20260916 https://github.com/check-face/facemorph.me.git
cd facemorph.me/self-host
export COMPOSE_FILE=compose.yml:compose.gpu.yml
docker compose build
docker compose run --rm setup --accept-research-license
docker compose up -d --wait --wait-timeout 300 api
curl --fail http://localhost:8080/healthz
curl --fail 'http://localhost:8080/api/face/?seed=0&dim=512' --output face.jpg
```

Open **http://localhost:8080** for the original UI. `/healthz` must report
`"provider":"cuda"` and your GPU name. GPU mode fails startup if CUDA cannot be
used; it never silently selects CPU. Setup downloads about 1.7 GB of original
model assets from their authors, checks byte counts and SHA-256 hashes, and reuses
verified files on repeat runs. No service account or API key is needed.

The generator and e4e photo encoder execute on CUDA; face alignment and FFmpeg
remain on CPU. This uses NVIDIA's pinned PyTorch model converter and PyTorch CUDA
operators with full-resolution FP32 synthesis and constant noise. It does not
compile NVIDIA's optional custom CUDA kernels, require an NGC account, or pull
an NVIDIA CUDA base image. CUDA dependencies come from the official PyTorch
wheels. Both model and dependency terms still apply. Images are built on your
machine; this repository does not redistribute model files or publish a GPU image.

The override requests one NVIDIA GPU through Docker. To select a particular GPU,
replace `count: 1` in `compose.gpu.yml` with `device_ids: ["0"]` (use the host index
or GPU UUID from `nvidia-smi`). Do not specify both `count` and `device_ids`.

## CPU alternative

Use the same checkout and setup commands with `unset COMPOSE_FILE` instead of the
GPU override. The default Compose file builds CPU PyTorch; no NVIDIA driver or
GPU is needed. CPU generation is slower, especially long animations. CPU Linux
amd64 and arm64 have been qualified; GPU qualification is recorded below. Do not
assume that every NVIDIA architecture, Jetson, macOS or Windows native Docker has
been tested. WSL2 users need working NVIDIA GPU passthrough into Docker first.

## Use and manage it

[API reference](../docs/api.md) documents parameters, defaults and responses.
Keep `COMPOSE_FILE` exported in each shell used to manage the GPU installation
(or supply `-f compose.yml -f compose.gpu.yml` to every Compose command).

```sh
curl --fail 'http://localhost:8080/api/hashdata/?value=hello'
curl --fail 'http://localhost:8080/api/mp4/?from_seed=0&to_seed=1&dim=256&num_frames=4' --output morph.mp4
curl --fail -F usrimg=@face.jpg -F tryalign=true 'http://localhost:8080/api/encodeimage/'
docker compose logs --tail=100 api
docker compose restart api
docker compose down
```

`down` preserves models, media, latent records and upload deduplication.
**`down --volumes` deletes them, including saved GUIDs.** Each installation starts
with its own empty database; public-site GUIDs do not exist in it.

The default bind is localhost. Set `CHECKFACE_PORT=8081` if port 8080 is occupied.
On a remote machine, keep it private and use
`ssh -L 8080:127.0.0.1:8080 user@your-server`, then open localhost in your browser.
For LAN access, `CHECKFACE_BIND=0.0.0.0 docker compose up -d api` exposes the API on
host interfaces. For a domain, point a reverse proxy such as Caddy or nginx at
`127.0.0.1:8080` and configure HTTPS. Allow long request timeouts for animations.
There is no authentication or per-client rate limiting; choose access through
your firewall/proxy. Mongo has no published port. Public/commercial use remains
subject to the component terms below.

Troubleshooting:

- GPU reservation/driver errors: check `nvidia-smi`, Container Toolkit setup and
  `docker compose run --rm --no-deps api python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"`.
- CUDA out of memory: free GPU memory used by other applications or use a larger
  GPU. Smaller `dim` still synthesizes at 1024px internally.
- Model download fails: rerun setup. Checksums prevent an error page or incomplete
  download from being loaded; existing verified downloads are reused.
- Startup/health fails: inspect `docker compose logs api`. The service needs all
  model downloads completed, Mongo ready, and a compatible CUDA driver in GPU mode.

## Retained API behavior

Existing parameter details are in [the original API documentation](../docs/api.md).
The implementation and [route inventory](legacy-route-inventory.json) preserve:

| Routes | Retained behavior |
|---|---|
| `/api/face/`, `/api/<text>` | Text, numeric seed or saved GUID; JPEG/WebP; dimension defaults and bounds; original text hash and seed mapping. |
| `/api/hashdata/`, `/api/registerlatent/` | Original JSON latent representation and UUID response; Z and W+; original blend/style parameters. |
| `/api/morphframe/` | Original linear slider and sinusoidal looping schedules; mixed Z/W+ endpoints. |
| `/api/gif/`, `/api/webp/`, `/api/mp4/` | Original looping frames, frame count, dimensions, FPS/bitrate and MP4 embed option; cached outputs. |
| `/api/linkpreview/` | Original composite preview generation with the deployed static branding assets. |
| `/api/encodeimage/` GET/POST | Existing upload form and multipart `usrimg`/`tryalign`; original e4e and dlib preprocessing; `{guid,did_align}` response and deduplication. |
| `/api/queue/`, `/status/` | Existing queue/status responses. |
| `/oembed.json` | Original UI photo/embed metadata with local URLs. |
| `/`, static UI paths | Original FaceMorpher UI configured for same-origin API calls. |
| `/healthz` | Additional readiness check for local Compose. |

The separate early `/v1` prototype is no longer the served API. New API features,
figure-eight/custom modes are outside this compatibility package. Existing frontend production defaults are preserved;
self-host settings are a small overlay on a pinned original source revision.

Practical differences are explicit: CPU/CUDA timings, bounded request admission and
clearer invalid-input errors; modern PyTorch/Pillow/FFmpeg can change numeric
rounding or compressed bytes. This is not a claim of byte-identical historic JPEGs
or of production encoder parity. The generator uses the original checkpoint,
constant noise, full 1024px synthesis and truncation psi 0.7/cutoff 8.

A fresh installation has **its own empty database and cache**. Existing public
GUIDs require an authorized restore of their records; URLs alone do not recover
private latents. The candidate retains Mongo database `test`, collections
`latents` and `encodedimages`, and the original cache directory layout under
`/app/checkfacedata`. Restore a copy into this project's volumes and verify it
independently before migration. Do not mount production volumes or assume that
copying historical Mongo data files across major versions is safe; use a logical
Mongo backup/restore with supported tools. Preservation and live cutover remain
separate, explicitly approved operations.

## Validation

The CPU CI builds its own image, acquires the real models and exercises
actual HTTP inference. It retains tested images as temporary CI artifacts, not a public container release.
Compatibility checks cover retained routes, actual media, encoding and persistence;
mock-only unit tests do not establish end-to-end completion. Run the same checks locally:

```sh
docker compose exec -T api python smoke_frontend.py
docker compose exec -T api python test_runtime_device.py
docker compose exec -T api python test_legacy_contract.py
docker compose exec -T api python test_encoder_assets.py
docker compose exec -T api python test_encoder.py
docker compose exec -T api python smoke_legacy.py
docker compose exec -T api python smoke_encoder_http.py
docker compose restart api
docker compose up -d --wait --wait-timeout 300 api
docker compose exec -T api python smoke_legacy.py
docker compose exec -T api python smoke_encoder_http.py
```

The repeated HTTP checks verify existing GUIDs, encoded-upload records and media
survive restart. Long-morph unit checks cover both 199 and 200 frames with bounded
live image buffers. See [candidate CI runs](https://github.com/check-face/facemorph.me/actions/workflows/self-host-build.yml)
for the tested commit and complete Linux build/inference logs.

Python/Torch/direct dependencies and source revisions are pinned. Base-image
digests, complete dependency hashes, distribution SBOM and broader platform
qualification remain release work. Linux arm64 and amd64 are the CPU test platforms. GPU builds use CUDA 12.8;
see the [GPU validation record](validation/2026-10-10/gpu.json) for the hardware actually tested.

For a GPU install, also run `docker compose exec -T api python smoke_gpu.py`.
It checks CUDA passthrough and an uncached image generated over HTTP.
To run the complete local contract, media, photo and restart suite, use
`./verify.sh` after starting the API. Keep `COMPOSE_FILE` set for GPU mode.

## Model and source terms

Review each component's terms for your intended use before accepting setup:

- [Original NVIDIA StyleGAN2 terms](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt) and [pinned conversion code terms](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/d72cc7d041b42ec8e806021a205ed9349f87c6a4/LICENSE.txt) restrict use to research/evaluation and require retained notices. The latter stays at `/opt/stylegan/LICENSE.txt`.
- GPU builds also install CUDA libraries from PyTorch's official wheels. Their
  bundled notices and [NVIDIA CUDA terms](https://docs.nvidia.com/cuda/eula/index.html)
  apply, as do the host driver/Container Toolkit terms. Local builds and avoiding
  an NVIDIA base image do not waive those terms; no GPU/runtime image is published here.
- [e4e source and checkpoint provenance](https://github.com/omertov/encoder4editing) and the vendored [MIT source license](e4e/LICENSE); source licensing alone does not replace model/data terms.
- [dlib landmark-model notice](https://dlib.net/face_landmark_detection.py.html) identifies the iBUG training dataset's noncommercial restriction.
- CheckFace's [CC BY-NC 4.0 license](licenses/CheckFace-LICENSE.txt), the original frontend's source provenance, and third-party dependency notices also apply. No new license for the frontend is invented by this overlay.

Local building is not an exemption from usage restrictions. The setup flag records
acknowledgement; it grants no rights. General public/commercial operation or
redistribution needs its own licensing review. This candidate shares source only.

## CPU allocation and retained originals (15 September follow-up)

`CHECKFACE_CPU_THREADS=auto` selects at most eight PyTorch model threads, bounded
by CPU count, process affinity and visible cgroup v1/v2 CPU quotas (including
ancestors). Fractional quotas round down, with a minimum of one thread. Override
with an integer 1–64; overrides are capped to detected allocation. Invalid values
fail startup. For example, `CHECKFACE_CPU_THREADS=4 docker compose up -d api`.
`/healthz` and startup logs report requested/effective settings. Hidden host quotas
cannot be discovered; set a smaller override when necessary. This is a bounded
starting policy, not a benchmarked optimum. Small/large allocation timing and
health responsiveness under real inference still require qualification.

These are model intra-op threads, also used by the encoder in this process.
HTTP concurrency remains sixteen workers/eight generation admissions; changing
model threads does not create extra inference jobs. FFmpeg retains its separate
two-thread limit. The GPU override selects CUDA independently of these CPU thread settings.

The legacy generator adapter now writes private lossless 1024×1024 RGB PNGs to
`cache:/app/checkfacedata/originals-v1` **before resizing**. Every synthesis route
uses this adapter, including queued faces and morph frames. Different sizes and
formats reuse these raw pixels. Historic JPEG/WebP/media paths are untouched and
continue serving existing artifacts; they never count as original PNGs. The
separate early `/v1` prototype does not use this store.

Each original embeds a canonical identity and raw-pixel SHA-256. Identity includes
the verified loaded checkpoint hash, exact little-endian float32 resolved W+
bytes/shape, checkpoint-constant noise, output-pipeline version, PyTorch version,
CPU/CUDA provider and effective thread count. CUDA entries also identify the GPU,
compute capability and CUDA version. W+ identity is **after** mapping,
truncation and any photo preprocessing, so changed image-affecting inputs change
the key. It does not retain uploaded photo bytes or reconstruct their preprocessing
history. These originals can include photo-derived faces: this is private local
storage, **not the synthetic-only public preservation archive**. Bump the output
pipeline version whenever pixel conversion/synthesis semantics change.

A process/file lock deduplicates synthesis; each PNG atomically carries pixels and
provenance, with fsync before promotion. Interrupted staging and corrupt entries
are retried safely. `CHECKFACE_ORIGINAL_CACHE_BYTES` defaults to 10 GiB and limits
this namespace only; it does not limit historic derivatives/models. At capacity
or storage failure the generated result still returns, a warning/counter records
failed persistence, and existing originals are retained. There is no automatic
eviction. To reclaim space, stop the local API and explicitly remove selected
original PNGs from this namespace; later requests can regenerate them. Increasing
the quota requires recreating the API container. Cache bookkeeping currently
scans PNG sizes on writes; very large collections may need an indexed quota ledger.

`/healthz.original_cache` reports process-local hits, generated originals and
write failures. A restart retains pixels, but this server still initializes the
model eagerly and recomputes mapping before a W+ lookup; avoiding that startup
work is not claimed. Runtime/model/thread changes retain old files under separate
keys. Original-cache identity does not rewrite the historical derivative namespace.

Lightweight checks: `python test_cpu_threads.py`, `python test_original_cache.py`.
Inside the image also run `python test_adapter_cache.py` (real torch tensors,
fixture generator). Real-model HTTP evidence requires `smoke_original_cache.py`
before and after an API restart with its state file retained outside `/tmp` in the
recreated container, alongside the existing full-route/encoder smoke suite. The real-model HTTP suite verifies this integration.

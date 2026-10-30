# model-conv: build, convert, verify

> **A checkpoint is a Python pickle, and loading one runs its code.** Only convert a checkpoint you trust.
> model-conv refuses any checkpoint whose SHA-256 is not the one declared for the model.

model-conv turns a declared StyleGAN2 checkpoint into what the browser providers load: `mapping.onnx`,
`synthesis.onnx` in 16 MiB content-addressed chunks, `average.f32`, 17 constant noise planes and
`manifest.json` (digests, sizes, shapes, tolerance, provenance). `verify` checks every file against the
manifest, then runs the converted graphs under ONNX Runtime CPU against the pinned upstream PyTorch
implementation loading the original checkpoint. What has been qualified is in
[compatibility.md](compatibility.md).

Requirements: Docker on Linux x86-64. CPU only; no GPU is used or needed.

## Commands (from a clean clone)

<!-- ci: verbatim -->
```sh
cd packages/model-conv
docker build -t facemorph/model-conv .
IMAGE="facemorph/model-conv@$(docker image inspect --format '{{.Id}}' facemorph/model-conv)"

# Acquire the checkpoint yourself, under NVIDIA's terms, and check it:
mkdir -p ~/.cache/facemorph-model-conv/checkpoints
[ -f ~/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl ] || curl -fL \
  -o ~/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl \
  https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl
echo "adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d  $HOME/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl" | sha256sum -c -

mkdir -p out
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv convert --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv verify --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq

# The candidate runtime's own product canaries (RGB <= 1, sampled raw float <= 0.002) on the converted synthesis:
python3 tests/fetch_canary_runtime.py ~/.cache/facemorph-model-conv/runtime
docker run --rm --user "$(id -u):$(id -g)" \
  -v ~/.cache/facemorph-model-conv/runtime:/runtime:ro -v "$PWD/out":/out \
  facemorph/model-conv canaries --out /out/ffhq --runtime /runtime
```

`canaries` runs the candidate's canary comparison unchanged (`canary-qualification.mjs`: seven W+ canaries with
original, zero and negated noise, every RGB channel within 1 of the reference PNG after the product's output
pipeline, sampled raw floats within 0.002) and writes `out/ffhq/canaries.json`. `tests/fetch_canary_runtime.py`
fetches only the pinned runtime manifest (SHA-256 `d9e37e50…0a5c`) and its canary assets, each checked by digest.

### A non-face model: AFHQ cat, 512 px

The non-face fixture is NVIDIA's stylegan2-ada-pytorch AFHQ cat generator, a PyTorch pickle, under the
NVIDIA Source Code License-NC; the AFHQ dataset is CC BY-NC 4.0. Acquire it yourself under those terms; it is
never bundled. Its tolerance (raw 1e-3, RGB 1) is its own, declared in `model_conv/models.py` from its
reference before its first conversion; it does not inherit FFHQ's.

Acquire and check the checkpoint:

<!-- ci: verbatim -->
```sh
mkdir -p ~/.cache/facemorph-model-conv/checkpoints
[ -f ~/.cache/facemorph-model-conv/checkpoints/afhqcat.pkl ] || curl -fL \
  -o ~/.cache/facemorph-model-conv/checkpoints/afhqcat.pkl \
  https://nvlabs-fi-cdn.nvidia.com/stylegan2-ada-pytorch/pretrained/afhqcat.pkl
echo "f62fd750c51f649147ba355844833c0f2a37081f7c032194f52fd74a016c3a29  $HOME/.cache/facemorph-model-conv/checkpoints/afhqcat.pkl" | sha256sum -c -
```

Build the image, convert and verify:

<!-- ci: verbatim -->
```sh
cd packages/model-conv
docker build -t facemorph/model-conv .
IMAGE="facemorph/model-conv@$(docker image inspect --format '{{.Id}}' facemorph/model-conv)"

mkdir -p out
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv convert --model stylegan2-ada-afhqcat --checkpoint /checkpoints/afhqcat.pkl --out /out/afhqcat
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv verify --checkpoint /checkpoints/afhqcat.pkl --out /out/afhqcat
```

Its output is a 512 px model: 16 W+ layers of 512, 15 constant noise planes (4 px to 512 px), synthesis
output `[1, 3, 512, 512]`. Generation and morphs for it never load a face detector or the FFHQ e4e encoder:
FFHQ e4e is not an encoder for this generator.

### Photo encoder: e4e (FFHQ)

`convert-encoder` turns the official e4e FFHQ checkpoint into `encoder.onnx` (full FP32, opset 17,
`image [1,3,256,256]` to `w [1,18,512]`, latent average added once inside the graph) and the encoder stream: the
same graph split into sequential sessions of at most 16 MiB of initializers each (108 sessions), with
`stream/manifest.json` in the `e4e-onnx-sequential-shards-v1` form. `verify-encoder` builds the reference with
PyTorch from the original checkpoint (never from converted files), runs `encoder.onnx` and the stream (one session
at a time, released after use) under ONNX Runtime CPU on five planted qualification inputs
(`tests/e4e-qualification/`, copied into the image; they are inputs and recorded references, not weights), and
reports max absolute W+ error against the frozen 0.0001, and compares digests with the hosted encoder and stream.
It passes on identical digests to the qualified hosted artifacts or on numerical parity, and says which. Measured on
eris (x86-64, ONNX Runtime 1.24.3 CPU): `encoder.onnx` and all 108 sessions are byte-identical to the hosted ones;
four cases are within 3.1e-6, and `no-face-aligned` reaches 1.07e-4 (2.6e-5 with graph optimisation off). Because
the files are the hosted ones, that is how the hosted encoder behaves on this platform, recorded in `verify.json` as
a finding; the tolerance is never widened.

The checkpoint (`e4e_ffhq_encode.pt`, 1,201,649,680 bytes) has no stable public direct URL. Acquire it yourself from
the Google Drive link in the README of [omertov/encoder4editing](https://github.com/omertov/encoder4editing) and
place it at `~/.cache/facemorph-model-conv/checkpoints/e4e_ffhq_encode.pt`; the block below stops with a clear
message if it is absent or its SHA-256 differs. Terms: e4e code is MIT; the
model was trained on FFHQ (CC BY-NC-SA 4.0). It is never bundled, in Git or in the image.

<!-- ci: verbatim -->
```sh
cd packages/model-conv
docker build -t facemorph/model-conv .
IMAGE="facemorph/model-conv@$(docker image inspect --format '{{.Id}}' facemorph/model-conv)"

E4E="$HOME/.cache/facemorph-model-conv/checkpoints/e4e_ffhq_encode.pt"
[ -f "$E4E" ] || { echo "missing $E4E: download e4e_ffhq_encode.pt from the Google Drive link in https://github.com/omertov/encoder4editing and place it there" >&2; exit 1; }
echo "2ace1d9a8c05c10a399bcd500b8dda118f759ff1aac89dbdab7435f2136a0999  $E4E" | sha256sum -c -

mkdir -p out
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv convert-encoder --checkpoint /checkpoints/e4e_ffhq_encode.pt --out /out/e4e
docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="$IMAGE" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv verify-encoder --checkpoint /checkpoints/e4e_ffhq_encode.pt --out /out/e4e
```

Output: `out/e4e/encoder.onnx`, `out/e4e/stream/part-NNN.onnx` and `stream/manifest.json`, `manifest.json` (written
last) and `verify.json`.

Or through Compose (opt-in profile; same mounts and user):

```sh
CHECKPOINTS=~/.cache/facemorph-model-conv/checkpoints OUTPUT="$PWD/out" MODEL_CONV_UID="$(id -u)" MODEL_CONV_GID="$(id -g)" \
  docker compose --profile conversion run --rm convert convert --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq
```

`docker run ... facemorph/model-conv models` lists the declared models.

## Behaviour

- **Complete means `manifest.json` exists.** A run builds in `.partial-<name>-<pid>` beside the output and
  writes `manifest.json` last. A killed or failed run leaves no manifest; the next run removes the stale
  staging.
- **Repeat runs** refuse to overwrite a complete output; `--force` rebuilds it in staging and swaps it in.
- **Ownership:** run with `--user "$(id -u):$(id -g)"` (Compose does this) and outputs belong to you.
- **Reproducibility (measured on eris, 24 October 2026):** `mapping.onnx`, `average.f32` and all noise planes
  are byte-identical to the candidate's shipped files. `synthesis.onnx` is not (123,805,592 vs 123,805,596
  bytes), so byte reproducibility is not claimed for it; `verify` requires numerical parity instead
  (max raw error 1.2e-4, max RGB difference 1, against limits of 0.002 and 1).
- `verify.json` records the reference implementation, its module path and the checkpoint digest it read.

## Acceptance

`tests/doc_commands.py` runs every block marked `<!-- ci: verbatim -->` above verbatim from the repository root, and
`tests/acceptance.sh` runs all of the above with the real checkpoint and container, plus a perturbed chunk
(must fail), a wrong checkpoint (refused), a killed conversion, ownership and an image/package scan for
weights. Both need Docker and the checkpoints, so they run on a machine that has them, not in the hosted CI. Unit
tests: `python3 -m unittest discover -s tests -t .`.

## Updating the lock

Edit `requirements.in`, then regenerate `requirements.lock` inside the pinned base image:

```sh
docker run --rm -v "$PWD":/w -w /w python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 \
  sh -c "pip install -q uv==0.9.5 && uv pip compile -q --generate-hashes --python-version 3.12 \
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match -o requirements.lock requirements.in"
```

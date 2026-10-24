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

```sh
cd packages/model-conv
docker build -t facemorph/model-conv .

# Acquire the checkpoint yourself, under NVIDIA's terms, and check it:
mkdir -p ~/.cache/facemorph-model-conv/checkpoints
[ -f ~/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl ] || curl -fL \
  -o ~/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl \
  https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl
echo "adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d  $HOME/.cache/facemorph-model-conv/checkpoints/stylegan2-ffhq-config-f.pkl" | sha256sum -c -

mkdir -p out
docker run --rm --user "$(id -u):$(id -g)" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv convert --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq
docker run --rm --user "$(id -u):$(id -g)" \
  -v ~/.cache/facemorph-model-conv/checkpoints:/checkpoints:ro -v "$PWD/out":/out \
  facemorph/model-conv verify --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq
```

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

CI runs the first command block above verbatim from the repository root (`tests/doc_commands.py`), and
`tests/acceptance.sh` runs all of the above with the real checkpoint and container, plus a perturbed chunk
(must fail), a wrong checkpoint (refused), a killed conversion, ownership and an image/package scan for
weights. CI runs it on eris (`.github/workflows/model-conv.yml`). Unit tests: `python3 -m unittest discover -s tests -t .`.

## Updating the lock

Edit `requirements.in`, then regenerate `requirements.lock` inside the pinned base image:

```sh
docker run --rm -v "$PWD":/w -w /w python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 \
  sh -c "pip install -q uv==0.9.5 && uv pip compile -q --generate-hashes --python-version 3.12 \
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match -o requirements.lock requirements.in"
```

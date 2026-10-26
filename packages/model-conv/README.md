# model-conv

Converts a trusted StyleGAN2 checkpoint into the files a browser loads with `stylegan-js`, and verifies
the result against the upstream PyTorch implementation reading the original checkpoint. It is a Docker container
(this directory's `Dockerfile`, with an opt-in Compose service), released as source at a tagged commit of this
repository. It is not an npm package and not a registry image: you build the image yourself, from base images
pinned by digest, and you acquire every checkpoint yourself.

> **A checkpoint is a Python pickle, and loading one runs its code.** Only convert a checkpoint you trust.
> model-conv refuses any checkpoint whose SHA-256 is not the one declared for its model.

## What it produces

For a declared model, `convert` writes `out/<name>/`:

- `mapping.onnx`, and `synthesis.onnx` as 16 MiB content-addressed chunks;
- `average.f32` and the model's constant noise planes;
- `manifest.json`: every file's digest, size and shape, the model's declared tolerance and the provenance (image
  digest, tool versions, checkpoint digest).

`verify` checks each file against the manifest, then runs the converted graphs under ONNX Runtime CPU against the
pinned upstream implementation, at the model's declared tolerance, and writes `verify.json`.

These outputs feed the other packages in order:

1. **Host.** `cloudflare-model-host` stages `out/<name>/` for any HTTPS static host: it checks every
   digest, chunks files over 25 MiB and rewrites the manifest to hosted URLs (its README and guides).
2. **Manager.** `browser-model-manager` acquires the hosted files after the person authorizes the
   download, verifies them and stores them in the browser.
3. **Engine.** `stylegan-js` loads the model through the manager's verified local reader and maps,
   synthesizes and morphs.

## Build, acquire, convert, verify

Requirements: Docker on Linux x86-64. Conversion is CPU only. No NVIDIA/CUDA profile exists; a GPU is neither used
nor needed.

1. Clone this repository at a model-conv release tag (none has been published yet; until one is, use the commit
   named by the compatibility table's evidence run).
2. Run the commands in [docs/usage.md](docs/usage.md) from the repository root. They build the image, acquire a
   checkpoint under its terms and check its SHA-256, convert, verify and, for FFHQ, run the product canaries. CI
   runs each of those blocks verbatim (`tests/doc_commands.py`), on eris (`.github/workflows/model-conv.yml`).

The opt-in Compose service runs the same container: `docker compose --profile conversion run --rm convert …`,
with `CHECKPOINTS`, `OUTPUT`, `MODEL_CONV_UID` and `MODEL_CONV_GID` set (see `compose.yaml`).

## What has been validated

| | Status |
| --- | --- |
| Linux x86-64, Docker, CPU | qualified |
| NVIDIA GPU profile | untested: none exists; conversion is CPU only by design |
| Linux arm64, macOS, Windows | untested |

Which checkpoints convert, at what tolerance and with what evidence: [docs/compatibility.md](docs/compatibility.md).
Two are qualified today: FFHQ config-F (1024 px, 18 W+ layers) and AFHQ cat (512 px, 16 W+ layers, non-face).
Conditional models and StyleGAN3 are unsupported. Photo encoders are model-specific: the FFHQ e4e encoder works
only for the FFHQ face generator.

## Related packages

[cloudflare-model-host](../cloudflare-model-host/README.md) hosts the converted files,
[browser-model-manager](../browser-model-manager/README.md) acquires them in the browser and
[stylegan-js](../stylegan-js/README.md) runs them.

## Licences and notices

model-conv's code is MIT licensed (the repository's `LICENSE`). The image fetches NVlabs' stylegan2-ada-pytorch at a
pinned commit and uses it unmodified, under the NVIDIA Source Code License (non-commercial); see
[NOTICE.md](NOTICE.md) and `PROVENANCE.json`.

**No weights are included, in this directory or in the image.** Acquire each checkpoint yourself under its own terms:
the FFHQ and AFHQ checkpoints are NVIDIA's (NVIDIA Source Code License-NC); FFHQ images are CC BY-NC-SA 4.0 and AFHQ
images CC BY-NC 4.0. Converted files carry the terms of the checkpoint they came from, and converting grants no
model rights. When you host them, publish the licence texts beside them (the host package's README).

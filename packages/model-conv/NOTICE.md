# Notices

model-conv's own code is MIT licensed (the repository's `LICENSE`). This file lists the third-party code in its
build context and in the image built from it. `scripts/packages/check-notices.mjs` checks it against the build
context, the Dockerfile and `requirements.lock`, and with `--image` against the licences the installed Python
packages declare.

## In the build context

- **omertov/encoder4editing** (e4e), MIT: `model_conv/vendor/e4e/` is a subset of the e4e encoder source, used to
  load and export the e4e checkpoint. Copyright (c) 2021 omertov; the licence text is
  `model_conv/vendor/e4e/LICENSE`, and `model_conv/vendor/e4e/PROVENANCE.md` records where the subset came from.
  Within it:
  - `models/encoders/helpers.py` holds the ArcFace blocks e4e credits to
    [TreB1eN/InsightFace_Pytorch](https://github.com/TreB1eN/InsightFace_Pytorch) (MIT);
  - `models/encoders/equal_linear.py` is the `EqualLinear` layer extracted from e4e's StyleGAN2 model, which e4e
    took from [rosinality/stylegan2-pytorch](https://github.com/rosinality/stylegan2-pytorch) (MIT).
- Converter code ported from facemorph.me-classic (the same project, same licence) is listed with its source
  digests in `PROVENANCE.json`.

## Fetched into the image

- **python:3.12-slim**, pinned by digest in the `Dockerfile`: Python under the Python Software Foundation License,
  on Debian packages under their own licences (`/usr/share/doc/*/copyright` in the image).
- **NVlabs/stylegan2-ada-pytorch** at `d72cc7d041b42ec8e806021a205ed9349f87c6a4`, fetched from its GitHub archive
  (SHA-256 `e09a4f09…`, see `PROVENANCE.json`) and used unmodified: Copyright (c) 2021, NVIDIA Corporation. NVIDIA
  Source Code License for StyleGAN2 with Adaptive Discriminator Augmentation (ADA); the full text is `LICENSE.txt`
  in `/opt/upstream/stylegan2-ada-pytorch` inside the image. Non-commercial use only.
- **Python packages** installed from `requirements.lock` (hash-pinned), with the licence each declares:

| Package | Licence |
| --- | --- |
| certifi | MPL-2.0 |
| charset-normalizer | MIT |
| click | BSD-3-Clause |
| filelock | MIT |
| flatbuffers | Apache-2.0 |
| fsspec | BSD-3-Clause |
| idna | BSD-3-Clause |
| jinja2 | BSD-3-Clause |
| markupsafe | BSD-3-Clause |
| ml-dtypes | Apache-2.0 |
| mpmath | BSD-3-Clause |
| networkx | BSD-3-Clause |
| numpy | BSD-3-Clause |
| onnx | Apache-2.0 |
| onnxruntime | MIT |
| packaging | Apache-2.0 OR BSD-2-Clause |
| protobuf | BSD-3-Clause |
| requests | Apache-2.0 |
| setuptools | MIT |
| sympy | BSD-3-Clause |
| torch | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| typing-extensions | PSF-2.0 |
| urllib3 | MIT |
| pip (from the base image) | MIT |

Each package's full licence text is in its `*.dist-info` directory under `/usr/local/lib/python3.12/site-packages`
in the image.

## Not distributed

- **Checkpoints.** The caller acquires each checkpoint under its own terms. The FFHQ config-F and AFHQ cat
  checkpoints are NVIDIA's (NVIDIA Source Code License-NC); FFHQ images are CC BY-NC-SA 4.0 and AFHQ images
  CC BY-NC 4.0. The e4e FFHQ checkpoint was trained on FFHQ. Converted files carry the terms of the checkpoint they
  came from; containerisation grants no model rights.
- **The image.** It is built locally from this directory and is not pushed to any registry. Pushing it later
  needs a licence review of the image first.

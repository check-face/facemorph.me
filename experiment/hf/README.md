---
title: Facemorph — the next chapter
emoji: 🫧
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 6.13.0
python_version: 3.10.13
app_file: app.py
hf_oauth: true
pinned: false
short_description: A community trial for an archive-first Facemorph
---

# Facemorph: the next chapter

A separate, non-commercial research/evaluation trial alongside [classic Facemorph](https://facemorph.me).
Preservation first; limited new generation with Hugging Face sign-in. Seven classic synthetic images are included as an explicitly small archive sample.

## Run locally

Install `requirements.txt` into an isolated environment. Place the pinned generator in `models/generator.pkl` (see `models/provenance.json`). Build the existing frontend from its repository root (`../../`, branch `codex/hf-community-trial`), then run:

```sh
python scripts/build_frontend.py
FACEMORPH_LOCAL_DEMO=1 python app.py
```

Local mode binds to localhost and uses CPU. It does not demonstrate HF authentication or GPU allocation. On HF, the local bypass is disabled and new generation requires both OAuth and ZeroGPU. The queued endpoint is callable but rejects uncached anonymous requests before compute. No operator token is supplied to the browser. HF quota attribution and OAuth still require a live hosted test.

## Reusing Facemorph

The UI is compiled directly from [check-face/facemorph.me](https://github.com/check-face/facemorph.me). Its original Elmish components, inputs, theme, slider and sharing are retained. `FACEMORPH_TRIAL=1` selects the adapter at build time; a normal build keeps classic behavior. Gradio supplies OAuth and a queued function behind that UI, mounted on the same origin. It is not a replacement frontend.

The bounded preview displays twelve-frame GIFs and seven slider positions. These sample the original sinusoidal animation, so the slider does not yet reproduce classic's 25 uniformly spaced linear interpolation frames. Media GETs only read saved outputs. Historic photo links and embedding/API compatibility are not claimed.

## Trial boundaries

- Text and numeric seeds only; no personal-photo uploads or legacy GUID support.
- Original config-F weights converted using NVIDIA's official legacy converter.
- Float32 and reference PyTorch operations first, with fixed noise and legacy truncation.
- One GPU job at a time; at most eight queued requests and 200 saved distinct results.
- No fallbacks or inference calls to Triton or the classic API.
- Anonymous archive browsing; compute only on explicit submission.
- Public trial results, with content-hash keys and no raw input text stored in manifests.

Set `TRIAL_BUCKET` and the `TRIAL_STORAGE_TOKEN` Space secret for persistence. Set `TRIAL_BASE_URL` to the verified trial URL. The deployment script creates resources without changing the classic service. Do not put tokens in files committed to this Space.

## Attribution and provenance

`vendor/stylegan2-ada-pytorch` is NVIDIA's implementation at the revision recorded in `models/provenance.json`. Its full NVIDIA license and notices are retained. The converted model derives from the actual checkpoint used by classic CheckFace; the legacy license is included as `models/LEGACY_LICENSE.txt`. This evaluation does not grant commercial use rights or promise exact historical byte reproduction.

`archive/manifest.json` records SHA-256 checksums of the preserved synthetic seed samples. New trial renderings have separate filenames. The full classic archive has not been imported.

Feedback: checkfaceml@gmail.com. No automatic sunset occurs at the end of this trial.

# facemorph.me

The FaceMorph application is written in F# with Fable and JavaScript browser
runtimes. This repository builds the candidate at **https://next.facemorph.me**
from `candidate/next-delivery-20260916`. The classic site at `facemorph.me` and the
legacy backend in the sibling `checkface/` repo are separate delivery surfaces.

## Run your own API

[Self-host with Docker](self-host/README.md): NVIDIA GPU or CPU, the original UI,
verified model downloads, and persistent saved faces. See the [API reference](docs/api.md).

This package preserves the historical server API and builds its original frontend
from pinned commit `0abb215f27b16e17e3919cf78b616b6ae4998a5d`. The current
`candidate/next-delivery-20260916` frontend at `next.facemorph.me` runs inference
locally and does **not** use this API. Sharing a repository does not make the
self-host API a dependency of the current web or desktop application.

## Development

[Start with the dev guide](docs/dev/README.md): application layout, setup, tests,
builds, feedback, and candidate deployment. The [documentation index](docs/README.md)
distinguishes current guidance from dated reviews.

## Autoresearch

[Start with the autoresearch guide](autoresearch/README.md): optimize overall
application performance from first load through generation and sharing, making
both the first visit and the nth visit snappy. Research covers loading, downloads,
cache reuse, UI responsiveness, photo processing, inference, morphs, exports, and
sharing. Measure the user journey as well as the component being changed.

Research experiments and development have different workflows. A measured
candidate becomes a shipped improvement through development's integration,
verification, and delivery steps.

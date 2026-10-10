# Self-host delivery source

The delivery source lives in the `facemorph.me` repository, alongside the new web and desktop applications. Imported from `check-face/checkface` commit `a330367` on 16 September 2026 under the operator’s repository consolidation instruction. The old repository remains historical; new delivery changes and artifact CI belong here.

The Docker API is an optional self-hosted distribution, never a dependency of the publicly hosted new site. Its pinned legacy frontend compatibility shell is distinct from the new local-inference site. Both CPU architectures passed the originating commit’s actual Docker tests; this repository’s workflow must qualify its own resulting artifact bytes.

The shell builds `check-face/facemorph.me` commit
`0abb215f27b16e17e3919cf78b616b6ae4998a5d` plus the recorded frontend overlay.
The current `candidate/next-delivery-20260916` frontend deployed at
`next.facemorph.me` runs inference locally and does not consume this API.
The [quickstart](README.md) checks out the current repository for API packaging;
its Dockerfile separately retrieves the historical frontend pin.

`licenses/CheckFace-LICENSE.txt` retains the original CheckFace CC BY-NC 4.0
notice from that imported commit. It applies to the imported API source, not a
new license for the separately pinned frontend or third-party models/code.

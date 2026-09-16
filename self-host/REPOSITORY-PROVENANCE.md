# Self-host delivery source

The delivery source lives in the `facemorph.me` repository, alongside the new web and desktop applications. Imported from `check-face/checkface` commit `a330367` on16 September2026 under the operator’s repository consolidation instruction. The old repository remains historical; new delivery changes and artifact CI belong here.

The Docker API is an optional self-hosted distribution, never a dependency of the publicly hosted new site. Its pinned legacy frontend compatibility shell is distinct from the new local-inference site. Both CPU architectures passed the originating commit’s actual Docker tests; this repository’s workflow must qualify its own resulting artifact bytes.

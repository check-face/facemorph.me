# FaceMorph — next candidate plan

Updated **16 September 2026**. **Status: implementation and verification in progress; not yet READY FOR TESTING.**

**Goal:** give friends and family the actual new site at **https://next.facemorph.me**, collect useful feedback, then resume the remaining platform work. This is a testing candidate, not a production cutover or a claim that every device is qualified.

Implementation belongs in this repository. [Implementation branch](https://github.com/check-face/facemorph.me/tree/candidate/next-delivery-20260916). This document consolidates the latest scope decisions; older requirements to finish all native backends before this handoff are deferred.

## This round

| Deliver | Required behavior / reason |
|---|---|
| Integrated web app | Preserve the recognizable UI. Seed/name generation and actual photo alignment → e4e → 1024 reconstruction work through the real controls. |
| Device handling | Browser CPU fallback and qualified GPU routes. Check correctness before admitting a route; show progress, cancellation and recovery. Preserve inputs after failures. A desktop/laptop nudge must not replace a usable CPU path. |
| Morphs | Pairwise and N-point figure-eight/ellipse modes, with the agreed geometry, succinct advanced controls and playable MP4 export. |
| Local originals | Cache newly generated full1024 lossless originals and reusable project data. Repeat requests reuse originals; resizing does not regenerate faces. |
| Sharing | Share/save the image or MP4 itself. Editable project export/import is separate. No new hosted result-link service. |
| Photo UX | Tile/+ click, touch and keyboard open the picker; dropping a photo targets that tile. Arbitrary and oversized images crop locally before alignment. Validate safely, preserve cancelled inputs and explain invalid/multiple-face selections. |
| Names and public cache | Preserve names-site appearance/behavior and all 5,055 names. Publish only verified synthetic seed/name assets; never uploaded/recovered/e4e photos. Cache misses can use device generation. |
| Diagnostics | Optional explicit opt-in that stays on until it is turned off, automatic sanitized saves, visible report reference/status and 30-day record expiry. No blanket banner; no private inputs; generation works with reporting off or unavailable. |
| Desktop skeleton | Launch the shared UI and demonstrate the existing available path with honest provider status. Clearly label development builds. Do not start further native GPU backend work for this handoff. |
| Docker/API | Preserve the separate self-host compatibility distribution and its tested behavior. It is not the hosted site's inference server. |

## Hosting and cost

- **`next.facemorph.me`:** independently hosted site, models, runtimes and galleries. No TrueNAS, home-network or local-computer dependency.
- **Cloudflare static assets:** default for web/model delivery; verified chunks retain original model checksums. Workers Free is confirmed. No paid upgrades or overages authorized.
- **Diagnostics:** managed private Cloudflare collection preferred. A temporary TrueNAS collector is allowed only if necessary, with a removal plan; reporting failure never blocks the product.
- **`labs.facemorph.me`:** separate research surface. Research does not replace the integrated candidate or indefinitely delay handoff.
- **GitHub:** versioned source and accurately labelled, tested downloadable artifacts. [Hosting details](delivery-hosting.md).

## Remaining work — in order

1. Finish the integrated build and regression fixes, including photo selection, bounded photo processing and export.
2. Finish independent hosting; verify fresh model acquisition and the real UI at the public URL.
3. Connect the actual new-site artifact to the CI acceptance gates below. Existing classic-site CI and mobile component checks are insufficient.
4. Rehearse complete browser workflows, iOS Simulator behavior, optional report persistence and the installed desktop skeleton. Record exact versions and unresolved device limits.
5. Publish the handoff: **READY FOR TESTING**, site/download links, tested matrix, known limitations and the checklist below. **Stop this implementation round and wait for feedback.**

## Open CI work item — required before handoff

**Gap found:** `deploy.yml` builds the classic site; `mobile-browser.yml` validates components. Neither currently proves the complete new-site candidate. Existing local passes do not close this gap.

- [ ] Add an explicit new-site workflow (for example `.github/workflows/next-candidate.yml`) on the delivery branch/PRs, with dependency-aware triggers.
- [ ] Build `npm run build:next` from a clean checkout once; retain the compiled bundle, source revision and model/runtime manifest hashes.
- [ ] Serve those exact bytes with production headers. Drive real seed/name and photo/e4e → synthesis → morph/MP4 → cache/project/save workflows; include admitted CPU fallback and failure regressions.
- [ ] Keep Chromium, WebKit/Safari and Firefox results explicit. Attach Simulator and physical-device evidence separately; missing hardware evidence cannot become a pass.
- [ ] Gate publication on required workflow results, numerical references, diagnostic/privacy checks and artifact integrity. Missing evidence or skipped required jobs must fail the relevant readiness gate.
- [ ] Promote the retained artifact without rebuilding; run a fresh-client smoke test against the public deployment. Record deployment ID, artifact hash, outputs and any failed stage. Retain the previous known-good candidate for rollback.
- [ ] Wire required checks into the promotion path and branch rules where available. If permissions prevent enforcement, report that as an open gap rather than claiming a protected gate.

Maintain separate **testing-round readiness** and **full-release qualification**. Do not disable strict full-release tests to make this limited milestone green. Full native inference jobs remain manual/deferred; desktop checks match the advertised skeleton behavior.

## Required checks before handoff

| Gate | Evidence required |
|---|---|
| Build and promotion | Clean-checkout build; pinned dependencies/assets; checksums; promote the exact tested artifact rather than rebuilding it. |
| Real web workflows | Drive the compiled UI through seed/name and photo generation, included morph modes, playable MP4, save/share fallback, project reopening and repeat-cache use. |
| Correctness | Actual synthesis and e4e compared with independent fixed references; morph geometry checks. A successful process exit is insufficient. |
| Failure handling | Missing GPU, rejected/corrupt downloads, cancellation, interrupted work and cache eviction. No silent wrong-colour output or false success. |
| Privacy/reporting | No pre-consent uploads; redaction; withdrawal/expiry; actual saved records and retention; collection failure remains non-blocking. |
| Public hosting | Fresh-client acquisition → generation → export; correct HTTPS/headers; no product request depends on home infrastructure. |
| Shipped packages | Install/start and the advertised skeleton path. Any distributed Docker image must pass actual API/photo/media/cache and retained-volume restart tests. |

## Verified implementation snapshot —16 September

- Exact web artifact `af4513d3d91d3c950515a6aea3d891e173dee035` passed [build and compiled interface CI](https://github.com/check-face/facemorph.me/actions/runs/35066191334). Published unchanged at `next.facemorph.me`; [byte receipt](review/next-delivery/public-artifact.json).
- Public fresh-origin Mac Chromium generated names/seeds and a32-frame figure-eight MP4 via WebGPU. [Saved diagnostics](review/next-delivery/public-ui-diagnostics.json) include model loading and per-synthesis timings, completion and verified30-day expiry. Playback and broader workflow receipts are separate gates.
- Bounded photo encoding passed actual iOS Simulator alignment→e4e→WebGL1024 with RGBmax1 and cached project reuse. The explicitly admitted phone **testing candidate** retains `releaseQualified:false`; physical-device speed/memory are not qualified. [Source and evidence](../photo-runtime/README.md).
- Photo admission takes8-bit JPEG/PNG up to4million pixels directly. Anything larger, any other bit depth, and containers this build cannot parse up front (HEIC and friends) go to the local crop step: the photo is decoded once at a bounded size, the chosen square is rendered at1024 from the original, and only that crop reaches alignment. A photo can also be cropped deliberately at any size. The pre-decode header bound still refuses an absurdly large file outright, and failures preserve existing work.
- The real CPU end-to-end workflow consumes the retained web artifact without rebuilding. DockerAMD64/ARM64 and installed Mac skeleton verification are in progress. Full native GPU/other-platform package qualification remains deferred.

**CI policy:** run meaningful checks for changed shipping components. Repeat expensive model/provider qualification when relevant; reuse unchanged, checksummed evidence explicitly. Do not rerun abandoned research on every deploy. Missing/skipped required evidence is not a pass. Retain artifact IDs, outputs and failure reports.

**Device evidence:** cover Chromium, Safari/WebKit and Firefox, with mobile and desktop rows. Simulators/emulators test behavior, not physical GPU speed, thermal behavior or iPhone memory limits. Mark each row passed, failed or untested. Real-device feedback is part of this testing round; universal compatibility is not promised.

## Oliver / friends-and-family checklist

- Open the candidate on your usual browser/device; note its version.
- Generate a name/seed face and reconstruct one clear photo.
- Create a morph, play it and save/share the actual file.
- Repeat a face and reopen an exported project; confirm the original is reused.
- Try cancellation and retry. On failure, optionally enable debug reporting, retry and send the report reference or email `checkfaceml@gmail.com`—no JSON export required.
- Oliver: include Manjaro browser results and the desktop skeleton if supplied. Native GPU qualification is a later round.

## Explicitly later / unchanged

- Full native desktop backends, GPU acceleration, architecture/driver qualification, updates and release certification resume after this testing handoff. Preserve existing work.
- Arbitrary user-defined morph functions are out of scope.
- Classic `facemorph.me`, historic links and Triton stay unchanged. No retirement, bulk archive upload or deletion. The candidate does not start the public comparison clock; preservation and at least 28 useful comparison days still gate cutover.

## Plan authority

Use this document for the current execution scope and handoff gate. Workspace migration/delivery entry points link here; their native release, archive and public-trial sections retain later requirements. Historical HF trial and pre-delegation notes are provenance, not competing work orders. Recheck status against actual CI/deployment evidence before announcing readiness.

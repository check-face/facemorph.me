# FaceMorph — next candidate plan

Updated **16 September 2026**. **Status: deployed and qualified; cross-engine matrix in progress.**

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
| Names and public cache | **Amended 18 September, refined 19 September:** preserve the names experience as a **fullscreen `/names` route inside the candidate** (same artifact; no separate names deployment, no browse modal; `names.facemorph.me` redirects to `/names` at cutover; route targets any nth face and reopens per additional name) with all 5,055 names. Clients pick from the native 200px grid; selecting a name materialises the face automatically — hosted cache first, device generation never behind a Generate click. Publish verified synthetic seed/name assets including historic lossy full-size WebP/JPEG (same face; compression within tolerance); morph endpoint frames may use the exact stored image; never uploaded/recovered/e4e photos. Cache misses can use device generation. Missing full-size (2,144 names) may be generated at 1024 via the public API on Triton, identity-verified. Catalogue carries identity + image URLs; per-name latents served on demand, never inlined. |
| Diagnostics | Every run is captured and staged on the device from its first moment; an explicit yes sends what was staged and then streams. Opt-in persists until turned off; declining discards the buffer. 30-day record expiry. No blanket banner; no private inputs; nothing leaves the device without consent; generation works with reporting off or unavailable. |
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

- [x] `next-site.yml` builds the candidate on the delivery branch and PRs with dependency-aware triggers, and calls `next-e2e.yml` as a reusable workflow so every new artifact is qualified in the same run.
- [x] Built once from a clean checkout; the bundle, source revision and `SHA256SUMS` are retained as the run's artifact.
- [x] The exact retained bytes are served with production headers and driven through seed/name, photo/e4e, local crop, project reopen and morph/MP4, on an explicitly selected CPU route.
- [ ] Keep Chromium, WebKit/Safari and Firefox results explicit. Attach Simulator and physical-device evidence separately; missing hardware evidence cannot become a pass.
- [x] `promote.py` refuses to publish without a successful build, a qualification covering all six required checks, a byte match between qualified and shipped bytes, and a runtime digest match. It refused a wrong-runtime attempt in practice.
- [x] Promoted without rebuilding; receipt records the build run, qualification run, source revision and runtime digest. Fresh-client checks against the public deployment are the matrix rows below.
- [x] Required checks are wired into the promotion path. **Open gap:** `master` has no branch protection. The permissions to add it exist, so this is a deliberate decision left to the operator rather than a permissions limit — it is not a protected gate today.

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

**Deployed.** `next.facemorph.me` serves the artifact built from `23c1646` (bundle `app.364167e48daf4f9ae92b.js`). The runtime manifest is unchanged at `982f73bc…`, so models already cached on a device stay valid. [Promotion receipt](review/next-delivery/promotion-23c1646.json).

Promotion refused to publish until every gate passed: a successful `next-site.yml` build, a qualification covering all six required checks, a byte-for-byte match between the qualified artifact and the one being shipped, and a runtime digest matching the qualified bundle. The digest gate did its job — a first attempt was pointed at a runtime directory whose manifest hashed to `cff511fd…` and was refused.

**Real-workflow qualification.** [Run 35080609007](https://github.com/check-face/facemorph.me/actions/runs/35080609007) built the artifact and qualified it in the same run: seed/name generation to two 1024 faces, byte-identical repeat with no new inference worker, photo→e4e, a local crop driven through the UI, project export and reopen, and a decoded 512 video frame saved as a playable MP4. Linux Chromium, CPU route selected through the keyboard. The same six checks passed on macOS Chromium locally.

**Desktop.** [Run 35082282718](https://github.com/check-face/facemorph.me/actions/runs/35082282718) produced `FaceMorph Preview.app.zip` (`2b5bf7ba…`, 67 MB) on a clean runner, embedding the same web revision that is deployed. The installed app passed all six workflow steps, including photo e4e and the saved MP4, in 161 seconds. [Evidence](review/next-delivery/desktop-35082282718/). The build is **unsigned**, its qualification is **packaging-only**, and startup reports inference and GPU as **not tested**.

**Asset integrity of the deployed site.** Every chunk the runtime manifest references (88) and every encoder-stream part (122) returns HTTP 200 at its exact expected size. Model files larger than Cloudflare's 25 MiB asset limit are delivered only as chunks; their direct URLs return 404 by design and the client prefers the chunked representation.

**Diagnostics — verified end to end on the deployed site.** A browser with no local DNS override opted in through the real control, generated, and its reports were accepted by Cloudflare (HTTP 204). The namespace holds 200 records across 12 runs; every one carries an expiry and the window measures 29.52–30.00 days against the 30-day policy. A stored record contains only `schemaVersion, session, run, device, event, stage, provider, bundle, elapsedMs, stageMs` plus `receivedAt`/`expiresAt` — no photo, words, latent, IP or user agent. The gate also still closes: an unauthenticated POST and a foreign origin are both refused with 403.

Reaching that took a correction worth recording. Earlier probes reused a Chrome started with `--host-resolver-rules` mapping `next.facemorph.me` to a local qualification server, so "the deployed site" was answering from `SimpleHTTP/0.6` and refusing every POST. That produced a convincing but false report of a production failure, and a collector change made against it was reverted. Any browser evidence about the deployed site must come from a client with no DNS override; check the `Server`/`cf-ray` headers to prove which origin answered.

**Storage requirement — known limitation.** The model bundle needs more than about 1 GB of origin storage. Measured on one machine: a private/ephemeral browser context offered a 1.06 GB quota against 296 GB for a normal profile. When the model cache cannot be written the product treats it as fatal rather than degrading, so a browser with roughly a gigabyte available cannot process photos at all. Private-browsing and low-disk devices are expected to fail this way.

## Open gaps at handoff

- **Branch protection.** `master` is unprotected. The permission to change that exists, so this is a decision for the operator, not a limit. The promotion path is gated regardless.
- **The matrix cannot run in CI from this branch.** `workflow_dispatch` only resolves workflows present on the default branch, the same constraint that ruled out `workflow_run`. Until `next-matrix.yml` reaches the default branch the engine rows run serially on one developer machine instead of in parallel on clean runners, so they carry that machine's characteristics.
- **H.264 playback is not checkable in the automation browsers.** Playwright ships Chromium and WebKit without proprietary codecs. Playback evidence therefore comes only from the byte-exact qualification, which drives the real Chrome install and verifies a decoded frame. A matrix row that could not check playback is reported as such and does not count as a pass.
- **No physical phone has been exercised.** Simulators and desktop engines describe behaviour, not phone memory, thermal behaviour or real GPU speed. Those rows stay missing rather than inferred, and real-device feedback is part of this testing round.
- **The model cache treats exhausted storage as fatal.** See the storage limitation above.

**CI policy:** run meaningful checks for changed shipping components. Repeat expensive model/provider qualification when relevant; reuse unchanged, checksummed evidence explicitly. Do not rerun abandoned research on every deploy. Missing/skipped required evidence is not a pass. Retain artifact IDs, outputs and failure reports.

**Device evidence:** cover Chromium, Safari/WebKit and Firefox, with mobile and desktop rows. Simulators/emulators test behavior, not physical GPU speed, thermal behavior or iPhone memory limits. Mark each row passed, failed or untested. Real-device feedback is part of this testing round; universal compatibility is not promised.

## Oliver / friends-and-family checklist

- Open the candidate on your usual browser/device; note its version.
- Generate a name/seed face and reconstruct one clear photo.
- Create a morph, play it and save/share the actual file.
- Repeat a face and reopen an exported project; confirm the original is reused.
- Try cancellation and retry. On failure, optionally enable debug reporting, retry and send the report reference or email `checkfaceml@gmail.com`—no JSON export required.
- Oliver: include Manjaro browser results and the desktop skeleton if supplied. Native GPU qualification is a later round.

## Testing-round feedback — received 16 September

The operator has used the deployed candidate on a physical phone. The feedback, what the
shipped code actually does, and the proposed work are in
[testing round 1 feedback](testing-feedback-round-1.md).

Its constraint is **bench parity**: the best case measured in `autoresearch` must be the
case the product runs. It is not today. The verified cause at the top of that document is
that the deployed WebGPU kernel is the *control*, not the `keep`-status
`mobile-boundary-bounded` candidate that produced the 686 ms/face figure on the operator's
S24 Ultra — so the product has never contained the benched winner. That is a
promotion-discipline gap between research and product bundles.

Also from this round: the operator's consented debug run did not produce a usable report.
The collector is fine — the product's own reporting path has verified defects, including
that enabling consent mid-run reports nothing for that run. That instrument has to be fixed
before asking for another phone profile, so it is the first item, ahead of the kernel.

## Explicitly later / unchanged

- Full native desktop backends, GPU acceleration, architecture/driver qualification, updates and release certification resume after this testing handoff. Preserve existing work.
- Arbitrary user-defined morph functions are out of scope.
- Classic `facemorph.me`, historic links and Triton stay unchanged. No retirement, bulk archive upload or deletion. The candidate does not start the public comparison clock; preservation and at least 28 useful comparison days still gate cutover.

## Plan authority

Use this document for the current execution scope and handoff gate. Workspace migration/delivery entry points link here; their native release, archive and public-trial sections retain later requirements. Historical HF trial and pre-delegation notes are provenance, not competing work orders. Recheck status against actual CI/deployment evidence before announcing readiness.

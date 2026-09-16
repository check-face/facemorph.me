> **16 September handoff outcome:** This run must deliver the integrated, publicly reachable friends-and-family candidate with usable connected workflows, actual desktop downloads and optional automatically saved debug reports. Portable setup is included; disconnected demos do not complete the phase. See [handoff acceptance](web_checkface_delivery_plan.md#friends-and-family-handoff--definition-of-done-for-this-run).

> **16 September CI test-selection decision:** Routine CI tests active shipping artifacts and meaningful regressions, using dependency-aware triggers. Abandoned research candidates are excluded from deployment jobs; heavy inference/performance work reruns only when relevant or explicitly requested. Preserve full initial qualification and honest artifact-bound evidence. See [purposeful test policy](web_checkface_delivery_plan.md#purposeful-ci-and-research-test-selection--16-september-decision).

> **16 September CI/CD decision:** Adapt the existing pipelines and autoresearch runners to test the real browser bundles, installed desktop packages and Docker image digests. Promote the same verified artifacts; source/unit checks and package startup alone do not close workflow gates. See [artifact testing contract](web_checkface_delivery_plan.md#cicd-tests-the-deliverable-artifacts--16-september-decision).

> **16 September first-candidate scope:** All web platforms and Windows/macOS/Linux desktop across architectures are required in this phase, with actual e4e and the agreed pairwise/full-smooth figure-eight and ellipse modes. Arbitrary user-defined morph functions are excluded. Platform/workflow gaps block phase completion; interim evidence-gathering builds do not satisfy it. See [governing scope](web_checkface_delivery_plan.md#first-candidate-scope--operator-requirement-16-september).

# Delivery closeout decisions — 16 September 2026

**Proceed with integrated development candidates while autoresearch continues.** The plan is concrete enough to execute without another broad product/design interview. This document records decisions and actual release dependencies; it does not claim implementation, deployment or release qualification.

## Experiences and hosts

- `next.facemorph.me`: approved integrated FaceMorph Preview, shared Elmish frontend and versioned browser adapters. Link back to classic; preserve classic through the useful public comparison period.
- `labs.facemorph.me`: approved temporary autoresearch surface. Preserve active-run immutable assets and automatic synthetic research results while moving the lab; test save/recovery on the new origin and keep the old link during transition. It is not the product or the trial clock. Eventually retire the lab after versioned winners, useful nonpersonal evidence and operational handoff are preserved; expire personal diagnostics according to retention. Retirement is future work, not permission to delete records now.
- `names.facemorph.me`: port hosting/cache plumbing while keeping its existing appearance and behavior exactly. Preserve all5055 names, text/case/order, image labels, selection, links, embedding, CSS and layout. Main-app UX improvements do not authorize redesigning names.
- GitHub: prepare source/build candidates, then appropriate versioned prereleases after each advertised installed workflow and distribution gate passes. Stable releases follow actual release qualification. An unsigned/source-only development artifact must be labelled accurately and cannot be advertised as a finished fallback app.

DNS addresses are approved design decisions; deployment status remains separately recorded in `trial-status.json`. Do not change classic production routes or write to Triton under this approval.

## Debug reporting without a blanket banner

No site-wide/blanket consent banner. Normal use and retry do not depend on reporting.

On a failure, show one concise, dismissible toast, for example:

> Something went wrong. Enable debug reporting to help us investigate?
> **Debug options** · **Dismiss**

Debug options explain what is sent and where, with **Enable for this session**, **Send this report** (preview first), and **Email us**. Contact remains `checkfaceml@gmail.com`; do not send email on the user's behalf. Make the reporting-on state visible, with an off control. Rate-limit repeated toasts and preserve dismissal for the relevant session/failure; provide the same controls in Help.

Explicit session opt-in permits sanitized start/stage/error uploads on subsequent attempts, allowing partial evidence before a tab dies. It does not upload prior records silently or authorize general analytics. No upload before consent; no later queued upload after withdrawal/expiry. An interruption is not a confirmed OOM. Essential local recovery markers and user-requested model/output caches remain distinct from optional transmission.

Keep private debug records on TrueNAS, separate from public model/image hosting and from synthetic lab results. Implement a bounded session and initial30-day raw retention target with deletion covering analysis copies and backup expiry. Minimize fields, retain only necessary short-lived correlation IDs, and exclude photos, words/seeds, latents, generated media, credentials and arbitrary unredacted error strings. Include concise privacy details and assess actual processor/log handling; the lack of a banner is a UX decision, not a declaration that privacy obligations disappear. No geographic exclusion policy is adopted here.

The delivery plan and `release-tests/catalog.json` now require toast/decline/email behavior, no blanket banner, no pre-consent upload, expiry, withdrawal/offline-queue discard, early checkpoint collection and retention/deletion. This updates the previous manual-only product logging specification. It does not alter current deployed lab collection or implement the product feature yet.

## Integrated morph UX

Retain the recognizable current typography, colours and controls. Offer simple named presets and a small **Advanced** disclosure for width, pinch, timing and latent controls; avoid making basic generation depend on advanced settings. Keep classic linear behavior. Pairwise figure8 is the intended default once qualified and requires no third latent.

Ship the committed pairwise/full-smooth ellipse and figure8 variants through ordered N-face loops, with all control visits and settings in the project format. Preserve exact face hits, applicable midpoint crossings, forward pinched chord velocity, alternating lobe orientation and smooth closed seams. Bounded frame schedules must include face/midpoint samples without duplicate terminalA. The spike's3D checks and full-size project tests are development evidence; real512D/W+ geometry, rendered frames, visual review and useful-length video exports remain implementation/qualification work. Unsupported open/unequal-duration variants stay explicitly gated.

## Free hosted originals and device fallback

Start with a measured, curated public synthetic collection using Cloudflare Static Assets; requests to static assets are free/unlimited and asset storage carries no additional charge, within platform limits. Account limits, file count/size, deployment behavior and availability still require measurement. R2 is an alternative for a collection that does not fit; its included allowance is not a hard zero-cost guarantee. No paid resources are approved by this decision.

Sources checked16 September: [Static Assets billing/limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Use maintainer-controlled uploads from a publication-safe manifest, not a public arbitrary-upload endpoint. Include names and selected common seed-generated faces; popularity must come from eligible evidence or be described as curation. Do not publish photo/e4e-derived, mixed-private or unknown-provenance artifacts. Preserve historic bytes separately. If a1024 original is missing, generate and verify one using a qualified model, label its provenance, and retain the historic image too; upscaling is not recovery of an original.

The product checks valid local and eligible hosted cache entries before initializing models, concurrently where useful. Missing/unavailable hosted assets fall back to independently admitted on-device generation. Store new lossless1024 originals locally and derive requested display/export sizes. If no route qualifies, keep existing cached browsing/projects accessible and offer an optional desktop nudge; never enable invalid output. The public curated cache is an initial delivery batch, not a reduction of the previously agreed complete eligible archive-preservation scope.

## Work now versus release dependencies

| Workstream | Work that can proceed now | Evidence needed before advertising/releasing |
| --- | --- | --- |
| Browser product | Wire frozen development adapters, photo pipeline, caches, progress/recovery, debug UX and morph presets | Actual integrated workflows, privacy/accessibility and memory/recovery on the declared physical targets |
| Docker API | Finish final source candidate and documented clean setup; preserve all retained routes/media/GUID behavior | Latest clean-build real inference/photo/cache/restart checks, lawful model setup, independent reproduction; optional GPU separately |
| Desktop | Finish portable runtime/model acquisition and installed UI workflows; prepare platform packages and updater configuration | Actual installed seed/photo/morph/export/project flows, independently qualified CPU/native GPU, N→N+1/tamper/interruption tests, platform signing/notarization as applicable and protected updater keys |
| Names/archive | Preserve original implementation, classify/export assets, wire cache lookup, prepare static collection | Exact visual/interaction parity, complete public/private provenance separation, restore and old-route dispositions |
| Hosts/research | Prepare stable next/labs deployments; continue research using separate candidates | Real deployed workflow/save checks, operator/co-maintainer review; moving origins must preserve access/export for cached projects |

The notable external dependencies are **model/code/weight distribution terms**, **release signing identities/keys where needed**, and **physical tester/hardware availability**. They do not block ordinary UI/integration work. Research-use acceptance flags do not settle general distribution terms; prepare an accurate permitted acquisition path rather than silently bundling unreviewed weights. Do not claim a clean-machine app works just because its package launches. Phone and other untested architectures remain unqualified until actual evidence exists. Preserve the governing plan's specific desktop hardware gates; the recent iPhone-only assessment's exclusion of Manjaro was not a removal of the delivery gate.

The release sequence is: integrated development candidate → complete declared workflow tests → appropriate GitHub prereleases and separate preview → useful public comparison and fixes → qualified stable releases and independently approved scoped cutover. Some lanes proceed in parallel; a web preview may precede the desktop release but cannot advertise an unready desktop fallback. Autoresearch publishes improved versioned bundles independently and must not indefinitely postpone a usable candidate.

No need for another general “go” decision. Ask only when an actual missing credential, unavailable physical test, unresolved distribution right or explicitly restricted production action becomes the next concrete dependency. Keep the October25 target subordinate to preservation and at least28 useful comparison days.

## 16 September — selected Cloudflare collection versus bulk preservation

The operator reports roughly **2 TB in the Triton directory**. This is an operator estimate of the mixed source tree, not a measured public-image dataset. Do not bulk-upload that directory or assume it fits free hosting.

The initial Cloudflare Static Assets publication is **only a selected allowlist of proven seed-generated still images**, including names only where the deterministic synthetic mapping is verified. Never publish recovered/uploaded/e4e photo outputs, registered arbitrary latents, mixed-photo results, or unknown provenance. A filename, numeric-looking identifier, hash, or plausible-looking face is not sufficient provenance. No public user-upload endpoint. Upload tools must resolve the reviewed manifest and verify hashes; do not recursively sync a Triton cache root.

Inventory before deciding capacity: measure counts/bytes by source root, provenance class, still image versus video/intermediate, resolution, format, model era and unique checksum. Use bounded/resumable read-only metadata passes first; hash only classified candidates in a controlled export stage. Do not read/copy/hash2 TB in one unbounded production scan. Report unreadable/changed/unknown files separately; a sampled census is not a total.

Prioritize the complete verified names collection and an explicitly curated common-seed set, then expand using legitimate aggregate popularity evidence if available. Keep one canonical **actual1024 lossless original** per new generation identity/model/noise configuration, with only useful display derivatives. Old small JPEGs stay historic artifacts; neither upscaling nor PNG conversion makes them original1024 renders. Generate a missing1024 version offline/on a qualified nonproduction route if needed, with separate provenance and licensing review.

Public fast cache, complete eligible-history preservation and private retention are different sizing decisions. The existing full eligible-history preservation objective remains pending census; a small Cloudflare release neither fulfills it nor authorizes deletion of the remainder. Once counts/bytes are known, present the measured options for the long tail, backups and private records before choosing hosting or changing retention. No paid storage or automatic overage is authorized. Cache misses use qualified device generation; repeat requests reuse the local1024 original.

## Share media directly — 16 September clarification

The new browser/desktop Share actions send the actual generated image or morph MP4, with save/download fallback. New result-link sharing is removed; no result-hosting upload is introduced. Keep Export project as a separate explicit editing/transfer action, containing the necessary reproduction metadata. Ordinary shared media must not silently include private inputs or latents. Preserve historic links and self-host API compatibility separately. Follow the [complete UX and acceptance contract](web_checkface_delivery_plan.md#share-the-actual-image-or-morph--16-september-decision).

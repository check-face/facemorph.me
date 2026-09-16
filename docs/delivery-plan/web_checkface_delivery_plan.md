> **16 September latest operator stop gate — this testing round:** Get the independently hosted live site and installed Tauri skeleton working, then explicitly report **READY FOR TESTING** and stop this implementation round. Provide the site/download links, what was actually tested, known limitations and a short tester checklist. The skeleton must launch the real UI, connect to the existing native worker and exercise an available end-to-end path with honest CPU/provider status; native GPU stubs must not be presented as working acceleration. Do not wait for, start or continue the remaining native GPU backend implementation/qualification campaign before this handoff. Preserve existing work and record native GPU coverage as required follow-up, then await the operator's post-testing instruction to resume. This supersedes earlier instructions to continue automatically from the live-site milestone into all desktop backends or to finish the entire support matrix in this round. “Ready for testing” is a limited candidate handoff, not release qualification or completion of the overall product requirements. The operator has explicitly deferred that remaining work to conserve this round's budget.

> **16 September whole-pipeline autoresearch:** Every processing stage is in research scope, including local alignment, actual e4e, synthesis, morphs, caching, export and CPU/GPU recovery on phones and desktops. Historical synthesis-only results are not a rule excluding e4e. Experimental admission must allow bounded synthetic-fixture runs to gather missing product evidence; product qualification remains evidence-based. See [research policy](autoresearch/program.md#whole-pipeline-research--operator-clarification-16-september).

> **16 September static-assets investigation:** [Read-only Triton measurements](review-artifacts/static-assets-2026-09-16/README.md) distinguish the small curated image collection from bulk preservation. Names requests lowercase the uppercase catalogue before hashing; retain that exact mapping. Existing full-size WebP/JPEG artifacts are not canonical lossless originals. No publication or live changes performed.

> **16 September fresh-eyes review:** Read [pre-delegation findings and required handoffs](predelegation_review_2026-09-16.md) before assigning work. The current authority is the governing delivery plan plus dated closeout decisions and linked contracts. Historical HF hosting/authentication tasks, old device-status snapshots and superseded open questions are not current work orders. Preservation and the useful 28-day comparison still apply.

> **16 September mobile CI:** Android Chrome emulator and iOS Safari Simulator component jobs passed seven browser checks each on `candidate/mobile-ci-20260916` (`094d5cb`), [CI run 35055511127](https://github.com/check-face/facemorph.me/actions/runs/35055511127). See [scope and extension plan](facemorph.me/tests/mobile/README.md). They exercise actual browser cache/worker/image APIs; inference/e4e and integrated app workflows remain separate required follow-up. Emulation cannot satisfy physical-device performance/memory or photo release gates.

> **16 September Cloudflare publication boundary:** The reported roughly2 TB Triton tree is not an upload set. Publish only a bounded, reviewed allowlist of proven seed-generated stills; never recovered/e4e/upload-derived or unresolved content. Inventory and classify before sizing the public collection or deciding long-tail preservation. See [closeout selection policy](delivery_closeout_2026-09-16.md#16-september--selected-cloudflare-collection-versus-bulk-preservation). No bulk upload, paid overage or archive deletion is authorized.

> **16 September e4e release gate:** [Required photo coverage](release-tests/PHOTO-COVERAGE.md) is enforced for every browser, desktop and self-host target. Browser/desktop also require an independently evidenced photo CPU fallback after GPU absence/loss. Structured encoder, reference, provider and full-workflow evidence is mandatory; synthesis-only or boolean-only photo claims do not pass. Actual mobile e4e implementation/qualification remains open.

> **16 September closeout direction:** [Delivery closeout decisions](delivery_closeout_2026-09-16.md) record the optional debug-reporting UX (no blanket banner), approved temporary `labs.facemorph.me`, candidate/release sequence, unchanged names appearance and cache-first full1024 image hosting. Continue autoresearch independently; it must not block integrated development candidates.

> **16 September broad research campaign:** [25 synthesis/e4e proposals and benchmark contract](autoresearch/benchmark-campaign-v2/README.md) now separate actual encoder evidence, synthesis and complete workflows. Physical-phone e4e remains unqualified; CPU synthesis CI is not photo evidence. Larger-memory candidates are included. Packaging and the separate candidate site can proceed in parallel using explicitly pinned bundles; new proposals and metadata tests are not executed inference or release qualification.

> **16 September approved preview address:** The operator approved **`https://next.facemorph.me`** for the integrated next-version candidate, presented as **FaceMorph Preview**. Keep `facemorph.me` classic during comparison. This address decision does not establish a deployed candidate, authorize retirement, or start the public trial clock. Browser-local models, full1024 originals and projects require a tested origin-transfer/export plan before moving to the main hostname. The performance lab remains separate.

> **16 September iPhone reality check:** [Latest diagnostics and feature readiness](iphone_optimisation_reality_check_2026-09-16.md) confirm no new saved runs on refresh. Optimise fast reliable inference, not minimum memory:384 MiB is an experimental control, and larger working sets must be evaluated for measured benefit. Feature integration can proceed now; physical iPhone speed/reliability and full-workflow gates remain open. Oliver’s Manjaro test is excluded from this assessment, not substituted by another result.

> **15 September executable release tests:** The [release test framework](release-tests/README.md) maps the complete browser, Docker, desktop, UX, photo/video, caching, recovery and N-point morph requirements to versioned acceptance scenarios. Component passes support development; missing integrated target evidence blocks RC qualification. Candidate and public-trial/cutover gates remain distinct.

> **15 September release-readiness audit:** [The cross-platform evidence audit](release_readiness_audit_2026-09-15.md) maps research, CPU CI, photo/video, recovery, distribution and parallel-site evidence to release gates. Component feasibility is demonstrated; full-matrix RC qualification and the integrated public trial remain open. This does not change scope or authorize rollout.

# Web CheckFace and FaceMorpher delivery plan

Updated: 16 September 2026. Governing delivery plan. Approved next/labs candidate work remains separate from production cutover; no Triton writes or classic-route changes are authorized by this document.

## Hosting independence — 16 September operator clarification

**`next.facemorph.me` and the eventual production successor must not depend on the operator's local TrueNAS, home network or local computer.** This covers the site itself, model/runtime/WASM/codec downloads, hosted seed/name images, desktop downloads/update metadata and optional diagnostic collection. A Cloudflare Tunnel to a local origin does not satisfy this requirement. Use independently hosted static assets and managed services within the agreed cost and publication boundaries; the exact Pages/Workers or other hosting choice remains an implementation decision. This clarification supersedes earlier product-hosting and TrueNAS diagnostic-collection directions.

The existing TrueNAS-backed preview is transitional and does not meet the completed candidate's hosting requirement. Handoff evidence must demonstrate fresh-device asset acquisition, generation, export, downloads and opted-in report delivery without access to the operator's local infrastructure. Verify this through dependency inspection and isolated client/network checks; this requirement does not authorize shutting down local services or changing classic/Triton infrastructure.

**`labs.facemorph.me` should also be independently hosted.** Only if needed, a minimal temporary TrueNAS component is permitted for the temporary lab, with its purpose, dependency, removal plan and outstanding migration recorded. It must never become a dependency of the product site. Historical preservation and optional developer build/research tooling remain separate from deployed-site availability.

## First candidate scope — operator requirement, 16 September

The minimum completion scope for this phase is **all web platforms and Windows, macOS and Linux desktop, across architectures**. This supersedes the earlier proposal to complete the phase with a selected platform subset. CPU is a first-class path throughout, with GPU acceleration where available and independently qualified; retain the existing native GPU/Manjaro gate. Browser coverage includes mobile and desktop, Safari/WebKit, Chromium-family products and Firefox/Gecko, with iPhone/iPad and Android tested explicitly. macOS Intel/Apple Silicon, Windows x64/ARM64 and Linux x64/ARM64 are mandatory named desktop rows, not optional expansion targets. Other architectures, including relevant32-bit systems, require explicit enumeration and feasibility work; do not silently interpret “all architectures” as only these six rows or claim infinite hardware/OS compatibility.

Every missing platform/architecture or complete workflow remains an **open blocker for this phase**, not a deferred enhancement or a pass based on another device. Enumerate exact OS/browser minimums and hardware/runtime configurations to make the requirement testable. If a hard dependency or device limit prevents implementation, present the measured limitation and proposed solution to the operator; do not reduce scope unilaterally. Interim deployments can collect the physical evidence needed to close these blockers, but must be labelled incomplete development builds and cannot count as completion of this candidate phase. Capability-based admission and safe failure behavior still apply; broad scope never authorizes knowingly invalid output.

**Deliver usable e4e now:** each target needs an actual decode/orientation/alignment → e4e →1024 reconstruction → cache/repeat/recovery workflow, including CPU fallback. A qualified CPU encoder plus GPU synthesis is acceptable; a precomputed latent is not an encoder implementation. Deliver a feasible measured baseline during this phase, then incorporate feedback and faster versioned research bundles later. Research must not postpone basic photo functionality or justify removing it.

**Morphs in scope:** classic linear/longmorph plus the agreed pairwise and new full-smooth figure-eight and ellipse modes, including ordered N-face closed loops, width/pinch controls and the reviewed geometric invariants. Actual latent-space implementation, rendered output and export are required now. **Out of scope:** a user-defined arbitrary function/expression/code editor for a morph trajectory. Internal versioned path interfaces support the fixed modes; they are not permission to build that additional product feature. Previously unqualified open/unequal-duration variants remain gated.

**Portable model/runtime acquisition and distribution** means a fresh user environment can acquire and run the exact required assets without the developer checkout, Python environment, absolute paths or Triton. Browser setup obtains verified models, workers/WASM and codecs; desktop packages provide or install the matching native runtime/dependencies for each architecture; Docker has a reproducible permitted setup. Use trusted versioned sources, checksums, bounded/resumable downloads, persistent reuse and actionable setup errors. Review the right to redistribute code, weights and codecs separately; where direct bundling is not permitted, implement a permitted acquisition path. This is delivery/setup work, not moving inference to a cloud provider or requiring a paid inference account. Test it on clean environments with actual seed/photo/morph output.

## Native desktop GPU — mandatory first-class delivery requirement, 16 September

The Tauri app must provide **actual native GPU acceleration independent of browser/WebView WebGPU or WebGL**. A core reason to offer the desktop app is to help someone whose computer has a capable GPU but cannot run the browser GPU path. A CPU-only desktop artifact is an interim development build and does not complete this phase or qualify as that recommended GPU alternative. This remains required implementation work within the overall task, not an optional optimization after release.

**Operator sequencing clarification:** First get the independently hosted live browser candidate working through its connected workflows. Keep the desktop GPU integration as an explicitly labelled skeleton during that milestone; do not delay the live-site milestone for native GPU implementation. After the live site and desktop skeleton work, stop and hand off this testing round as directed by the latest operator stop gate above. Only after the operator resumes work following testing, implement native GPU backends in the actual desktop worker and adapter, package their runtime dependencies and qualify installed artifacts. The live-site milestone is not completion of the overall task or the full friends-and-family handoff below. Native GPU implementation and qualification remain mandatory outstanding work, with no claim that skeleton/CPU-only downloads provide a GPU remedy.

**Scheduled follow-up: native backend implementation and coverage.** Review a concrete OS/architecture/GPU/backend matrix before selecting implementations: CUDA for NVIDIA; Core ML and/or PyTorch MPS/Metal for Apple hardware; DirectML for applicable Windows AMD/Intel/NVIDIA hardware; ROCm for supported AMD configurations; and assess another native route if those leave required hardware uncovered. These are investigation candidates, not claims of compatibility or a requirement to ship every backend. Evaluate our actual ONNX/PyTorch synthesis and e4e models for operator coverage, numerical correctness, memory, speed, driver/OS restrictions, redistribution and packaged runtime size. Select and implement sufficient qualified routes for the agreed support matrix, documenting measured gaps. Deliver executable native GPU code and portable packages, not merely provider enums, detection stubs or documentation. Test actual execution placement to catch silent CPU fallback, and include complete photo-to-morph/video output so frontend orchestration or codec limitations are also exposed.

Implement native provider discovery, compatible runtime/dependency acquisition, model execution and correctness admission across the required Windows/macOS/Linux architecture matrix. Explicitly enumerate supported GPU families, drivers and native backends, covering Apple, NVIDIA, AMD and Intel hardware where feasible; do not equate desktop support with CUDA-only support. Unsupported combinations and missing execution evidence remain visible blockers requiring measured resolution, not silent CPU passes. Backend choices must be justified against our actual models and distributable artifacts.

Route admitted workloads to native GPU by default when available, retain an independently qualified CPU fallback, and report the actual provider/device used. Test synthesis, real photo/e4e and complete morph/video workflows; record per-stage placement where some work remains on CPU. Include cold/warm performance, memory, cancellation, GPU loss/provider failure and safe fallback without corrupting saved work. A GPU being detected or the UI using GPU rendering is not evidence of accelerated inference.

Qualification must use installed candidate artifacts on real supported hardware with browser GPU unavailable or explicitly disabled, proving real native GPU execution, reference correctness and useful measured acceleration. Include Oliver's existing mandatory Manjaro gate. Test portable setup without a developer environment and retain the full platform/architecture scope; ordinary CPU CI or package startup cannot close GPU gates. Only recommend the desktop download as a remedy for browser GPU failure once the relevant configuration is qualified; describe capability honestly otherwise.

## Friends-and-family handoff — definition of done for this run

The intended outcome is a deployed, coherent product candidate that the operator can hand to many nontechnical testers. Portable acquisition/distribution is included implementation work, not a pending product choice. A collection of disconnected research demos, source-only installers or features that work only in isolation does not meet this handoff.

- **One starting point:** `next.facemorph.me` opens the integrated browser experience and provides the actual Windows/macOS/Linux downloads with clear architecture/setup guidance, plus a separate self-host quickstart where relevant. All advertised links and model/codec assets must work outside the developer network. `labs.facemorph.me` remains available for research but is not required to use the product.
- **Complete connected workflows:** names/seed/text and real photo/e4e → faces → ordinary and agreed new figure-eight/ellipse morphs → preview/slider → share/save image or complete video → export/reopen project. Exercise mixed photo/seed and multi-face input, full1024 original reuse, cold setup and return visits through the same UI. Test the candidate names integration and links against the intended candidate destination; do not accidentally send testers back to classic generation or mutate the production names surface during preview setup.
- **Usable without coaching:** preserve the existing visual identity, keep advanced morph controls collapsed, and make downloading/loading/checking/generating/exporting/completed states unambiguous. Verify touch, keyboard, narrow layouts, cancellation, useful error recovery and independently admitted CPU fallback. No dead share links, unexplained spinner, shell-command prerequisite for ordinary desktop users or silent generation restart after a tab reload.
- **Photo tiles — 16 September operator requirement, implementation pending:** Clicking/tapping an empty face tile or its “+” opens the image file picker; keyboard users can focus and activate the same control with Enter/Space and an accessible “Choose photo” label. Dropping an image onto a face tile selects that image for that specific face. Both successful selection routes automatically switch the face source to Photo and use the same validation and photo/e4e workflow as the existing explicit picker; selecting a photo does not itself start generation. Keep the explicit Photo picker available. Show a clear drag-over highlight, prevent file drops from navigating the browser away, and give a concise error for unsupported, unreadable or multiple files without discarding the existing face input. Cancelling the picker preserves the input. While busy, disable selection/drop consistently with the existing controls and prevent dropped files from navigating away. Required handoff checks cover desktop click/drop, touch picker, keyboard activation, correct target selection, automatic Photo mode, cancelled/invalid/multiple-file selection, busy behavior and successful photo generation through the shared e4e path. A decorative “+” alone does not satisfy this requirement.
- **Easy useful feedback:** Help exposes the candidate version, a short optional synthetic sample walkthrough and contextual debug options. With explicit bounded-session opt-in, safe stage/failure reports save automatically with a short report reference and honest sent/pending/failed status; testers do not need to send JSON. Include a concise free-text feedback/email path without attaching private inputs automatically. Keep reporting optional, no blanket banner, and preserve the agreed expiry/redaction/deletion rules.
- **Operational readiness:** verify public HTTPS, actual artifact/download integrity, model acquisition, cross-origin/embedding behavior, result collection and retention, version identification, update/reload behavior and rollback. Review the deployed candidate as a fresh user after CI artifact checks; passing component tests alone is insufficient. Run a purposeful concise internal rehearsal of each complete workflow before distributing the link widely.
- **Honest completion:** the full first-phase platform/architecture and e4e/morph requirements remain. Missing paths are tracked blockers and must be reported, not concealed as an optional future phase. Physical friends-and-family testing broadens real-world confidence and drives fixes; do not promise that CI or a small device sample guarantees every device/OS combination. If physical evidence is needed before a path can be qualified, provide the clearly labelled diagnostic/evidence-gathering route and retain safe admission rather than invent a pass.

The operator can share the tested handoff link after this run meets these requirements. Do not send invitations on their behalf. Invited testing and the later verified classic-site public invitation remain distinct; neither a candidate deploy nor private invitations silently start the minimum28-day public comparison clock. Existing classic/Triton preservation and production-change boundaries remain intact.

## Goal and boundaries

**15 September persistent model downloads:** Follow the [model/runtime asset-cache contract](checkface/docs/model-asset-cache.md) across all model versions and browser/native CPU/GPU routes. Use immutable content hashes, long-lived CDN/HTTP caching and persistent local storage. App updates and admission invalidation reuse unchanged model bytes. Retain downloaded old versions by default, fetch only missing dependencies and resume interrupted transfers; no routine cache purge. Browser eviction remains recoverable. Implementation is pending.

**15 September CPU baseline clarification:** Support the full target matrix through CPU fallback, with GPU acceleration where qualified. CPU is a first-class delivery path for browser and native targets across the planned macOS, Windows, Linux, Android/iOS and architectures, not an iPhone-only rescue path. Every applicable target needs an explicit CPU qualification result and a tracked implementation task if missing. GPU absence/failure must try an independently admitted CPU route before declaring generation unavailable; do not force a capable-but-slow CPU user onto another device. Actual hard memory/runtime/correctness failures still block unsafe generation and retain cached browsing/project transfer. “Anything via CPU” is the coverage objective, not untested universal compatibility. Native GPU delivery, including Oliver's Manjaro gate, remains required.

**15 September full public-cache scope:** Preserve all eligible existing seed/hash-generated cached images from Triton's active and historical caches, not only a curated subset. Enumeration and complete public downloads are explicitly welcome; earlier anti-enumeration constraints are superseded. Exclude e4e/upload-derived/mixed-private and unresolved content based on provenance. Follow the [repository preservation runbook](checkface/docs/public-cache-preservation.md), including complete census, checksummed export/public manifest, zero-recurring-cost feasibility, independent backup and separate secure maintainer access for Chris and Oliver. R2 is a candidate, not a guaranteed free-forever service. Names/common faces may be the first batch, not the full-archive completion gate.

**15 September cache/names contract:** [The cache-first product contract](inference_learnings.md#15-september-2026--cache-lookup-before-local-generation) requires fast local/hosted lookup, concurrent where useful, before fallback to local inference; newly generated canonical lossless 1024px originals persist locally. All names belong explicitly in the hosted cache. **`names.facemorph.me` must preserve its existing appearance and behavior exactly**, including CSS, labels, layout, selection, links and embedding. Reuse its implementation and change cache plumbing only; the main-app redesign permission does not apply to names. Capture and compare the full visual/interaction baseline before changes. These are requirements, not completed implementation.

**15 September reality check:** Follow the [usage-based closeout assessment](reality_check_2026-09-15.md) when prioritizing this plan. The goals and agreed feedback remain in scope, including morph tuning and native fallback. Preserve names and the full provenance-verified synthetic cache under the scope above; assess Cloudflare static assets/R2 within measured allowances. Public enumeration is welcome; photo/e4e and unresolved artifacts remain excluded. Deliver declared supported configurations and complete workflows before expanding research coverage; explain deliberately removed hosted functionality.

Deliver browser-first CheckFace and FaceMorpher, preserve historic outputs, and provide working desktop and self-host API alternatives. **Hugging Face is out:** no HF hosting, authentication, quotas or inference dependency in the target architecture. Earlier HF plans remain historical research only.

**API scope clarification — 14 September:** The self-host candidate must retain the deployed API’s practical feature set and request/response semantics: seed/text/GUID faces, latent registration and lookup, photo encoding/alignment, mixed-latent morph frames, GIF/WebP/MP4, previews, queues and persistent cache/GUID data. Reuse the existing server logic and original UI. A smaller replacement API is insufficient; new API features and custom morph modes are not prerequisites and are not promised. Test all retained routes with actual inference and a clean source build before sharing the candidate. Historic GUIDs require a separately authorized data restore.

Retain **F# / Fable / Elmish / React** and the Elm-style model/update/view architecture. **15 September visual direction supersedes the earlier broad redesign permission:** preserve the existing site's recognizable typography, colours, controls and visual style while making the new loading/generation/recovery flow clean and logical. Use focused interaction improvements and existing components; avoid introducing an unrelated design system. The names site has the stricter identical-appearance/behavior requirement above. Share UI components, runtime contracts and file formats across browser and desktop. Keep inference and export behind adapters/workers. The self-host compatibility UI continues to reuse the original frontend, with targeted fixes.

Cutover covers **CheckFace/FaceMorph API and morph-service traffic only**. Do not touch other Triton services, shared databases/volumes, host configuration or GPU drivers. Triton remains read-only until a human approves specific live actions; host retirement is excluded.

Preservation and at least **28 days of useful public comparison** gate cutover. **25 October 2026 AEST** remains a target, not an automatic shutdown date. Record actual deployment and invitation evidence in `trial-status.json`; the device lab does not start the trial clock.

## Finish line and trial diagnostics — 15 September clarification

Finish the release's experiments by selecting versioned, checksummed runtime/model bundles with recorded correctness, memory, recovery and end-to-end performance evidence for a declared support matrix. Record unsupported devices and remaining gaps explicitly. Further optimization can continue independently after that release baseline is frozen; it must not indefinitely postpone delivering the product. UI, desktop and CI work continue in parallel before this gate.

Integrate that baseline into a complete candidate site on a separate testing URL, review it with the co-maintainer, then invite broad testing alongside classic. The performance lab alone does not satisfy this milestone. Exercise desktop/mobile browsers, CPU/GPU/fallback paths, cold/warm loads, photos, morphs, exports, re-import, cancellation, interrupted downloads, reloads and failures. Triage reports, debug and retest fixes; extend the minimum 28 useful comparison days when outages or material changes invalidate coverage.

**16 September diagnostic UX decision:** Never introduce a blanket consent banner. Debug reporting is optional and off by default. On a failure, show a dismissible, rate-limited toast offering **Enable debug reporting** and an email/help path to `checkfaceml@gmail.com`; declining must not block retry or generation. The action opens a concise inline explanation of the fields sent, purpose, destination and retention, and the user explicitly enables reporting for a bounded debugging session. Only then automatically upload sanitized start/stage/error checkpoints for subsequent attempts, so a hard tab failure can leave useful evidence. Keep manual report preview/copy/download/send available for the already-recorded local failure. A toast alone never enables collection, and no pre-consent report is silently backfilled. Show a visible reporting-on state and an easy off control; revoke/expire consent and discard unsent debug reports when disabled, rather than uploading them on a later reconnect. Include exact versions, OS/browser/provider, timings and safe error codes; exclude photos, words/seeds, latents, generated media, credentials and private paths. Treat interrupted runs as interrupted, not confirmed OOM. Use independently hosted private collection with no local TrueNAS/home-network dependency, isolated from public image/model assets, with implemented raw-report expiry (initial target30 days), local-copy and backup retention and deletion support. These are implementation requirements, not a claim that the current lab implements consent/expiry. Verify no upload before opt-in, redaction, withdrawal/offline queue handling, failure-toast behavior, email availability and lack of a blanket banner. Necessary local recovery state is distinct from diagnostic transmission; publish concise privacy details. The lab's existing automatic synthetic research collection remains a separate disclosed workflow.

Cut over only after the integrated workflows, diagnostics, preservation restore, desktop distribution/update and public comparison gates pass, with the exact deployment and rollback actions approved. This clarification records the intended outcome; it does not claim those features are implemented or authorize deployment.

## Current position

**15 September execution:** Require Windows x64 and Linux x64 full-model CPU inference in CI through the native worker, as well as package installation and startup. macOS can remain locally tested for now. See [execution/evidence and GPU-host assessment](desktop_ci_and_gpu_validation.md); hosted CPU checks do not qualify native GPU, complete desktop UI workflows or the Manjaro gate. Browser model-cache and self-host CPU/original-cache source work has progressed; integration and real-inference evidence are recorded there rather than assumed from unit tests.

CPU and multi-device browser performance testing are underway. Track WebGL qualification separately from WebGPU: existing GPU successes are WebGPU evidence, and some mobile configurations have failed correctness. Browser-only photo processing, full export performance and broad fallback support still need qualification. See the [browser plan](browser_onnx_plan.md) and [device research](browser_onnx_research_log.md).

The [custom morph spike](custom-morphs-feature/custom-morphs.md) and [validated shape study](custom-morphs-feature/shape-study.md) provide the basis for figure-eight, ellipse and smooth multi-face paths. Geometry evidence exists; integrating and qualifying actual latent inference/video output remains delivery work.

## Phases and parallel work

These are acceptance milestones, not a serial queue. **Device testing, preservation, Docker API and desktop packaging start independently now.** Frontend/runtime contracts and morph integration can also begin immediately; trial and cutover wait for integrated evidence.

| Phase | Work and deliverables | Completion gate |
|---|---|---|
| **0 — Contracts and scope** | Inventory classic workflows/API routes; record retained, archive-only, local-only or retired behavior. Define typed runtime commands, versioned model/file metadata and acceptance fixtures. Identify exact CheckFace resources and protected shared infrastructure. | Every retained workflow has an explicit test and routing disposition. |
| **1 — Browser qualification** | Continue CPU, WebGPU and WebGL investigation across desktop/mobile devices. Measure correctness, cold/warm latency, memory and complete photo/morph/export workflows. Add cancellation, bounded retries and recovery from GPU loss or worker failure. | Publish a tested device/provider matrix; run CPU only where feasible. Unsupported paths offer an actionable fallback. |
| **2 — Preservation and API continuity** | Inventory active caches, oldSeeds, Mongo and model assets; classify private/upload-derived data. Export with checksums, restore independently and test historic seed/GUID/media links. Define route-by-route archive, compatible API or explicit retirement responses. | Retained history survives without Triton; gaps are documented. API consumers are not silently redirected to an HTML app. |
| **3 — Independent Docker API** | Replace obsolete runtime/image dependencies with modern PyTorch, pinned assets and portable Compose defaults. Provide a fresh-clone `docker compose up --build` quickstart, with any lawful model acquisition prerequisite clearly stated. | Clean-build CI starts Mongo/API and the original UI, and tests every retained route, real photo encoding, media formats and persistence; a second environment reproduces setup. No browser/archive/trial dependency. |
| **4 — Web product, custom morphs and desktop** | Build the browser UX on the existing Elmish architecture, with explicit generation, model-loading diagnostics and progress; complete photo, preview, slider, image/MP4 export and metadata re-import. Add extensible morph presets and advanced controls. Package shared UI with native desktop inference and a built-in updater. | End-to-end workflows pass; browser WebGPU failure leads to a working desktop alternative; install and real version-to-version update are verified. |
| **5 — Public comparison and readiness** | Co-maintainer review, isolated candidate deployment, verified invitation, then at least 28 useful comparison days. Publish support limits, sharing/API changes and local alternatives. Freeze releases, prove restore and rehearse scoped cutover/rollback in staging. | Preservation, browser, Docker and desktop checks pass; operator has an exact production runbook to approve. Extend the trial/target if needed. |
| **6 — Actual deployment and cutover** | Deploy production web/model/archive assets and stable desktop releases. Capture final preservation delta; apply approved CheckFace-only routes. Verify retained links, inference, exports, desktop recovery and independence from Triton. Observe traffic; stop isolated legacy services only with specific approval. | New products are live, required traffic no longer reaches Triton, rollback remains available, and unrelated services are unchanged. |

## Co-maintainer feedback — 14 September 2026

The mate reported successful self-hosted CPU image generation; the exact tested revision/hardware was not recorded. Since then, CPU thread configuration and persistent lossless originals have been implemented and passed Linux amd64 inference/restart CI. Analytics remains excluded from the self-host build. Browser UX, gallery polish, optional GPU and full desktop integration remain open. Representative CPU-allocation performance checks are also still needed; one runner does not establish an optimum. See [execution evidence](desktop_ci_and_gpu_validation.md).

The table below defines acceptance requirements; it is not a list of completed features.

| Parallel lane | Requirement and definition of done |
|---|---|
| **Browser UX** | Design the complete loading → ready → generating → result/error flow within Elmish, preserving the existing visual style under the 15 September clarification. Show model download/load/check stages, selected CPU/GPU provider and useful opt-in diagnostics without private inputs. Provide progress animations, real byte/frame counts where available, cancellation/retry and reduced-motion support. Typing edits draft inputs; an explicit **Generate** action submits them. No inference on each keypress; stale jobs cannot replace newer results. Test cold/warm loads, failures and long exports. |
| **Self-host CPU configuration** | Replace the fixed two-thread setting with a documented, bounded default that respects available CPU/container limits; provide an explicit override and report the effective setting. Benchmark representative small/large CPU allocations, check invalid settings and keep health/queue responses usable during generation. Distinguish model threads from HTTP concurrency. |
| **Optional self-host GPU** | Keep the working CPU setup as default. Add an optional, documented GPU profile with real-hardware correctness and inference tests. NVIDIA first is acceptable; investigate AMD/Intel separately and publish tested/unsupported/unknown entries. Native macOS GPU evidence does not qualify a Linux Docker GPU profile. Explain provider selection and CPU fallback; do not silently describe CPU execution as GPU support. |
| **Lossless original cache** | Persist each full 1024px generated original as PNG or lossless WebP, then derive requested sizes/formats without repeat inference. Apply the [cache contract](inference_learnings.md) to self-host storage as well as browser/desktop storage. Prove one synthesis across different dimensions/formats, concurrent requests and restart; test identity changes, interrupted writes and storage limits. Preserve API semantics and existing historic cached artifacts. |
| **Self-host gallery and privacy** | Fix visible name/text/seed labels, selection and responsive/keyboard-accessible styling. The current local seed gallery is not a complete port of `names.facemorph.me`; if offering that catalogue, preserve its names and render them on the images. Google Analytics is already excluded from the current self-host build; verify the mate's revision and retain the no-analytics network/interaction regression check. |

UX design, thread configuration, cache work, gallery fixes and packaging can proceed independently of performance experiments. UI work uses the typed adapter contract and mocked progress/failure states; runtime integration consumes qualified, versioned bundles. GPU support waits only for its own hardware evidence, not for unrelated UI or CPU improvements.

### Desktop candidate and platform acceptance

The shared API source branch supplies Docker and its browser frontend. A separate desktop candidate now passes Windows/Linux native CPU CI and Windows/Linux/macOS package installation or extraction/startup checks. Portable CI model bundles work, but the full user-facing native adapter, runtime/model installation, clean-machine qualification and updater remain unfinished. The mate's earlier Docker report does not establish these desktop checks; use the [dated CI evidence](desktop_ci_and_gpu_validation.md).

| Desktop target | Evidence reviewed 16 September | Remaining qualification |
|---|---|---|
| macOS Apple Silicon | Source compiled/launched; native CPU references and linear PNG sequence passed | Complete user workflows, portable setup, clean install and actual update/recovery |
| macOS Intel | Untested | Toolchain/runtime feasibility, build and real-device workflows/install/update |
| Windows x64 | Native CPU full31/three PNG frames and NSIS install/startup in CI | Portable runtime/model setup, actual installed UI seed/photo/video workflows, native GPU and real update/recovery |
| Linux x64 / Oliver's Manjaro computer | Native CPU full31/three PNG frames and Debian install/startup under Xvfb in CI; Manjaro install/native GPU untested; exact hardware still needed | Complete installed workflows and update/recovery; mandatory first-release gate: Oliver installs and completes actual native GPU workflows on Manjaro |
| Windows ARM64 / Linux ARM64 | Untested required first-candidate desktop targets | Implement required architecture dependencies and qualify complete installed workflows before phase completion |

First desktop handoff gate: a shareable source candidate with reproducible clean-machine setup, no developer-specific paths, lawful model acquisition and working generation/export/project transfer through the UI. Record OS, architecture, provider and revision for each tester. Under the 16 September closeout decision, prepare versioned development artifacts and appropriate GitHub prereleases once their advertised installed workflows and distribution gates pass. Label unsigned or source-only artifacts accurately; do not describe them as a qualified desktop fallback. Before advertising the downloadable fallback, complete the installer/GitHub Releases/updater requirements below on each supported target; CI compilation alone is insufficient. Keep research and this packaging lane parallel.

### Required independent desktop gate — Oliver on Manjaro

Oliver must install and test the actual desktop candidate on his Manjaro computer
and use its powerful GPU for real inference. This is a mandatory first-release
desktop/cutover gate, not an optional future Linux target. An isolated web preview
may precede it, but must not advertise that desktop fallback as ready.

- Record Manjaro version, architecture, kernel, GPU model/VRAM, driver, native
  inference backend and exact candidate/model revisions; hardware details are
  presently unknown. Do not assume NVIDIA/CUDA or a particular package format.
- Supply a reproducible installer/package and documented model/runtime setup that
  works without developer-local paths or the author's checkout. Capture Oliver's
  actual install result, necessary dependencies and actionable setup errors.
- Run unchanged native correctness fixtures and complete seed/text, photo, morph,
  image/video export and project save/reopen workflows. Verify the backend's actual
  GPU device/provider and observed GPU execution; timing alone is insufficient.
  CPU fallback, an available GPU, a selected dropdown or a green CI build does not
  satisfy this gate. Do not call the whole workflow GPU-accelerated if stages use CPU.
- Reproduce a browser GPU-path failure or explicitly disable browser GPU execution
  on that machine. The desktop app must still generate through native GPU inference,
  not reuse the failing WebView WebGL/WebGPU route. Label a simulated browser failure
  separately from a naturally observed failure.
- Record cold/warm workload timings, cancellation/recovery and a bounded longer
  morph. Verify update to the next candidate and preservation of saved work under
  the existing installer/updater requirements. Keep native GPU qualification separate
  from optional Docker GPU packaging.
- Close the gate only with Oliver's dated install/use report and reproducible
  evidence. A prepared checklist or successful Mac test is not completion.

## CI/CD tests the deliverable artifacts — 16 September decision

Adapt the existing desktop candidate/native-inference and self-host pipelines, together with autoresearch fixtures and evidence runners. Do not build a parallel demonstration-only CI system. **CI must test the actual artifacts users will receive**, and release/deployment promotes those verified artifacts rather than rebuilding untested replacements.

- Pin source revision and model/runtime/kernel/fixture manifests. Build once per intended target, retain immutable artifact checksums/container digests and provenance, and pass artifacts between build, test and promotion jobs. Signing/notarization or other byte-changing packaging occurs before final artifact verification; any changed final artifact needs the applicable verification before promotion.
- Browser jobs serve the actual compiled candidate bundle with its intended headers and immutable assets, then execute real seed/text, alignment/e4e, synthesis, fixed figure-eight/ellipse morphs, useful video export, media sharing/save fallback, caches, project reopen and recovery. Source/unit tests supplement these workflows rather than replacing them.
- Desktop jobs install/extract the actual target package into an independently provisioned test environment, acquire dependencies through its real setup path, and drive the installed UI/native runtime. A worker launched from the checkout or a package that merely opens is insufficient. Test version-to-version updater artifacts and preservation of models/projects.
- Docker jobs run the exact candidate image digest with fresh setup and retained-volume restart tests, exercising real API/photo/media/cache behavior. Promote that digest only after its required checks pass; test architecture-specific images individually rather than assuming a manifest-list build proves execution.
- Reuse autoresearch's unchanged correctness fixtures, provider verification, stage timings, resource/recovery checks and durable partial/terminal evidence. Report per-target gaps and failures, with exact artifact identities. Test artifacts must include useful outputs and machine-readable raw metrics, not merely successful process exits or screenshots of startup.
- Cover the full first-phase platform/architecture requirement. Use appropriate native or dedicated/self-hosted runners; emulation and Simulators provide labelled supplemental evidence, not physical-device GPU/memory qualification. Import physical iPhone/Android and Oliver's Manjaro results against the same candidate hashes. Missing execution capacity remains an explicit blocker, not a silent skip. Existing Triton read-only and shared local-Mac lease rules still apply.
- Gate promotion on complete required evidence. CI timing is diagnostic under recorded runner load; optimization claims still require the controlled autoresearch measurement protocol. Keep publishing/signing credentials separate from untrusted test jobs and keep private photo data out of retained public artifacts.

Existing pipelines already demonstrate real Windows/Linux CPU inference, installer/startup checks and self-host API/photo/cache execution. The remaining work is connecting those strengths to complete installed/deployed artifact workflows across the full matrix; this decision does not claim those extensions have passed.

## Purposeful CI and research test selection — 16 September decision

CI validates the actual shipping artifacts and required user workflows; it does **not** rerun every historical experiment on every deployment. Adapt selected autoresearch fixtures and runners, not the entire research campaign. This refines the artifact-testing contract without reducing the first-phase support or e4e/morph requirements.

- Keep an explicit active test inventory: each gating test names the user behavior or failure it protects, owning component, relevant change triggers and evidence it produces. Remove redundant implementation-mirroring checks and obsolete gates. Retain meaningful regression fixtures for previously observed bugs when the affected behavior still ships.
- Abandoned providers, rejected graph/kernel variants, old model-format experiments and superseded research harnesses are excluded from default deploy/PR jobs. Preserve their reports/source as research provenance where useful; run them only through an explicit research job if revisiting that hypothesis. A route still offered to users, including CPU fallback, is an active shipping path and cannot be dropped merely because it originated in research.
- Scope expensive execution by actual dependencies. Documentation/copy changes do not require a full-model matrix. Inference/kernel/model/preprocessing changes rerun affected correctness, real e4e/synthesis and provider checks; geometry changes rerun the included morph invariants/render/export checks; packaging/runtime/setup/updater changes rerun relevant installed-artifact workflows. UI, cache, sharing and recovery changes run the affected real-browser/installed workflows. Changes to dependency resolution or shared contracts may broaden the matrix.
- First qualification of a candidate baseline still needs the full required platform/architecture/workflow evidence. Subsequently reuse successful evidence only for unchanged, content-addressed components and unchanged relevant runtime/environment assumptions, with an explicit dependency/provenance link. Do not relabel an old whole-artifact result as execution of a new artifact. New final bundles/packages/images still receive appropriate integrity/install/startup/deployed smoke checks; changes affecting execution require the corresponding end-to-end checks.
- Separate correctness/release gates from performance experiments. Controlled performance comparisons run on relevant changes, deliberate research runs or justified periodic checks; do not benchmark every variant on every deploy. Prefer small representative regression workloads for routine checks, with full fixed-reference and realistic bounded-duration export qualification at relevant baseline changes. Never weaken the existing acceptance thresholds to save compute.
- Keep the default pipeline bounded and legible: selected checks, trigger rationale, cache/evidence reuse and remaining coverage are visible. Use periodic or manual broader hardware/reliability sweeps for drift where useful, rather than indiscriminate per-deploy fan-out. Protected promotion must not treat an unrelated skipped job as a pass or reuse evidence after its dependency changed.

The objective is useful confidence per test run: preserve real artifact validation and actual e4e/morph coverage while avoiding repeated compute for obsolete directions or unaffected components.

## Continuous performance research

Run the [autoresearch loop](autoresearch/program.md) alongside all phases, covering browser/native × CPU/GPU with fixed correctness checks, bounded paired experiments and a persistent results ledger. Research owns isolated candidates; UI, CI and packaging pin versioned winning bundles. Serialize heavy measurements/builds on the same device, while development and remote CI continue independently. Native CPU/GPU qualification is explicit work, not implied by browser results.

## Pre-generation correctness and device fallback

Follow the [research admission policy](autoresearch/program.md#device-coverage-and-pre-generation-admission-operator-requirement-14-september).
Before enabling user generation, verify capabilities/assets and run known synthetic
full-resolution canaries on a release-qualified route. Correctness, recovery and
memory admission are required; feature detection or a successful model load is not
enough. Invalidate eligibility on runtime/model/device changes or failures. Validate
CPU independently after GPU failure. Keep generation disabled if neither route
passes; offer project transfer to a qualified desktop. Correct-but-slow devices
can proceed with a time estimate or choose desktop. A desktop must qualify its own
native CPU/GPU path. Broad device/architecture coverage is the objective, with an
explicit tested/unknown/unsupported matrix rather than universal success claims.

## Device guidance and persistent help — 15 September

The product must distinguish **open this website on a more powerful computer**
from **install the desktop app on this computer**. Recommend the first to phone
users; recommend the second only when a qualified native release is available for
their computer and addresses their browser limitation. Do not promise that every
computer is faster or that installing a shell fixes inadequate hardware.

| Observed situation | User-facing guidance |
|---|---|
| Cache hit or responsive local generation | No performance nudge. Browsing names and cached faces remains available without inference. |
| Phone uses an independently validated CPU fallback | One unobtrusive inline note: “Your phone is using a slower processing mode. For longer morphs, try opening this site on a computer with a supported GPU.” Keep Continue here available when admitted. |
| Phone is measurably slow on CPU or GPU | Show a workload estimate and suggest a more powerful computer. Use measured generation/export timings; a slow network download alone does not justify this recommendation. |
| Computer has capable GPU hardware but browser GPU generation fails | Primary desktop-app recommendation: explain that the app uses a native GPU path that can bypass the browser limitation. Offer a download only for a qualified released configuration; keep any valid browser CPU option available. Do not tell this user to buy a more powerful computer solely because a browser route failed. |
| Computer browser has no qualified route and hardware capability is unknown | Explain the observed browser limitation without claiming the GPU is absent or inadequate. Link tested desktop-app requirements and available releases; keep cached browsing and project saving available. |
| Computer is slow but otherwise supported | Suggest a more powerful computer for larger jobs. Recommend the native app for speed only when evidence supports a benefit for that configuration. |
| Frequent substantial generation | Optionally show one dismissible suggestion after a completed job, only when a relevant alternative could help. Frequent cache browsing alone is not a trigger. |

Record whether the failed route is WebGL or WebGPU: they are distinct APIs, and
most current inference evidence concerns WebGPU. User-facing copy can simply say
“Your browser couldn't use the GPU. The desktop app may work on this computer.”
Show this only with a relevant available native route; “may” is not a speed promise.
Do not infer powerful hardware from screen size or CPU fallback alone.

Base “slow” on uncached work and the requested workload, not phone branding,
viewport size, total visits or isolated hidden-tab timings. Establish explicit
configurable thresholds from candidate testing; do not invent a measured speed
benefit. Separate first model download, initialization, generation and export in
estimates. Require representative timing evidence before a performance-based
suggestion; CPU-fallback guidance may explain the known selected mode immediately.

Use one inline status/help area near generation, not a modal or a stack of alerts.
An optional frequent-use toast appears only at a natural stopping point, never
steals focus or obscures controls, and offers **Learn more**, **Dismiss**, and
**Don't suggest again**. Suggested initial policy: at most once per session, with
a seven-day cooldown after dismissal and a locally persisted opt-out; tune from
trial feedback. Store only minimal local counts/timing/dismissal preferences, not
inputs or cross-site identifiers. No prompt on every reload, successful cache hit
or repeated job. If preference storage fails, respect dismissal in-session.
Required unsupported-device status remains visible even when suggestions are muted.

Provide **Performance and supported devices** as a permanent section of the main
FAQ, linked from help and every recommendation. It remains discoverable after
dismissal and explains cache-first behavior, local compute, CPU fallback, realistic
computer/GPU guidance, browser versus desktop app, support limits, and project
save/open instructions. Opening the URL on another device does not transfer photos
or saved work: offer an explicit project export/import flow and explain that files
must be moved by the user. Never imply cloud sync or offer a phone installer for a
desktop-only app. Only show working, qualified download links.

Candidate FAQ copy (publish with the new experience, not as a claim about classic):

> **Why is generation slow, and would a computer help?**
> We check for a cached face first. When a new face is needed, it is generated on
> your device, and the full-size image is saved locally where storage is available.
> Some phones use a slower processing mode, and longer morphs can take time.
> You can keep going here if generation is supported, or open this site on a more
> powerful computer with a supported GPU. See the tested device list for guidance.
>
> **Should I use the website or the desktop app?**
> Start with the website. If your computer's browser cannot generate faces, a
> supported desktop app may provide an alternative. Available downloads and tested
> systems are listed here. On a phone, move to a supported computer first.
>
> **How do I continue on another device?**
> Save your project, transfer the file to the other device, and open it there.
> Opening the website alone does not move your photos or locally saved work.

Acceptance: fast phone/cache browsing produces no performance toast; phone CPU
fallback and measured slow GPU get appropriate computer guidance; unsupported
desktop sees only a usable available alternative; frequent slow work can produce
one relevant suggestion; dismissal/opt-out survive reload as specified; FAQ and
project transfer remain accessible. Verify keyboard/screen-reader behavior,
reduced motion, mobile layout and visual continuity with existing styles. These
requirements and copy are pending implementation, not a deployed feature.

## Custom morph extension requirements

Build the extension point now so the proved-out custom morph work can land alongside the browser runtime without becoming a prerequisite for preservation or Docker delivery.

- Support linear/longmorph, ellipse, figure-eight and pairwise presets; **pairwise figure-eight is the intended default when qualified**. Pairwise paths derive their transverse direction from the pair and need no extra latent.
- Allow the full-smooth ellipse/figure-eight variants through an ordered list of faces, including closed A → B → C → … → A loops. Keep advanced controls for width, pinch, timing and latent manipulation behind a clear advanced mode.
- Represent a morph as a versioned path specification separate from inference: ordered latents, algorithm/version, parameters and frame schedule. Save all required control latents/settings in export metadata or a companion project file; two endpoints alone cannot reproduce multi-face/custom paths.
- Carry forward exact face hits, smooth joins and loop seams, alternating figure-eight orientation, and the pinched midpoint's forward chord velocity. Test these in actual latent space, plus visual face quality and exported video. Sample face/midpoint frames explicitly and avoid a duplicate terminal loop frame.
- Handle duplicate faces, degenerate directions and extreme parameters explicitly. Share the implementation across browser/desktop and expose it through the local API where supported. Release new modes after qualification; preserve classic linear behavior and keep unfinished modes experimental.

## Distribution and fallback requirements

**Docker:** the reported obsolete NVIDIA-era image/build failures must be reproduced and removed. Avoid private images, Triton paths and production volumes. Test CPU inference in clean CI and GPU inference on appropriate hardware for supported GPU releases. Unit tests alone do not prove the Docker setup works. Review base-image, library, code and weight licenses separately: publish a container only if redistribution is permitted; otherwise ship a working permitted local-build path. Unresolved licensing does not justify claiming a distributable image.

**Desktop:** choose a shell that reuses the frontend and invokes native inference, including a verified CPU fallback; a WebView repeating the same failed WebGPU path is insufficient. Publish a tested OS/architecture matrix, model setup instructions and versioned **GitHub Releases** with installers, checksums, release notes and signed updater artifacts. Apply platform signing/notarization as required. Test clean install, browser-GPU-disabled generation, N → N+1 update, tamper rejection, interrupted downloads and recovery without losing work. Phone users must be told when transfer to a supported computer is necessary.

### Share the actual image or morph — 16 September decision

Replace the successor browser/desktop product’s result-link sharing controls with **Share image** and **Share morph**. The recipient receives the actual image file or rendered morph video (MP4 by default), viewable without FaceMorph, its models or regeneration. Do not create new hosted result pages, upload media to obtain a URL, copy local blob URLs, or offer seed/query links as the result-sharing substitute. Historic link preservation and retained self-host API routes remain separate obligations.

- Use the device’s native file-sharing flow when supported for the actual file type; always offer **Save image** / **Save video** as a reliable alternative so users can attach the file themselves. Desktop can use native sharing where available or save to a chosen location.
- Share the completed selected result. If video export is needed, show preparation progress and cancellation, then a ready-to-share action; preserve the prepared file on share cancellation/failure. Do not imply a recipient received it merely because a share sheet opened. Unsupported sharing or a rejected file falls back to saving, without rerunning inference.
- Use the cached full1024 original for image export; optional smaller sizes are derivatives and never replace it. Preserve actual quality/provenance for historic cached media. Share the rendered morph video, not merely its poster frame or endpoints.
- Keep **Export project** separate for someone who wants to continue editing. That explicitly chosen file carries the versioned controls/latents, model/noise/truncation and morph settings. Ordinary social image/video sharing must not silently attach input photos, private words, latents or a project file. Media metadata may be stripped by receiving apps; never promise editing/reproduction from a shared image/video alone.
- Keep prose minimal: “Share the image or video directly. Export a project to keep editing.” Update existing share icons, dialogs, copy-link buttons, success messages, FAQ and transition copy to match. A general link to the website may remain in navigation, but is not a generated-result sharing action.

Acceptance on every claimed browser/desktop target: share an actual image and a complete morph file where supported; otherwise verify download/save and recipient-side image/video opening. Exercise unsupported file sharing, cancellation, errors, asynchronous export readiness and retry without regeneration. Verify no result-hosting upload, no private project payload in ordinary media sharing, and separate project roundtrip. These are required product changes, not a claim of implementation. No paid inference account is required for local generation.

## Cutover checklist

- Complete independent archive restore and final delta procedure; keep rollback data/artifacts.
- Verify at least 28 useful public comparison days and publish supported/retired workflows.
- Verify browser workflows, Docker clean build, desktop install/updater and permitted asset distribution.
- Approve exact frontend/routes and any Triton actions; exclude shared and unrelated resources.
- Check old links/API contracts and new generation externally; verify no required Triton calls.
- Roll back approved CheckFace routes/builds on broken retained workflows or data loss. Restore stopped services only within explicit live approval.
- Record deployed versions, actual transition time, monitoring ownership and rollback status. Route migration feedback to `checkfaceml@gmail.com`.

Background: [preservation strategy](migration_plan.md), [original goals](triton-migration/triton-migration-goals.md), [historical trial safeguards](side_by_side_trial_plan.md). This plan supersedes their HF architecture proposals.

### On-device full-resolution reuse — operator requirement, 14 September

Retain the full 1024px generated original on device and in persistent self-host storage. Repeat requests reuse the
original, including after reload where persistent storage remains available;
resizing and export formats derive from it without regenerating. Look up cached
outputs before initializing models. See [inference learnings](inference_learnings.md)
for identity, provenance, quota/eviction and acceptance requirements. This is a
product requirement pending implementation, not a change to legacy API semantics.

## e4e coverage on every path — 15 September clarification

Every claimed browser/native CPU/GPU photo route needs actual image decode/alignment → e4e → full1024 reconstruction → original-cache reuse tests, plus repeat and failure/recovery evidence. Track encoder and synthesis providers separately. Synthesis reference passes (including photo-derived precomputed W+) and MP4 encoding never qualify e4e. Require exact OS/architecture/runtime/model/preprocessing identities; another architecture, self-host CPU, host-side alignment or Simulator run cannot silently satisfy that target. See `autoresearch/candidates/e4e-coverage-v1/` and the research protocol for fixtures, evidence contract and pending coverage. The existing all31 desktop CPU successes remain synthesis evidence; photo workflow qualification remains separate.
> **16 September core CI purpose:** Core pipelines verify the actual new-site build and shipped artifacts against this plan, including real inference and integrated workflows. Component-only green runs do not complete the phase. Autoresearch continues with local compute preferred where available, or clearly temporary experimental workflows; preserve core acceptance checks. See [autoresearch guidance](autoresearch/program.md#core-ci-verifies-the-new-product--operator-direction-16-september).

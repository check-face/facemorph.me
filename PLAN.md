# LATEST PLAN — repo-cleanup-and-architecture-refactor

> **LATEST / ACTIVE PLAN.** This root `PLAN.md` is the single release plan. Scope, technology, visuals, implementation approach, source notes and reviews live here.

Updated: 18 October 2026 (operator rulings on the port, retention, WebGL, the update lane and package scope on 17 October; the candidate-edit, tracker, classic end state, no-human-approval and old-report deletion answers on 18 October; see the review record). Status: **active release planning draft**.
Initiative ID: `repo-cleanup-and-architecture-refactor`. Repository bootstrap complete; application implementation remains unstarted.

Read this file in order, or jump to:
[behavior authorities](#behavior-authorities-for-development),
[requirements changes](#requirements-drift-and-decision-ledger),
[research preservation](#autoresearch-coverage-and-preservation-map),
[platform CI/performance](#platform-ci-retention-and-performance-preservation),
[development workers](#development-workers-and-github-minute-use),
[targeted autoresearch/history](#targeted-autoresearch-launch-and-preserved-history),
[published-package acceptance](#independent-published-package-acceptance),
[architecture](#required-repository-architecture),
[language and framework](#language-and-framework-direction),
[Oxfmt/Oxlint](#linting-and-formatting--oxc-tooling),
[conversion Docker environment](#model-conversion-container),
[UI and photo flow](#next-release-ui-and-photo-requirements),
[release support and desktop retirement](#web-release-and-desktop-package-retirement--12-october-2026),
[clean-ui-placement](#clean-ui-placement-and-useful-degradation),
[consented downloads/warming](#consented-downloads-useful-overlap-and-cached-model-warming),
[debug-reporting control](#debug-reporting-control-and-consent),
[UI flow gap review](#ui-flow-matrix-and-open-journey-contracts),
[implementation approach](#implementation-approach-and-sequencing),
[development bootstrap](#candidate-source-import-and-bootstrap),
[source notes](#operator-overview-and-clarifications), or
[review record](#planning-review-and-scope-change-record).

## Goal and source of direction

Finish the sustainable FaceMorph replacement: carry the working Next candidate
forward, retain its existing features and all integrated performance optimizations
with the declared improvements, and retire the hosted Triton inference service
and the hosted API on the operator’s decision. Deliver a clearer repository architecture, independently
usable compute/model packages, a reliable classic Docker distribution, repaired
photo encoding and simpler face controls. Engine extraction and autoresearch are
workstreams of this release, rather than its whole scope.

**End result:** the completed monorepo application should offer basically the same
features and working user journeys as `next.facemorph.me` from
`candidate/next-delivery-20260916`, **plus this plan’s additions and improvements**.
The branch baseline identified below governs what is retained. Keep its integrated
performance optimizations, recovery, cancellation and diagnostics through the
architecture refactor. Only the removals or behavior changes explicitly specified
in this plan alter that baseline; features omitted from a workstream’s examples are
still retained. A cleaner repository or extracted engine alone does not complete
this plan if the resulting application loses existing Next functionality.

Latest release scope (12 October, corrected): retire desktop/native packages for
this release, while retaining browser WebGPU/CPU selection, bounded CPU fallback
and the candidate's working mobile/iPhone paths. Prefer a computer when useful;
there is no desktop-only or WebGPU-only admission rule. Actual per-operation
capabilities determine supported work. Native retirement does not retire classic
Docker, conversion or browser CPU/WASM helpers.
Phones are first-class product targets: preserve their ordinary generation/photo /
recovery/export journeys where admitted, responsive UI and existing Android/iOS CI.
Phones are also inside the [strictly-not-worse gate](#strictly-not-worse-than-the-candidate-operator-24-october-2026):
the new build must be no slower or less reliable than the candidate on the iPhone (Simulator and a physical device)
and Android cells.

The operator's [Google Doc overview](https://docs.google.com/document/d/1lVNtTjPOsVYfFUJa0jCiiVU2jtDENcFcQF8iHrufJ1s/edit)
is the new direction. A [dated source snapshot](#operator-overview-and-clarifications) records what
was read, including incomplete/question-mark items and the later pasted clarification.
The supplied [UI archive references](#supplied-ui-references) and
[language/framework recommendation](#language-and-framework-direction) are part of this plan. This plan supersedes conflicting
engine-only choices and older UX requirements for the next release. Existing
nonconflicting identity, correctness, privacy, retention and evidence rules survive.

Repository bootstrap is complete. The new checkout is the continuation point;
classic remains the current delivery/rollback source until application cutover.
No application extraction, TS migration, new CI/domain promotion or classic
Docker/PyTorch qualification is established by the setup.

Performance objective: minimize each user-visible wait and the complete path through
choosing/generating faces, photos, morphs and usable exports, on first and later visits.
Explicit acquisition consent constrains when network work starts; it is not a reason
to serialize already authorized downloads, input selection and safe cached preparation.
Surface newly discovered opportunities to the operator/planner with a proposed test
and their consent/resource/correctness costs before claiming an improvement.

## Locked original requirements and images

The original operator direction and supplied crop mockups are preserved in a
[local read-only reference bundle](../reference-locks/2026-10-11-original-plan-and-images/README.md).
It contains the exact recovered pre-consolidation plan and companion files,
[operator requirements and pasted clarification](../reference-locks/2026-10-11-original-plan-and-images/original-plan/overview-source.md),
the exact supplied ZIP, all four PNGs, the overview's embedded screenshot and the
first committed consolidated monorepo plan. A manifest records provenance/size/hash;
`SHA256SUMS` verifies the bytes. Do not edit the locked bundle. New original material
gets a separate dated snapshot. Personal-photo images remain local, outside Git.
The raw original DOCX export was not recovered; its captured text and previously
extracted image were recovered. Do not mislabel them as a fresh Google Doc export.

**Design authority:** implement the original crop experience from these references,
with only explicit later operator changes. Reviews may clarify behavior or fix
implementation defects; they do not reopen the visual design by default. The
screen-state types and operated checks below check fidelity and fill genuinely unspecified states, rather
than commissioning a replacement crop UI.

- [Confirmation mockup](../reference-locks/2026-10-11-original-plan-and-images/images/crop%20image.png):
  dark Encode an image modal, logo top right, proposed crop, Adjust Crop, Cancel, OK.
- [Adjustment mockup](../reference-locks/2026-10-11-original-plan-and-images/images/crop%202.png):
  reference square handles, face/eye guides, rotation, Cancel and Use Crop.
- [Alignment-failure reference](../reference-locks/2026-10-11-original-plan-and-images/images/failed%20to%20align.png):
  retain meaningful guidance and allow manual crop; an eligible confirmed crop
  must proceed to e4e without another successful detection or a repeated crop loop.
- [Original page reference](../reference-locks/2026-10-11-original-plan-and-images/images/recovered%20image.png):
  historical controls; the operator's removals/placement changes still apply.

Latest settled direction: e4e's reconstruction/editability tradeoff is accepted;
keep that encoder. The names picker has the accepted touch Back exit while retaining
its specified headerless, gapless grid. Named-face selection must use a one-time
published complete catalogue, with no selection-time synthesis. This is a design
and architecture plan, not Beads expressed in Markdown. Keep rationale, boundaries,
sequencing and verification here; outside the later explicitly requested single
published-package acceptance bead, do not create task IDs, issue states, dependency
records or tracker exports during planning. Broad conversion to execution work is separate.

## Requirements drift and decision ledger

Compare against the locked [operator source and latest pasted clarification](../reference-locks/2026-10-11-original-plan-and-images/original-plan/overview-source.md)
and [original release plan](../reference-locks/2026-10-11-original-plan-and-images/original-plan/README.md),
not an earlier engine-only proposal. The table records actual differences, including
accepted losses and additional scope. Later explicit operator decisions govern;
an implementation recommendation is not retrospectively an original requirement.
The dated review records below preserve how decisions were reached.

| Original/latest locked requirement → current direction | Classification and consequence | Authority / current contract |
| --- | --- | --- |
| Browser/Tauri desktop delivery → browser release with native packages retired for now | **Later operator scope change.** No native installers, updates, packaging or browser/native parity gate this release; native history and classic Compose survive. | Latest 12 October instruction; [release policy](#web-release-and-desktop-package-retirement--12-october-2026). |
| CPU/WebGPU selector and CPU fallback → briefly planned exclusive desktop WebGPU | **Withdrawn overinterpretation.** Restore the original selector and bounded qualified GPU-failure CPU fallback. Removing native packaging did not authorize removing these browser features. | Locked source lines 34, 70–75; latest CPU correction; [provider policy](#provider-simplification). |
| Capability-qualified browser work → briefly planned phone viewing-only | **Withdrawn overinterpretation.** Preserve candidate iPhone CPU generation and bounded admitted photo paths; no blanket device ban. Trials are not universal physical-iPhone certification. | Latest operator correction; [research preservation](#autoresearch-coverage-and-preservation-map). |
| Complete outputs → briefly implied universal 1024px MP4 | **Withdrawn added constraint.** Complete framing/sequence at disclosed qualified resolution; retain candidate 1024→512 WebCodecs and 512 FFmpeg fallback. Full face output remains model-sized. | Candidate media baseline; [output contract](#clean-ui-placement-and-useful-degradation). |
| Requested `facemorph.me` org / `classic.facemorph.me` repo → selected `facemorph-me` org / actual `facemorph.me-classic` repo | **Settled naming/setup difference.** New checkout is bootstrap; current app commands and delivery stay in classic until handover. Organization rename itself is still pending. | [repository architecture](#required-repository-architecture), [identity](#source-names-live-surfaces-and-what-each-supplies). |
| Earlier hosted service/link compatibility → complete API/GUID/result-share URL retirement | **Recorded operator simplification; real lost capability.** Old public result links and API clients stop working; no compatibility resolver. Own files and classic self-host remain. | [11 October simplification](#operator-simplification-and-deep-feature-audit--11-october-2026), [retirement](#retire-hosted-inference-and-the-old-api-completely). |
| Broad migration compatibility → fresh production origin, no Next→production cache/session transfer | **Recorded operator simplification; real lost convenience.** Users may download models again and transfer completed still files themselves. Compatible files and same-origin records remain supported. | Same simplification record; [delivery](#delivery-and-publication). |
| Full architecture/research/classic qualification before release → operator may promote a working candidate and retire API earlier | **Recorded operator sequencing change.** Architecture completion and evidence standards still apply to their own claims; they do not force continued API operation. | [retirement](#retire-hosted-inference-and-the-old-api-completely), [delivery](#delivery-and-publication). |
| Preserve earlier navigation/standalone names flow, recommended `/names` → in-app names modal only | **Settled product simplification.** No dedicated names route, standalone two-name workflow or old iframe/API contract required. Gapless grid and accepted Back exit remain. | [names contract](#names-selection-implementation-gap-and-complete-target), [settled UI decisions](#settled-ui-decisions-and-responsiveness--12-october-2026). |
| Broad media re-import → external MP4 project opening deferred | **Accepted scope deferral.** Saved video works; preserve MP4 metadata/readers and on-origin playback. Portable still reopening remains. | [operator dispositions](#operator-dispositions--12-october-2026), [media](#media-and-recovery). |
| Morph action → Morph also prepares unfinished valid words/seeds | **Accepted added behavior.** Users need not Generate every valid input first; one parent intent owns progress/Cancel. | [operator dispositions](#operator-dispositions--12-october-2026). |
| Unsettled Save/Share sketch → Share/Save priority, formats, editable informative filenames | **Settled additional product choices.** Actions stay below each output; file preparation/reuse and honest fallback are explicit. | [export direction](#file-sharing-and-export-direction), [11 October decision record](#pre-download-decisions-non-face-consumers-and-filenames--11-october-2026). |
| Ordered faces within a source → one global cross-file click order | **Settled extension.** Mixed recovered-still/photo composition and exact batch commit mechanics are engineering design within it, not supplied by the single-crop screenshots. | [batch contract](#gaps-with-reasonable-solutions-inside-the-accepted-design). |
| Provider explanation → optional bounded device timing, estimates and computer guidance | **Later requested addition; implementation budgets proposed.** Optional estimates never become admission proof or a new calibration/phone benchmark gate. | [pre-download guidance](#lightweight-device-check-and-pre-download-guidance), 11 October decision record above. |
| Alternate checkpoint where available, otherwise disclose limitation → actual non-face clean-consumer proof | **Stronger architecture requirement recorded later.** Complete package architecture needs real end-to-end proof, separate from early API retirement. | [external developer journey](#external-developer-journey-and-non-face-models). |
| Extraction allowed against temporary Fable facade → briefly blocked on all UI/Vite stages → runnable facade/contracts/manager prerequisites | **Revised engineering sequencing choice.** Reduce unnecessary serial work; final verification still joins full UI migration and packages. | [migration gates](#migration-gates-and-recommendation-status), [sequencing](#implementation-approach-and-sequencing). |
| Existing debug checkbox/error reports → anchored disclosure and retained Off-state reporting toast | **Requested UI refinement and consent correction.** Keep a report toast while standing reporting is Off; distinguish one-shot sending from explicit future-report opt-in and make withdrawal discoverable. | Latest telemetry question; [consent contract](#debug-reporting-control-and-consent). |
| Generic CI preservation → named existing desktop/mobile/GPU lane commitments | **Preservation made explicit.** The earlier phone/CPU exclusions degraded the planned contract; no workflow was removed. Retain lane roles/triggers and repair stale harness assertions instead of dropping cells. | [CI retention map](#platform-ci-retention-and-performance-preservation). |
| Pack/clean-consumer checks → independent review of actual published npm versions and docs | **Latest requested acceptance addition.** Pre-publication packs still help; public-registry usability sign-off follows publication and must be performed independently. | [published-package acceptance](#independent-published-package-acceptance). |
| Optional extra codecs after defaults → goal-driven exploration of additional image and video exports | **Latest requested export extension.** Default WebP/PNG/MP4 stays simple; qualify options for a specific sharing goal without silently dropping recovery data. | [export direction](#file-sharing-and-export-direction). |
| Generic numerical/export evidence → explicit synthesis versus compression rules | **Latest operator clarification of retained research policy, not new byte-parity scope.** Network synthesis must remain virtually identical within the existing small numerical tolerances; different image compression/container bytes are acceptable. | [correctness and quality boundary](#synthesis-correctness-and-export-quality); artifact/model hashes identify inputs and tested builds, not an image-output parity requirement. |
| Streamed e4e can materialize verified shards over HTTP during execution → manager acquisition before offline engine operations | **Engineering boundary change required by caller-loaded separation.** Preserve bounded lazy verified local reads; never require all 108 shards in RAM. Record cold-photo timing/storage/overlap tradeoffs rather than claiming identical acquisition mechanics. | [loaded handles](#browser-model-manager), [contracts](#package-and-operation-contracts). |
| Crop-confirmation-delayed large downloads → explicitly approved synthesis-first preparation during photo selection/review | **Latest operator performance refinement; real scheduling change.** Recommend generate-and-encode with a clear Generate choice. Start approved acquisition before OK and overlap input work; no model network on arrival or merely opening recovered results. | [download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming). |
| Cache-only prefetch → optional budgeted verified-cache runtime warming | **Latest requested optimization direction, not an achieved speedup.** Warm the selected eligible generator when useful and affordable; retain foreground priority, local-only access and constrained phone encoder transitions. | [download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming), [targeted research](#targeted-autoresearch-launch-and-preserved-history). |
| Classic stays the executable research checkout until re-homed "deliberately" → classic is wound down; new development and any further autoresearch live in this monorepo and optimise the new app | **Later operator direction, 15 October 2026; real scope change.** Research tooling, ledger continuation and device recipes move here as a named workstream. Classic ends (tightened 18 October) as the self-host Docker distribution plus its Git history; its candidate delivery stays only until source handover, and the experiment record moves here with the rest of the research. New rounds measure the new application and packages, not the F# candidate. | [end state of the repositories](#end-state-of-the-repositories), [autoresearch re-homing](#autoresearch-re-homing). |
| Pinned candidate-era dependencies → general dependencies move to latest stable; bleeding-edge (nightly, canary, source builds) is a qualified, non-shipping lane | **Operator direction, 16 October 2026.** The shipped stable experience never depends on a nightly. A bump never loosens numerical tolerances or no-regression cells. | [dependency currency](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026). |
| Classic Compose as a supported distribution → a frozen, feature-complete old frontend plus old backend with a one-command, README-executed clean-clone guarantee | **Operator direction, 16 October 2026.** No feature work or dependency bumps after qualification; the work is making it reproducible and rot-resistant. An EOL .NET build stage inside the image is acceptable if it works. | [frozen self-host guarantee](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026), [classic distribution](#classic-distribution). |
| Crop follows the locked mockups; Share/Save export → crop very similar to the old hosted UI, and keep the export flow | **Operator clarification, 16 October 2026; consistent with existing authorities, not new scope.** The locked mockups and `EncodeImageDialog.fs` already govern the crop; the candidate export flow is already the retained baseline. | [crop fidelity](#crop-fidelity-and-export-flow-clarification), [export direction](#file-sharing-and-export-direction). |
| Interim F# import, typed facade through Fable and unchanged path move → a direct, faithful TS/React/Vite port using the built control artifact as the oracle, with no .NET build in this repository | **Operator decision, 16 October 2026 (D1): build .NET only if something needs it; nothing found does.** Replaces the interim path in the sequencing sections. No fallback and no checkpoint (operator, 17 October): a blocker is fixed in TypeScript against the control artifact. | [application migration](#application-migration), [candidate import](#candidate-source-import-and-bootstrap). |

Already original, **not new scope**: exact supplied crop design, confirmed-crop
direct e4e repair, instant inference-free named results, per-face burger placement,
Generate/Cancel, paste, ordered insertion, gapless headerless picker, removal of
hold-to-compare, idiomatic TypeScript, caller-loaded weight-free engine and classic
NVIDIA Compose/four packages. New checks make these reviewable; they do not make
them new requests.

Use this ledger and the behavior-authority table as the baseline for each small
checked revision. Add any substantive scope/behavior difference here with its
authority before treating it as settled. Keep proposals, research results,
implementation and deployment distinct. The research map below supplies preservation
traceability without turning every experiment into required release work.

## Source names, live surfaces and what each supplies

Use these names in design discussions, reviews and receipts. A repository, a branch and a live
hostname are different identities. In particular, **legacy production is still
current production**; calling it legacy describes its architecture, not its status.

| Name used in this plan | Location / identity | Authority and intended use |
| --- | --- | --- |
| Legacy production web | `https://facemorph.me` before production cutover | Current public UI and useful visual/interaction reference, including its embedded names picker. [application inventory](#application-inventory) must identify its deployed artifact/source; do not infer the deployed revision from a local branch. |
| Legacy hosted API | `api.facemorph.me`, plus `checkface.facemorph.me` surfaces | Current server-backed generation/encoding and API documentation/serving to inventory for retirement. Archived `checkface/` supplies source provenance, not proof of live server bytes. |
| Legacy names site | `https://names.facemorph.me`; sibling `facemorph-names/` | Existing gapless face-grid visual reference and standalone two-selection behavior. Its source calls the legacy API; it cannot remain unchanged after API retirement. |
| Retained application repository | `facemorph.me-classic/`, GitHub repository ID `295956585` | Contains BOTH legacy frontend/server code (`src/App.fs`, `Server/`) and the on-device candidate (`src/Next/`), plus desktop, self-host and research history. The repository's name does not make every file legacy implementation. |
| On-device candidate | `facemorph.me-classic` branch `candidate/next-delivery-20260916`, `src/Next/`; deployed to `https://next.facemorph.me` | Implementation/feature/performance baseline to import and refactor. This is F#/Fable plus JS, not the Next.js framework. Source and recorded live artifact are pinned below. |
| New monorepo | This `facemorph.me/`, GitHub repository ID `1413979666`, branch `main` | Destination for strict-TS application and reusable packages. Currently planning/bootstrap only; no application deploy source yet. |
| Classic self-host distribution | `facemorph.me-classic/self-host/` with its pinned historical frontend and PyTorch API | Separate user-operated Compose product. It is neither the on-device candidate nor proof of what legacy production currently runs. |

Precedence: latest operator instructions and explicit planned UX changes; then
the named visual reference for that interaction; then on-device candidate behavior
for everything retained. Legacy production/names are valid UI references without
requiring old HTTP semantics, result URLs or server-generated pixels in the new app.
For every UI discrepancy [package and operation contracts](#package-and-operation-contracts) records **reference → deliberate change → acceptance**.
Do not describe the source of a change merely as “old app,” “current app” or “Next.”

Observed read-only on 11 October 2026: legacy production has two face inputs,
per-input Browse Names, and an embedded picker with a dark “Select an Image” header
and X. The standalone names site renders the edge-to-edge labelled grid without
that header. The new picker takes the grid as its visual reference and deliberately
removes the embedded header/X under the operator's existing instruction. These are
live UI observations, not a deployment-source attestation or new inference test.
The production notice still announces a fixed October 25 retirement date; update
that active copy when executing delivery work to match operator-controlled timing.

### Behavior authorities for development

The default **functional and performance baseline for the new application** is the
reviewed on-device candidate in `facemorph.me-classic/src/Next`, not the historical
`src/App.fs` application in the same checkout. The final product borrows specific
visual/interaction references from public production, the names site and locked
crop mockups. Use the mapping below when translating, refactoring or writing checks.
Source modules are starting points, not proof that a planned behavior is implemented.

Candidate paths below are from reviewed commit `b2d945a8c7f0ff9f382fbfefaecc2651943077a3`
in `facemorph.me-classic`. Historical frontend paths are inspection/reuse references;
they do not attest the deployed source of `https://facemorph.me`. Names-grid paths
belong to sibling `facemorph-names`. Freeze the execution-time import revision and
dated visual references in the inventory before development. A hostname can change
its artifact at cutover; it must not silently redefine the comparison baseline.

| Concern | Functional/design authority and starting source | Deliberate target and check |
| --- | --- | --- |
| Main page, field modes/defaults, ordered faces, shape settings and playback | Retained candidate `src/Next/Product.fs`, `product-ux.scss`, bridge/geometry/media. | Preserve its multi-face page, insertion/removal, supported shape modes and defaults except declared changes. The locked historical two-face screenshot illustrates removals, not a replacement page template. Compare unchanged migration stages with the candidate; final stages use the approved changes. |
| Local inference, provider admission, optimized pipelines, warm reuse, caching, cancellation and diagnostics | Retained candidate browser/worker/model-cache/media/reporting modules. | Preserve integrated CPU/WebGPU paths, mobile/iPhone optimizations and qualified WASM photo/mapping/codec helpers. Retire native app distribution only. Historical production HTTP calls, server pixels and GUID results do not govern the new app. |
| Each face's burger, Browse Names and Encode image entry | Candidate `Product.fs` `setpointField`; historical `src/MorphForm.fs` is an additional field-menu reference. | Move Browse Names from the field's separate adornment into that same face's burger; capture its stable ID. Rename Upload image and apply the specified tile actions. No page-wide face-selection control or fallback target is required. |
| Crop confirmation/adjustment appearance | Locked `crop image.png` and `crop 2.png`; historical `src/EncodeImageDialog.fs`, styles and crop stencil provide interaction examples. | Reproduce the supplied modal, square handles, guides and rotation/angle behavior. Candidate pan/zoom crop DOM is a starting implementation to change, not the final design authority. Compare rendered geometry/layout with the locked images. |
| Photo computation and alignment-failure guidance | Candidate crop/preprocessing/encoder modules supply local mechanics; locked `failed to align.png` and historical `EncodeImageDialog.fs` supply warning/framing guidance. | Confirm exact pixels before local e4e. Borrow appearance/copy, not historical API encoding before OK or encoded-GUID confirmation. Apply the direct-e4e ruling; no post-confirmation successful-redetection gate or crop loop. |
| Multiple files/faces and mixed recovery/photo insertion | Current written batch contract and later operator rulings; candidate selection/revision primitives are reusable code. | One global click sequence and one commit at OK are planned extensions. Isolated candidate file modals and the supplied single-crop screenshots do not establish the complete batch design. Check cross-file order, budgets and per-slot outcomes. |
| Pasted image in the main text field | Planned operator addition; historical `EncodeImageDialog.fs` handles image paste inside its upload dialog only. Candidate file/drop/recovery dispatch supplies reusable local mechanics. | Add image-first clipboard dispatch to the main field under the same confirmed-photo/recovery contract. Do not claim that candidate text-field image paste already exists. Preserve ordinary text paste. |
| Names grid appearance and dismissal | Legacy standalone grid and sibling `src/ImageGrid.svelte`, `LabelledImageButton.svelte`, `VirtualList.svelte`; candidate modal/focus state supplies the host integration. | Candidate SCSS already gives fullscreen/gapless layout, but its modal still has header/search/Close/Show more and labels below faces. Match the legacy overlaid-label grid and accepted Back exit. Do not import old two-click URLs, iframe/API messaging or selected-image X. |
| Named-result identity/readiness | Candidate catalogue/text mapping and stable-slot controller plus the planned static-result contract. | Replace `ChooseName → RunFace` with verified published results. Preview pixels are not completed results. Check cold/offline selection without generator acquisition/inference and equality to canonical typed-name identity. |
| File exports and on-origin retention/recovery | Retained candidate `image-envelope.mjs`, `recovery-metadata.mjs`, media/project modules and `last-result.mjs`. | Preserve earlier candidate still envelopes (schema-1 PNG and schema-2 PNG/WebP), MP4 project readers and compatible retained records. “Earlier formats” does not mean production GUID/API-media compatibility or cross-origin migration. Apply the planned Share/Save/name/format changes. |
| Classic self-host compatibility | Separate frontend pin `0abb215f27b16e17e3919cf78b616b6ae4998a5d` in `self-host/frontend-overlay/source.json`, classic route inventory and archived backend semantics. | Qualify original frontend/API behavior in classic Compose. This frontend pin is neither the candidate baseline nor evidence of the live production revision; its API compatibility is not a requirement for the new on-device app. |

In application workstreams, “candidate” always means the named on-device source,
and references to an existing action area mean its layout as modified by this plan.
When a behavior comes from another system, name that system and the specific aspect
being borrowed. “Classic checkout” identifies a repository containing several
systems; it is not a behavioral baseline. “Typed candidate facade” wraps the local
candidate bridge/runtime, never the historical HTTP application. Planned target
states must remain labelled planned even when their source controls already exist.

Development has two comparison layers: the facade and the faithful port preserve the
control artifact's observed behavior and integrated optimizations;
the final product is checked against that baseline **plus** the explicit visual and
behavior changes above. Record known candidate defects and planned differences
(crop-loop repair, static names, provider/control/progress changes) rather than
requiring final changes during unchanged migration or freezing defects as permanent
requirements. No layer requires historical HTTP or server-pixel parity.

## Programme boundaries and finish line

“Architecture programme” means the following concrete deliverables, not a new
requirement to keep the API running until all of them finish:

| Track | Deliverable | Completion is established by |
| --- | --- | --- |
| Repository identity | Organization rename and repaired repo/integration references | [organization rename execution](#organization-rename-execution), stable repository IDs and checked active links/integrations. Can be the first execution work after a small identity inventory. |
| Product migration | Import candidate; translate UI/state to TS/React; move delivery to Vite; implement specified photo/face/names UI | The intended UI/photo/names behavior works in the final app; see [integrated verification](#integrated-verification). |
| Reusable architecture | Compute/media/morph engine; browser model manager; model hosting tools; conversion container | Independent consumers work for the documented compute, media, model-management, hosting and conversion capabilities; distribution checks pass. |
| Classic distribution | Documented fresh-clone GPU Compose with original UI/API | [classic distribution](#classic-distribution) and a publication receipt; stays in the retained application repository. |
| Delivery and retirement | Candidate-source handover, production promotion, legacy API retirement, package publication | Separate [delivery and publication](#delivery-and-publication) substeps; each records only what actually shipped or stopped. |
| Further optimization | Frozen workloads and evaluator for future improvements | [research workload design](#research-workload-design)/[research evaluator](#research-evaluator); separately completable research, not a release prerequisite. |

The completed system works as follows:

```mermaid
flowchart LR
  C[Offline model conversion] --> H[Static model manifests and chunks]
  H --> M[Browser model manager: consented fetch and verified cache]
  M -->|loaded capabilities| E[stylegan-js: local compute and media]
  U[Web UI and operation controller] --> M
  U -->|generate, encode, morph, cancel| E
  E -->|pixels, frames, recoverable files| U
  N[Verified static name results] --> U
  U --> F[Local display, Save / Share, file reopen]
  U -->|consented filtered events| D[Diagnostics collector]
```

The published app uses qualified browser CPU/WebGPU runtimes, including supported
mobile/iPhone paths; no installed native host ships in this release. Static model/name hosting and
diagnostics remain online services. Inference runs on the user's device. Classic
Compose is separate: a user operates the historical frontend/API
and PyTorch inference on their own NVIDIA host. Model conversion runs at build /
publication time, never as part of a visitor's normal generation flow.

Default implementation order: [source and repository identity](#source-and-repository-identity)'s small identity/source map, [organization rename execution](#organization-rename-execution) organization
rename/link repair, remaining [application inventory](#application-inventory),
[candidate import/bootstrap](#candidate-source-import-and-bootstrap) and
[package and operation contracts](#package-and-operation-contracts) contracts/design,
[workspace build and artifact identity](#workspace-build-and-artifact-identity) build,
then the UI/build and package branches below, joined by final product checks. Independent conversion,
hosting and classic work can follow their own dependencies. No org rename changes
the candidate branch, switches a domain, promotes a build or retires an API.

There are two distinct hosting handovers: (1) `next.facemorph.me` changes its build
source from the retained candidate branch to the qualified new monorepo; (2)
`facemorph.me` changes from legacy production to the chosen on-device artifact.
Either receipt names repository ID, branch/commit, artifact and hostname. During
handover only one repository's deployment workflow may publish to a given target;
disable/rebind the old publisher when switching, so a later classic branch push
cannot overwrite the new monorepo. Retain stage-appropriate artifacts/configuration
for ordinary site rollback: the prior candidate can undo a candidate-source switch;
after hosted API retirement, use a retained working on-device artifact and its
matching assets/collector configuration. The historical production UI depends on
the retired API and is not a working generation rollback at that point.
Early promotion of the retained candidate is also allowed
and does not mean the new monorepo or architecture programme is complete.

### End state of the repositories

Operator direction, 15 October 2026, tightened 18 October. **New development, and any further
autoresearch, happen in this monorepo and optimise the new application and packages.** Classic is
wound down rather than kept as a second development line. Autoresearch follows the same rule: it
re-homes whole into this repository's `autoresearch/` (see [autoresearch re-homing](#autoresearch-re-homing)),
and future rounds measure the new app and packages, with a pinned candidate artifact only as a
recorded control. The experiment record is not left in classic: it was always about the candidate that
is becoming this app, so it moves here and is removed from classic's working tree (classic's Git
history still holds it).

**Classic's end state (operator, 18 October): a very clean repository that exists to serve the
self-host Docker distribution, plus its Git history.** After wind-down the default branch's working
tree holds the distribution (`self-host/`, its README, and whatever a fresh-clone run of the documented
quickstart proves it needs) and the workflows that keep the distribution honest (the rot check and its
GPU lanes). Nothing else: no candidate source, no experiments or research tooling, no hosting or
staging scripts, no desktop or native packages, no publisher workflows. Everything removed stays
reachable in Git history, which is never rewritten; existing branches and tags are kept. The candidate
publisher and any rollback material classic holds stay only until the declared source handover has
been verified. Wind-down is staged behind the handover it depends on: the new publisher, a working
rollback artifact and the re-homed research record (the whole tree, with the ledger prefix hash
recorded) are verified first. It is automated, not approved step by step: each stage runs when its
CI preconditions verify, as an ordinary commit that Git can revert (see [classic wind-down](#classic-wind-down)). This plan
does not itself delete or archive classic, and no wind-down step is performed by the planning
update.

## Starting facts and boundaries

- New initiative checkout: `facemorph.me/`, origin `github.com/check-face/facemorph.me`,
  default branch `main`, fresh repository ID `1413979666`. This is the continuation
  point for the monorepo plan; it has no application build or deployment yet.
  Repo creation, local directory rename, plan publication and workspace setup
  are complete. Sibling `facemorph-names/` and `encoder4editing/` are also cloned;
  `fm-control/` and `fm-direct/` are retained historical benchmark copies.
- Retained application/source checkout: sibling `facemorph.me-classic/`, origin
  `github.com/check-face/facemorph.me-classic`, ID `295956585`, branch
  `candidate/next-delivery-20260916`. Existing candidate delivery remains
  `https://next.facemorph.me` until a qualified new-monorepo cutover.
- Source reviewed for planning: `b2d945a8c7f0ff9f382fbfefaecc2651943077a3`; recorded verified delivery:
  `001ba853b277775a060030a3ab23a3900af28f16`, build `next-04403766fff8630a`.
  [Receipt](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/docs/plans/feedback-delivery-2026-10-11.md). Reverify before a new comparison;
  neither current checkout nor a rebuilt artifact is automatically the live control.
- `src/Next/` uses F#/Fable plus JS runtime/worker/media modules. The product bridge
  currently mixes application and compute orchestration. Package extraction must
  split responsibilities, not relocate the entire singleton.
- `self-host/` already has a pinned original frontend, a PyTorch-based NVIDIA
  runtime and Compose packaging. Its Dockerfile clones the current GitHub repo
  at a historical commit. Reconcile this implementation before porting duplicate
  server work. Candidate commit `b2d945a8c7f0ff9f382fbfefaecc2651943077a3`
  already repairs the Dockerfile/README clone URLs for the repository rename;
  inspect default-branch and remaining integration references separately.
- The sibling `checkface/` is the legacy backend. Inspect it read-only for migration
  provenance. Its remote is already archived as-is (ID `185985766`); history
  remains readable/cloneable. Do not re-archive or rewrite it.
- Model staging still consumes selected old lab inputs and external artifacts.
  Do not delete `experiment/` or move production weights without an input inventory.
- Preserve other sessions' `.gitignore` / `.cloudflare/` and `desktop/README.md` work. No worktrees, branch
  resets, cleanup of concurrent edits or inclusion of another session's changes.

Current commands in the retained classic checkout are `npm run build:next` and the existing exact-artifact/UI/device
harnesses. Current CI uses Node 22, .NET 5 and pinned Fable tools. The migration
keeps top-level build/verification commands as stable wrappers while paths change.
Use [development](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/docs/dev/README.md), [research protocol](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/autoresearch/program.md)
and [record standards](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/autoresearch/records.md) for current procedures.

## Existing Next implementation and feature disposition

**Build from the existing Next candidate, not from an empty product specification.**
The reviewed implementation is in `../facemorph.me-classic/` on
`candidate/next-delivery-20260916`, source commit
`b2d945a8c7f0ff9f382fbfefaecc2651943077a3`. Repo rename changed its location/name,
not its Next code. New `facemorph.me/main` currently contains planning/entry guides
and tracker export only; it does not yet contain this application. Import/extract
the candidate with source provenance. Classic `src/App.fs` and archived backend
are historical comparison/migration inputs, not the product to recreate in Next.
Legacy production and names still supply the explicitly named UI references above;
retaining candidate functionality does not make candidate visuals the sole reference.
Code inspection establishes implementation presence, not a new live-device result;
the recorded delivery receipt in Starting facts remains separate.

**Preservation requirement:** import and refactor this candidate, retaining its
existing features unless this plan explicitly changes or removes them. Carry
forward **all integrated performance optimizations**, not merely equivalent
outputs. Preserve the existing CPU/WebGPU execution paths, bounded worker/frame
pipelines, model acquisition/checksum/cache recovery, warm reuse, background image
encoding and compressed session/video/scrub restoration. Package extraction and
the TypeScript/React/Vite migration must not replace these with slower generic
paths, repeat inference on restore, or add avoidable encoding/readback/downloads.
If an optimization needs a different implementation at a package boundary,
preserve its benefit and explain and check the replacement against the candidate;
do not silently discard it. Apply declared UX changes on top of that baseline.

Recent candidate work includes mobile controls and crop geometry fixes, background
WebP retention with PNG fallback, bounded compressed multi-face/video/scrub session
recovery, and corrected asynchronous retention checks. The
[11 October delivery note](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/docs/plans/feedback-delivery-2026-10-11.md)
records that work and its verification. Keep these fixes and the earlier integrated
performance work; this short note is a baseline reference, not an exhaustive file
map. Research prototypes and experiment results that were not integrated remain
research evidence, not features to promote automatically. Neither implementation
presence nor reduced work alone establishes a measured whole-journey speedup.

### Deep feature coverage audit

This is a disposition of features found in classic, backend, names and the existing
Next branch. Preserve existing Next features and integrated performance optimizations, except
for the explicit changes/removals in this plan. It does not require matching historical server pixels, URLs or every API
parameter. Computational correctness and exact exported latent/provenance integrity
remain requirements; deliberately different UX is not an accidental regression.

| Feature found in historic sources / Next | Disposition for this release |
| --- | --- |
| Words/names and numeric seeds | Already local in Next. Keep deterministic supported input behavior, validation and default previews; no old-output byte-parity programme. |
| Photo encoding | Already local in Next through e4e. Repair confirmed-crop loop, proposed/adjustable crops, paste equivalence and ordered multi-face insertion under [confirmed-crop encoding](#confirmed-crop-encoding)/[face controls and modals](#face-controls-and-modals). |
| Two-face and multi-face morphs | Already Next. Keep add/remove, ordered controls, mixed photo/generated/restored inputs, current shape modes and useful endpoint reuse. A direct reordering control was not found in the reviewed candidate UI and is explicitly out of scope; retain insertion/removal order without adding reorder UI. |
| Linear, ellipse, figure-eight, smooth paths; pinch/width/length | Already implemented in Next geometry/UI. Carry forward supported controls and meanings; no need to expose every historical HTTP interpolation parameter. |
| Video playback and slider scrubbing | Already Next, with one visible result at a time and available-frame feedback. Keep loop/inline playback, slider choice and retained-frame behavior. |
| Image/MP4 Save and Share | Already Next; `shareMedia` uses the same metadata-bearing export as Save. Improve action prominence/format choice, not a replacement URL-sharing service. |
| PNG/WebP latents and MP4 project metadata | Preserve still-image reopening without photo re-encoding, exact metadata and model incompatibility checks. Keep MP4 metadata/readers and retained-session playback; external MP4 project-opening UI is explicitly deferred. |
| Raw-pixel lossless library helpers | Planned engine API. Do not confuse the library's required PNG/lossless-WebP support with the app's existing acceptable lossy-WebP policy. |
| Project JSON helpers | Existing internal/hidden Next implementation. Keep the schema for embedded MP4 recovery; do not restore a separate project toolbar as a prerequisite. |
| Names catalogue and picker | Candidate has catalogue/previews/latents and fullscreen/gapless styling, but selection currently runs synthesis and the modal retains header/search/Close/Show more and labels below faces. [static names and picker](#static-names-and-picker) applies the legacy grid's overlaid labels and specified chrome removal, with verified ready-made results and no inference on selection. Reuse candidate targeting/modal state; no names-only route or old networking contract is required. Generic `names.facemorph.me` entry may lead to the main app, without result-bearing share URLs. |
| Standalone names two-choice entry / old iframe messaging | Convenience can use local Next selection state; do not preserve cross-app iframe/API contracts or construct a shared morph URL. In-app single selection remains instant as already specified. |
| Provider admission, acquisition and caching | Retain Auto default plus explicit CPU/WebGPU selection and bounded GPU-failure CPU fallback, including mobile/iPhone compatibility. Remove WebGL execution only after dependency checks; keep verified caching/retry, WASM helpers and evidence-based fallback policy. |
| Cancellation, queue/progress, per-face retry | Existing Next primitives; planned per-slot/multi-face behavior extends them. Retain completed results and reject stale results. |
| Session restore and file chooser/drag/drop; image paste | Candidate supplies recovery/local state and file/drop entry. Main-text-field image paste is a planned addition, using the same dispatch/crop contract. Keep compatible recovery within an origin; production starts fresh, with no Next-to-production storage migration. |
| Slow-device guidance, estimates and error handling | Already Next. Keep truthful CPU/WebGPU/helper status, estimates and Retry guidance. Remove public-classic/native-download recovery links; supported-browser guidance stays contextual, with specialist Docker self-host docs only in Help. |
| Diagnostics and analytics | Already Next. Keep privacy filtering, consent, one-shot Send this report, report reference and non-blocking failures; rebind hosts/routes for production. |
| Old GUID/photo/morph links and Mongo archive | Retired by operator. No resolver, preservation migration or public personal-media archive. |
| Share/copy links, SSR previews and oEmbed | Retired. No result URLs, dynamic link previews or hosted generation for social crawlers. Share actual recoverable files. |
| Public face/hash/registerlatent/frame/encode/GIF/WebP API endpoints and extension | Retired publicly. Useful API workflows remain available only through users' own classic Compose installation. No hosted compatibility layer. |
| GIF / animated WebP / JPEG export in the new UI | Optional future formats, not required to retire the API. Start with existing WebP, PNG and MP4; any added format must embed and recover the relevant latent/project data. |
| Hosted HF trial/account/quota flow | Superseded historical experiment. No sign-in, HF entitlement or owner-funded inference service in the new product. |

### Candidate preservation comparison — 12 October 2026

The exclusive desktop-WebGPU review was a **planned support regression**, not a
change deployed to `next.facemorph.me`. It incorrectly treated native retirement
as removal of browser CPU/mobile routes, and proposed replacing their regression
checks with refusal checks. The generic “available devices/no physical-phone gate”
wording then hid the existing desktop/emulator/Simulator commitments. This was a
failure to reconcile the proposed scope with the candidate baseline, not a technical
constraint. The corrected policy preserves first-class phones and their existing CI.

12 October read-only verification found current HTML references the recorded
`app.3cd82ce73a97b620d455.js` and stylesheet; fetched app/style/runtime-manifest hashes
match the [11 October live receipt](../facemorph.me-classic/docs/review/feedback-fixes-2026-10-11/live-assets.json).
No model payload was fetched and no new inference/performance measurement was made.
GitHub still records successful artifact/CPU/compiled-UI/deploy
[run 38066762339](https://github.com/check-face/facemorph.me-classic/actions/runs/38066762339)
and Android/iOS component + iOS product
[run 38067059174](https://github.com/check-face/facemorph.me-classic/actions/runs/38067059174)
for source `001ba853…`. These are retained evidence, not new all-platform qualification.

| Candidate capability | Previous plan weakness → retained target | How to verify / intentional limit |
| --- | --- | --- |
| Auto provider default and CPU/GPU choice | CPU/WebGPU shorthand could omit Auto → keep **Auto**, CPU and WebGPU, moved from More options → Advanced to a compact selector above the first +; Auto uses fixed failure-only GPU→CPU preference | Report requested and actual routes; explicit-choice semantics survive. Remove WebGL only. |
| First-class mobile behavior and CI | Phone exclusion, then generic preservation → admitted phone CPU/GPU/photo paths and named Android/iOS jobs | [CI map](#platform-ci-retention-and-performance-preservation); physical-iPhone full performance remains untested. |
| Useful one-face session | Two-face walkthrough dominated → after removing down to one face, Generate/Encode/Save/reload remain useful | Morph alone gives its add-second-face reason. Keep stable targeting and completed output. |
| Canary/warm initialization and thread limits | Broad optimization promise → retain keyed admission receipts, deferred canaries, GPU mapping overlap and constrained CPU/e4e scheduling | [Performance invariants](#platform-ci-retention-and-performance-preservation); full CI numerical checks remain full. |
| Firefox persistence permission | General cache/consent text → only request persistent storage after explained download approval | Preserve `storage-request.test.mjs` and desktop/Android Gecko versus FxiOS behavior. Denial still yields truthful best-effort cache use; no startup permission prompt. |
| Runtime dependency/privacy boundaries | Generic artifact checks → retain named no-third-party runtime gate and pinned self-hosted libraries/codecs/fonts | Preserve the existing narrowly approved analytics/platform-beacon policy separately; do not introduce third-party runtime/CDN libraries. |
| Tester tools and support links | Debug invitation named, bulk action not disposed → retain `?testing` bulk Generate faces and Help/footer issue/contact access | Test-only actions do not reappear in normal product UI. Prefilled issue context remains safe version/device/actual-route/report-reference information; no automatic issue submission. |
| Candidate delivery cadence | Explicit cutover authority could be read as manual-only previews → retain qualified-push CI deployment after source handover | Required exact-artifact CPU/compiled-UI gates survive; optional matrix/GPU evidence is not silently made a promotion gate. |
| Exports/reporting/public package review | Extra codecs deferred, report-toast deletion ambiguous, packed examples only → goal-based format investigation, Off-state report toast plus opt-out, independent registry acceptance | New clauses below are deliberate additions/refinements, not claims these new formats/public packages already exist. |

No additional major ordinary candidate journey was found wholly omitted after this
audit. Recovery, playback/scrub, cancellation, result/cache reuse and deliberate
face/crop/names changes remain mapped. This is a source/evidence audit: implementation
must still pass the named migration checks; it is not a guarantee that every existing
lane currently passes or every historical device report is available.

### File sharing and export direction

Use **Share** as the primary completed-result action, with **Save** and a compact
format choice beside it. Default to the candidate's current recovery-bearing WebP
for a face and MP4 for a morph; offer PNG for lossless still-image export. Keep
MP4 as the first animation format rather than adding a new codec requirement.
Do not auto-open the system share sheet after generation; sharing is a user action.
Prepare the selected file before enabling its Share action, so the click can invoke
`navigator.share({files})` within the user gesture. Unsupported/failed file sharing
falls back to downloading that same file; user cancellation keeps the result ready.
Save remains directly usable on desktop and when system sharing is unavailable.

**Filenames (operator ruling):** use short, informative defaults from the result's
name, entered text, seed or source-file basename. Examples of the intended form:
`emma-k4p7s2.webp`, `seed-42-j8m3r6.png`, `holiday-face2-v9d2h5.webp`,
`emma-noah-linear-c6q8t3.mp4` and `emma-noah-figure8-b7w4n2.mp4`.
These suffixes are illustrative, not prescribed identities. Preserve a recognizable
short label; for longer paths use the first/last label plus a face count. Include
the morph mode and distinguish selected crops. Strip the source extension, path
components, control/bidi characters and filesystem-reserved characters/names;
normalize whitespace and truncate the descriptive part before the distinguishing
suffix (target at most 64 characters before the real output extension). Use `face`
or `morph` only when no informative label exists. Let the user edit the proposed name
without adding a mandatory naming dialog; preserve the automatic disambiguator.

Different export identities must get different suggested filenames, including
different crops, ordered inputs, morph modes/settings, models and encoding options.
Derive a short suffix from stable export identity and detect/extend collisions in
the app's known export set; labels alone, timestamps alone and slot numbers are
insufficient. Repeated Save/Share of the same prepared file reuses its name. Preserve
identity through restoration so a changed result is not mistaken for the old file.
The extension and MIME must match the actual WebP/PNG/MP4 bytes.
A browser cannot inspect arbitrary existing Downloads files: ordinary downloads
leave duplicate handling to the browser; any optional browser file-picker write
must use no-clobber naming or explicit overwrite confirmation. Do not claim absolute
cross-device/filesystem uniqueness from a short suffix or silently replace a file.
Show the proposed filename with the prepared export. Informative filenames are
visible to share recipients; they do not authorize adding text/source names to
embedded recovery metadata or diagnostics.

Every app-generated file offered through Save or Share includes recoverable latent
and model/provenance metadata. Morph files include the ordered controls and morph
settings needed to reconstruct the project; no raw source photos, typed words,
original filenames or diagnostics are embedded. Metadata inclusion is the default
and is not removed by a “social” preset. Preserve the earlier candidate PNG/WebP
still-envelope and MP4 project readers named in the behavior-authority table.
Only label a new format supported when export plus validated metadata-reader round-trip
works (and still-image UI reopening works); do not silently export a metadata-free JPEG/GIF as a convenient fallback.
If a receiving app recompresses or strips metadata, the untouched downloaded/shared
file remains the recovery source; we cannot promise third-party copies preserve it.
A small WebP/PNG format description can say “Includes editable face data,” without
another confirmation flow. MP4 format help says “Video; reopening this file as a
project is not available in this release.” Embedded project data/internal readers
do not promise an app-visible video import. Still images use the existing per-face file/photo entry. External MP4 reopening
and project-import UI are deferred; keep MP4 export/playback and internal metadata
readers without adding a project toolbar or import completion gate.

[media and recovery](#media-and-recovery) owns container metadata/export format correctness; [face controls and modals](#face-controls-and-modals) owns Share/Save /
format controls and user-gesture handling. The accepted 512 × 512 video path remains
available; show actual resolution with the result/format. Explore additional **image
and video** exports for a specific sharing/exporting goal after the default paths work.

Use a compact **More export options** disclosure inside that result's existing action
area, only when qualified useful options exist. Goals can include a smaller shareable
file, a lossless still for later editing, or a recipient/app's requested format.
Do not add a mandatory export wizard, page-wide toolbar or a long list of disabled
formats. Defaults remain recovery-bearing WebP/PNG stills and H.264 MP4 video.
JPEG is currently only a scrub/display derivative; downloadable JPEG, GIF, animated
WebP, WebM or other video containers/codecs are proposed capabilities, not current ones.

For each proposed format/preset, record actual MIME/container/codec, quality/resolution /
frame order, intended destination, browser encoder/decoder/share support, metadata
carrier/reader round-trip, memory/asset/time costs and evidence per retained matrix
cell. Expose only qualified options for that browser; explain a requested unavailable
format in the existing action/help area and keep the prepared default usable.
Reuse pixels/frames and bounded prepared files without new inference; format changes
have their own file readiness/Cancel/Retry, actual filename/extension and user-gesture
share behavior. A goal requiring extra codec assets or material work uses the existing
cost/consent boundary. Keep every-offered-file recovery metadata unless a later
explicit product decision changes it; a “small/social” preset cannot silently remove
editable data. Physical-device and receiving-app support are recorded, not assumed.
This extends the export journey without making every conceivable codec a release blocker.

### Synthesis correctness and export quality

Compare the **network's raw synthesis output before compression** against the
independent qualified reference for the same model, latent, noise, preprocessing
and declared workload. It must remain virtually identical within a small numerical
margin, including when moving between qualified CPU/WebGPU routes. Retain the
candidate's existing checks and their scope: its product synthesis canaries require
maximum RGB difference of 1 on the 0–255 scale and maximum sampled raw-float error
of 0.002; the applicable research/reference suites supply their own frozen coverage
and tolerances. Product canaries do not replace full qualification where required.
Retain the separate e4e latent tolerance (currently maximum absolute error 0.0001).
These rules preserve the existing ordinary-versus-lab/CI scheduling; they do not
restore the expensive encoder lab check on every visitor. Other supported models
need their own independent references and appropriately small declared tolerances
before qualification, rather than inheriting FFHQ values without validation.
Do not widen tolerances, change precision or replace numerical evidence with a
visual spot-check to make a faster implementation pass. These are source-grounded
limits, not a new full-tensor coverage claim or a comparison with legacy API pixels.

**Exported images need no byte identity between implementations/builds.** Different
compression settings, encoders, metadata serialization or container bytes are
acceptable. Lossy decoded pixels need no exact parity either: check dimensions,
orientation, practical visual quality, valid format/playback and recovery behavior
under the retained [quality policy](../facemorph.me-classic/autoresearch/reviews/2026-10-10/quality-policy.md).
Lossless helpers must preserve their supplied pixels on decoding, without requiring
identical PNG/WebP files. Model/latent/provenance values and their validated recovery
meaning remain exact independently of the representation. A repeat Save should
reuse the already prepared file; its reuse/latency check is not cross-build image
parity. Report compression quality, file size and latency as tradeoffs, not byte
equality gates. Artifact/model/asset hashes still bind inputs, manifests, packages
and deployments to the actual tested bytes; export-integrity hashes can validate an
individual file without requiring another encoder to produce the same file.
If re-encoding changes a payload, regenerate/validate its recovery envelope against
that new payload; do not copy an obsolete integrity hash from the previous file.

### Diagnostics that must survive the move

Reuse `analytics.mjs` and `reporting.mjs`: actual provider, operation/outcome/stage,
bundle/source identity, bounded performance metrics, consented report references,
retry/fallback and export-format outcomes. Preserve privacy allowlists: analytics
honors DNT/GPC/Save-Data, while ordinary-product debug uploads require explicit standing or one-shot
consent. Bounded safe diagnostics may stage in tab memory while reporting is Off.
Preserve one-shot Send this report; never record photos,
latents, typed inputs or raw error strings. Keep failures non-blocking.
`analytics.mjs` currently scopes tracking to `next.facemorph.me`, while
`reporting.mjs` posts to `https://next.facemorph.me/diagnostics/events`: update their
host/route configuration deliberately for production, and keep collector bindings
independent of Triton/API retirement. Check that a consented sample reaches the
collector and a declined/blocked sample does not prevent generation. No iPhone
pass, analytics success rate or diagnostics-derived score controls cutover.

### Debug reporting control and consent

Refine the candidate's `.next-debug` area immediately after `.next-explain` Help/FAQ
into one compact disclosure at `#debug-reporting`: **Debug reports: Off** or
**Debug reports: On**. Expanded, keep the labelled checkbox **Send debug reports
until I turn this off.** Include concise safe-data/retention copy, sending status
and report-reference/copy access here. The debug FAQ and small footer **Privacy &
reports** link expand the disclosure and focus the checkbox. Preserve its state
during work; no face-menu setting, Morph option, output toolbar or new settings page.

Normal product origins default Off and restore the actual saved choice, including
No thanks, without briefly displaying a false state. Preserve the existing explicit
tester invitation and separate disclosed `labs.*` research policy; ordinary product
use does not imply consent. If the choice cannot persist, say **Reporting is on
for this tab; this choice could not be saved.** Do not promise a future remembered
state when storage failed.

Turning Off immediately stops future uploads, aborts pending sends where possible,
discards unsent batches and their session-storage mirror, and clears the consenting
session/random grouping ID. It does not cancel inference, remove results or evict
models. Already delivered reports follow the disclosed retention policy. Off means
no automatic uploads; a separately approved one-shot can send bounded safe staged records
while the standing choice stays Off.
The grouping ID is random and consent-scoped, not a hardware identifier.

Retain one contextual report toast while standing reporting is Off, as the operator
requested. **Send this report** sends only the owning failed attempt's bounded safe
records and never enables standing reporting or overrides a stored refusal. If the
same invitation offers ongoing consent, label that action explicitly **Turn on debug
reporting** and explain future sending; it must not hide that choice under **Send
report**. The candidate currently calls `setDebug(true, "toast")` under that ambiguous
label, so its consent meaning needs correction, not blanket toast deletion. Keep
inline owning-error access without competing duplicate prompts or focus stealing;
when standing reporting is On, do not show another request to opt in. Reporting
never blocks Retry. After either invitation path, the footer-linked On/Off disclosure
lets users withdraw immediately without waiting for another error or toast.

Proposed concise disclosure copy: **Timings, browser/device details and safe error
codes. Never photos, typed words, seeds, faces or videos.** The copy states the retention
that is actually true, and since the 17 October decision below that is "kept, with no deletion
date": it must not say reports are deleted after 30 days, and the collector must not record an
expiry it does not enforce. Debug consent controls debug uploads; it does not claim to disable
usage analytics or “all telemetry.” Keep the separate analytics disclosure clear.

**Retention state checked 15 October 2026 (read-only; nothing was changed).** The
candidate's consent copy (`Product.fs`) tells visitors reports are "Deleted after 30 days."
The collector (`hosting/next-cloudflare/worker.mjs`) writes each report to R2 first, with
`customMetadata.expiresAt`, and to KV with a 30-day expiration only as a fallback. Cloudflare
lifecycle rules match by prefix plus object age or a fixed date, never by custom metadata, and a
read-only API query of bucket `facemorph-diagnostics` (created 21 September 2026) found only the
default multipart-abort rule: no expiration rule and no bucket lock. Reports in the primary R2
sink have therefore not been deleted; the earliest (22 September) pass 30 days on 22 October.

**Retention decision (operator, 17 October 2026, extended 18 October).** Reports have no deletion promise
going forward, and the reports collected under the old "Deleted after 30 days" wording are deleted once
mined. In order:
1. **Ingest the learnings first.** The reports are the only record of how real devices behaved, so
   mine them before anything else. **Done 18 October:** a read-only pass over the whole bucket (801 objects)
   for failure kinds and stages, cache and storage trouble, route admission and download behavior, recorded
   as the committed findings note [docs/findings/diagnostics-learnings-2026-10-18.md](docs/findings/diagnostics-learnings-2026-10-18.md)
   with aggregates only: no device, session or run identifiers and no raw report bytes in Git. The earlier
   WebGL route read is in [provider simplification](#provider-simplification). Findings that change a requirement are folded into the
   owning section of this plan. The note records the digest of the key list it read.
2. **Delete the reports collected under the old wording, once the note is committed** (operator,
   18 October: "I do want to delete the telemetry collected under the 30 days verbiage once we have mined
   it for insights. Keep the insights"). The set is exactly the objects the ingestion read (its key list),
   and only objects uploaded before the corrected line went live (item 5); objects uploaded after it are
   never touched by this step. Deleting early keeps the old promise, which said "after 30 days", and
   reports already past 30 days are due, the earliest on 22 October, so the ingestion does not wait. It is
   a one-off script, not a bucket rule: it lists the set, writes a receipt (count and key-list digest, no
   keys or contents) to `docs/receipts/`, deletes the objects from the R2 bucket, and confirms the count
   afterwards. The KV fallback copies already expire after 30 days by their own setting. Working copies
   of the raw reports made for the mining (on any workstation or scratch directory) are deleted in the
   same step; only the findings note is kept. Repeat the mine-then-delete pass until the corrected line
   is live and nothing older than it remains. It runs on its own once the note is committed and does not
   wait for a human.
3. **Add no expiration rule** to the bucket (the one-off deletion above is not a rule), and make no
   deletion promise for reports collected afterwards.
4. **Change the words, not the data.** The new app's disclosure (above) states the true retention. The
   re-homed collector stops writing `expiresAt` and drops the KV fallback's 30-day expiry, so no code
   claims a deletion it does not perform.
5. **The live candidate's line.** The candidate on `next.facemorph.me` said "Deleted after 30
   days", and reports would have begun passing that on 22 October. Correcting that one string is an ordinary edit to
   the working candidate, not a backport and not new behavior (operator, 18 October: the candidate is the
   thing being worked on, so it is changed as the work goes on; "no patches for legacy" is about the old
   stack and fallbacks, not the candidate). It is the first of the candidate-source copy edits (the
   delivery section's candidate-source handover edit set is the other). It goes through the candidate's
   normal qualified push and had to land before 22 October so that no new report was collected under a
   false line; the moment it goes live is recorded, and it fixes the boundary for item 2. **Done:** commit `40c63a9` on the
   candidate branch changed all four places (the two toasts and the two help paragraphs) to say reports are kept with no
   deletion date; its deploy job finished at 2026-10-17 20:28:59 UTC, which is the boundary, and the live bundle no longer
   contains the old sentence.

Built-UI checks cover saved On/Off/refusal, storage failure, keyboard/label/link focus,
withdrawal during an active job, aborted/discarded sends, no new debug traffic after
Off without a separately approved one-shot, scoped reporting with unrelated staged
slot records, Off-only toast visibility, explicit ongoing opt-in and later withdrawal,
and the failure-toast consent fix.
Exercise the actual configured collector's retention and production host bindings.

### Changeover statistics in Grafana

Operator request, 24 October 2026. Collect a few key usage and performance numbers into the existing Grafana
(`metrics.facemorph.me`), so that a blog post can show traffic and performance before and after the switch from the
hosted-API facemorph.me to the new in-browser engine. It is ordinary product analytics, kept separate from the
existing Grafana dashboards. It is approximate by design: exact counts are not needed.

**Before and after.** The "before" side already exists. The old API server exports Prometheus counters that the
existing Prometheus on triton keeps for 5 years: `image_generating_total`, `image_encoding_total`,
`request_processing_seconds`, `generator_network_seconds` and `ffmpeg_processing_seconds`. The "after" side is new:
the new app works in the browser, so the server never sees an encode. The app therefore reports a small set of
anonymous counts and timings to a first-party endpoint, and Prometheus scrapes it. The dashboard puts the old
server's counts beside their new equivalents, with an annotation at each cutover step.

**Privacy and consent.**
- It reuses the analytics vocabulary already in the candidate (`src/Next/analytics.mjs`): closed-vocabulary values
  and bounded numbers only. It records no words, seeds, names, photos, file names, IP addresses, cookies, device
  identifiers or attempt IDs.
- The endpoint stores only aggregate counters and histogram buckets. No per-event record is kept, so nothing can be
  re-identified later.
- Because it stores nothing on the device and keeps no identifier, no cookie banner is needed. It follows the same
  opt-outs as the existing analytics: off for Global Privacy Control, Do Not Track and Save-Data, and off on non-
  production hosts and under automation. A one-line **Usage statistics: On/Off** switch beside the debug-report
  disclosure lets anyone turn it off; the choice is kept in local storage. Help states what is counted.

**What is counted.**
- Visits, by platform class (iPhone, Android, desktop) and first or returning visit.
- Jobs by action (face, photo encode, morph, names pick, blend), route (CPU or WebGPU) and outcome.
- Job durations as histograms by action, route and platform class.
- Time to first result, cold or warm.
- Morph frames, exports by kind and method, and first-visit model megabytes.

These are the analogues of the old counters (encodes, generated faces, request and generation time), and they also
feed the after-release half of the [strictly-not-worse gate](#strictly-not-worse-than-the-candidate-operator-24-october-2026).

**Path.**
1. The page batches events in memory and sends one small beacon when the page is hidden, or at most every 60
   seconds while it is in use. It goes to the same-origin `/stats/v1` on the app host, so there is no CORS and no
   new origin.
2. A Cloudflare Worker, deployed by CI like the diagnostics collector, validates the beacon and adds it to counters
   in one Durable Object. It runs on the Workers Free plan; the beacons are batched to stay inside its daily limits.
3. The Worker exposes the totals in Prometheus text format at a token-protected `/stats/metrics`.
4. The triton Prometheus scrapes it every 60 seconds as job `facemorph_web`. Metric names start with `fm_web_`, so
   they never mix with the old server's.

**Anti-abuse.**
- The Worker accepts only `POST` from the app's own origins (`Origin` and `Sec-Fetch-Site: same-origin`).
- A beacon body is at most 4 KB, holds at most 200 events, and uses only the closed vocabulary. Each beacon can add
  only bounded amounts to any counter, and durations are clamped.
- Each client is rate-limited in memory by a hash of its address and a daily salt; the hash is never stored.
- Obvious automation is dropped.
- The scrape endpoint needs a bearer token, held as a Worker secret and in Prometheus's config.
- A flood can therefore skew the numbers a little but cannot store data or reach anything else, which is acceptable
  for blog statistics.

**Grafana.** A new folder, "FaceMorph changeover (public stats)", holds one dashboard, "FaceMorph before and after":
- faces and encodes per day, old server against new app;
- typical job time by action, old server against new app by route and platform class;
- WebGPU against CPU share;
- visits by platform class;
- cutover annotations.

The dashboard and the scrape job are kept as code in this repository and provisioned onto triton, not edited by
hand. Existing dashboards are untouched.

**Where it lands first.** The endpoint, the scrape job and the dashboard are set up now. The page-side sink is added
to the candidate as ordinary candidate work (operator, 18 October), so data exists before the cutover, and the port
carries it over. No operator decision is needed (operator, 24 October); only the live cutover pushes need one.

**Acceptance.**
- Worker unit tests: the vocabulary allowlist, size and count limits, the origin check, the rate limit, and the
  Prometheus text output.
- A sink unit test: it is off under GPC, DNT, Save-Data, the switch, non-production hosts and automation.
- An end-to-end run against a test Worker checks the beacon contents by intercepting the request, and that no other
  host is called.
- After deploy: the Prometheus target is up, and one real beacon shows up in `fm_web_*` within two scrapes.

## Required repository architecture

| Surface | Required end state | Migration constraint |
| --- | --- | --- |
| GitHub organization | Rename `check-face` to the selected compliant login `facemorph-me` (brand: FaceMorph.me). | Verify the actual available/valid organization login and permissions. `facemorph-me` is the chosen URL login; verify availability/permissions at execution. `facemorph.me` remains the product/domain brand. |
| `facemorph.me-classic` | Complete/qualify the legacy server and original frontend with PyTorch and easy Compose. | Repository rename is done; preserve history, pinned frontend commit, API behavior, model sources and attribution. |
| Existing fresh `facemorph.me` repository | Implement monorepo with UI, engine, model manager, model-host tooling and model converter. | Establish source provenance, package boundaries, CI, deployment pins and a rollback route before cutover. |
| Triton, `api.facemorph.me`, `checkface.facemorph.me` | Retire hosted inference and both old API hostnames completely. | Operator chooses timing; Next keeps working, diagnostics/models/names remain, and users may self-host classic Compose. No GUID/link archive or compatibility API. |
| npm publication | Publish the engine, the browser model manager and the Cloudflare model host to npm (the converter ships as a pinned container, not an npm package); resolve real npm names/scope when publishing. | Working folder names are not reserved package names. Pack/smoke-test first; ship no pretrained weights. |

Target layout for the new monorepo:

```text
facemorph.me/
  PLAN.md                          # stable latest-plan pointer
  apps/web/                        # TypeScript/React UI and application policy
  packages/
    stylegan-js/                   # compute, morph geometry, image/latent metadata
    browser-model-manager/         # chunks, checksums, OPFS/cache, loaded handles
    cloudflare-model-host/          # reproducible model-chunk hosting tools
    model-conv/                    # pretrained StyleGAN2 conversion tooling
  autoresearch/                    # frozen workloads, evaluator, candidates, ledger
  hosting/                         # application staging, promotion, diagnostics collector, names-catalogue pipeline (the reusable model-host package stays separate)
  docs/plans/repo-cleanup-and-architecture-refactor/ # future contract/inventory/qualification outputs
  scripts/                         # aggregate build/qualification/identity tools
  package.json / package-lock.json  # npm workspaces and pinned dependencies
  tsconfig.base.json               # shared strict TS policy; scoped target configs
  photo-runtime/                   # browser/WASM preparation toolchain as required
```

Use npm workspaces for JS package linkage because npm/lockfiles already exist;
do not add another package manager or orchestration framework merely for layout.
Python conversion/build dependencies can remain Python tooling within their owner.
[Workspace contract](https://docs.npmjs.com/cli/v11/using-npm/workspaces/).
Source paths throughout the implementation approach refer to the retained classic checkout
until inventoried and imported into the new monorepo; they are not already present
in this fresh repo. Source/history transfer still needs [application inventory](#application-inventory) inventory; the
completed bootstrap does not authorize abandoning existing branches or evidence.

The old repository path is already occupied by the fresh repo: old redirects
cannot be relied upon. Prepare artifacts and manifests before the remaining
organization/integration/domain cutover.
Update Dockerfile historical clones, remotes, Actions references, badges, docs,
webhooks and Cloudflare integration explicitly. GitHub does not redirect every
surface, including reusable action calls and Pages URLs.
[Repository rename rules](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
[organization rename rules](https://docs.github.com/en/organizations/managing-organization-settings/renaming-an-organization).

### Organization rename first: known reference changes

[organization rename execution](#organization-rename-execution) can run before application migration; its prerequisite is only [application inventory](#application-inventory)'s
identity/link inventory, not [integrated verification](#integrated-verification) or [classic distribution](#classic-distribution). Read-only GitHub checks on 11 October
2026 found the five repositories below under `check-face` and an active admin org
membership for the authenticated operator. `users/facemorph-me` returned 404 (re-checked 15 October: still 404);
this is not a reservation or proof GitHub will accept the name. Verify availability
in the rename flow when executing. No organization mutation occurred in this review.

| Repository | Stable ID | Intended URL after organization rename |
| --- | --- | --- |
| New monorepo | `1413979666` | `github.com/facemorph-me/facemorph.me` |
| Retained application | `295956585` | `github.com/facemorph-me/facemorph.me-classic` |
| Archived backend | `185985766` | `github.com/facemorph-me/checkface` |
| Legacy names source | `348379171` | `github.com/facemorph-me/facemorph-names` |
| Encoder fork | `368806700` | `github.com/facemorph-me/encoder4editing` |

Known active references from this workspace scan (paths below belong to
`facemorph.me-classic/` unless another repository is named):

| Reference | Required disposition |
| --- | --- |
| All five local `.git/config` origins; maintained README/AGENTS/plan links | Update org prefix, preserving each repository's identity. Do not rename the classic checkout back to the new monorepo name. |
| `hosting/next-static/promote.py`, `REMOTE` and workflow-source validation | While promoting retained candidate artifacts, use `facemorph-me/facemorph.me-classic`; new-monorepo promotion uses its own repo ID/source. The present `check-face/facemorph.me` already names the wrong repository. |
| `self-host/Dockerfile`, `self-host/README.md` clone and Actions URLs | Use the renamed classic URL and the pinned historical frontend commit; the user-facing README names no branch. Check fresh clone still resolves that commit. |
| `src/Config.fs`, `self-host/frontend-overlay/source/src/Config.fs` source links | Classic builds link to classic; new app links to monorepo. |
| `src/Next/product-bridge.mjs` `ISSUE_REPO`; `src/Next/Product.fs` desktop documentation link | Keep candidate bug-report/source links pointing at its actual repository until new app handover; provide the destination issue template. Replace active desktop-install/capability links with web requirements Help. |
| `desktop/scripts/prepare-release.mjs` updater endpoint; `desktop/tests/packaging.test.mjs` expectation | Retire native build/publication/update automation for this release; preserve historical artifacts and provenance. No new updater/source migration or signed native-release gate. Inventory old installed-client/feed references separately so retirement does not point clients at the fresh repo. |
| `.github/workflows/research-built-ui-media-v1.yml` retained-run artifact lookup | If still runnable, resolve the existing run in classic by repository ID; frozen evidence keeps original bytes and gets a lookup mapping rather than historical rewriting. |
| `self-host/frontend-overlay/source.json`, `self-host/REPOSITORY-PROVENANCE.md`, historical Actions/source links | Distinguish immutable original provenance from a current clone URL. Add current resolution mapping; do not pretend an old commit/run belongs to the fresh repository. |
| `src/explain.md`, API FAQ/retirement copy, repository homepage fields | Update active navigation/source links for their actual product; API removal and names redirect are delivery work, not an effect of GitHub rename. Archived backend content remains as-is. |
| Cloudflare GitHub app/project connections, webhooks, Actions permissions/variables, any OIDC subject restrictions, package/container owner paths; names hosting connection | External configuration inventory required. These were not inspected by the source scan. Confirm owner/repo IDs and branch bindings; avoid recreating shared secrets or assuming reconnect is necessary. |

GitHub's current organization-rename documentation says repository links normally
redirect, but the old organization name can be reclaimed and redirects overridden.
Update active remotes and integrations explicitly. Existing wrong-repository links
caused by the earlier repository rename need a **repository-name correction too**.
Search tracked code/config and maintained docs for `check-face`, GitHub/raw/codeload /
release URLs, `gh -R`/API paths and workflow `uses`; classify each hit before edits.
Do not mass-rewrite frozen reports, model identity digests or archived backend code.

Rename acceptance: same five repo IDs/archive/default-branch states; new URLs and
historical commit resolution work; intended Actions/app connections still identify
the right source; active source/help/clone links resolve and native-download links
have their recorded retirement disposition. Check currently
running production and candidate remain at their existing domains/artifacts. Any
changed build gets its normal checks before publishing; a rename is not a deploy.


### Retire hosted inference and the old API completely

The end state is on-device FaceMorph, with no project-operated Triton inference service, photo encoder
API or legacy generation API. Both `api.facemorph.me` and `checkface.facemorph.me`
are retired completely: no API replacement, static artifact API, GUID resolver,
result-link redirect or legacy proxy remains at those hostnames. Self-host users
can run their own frontend/API through `facemorph.me-classic` Docker Compose.
Model chunks, the public names catalogue and consented diagnostics remain hosted
services; they do not provide inference or store user-shared results.

Old Mongo GUIDs, uploaded-photo links and historic morph URLs are deliberately
unsupported. Do not build an archive/resolver, migrate production Mongo data,
rehost personal latents/media, or gate cutover on preserving those records. This
ruling does not itself authorize deleting production data: any later data disposal
is a separate explicit operation. Existing source/history stays archived.

`facemorph.me` starts fresh. No transfer of IndexedDB, OPFS, model caches, preferences
or session state from `next.facemorph.me` is required. Ordinary file-based recovery
continues to work; existing compatible on-origin cache behavior remains useful.
Do not add cross-origin cache bridges or a complex migration wizard.

October 25, 2026 is aspirational. The operator chooses when to promote the candidate
and retire the API. There is no automatic deadline shutdown, historic-service
parity gate, required phone/iPhone test pass, or separate full shutdown-qualification
campaign. [integrated verification](#integrated-verification) checks the intended app works with available relevant checks and
that diagnostics remain usable; missing device evidence is recorded, not a veto.
The operator may cut over the existing working candidate before every architecture /
package/research workstream is finished. Report what is actually complete.

[domain handover and retirement preparation](#domain-handover-and-retirement-preparation) inventories the specific Triton/encoder/API processes, tunnels/proxies, DNS /
Pages bindings and dedicated credentials to retire, distinguishing them from model,
names and diagnostics hosting. It prepares concise commands and remaining active
app reference changes. [delivery and publication](#delivery-and-publication) executes the operator's chosen promotion/retirement
sequence, records which actions occurred, and confirms the new site still serves
its app/models/catalogue and diagnostics. This is ordinary delivery verification,
not a historic-service parity or phone-readiness certification.
Remove the old API hostnames, serving routes and API-only infrastructure; preserve
shared resources still used by model assets, names or diagnostics. Update public
retirement copy: old GUID/results/links will not be preserved, no new share URLs
exist, and the operator controls timing. Do not carry forward the older promise
that every historic link must be reachable before shutdown. No live retirement or
data deletion is performed by this planning update.

#### Known active references to the retiring hosts — source scan 15 October 2026

Tracked, non-frozen files in `facemorph.me-classic/` at `b2d945a` that name
`api.facemorph.me` or `checkface.facemorph.me`. Frozen reviews, research history and
the archived backend are excluded. The scan covers source only; DNS, Pages/Workers
bindings, tunnels and credentials still need the [domain handover](#domain-handover-and-retirement-preparation)
inventory.

| Reference | Why it matters at retirement | Required disposition |
| --- | --- | --- |
| `hosting/gallery/materialize.py`, run by `.github/workflows/name-catalogue.yml` | The only tooling with a **live runtime dependency** on the hosted API: it fetches a 1024px JPEG preview from `api.facemorph.me` for every name that lacks one in the Actions-cache directory (it fetched 2,144 in run 38029582696). A cold-cache re-run after retirement fails; the workflow also triggers on pushes touching its own paths. | Before shutdown, snapshot the published preview and latent assets from both public Workers into durable storage and let the script read that snapshot. The canonical-result generator in [names selection](#names-selection-implementation-gap-and-complete-target) must never call the API. |
| `src/Next/Product.fs` FAQ text and `src/explain.md` | Candidate copy links `checkface.facemorph.me/api` and the archived backend as if the service were current. | Replace with the retirement copy in [delivery and publication](#delivery-and-publication). |
| `src/Config.fs`, `self-host/frontend-overlay/source/src/Config.fs`, `verify-config.mjs`, `verify-overlay.py` | `apiAddr` is the hosted API unless self-host mode is on. The overlay scripts only assert that config text and block-list the hosts in `browser-smoke.py`; none calls the live API. | Historical and classic only. Compose self-host never uses the hosted API, so leave these unchanged; do not copy `apiAddr` into the new application. |
| `facemorph-names` source (sibling repository) | Standalone names grid calls the legacy API. | Retire per [domain handover](#domain-handover-and-retirement-preparation); it is not a dependency of the new app. |
| `multi-morph-test.vercel.app` (external, Oliver's 2023 Svelte test page, used by a tester at Synthetic Data Ltd) | Not in our source. Every image on it is an `api.facemorph.me/api/face/?num_multi=N&guidK=…&amountK=…` request, so it stops working when the API is retired. | Replaced on-device by the [weighted face blend](#weighted-face-blend-advanced-mode); tell its user before retirement. Old GUIDs do not carry over: they re-add their photos. |


### Weighted face blend (advanced mode)

Planned 21 October 2026, revised 24 October 2026 (operator: "a button and a deep link to switch to a more
advanced UI for merging multiple faces at once", on the new engine, reusing existing elements and the established
export paths; desktop first, phone welcome but not required). Not implemented.

**Who it is for and why.** The retired API has one feature the app lacks: `num_multi` blends up to 16 faces
into one image with a weight per face. The Synthetic Data Ltd tester has used it since June 2023, through
Oliver's `multi-morph-test.vercel.app`, to build a library of fictitious, straight-on, ID-photo-style faces for
a synthetic dataset. They asked several times how to self-host the GPU server, and a laptop with a 6 GB GPU was
judged too small for encoding. That page offers one slot per photo (upload, server auto-alignment and encoding,
no crop to confirm; a weight slider 0–1 in steps of 0.1), a "+" that adds a slot and resets every weight to 1/N,
"Reset sliders", and one 500 px blended face; nothing survives a reload. It stops working when the API is retired.
The new app does the same work in the visitor's browser, with no server, GPU host or install, which also answers
their self-hosting question for this use.

**Arithmetic.** The app computes `sum(weight_k * W+_k)` over each slot's existing W+ `[1,18,512]` latent, with
each weight clamped to [-2, 2] and **not** normalised, then synthesises once. For photo slots this is exactly the
API's `num_multi` (`LatentByMultiLerp` in [`checkface.py`](../checkface/src/server/checkface.py) sums the weighted
dlatents), and photo slots are what the tester used. For word and seed slots the API differs and is deliberately
not matched: it holds them as Z vectors, sums them in Z space when no photo is present, and with a photo present
applies each weight inside the mapping network and never again (verified in the source, 24 October). That is not a
linear blend. The candidate already holds every face as W+ (photo encoder, names, text and seed) and its runtime
exposes `synthesize(latent)` (`src/Next/browser/runtime.mjs`), so a blend is one weighted sum plus one synthesis,
about 0.4 s warm on WebGPU in that tester's own diagnostics (one device, not a promise). No new model, encoder or
download is needed.

**Entry and exit.**
- A **Blend faces** button in More options is the only main-page addition.
- The deep link `https://facemorph.me/#blend` opens the app straight into the blend view. A plain hash works on
  static hosting with no server routing, survives reload, and Back leaves the view. It carries no faces or results;
  result-sharing URLs stay retired. Only `#blend` selects a view: Help and footer anchors scroll to their target
  without changing the hash, and an open names picker or crop modal is closed by Back before the view is.
- **Back to morph** (and browser Back, including after arriving by the deep link) returns to the main page with the
  session intact.

**One session, two views.** The blend view keeps its own ordered list of slots in the same session as the morph
faces, persisted and restored with the session (photo retry pixels stay tab-only, as everywhere). The first time it
opens, its slots are seeded as copies of all morph faces that have or can get a latent, at equal weights. Slots are copies: editing a slot never changes a morph face, or the
reverse. A newly added slot gets weight 1/N and the other weights are left alone. **Add to morph** inserts the
blended result at the end of the morph row as a recovered still labelled "Blend of N faces", through the same
admission check as every other entry path.

**Reuse, not new UI.**
- Each slot is the compact face tile from the [many-face layout](#face-controls-and-modals) (words, seed, Browse
  names, Encode image with the confirmed-crop flow, Open saved image, Generate/Cancel/Retry, Remove) plus its weight.
  Photo slots use the same consent, confirmed crop and bounded encode queue as the main page.
- **Filling many slots at once** uses the existing [ordered multi-selection](#confirmed-crop-and-ordered-multi-selection-flow)
  and mixed-batch flows. Choosing or dropping several photos or saved faces opens the one batch proposal: each
  detected face gets a proposed crop that can be accepted as is, saved faces are staged without re-encoding, and one
  OK fills that many slots in click order. This keeps the tester's old "upload and go" speed while keeping
  the confirmed-crop rule. Their practical library is a folder of saved WebP/PNG faces: reopening them restores the
  latent at once, with no photo encoding.
- The result is an ordinary face output, shown and exported exactly like any other face, with no blend-specific
  size or format. That means the full model frame (1024 × 1024 for the face model) in the complete-output display,
  and the established [export paths](#file-sharing-and-export-direction): Share as the primary action, Save, the
  compact WebP (default, quality 0.8) / PNG (lossless) choice, the editable filename and prepared-file reuse. The old
  page's 500 px is not a target. Save writes recovery metadata holding the blended W+ latent and the recipe: each
  slot's kind (word, seed, name or photo), latent digest and weight. Typed words, seeds and file names are not
  embedded, per the export rule; the suggested filename may carry labels under the filename rule (for example
  `blend-3-faces-k4p7s2.webp`). Reopening a saved blend restores it as an ordinary face anywhere. In the blend view
  it also restores the weights of any slot whose latent digest matches.
- The engine gets a pure `blend(latents, weights)` in stylegan-js, descriptor-driven so non-face models get it too.
  The app runs a blend through the operation controller as a parent intent, like Morph: it waits for each slot's
  latent (mapping for an unfinished word or seed, the confirmed encode for a photo, the catalogue latent for a name),
  not for slot images or files, then runs one synthesis. Slots at weight 0 are skipped, and all-zero weights are
  refused with one plain line. A newer weight change supersedes a pending blend (latest wins by input revision). The
  result regenerates when a slider is released or a keyboard step is committed, not on every drag tick. While it
  regenerates, the previous result stays visible marked "Updating…" with Share/Save off until the new pixels and
  file are ready. A missing generator model goes through the existing consent modal; failures offer Retry in the
  result's action area. Leaving the view cancels a pending blend synthesis; slot photo encodes keep running, as on
  the main page.

**Weight control.** A slider from 0 to 1 in steps of 0.05 (old 0.1 values stay reproducible), its value shown as
text, arrow keys stepping by 0.05. The engine accepts the API's [-2, 2] for library callers; the view does not
expose values outside 0–1. Show the weight sum. **Reset** sets every weight to 1/N, the API's default. When the sum
is outside 0.8–1.2, show one line, for example "Weights add up to 1.35. Faces usually look most natural at 1.",
with a **Make it 1** action that scales every weight in proportion. (Weights that add up to less than 1 pull the
face towards the origin of W, not towards the average face.)

**Capacity: no fixed slot limit (operator, 24 October: only real constraints).** The old API's 16 was a server
choice, not a hardware limit. A blend costs one weighted sum and one synthesis whatever N is; each slot holds one
W+ latent (about 36 KB) and a thumbnail, and each photo slot costs one encode through the bounded queue. The real
limits are memory for retained photo inputs (the existing byte budgets in the contracts) and screen space. When a
batch would exceed the photo-input budget, the existing actionable reduce-selection message applies, never silent
truncation. Degrading nicely: past what fits on screen the slot grid scrolls inside its panel while the result stays
in view; slots shrink to compact rows (thumbnail, field, weight); small weights stay usable through the sum line,
Reset and Make it 1.

**Layout.** On desktop the result is large and stays in view on the right, with the slots in a grid of compact
tiles (2–4 columns) on the left and each weight under its slot. On a phone the result is pinned at the top at a
smaller size and the slots form a single-column list of compact tiles. Phone polish is not required, but the view
passes the responsiveness sweep's no-clipping, no-overflow bars. Admission is per operation as everywhere else:
generation on any admitted route including phone CPU, and photo encoding where photo encoding is admitted. There is
no phone-specific code path.

**Moving the tester across.** The retirement notice in [domain handover](#domain-handover-and-retirement-preparation)
tells the tester about the blend view and its link. Ship the blend view before API retirement where practical: this
is a preference, not a gate. If retirement comes first, the notice says so plainly. Old GUIDs do not carry over; the
tester re-adds their photos once and keeps the saved faces.

**Acceptance.**
- Unit tests in stylegan-js: on fixed W+ latents the blend matches a fixture produced by classic
  `LatentByMultiLerp`'s arithmetic on dlatent inputs (numpy, no GPU; raw latent error ≤ 0.0001). Covers clamping,
  unnormalised and negative weights, 1, 16 and 500 slots, refusal of 0 slots and of a non-W+ latent, and a cache key
  built from the weights and latent digests. Synthesis of the result is covered by the existing
  [raw synthesis tolerance](#synthesis-correctness-and-export-quality) canaries; no separate parity image.
- One operated end-to-end run at desktop width, and the same run at phone width where admitted, under the
  [operated-acceptance rule](#acceptance-receipts-and-gate-style-acceptance). Open via the button and via `#blend`.
  Fill three slots (a word, a name, a confirmed photo), then fill five more from one multi-photo batch. Drag the
  weights and check one regeneration per release, Reset and Make it 1. Save a PNG, reopen it as a face on the main
  page, and use Back to return with the session intact. Also: 1, 2, 3, 8, 16, 40 and 100 slots, checking
  the scrolling slot panel and that the result stays in view; Add to morph with a long morph row; reload in the view restores slots and weights; a footer Help link does not leave the view;
  Back with the names picker open closes only the picker.

**Owners.** Compute extraction owns the `blend` function (it can land in the stylegan-js package before the rest of
extraction, since it is pure arithmetic). Face controls owns the view, button, deep link and slot reuse. The
operation controller owns the blend parent intent and supersession. Media and recovery owns the recipe in saved
files. Diagnostics consent control adds the `blend` operation to the shared action list. The view needs the TS/React
milestone, the operation controller, confirmed-crop encoding, the batch flows, the many-face compact tile and the
export controls.

**Effort.** About a day for the engine operation and its tests, and two to three days for the view: reusing tiles,
batch flows, result and export; the deep link; recipe metadata; the operated checks. No change to models, workers or
hosting.

**Not in scope:** old GUIDs or links, a hosted endpoint, blending inside the morph video, automatic or batch
generation of many blends (the saved recipe keeps that possible later), and model training.

**Shuffle weights** (planned 24 October under the no-human-gates rule; the operator may still remove it): one button
that sets random weights adding up to 1, so the tester can produce many distinct faces quickly. Its unit test checks
the sum and the range; the operated run presses it and sees one regeneration.

## Web release and desktop-package retirement — 12 October 2026

Latest operator correction: **retire native desktop packages, preserve browser
CPU fallback and the work making iPhones usable.** The previous review interpreted
“use WebGPU on desktop” as an exclusive platform/provider gate. That interpretation
was a substantive error, not a clarification or an accepted phone/CPU removal.
This policy supersedes that gate while keeping native distribution out of scope.

- Keep Auto (the default), CPU and WebGPU as the choices, in a compact selector above the first +, with the
  candidate's useful default and actual-route explanation. This is a move, not a retention: the candidate's
  only selector is inside More options → Advanced, beside a WebGL entry that goes. Retain fixed WebGPU → CPU preference for
  automatic selection, filtered by real admission and explicit choice; timings
  inform guidance, not automatic ranking. Explicit CPU remains available. Capture requested/actual providers, model and
  authorization scope per intent. Changing the selector affects new requests,
  not queued/active work. No native installer is required to use either browser route.
- Admit Generate, photo encoding and Morph by actual operation/provider capabilities,
  memory and qualified runtime/model evidence, not phone/desktop labels, viewport
  width or touch input. Probe GPU adapters before GPU-only acquisition; absence or
  failure can select the existing qualified CPU route. Generator admission does not
  establish encoder/codec support. Preserve CPU synthesis on iPhone/Safari and the
  candidate's bounded phone photo path where its own admission succeeds.
- Preserve bounded CPU fallback on actual GPU admission/execution failure, compatible
  cache reuse and cleanup. Retain fixed WebGPU → CPU failure-only preference;
  do not demote a healthy slow GPU route or race alternative model downloads. Explain
  actual fallback in the owning action/control; material slowdowns or additional
  assets need the existing revised decision/consent. Explicit provider restrictions
  remain meaningful; a fallback is a declared transition, not silent new authorization.
- When a particular operation has no usable route, block that operation before
  known-unnecessary acquisition/preparation and explain its limitation. Keep static
  names, compatible completed-file display/save and other supported compute actions
  useful. A failed phone photo route does not disable CPU face generation, and a
  missing WebGPU adapter alone does not make the whole app unsupported. Computer
  guidance is contextual advice, never a blanket phone prohibition.
- Preserve WASM mapping, detector/alignment, e4e, codecs, mobile kernels, bounded
  memory/worker lifetimes and background/interruption recovery from autoresearch.
  Current e4e is WASM; WebGPU synthesis does not qualify its speed or memory fit.
  Use the [research coverage map](#autoresearch-coverage-and-preservation-map) to
  retain integrated work and distinguish experimental/negative/missing evidence.
- No native installers, desktop-package publication, signing/notarization, updater
  migration, native IPC/raw-frame parity or installed-host qualification is required
  or advertised. Remove desktop-download/availability recommendations from app errors,
  slow-route guidance and active Help. Retire native release entry points/workflows
  and mark maintained desktop documentation/releases historical or unavailable for
  this release; preserve existing artifacts, source/history and concurrent edits.
  Inventory installed-client/update-feed references without redirecting them into
  an incompatible fresh repository or claiming that a new native update ships.
- Browser result, progress, recovery, cancellation and resource contracts remain.
  Preserve raw display, deferred file encoding, bounded direct frames and optimized
  CPU/WebGPU paths. Classic NVIDIA Compose remains a separate self-host product, with
  documentation in Help rather than a primary recovery/download recommendation.

Retirement is planned execution, not an action performed by this review. A future
desktop release requires an explicit new scope decision and its own qualification.
Temporary imported native dependencies are handled by
[candidate import/bootstrap](#candidate-source-import-and-bootstrap); they do not
reintroduce native distribution as a release requirement.

## Language and framework direction
Recommendation for `repo-cleanup-and-architecture-refactor`: **strict TypeScript, React and Vite**
for the new web application; framework-independent TypeScript for reusable browser
libraries and JS hosting interfaces; **Python/PyTorch** for model conversion and the
classic API. npm workspaces manage JS packages. This is a grounded planning choice,
not an implemented migration or a performance claim. "Recommendation" describes the
alternatives analysis below: strict TypeScript, React and Vite are the planned stack,
and the TS/React and Vite milestones of [application migration](#application-migration)
are required work unless the operator changes the choice.

### Why this fits this repository

The existing UI in `src/Next/Product.fs` is Elmish/Fable over React, with crop/photo
state, names routing and bridge calls. `package.json` currently uses React 17 and
Webpack, while runtime/media modules are JavaScript. Moving to TS/TSX and React
preserves the component/DOM model. The new app never builds F# (no fallback; see
[application migration](#application-migration)): the built control
artifact is the oracle for parity. A simultaneous move to another component framework offers no established
compute benefit and makes required interaction parity harder to verify.

The next app executes inference locally and deploys static bytes with production
headers. It has no current need for server rendering, server actions or a hosted
application API. Vite fits that static SPA, worker bundling and npm-workspace setup.
React's official guidance generally recommends a framework, but also documents
React + Vite for projects with specific constraints. We accept responsibility for
routing, code splitting, error recovery and ordinary deployment checks rather than assuming
Vite supplies them. Inventory the remaining real routes before choosing routing
dependencies; the fullscreen names picker is modal state, not a required `/names`
route. Use lightweight browser-history handling or React Router declarative mode
only where actual app navigation warrants it. Preserve Back dismissal and still-file recovery. Result-sharing URLs,
old GUID/query links, dynamic previews and oEmbed are intentionally retired.

Use React local state for local widgets and pure typed reducers for face preparation,
selection and job transitions. Operation services own abort/disposal and request
revisions; React render/effect lifecycle must not own hidden model downloads.
Typed discriminated unions make invalid state transitions visible and help prevent
crop-confirm loops. Avoid a global-state framework until an actual shared-state
requirement justifies it. Keep high-frequency frames/progress in bounded worker /
service pipelines and throttle displayed updates; React only renders product state.

### Alternatives considered

| Option | Fit and decision |
| --- | --- |
| TypeScript + React + Vite | Recommended. Existing React semantics, static delivery, explicit package/worker boundaries and incremental parity checks. |
| TypeScript + Svelte + Vite | Credible for a greenfield UI; compiler-based components may be convenient. Here it adds a second component/state migration with no measured end-to-end benefit. Revisit only with a bounded parity/performance prototype. |
| Next.js | Supports static export, so it is possible. Its server-oriented features do not solve the present local-inference requirements; additional conventions and static-export constraints offer little benefit for this release. Revisit if real server-rendered content becomes a product requirement. |
| Retain F#/Fable | Not adopted in this repository (operator decision, 16 October). The control is the built artifact, not a rebuild; F# source stays only in classic's Git history (classic's CI retires at wind-down; the built artifact is the control). New product/package code is idiomatic TS, ported faithfully against that artifact. |

### Monorepo language/build contract

- `apps/web`: TS/TSX + React + Vite; routing only for inventoried navigation needs. Product styles
  and accessible modal/focus behavior match the supplied references. The UI kit moves to the latest MUI as
  part of the port (D7, decided 16 October); a generic redesign is not a prerequisite. Assess any crop component
  for touch/rotation/coordinates/maintenance against the actual required interactions.
- `packages/stylegan-js`: strict TS, no React/Vite dependency in its public API;
  ESM JS plus generated `.d.ts` and explicit exports. Typed model/latent/media /
  worker contracts, dependency injection for loaded capabilities, no model resources.
  Worker entry points are explicit emitted JS exports with tested bundler loading;
  a consumer must not need the app's Vite aliases or filesystem layout.
- `packages/browser-model-manager`: strict TS browser services for manifests,
  verified chunks, OPFS and loaded handles. Browser-only features have explicit
  capability failure; importing the module does not access globals or start I/O.
- `packages/cloudflare-model-host`: TS public CLI/interfaces where JS tooling is
  appropriate; retain verified Python staging behind documented adapters during
  extraction rather than rewriting it for language uniformity. No UI/React runtime.
- `packages/model-conv`: Python/PyTorch conversion core with pinned environments,
  numerical checks and documented CLI; optional TS wrapper is convenience only.
  Model/tool ecosystems justify Python here. Generated shader/WASM/native code
  remains in its appropriate language and owner; TS is the orchestration language.
- Classic repository: preserve original frontend and Python/PyTorch API/Compose;
  this release does not rewrite that original UI into React/TS.

Use a root base TS configuration with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `isolatedModules` and type-only imports. Scope DOM,
WebWorker and Node type environments separately; shared contracts must not acquire
accidental DOM/Node globals. Validate `unknown` manifest/metadata/worker values at
runtime rather than trusting erased TS types. No broad `any`, unchecked casts or
silent defaults to make migrated code compile. Temporary JS interop uses narrow
adapters with tests and a named retirement owner; do not mechanically rename `.mjs`.

CI must run explicit TS checking separately from Vite build, since Vite transpiles
but does not type-check. Use package declaration builds and no-emit checking for
app/adapters with workspace dependency ordering. Clean pack/install tests include
public types, emitted worker assets, export resolution and a consumer outside the
monorepo. Keep runtime imports free of repository-only path aliases.

Pin stable dependency versions/lockfile and Node compatibility in [workspace build and artifact identity](#workspace-build-and-artifact-identity); do not
fetch `latest` at build time. Vite's browser defaults are not a CPU/WebGPU support
policy: set and verify app/worker targets for the declared browser matrix. Retain
production COOP/COEP/CORS, WASM/worker/runtime integrity, exact artifact hashing,
static route fallback and qualified-byte promotion. No bundler upgrade is a speed
win until fixed first/nth visit workloads measure it.

### Linting and formatting — Oxc tooling

Use **Oxlint** for authored JS/TS/JSX/TSX linting and **Oxfmt** for formatting
supported authored source/config/docs. Their shared tool ecosystem keeps the TS
monorepo tooling small and consistent. This is a planned [workspace build and artifact identity](#workspace-build-and-artifact-identity) deliverable; no
packages, configuration or scripts are installed by this planning addition.

Pin `oxlint` and `oxfmt` as root development dependencies in the npm lockfile.
Use one root `.oxlintrc.json` and `.oxfmtrc.json`, with explicit file overrides /
ignore patterns and editor instructions. JSON configs keep tool configuration
independent of TS config-loader/runtime assumptions. Pin a compatible Node version;
registry metadata checked for this pass requires Node `^20.19.0 || >=22.12.0` for
both current tools. Select/test exact versions during [workspace build and artifact identity](#workspace-build-and-artifact-identity) rather than using
`npx ...@latest` in CI.

Planned root scripts:

| Script | Behavior |
| --- | --- |
| `lint` | `oxlint --deny-warnings`; read-only lint gate over declared authored roots. |
| `lint:fix` | `oxlint --fix`; explicit local safe-fix operation. |
| `format` | `oxfmt`; explicit local write-mode formatting. |
| `format:check` | `oxfmt --check`; read-only formatting gate. |

Oxlint's native TypeScript and verified React/hooks rules apply with environment
overrides for browser UI, workers and Node tooling. Enable correctness rules and
bounded, justified suppressions rather than a blanket disabled legacy ruleset.
Keep package-boundary/worker/artifact checks: linter coverage does not establish
transitive dependency isolation, numerical correctness or complete type checking.
TypeScript checking remains a separate gate. Select rules supported by the pinned
Oxlint release; any additional type-aware lint mode needs its own verified setup.

Oxfmt uses a shared style (100-column width, two-space indentation); leave automatic
import/package-field reordering off initially so formatting does not introduce
side-effect ordering changes. Include authored app/package files, maintained
scripts, configs and current docs; exclude dependencies, generated Fable outputs,
build/distribution assets, vendored code, weights, fixtures, execution-tracker state/export,
and immutable historical scripts/reports identified by [application inventory](#application-inventory). Exclusions name frozen
artifacts rather than hiding all future autoresearch code or maintained adapters.
Python, F#, Rust and shader formatting is outside these tools' declared scope.

Introduce the style baseline in a separate formatting-only revision; rule fixes
and behavioral refactors stay independently reviewable. CI runs `format:check`,
`lint` and explicit TS checks before build/qualification, without writing fixes.
[workspace build and artifact identity](#workspace-build-and-artifact-identity) acceptance: supported file roots are discovered, ignored frozen/generated
bytes stay unchanged, deliberate formatting/lint violations fail the relevant check,
formatting twice is idempotent, and CI/local/editor invocations share the pinned
configs. [integrated verification](#integrated-verification) retains these gates for release artifacts.

### Model conversion container

[conversion tooling](#conversion-tooling) supplies a reproducible Docker environment under `packages/model-conv`,
with a Dockerfile, pinned Python/PyTorch/export dependencies, `.dockerignore` and
an opt-in Compose conversion service. This avoids host-specific virtualenv setup
and records the actual toolchain used to create provider artifacts. Container
builds include converter code/tools and notices, **no pretrained weights**.

Document build, conversion and independent verification commands from a clean
clone. Mount caller-acquired checkpoint inputs read-only, outputs writable, and
optional reusable tool/download caches as separate volumes. Run with host-compatible
file ownership so outputs are usable without root repair. Keep credentials and
large/generated artifacts out of the build context/image. Acquisition/source terms
and any required acknowledgement remain explicit; containerization grants no rights.

Use a CPU-capable reference conversion/verification path for supported models where
the underlying exporter permits it. An optional documented NVIDIA configuration
uses the host driver/container toolkit and a pinned compatible CUDA/PyTorch stack;
it does not silently fall back or claim arbitrary GPU support. Unsupported CPU /
GPU/export combinations fail clearly. Record the validated OS/architecture/provider
matrix and expose absent hardware evidence. This service does not change the
classic API's separate inference container or add conversion to ordinary app startup.

Pin base images by digest, Python dependencies and upstream converter revisions.
Record image digest, tool/source versions, input checkpoint checksum/provenance,
conversion flags and output manifest/digests with each report. Test empty-cache and
repeat conversion, interrupted/error cleanup, supported model shapes and numerical
parity with independent references. Byte-reproducibility is claimed only if proven;
otherwise record any nondeterministic fields and require numerical/identity parity.
Release builds use the same image/environment qualified by those checks. [conversion tooling](#conversion-tooling)
acceptance includes clean-clone container conversion and artifacts loadable by the
manager/engine; [integrated verification](#integrated-verification) checks provenance, supported capabilities and package/image
contents alongside the existing release qualification.

### Migration gates and recommendation status

[package and operation contracts](#package-and-operation-contracts) freezes TS package/operation types and runtime validation. [workspace build and artifact identity](#workspace-build-and-artifact-identity) establishes
workspace/type/build/worker/route identity gates. After [candidate import/bootstrap](#candidate-source-import-and-bootstrap) (the JS closure and the pinned control artifact, with no F# build), [application migration](#application-migration) follows ordered implementation milestones: a typed facade over the retained JS bridge, then a faithful port of the controller (pure typed reducers) and of the rendering to TS/React, on Vite from the first build; [face controls and modals](#face-controls-and-modals) /
[static names and picker](#static-names-and-picker) apply the declared UX changes afterward. The built control artifact is the behavior oracle: check the intended current-Next flows against it through each revision, and do not claim the new TS app works merely because it compiles. No comparison with the old hosted API is needed. The user requires
idiomatic TypeScript for the revamp; React/Vite is the recommended framework/build
choice. [Compute extraction](#compute-extraction)
can begin once the typed facade executes through the real bridge in a headless-browser harness, contracts and applicable
build checks pass, and [model manager extraction](#model-manager-extraction) loaded
handles are accepted. It need not wait for the port; those remain ordered UI/build milestones and join final integration.
Integrate engine and UI/build changes in separate checked revisions to avoid competing
bridge edits. Manager/host/converter work follows the dependencies below. The operator decided on 16 October (D1) that .NET builds happen only if something needs them, and nothing found does: F# is never built in this repository, classic keeps its own F# build and CI, and unverified deletion of consumers or classic historical inputs remains out of scope. There is no .NET fallback and no checkpoint date (operator decision, 17 October; see [application migration](#application-migration)).

### Primary documentation checked for this planning pass

Checked 11 October 2026; these establish supported approaches, not timings:

- [React: build from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
  documents Vite's React/TS template and the SPA/framework tradeoffs.
- [React: reducers](https://react.dev/learn/extracting-state-logic-into-a-reducer)
  supports extracting complex state transitions from rendering.
- [Vite guide](https://vite.dev/guide/) and [features](https://vite.dev/guide/features.html)
  document TS transpilation, independent type checks and worker support.
- [Vite production build](https://vite.dev/guide/build.html) documents browser
  targets, static deployment and library builds; pin actual tool versions in [workspace build and artifact identity](#workspace-build-and-artifact-identity).
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html)
  documents strict checking; runtime boundary validation is still necessary.
- [React Router declarative mode](https://reactrouter.com/start/declarative/installation)
  documents routing without adopting its server framework mode.
- [Svelte overview](https://svelte.dev/docs/svelte/overview) and
  [Next.js static export](https://nextjs.org/docs/app/guides/static-exports)
  support the alternative comparison above.


Oxc sources checked for this tooling addition:

- [Oxlint guide source](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/linter.md)
  and [native plugins](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/linter/plugins.md).
- [Oxfmt guide source](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/formatter.md)
  and [configuration](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/formatter/config.md).
- npm package metadata for [oxlint](https://registry.npmjs.org/oxlint/latest) and
  [oxfmt](https://registry.npmjs.org/oxfmt/latest), checked 11 October 2026.

## Package boundaries

### stylegan-js

Accept a caller-supplied already-loaded model capability, with model identity,
dimensions, latent schema, mapping/synthesis and optional e4e support made explicit.
[package and operation contracts](#package-and-operation-contracts) freezes the concrete existing-provider adapter signatures and ownership.
The library neither downloads nor manages model files. The caller-supplied encoder
capability owns bounded sequential sessions using preverified local shards; all
acquisition/verification for that capability's required assets finishes before its
operation is admitted. Independently authorized acquisition for other capabilities
may continue under separate budgets; the engine itself performs no network reads.
It exposes encode/cancel/dispose operations, never file/cache/downloader access.
This keeps the current bounded stream
viable without requiring the whole encoder in memory. It contains no model URLs,
chunk downloader, OPFS cache, model-host dependency or UI/reporting policy.

Own inference, numerical qualification, morph geometry (all current selector modes,
including linear and figure-eight), bounded frame production and computational
image/media helpers. Support raw-pixel encoding to PNG and lossless WebP with exact
latent/stylegan-js recovery metadata, plus validated metadata/latent extraction.
Do not bundle weights or research fixtures containing weights in npm artifacts.
Document NVlabs model acquisition and supported model shapes; unsupported published
datasets are explicit rather than silently forced into FFHQ's current 1024px assumptions.

Lossless library helpers are a required API capability. They do not silently revoke
the existing application's approved practical lossy-cache/download policy. Keep
exact model/latent/provenance integrity separate from decoded-pixel quality.
Worker placement and GPU residency are measured implementation choices.

### browser-model-manager

Own manifest/chunk acquisition, checksum validation/recovery, OPFS/device caching,
cache reuse/eviction/quota behavior and creation/disposal of loaded provider handles.
Its provider adapter owns shard reads and bounded session lifecycle; loaded means
verified and ready for offline operations, not all sessions resident simultaneously.
Current streamed e4e may materialize verified shards over HTTP during execution;
moving network acquisition ahead of engine operations is a deliberate boundary
change. Preserve acquisition/create/run attribution and qualify cold-photo timing /
storage tradeoffs on supported paths. Bounded lazy local reads remain; this does not
authorize loading all encoder shards into RAM or silently losing phone support.
It supplies a loaded capability to `stylegan-js`; the engine cannot reach back into
the manager to acquire more files. The UI authorizes needed downloads via the modal.
Constructing packages or reading status/capabilities must not trigger acquisition.

Keep candidate cache identities and on-origin result/session formats compatible during the
package migration. Split model caches from application retention policy. Cold,
model-cached and output-cached cases remain distinct. Bound resources and fallback;
Loaded handles identify actual providers, admission and validation state. Qualified
independent-library CPU/reference consumers remain separately documented and
qualified. The app retains its qualified CPU/WebGPU routes; no native distribution
is implied.

Loaded handles hold reference-counted leases on required verified local assets.
Manager-controlled deletion/eviction cannot remove leased assets. Browser eviction,
corruption, cross-tab deletion or device/worker loss invalidates the capability
with a typed error; affected operations settle and release resources without
network repair. Leases constrain manager behavior, not the browser’s ability to
reclaim storage. Reacquisition and re-admission occur outside engine execution
through the application’s acquisition/consent policy.

### cloudflare-model-host

Own chunk staging/publication tooling, manifest generation and digest-consistent
serving with required MIME/CORS/embedding/cache headers. Verify chunk reconstruction,
runtime pins and parity between qualified and published bytes. Keep weights out of
package tarballs and private source provenance out of published manifests.
Validate current Cloudflare limits and author model/source terms before publishing;
"free" is a target to verify against the actual asset sizes and service tier.
The classic server downloads upstream author weights; that does not require our
browser chunk origin to replace the authors' download URLs.

Keep a second, independent copy of the runtime and the browser fallback to it. On 20 October
2026 one Cloudflare edge answered HTTP 500 from static-asset storage for single encoder chunks
for about ten minutes at a time, failing a tester's photo on one chunk out of about 100. The
candidate now retries transient chunk failures and alternates with `models.facemorph.me`. That
host is a Worker over the R2 bucket `facemorph-runtime-mirror` that copies immutable runtime
paths from the site and is warmed by every deploy (classic `hosting/next-mirror/`). Carry
both into this package: the second origin is part of serving, not an optional extra.

### model-conv

Convert supported pretrained StyleGAN2 checkpoints into the formats required by
the providers/manager. Start from existing exports and pinned upstream converter
code; document architecture/resolution/operator limits and exact model provenance.
Produce manifest/digest/shape metadata and independent tolerance-based checks.
Document supported acquisition from NVlabs and the linked pretrained-model catalogue;
do not claim every catalogue checkpoint works without conversion qualification.
Keep generators, optional photo encoder and preprocessing identities separate.

### External developer journey and non-face models

The packages must serve a developer starting outside this monorepo. “Use a new
dataset” means acquiring or training a compatible checkpoint first; this programme
does not add dataset training. The main documented deployment is a browser app
served with static model assets. Node/headless/server inference needs its own
documented provider support and is not implied by an npm package or a browser demo.

Document and exercise this complete route:

1. Choose a checkpoint using a compatibility table: source serialization (including
   which PyTorch/TF pickle variants are actually accepted), StyleGAN architecture,
   conditional/unconditional inputs, resolution/channels, Z/W dimensions and W+
   layer count, precision/operators and qualified providers. List unsupported cells
   and an available conversion route, rather than treating every StyleGAN model as
   compatible. Record checkpoint source/digest and model-specific usage/redistribution
   terms. Converter docs explain that pickle loading requires a trusted checkpoint.
2. Run the pinned conversion container's real, copyable acquire/convert/verify
   commands on that checkpoint. Produce all required chunks, descriptor, manifests
   and a reference/parity report. Do not publish pseudocode as a working quickstart.
   Model descriptors govern latent/output shapes, layout/normalization, noise,
   truncation, optional class conditioning and resource requirements. Remove FFHQ's
   fixed 1024px / 18-by-512 assumptions from generic mapping, morph and media code;
   unsupported model/operator combinations fail with an actionable error.
3. Host those artifacts on standard HTTPS static hosting under the developer's
   control. Cloudflare tooling is optional. Explain actual MIME, CORS, cache/digest,
   worker/WASM paths and any COOP/COEP requirements for the selected threaded route,
   including usable single-thread behavior where supported. No FaceMorph hostname,
   catalogue, application alias or secret is needed.
4. Install the published/packed packages into a clean external project. The example
   authorizes model acquisition through `browser-model-manager`, loads a capability,
   then passes it to `stylegan-js` for seed mapping, synthesis and a morph. Also
   document direct caller-loaded usage without the manager. Show progress, abort,
   errors, resource disposal, worker bundling, supported build/browser targets and
   first-use versus warm costs. Package construction/status reads fetch no weights.
5. Export a PNG/lossless-WebP and reopen exact model/latent metadata; exercise a
   multi-input morph with the same model. Version the dynamic-shape recovery schema
   while preserving the earlier candidate readers. Equal-shaped latents from different checkpoint
   identities cannot be silently combined. Unknown models remain viewable as media
   without promising editable inference or following arbitrary metadata URLs.

Generation and morphing of cats/cars/landscapes must not load a face detector or
FFHQ e4e. Photo-to-latent inversion is an optional, separately trained compatible
encoder capability; the accepted FFHQ e4e is not a generic non-face encoder. Explain
this limitation before the developer downloads an encoder or designs an upload UI.

Qualify one real non-face checkpoint end to end, preferably at another resolution
to expose hardcoded assumptions. NVlabs' AFHQ cat 512px model is the proposed fixture,
subject to converter compatibility and acquisition terms; it is not currently
claimed supported. The [upstream model list](https://github.com/NVlabs/stylegan2-ada-pytorch)
also contains conditional models, which does not establish our converter's support.
[Conversion tooling](#conversion-tooling), [compute extraction](#compute-extraction),
[media and recovery](#media-and-recovery) and clean-consumer verification own this
example. Until it passes, label non-face support unqualified and name the blocker;
do not call package extraction alone generic dataset support. This architecture
completion requirement does not delay operator-controlled hosted API retirement.

### Independent published-package acceptance

The explicitly requested acceptance bead `fm-fy2.21` is deferred for an unbiased
review of the **actual published npm distributions and their public documentation**.
The reviewer must not be an author of those implementations and should start with
no implementation conversation, private checkout (the public tagged repository is allowed for the
converter, which is not an npm package), workspace aliases, private lab
assets or unpublished setup instructions. Give them actual package names/versions,
public docs/model-acquisition references and declared supported capabilities only.
This checks whether someone outside the project can really use what we shipped.

**What publishes, settled from the original plan (17 October).** The locked operator overview says
to create `stylegan-js` "which we can push to npm" (the engine, with no model or resources bundled),
with the browser model manager and the Cloudflare model host as sibling packages in the monorepo and
`model-conv` as the converter; the original plan's publication row says "Publish the reusable engine;
resolve real npm names/scope when publishing." This plan reads that as: publish three TypeScript
packages to npm, the engine, the browser model manager and the Cloudflare model host (the acceptance
journey below needs all three from the registry: manager-loaded inference, and serving the converted
model), and ship the converter as the pinned container with its opt-in Compose service, not as an
npm package, because it is Python and PyTorch. Working folder names are not reserved names: each real
name and scope is chosen at publication by a registry availability check, the working names first,
a scope the operator controls as the fallback. Publishing needs npm credentials for that scope; that is
an execution prerequisite, not a decision gate.

Prerequisites: the intended JS/npm packages have immutable registry versions and
public docs/examples; supported provider/browser/model boundaries and converter /
hosting instructions are published; legally obtainable qualified model assets are
available under the documented acquisition path. Package names remain resolved at
publication. A local `npm pack` is useful preflight, not completion of this acceptance.
Review any engine/manager/hosting distribution advertised as released, and follow
the converter's actual public distribution/docs where it is a separate Python tool.

Acceptance requires a clean external project installing those exact **registry**
versions. Follow the public quickstart literally: acquire/convert/verify and serve
the documented model, run manager-loaded inference and a morph, export/reopen
PNG/lossless-WebP with exact recovery values and lossless decoded pixels, and run
direct caller-loaded engine use without the manager. Exercise the documented non-face example and its descriptor/support
boundary; no face detector/e4e download for non-face generation. Check emitted JS /
types/exports/worker assets, public build integration, real model identity/numerical
evidence, progress/abort/error/disposal, cold/warm costs and no network at package
construction/status reads. Qualify actual advertised targets; unsupported Node /
browser/model cells are clear limitations, not inferred support.

Review README/API docs, copyable commands, licenses/notices, model terms, ownership /
resource semantics, errors, troubleshooting and examples as part of usability.
Inspect installed tarballs for missing files, repository-only paths, secrets or
bundled weights. Record exact registry versions/integrity, clean project lockfile,
browser/provider/model/runtime identity, copied commands, outputs and every undocumented
step or confusing instruction. A package isn't accepted because an internal example,
typecheck, tarball scan or its author says it works.

The independent verdict names usable capabilities and concrete failures/gaps.
If instructions require unpublished help or an advertised journey fails, the bead
stays open/deferred as appropriate; fix and publish a **new** version, then recheck
the actual registry bytes. Do not overwrite a published version or quietly point the
reviewer at local source. Completion requires a retained independent acceptance
report linked to those published versions, including docs. Publication can occur
before this review; packages are not declared independently accepted until it passes.
This final package-usability gate does not block an earlier operator-controlled web
promotion or retirement of `api.facemorph.me` / `checkface.facemorph.me`.

**Reviewer logistics (added 16 October from the cross-model review).** Before publication, name the
independent-reviewer role (a person or an agent session that did not author the packages) and
decide what it is given: published package names, versions and public documents only. Set a bounded
review budget in time and resources, because the journey includes conversion, hosting, inference and a
round trip. Any journey the reviewer skips for budget or environment reasons is recorded as
unverified, never as passed, and an author-run smoke test is never substituted for the review.

Only this explicitly requested acceptance item is authorized in Beads during this
planning pass; keep the historical execution records deferred and unsynchronized.
Its prerequisite is actual package publication, not unrelated native/API/research
completion. Bind execution dependencies to the eventual publication work when the
historical graph is separately refreshed; do not import obsolete broad release gates.

## Classic distribution acceptance

After clone, `docker compose up` with the documented NVIDIA-capable configuration
must start the original frontend and API, handle author-hosted weight download/setup,
and print a clickable local browser URL. Host prerequisites are an actual working
NVIDIA driver/container runtime, Docker and Compose. No implicit CPU success can
stand in for required CUDA execution. CPU compatibility can remain documented.

Reuse existing PyTorch/self-host compatibility work where verified. Preserve old
seed/text semantics, photo reconstruction, morph/media endpoints, saved identities,
health checks and persistent model/media volumes. Validate both empty-volume
startup and restart reuse on an available GPU; lack of GPU evidence stays explicit.
The new monorepo web app runs locally in the browser and does not acquire the classic
API as a dependency. Backend archival is complete; verify Docker/PyTorch in `facemorph.me-classic` before claiming classic complete.

## Dependency currency and the frozen self-host guarantee — 16 October 2026

Operator direction in three parts. Everything below is **planned, not implemented**. Facts
marked *verified* come from registry queries, the pinned candidate and classic self-host
files, and read-only network checks made on 16 October. No build, container run or
measurement was performed.

**Policy.**

1. **New application, packages and tooling: latest stable.** Every general dependency moves
   to its latest stable release at the first destination lockfile and stays there through
   automated update changes (no calendar review, no named owner; 17 October), in grouped
   revisions (build tools, React and UI, ONNX Runtime, test tools) kept apart from
   behaviour changes. A bump must pass the plan's existing gates: numerical canaries at their
   current tolerances, the retained no-regression cells and the UI checks. "Latest" never widens
   a tolerance or removes a cell. A hold-back needs a recorded reason and a re-check trigger (the next updater run that passes the gates, or the upstream release named in the reason).
2. **Bleeding edge is a qualified lane, never the stable experience.** Nightly, canary, dev and
   source builds run in a separate scheduled, non-blocking lane on a GPU worker under the shared
   lease, recording numerical and paired-performance evidence. Nothing from it ships. A nightly is
   adopted only when it reaches a stable release. A result that must be reproducible names the exact
   version and integrity hash, because retention differs: npm keeps dev builds, but PyTorch's
   nightly index held only 55 builds of the CUDA 13 Linux wheel (oldest 16 August 2026) when checked, so copy any wheel a result
   depends on. Source builds pin a commit SHA and mirror the built artifact.
3. **Classic self-host is exempt: frozen and finished.** It keeps working by being reproducible and
   rot-resistant, not by being updated (below).

Currency of the pieces the new app touches, a dated snapshot that the first lockfile and the updater supersede (*verified* 16 October; "candidate pin" is what the
pinned candidate or its CI uses today):

| Dependency | Candidate pin | Latest stable | Bleeding-edge tag (lane only) | Consequence |
| --- | --- | --- | --- | --- |
| React, React DOM | 17.0.2 | 19.3.1 | canary `19.3.0-canary-098d2e87-20261015` | UI kit and crop library must support it |
| UI kit | `@material-ui/core` 4.12.4 (React 16–17 only, deprecated since 2021) | `@mui/material` 9.5.0 (React 17–19) | none | Decided 16 October: upgrade to the latest. v4 to v9 changes styling, so the visual-parity check stays |
| Crop component | `react-advanced-cropper` 0.6.1 (React ≤17, legacy dialog) | 0.20.1 (React ≥16.8) | none | Optional dependency: upgrade it or reproduce the dialog and drop it; see crop fidelity |
| Bundler | Webpack 5 (`^5.64`) | Vite 8.3.4 | none ahead of latest | Plan already moves to Vite |
| TypeScript | not in repo yet | 7.0.2 | `next` 7.1.0-dev.20261015.1 | Major 7; check each tool's compiler-API support |
| Oxc | planned | oxlint 1.88.0, oxfmt 0.73.0 | none | oxfmt is pre-1.0 |
| ONNX Runtime Web | CPU 1.24.3, WebGPU 1.22.0 (runtime manifest) | 1.30.0 on npm (1.31.0 is a GitHub release of 9 October, not yet npm `latest`) | dev `1.31.0-dev.20260918-bc8e7ed75` | A measured change, and JSEP is being removed; see the evaluation below |
| Playwright | in existing workflows | 1.64.1 | `1.65.0-alpha-2026-10-15` | Re-check WebKit/Firefox cells |
| Wrangler | CI 4.149.0 | 4.151.0 | none | Trivial |
| Node (CI) | 22 | newest LTS 24.22.0 (26.12.0 is Current) | none | Move CI to 24 now; re-check when 26 enters LTS |
| PyTorch (conversion container only) | classic pin 2.9.1 | 2.14.1 (CUDA 13 wheels) | nightly `2.16.0.dev20261015` | See hazard below |

Hazards the bumps create:

- **React 19 forces the UI kit; decided: upgrade MUI to the latest.** Feliz.MaterialUI sits on
  Material-UI v4, which declares React 16–17; `@mui/material` 9.5.0 supports 19 but restyles. Because
  the candidate's visual language is retained, the port keeps a visual-parity check against the control
  artifact as a regression catch; visible regressions are fixed and neutral differences recorded.
- **ONNX Runtime is not a free bump.** The integrated performance work (direct WGSL kernels, mobile
  ORT GPU mapping, keyed canary admission) was measured on the pinned runtimes, and ORT Web is removing
  the JSEP WebGPU path the pinned WebGPU runtime uses. The [evaluation below](#onnx-runtime-web-currency-evaluation)
  decides what to adopt.
- **PyTorch CUDA floor (conversion container).** PyTorch's notices say 2.14 is the last release with
  CUDA 12.x wheels and that Maxwell, Pascal and Volta lose prebuilt wheels from 2.15. The converter's
  optional GPU path needs a stated driver and GPU floor. Notices found by web search; titles and
  summaries read, not the full threads:
  [CUDA 12.6 wheels end after 2.14](https://dev-discuss.pytorch.org/t/notice-cuda-12-6-wheels-will-no-longer-be-published-from-pytorch-2-15-drops-maxwell-pascal-volta/3432).

### ONNX Runtime Web currency evaluation

A named workstream, requested by the operator on 16 October: check the latest ONNX Runtime Web to
see whether it gives the app anything. It runs through the re-homed autoresearch pipeline and gates no
release on adopting a newer runtime: the release can ship the pinned, verified runtimes, and that is
the policy's recorded hold-back (a reason and a re-check trigger, kept before the first lockfile) for this
one dependency, not an exception to it. "No benefit" and "hold" are valid recorded outcomes. The
runtime files are a release-consistent mirror, so the npm package and the mirrored runtime always move
together. `webonnx/wonnx`, the separate Rust WebGPU runtime, is excluded: its repository is archived,
last pushed in July 2024, with its last release (v0.5.1) in September 2023.

What is on the table (*verified* in the registry and release notes on 16 October; none of it is a
measured result for this app):

- **Versions.** Latest stable on npm is 1.30.0; 1.31.0 was released on GitHub on 9 October but is not
  yet npm `latest`; a nightly `1.31.0-dev.20260918-bc8e7ed75` exists. The candidate runs CPU 1.24.3 and
  WebGPU 1.22.0, which is a JSEP build.
- **A forced change.** ORT Web announced in the 1.29.0 notes that it will deprecate and remove JSEP and
  its WebGL backend. Its design plan has two phases: the default bundle flips to the native WebGPU EP,
  with a temporary `onnxruntime-web/jsep` escape hatch for one release, then JSEP is deleted. Moving
  the candidate's WebGPU route forward is therefore a migration to the native EP, not a version bump.
  Which release flips the default is not determined here.
- **Possible gains, as hypotheses.** Most WebGPU work in the notes targets LLM attention and KV
  caches, which a StyleGAN2 synthesis network and the e4e encoder do not use. The relevant items are
  graph capture (1.24.1), convolution optimizations, subgroup-matrix MatMul/Gemm including in WASM
  builds, and subgroup-size control (1.30.0), plus continuing WebGPU correctness fixes. The WebNN EP is
  a possible extra route, exploratory only. Expect modest or no gain; neither is assumed.

Evaluation, each result recorded as experimental evidence with the pinned runtime artifact, by hash,
as the control:

1. **Numerics first.** Run the canaries at current tolerances (RGB difference at most 1, sampled
   raw-float error at most 0.002, e4e latent 0.0001) for CPU WASM and WebGPU on the newer runtime. A
   runtime that fails them is rejected regardless of speed.
2. **Performance.** Paired ABBA runs on the RTX 2080 SUPER under the shared lease for WebGPU, and CPU
   paired runs; cold start and warm per-frame time, runtime download bytes (they enter the consent
   and acquisition costs) and peak memory.
3. **Direct WGSL engine versus the native WebGPU EP** on the synthesis network. If the native EP
   matches the direct engine, retiring custom kernels would cut maintenance and mobile-safety risk; if
   not, record the gap. Exploratory: no kernel change follows from this result alone.
4. **Phones.** The ORT WebGPU mapping used on iPhone and Android in the existing Simulator and emulator
   lanes. The design plan distinguishes bundles (`./webgpu`, `./jspi`) by their async bridge, so test
   on iOS WebKit rather than assume the native-EP bundle runs where the JSEP one does; and check the
   e4e WASM heap stays within its 268,435,456-byte limit while 108 FP32 shards stream.
5. **Nightly, qualified lane only.** One recorded run with exact version and hash; never shipped.

Outcome: adopt (bump the immutable, release-consistent runtime mirror with its manifest and canaries),
hold (record the reason, a re-check trigger and the JSEP removal timeline), or adopt in part (for example CPU
only). The plan's tolerances and retained cells do not change.

### Crop fidelity and export flow clarification

Operator clarification: keep the export flow, and make the crop flow very similar to the old
hosted UI. The existing authorities already point there (locked mockups, which show the old hosted
dialog, and historical `src/EncodeImageDialog.fs`), so this adds checks rather than scope. Added:

- **Legacy-dialog behaviour inventory (owner: face controls, before its crop-modal behavior work; the faithful port needs only the control artifact).** Read from the locked images (viewed
  16 October) and `EncodeImageDialog.fs` at the classic checkout. Images: a dark modal with the logo
  top right and three titles ("Encode an image" with ADJUST CROP, Cancel and OK; "Crop your image"
  with Cancel and USE CROP; "Upload an image" with the red "Unable to auto align face" guidance and
  a CROP button); in the editor, a square stencil with eight handles, an oval face guide with two eye
  markers, a rotation icon with a degree readout and slider, and the copy "Cropping is generally not
  necessary, as faces are usually auto detected. Try to leave a bit above the top of the head and
  below the chin. Lining up the eyes is most important." Source: a `react-advanced-cropper` stencil
  with a fixed aspect ratio, a 90° rotate button plus the fine-rotation slider, a file chooser and an
  "Or paste image here" field inside the dialog. The old dialog detected faces on the server;
  on-device detection replaces that and the guidance copy stays. Each item is reproduced or recorded
  as a deliberate difference, beside the locked-image geometry comparison the plan already requires.
  One flow difference is already settled: the locked confirmation (proposed crop, then ADJUST CROP,
  then OK) comes before encoding, whereas the old dialog encoded first.
- **Cropper implementation choice.** `react-advanced-cropper` is not required. Either use its latest
  version (0.20.1, React 16.8 or later) or reproduce the behaviour in our own component and drop the
  dependency. Decide by a spike that reproduces the locked `crop 2.png` stencil, handles, face guide
  and rotation, comparing touch, rotation and coordinate behaviour and maintenance cost, which is the
  plan's existing "assess any crop component" rule.
- **Export flow and quality:** operator clarification: "keep the export flow" means exporting PNG and
  the other formats, and their quality. The candidate's Save/Share, prepared-file reuse and recovery
  metadata remain the baseline ([export direction](#file-sharing-and-export-direction)). Today the
  candidate has "Share image" and "Save image" under each face and "Share morph" and "Save video" under the
  result (operated, 18 October), a WebP at quality 0.8 with PNG as the fallback, and no
  format or quality picker; the plan adds the compact format choice, so PNG becomes an explicit
  lossless choice beside the WebP default, and the MP4 quality settings are unchanged. No quality
  slider is planned. The old hosted URL sharing and GIF outputs stay retired.

### Frozen classic distribution

**What frozen means.** The old frontend and old backend are feature-complete. After qualification
there are no feature changes and no dependency bumps; any fix is an explicit operator decision. An
end-of-life .NET 5 and Fable build stage inside the image is acceptable, because it is digest-pinned,
and the frontend overlay README records that a .NET 8 attempt could not load the old Fable project. "Working well into
the future" therefore means reproducible inputs, early detection of upstream rot, and a stated support
matrix.

**Verified today.** The four base images (the digest-pinned .NET 5.0.408 SDK, `node:22-bookworm-slim`,
`python:3.11-slim-bookworm`, `mongo:8.0.13`) all resolve by manifest. The pinned NVlabs StyleGAN2-ADA
commit `d72cc7d` and the frontend pin `0abb215` exist on GitHub. The three author-hosted assets answer
a HEAD request with sizes of 64,040,097 B (dlib landmarks), 381,673,535 B (StyleGAN2 checkpoint) and
1,201,649,680 B (e4e checkpoint on Google Drive), 1.65 GB in total against the README's "about 1.7 GB".
This shows the inputs exist today, not that the stack builds or runs.

**Rot hazards in the current packaging:**

1. The Dockerfile `git clone`s this same repository at an older commit at build time to get the
   frontend source. The tree a user cloned is not the tree whose frontend is built, and the build
   breaks if the repository is renamed, recreated or removed (an organization rename is pending).
2. `node:22-bookworm-slim` and `python:3.11-slim-bookworm` are floating tags; only the .NET image is
   digest-pinned. Builds also depend on apt, PyPI, npm, MCR and GitHub being reachable on the user's
   machine, and compile dlib from source each time.
3. The e4e checkpoint (1.2 GB) rests on a single Google Drive link, a known quota and availability
   risk. Accepted by the operator (D6 below).
4. The quickstart is a multi-step sequence (clone, `cd`, export `COMPOSE_FILE`, build, a separate setup
   run, then `up`) and says `cd facemorph.me/self-host` although the clone directory is
   `facemorph.me-classic`; it clones a feature branch, not the default branch.
5. Hardware: per PyTorch's notices the cu128 wheels dropped Maxwell and Pascal in 2.8 and Volta in 2.11
   ([Maxwell/Pascal](https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128),
   [Volta](https://dev-discuss.pytorch.org/t/dropping-volta-support-from-cuda-12-8-binaries-for-release-2-11/3290)).
   The pinned `torch 2.9.1+cu128` should therefore cover Volta and newer, not Pascal; the acceptance
   run confirms it. Moving to a newer PyTorch would shrink this further, which is one more reason to
   stay frozen.

**The one-command contract: the success criterion of the classic workstream (operator, 16 and 24 October).**
On a host with Git, Docker Engine with Compose v2, an NVIDIA driver and the NVIDIA Container Toolkit (so the GPU is
passed through to containers), `docker compose up` builds everything and leaves a complete local CheckFace (the old
frontend and API, photo encoding included) running. The whole quickstart is:

```sh
git clone <canonical-url>
cd <repository>
ACCEPT_MODEL_TERMS=yes docker compose up
```

The model-terms acknowledgement stays explicit and is never defaulted: without it, setup stops with
where the terms are and the exact command, exits non-zero and never hangs. Otherwise `compose.yml`
runs setup first (download and checksum verification of the three assets), starts the API only after
setup has completed successfully, and logs a clickable `http://localhost:8080` once healthy. CUDA is
the default; CPU is a documented explicit override and never an implicit fallback. The repository root
carries a `compose.yaml` that includes `self-host/compose.yml`, so the quickstart needs no `cd` into a
subdirectory (Compose's `include` element needs a recent Compose v2; confirm the minimum at execution,
this workstation has 5.5.1).

**Validation: the README is the test.** A script extracts the README's marked quickstart block and
runs it verbatim, never a hand-copied equivalent. Acceptance, each assertion recorded:

- fresh clone exactly as the README states it (a plain `git clone`, run after the default branch has been
  switched to the distribution) at the documented URL, into an empty directory, with no existing
  images, volumes or build cache;
- the first run builds the backend image locally, downloads and verifies the assets and reaches
  healthy; the log prints the URL; its duration and disk use are measured and stated in the README;
- `/healthz` reports `"provider":"cuda"` and the GPU name; `/api/face/?seed=0&dim=512` returns an
  image; the frontend loads and renders a face (the existing `smoke_*` scripts are the starting point);
- `down` then `up` reuses the volumes with no re-download and is healthy within a documented time;
- a run killed during setup recovers on the next `up`, and a corrupt or partial asset is rejected by
  its hash;
- missing terms acknowledgement fails fast with the instruction; a host without the NVIDIA runtime
  fails with a clear message and no CPU fallback; the CPU override has its own run.

The CUDA claim rests on self-hosted GPU workers under the shared lease: the RTX 2080 SUPER on this
workstation (Turing; Docker 29.7.2, Compose 5.5.1, driver 610.57.04, checked today) is the planned
CUDA validation cell and nothing has run on it yet, so the matrix starts as one cell and the README
claims no more than it holds. The TrueNAS GTX 1050 is Pascal, which the pinned CUDA wheels are not
expected to support (the acceptance run confirms), so it is planned for the CPU path only.
Standard GitHub-hosted runners have no NVIDIA GPU, so they cover the build and CPU path. Run on every
change to the distribution and on a recurring schedule (monthly) to catch upstream rot; a failure
opens an issue (owned by the classic distribution workstream) and updates the README's validated date. The README carries a validated-matrix table (OS, Docker, driver, GPU, commit, date)
and claims only cells that actually ran.

**Longevity mechanisms (proposed, revised 16 October after the operator's replies):**

- **Our frontend.** A prebuilt `deploy-self-host/` bundle is hosted as a hash-pinned download (a release
  asset of this repository, or committed; chosen by measured size) and used by default, so the default
  build needs no .NET, Fable, npm or GitHub clone. Building the UI from source stays supported and
  documented: vendor the source at the pinned commit with its npm lock, Fable tool pin and overlay, and
  keep the existing .NET 5 stage as the opt-in route.
- **No published backend image.** The user builds it, because it carries NVIDIA-licensed code and CUDA
  libraries. The default build therefore touches Docker Hub, Debian apt, PyPI, download.pytorch.org and
  GitHub (the pinned NVlabs commit) on the user's machine and compiles dlib. The README states the
  measured first-run time and disk use, and the acceptance test runs from an empty build cache to prove
  that path.
- Digest-pin every base image and hash-lock Python dependencies.
- Upstream weight hosts (dlib.net, NVIDIA's CDN and one Google Drive link) are an accepted dependency of
  the original distribution, stated plainly in the README. No mirror, liveness job or override is added.
- Tag the frozen release and state "frozen, no feature updates" in the README. The default branch of
  `facemorph.me-classic` becomes the frozen branch on the schedule in D4 below; never by merging into
  `master`.
- The `<canonical-url>` in the README is the final organization URL. The README is written with that
  one value as a variable, and publication of the README waits for [organization rename execution](#organization-rename-execution);
  building and testing do not.

**Modern-GPU support, checked 24 October 2026.** The self-host is a PyTorch port of the old server: the original
TF 1.15 / CUDA 10 backend cannot run on current GPUs, and the old `olicoad/encoder4editing` image is no longer
publicly pullable, so the encoder is vendored as PyTorch source in `self-host/e4e/`. The image ships `torch 2.9.1+cu128`
with compiled kernels for `sm_70 sm_75 sm_80 sm_86 sm_90 sm_100 sm_120` and **no PTX**. StyleGAN2's custom CUDA ops are
off (`impl='ref'`), and nothing is compiled at runtime. Measured on eris (RTX 2080 SUPER, Turing): a no-cache build in
9 min 38 s, model setup in 2 min 46 s with all three hashes verified, healthy in 17 s, a face in 0.85 s, and the GPU and
encoder smoke tests passing. So it should run on Volta, Turing, Ampere (RTX 30), Ada (RTX 40, through sm_86), Hopper and
Blackwell (RTX 50) with an NVIDIA driver 570 or newer; Pascal and older run on CPU only. Only Turing has been run.
Requirements this adds:
- The README carries an honest support table: compute capability 7.0–12.x, driver 570+, Pascal CPU-only, and each
  tested row marked with its date.
- At startup the API compares the GPU's compute capability with `torch.cuda.get_arch_list()`. An unsupported GPU gets
  one plain message naming the card, its capability and the supported range, never a raw "no kernel image" CUDA
  error.
- Each rot-check run records the GPU, its capability, the arch list and the driver.
- Before the release tag, the README-executed acceptance also runs once on the newest GPU generation available to
  the project (a Blackwell card, rented if none is at hand).
- **One allowed unfreeze:** when a new GPU generation appears that the arch list does not cover, the torch/CUDA pin is
  bumped behind the same README-executed acceptance, and the support table is updated. The cost is stated in the
  table: newer torch drops older generations (for example Volta), so the lower bound moves.

**Not guaranteed:** GPUs outside the supported range above (until the allowed unfreeze covers a new generation), the
third-party hosts for the weights (accepted), and future Docker or driver behaviour. The guarantee is: these exact
inputs build and run on the listed matrix, a newly bought GPU inside the range works, one outside it gets a plain
message, and rot, including a dead weight link, shows up as a failed monthly clean-clone run.

**Decisions made by the operator, 16 October:**

- **D4. Home of the distribution: settled by the original plan.** The locked operator source says to
  rename the existing repository to the classic name and "integrate the server part of the checkface
  repo into it (migrated to pytorch for better compatibility) with easy docker-compose". The frozen
  distribution therefore lives in `facemorph.me-classic`. Consequence: wind-down keeps that repository as
  its permanent home, and the branch plan below ([classic distribution](#classic-distribution)) is on the
  critical path for the clone-and-`up` guarantee.
  **Branch plan, simplified 17 October.** In plain terms: `git clone` gives a person the repository's
  *default branch*, which today is `master`, and `.github/workflows/deploy.yml` there runs
  `vercel --prod` on every push to `master`, so `master` is today's legacy production publisher
  (checked on `origin/master`). Merging the frozen distribution into `master` would deploy it to
  production and break the one-publisher rule for the `facemorph.me` cutover. So the frozen distribution
  is built on its own branch (working name `self-host`: an implementation detail that no user-facing
  text mentions), the qualified release is tagged, nothing is merged into `master`, and when the README
  is published the repository's default-branch setting is switched to that branch. Switching the setting
  is not a push, so the workflow should not fire; test that before switching, and if it does fire, retire
  the Vercel publisher first (hosted-endpoint retirement does that anyway). The README quickstart is
  then a plain `git clone <url>` with no branch flag at any time. The recorded README-as-test acceptance
  run is made after the switch so the README runs verbatim; runs before it name the branch explicitly
  and are labelled development runs. Before switching, also (a) list the workflows with `schedule` or
  `workflow_dispatch` triggers on `master` and on the candidate branch, because GitHub runs scheduled and
  manually dispatched workflows only from the default branch's files, and confirm that the ones that
  matter (the rot check, the GPU lanes) exist on the new default; and (b) check whether the Vercel
  project's Git settings follow the default branch.
- **D5. No published backend images: settled by the original plan.** The locked source describes
  `git clone` then `docker compose up`, with the frontend and API running locally, a link logged for
  one-click opening, and models downloaded from their authors' hosts ("they use the actual nvidia hosted
  stylegan models and download them from there, we don’t host them"). Inferred from that vision: the
  user builds the backend image locally, and our own frontend build may additionally be hosted as a
  hash-pinned download that users can also build from source.
- **D6. Upstream weight hosts are accepted.** The single Google Drive link, dlib.net and NVIDIA's CDN
  are how the original authors distribute their files; the README says so, and nothing is added to work
  around them.
- **D7. Upgrade MUI to the latest and make it work** (operator: "just make new MUI work"). The
  comparison with the control artifact stays only as a regression catch: fix visible regressions, record
  and accept neutral theme-level differences.

## Next-release UI and photo requirements

These are intentional changes to the reviewed on-device candidate, with the
interaction-specific design authorities in the [behavior table](#behavior-authorities-for-development).
Everything outside this change set keeps candidate behavior. Any F# replacement
must reproduce the approved UI state before
or after the changes consistently, not combine a rewrite with untracked UX drift.

| Requirement | Acceptance / explicit interpretation |
| --- | --- |
| CPU/WebGPU provider control | Keep Auto (default), CPU and WebGPU as the choices, moved from More options → Advanced (where the candidate has them, beside a WebGL entry that goes) to a compact selector above the first +, with the candidate's useful recommendation. Admit actual capabilities per operation, including iPhone/mobile routes. Conditional support/slow guidance lives beside the owning action or in Help; no native-download recommendation. |
| Download consent modal | For missing assets, offer Generate and encode (recommended when eligible) and Generate, with purpose-specific missing bytes and concise download/use-time ranges or honest unknowns. Download and continue authorizes the selected bundle; Cancel starts nothing. Keep setup details secondary, then overlap approved acquisition with photo selection/review. No proactive offer toast or arrival download. Cached results remain usable. |
| Retire WebGL execution only | Preserve CPU preferences/ordering, GPU-failure CPU fallback and mobile optimizations. Remove WebGL execution after mapped dependency checks; migrate an old WebGL preference explicitly to a supported recommendation. Keep shared coefficients, successful-slow-route policy, bounded fallback/retry and required WASM helpers. |
| Move Browse Names into burger menu | Move the separate names adornment into that face field's existing burger/mode menu. Bind the originating stable face ID; no global selected-face mechanism. Names enter [static names and picker](#static-names-and-picker)'s new verified static-result path rather than inference or Generate. |
| Generate inside an empty image tile | For eligible unfinished text/seed inputs; typing clears the displayed result. Retry unchanged input after failure/cancellation. A valid static-name selection already has a result and needs no Generate; editing its filled text field follows normal text generation. No photo Generate. |
| Rename Upload image to Encode image | Photo-encoding labels/entry points use the new action. Where photo encoding is genuinely unavailable, that same file-menu entry says Open saved image for its remaining recovery-only purpose; no duplicate control. |
| Paste image into text field | Pasted image follows exactly the same selection/crop/consent/encoding flow as file-dialog input; typed text/seed input behavior remains. |
| Remove duplicate filename line | The field may show the filename; no separate caption repeats it below. |
| Generate becomes Cancel while cancellable face work runs | Same action slot, not another row. Encode cancellation becomes available after crop confirmation; static-name fetching has compact loading/Retry when needed, without inference. Accessible state and keyboard actions are explicit. |
| Crop only before encoding | Proposed crop in a modal, adjustable and confirmed by the user; keep multi-face choice. No post-generation Crop photo button. Use FaceMorph modal styling and top-right logo. |
| Adjust Crop and multi-face selection | Match supplied adjustment/modal style and failure guidance. Select faces across one or several files; OK replaces the originating panel with all selected faces in global selection-click order, inserting extras adjacent and retaining unrelated panels. Freeze crop/rotation proposals and order before encoding. |
| Remove hold-to-compare | Remove its button, pointer/keyboard gesture, instructions and stale UI state; preserve normal face display and Save/share. |
| Repair confirmed-crop loop | After confirmation, encode that exact crop. After detector failure/refusal, manual crop is optional and explicit continuation with eligible pixels may use direct e4e, with meaningful guidance about odd reconstructions; never automatically reopen an endless crop prompt. Preserve cancellation, preprocessing provenance and numerical checks. |
| Morph preparation, progress and cancellation | Create Morph automatically generates unfinished valid words/seeds, then produces frames and the prepared video. Disable it from accepted intent onward and keep Cancel to the right of whole-action progress. Completed faces survive cancellation. |
| Fullscreen baby-name picker | Use the legacy standalone names grid: edge-to-edge faces, no gaps/borders, names over images; no search, header or x icon. Preview displays immediately; completed static-result readiness follows validation. Define accessible dismissal without restoring the removed header/X. |

The source's standalone "Generate should only" bullet is incomplete; the fuller
Generate bullets above control. The latest clarification **removes hold-to-compare**.
The earlier "Save / Share image ????" sketch is resolved by the Share/Save/format
direction above. Preserve candidate file/drop/recovery entry and ordinary text paste;
add main-field image paste through the same specified recovery/photo dispatch.
No new drop target or replacement compare gesture is required.

**UI restraint (12 October operator clarification):** retain the candidate main-page
visual language and layout except for explicitly requested changes; crop and names
follow their named locked/legacy visual references. Every additional
visible control or explanation must help the visitor choose an action, understand
a real cost, recover from failure or access the product. Use the existing action
area, menu and help before adding panels or rows. Keep technical evidence and stage
breakdowns in diagnostics or optional details. Do not add an estimate dashboard,
first-visit wizard, redundant confirmation or broad redesign to finish this plan.
This keeps the useful face/morph journey clear while the architecture changes. The candidate follows the
visitor's light or dark system setting; keep that, with text at 4.5 to 1 contrast or better in both.

### Clean UI placement and useful degradation

The release can be straightforward, but support exclusions, large first-use assets,
photo reconstruction and incomplete exports can frustrate users if revealed late.
Use these placements as acceptance requirements, not optional hints for an implementer.
Keep the candidate page structure and one message owner per failed/limited action.
Keep the requested compact CPU/WebGPU selector; healthy supported devices have no
new support banner, estimate dashboard or onboarding. A restriction notice appears only when it changes what
the visitor can do; normal progress/errors replace the existing action's status.

Candidate mounts below refer to `src/Next/Product.fs` and its SCSS at the pinned
source, not final public DOM APIs. Equivalent TS components retain these locations.

| Content/state | Specific visible home | Required behavior |
| --- | --- | --- |
| Provider choice and recommendation | Compact CPU/WebGPU selector above the first insertion + (moved there from More options → Advanced) | Preserve candidate choice/recommendation and capture it for new work. No device-label ban. Missing WebGPU leaves qualified CPU available; optional **Using a computer** / **Supported browsers** links open below-page Help. No installer or permanent support panel. |
| Attempted blocked face or Morph action | That face's `.next-tile-status`, or `.next-morph-reason`/`.next-status` beside Create Morph | Give the owning action's short reason and existing Help access; avoid repeating the page notice in every tile. Disabled actions expose a readable reason to keyboard/screen-reader users rather than a hover-only tooltip. Reject before model/detector acquisition or photo preparation. |
| Model-free file opening | Existing per-face burger/file entry, including file/drop/paste recovery-first dispatch | Keep saved PNG/WebP opening usable even when photo computation is blocked. Where photo encoding is unavailable, label this same entry **Open saved image**. After inspection, reject only an unsupported fresh-photo path without replacing completed work; Use as photo retains that specific limitation. No new import toolbar. |
| Missing models and consequential first-use cost | Existing download-consent modal | Recommended/optional bundle choice, per-purpose missing bytes and concise download/use-time ranges or honest unknown, first-use setup caveat, Download and continue/Cancel. Only optional details expose technical breakdowns. Approved progress stays in the existing crop/modal status or owning tile; decline performs no deferred continuation. |
| Slow admitted device, including phone CPU | Owning face status or Morph status; missing-asset decision uses that same consent modal | Show a reliable range when available, otherwise honest progress; keep Cancel. A short computer suggestion can link to Help. Long morphs use existing More options to reduce length. Do not switch a healthy route or repeatedly ask the same decision. |
| Face operation/progress/error | `.next-face-image` operation slot and `.next-tile-status` | Generate, Cancel, Cancelling or Retry for the current intent. Static names use Loading/Retry without synthesis; export-only Retry stays separate from inference Retry. A local error does not cover unrelated completed faces. |
| Crop geometry and reconstruction guidance | Locked crop confirmation/editor, beside its existing proposal/Adjust Crop guidance | Match the supplied full preview, handles/guides and Cancel/OK flow. Use one short explanation that encoding recreates the face and may change details; detector failure adds meaningful optional-manual-crop guidance. No new resemblance approval or post-result Crop. |
| Morph operation/progress/error | Existing `.next-morph-slot`/`.next-status` adjacent to Create Morph | Disable duplicate starts on acceptance; one whole-action bar, Cancel at its right, frame count secondary. Name the useful recovery (Retry or reduce length in existing options) here. Completed face results survive Morph failure/cancellation. |
| Complete face output | Existing `.next-face-image`; its result actions in `.next-face-actions` directly below | Display the full uncropped model output with its aspect ratio, without ancestor clipping or overlays hiding framing. Save/Share/format/optional filename stay together below that image and wrap inside the tile. |
| Complete morph output | Existing `.next-video-slot`, player/available-frame slider and its `.next-actions` directly below | One current full-frame result; use playable video when scrub frames are absent. Place prepared-video Save/Share/format/filename and actual resolution here. Disclose a qualified 512px fallback without cropping or shortening the selected sequence. |
| Visible pixels while file preparation waits/fails | Same face/video result action area | “Preparing file…” or file-preparation Retry keeps pixels/frames visible. Enable Save/Share only for prepared current bytes. Show actual PNG fallback format/extension here; never regenerate merely to save. |
| Session/export limits, browser setup and retirement details | Existing below-fold `.next-explain`/Help/FAQ, with compact format help beside result actions | Explain browser CPU/WebGPU and separate photo/video support, evidence limits, first-use costs, no phone-session transfer, interruption, best-effort cache and PNG/WebP recovery. MP4 help discloses codec/resolution fallback and deferred project reopening. Specialist classic Docker docs live here; no native installer. |
| Standing debug-report consent | Compact `Debug reports: Off` / `Debug reports: On` disclosure after Help/FAQ, at `#debug-reporting` | Expand to the labelled checkbox, safe-data/retention explanation and report status/reference. FAQ and footer **Privacy & reports** links expand it and focus the checkbox. Keep it out of face burgers, Morph options and output controls. |

Help anchors are ordinary same-page support navigation (for example
`#computer-requirements`); they do not carry results or resurrect old share URLs.
Computer guidance links to the current site's entry URL, with optional ordinary
copy-link access inside Help. It does not upload personal inputs, promise a synced
session or send the user to a retired desktop package. Provide a concise tested
browser/OS support list plus the evidence status, rather than claiming any computer
or named browser version will work without qualification. One-shot report access
remains in its owning error; standing reporting lives in the anchored disclosure.
Raw runtime exceptions are not visitor copy.

**Complete-output contract:** responsive display scales the whole model frame; it
does not change export resolution, discard edge pixels, crop faces or silently omit
selected morph frames. Default face exports use the model's declared full dimensions
(the candidate face model is 1024 × 1024), and a completed MP4 contains the entire
accepted path at its admitted, disclosed dimensions with validated project metadata.
Preserve the candidate's qualified codec degradation: WebCodecs probes 1024 then
512, with 512px FFmpeg fallback. Full output does not require universal 1024px video.
Show a lower-resolution fallback beside format/result actions and before Morph when
known; preserve the complete sequence and framing. A thumbnail,
last frame, truncated animation or preview is never labelled the completed output.
Check rendered content bounds/all four corners as well as decoded file dimensions /
frame sequence; intrinsic canvas sizes and `object-fit: contain` alone are insufficient.
On short/narrow screens, retain aspect ratio, normal reachable scrolling, visible
modal dismissal and reachable result actions rather than squeezing or clipping output.

Known degradation must be discovered before expensive work where possible. Check
that a qualified MP4 preparation pipeline is available when accepting Morph; use an
already qualified codec fallback only within the approved asset/resource scope.
If none exists, explain in Morph status before frame inference, keep ready faces
saveable and do not imply that an interactive preview is an exported video. A later
codec failure retains usable pixels/frames and offers export-only Retry when feasible.
Quota/retention failure is separate from execution failure: keep prepared Save usable,
explain cache loss in the owning action, and only offer transient execution if its
bounded path is actually qualified. Offline names work only for cached complete
validated assets; a cached preview alone needs Loading/Retry, not false readiness.

The most likely disappointing cases remain slow phone/CPU computation, unavailable
photo or codec support, large cold photo acquisition/setup, e4e changing facial
details, rejected oversized inputs, lost unfinished photos on reload, social apps
stripping recovery data and retired GUID/native/API links. Explain each before its
cost or at its existing recovery action. Preserve completed siblings and verified
downloads. Do not describe unsupported compute as an invalid name/photo or promise
success/background completion from a device check. These limits need
clear maintained Help, not another workflow or a blanket guarantee of usability.

### Lightweight device check and pre-download guidance

First establish actual CPU/WebGPU and operation eligibility, without model
downloads. Retain the candidate's fixed WebGPU → CPU preference, filtered by actual
admission and explicit choice. Timings inform estimates/recommendations, not automatic
provider reordering; unavailable WebGPU does not block qualified CPU. Before real-model checks, call
the route **eligible; model check pending**, not qualified on this device. Never
demote a healthy slow route, switch an active job or download an alternative model
to race it. Generator and photo encoder admission/performance are separate:
WebGPU synthesis says nothing about e4e speed, which uses its own WASM path.
Eligibility checks cannot be skipped into unsupported compute. The optional
timing sample can be skipped or time out without blocking an otherwise eligible
device's explicit action/download decision.

A model-free preflight is feasible and belongs before the first acquisition modal:

- Read supported browser capabilities, actual WebGPU adapter availability/features /
  limits, WASM/SIMD and permitted threading, plus coarse CPU/memory hints where
  exposed. Mere `navigator.gpu` presence is insufficient. Missing or rounded memory
  information is unknown, not a failed device; these APIs reveal neither free RAM
  nor enough information to promise that the model will fit.
- On an eligible device, while the page is visible and idle, run a short worker-based WASM-helper sample and,
  when available, a small WebGPU compute sample using generated numeric buffers.
  Include representative arithmetic and memory access for calibrated kernel families;
  a generic JavaScript loop or GPU name alone is not an inference speed estimate.
  Measure completed GPU work rather than submission time, with warmup/compilation
  distinguished. No model weights, detector, full inference runtime or test photo
  is downloaded; a tiny checker module is ordinary app code with a documented size.
- Keep the checker visibly labelled “Checking this device…”, cancellable/skippable,
  and off the critical path for browsing/selecting static names. Initial design
  budget: about two seconds of sampling, a five-second UI deadline, at most 16 MiB
  of explicitly allocated scratch buffers, and at most 100 KiB compressed additional
  checker code. These are implementation budgets to verify, not measured timings
  or total process-memory limits. Bound individual kernels/work chunks; deadline /
  cancellation stops new submissions and ignores late callbacks, rather than
  pretending already-submitted GPU work can always be preempted. Release resources.
- Timeout, backgrounding, GPU loss or absent APIs yields a broader evidence-based
  estimate or “No reliable estimate for this device”; it does not hang entry, claim
  full-model qualification or silently fetch weights. A separately failed eligibility
  check blocks only the affected operation/route; GPU/device loss requires bounded
  re-admission or the existing qualified CPU fallback, with revised consent where needed.
  Reuse a compatible recent check
  and permit rerun. Keep device scores local under existing diagnostics consent.

Convert scores to **ranges** using versioned paired measurements of this checker
and actual inference. Calibration is specific to checkpoint/resolution, provider /
runtime, thread mode and workload: photo preprocessing, e4e per confirmed crop,
generator synthesis per output, model load/check and video export are distinct.
Prefer compatible recent actual-device timings, then calibrated local-check ranges,
then measured comparable-device ranges clearly labelled as such. Test prediction
error on devices/runs not used to fit the mapping; widen or withhold an estimate
outside supported calibration. Do not scale an entire multi-stage job by a single
GPU score. Tiny-buffer checks cannot predict memory exhaustion, sustained thermal
throttling, background suspension or every driver/operator failure.

The action-triggered download modal makes the decision possible before spending
model bandwidth, without an additional first-use panel or stage dashboard. Recommend
**Generate and encode** (synthesis plus encoder, when both routes are eligible), and offer
**Generate**. This makes future photo preparation an explicit optional purpose
even when the initiating action is seed/text generation; it never silently adds an
encoder to a generation-only approval. Keep two concise purpose rows: actual missing
bytes, download-time range and face/photo-use range, or a clear unknown for each.
Only selected scopes download. An end-to-end photo-use range includes preprocessing,
e4e and reconstruction, or clearly states what is excluded. First-use loading/checks
remain a short caveat with detail available on expansion. Keep the following
information available in context:

| Information | User-facing meaning |
| --- | --- |
| Model download | Actual remaining bytes and a separate transfer range for each offered purpose, based on compatible recent origin/network throughput. With no defensible evidence, say Download time depends on your connection rather than inventing a number. Update from observed approved transfers; coarse connection hints alone are insufficient. Cached scopes say Already downloaded, subject to verification; files are not guaranteed permanent. |
| First-use setup | Short notice that first use also loads/checks the model. Keep measured setup breakdown in optional details; do not imply an operation-only range includes setup/download. Cached files can still incur setup. Flag unknown costs rather than adding zero to a total. |
| Encode a photo | Approximate time per confirmed crop, labelled with its scope; show the batch range when multiple faces are selected. Detailed e4e/preprocessing/synthesis timings stay secondary. |
| Generate a face | Approximate time for the requested face, separate from acquisition/setup. An offered optional photo bundle has its own concise photo-use row; never imply it is necessary for seed/text. Names selection uses static files and has no synthesis/model requirement. |
| Make this morph | A separate full-video estimate is not a required download-modal row. Use whole-action progress, retaining a frame counter as useful supplementary detail; a compact total range beside Morph is useful when it gives reliable guidance, especially for a slow/long job. Include final video preparation and pipeline overlap in that total, or label the missing cost. Avoid a new estimate panel or confirmation unless download or a newly discovered material cost needs consent. |
| Eligibility and risk | Put a consequential unsupported, slow or memory limitation in the affected action area and before consent in plain language; support details live in Help. Keep the compact CPU/WebGPU selector without an evidence dashboard. A synthetic check does not establish full-model success. |

When an evidence-based range suggests a substantial wait, use concise copy in the
existing action/consent area: “This may be slow here. For faster face generation and
morphs, try a computer with WebGPU.” Base the nudge on the affected workload/range,
not a phone label; with no reliable range offer general Help advice without inventing
device slowness. Photo encoding also depends on CPU, so WebGPU is not a promise of
faster e4e. Retain Continue/Cancel where the bounded operation is admitted, and link
**Using a computer** to Help. Suggestion is not a platform ban. A genuinely unavailable
operation names its specific limitation before acquisition; retain other qualified
operations, static names and completed files. Unavailable WebGPU offers qualified
CPU instead of rejecting the device. No native installer is offered.
Opening the site on a computer does not transfer
a phone session, source photo, names selection or unfinished work. Help supplies a
plain link to this site's entry URL and explains transferring a saved PNG/WebP for
completed still work, without result/share query parameters or a new handoff service.

Opening the app or model-free names must not open a download modal or fetch model
weights. Gate Generate, Morph and photo preparation through their own route/capability
and resource admission
before the same acquisition authorization boundary. File/paste/drop dispatch inspects
recovery first and does not gate completed-file display/save on compute. Unknown cache/manifest status waits for a bounded
inspection or reports a retryable error; it is never permission to fetch weights.
Ask for missing assets in the explicitly selected action/preparation bundle, grouping
known photo prerequisites where practical. The optional second model needs its own
clear purpose/bytes in that same approval. Valid cached assets/results do not need
renewed download consent; verified local runtime warming is governed separately below.
Cancel, Escape and backdrop dismissal abandon deferred continuation, restore focus
to the initiating control and preserve completed work; late checks cannot restart it.
Keep download progress after approval without another acquisition-offer toast.

If the model later fails checking, name the failed stage in the owning action and
offer bounded Retry, qualified evidence-based CPU fallback or specific Help. Never
race a healthy slow route or offer a native package. A previously unknown material
cost needs a revised Continue/Cancel
decision in the existing consent/action area. Extra assets outside the original consent require their own
scope/bytes consent; keep usable downloaded chunks for retry. A slow successful job
keeps its route and cancellation; update the estimate from observed progress. Warn
that switching apps/tabs may pause work and closing/reloading can lose unfinished
photo inputs; never promise background completion. No estimate guarantees success.

The release summary (integrated verification) lists, per browser/OS/runtime and separately for
generation, photo encoding, morph/video export, file sharing and retention. Distinguish
tested, feature-eligible but untested, and unsupported. A small preflight success
cannot promote a cell to full-model tested. Publish useful ranges only for calibrated
cells, including phone CPU/photo trials at their actual evidence scope. Static-file,
Simulator and physical-device receipts remain distinct. Calibration supports truthful UX, not a new performance-win prerequisite
for retirement. Current `estimate.mjs` cold synthesis constants are historical
single-device priors; its `encodeMs` is video export, not a photo encoder estimate.

Grounding checked 11 October 2026: candidate `route-priors.mjs` and `estimate.mjs`,
and current [adapter](https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter),
[GPU completion](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone),
[memory hints](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)
and [CPU hints](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency)
documentation. This specifies the checker and calibration; neither is implemented
or benchmarked by this planning pass.

### Consented downloads, useful overlap and cached-model warming

**Both models** means the selected route's synthesis network plus the photo encoder,
not CPU and GPU variants or a race between providers. Recommend Generate and encode only
where the photo route passes actual capability/resource admission. Generate stays
useful on admitted CPU/phone routes; static names and recovered-file display/Save
remain model-free. Use the same compact action-triggered consent modal with two
labelled choices and Download and continue/Cancel. Example row shapes are **Generate:
{missing bytes}; download {range/unknown}; generate {range/unknown}** and **Encode:
{additional bytes}; download {range/unknown}; encode {range/unknown} per face**.
These are placeholders populated from actual evidence, not new promised timings.
Do not hide the optional encoder cost in a combined total. If Generate is chosen
from a fresh-photo request, say Encoding needs the photo encoder and pause that photo
continuation; keep the source where bounded and return to useful face generation.

Start the selected acquisition after approval, without waiting for crop OK. Prioritize
the synthesis prerequisites among large downloads so seed/text generation can become
usable first. Acquire the small detector/alignment prerequisite needed for crop
proposals promptly, and overlap remaining approved encoder transfer with local image
inspection, choosing faces and adjusting crops. A separately approved photo-setup
intent may start before the source picker; file/drop/paste recovery entry still
inspects metadata first and never needs model consent merely to reopen a result.
Before a source is chosen, offer this optional setup through one compact **Prepare
encoder** action beside the existing Choose image control in the Encode image
modal, only when eligible required assets are missing. It opens the same bundle
consent; Choose image remains usable directly. After a fresh source is inspected,
use that consent automatically where prerequisites are missing. This is contextual
preparation inside the existing flow, not a new page-wide download action.
Opening Encode image or the page alone does not authorize a transfer. Crop OK freezes
the approved input/order and queues encoding; it need not wait for downloads to finish.
The selected generator's readiness permits a requested face while unrelated approved
photo assets remain in flight; a face does not wait for the entire two-model bundle.

Keep setup progress and Cancel setup in the crop/source modal's existing status/footer,
then the owning tile after OK; if a result becomes ready before optional preparation
finishes, its actions work while the same compact status retains cancellation. No
extra offer toast, permanent download panel or modal covering crop review. Approval
has a bounded manifest/route/purpose/digest/byte scope and an explicit owner. Crop /
action Cancel releases that intent's acquisition and speculative warmup ownership;
only independently authorized surviving consumers may continue. Selecting both is
not perpetual consent after all owning intents are abandoned. Keep verified downloaded
chunks for retry, settle pending continuations, and show cancellation separately from
closing/hiding UI. Progress accounts for overlapping work once, not a sum of durations.
**Cancel setup** stops that setup owner's remaining acquisition/warming while keeping
bounded local source/crop work. Later OK can use already verified complete assets;
if required assets are missing it must explicitly resume/reapprove through the same
consent flow, never silently revive cancelled transfers. Cancelling the initial
native source chooser or closing/cancelling its source modal abandons that pre-source
setup owner and its pending continuation. Cancelling a later add-file chooser leaves
the existing batch/setup intact. Independent explicitly authorized owners survive;
merely hiding status is never a substitute for these cancellation semantics.

Separate network acquisition, verified local reads and live runtime warming. Cache
presence is neither digest verification nor an already loaded session. Give acquisition
its own aggregate transfer/read-ahead/hash/write-buffer budget and digest deduplication;
it holds no heavyweight compute permit while waiting. Foreground-required assets
outrank optional preparation. Continue independent cache-only acquisition during
foreground work only when measured responsiveness/memory permits; otherwise pause
lower-priority work. The old two-chunk phone read-ahead is a per-worker bound and
does not bound multiple overlapping workers. Freeze aggregate limits in the contracts.

For an eligible anticipated generation route, a visible idle app may eagerly prepare
**verified cached** synthesis assets/session/mapping using low-priority scheduler
admission and explicit residency reservations. This aims to hide repeat-visit setup;
it is a new optimization to measure, not a demonstrated significant speedup. Finish
boot/recovery work first. Static names and completed-result display/recovery/Save
never initialize inference merely to satisfy those requests; subsequent independent
preparation has its own trace/owner. Warm only the selected route, reuse compatible
model/provider/runtime admission receipts, and keep one product canary plus deferred
remaining checks when genuinely needed. Never run the full encoder lab gate on arrival.

Local warming must issue **zero model-network requests**, including repair; required
material runtime/helper assets must also be locally ready, without hidden loader downloads. Existing
`model-cache.mjs` `acquire()` handles can fetch missing/corrupt assets through `bytes()` /
`open()`; `readOnly` and `has()`/`peek()` alone do not enforce this boundary. Introduce
verified-local-only access (for example `allowRepair:false` across both backends),
with typed cache-miss/corruption/eviction invalidation. Skip speculative warming on
failure; foreground manager reacquisition remains outside engine execution and under
explicit acquisition consent. Construction/status queries remain side-effect-free.

Foreground input preparation, recovery, generation, encoding and export outrank
speculation. Stop new warm submissions promptly; settle the in-flight unit and release
or transfer useful compatible resources before foreground admission. Do not promise
instant preemption of submitted GPU work. Count idle warm WASM/GPU/session memory
until actual release/worker termination; never evict live foreground resources for
warmup or overcommit because a memory hint is absent. On constrained iPhone/unknown-
memory paths, defer or release generator warmth before e4e and rehydrate after encoder
teardown. Overlapping downloads do not require simultaneous hydrated networks, all
108 shards in RAM, or concurrent heavy inference. Wider retention/concurrency needs
qualified aggregate memory, cancellation and useful-latency evidence.

Measure each exposed wait and complete choosing→generation/export journeys, including
first useful synthesis while encoder acquisition continues. Raise newly found overlap,
warming/reuse or other performance opportunities to the operator/planner through the
[targeted research record](#targeted-autoresearch-launch-and-preserved-history), with
the affected cache/device/workload, evidence or hypothesis, costs and next test. Do
not turn these engineering opportunities into another visitor settings surface.

### Confirmed crop and ordered multi-selection flow

Use [the four inspected screenshots](#supplied-ui-references): dark confirmation modal,
logo top right, proposed crop, Adjust Crop, Cancel and OK. Adjust Crop follows the
locked `crop 2.png` editor: movable/resizable square, rotation/angle and face/eye
guides, with historical `src/EncodeImageDialog.fs` as an interaction reference.
Do not substitute the candidate's current fixed-square pan/zoom DOM for that design.
Use Crop updates the proposal and returns to confirmation; Cancel in the
editor restores the prior proposal. OK at confirmation commits it and returns to
main-page face progress; the same tile action slot now shows Cancel. Cancel before
confirmation abandons preparation without e4e encoding or allocating extra keypoints.
Preserve unrelated panels; restoring a previous face in the target on cancellation
is desirable where simple, not a mandatory rollback/history mechanism.

Detect/propose on the source before confirmation. If this needs absent detector /
alignment assets, pass the same scope/size download-consent gate before acquisition;
declining keeps the source/local manual-crop option usable and starts no downloads.
Do not label an unrun detector as a detection failure. If no face is detected or detector assets are refused, show the
meaningful guidance from locked `failed to align.png` and the historical production
dialog. Manual adjustment is optional; explicit continuation with eligible pixels
may reach e4e and can produce
odd reconstructions. Do not force manual repair or automatically encode unconfirmed
pixels. That warning does not forbid an eligible confirmed crop from the direct e4e route.
Malformed/unsupported pixels still fail clearly. Guides are not burned into pixels;
freeze crop rectangle, rotation, orientation and input revision and derive encoder
pixels once according to the versioned preprocessing contract.

For multiple files/faces, inspect recovery metadata before treating an image as a
photo; the [mixed-batch contract](#gaps-with-reasonable-solutions-inside-the-accepted-design)
stages saved faces alongside crop candidates without encoding them again.
Show selectable previews with accessible ordered selection
badges and one global selection sequence. Selection order is actual face-click order
across files, not file order, detector position or encoding completion.
Deselect removes a selection; reselect appends it. Each selected photo face has a
proposed, adjustable crop; a recovered still retains its verified pixels/latent.
Disable OK with zero selections. On OK, freeze the ordered proposals
and assign the first to the original target keypoint; insert additional next-face
keypoints immediately after it in that order, retaining existing later faces.
Allocate stable keypoint IDs atomically only when the source/target revision still
matches. Before OK a changed/removed source target invalidates the entire proposal.
After OK each slot has its frozen recovered result or confirmed crop and input
revision: changing/removing that slot invalidates only its pending/active work and
late results, not siblings.

Run only the selected photo encodes in a bounded queue (initially one e4e encode at a time),
not simultaneous full encoder loads. Each frozen crop has request/attempt identity,
independent progress and result. Once confirmed, each queued/running tile shows its
own Cancel in the face action slot: it cancels only that slot, and queued siblings
continue in frozen order. There is no implicit batch-wide Cancel. The confirmation
modal Cancel, before OK, discards the entire uncommitted proposal. Completed faces
survive cancellation. Retry resumes only that existing cancelled/failed slot with
its frozen crop and a new attempt ID (appended to the pending queue); Remove deletes
only that slot. Neither reopens crop or allocates extra keypoints. Pending, running
and retryable slots own a reference-counted tab-only source or immutable derived
crop pixels. A frozen rectangle without pixels cannot satisfy Retry. Successful
slots release retry inputs; failed/cancelled slots retain only the minimum input
needed for Retry. Remove, input replacement and app disposal release remaining
references; a shared source is freed only when no pending/running/retryable owner
needs it. Never persist source photos or retry crops to OPFS/session storage.
[package and operation contracts](#package-and-operation-contracts) must freeze numeric count/byte ceilings for retained sources, crop buffers and
transient decode separately, before batch admission. Preserve existing single-input
limits (`src/Next/photo/crop.mjs`: 64 MiB compressed, 120 × 1024² pixels, 20,000px edge)
unless a separately qualified rule changes them; these are not browser RSS bounds.
Reserve batch budget before allocating keypoints; an oversized batch receives an
actionable reduce-selection/remove-retry-input message, not truncation or hidden eviction. Complete any detector-driven alignment/warp used to propose a crop before
confirmation, and display the resulting proposal. After OK, derive encoder pixels
only from the frozen confirmed crop and declared orientation/rotation/resize /
color/normalization policy. Do not redetect/rewarp to replace approved geometry.
Optional post-confirmation validation cannot alter pixels or block otherwise
eligible direct-crop encoding; detector/alignment failure cannot reopen the crop
prompt. An eligible confirmed crop reaches one e4e attempt or an actionable error.
Only a user's explicit Adjust Crop starts another adjustment. [package and operation contracts](#package-and-operation-contracts) freezes batch,
revision, cancellation and retry types; [confirmed-crop encoding](#confirmed-crop-encoding) owns real encoding/fallback; [face controls and modals](#face-controls-and-modals) owns
modal, ordered selection, atomic keypoint insertion and interaction evidence.

The archive contains no multi-face grid or names-picker screenshot. Create a
reviewable multi-selection design from these written requirements and existing
selection behavior; do not claim an unseen supplied mock establishes it.

### End-to-end experience and design-fidelity check

The screen states (main page, cold download modal, single/multi-face crop, queued/cancelled/failed tiles, names
picker, completed-result Share/Save) are typed once in the app contracts (`ui-states.ts`, with type tests); there is
no separate walkthrough document (cut 24 October). Use the legacy production/names references named above, candidate
retained controls and supplied crop screenshots. [Face controls and modals](#face-controls-and-modals) implements the
states; [integrated verification](#integrated-verification) checks the real result. Fill only unspecified states within
the locked design; do not replace the supplied crop layouts.

Specify these transitions in the typed [package and operation contracts](#package-and-operation-contracts) controller:

- Browse Names lives in each face field's burger/mode menu and captures that face's
  stable ID when opened. Move its candidate end adornment there; no page-wide
  selected-face state, first-empty fallback or implicit new slot is needed. Picking
  returns to that tile; dismissing leaves it intact. A removed/revised target
  invalidates pending selection. [static names and picker](#static-names-and-picker) covers this fullscreen modal invocation; no `/names` navigation is needed.
- Keep the CPU/WebGPU choice, in the compact selector above the first + (moved there from More options →
  Advanced). Capture the requested route,
  bounded permitted failure-fallback scope and runtime/model identity when Start or
  Download and continue is pressed; queued work retains that scope. Record the actual
  provider at execution. Later selector changes affect new jobs. Cache refresh, later
  capability checks and release changes cannot silently change the approved scope.
  A lost capability uses the qualified bounded CPU fallback only within the approved
  asset/cost scope, or settles with the existing revised decision/Retry. No native route.
- A cold action displays remaining download bytes from the actual provider/model
  manifest after cache validation, purpose and Continue/Cancel, together with the
  [pre-download estimates and recommendation](#lightweight-device-check-and-pre-download-guidance).
  Group already-known
  photo prerequisites in one consent where practical; ask again only for additional
  assets outside the authorized scope. Detector refusal still permits manual crop.
  Explicit download cancellation stops that request's acquisition, keeps verified
  chunks for reuse, and cannot later launch the pending action. A newer input or
  abandoned crop invalidates deferred continuation. Ready faces remain usable.
- Distinguish downloading, loading/checking a cached model, queued work and active
  processing internally while one stable progress bar represents the whole requested
  action. Include download/setup/input preparation/compute/final file readiness where
  required; never reset the bar for each stage. Retain the frame counter as secondary
  detail without flickering technical stage copy. Show uncertain estimates honestly. Cached files alone do not mean models are
  resident in memory or guarantee instantaneous generation.
- Keep exactly one current morph result. Changes to ordered faces or morph settings
  invalidate its revision and associated Share/Save readiness. A completed face
  can remain usable when another face fails. Create Morph automatically prepares
  unfinished valid text/seed inputs, waits for validated selected-name or authorized
  confirmed-photo compute inputs, and starts frames when the required latent/model
  identities and endpoint representations are ready. Face-file preparation need not
  finish first unless the chosen pipeline consumes that encoded endpoint.
  Invalid or unconfirmed inputs get a concise reason; no separate Generate clicks
  are required. Once accepted, repeated clicks cannot queue duplicate morph intents. Cancellation never silently exports a partial animation as complete.
- Pixels may display before a shareable file exists. Show “Preparing file…” in the
  action area, then enable Share/Save for the selected format/revision. A format
  change prepares only that requested format, without more inference. Cache bounded
  prepared files by result revision/format; reject stale completions. If encoding
  fails, retain the visible result and offer file-preparation retry. System-share
  cancellation is not a generation error and does not trigger a download.
- The operator accepts e4e's reconstruction/editability tradeoff. Keep e4e and the
  original specified crop experience; no replacement-encoder selection or renewed
  resemblance approval is required. Verify framing, confirmed-pixel correctness and
  absence of new regressions. Use Encode image to explicitly choose/crop again;
  do not restore post-result Crop or hold-to-compare.
- Browser retention is best-effort convenience. Retry crops/photos remain tab-only;
  reloading loses unfinished photo retries. Completed recovery-bearing files are
  a portable backup. Tell users to keep an original PNG/WebP to reopen/edit a still
  later; MP4 is saved video with project reopening deferred. A shared social-media
  copy may lose metadata. No account, cloud project library, source-photo
  persistence or cross-origin migration is implied by session restore.
- File-open dispatch checks valid recovery metadata before treating an image as a
  new photo. Distinguish missing, damaged and incompatible metadata. A metadata-free
  image can explicitly enter photo encoding; damaged/incompatible recovery must not
  silently re-encode and change its identity. External MP4 opening is deferred;
  report unsupported video input without replacing current work. Model mismatch can leave the
  media viewable/saveable without claiming that its latent can be used by this model.

Review success by walking one complete useful session: select two names, morph,
cancel/retry if needed, play/scrub, save and reload; reopen a saved still image; then repeat with a
confirmed photo and ordered multi-selection. Inspect rendered crop/result bounds,
actual file readiness and recovery across narrow, intermediate and wide widths,
including live resizing and orientation changes rather than just fixed breakpoints. This addresses
the earlier feedback where intrinsic dimensions and component checks passed while
the displayed face was clipped. No physical-phone pass becomes a release gate.

### UI flow matrix and open journey contracts

12 October 2026. This is an implementation-readiness review, as if the plan were
about to be decomposed into execution work. These are user journeys and design
findings, not tasks, issue IDs or execution records. **Specified** means a usable
journey contract, not completed implementation. **Gap** identifies a transition
whose contract or implementation check is listed below; it does not authorize an implementer to invent extra UI. **Settled**
records an operator decision; **Deferred** excludes a journey from this release.
The contracts below resolve the previous choices without adding unrelated features
or changing locked designs. Remaining gaps use the accepted layout/action areas.

Check relevant journeys with cold models, usable model cache and completed-result
cache; narrow/intermediate/wide layouts and live resize; keyboard/touch; supported/unsupported/unknown
capabilities; offline/failed acquisition; and changed inputs/navigation during
pending work. These variants need contracts, not separate screens. Inference/device
coverage remains scoped to evidence.

| User journey | Required useful outcome | Readiness / missing contract |
| --- | --- | --- |
| First app visit | Usable inputs, names and working defaults; no model prompt/download on arrival | Planned: preserve default preview inside tile; Generate prepares it, Morph can prepare unfinished text, and preview pixels alone are never a valid result. |
| Return with completed retained work | Display/play/save without regeneration; preserve usable slider choice | Planned: compatible completed records restore independently; missing scrub frames retain video playback and labels may be generic. Reject late restore after user edits. |
| Phone/CPU route or an unavailable operation | Preserve admitted face/photo/morph work, plus complete static names and compatible completed files | Specified: admit per operation, retain bounded CPU fallback and phone optimizations; block only genuinely unsupported work before its preparation/acquisition. Recovery-first entry distinguishes catalogue/codec/storage failure. |
| Enter new words | Clear old displayed result; one Generate action inside the tile | Planned: compact action-state table covers eligibility, exact text identity, Enter/IME and invalid input without another control row. |
| Enter a numeric seed | Validate and generate the requested supported seed, including zero | Planned: preserve supported seed range and validate original input; invalid pasted numbers cannot silently become a different seed. |
| Cancel/fail text/seed generation, retry unchanged input | Retry without typing another character | Settled: Retry uses the current revision without an additional edit; verify the compact action-slot state table. |
| Edit/change mode/remove a queued or running tile | Supersede only that tile; preserve siblings; reject late results | Planned: abort owned work where supported, invalidate revision, show Cancelling until settlement and preserve independent siblings. |
| Open names from a face menu | Picker binds to that face; selection returns there | Specified; use the originating stable face ID rather than adding a page-wide selection control. |
| Pick a name on a cold/slow/offline connection | Prompt preview, validated static result, no synthesis fallback | Planned: existing target action slot carries loading/Retry; prepared result validates before Save/Morph, with revision checks and no synthesis fallback. |
| Edit a picked name as text/change source | Selection fills ordinary text and displays its prepared face; editing clears it and enables normal Generate | Settled: catalogue examples are generated exactly from their displayed names using normal text semantics. Store result identity/provenance, not a separate persistent names mode. |
| Find a particular known name | Type the exact name in the normal text field and Generate | Settled: the modal is for browsing example faces, not exact-name lookup; no search or lookup UI is needed. |
| Open/close fullscreen names modal, Back/Escape | Return to the same app panel and preserve work | Settled modal, no `/names` route; gap is focus/history ownership, stale restore and bounded scroll preservation. |
| Run/skip/timeout device timing check | Useful guidance without blocking names or an eligible device action | Planned: optional timing has a bounded deadline; unknown estimates do not block consent. Skipping timing cannot bypass real operation/resource admission. |
| Select CPU/WebGPU and request computation | Requested route/fallback scope/model captured at Start/Download approval; actual provider recorded | Specified: selector changes affect new jobs; queued jobs retain approved scope. Unavailable/failed GPU can use qualified bounded CPU fallback; new assets or materially changed cost require the existing revised decision. No native fallback. |
| Approve/refuse missing-model acquisition | Known scope/remaining bytes; refusal abandons continuation | Planned: bounded asset/route grant and existing action Cancel; stop abandoned acquisition unless another authorized owner remains. |
| Download/cache/quota failure | Bounded retry, truthful bytes and preserved completed work | Planned: distinguish cache failure from execution capability; bounded explicit Retry, no revived abandoned intent or assumed transient support. |
| Replace a face with a photo, cancel picker/crop | Predictable commit point, no stale results or damage to unrelated panels | Settled: preserve target where inexpensive; old-face rollback is desirable, not mandatory. Failed replacement can leave a retryable/empty target. |
| Paste an image/drop one on tile or background | Same recovery/photo dispatch and consent/crop flow with stable target | Planned: image-first paste and recovery inspection; background drop uses first empty/appended slot, unsupported input stays contextual. |
| Drop several files containing several faces | One global face-click sequence replaces the originating panel; unrelated panels remain | Settled order/insertion; compose existing file entry with bounded batch selection and per-slot cancel/retry, without file-first sorting. |
| Confirm one detected crop | Exact preview geometry reaches one encoder attempt | Specified; verify pixels/orientations, not merely modal/component presence. |
| Adjust/rotate crop, cancel/accept editor | Cancel restores proposal; Use Crop returns to confirmation | Planned: Adjust Crop edits focused/last-selected candidate only; Cancel restores it and Use Crop preserves selection order. |
| No detected face/refused detector assets | Visible manual crop path; eligible confirmed pixels reach e4e | Planned: optional Adjust Crop/proceed in existing crop flow; detector refusal abandons that acquisition, not local source access. |
| Select several detected faces | Review each crop; confirm once; insert in click order | Planned: common cross-file batch proposal with ordered badges and identified crop adjustment; slot/pixel budgets before atomic insertion. |
| Confirm photo with encoder/generator assets absent | Clear bundle decision; approved preparation overlaps crop selection, then automatic encoding after OK | Planned: scoped consent, synthesis-first acquisition plus prompt detector assets, photo selection/adjustment during remaining encoder transfer, OK freezes/queues input, then automatic encode when ready. |
| Cancel/retry one confirmed photo encode | Cancel then Retry in same slot; no recrop/duplicate keypoints | Planned: confirmed photo Retry reuses one slot/crop; lost tab-only pixels require existing Encode image entry again. |
| Add/remove controls | Stable ordered inputs and clear morph invalidation | Settled: insert and remove, no direct face reordering UI. **Remove does not work for a person on the live candidate** (operated check, 18 October; [defect 1](#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026)), so the retained behavior is repaired, not ported as it stands. |
| Add many faces (batch, several photos or repeated Add), then remove most of them | Every face's image, field, Generate and Remove stay visible and reachable at any count, with no hidden sideways scrolling | **Gap, added 18 October** ([defects 2 and 3](#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026)). The candidate's layout is designed for two or three faces. Needs the many-face layout and removal requirements in [face controls](#face-controls-and-modals). |
| Undo a removal; start over | A removed face comes back with one action, and one action returns the project to two empty faces | **Planned, added 18 October** (a planner's proposal the operator may veto): a short Undo notice after Remove, and **Start over** in More options with the same Undo. The last face still cannot be removed. |
| Use every journey with the keyboard alone | Every control reachable and operable by Tab in visual order, focus visible, focus returned after a dialog | **Gap, added 18 October** (defect 4): Tab skips the mode menu, names browser and file picker today. |
| Morph two identical neighbouring faces (same word twice, or A, B, A) | A plain refusal before any work, naming what to change | **Gap, added 18 October** (defect 6): the candidate says "This project is invalid or uses an unsupported format." |
| Type a word that has no instant picture | The tile says to press Generate; nothing is sent per keystroke; the photo entry stays in the mode menu and by drop | **Gap, added 18 October** (defects 8 and 11). |
| Type on a phone keyboard that capitalises | The text reaches the generator exactly as typed | **Gap, added 18 October** (defect 5). |
| Reload after a morph | Faces and result return, with their words | **Planned** (defect 9, a planner's proposal the operator may veto). |
| Use the page offline with models cached | The page says what works; cached work needs no network | **Planned** (defect 15, partly a planner's proposal). |
| Morph unfinished valid text/seed inputs | Create Morph automatically generates them before frames | Settled: one accepted intent, shared consent/progress/Cancel, no duplicate queued morphs or separate Generate requirement. |
| Change morph settings/start/cancel/retry | Bounded schedule, correct progress, completed faces retained | Planned: snapshot intent, disable duplicate starts, dependency-aware scheduler/Cancel and monotonic progress through prepared MP4 readiness. |
| Play video/switch to slider | One useful result; absent frames cannot strand the user | Planned: fall back to usable video playback when scrub frames are unavailable; no regeneration or external video import. |
| Save face WebP/PNG or morph MP4 | Current prepared file, correct format/name and recovery metadata | Planned: prepared bytes reused; actual PNG fallback updates MIME/extension and filename editing stays in existing result action area. |
| Share/cancel share/use unsupported host | User-gesture sharing; cancellation preserves file; obvious Save | Planned: Save primary without file-share capability; cancelled share preserves file, actual failure uses same-file fallback. |
| Save repeatedly/rename/change format/save after reload | Reuse bytes and distinguish identities without overwrite | Planned: preserve stable export identity; restored labels use opened filename or generic safe label when original text is unavailable. |
| Reopen recovery-bearing still | View/save immediately, restore latent without photo encoding | Planned: per-face file/menu entry restores compatible still without models; mismatched media remains viewable/saveable with compute disabled. |
| Reopen external project-bearing MP4 | Outside current UI scope | Deferred by operator: retain export/internal metadata readers and same-origin session playback; do not add import/preview restoration as a release gate. |
| Missing/damaged/incompatible still recovery or unsupported media | Reasonably preserve current work; clear valid recovery/photo options | No silent fresh encoding; explicit use-as-photo in existing action area. Avoid costly whole-project transactions; MP4 opening is deferred. |
| Background/reload/close during unfinished work | Truthful interruption; completed work retained | Planned: completed records/files remain useful; lost photo inputs require source selection, and unfinished/background work is not promised complete. |
| Report error with/without standing consent | One-shot stays one-shot; standing opt-in is explicit; Off-state toast remains | Specified: report only owning safe records, preserve refusal, label future reporting clearly, and make later withdrawal available via footer/Help. No redundant opt-in toast while On. |
| Remove down to one face | Generate/Encode/Save and compatible reload remain useful | Retained: only Morph requires a second compatible face; its existing reason explains how to continue. |
| Use tester bulk Generate faces or support/contact links | Existing tester tools and safe support context remain usable | Retained: bulk action is `?testing` only; Help/footer issue links carry safe source/device/actual-route/report reference and follow the correct repo. |
| Turn standing debug reports On/Off, reload or fail to persist | Discoverable choice below Help; Off immediately stops uploads without interrupting work | Specified: `#debug-reporting` disclosure/footer link; restore actual saved choice, abort/discard unsent reports on withdrawal, disclose tab-only choice on persistence failure. Analytics remains separate. |
| Follow desktop-package/download recommendation | Use the web app in a supported browser; suggest a computer where useful | Retired this release: no native build/update/download links or installed-host release gate; maintained Help records the change. |

#### Known candidate defects found by operating the live candidate — 18 October 2026

Method: headless Chromium against `https://next.facemorph.me/` (the build live that day), with real pointer
and touch input, no photos and no model downloads, at 390, 1,024, 1,280 and 1,920 px wide. Screenshots and
measurements stay in the session scratch area, not Git. These are defects of the candidate: they are recorded,
not frozen as parity (see the comparison-layer rule), and the port must not copy them.

1. **A person cannot remove a face.** Each face has a Remove control meant as a close button at the top
   right of its image. The candidate's stylesheet places it there, but the component library's own button
   style wins the tie, so the control sits in normal flow below the image (the image box clips it, so it is
   invisible), in the library's default dark grey instead of the intended light colour, over the face's
   mode-menu button. A real click at its position opens the "Change mode" menu and removes nothing. The
   candidate's automated checks pass anyway because they find the control by accessible name and click it
   directly, which works even though a person can neither see nor hit it. Evidence (two faces, 1,280 px):
   control box 32 by 32 at (201, 611) against image box 376 by 376 at (206, 229); a mouse click at its
   centre opened the menu and removed nothing; the by-name click removed the face. Injecting one rule that
   nests the style under the image (so it out-ranks the library) put the control inside the image at the top
   right, and a real click on desktop and a real tap on a 390 px phone each removed exactly one face
   (tried in the live page; nothing was deployed). That control is 32 px, under the 44 px comfortable touch
   size.
2. **More than two faces do not fit.** The candidate has layouts for two and three faces only. At 1,280 px
   the third tile is already cut off at the column edge (its box reaches x = 1,488 in a 1,280 px window); from
   the third face the row is a sideways strip with no visible scroll cue (it moves with a swipe or trackpad
   gesture), and fourteen faces make a strip about 6,000 px long. On a phone the tiles stack at about 480 px
   each, so fourteen faces make a page about 7,000 px tall.
3. **No way to remove or reset many faces.** Even with Remove repaired, taking thirty faces down to ten is
   twenty separate taps through that strip or page. There is no undo and no reset, and the last face is never
   removable.

The planned resolution is in [face controls and modals](#face-controls-and-modals) (many faces and removal) and
the acceptance rule in [operated-acceptance rule](#acceptance-receipts-and-gate-style-acceptance) below.

**Added by the [candidate audit of 18 October](docs/findings/candidate-audit-2026-10-18.md).** A full read of the
candidate, production classic and this plan, plus operation of the live site (a desktop window and an iPhone-sized
emulation, the CPU route, both model downloads, one complete morph and one photo face), found the further defects
below. The note labels the evidence: "source" means read in the code and not run, so it is a lead for the port's
tests. Like 1 to 3 these are candidate defects, not frozen as parity: each is a "repair" row in the flow-matrix
freeze, graded against this plan's specification, has a named owner and is accepted by the operated rule below.

| # | Defect (operated unless marked source) | The port must | Owner |
| --- | --- | --- | --- |
| 4 | Keyboard users cannot reach Change mode, Browse names or Choose photo: Tab skips them (classic's are reachable). | Every control is reachable by Tab in visual order; acceptance drives each journey with the keyboard alone. | Face controls |
| 5 | The text field lacks `autocapitalize=off` (classic sets it). A phone keyboard turns "hello" into "Hello", a different face, because the text is hashed exactly; picked names fill in lowercase. | Turn off capitalisation, correction and spell-check on the field; never trim or normalise the text. | Face controls |
| 6 | The same word in both faces, or A, B, A, fails with "This project is invalid or uses an unsupported format." | Refuse identical neighbours before any work, with a plain message that names what to change; A, B, A is allowed or refused by one stated rule (the closed loop makes the last face a neighbour of the first). | Morph pipeline |
| 7 | With one face left, Add face is disabled beside a note telling the person to add a second face. | Add face stays enabled; there is no fixed face count. | Face controls |
| 8 | A typed word with no instant picture leaves the tile saying "Drop a photo, or tap to choose". | Say "Press Generate to make this face" for a typed word; the photo entry stays in the mode menu and by drop (planner's wording). | Face controls |
| 9 | After a reload the faces return but their words are gone: the field shows a disabled "Restored face". | Planner's proposal (the operator may veto): restore the typed words or seed with the session; photo faces show the file name. | Media and recovery |
| 10 | Download sizes disagree: the toast says 149 MB, 1.1 GB and 1.2 GB, the progress line says 158 MB and 1,040 MB. | One figure per purpose in one unit, the same in the toast, dialog and progress; acceptance compares them. | Acquisition consent |
| 11 | The privacy text is incomplete. Typing a seed requests a picture per partial number (389 asks for 3, 38 and 389) from a `workers.dev` host; a Cloudflare analytics beacon loads; the 3.4 MB name list is fetched on the first keystroke. Source: saved files carry the exact latent and nothing says so. | Send nothing per keystroke; name every outside request and what a saved file contains in the privacy text. | Static names (requests), Diagnostics consent control (text) |
| 12 | Source: the failure toast's "Send report" turns standing reporting on for good, while the error box's near-identical "Send this report" sends once. | A one-off send stays one-off and its label says so. | Diagnostics consent control |
| 13 | Source: photo-selection reports use an action the collector rejects, and one bad event drops the whole batch. The 801 mined reports hold no photo action, which fits but does not prove it. | The client and the collector share one list of actions; a test fails if they differ. | Diagnostics consent control |
| 14 | The names dialog's labels and Close are near-black on near-black (contrast 1.18 to 1), and a failed name list leaves an empty dialog (the error sits behind it). | Names over the images stay readable on any face (4.5 to 1 against a scrim or shadow), the exit is the accepted floating Back and Escape, and a failed list shows its error inside the dialog. | Static names |
| 15 | With models cached and the network off, a new face fails with "The local generation engine stopped." (seen once); source: every job re-fetches the model manifest with no cache. | State what works offline; planner's proposal (the operator may veto): a job whose files are all cached needs no network. | Application operation controller |
| 16 | The first visit stacks two bottom toasts; the first covers Create morph at 1,280 by 800 and fills a third of a phone screen. | No prompt covers an action and only one shows at a time (the download prompt is already removed by the consent rules). | Diagnostics consent control |
| 17 | Source: removing a face that is generating does not stop its job; a saved-MP4 drop can leave Morph queued for good and replaces every face without asking; replacing a photo destroys the face before the new photo is checked; cancelling a queued re-generate can leave a broken image. | Each is a case in the stale-completion acceptance. | Application operation controller |
| 18 | Source: the 64-face cap is enforced in one of three places (the "+" silently does nothing, multi-file drop is uncapped, a 65-face morph fails with the generic project error). | No fixed face count (operator, 24 October): the 64 is only a project-validation constant (`MaxControls` in `ProjectJson.fs`). Every entry path uses one admission check against real budgets (frame budget, memory, stored-session size), and refusal names the actual limit reached in one plain message. Parsing untrusted project files keeps a byte-size bound, not a face count. | Face controls |
| 19 | Source: the 32 MB video-fallback download is outside every consent, and the download gate lets work start when the size list cannot be built. | Unknown size means ask; the fallback codec joins the consent. | Acquisition consent |
| 20 | Source: "about 1 seconds"; "smaller than25 MB" and two more messages missing a space; seed placeholder "Just type anything"; the cold-device estimate text can never appear; disabled Create morph looks enabled; the crop panel is transparent in light mode. | Fix with the owning control; the one-string fixes also join the early candidate edits. | Face controls |
| 21 | Source: the licence and notices page is published but linked from nowhere, and misstates where the video codec is served from. | Link it from Help and the footer and keep it true. | Provider simplification (Help) |
| 22 | Source: nothing shows or clears what is stored on the device, and the faces store has no ceiling. | Planner's proposal (the operator may veto): a Help line with the size and a Clear button, and a bounded faces store. | Media and recovery |
| 23 | Source: preview faces look like generated faces; only a screen-reader label says otherwise. | Already decided (no badge); listed so it is a choice, not an oversight. | none |

Not reproduced: a legacy Universal Analytics tag that the code suggests loads on every visit (a headless page load
made no request to Google). Decided and unchanged: the names picker drops search, header, Close and Show more for
a floating Back on touch; the audit records the loss of search so it is a choice.

#### Operator dispositions — 12 October 2026

All three previously open choices are settled. Create Morph automatically generates
unfinished valid text/seed inputs before frame production. External MP4 project-open
UI is deferred; preserve its metadata/readers and same-origin retained video playback.
Direct face reordering is out of scope; keep insertion/removal and selection order.

The names modal browses example faces generated from each displayed name exactly
as ordinary text would be. Selection fills that name into the normal text field and
displays its verified prepared result; editing resumes the ordinary text flow.
There is no separate persistent name-input mode, exact-name search requirement or
required `/names` navigation. Refine the existing modal, following the specified
fullscreen gapless grid and accepted dismissal behavior.

The requested CPU/WebGPU route, permitted failure-fallback scope and runtime/model
identity are captured at Start/download approval and stay with queued work; later
selector changes apply to new jobs. Multi-file selections use one global face-click order and replace the
originating panel in place. Whole-action progress and intermediate-width/resizing
verification are required. Commit points are accepted, but elaborate rollback or
full-project recovery is not. These rulings supersede the earlier proposals.

#### Gaps with reasonable solutions inside the accepted design

**Tile action states.** Freeze one slot for new eligible text/seed (Generate), queued/
downloading/loading/encoding/synthesis (Cancel where cancellable), stopping (disabled
Cancelling), and failed/cancelled retryable (Retry). Photo Retry is not Generate and
does not recrop. Static-name acquisition may show loading/Retry for the selected text revision:
“instant” excludes synthesis, not network failure. A reloaded photo with lost retry
pixels needs Choose image again. Eligibility means no valid result for the current
revision, rather than a string different from the last attempt. Include keyboard/
Enter activation and seed validation. Generate and the candidate's empty-tile
photo-click behavior cannot share one click target: keep source-menu/drop photo
entry when Generate is in the tile. A historic initial preview is display-only:
keep the action inside that tile; Morph may generate its unfinished text but cannot
use preview pixels as a verified input, and Save waits for a verified current result. No extra preview badge or onboarding is needed. Completed-result
Share/Save stays outside this operation slot.

The existing seed range is 0 through 4,294,967,295 inclusive (`Product.fs` seed input,
`image-envelope.mjs`). Empty, negative,
fractional and out-of-range input needs field validation rather than digit stripping
that changes the requested seed. The operator did not request a new seed mapping.

Words reject empty/whitespace-only input and enforce the existing 512 UTF-8-byte
limit (`browser/identity.mjs`). Preserve the exact accepted string's case/spacing/Unicode generation semantics;
do not silently normalize it into another face. Enter invokes the same eligible
Generate/Retry action, respects IME composition, and cannot duplicate an active job.
Tab reaches menus/actions in visual order; buttons removed by the plan leave no
hidden shortcuts or stale focus targets.

| Current revision / state | Existing tile action area |
| --- | --- |
| Empty or invalid words/seed | No enabled Generate; concise field error for invalid input |
| Valid unfinished words/seed, including initial display-only preview | Generate when the requested/qualified route is admitted; otherwise readable operation-specific support reason with Help |
| Verified selected-name/text/seed/photo/restored result | Result actions when its file is ready; no redundant Generate |
| Static selection pending | Loading and cancellable request; Retry for fetch failure, never implicit synthesis |
| Accepted queued or active compute/acquisition | Cancel for that operation |
| Non-preemptible work is stopping | Disabled Cancelling until settlement, then Retry if input remains available |
| Failed/cancelled words/seed or confirmed photo with retry pixels | Retry for the same input/slot, using a new attempt identity |
| Interrupted photo whose retry pixels are gone | Existing Encode image entry to choose the source again |
| Pixels ready, selected file pending/failed | Preparing file, or file-preparation Retry; keep visible pixels |

Typing or changing a source creates a new revision and invalidates its old prepared
file/morph immediately. Cancel attempts actual abort/worker stop where supported;
revision invalidation alone is not permission to run abandoned work in the background.
Wait for owned resources to settle before reuse. Removal invalidates and releases
that slot without affecting unrelated completed faces.

**Replacement commit points.** Define when source/result identity changes and when
morph/file readiness invalidates. Keep the previous target through cancelled file
selection or rejected recovery where straightforward; restoring it after every
cancelled/failed replacement is optional. A target may become empty/retryable while
unrelated completed panels remain. Typed edits clear displayed results immediately.
Never save the old face under a newly selected name or install a late result into
a newer target. Local staging/revision checks are enough; do not build undo/history
or transactional whole-project import. External MP4 opening is deferred.

**Cold photo sequence.** Local recovery/file inspection; bounded fresh-photo route
admission, including qualified phone routes independently of WebGPU; one explicit
bundle approval; synthesis-first large-model acquisition and prompt detector assets;
review/adjust/select crops while remaining approved encoder acquisition proceeds;
OK freezes/queues encodes, which start after their own prerequisites are ready.
An explicitly approved photo-setup intent can overlap the source chooser too. This
supersedes crop-OK-delayed acquisition: some approved bytes may be transferred before
the user cancels, in exchange for a shorter post-confirmation wait. Cancel releases
owned transfer/warming, retains verified cache and cannot resume abandoned work.
Choosing Generate pauses photo continuation rather than silently acquiring an encoder.
New assets still need consent. Detector refusal/unavailability leaves the source
with manual Adjust Crop access; encoding retains its own prerequisites. Refusal
cannot authorize another model. Distinguish download decision Cancel, whole crop
Cancel and per-slot encode Cancel; late continuations cannot resume abandoned work.

**Nested photo batches.** Keep one selection-click sequence across all supplied
files. The first selected candidate replaces the originating panel; all others insert
immediately after it in that global order, retaining unrelated panels. File order,
detector order and asynchronous completion must not reorder that sequence.
Deselect removes; reselect appends. Review/adjust each chosen crop using existing
selection badges and Adjust Crop, without adding post-insertion reorder UI. Before
OK no extra keypoints exist; OK freezes the sequence and reserves slot/pixel
budgets once. Modal Cancel discards the uncommitted batch. A bad file is identified
and can be omitted without silently shifting the target or losing selected valid
crops; after OK per-slot failures/cancel/retry preserve siblings. Walk A1, B2, A2
clicks across two files, omit a corrupt third file, then cancel one queued slot.

For a multi-file entry, inspect each image's recovery metadata before any target
commit. Stage a valid recovered still as one ready candidate alongside fresh-photo
crop candidates in the same batch selection view. One global candidate-click
sequence determines insertion order; batch OK installs recovered candidates and
confirmed-photo slots together after budget/revision checks. Recovered candidates
bypass detection, crop adjustment and e4e; compatibility still determines compute
eligibility. Damaged recovery never silently becomes a photo: omit that file or
explicitly Use as photo through the existing contextual action. A valid unknown-model
or model-incompatible recovered still remains selectable/viewable/saveable with compute
disabled; incompatibility alone does not force omission or Use as photo.
Where a photo operation is genuinely unavailable, preserve this mixed-batch recovery path:
keep valid recovered candidates selectable/viewable/saveable, and identify ordinary
photos as unavailable without detector/crop/model work. The user can omit those
photos and confirm the recovered subset in click order; never reject all recovered
siblings merely because one file needs unavailable compute. Use as photo remains
unavailable with the same support reason. Account for staged recovered assets under
the completed-result budget and photo sources/crops under their own byte ceilings.
A single recovered still keeps its direct recovery path. Cancel releases staged
resources without a partial import. This extends the existing batch proposal,
without another import screen or changes to the locked crop editor. Check recovered
R → photo A2 → photo B1, omitting a corrupt fourth file; cancel before OK, then
confirm and verify exact insertion order with no inference for R.

The current candidate allocates one slot per dropped file and `selectPhoto` admits
one source at a time. Replace that composition with one bounded batch proposal and
one confirmation containing candidates from all supplied files. A sequence of isolated
file modals cannot support A1 → B2 → A2; users must be able to select across files
before OK. Reuse the crop modal/grid visual language, with minimal source grouping
where needed to distinguish candidates. One sole photo candidate can remain the
default single-crop proposal; multi-candidate selection starts empty and OK requires a choice.
Adjust Crop applies to the focused/last-selected candidate, clearly identified in
the existing action/preview, and never changes selection order. It applies only to
a photo candidate; recovered candidates retain their original recovery identity.
Editor Cancel restores
that candidate only; Use Crop returns to the same batch. No file-navigation toolbar,
per-file duplicate panel allocation or post-insertion reorder control is needed.

**Operation/resource ownership.** Snapshot requested CPU/WebGPU route, bounded
permitted failure-fallback scope, runtime/model and input revisions when work is
requested or Download and continue approved. Record actual execution provider;
queue admission and later selector changes cannot silently change approved scope.
Preserve qualified CPU fallback, re-admission Retry and revised material-cost /
extra-byte consent. No native fallback. Cancel abandons that
intent, not every authorized consumer of shared assets. Distinguish cache quota
failure from inability to execute: transient execution requires actual bounded
provider support. A single Busy/LastRun/Retry cannot represent independent slots /
imports/downloads; associate errors and Retry with their existing action areas.
Existing candidate download Cancel is a capability to retain and verify, not an
assumed missing feature.

Freeze acquisition authorization as a bounded grant over manifest identity, route,
purpose, required asset digests and advertised remaining-byte scope. Candidate
`DownloadConsent` is a broad route/photo set, and unknown inventory currently bypasses
`gateScope`; neither is sufficient for the new boundary. Cache inspection failure
must settle with Retry, not implicit acquisition. Approval may cover selected model
preparation during input selection, deferred stages and retry within unchanged scope; it is not perpetual
authorization for a new checkpoint/provider or abandoned action. Revalidate cache
without inflating the approved budget silently; additional/replacement scope needs
a revised decision. Declined detector acquisition leaves local crop access, but its
continuation is abandoned; OK/manual continuation is a new explicit request for its
remaining encoder/generator prerequisites, not revival of the refused detector.

Separate Cancel from Hide. Candidate action cancellation aborts the active controller
and runtime; explicit prefetch has worker-stop/settlement primitives, while its toast
currently offers Hide. Use the existing action Cancel for acquisition owned by that
intent and test that network/worker submissions stop within the declared bound. A
shared fetch stops when its final authorized consumer leaves; other explicit owners
may continue. Cancelling a morph never destroys a separately requested face job.

**Open/share/export affordances.** Use existing per-face menu/file entry for still
images; drop alone is insufficient for touch/keyboard. Inspect metadata before
replacing the target, and reject late imports against newer edits. Preserve current
work reasonably without an elaborate project transaction. Model mismatch may leave
an image viewable/saveable with incompatible compute disabled; never follow model
URLs from a file. Put deliberate use-as-photo in the existing error/action area.
External MP4 opening is deferred. MP4 export/internal metadata round-trip and retained
session playback remain required. PNG fallback updates format/extension or fails
clearly. Save becomes primary on hosts without file sharing; Share stays primary
where supported. Share cancellation must not trigger a download. Filename editing
uses the existing result action area rather than an obligatory dialog.

**Names history/accessibility.** Bind the per-face menu's stable slot and originating
focus. Accessible dialog naming does not require a visible header. Opening is modal
state; Back/Escape/accepted touch Back dismiss without page navigation or a history
loop, and closing restores focus. Late session restore or static fetch cannot
replace a newer selection. Preserve picker scroll where inexpensive. Use bounded
preview window/cache rather than accumulating thousands of images after scrolling;
windowing preserves keyboard focus/navigation. No search/header/X is added.

Only the topmost active modal owns Escape/Back and keyboard focus; temporarily
suspend the underlying page while it is open. Modal Back dismisses once and prevents
reopening loops on Forward or leaving the app unexpectedly. Crop editor Back behaves
like editor Cancel; confirmation Back behaves like confirmation Cancel; acquisition
Back behaves like its Cancel. If a new consent needs to follow crop OK, replace the
completed dialog rather than stacking a second focus trap. During detector failure,
keep optional manual/proceed actions inside the crop flow. Contextual errors contain
one short explanation and the useful existing recovery action; raw exceptions,
duplicate toasts and focus-stealing reporting prompts are not product copy.

**Whole-action progress.** One operation progress contract spans the requested action:
missing-model acquisition, local checks/load, confirmed input preparation, encoding /
synthesis, morph frames and selected file preparation as applicable. A crop decision
may pause preparation; never advance percentages while waiting for the user. Freeze
known work and provider/model identity at the request boundary. Calibrate phase weights
from scoped measurements, account for overlap once, and emit monotonic progress for
that attempt without stage resets. Do not mix raw download bytes and frame counts
as if they were the same unit. When costs are unknown, use one indeterminate bar
with meaningful bytes/count detail until a defensible whole-action denominator is
available; do not invent progress or race to 99%. Completion means the requested
usable output/file is ready, not merely the final inference frame. A later explicit
format-change/Save preparation is its own bounded action. Retry starts a new attempt;
cancellation/failure settles the bar and retains usable results. Keep stable short
copy and the frame counter where helpful; no technical stage dashboard.

Freeze the progress completion boundary per action: face generation/photo encode
finishes when its default recovery-bearing file is ready; Morph finishes when the
playable default MP4 with project metadata is ready; name selection finishes after
its static result is validated and default file prepared. Pixels may display sooner.
Best-effort persistence and optional diagnostics are outside that completion boundary
and never hold the bar open. Release compute admission after compute settles; awaiting
bounded file preparation does not retain an otherwise idle heavyweight compute permit.
Any retained runtime memory still counts against residency reservations. For a
confirmed batch, a common acquisition/preparation
prefix belongs to each affected slot's whole-action progress; individual slots may
finish independently. Morph composes prerequisite progress without double-counting
shared downloads or re-starting a completed tile's bar. Unknown-duration setup stays
honestly indeterminate; a precise percentage cannot be promised without measurement.

Distinguish compute-input readiness from face-action completion. A verified current
latent/model identity and an owned usable endpoint representation can satisfy a
Morph dependency before that face's default file is ready. Wait for an encoded
endpoint only where the selected pipeline actually needs it; preserve bounded
endpoint reuse without repeating synthesis to bypass file preparation. File
preparation continues under its own budget. Its failure retains the verified face
and offers file-preparation Retry, never another inference attempt; it does not
invalidate an otherwise usable Morph input. Face progress still completes at the
default recovery-bearing file boundary. Static-name inputs require validation of
their published result/latent pair before compute readiness, not just preview pixels.

**Entry, recovery and result transitions.** Resolve the remaining journey variants
through existing controls:

- Image clipboard data takes precedence over coincident plain text in the targeted
  text field. Without image data, preserve ordinary paste. A single clipboard image
  uses the same still-recovery-first/photo dispatch as the file chooser; mixed or
  unsupported items produce a contextual message and no unintended text replacement.
  Drop on a face binds that stable target. Background drop uses the first empty face,
  or appends one if none is empty, without replacing an unrelated populated face.
- Inspect a recovery-bearing still before photo preparation; a single valid matching
  recovery installs its image/latent in the target without model acquisition or encoding.
  Multi-file entries stage it under the mixed-batch contract above until batch OK.
  Damaged/incompatible recovery offers explicit Use as photo when decodable; it never
  silently changes identity. Unknown-model media can remain viewable/saveable but is
  excluded from morph compute. Preserve the old target on rejected input when simple;
  there is no project-wide import or external MP4-open flow.
- Restore completed compatible records before applying them, and abandon a late
  restore after any user edit/selection. If retained scrub frames are absent, keep
  the video player usable and fall back from slider mode without regeneration.
  Partial recovery may restore valid completed faces independently; lost unfinished
  photo inputs point to Encode image, not an impossible Retry. Do not promise original
  words/filenames or all-or-nothing recovery from best-effort session storage.
- A morph request snapshots ordered compatible input revisions and settings. Valid
  unfinished words/seeds are prepared automatically; already pending selected-name or
  confirmed-photo results are dependencies. Unconfirmed/invalid inputs block acceptance
  with a short reason in the existing area, not an additional wizard. Changing an input
  or morph setting supersedes the affected intent/result, aborts obsolete production
  and cannot install stale files. Completed unrelated faces stay usable. Keep settings
  disabled during active morph as in the candidate; a newer face edit abandons the
  old morph rather than continuing to export obsolete work.
- Keep one current prepared file per selected revision/format, with a bounded cache
  for additional formats. A format change invalidates only that file's action readiness;
  do not re-run inference. If WebP falls back to PNG, show PNG with its actual MIME /
  extension. Share is primary where supported, Save where not; cancelled share does
  nothing further, actual share failure offers/saves the same file. Editing the proposed
  filename is optional within the result action area and retains the identity suffix.
- Device check is cancellable/skippable in the existing guidance/action area; browsing
  does not wait for it. The download decision remains usable with a labelled unknown
  estimate at its deadline on an eligible device. Per-operation capability/resource
  admission is mandatory; timing skip cannot bypass it or disable supported phone/CPU work.
  Background/reload interruption never claims success or guaranteed continued compute.

These close design ambiguities using the accepted layout. Implementation evidence
must exercise each matrix row, including stale completions, denied consent and
partial failure, rather than marking the whole UI complete from a happy-path demo.

#### Accepted limits that should not become surprise requirements

Exact-name generation uses the ordinary text box on an eligible device; the
no-search grid browses examples on supported viewing devices. A model-free probe
cannot guarantee model fit, timings on every computer or background completion.
Without source-photo retention/post-result Crop, recropping after reload requires
selecting the source again. Latents do not recover words/source basenames: reuse a
safe opened filename where applicable, otherwise a generic label plus stable suffix;
do not add forbidden labels to metadata to recreate a title. MP4 playback does not
imply retained scrub frames; keep video usable rather than demanding regeneration.
Explain these at the relevant action, without mandatory onboarding.

**First task of the contracts workstream, ahead of the workstreams that build on them:** freeze
the compact tile/consent/progress state contracts and walk all remaining Gap rows against the
existing references. (This replaces the earlier wording "before execution decomposition", which
contradicted contracts being an execution workstream; decomposition can proceed with this as a
named first task.) The operator choices above are settled; remaining engineering details do not
warrant more UI or another approval cycle. Apart from the later explicitly requested
published-package acceptance item, no execution decomposition, application
implementation or deployment is established by this review.

### Names selection: implementation gap and complete target

Source check at candidate `b2d945a`: `Product.fs` handles `ChooseName` by setting
text and dispatching `RunFace`; `generateNameOrSeed` in `product-bridge.mjs` still
calls `synthesize` or `generate`. `public-previews.mjs` deliberately separates
historic JPEG previews from complete recoverable results. A catalogue latent alone
does not make selecting a name inference-free. This is an implementation gap against
an already explicit original requirement, not a new feature request or a reason
selection must synthesize. Cached outputs may avoid actual compute; cold selection
still goes through the generation path until corrected.

Do a one-time offline preparation and publication of the complete supported names
catalogue, with pixels plus exact latent/model/generation identity and checksums,
using the existing catalogue/staging mechanisms. Reuse any already valid matching
assets; generate only missing or incompatible results. Repeat this publication only
when catalogue contents or the qualified model identity changes, not on user selection.
Use recovery-bearing WebP/PNG or an equivalently validated image+latent pair that
can produce the required recovery-bearing Save file without inference. Historic
JPEGs must not become canonical results merely by attaching a guessed compatible
latent. Build/qualify matched result assets offline from the declared model where
needed. Validate coverage for every selectable catalogue entry before publishing
the catalogue that advertises those results; upload immutable assets first and
switch the catalogue only after image/latent/recovery checks pass. Keep resumable
preparation and a manifest so interruption does not require regenerating valid rows.
[static names and picker](#static-names-and-picker) owns this application catalogue work; [model hosting extraction](#model-hosting-extraction) owns reusable hosting
machinery, and neither introduces hosted request-time inference or user uploads.

**Current publication state (source-checked 15 October 2026).** Two public static
Workers already exist. `facemorph-seed-gallery` holds 8,966 historic lossy images
(364,039,372 bytes): 5,055 name previews at 200px, 2,911 full-size name images and
seeds 0–999 at 1024px. `facemorph-name-catalogue` (run 38029582696) adds a pinned
36,864-byte W+ latent for **all 5,055 names**, derived independently from the exact
lowercase names with NumPy plus the pinned CPU mapping and checked against the
product's JS path, and the 2,144 full-size previews the gallery lacked. So latents
are not the gap; **canonical recovery-bearing pixels are**. Every existing full-size
image is a lossy JPEG fetched from the hosted API (`materialize.py`, see the
[known references](#known-active-references-to-the-retiring-hosts--source-scan-15-october-2026)),
which this plan rules out as a canonical result, and that tooling stops working at
retirement.

Add one **catalogue result generator** inside [static names and picker](#static-names-and-picker):
run the exact lowercase names through a qualified runtime on a capable worker under
the shared device lease, write the default recovery-bearing WebP through the media
envelope helpers, check each result's raw synthesis and latent against the
independent reference, and record a resumable manifest. It needs the frozen
[contracts](#package-and-operation-contracts) and a qualified generator, **not a
finished compute extraction**: the pinned candidate runtime in a headless browser is
an acceptable producer, because extraction must preserve its raw output within the
same tolerances; the equality check against the ordinary typed-name resolver is re-run
once extraction lands. Published identity must not depend on which runtime produced it, so
the user-visible inference-free picker is not held behind compute extraction or the package refactor.
It still waits on the prerequisites in the [workstream table](#implementation-approach-and-sequencing)
(hosting machinery, the pipeline's re-homed workflow and the lease runner), so it is not free-standing.

Sizing to confirm at execution, not measured here: the candidate's first-Save evidence
puts a recovery-bearing 1024px WebP near 117 KB, about 0.6 GB for 5,055 results
(PNG at 4.38 MB per face would be about 22 GB and is not a catalogue format). The
Workers Free plan allows 20,000 static assets per Worker version at up to 25 MiB each
(Cloudflare limits documentation, checked 15 October 2026). The catalogue Worker
holds about 7,200 files today; adding 5,055 results gives about 12,300, inside the
limit with margin. Wrangler must be 4.34.0 or newer only for the higher paid limit;
CI already pins 4.149.0. Record the actual count, bytes and tier in the publication
receipt, and re-check if previews and results are served from one version.

**Payload and endpoint (decided 16 October).** No multi-megabyte per-name download is planned: a
pick fetches one recovery-bearing WebP of about 117 KB. A picked name contributes its latent, as the
start or end point of a morph, and its validated image, which serves the preview, the slider and the
video at that point; no endpoint frame is re-synthesized. How that frame looks next to its synthesized
neighbours is ordinary visual review in the morph checks, not a gate. The picker's look stays the legacy
names grid.

**`catalogue.json` is not a requirement (decided 16 October).** The candidate's file (3.4 MB parsed,
about 570 KB over the wire) is one possible shape of the data, not something to preserve or shrink.
The product needs only four things, and the static-names workstream may deliver them in any shape that
meets the bars below:

1. **The ordered list of selectable names**, available for first paint of the grid. As plain text this
   is 46 KB raw / 18 KB gzip for 5,055 names, so it needs no sharding or lazy loading.
2. **A grid preview per name, fetched incrementally** as the grid scrolls (today 5,055 separate 200px
   historic JPEGs).
3. **One validated recovery-bearing result for the picked name** (about 117 KB WebP carrying the exact
   W+), with its integrity checked before it is used.
4. **One small atomic pointer** naming the published set: version, model and generation identity, the
   URL scheme and the hashes that let assets switch together only after the checks pass.

Everything else in the candidate's per-row records is derivable or constant: all 5,055 rows repeat one
`modelSha256`/`generationSha256`/size/space/shape, `value` is the lowercased name, `id` is
SHA-256(`value`), the latent and result URLs follow from `id`, and the latent itself is a pure function
of the name plus the pinned mapping (the publication was independently re-derived from names with NumPy).
Per-row records are therefore the thing to remove, not compress. A design that fits is a names text
file, a manifest holding the constants once, and content-addressed result objects keyed by `id`; the
32-byte integrity hash per name (a 162 KB floor) need not load at first paint, because it is needed only
for the picked name and can live in prefix shards, in the result object's own validated header, or in
a hash list fetched on first pick. Preview packaging is free in the same way: individual files, or tiled
pages that cut request count, judged on bytes, requests and scroll smoothness, with no change to how the
grid looks.

**Bars the chosen shape must meet (measured in the workstream's spike, not assumed here):** first grid
paint transfers no more than the names text plus the manifest and the first visible previews; a pick
adds one result fetch plus at most one small integrity lookup; the identity checks listed in this section
are unchanged (exact name-to-text equality with typed input, no silent synthesis fallback, stale-response
rejection, cold/offline behaviour); publication stays immutable-assets-first with an atomic switch and a
resumable manifest; the Workers asset-count limit above is respected; and the existing file stays
served, unchanged, for as long as the candidate or the control artifact reads it
(`public-previews.mjs`, `check-no-third-party.mjs`, `stage.py` and `promote.py` all name
`catalogue.json`), with the new shape published beside it and the old one retired at cutover. Parity
comparisons against the control artifact use the control's own file.

Catalogue entries must use exactly the same name-to-text generation mapping, model
and settings as ordinary text entry, with that identity recorded in the publication
manifest. A displayed name must not point to an unrelated latent or historic face.

Use one canonical text-generation resolver for catalogue preparation and typed input.
Candidate `generateNameOrSeed` currently tries a catalogue W+ latent and silently
falls back to ordinary text mapping when that fetch fails; those paths are not proof
of equal results. Qualify published entries against the same canonical resolver
used by the ordinary typed-name path, including cold/offline catalogue and cache-miss
cases. Use the [small synthesis tolerances](#synthesis-correctness-and-export-quality)
for raw pre-compression network output and exact declared latent/identity checks;
compressed catalogue images use the separate export-quality rules, never byte parity
or raw-synthesis thresholds applied to lossy decoded pixels.
Existing qualified named-text mappings may be retained if shared by both paths;
do not choose a new mapping merely to simplify publication. Reuse an old asset only
if those checks pass; otherwise prepare it once from the canonical resolver. Prevent
transient catalogue availability from changing the face associated with a typed string. Case, Unicode
and whitespace variants retain the same rules as ordinary text, without a new
lookup UI or silent identity remapping.

Selection fills that name in the ordinary text field, shows its available preview
immediately and fetches only that selected result's bounded assets; the current text
revision becomes a completed morph input/Save result after
integrity validation. “Instant” means no model download/inference/Generate step,
not zero network latency. Show loading/retry/offline states, reject stale target
responses, and never silently substitute synthesis on catalogue failure. Fetch
visible grid previews incrementally, not full-size results for all 5,055 catalogue
rows (`publicNameCount` in the 10 October publication receipt). Morphing selected names still needs the
generator; gate its missing-model acquisition when Morph is requested.

Retain the requested gapless grid, overlaid readable names and no header/search/X.
Refine the existing candidate fullscreen modal; copy the visual interaction, not
the old API/iframe architecture. Use semantic buttons, visible keyboard focus,
Escape and browser/host Back dismissal without replacing the target. The accepted
small floating Back action serves touch browsers without visible Back; preserve
the grid and avoid obscuring names/selection. An error/empty picker remains
dismissible. No `/names` route or standalone two-name flow is required. Editing
selected text invalidates its ready result and enables ordinary Generate/Retry;
result provenance/readiness is distinct from a persistent names source mode.

## Supplied UI references
Source: workspace `image-archive.zip`, supplied with the operator's 11 October 2026
planning clarification. Archive SHA-256:
`f38de24a7feba6e9213d399ad328280a8017245605e0cfa63c9031415921740a`.
All four actual PNGs were viewed. `__MACOSX/._*` entries are metadata, not screenshots.
Personal-photo pixels stay out of Git; inspect the supplied archive for the visual
reference. The descriptions below carry the requirements even without that archive.

| Archive member | Bytes | SHA-256 |
| --- | --- | --- |
| `recovered image.png` | 267004 | `d67fdf00616cac2a84b93e1099ab59aa75583e18802968dd49db29c448030b62` |
| `failed to align.png` | 580820 | `074096a95337fe9b78cd1b5e4cc6069fc6fab05bbbe3fc1cb407d6d4bf30255b` |
| `crop 2.png` | 255200 | `753f4ad693874253085b60791d83e630765acb50e7f6d74c7363432f3c16b6c1` |
| `crop image.png` | 147501 | `dc2b07087ca3b488b354f08a74eae95b9e9876cd3bf70013a1372a61dd98a280` |

- `recovered image.png`: historical two-face page. It illustrates the duplicate
  filename, post-result Crop photo and Hold to compare controls to remove. Its old
  Generate placement is superseded by the latest written requirements.
- `crop image.png`: dark FaceMorph **Encode an image** confirmation modal. Logo at
  top right; proposed face crop preview; **Adjust Crop** below preview; Cancel at
  bottom left and OK at bottom right. OK confirms the crop and returns to face
  progress/cancellation in the main page. Use this as the confirmation layout.
- `crop 2.png`: dark **Crop your image** adjustment modal. Square adjustable bounds
  with corner/edge handles, eye/face-position guides, rotation control and angle,
  instructional text, Cancel and **Use Crop**. Use Crop updates the proposal and
  returns to confirmation; it does not independently start encoding. Cancel here
  returns to the previous proposal; Cancel at confirmation abandons the flow.
  Guides are overlays, not a mask burned into encoded pixels. Apply orientation,
  rotation and crop to source pixels once, using the frozen preprocessing policy.
- `failed to align.png`: old **Upload an image** modal, full-image preview, Crop
  action, **Unable to auto align face.** and guidance to use another image or
  manually crop with the whole face in frame. Retain the meaningful failure message
  and guidance; update the label to Encode an image and control to Adjust Crop.
  A warning cannot silently re-open crop or prevent an eligible confirmed crop's
  direct e4e path. Unsupported/malformed data still has an actionable terminal error.

No image in this archive depicts a multi-face selection grid or the fullscreen
names picker. Their written requirements and the named legacy production/names surfaces
control; do not describe an unseen screenshot as a supplied design. [face controls and modals](#face-controls-and-modals) produces
an actual reviewed multi-selection layout, including visible selection order.

## Autoresearch coverage and preservation map

The earlier plan retained many important optimizations, but did **not** explicitly
account for the complete research catalogue. This pass reviewed the current guides /
protocol / record standards, all 69 [ledger rows](../facemorph.me-classic/autoresearch/results.tsv),
six present candidate families, the closed 10 October round, historical device
summaries, all 25 v2 proposal entries, v3 loop design and relevant current browser /
photo / storage / media sources and mobile receipts. Ledger census: 14 keep,
41 inconclusive, 5 proposed, 3 discard, 2 blocked, 2 baseline and 2 candidate.
These are recorded verdicts, not 69 adopted features or fresh requalification.

| Evidence family / source | Disposition and preservation contract | Limits / meaningful existing coverage |
| --- | --- | --- |
| [Research guide](../facemorph.me-classic/autoresearch/README.md), [program](../facemorph.me-classic/autoresearch/program.md), [records](../facemorph.me-classic/autoresearch/records.md), ledger and [runner](../facemorph.me-classic/autoresearch/run.py) | Preserve append-only scoped outcomes, correctness-first evidence, paired claims, process cleanup, budgets and device leases. Re-home maintained consumers deliberately; the historical bytes move with the research tree and survive in classic only as Git history. | `run.py` is a bounded execution journal, not the proposed complete evaluator. Architecture acceptance alone is not a performance keep. |
| [Morph-frame pipeline](../facemorph.me-classic/autoresearch/candidates/morph-frame-pipeline-v1/README.md) | Retain integrated bounded GPU submit/readback overlap, windows, ordered delivery and fallback resumption. | Pipeline/numerical/cancellation/resource checks; historical eris runtime gains do not prove phone or complete-video gains. |
| [WGSL/direct engine](../facemorph.me-classic/autoresearch/candidates/wgsl-conv-v1/direct-v2.mjs), [performance history](../facemorph.me-classic/autoresearch/history/performance-through-2026-10-09/README.md) | Retain integrated desktop direct kernels, RGBA8 conversion/rounding and mobile ORT WebGPU compatibility. `manifest.webgl` coefficients also feed direct WebGPU: remove WebGL execution without removing these assets. | Numerical canaries, direct/mobile route and raw-frame checks. Preserve descriptor/content identities during any rename. |
| [OPFS shard cache](../facemorph.me-classic/autoresearch/candidates/opfs-shard-cache-v1/README.md), [shard store](../facemorph.me-classic/src/Next/Assets/shard-store.mjs), [model cache](../facemorph.me-classic/src/Next/Assets/model-cache.mjs) | Retain per-read platform SHA, exact-length buffers, unit corruption repair, URL-independent pinned reuse and migration without duplicate storage. Preserve Safari worker sync-handle support and Cache Storage fallback. | Integrity/corruption/quota/offline/cache checks; physical-phone OPFS speed/quota remains unqualified. |
| [Direct RGBA media](../facemorph.me-classic/autoresearch/candidates/direct-rgba-media-v1/README.md), [built-UI analysis](../facemorph.me-classic/autoresearch/candidates/direct-rgba-media-v1/built-ui-analysis.md), [10 October round](../facemorph.me-classic/autoresearch/reviews/2026-10-10/README.md) and [experiments](../facemorph.me-classic/autoresearch/reviews/2026-10-10/experiments.md) | Retain acknowledged raw transfer, direct display/video input, worker file preparation, sparse anchors/ordered drain, exact recovery integrity and prepared-file/repeat reuse. | Scoped CPU-runner repeat-use gains; broad face/photo/video gains inconclusive, first Save slower. Realtime encoder settings were discarded, not release recommendations. |
| [Compressed session](../facemorph.me-classic/autoresearch/candidates/compressed-session-v1/README.md), [11 October delivery](../facemorph.me-classic/docs/plans/feedback-delivery-2026-10-11.md) | Retain once-only background WebP with PNG fallback/read compatibility and bounded ordered face/video/scrub restore, integrity and quota handling. | Restore/export/resource checks. Contended component timings do not establish a speedup. |
| [Photo runtime](../facemorph.me-classic/photo-runtime/README.md), [actual Simulator photo run](../facemorph.me-classic/photo-runtime/evidence/sim-photo-927e4446-d5db-49aa-9d6e-b9dcc6d20204/report.json), [mobile guide](../facemorph.me-classic/tests/mobile/README.md), [runtime tests](../facemorph.me-classic/src/Next/browser/mobile-runtime.test.mjs) | Retain exact local preprocessing, EXIF/crop geometry, bounded unshared WASM, 108-shard FP32 e4e, constrained sequential worker teardown and CPU synthesis. Keep source photos local. | Actual streamed photo/reconstruction and mobile component receipts have scoped Simulator evidence, not universal physical-phone qualification. See phone contract below. |
| [Current media](../facemorph.me-classic/src/Next/media.mjs), [video worker](../facemorph.me-classic/src/Next/video-worker.mjs) | Retain WebCodecs 1024→512 and FFmpeg 512 fallback, eight-frame raw segments, bounded codec queues and stream-copy concatenation. Full output preserves all accepted frames at disclosed actual resolution. | Existing media/fallback/integrity/boundedness coverage; no universal 1024px MP4 or complete-phone-video performance claim. |
| [Native CUDA](../facemorph.me-classic/autoresearch/candidates/native-cuda-morph-v1/README.md) and portable/native history | Preserve historical/reference/classic evidence. Native application packaging is retired for this release, not research history or classic NVIDIA Compose. | No new native parity/build/update gate; no same-GPU browser-beats-native claim without the relevant measurement. |
| [v2 portfolio](../facemorph.me-classic/autoresearch/benchmark-campaign-v2/README.md), [25-entry plan](../facemorph.me-classic/autoresearch/benchmark-campaign-v2/plan.json), [contract](../facemorph.me-classic/autoresearch/benchmark-campaign-v2/contract.json) | Account for all 10 synthesis and 15 e4e proposals as historical proposals. They cover kernels/cooperative execution, residency/synchronization/workspace, CPU/JSEP/native routes, streaming/backbone/provider/layout, BN/head grouping, hybrid synthesis, private reuse and precision. | Later integration of a related mechanism does not retroactively execute/qualify an original proposal. All 22 unique historical source/portfolio references are absent at their recorded current-checkout paths; catalogue/hashes survive, underlying code/raw evidence is not all recovered. |
| [v3 design](../facemorph.me-classic/autoresearch/loop-v3-proposal.md), [historical September protocol](../facemorph.me-classic/autoresearch/history/program-through-2026-09.md), [quality policy](../facemorph.me-classic/autoresearch/reviews/2026-10-10/quality-policy.md), [next directions](../facemorph.me-classic/autoresearch/reviews/2026-10-10/next-directions.md) including R01/R02/R05 | Retain evaluator design, warm-hydration attribution, padded-photo profiling, streamed-e4e reuse and phone/FFmpeg/process-memory gaps as research backlog. | Proposed/blocked/inconclusive is not implemented release behavior. Preserve negative lessons: no silent fp16 e4e/tolerance widening, realtime WebCodecs, PNG sub-filtering, IDB durability tuning or abandoned integrity-marker assumptions. |

**Phone/iPhone preservation contract.** Carry forward the current
[runtime](../facemorph.me-classic/src/Next/browser/runtime.mjs),
[worker](../facemorph.me-classic/src/Next/browser/ort-worker.mjs) and
[route priors](../facemorph.me-classic/src/Next/browser/route-priors.mjs): probe an actual
adapter before GPU acquisition; `navigator.gpu` alone previously caused roughly
180 MiB of wasted Simulator downloads. Keep failure-only preference, independently
checked bounded CPU fallback, visible-time watchdogs while backgrounded and the
distinction between worker startup failure and a failed inference route. Do not
poison every provider choice because a worker never started. Preserve bounded
acquisition/read-ahead and exact cache verification/repair.

On constrained devices terminate alignment/encoder workers before the next heavy
phase: releasing an ONNX session does not shrink its WASM heap. Retain encoder
residency only under the qualified desktop memory policy; absent iOS memory hints
do not justify keeping a gigabyte resident. Encoder admission is independent of
synthesis support. The [pinned overlay](../facemorph.me-classic/hosting/next-static/runtime-overlay/manifest.json)
has `encoderStream.phoneAdmitted:true`, a 268,435,456-byte e4e WASM limit and pinned
mobile fused-resample kernel. Its scope is `friends-and-family-candidate`, with
`ios-simulator` evidence, `physicalPerformanceQualified:false` and
`releaseQualified:false`. Preserve these useful trials at that scope; neither remove
them nor promote them to full phone certification.

The [latest product](../facemorph.me-classic/docs/review/feedback-fixes-2026-10-11/ios-product.json),
[component](../facemorph.me-classic/docs/review/feedback-fixes-2026-10-11/ios-components.json) and
[mobile identity](../facemorph.me-classic/docs/review/feedback-fixes-2026-10-11/mobile-build-identity.json)
receipts support Simulator CPU face/crop/component behavior. They share source /
content-build identity with promoted source `001ba853…` but differ in application
bytes, so they do not attest complete physical-phone photo/video/restore performance
or exact promoted mobile bytes. The photo-runtime README also retains an older
expensive per-device encoder check; the later 21 September direction in current
worker source moves it to labs/CI. Preserve quick product admission and full lab
numerical checks separately; do not reinstate the 20s+ guard on ordinary startup.

During execution, each bead that moves an integrated path keeps its tests, or lists their replacement in
`tests/retired.txt` (retained, deliberately replaced, historical, proposal, rejected or evidence
unavailable). This accounts for the known families
and catalogue; it does not claim every missing historical raw report was recovered
or every hypothesis deserves adoption. Missing receipts constrain claims. Use existing
relevant checks to preserve real paths; this is not a new every-experiment benchmark
campaign or automatic physical-phone cutover veto.

### Targeted autoresearch launch and preserved history

Research is moving into this repository (see [end state](#end-state-of-the-repositories)
and [autoresearch re-homing](#autoresearch-re-homing)). Until that workstream lands,
the only executable research checkout is **`../facemorph.me-classic/`**; this new
repo still has no application/research commands, and the commands below run there.
Do not start new rounds against the old candidate in classic: further rounds target the
new application and packages once they build. Start with classic's [guide](../facemorph.me-classic/autoresearch/README.md),
[protocol](../facemorph.me-classic/autoresearch/program.md), [record standards](../facemorph.me-classic/autoresearch/records.md),
[round template](../facemorph.me-classic/autoresearch/templates/round.md) and
[append-only entry template](../facemorph.me-classic/autoresearch/templates/log-entry.md).
Some current guides still call that checkout facemorph.me or require browser/native
rotation; this active plan governs release scope. Local classic `PLAN.md` is a
symlink to this plan; verify equivalent links in published/remote documentation. Native
experiments/history remain available in classic, separate from required browser
CPU/WebGPU/mobile release work. Verify actual remote paths, worker dependencies and
adapters rather than assuming historical eris paths or Triton readiness are current.
Re-homing is its own named workstream, not a by-product of source migration; it
publishes one clearly named command entry point with the new app/package paths.

For any optimization request, create a dated research round with a named journey /
bottleneck, exclusions, one falsifiable mechanism per candidate, and an explicit
resource/time budget. Use a new candidate directory; never overwrite measured source
or reinterpret a historical report as the current baseline. Its launch recipe must
state the executable checkout/worker, dependency and artifact readiness checks,
exact command/arguments, shared device identity and absolute lease-state directory,
fixtures, browser profile handling and durable output locations. Existing command
wrapper shape, run **on the actual worker** from its confirmed executable checkout:

```sh
python3 autoresearch/run.py --lane browser-gpu --device eris \
  --state-dir autoresearch/state --timeout 1800 -- \
  autoresearch/devices/eris/gpu-bench.sh "UNIQUE_RUN_LABEL" "QUALIFIED_ORIGIN" 6
```

`UNIQUE_RUN_LABEL` and `QUALIFIED_ORIGIN` are placeholders to replace in the round's
copyable launch recipe. This existing GPU screen is not the new chooser-overlap
benchmark. Choose the actual driver/lane for the claim. Use a fresh simple run label
(`A–Z`, `a–z`, digits, `_`/`-`) with no existing output directory, and quote actual
path/origin arguments in the finalized recipe. Do not reuse a label and overwrite
this driver's earlier logs. The planned evaluator/adapters below do not exist merely
because this command wrapper exists. The relative state
path above resolves in classic; all cooperating builds/CI/local runs on that worker
must use that same resolved directory, including after source migration. Do not run a
remote benchmark under only a local workstation lease, or nest a second lease for
the same machine. Default runner budget is 600s, maximum 3600s; busy exits 75 unless
a bounded `--wait` is chosen. The runner journals execution and owned process cleanup,
not statistical validity, qualification or an automatic experiment queue.

Acquire the shared physical-device lease **before every heavy build, correctness
run, warmup and measurement**. The classic protocol's numbered validation-before-
lease order is not permission to run expensive checks without it. Bounded separate
leased runs are acceptable; applicable numerical/resource correctness still passes
before performance acceptance. Freeze control/candidate source and exact artifacts,
model/runtime/reference/fixture/harness identities, actual route/browser/device,
cache/network/visibility states, observable finish boundaries and decision rules.
Inspect interrupted runs and other load before starting; never terminate another
owner's work to make a quiet trial. Separate empty cache, cached files/new browser,
live resident session, cached output and restored result cohorts.

First collect compatible control/control noise where missing, then freeze margins,
sample/confirmation rules and stopping decisions before observing candidate benefit.
Use discarded warmup and same-cell ABBA ×3 as the existing initial paired design;
additional independent browser starts/rebuilds are chosen from observed variability
and the declared budget. Keep fresh confirmation samples separate from repeated
candidate screening. Record every screened candidate and attempted confirmation;
do not select only the fastest run, stop on the first favorable sample or repeatedly
retune a claimed holdout. A full supported suite remains necessary for its numerical
claim; bounded screening does not replace applicable full31 or product coverage.
Other required platform cells run through retained CI/appropriate workers at their
defined roles, not through an indiscriminate whole-matrix rerun for each small idea.

Initial targeted campaigns for the new behavior:

| Target | Fixed cases / hypothesis | Protected boundaries and source limits |
| --- | --- | --- |
| Consented acquisition during input selection | Empty/partial cache; Generate versus explicitly approved Generate and encode; fixed selection/crop dwell; a seed request while encoder assets transfer | Consent→first useful face and photo selection→reconstruction/file-ready totals; stage overlap, actual bytes, foreground responsiveness, Cancel and route failure. Synthesis-first ordering already exists, but current prefetch pauses for foreground work; broader overlap is new. |
| Verified-cache runtime warming | Cached files/new browser versus already resident session; eager selected-generator preparation versus demand load; immediate next-face request; missing/corrupt shard and memory-constrained cases | Reload→first/nth new face, CPU/GPU mapping/load/readback, peak live reservations, foreground wait, zero speculative network and recovery without inference. Cache-only prefetch currently creates no session; eager hydration is a hypothesis to qualify. |
| Photo preparation and e4e lifecycle | Padded/nonpadded metadata-free photos; first/next encode; constrained phone teardown versus qualified desktop reuse | Source→confirmed→reconstructed photo, per-shard verified-local read/create/run/copy/teardown, memory/bytes and cancellation. Reuse existing warm-hydration/padded-photo/streamed-e4e findings without reviving rejected precision changes. |

Measure each system-imposed wait and the full useful choosing/generation/export
journey beside stage costs; account for overlap on a timeline, not by adding times.
Freeze automated selection/crop dwell and label it synthetic. The existing built-UI
paired driver auto-accepts consent and supplies files programmatically, so a new
versioned adapter must model the explicit bundle grant, ownership/request/attempt
IDs and approved transfer timeline before claiming chooser overlap. Natural-user /
OS-picker observations are separate evidence. Record decoded/drawn face, useful scrub
frame, playable video, prepared file and Save/share handoff distinctly; `img.src`
alone is not a rendered finish, and share-sheet handoff is not recipient delivery.
Keep synthesis numerical fidelity separate from compression quality as specified above.

**Historical preservation:** retain all experiment directories, recipes, frozen
reports, dated history, round logs and original ledger rows with their original
semantics. New dated rounds may edit proposals/summaries, while their `log.md` entries
append at EOF with unique IDs and timezone-aware timestamps. `results.tsv` retains
its existing 11-column header and appends evaluated outcomes only; corrections get
new rows referencing prior IDs. Never initialize it to an empty new header, normalize
old cells, rewrite failed experiments, or enter unrun proposals as outcomes. Keep
timeout/crash/interruption/partial evidence with its limitations and actual run IDs.
`state/runs.jsonl` is the separate ignored append-only execution journal; retain
durable experiment evidence outside transient CI artifacts, with private/raw local-
only or unavailable records labelled honestly. No missing old receipt is fabricated.

Import/re-home maintained research with a source→destination provenance map and
history/ledger-prefix integrity checks. After the declared handover point the one
canonical active ledger and journal live in this repository's `autoresearch/`, and classic's
copy survives only in its Git history at the recorded snapshot commit; do not silently fork two
writable histories. Historical native evidence stays historical,
and existing experiments remain distinct from new web-only candidates. A `keep`,
integration commit and qualified deployment receipt are separate recorded facts.

**Opportunity reporting:** when development or a run reveals a possible faster
path, record it as a proposal in the round's experiment specification and append a
decision/event entry; summarize it for the operator/planner in that work's progress
or final report. Include exact source/artifact, affected wait/journey/cache/device,
measured bottleneck or hypothesis, mechanism, consent/asset/memory/cancellation costs,
preserved invariants, necessary platform cells, suitable worker and next refuting test.
Proceed within already authorized scope where appropriate; do not silently change
product policy or numerical tolerances, claim an unmeasured gain, add visitor UI or
upload new telemetry to communicate engineering ideas. Creating a proposal is not
an evaluated ledger result or a new Beads execution authorization.

#### External methodology check — 12 October 2026

Primary public sources were inspected for this pass; their transferable practices
inform the launch/measurement contract above, not a wholesale workflow replacement:

| Source | Applied lesson / boundary |
| --- | --- |
| [Karpathy autoresearch protocol](https://github.com/karpathy/autoresearch/blob/master/program.md) | Explicit editable scope, fixed evaluation and bounded experiments with baseline/outcome records. FaceMorph retains its stricter append-only durable ledger and shared-checkout rules; do not import resets, empty-ledger initialization, unbounded looping, crash-as-zero metrics or training-only startup exclusions. |
| [Kalibera/Jones, Rigorous Benchmarking in Reasonable Time](https://kar.kent.ac.uk/33611/45/p63-kaliber.pdf) | Measure variability at the relevant execution/build levels and report effect uncertainty; spend repetitions where uncertainty warrants them, within a declared budget. A noisy minimum is not a repeatable gain. |
| [Reusable holdout / adaptive-analysis research](https://research.google/blog/the-reusable-holdout-preserving-validity-in-adaptive-data-analysis/) | Repeatedly selecting ideas against the same observations can create false discoveries. Fresh predefined confirmation is the practical FaceMorph safeguard; no claim to implement the paper's specialized holdout algorithm. |
| [ONNX Runtime Web performance guidance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html) | Profile the actual provider/model and transfer/session costs, distinguish worker responsiveness from inference speed, and qualify memory/lifetime tradeoffs. Optional graph capture or GPU residency are model-specific hypotheses, not automatic wins or permission to change model precision. |

## Platform CI retention and performance preservation

First-class phone support includes maintained product journeys, responsive layout,
runtime/resource paths and CI, not simply a view/save fallback. Carry forward the
existing workflow lanes below, their protected behavior, trigger/path coverage,
required-check roles and retained evidence. Native-package retirement does not
retire desktop-browser, mobile or hardware-GPU checks. Adapt paths, artifact lookup,
worker discovery and source assertions for `apps/web` and all four packages; retain
classic's publisher until the explicit source handover. Required statuses and
branch-protection bindings are inventoried, not inferred from a workflow filename.

| Existing workflow/jobs | Actual platform/browser/provider and retained scope | Role / evidence limits |
| --- | --- | --- |
| [next-site.yml](../facemorph.me-classic/.github/workflows/next-site.yml): artifact, qualify, compiled-ui, deploy | Ubuntu artifact build/unit/import/geometry/integrity and `check-no-third-party.mjs`; exact CPU product qualification; Chromium compiled UI; qualified-artifact preview deployment/live-byte checks | Keep the ordinary candidate-push deployment cadence and exact artifact/catalogue/runtime contract. Source/domain handover remains operator-controlled; routine previews remain CI-driven. |
| [next-e2e.yml](../facemorph.me-classic/.github/workflows/next-e2e.yml): real-ui-cpu | Ubuntu 24.04 Google Chrome: actual CPU name/seed and e4e, crop, original reuse, recovered still without inference, GPU refusal/fallback scope, playable/saved MP4 and face/video/slider restore | Exact-artifact promotion qualification; retain real-model events and final file/readiness/resource checks, not mock substitutes. |
| [next-matrix.yml](../facemorph.me-classic/.github/workflows/next-matrix.yml): engines, summary | CPU product journeys on Ubuntu 24.04 Chromium/Firefox/WebKit and macOS 14 WebKit/Firefox | Existing manual deployed-origin matrix with pinned runtime/stage reports. macOS Playwright WebKit is not a Safari certification; Linux WebKit is not iOS. Keep cells and repair harnesses; definition is not a passing result. |
| [mobile-browser.yml](../facemorph.me-classic/.github/workflows/mobile-browser.yml): android | Android Chrome, API35 x86_64 Pixel6 emulator profile/SwiftShader on Ubuntu24.04 | Eight mandatory cache/worker/integrity/PNG/reload/portrait-EXIF-crop components. No synthesis/e4e in this component lane; preserve its scoped push/PR/manual runs. |
| Same: ios | Safari in iOS Simulator on macOS15 | Same eight components, not physical-iPhone evidence or complete photo/video qualification. README's older seven-check description is superseded by actual required cases. |
| Same: ios-product-artifact, ios-product-simulator | Ubuntu22.04 artifact build, macOS15 iPhone16Pro Simulator product CPU face/acquisition/admission/rendered bounds/resource checks | Retain actual product lane separately from components. Current build shares source but differs from promoted bytes; prefer canonical-artifact reuse during migration and record any unavoidable rebuild. |
| [next-gpu-lane.yml](../facemorph.me-classic/.github/workflows/next-gpu-lane.yml): webgpu-benchmark | Self-hosted TrueNAS `gpu-vulkan`, GTX1050, pinned Chrome for Testing 141.0.7390.54, actual WebGPU | Scheduled/manual/path-triggered evidence, deliberately not a promotion gate. Reject software adapters and name adapter failures; an installed GPU/runner label is not inference evidence. |

12 October GitHub read-only inspection confirms successful current-source site and
mobile runs named in the comparison above. The latest recorded manual desktop
matrix [run 37555426933](https://github.com/check-face/facemorph.me-classic/actions/runs/37555426933)
failed on 7 October; recent GPU evidence failed adapter admission. Do not advertise
all cells as currently passing. There is no dedicated Windows **web-browser** job in
this existing matrix: historical Windows browser receipts and native packaging are
different evidence. Retire native packaging jobs while re-homing any shared browser /
artifact/media checks they supplied. Do not invent a new Windows or physical-phone
qualification claim from their removal.

`scripts/next-matrix.mjs` still targets older bulk Generate/post-result Crop controls
and uploads a previously saved result for `photoE4e`. Recovery-bearing files can now
bypass e4e, so that fixture cannot establish actual photo encoding. Migrate selectors
to the declared product/tester controls and use an independent metadata-free photo
with actual encoder-event checks. Preserve stage coverage and label unavailable
H.264/project controls incomplete/not shipped, never fabricated passes. This is
repair of a stale check, not permission to remove the browser cell.

### Retained performance evidence and no-regression checks

These are useful achieved results, not a uniform current-product timing matrix.
Keep exact workload/cache/provider/timing boundaries when comparing; no new benchmark
was run by this pass. Historical values must not become arbitrary absolute limits
on a different browser, GPU, artifact, codec resolution or photo flow.

| Device / scope | Achieved evidence to retain | Claim boundary |
| --- | --- | --- |
| Linux eris RTX2080 SUPER, Chromium152 WebGPU, warm runtime, ordinary 26-frame morph, paired ABBA×4 | Pipeline 129.8→69.7 ms/frame; later RGBA8 pair 42.6→37.1 ms/frame and warm face 103.5→75.6 ms | [Ledger](../facemorph.me-classic/autoresearch/results.tsv) / [history](../facemorph.me-classic/autoresearch/history/performance-through-2026-10-09/README.md); worker/runtime boundary, not full displayed/video journey. |
| Same eris GPU, retained models/new browser, paired OPFS ABBA×4 | Model loaded 1430→640 ms, first qualification synthesis 1685→859 ms, prepared-photo encode+reconstruct 17627→12093 ms | [OPFS evidence](../facemorph.me-classic/autoresearch/candidates/opfs-shard-cache-v1/README.md); excludes upload/alignment/UI. Later pairs were contended and limit confidence in the historical keep; do not invent a new separate verdict. |
| eris live `b322a26`, empty isolated profile, one built-UI observation | First face 8751 ms; continued faces 190.4/193.3/207.5 ms; post-reload different face 2662.4 ms; 32-frame playable video 1834.8 ms | [Live report](../facemorph.me-classic/autoresearch/reviews/2026-10-10/live-eris.json); automation ran seven canaries, not ordinary visitor admission or a paired speed claim. |
| Ubuntu24.04 Chrome155 CPU, e0/bce exact builds, retained/reopened profiles, ABBA×3 | Repeat original 113.00→88.76 ms; repeat Save 100.72→66.49 ms. First Save 108.63→202.17 ms while 4.38 MB→117 KB. Video 113043→113404 ms | [Built-UI pair](../facemorph.me-classic/autoresearch/candidates/direct-rgba-media-v1/built-ui-analysis.md); preserve repeat reuse and acknowledge first-Save size/latency tradeoff, no broad new face/photo/video speedup. |
| Mac ARM64 browser WebGPU, historical Chrome/Brave151 1024 FP32 sequence | About 254–300 ms/face, ledger v9 277.9 ms | Historical full31 evidence; not same-build current startup/photo/video or a paired migration result. |
| Mac ARM64 browser CPU, historical WASM | CPU4 observations 25.7 s/face and a separate 22.9 s/two faces; CPU1 v9 three-case screen 43.91 s | Incompatible revisions/workloads, not a speedup series. Retain working CPU/thread support; history/ledger above. |
| Windows x86_64 Chrome153 WebGPU, historical fixed suite | 96.7 ms/face full31; MP4 encoding 2.6 s/26 chunks | GPU identity/current startup/photo totals missing; browser evidence is separate from retired native packaging. |
| Physical S24 Ultra Brave WebGPU ORT1.22 bounded-padding kernel | Full31 median 616.35 ms single, 682.39 ms/sequence face; historical CPU4 2582 ms, CPU1 5911 ms | [v2 evidence](../facemorph.me-classic/autoresearch/benchmark-campaign-v2/README.md) / history; different providers/revisions, not current full-photo/video latency or a paired provider speedup. |
| Historical Android10 handset Chrome152 | CPU4 2300–2400 ms/face passed; CPU1 stalled and tiled GPU failed correctness | Retain proven CPU route/failure recovery; failed GPU timings never qualify support. Current emulator components execute no model. |
| iPhone16Pro Simulator, macOS15/Safari iOS18.5, current CPU product screen | First full1024 face 25287 ms; recorded warm synthesis 4741.2 ms | [Product receipt](../facemorph.me-classic/docs/review/feedback-fixes-2026-10-11/ios-product.json); partial cache/acquisition, not paired clean cold/warm or physical-iPhone speed. |
| Historical iOS27 Simulator photo candidate | Actual streamed e4e 32.5–41.8 s; one full photo/reconstruction 71.1 s | [Photo evidence](../facemorph.me-classic/photo-runtime/README.md); historical reconstruction used WebGL. Preserve memory/photo mechanisms, not automatic qualification of the new CPU reconstruction path. |
| Physical iPhones; current Firefox/WebKit full performance; GTX1050 inference | No complete current qualified performance cell found | Since 24 October the physical iPhone is a gate cell (paired against the candidate through `safaridriver`); Simulator speed cannot stand in for it. Desktop workflow presence and GPU adapter failure are not timing passes. |

For architecture/provider/UI/build changes, use the pinned candidate artifact or an
explicitly qualified rebuild as control and the same available cell/workload for the
migration candidate. Record actual provider/model/runtime, resolution/FPS/frame count,
cold/retained/resident/restored state, visible-tab state and the same finish boundary.
Protect first/nth face, confirmed-photo work, complete video, first/repeated Save,
restore, responsiveness, acquired/output bytes, memory reservations and cancellation.
Use existing relevant component and built-product screens in CI; bounded full suites /
paired comparisons can run scheduled/manually on suitable workers. Collect comparable
evidence across retained cells as available; unsupported/untested/inconclusive is not
PASS and missing physical-iPhone evidence does not remove its product paths.

Correctness/resource regressions fail their applicable checks. Investigate a meaningful
latency/bytes regression with compatible repeated evidence and a declared margin from
control variability; a noisy single hosted-CI timing is not an automatic speed verdict.
Apply the [synthesis/export boundary](#synthesis-correctness-and-export-quality):
raw network output keeps the small frozen numerical tolerances; different image
compression or encoded bytes do not fail preservation. Output byte counts measure
size/cost, not image identity.
Do not compensate for slower phone CPU by citing desktop GPU gains, or compare 512px
video to 1024px as a free speedup. Deliberate consent/output tradeoffs are recorded in
the requirements ledger. No release-wide no-regression claim is made until the
appropriate comparisons exist; operator API retirement remains a separate decision.

Explicit source invariants beyond the broad preservation requirement:

- Preserve content/provider/canary-set keyed synthesis admission receipts. A genuinely
  cold ordinary visitor runs one canary before the first face; remaining canaries run
  one at a time behind foreground work and resume safely. Compatible fully qualified
  warm receipts skip repeated canaries. Full CI/`fullQualify` still runs all checks.
- Preserve `ort-worker.mjs` `warmMapping()` overlap with loading in both direct and
  ORT WebGPU, including eligible mobile GPU paths. CPU loading stays sequential;
  constrained encoder→generator phases retain their separate worker-lifetime policy.
  CPU synthesis uses bounded 1–4 threads when
  isolation/cores allow; streamed e4e stays bounded, unshared and single-threaded.
- Preserve the dedicated cache-only worker, digest reuse and bounded supersession /
  termination where a shared runtime needs it; warm output hits need no inference.
  Current prefetch stops for foreground work and does not hydrate sessions. The new
  [download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming)
  permits independently budgeted approved acquisition alongside input/foreground
  work and verified-cache warming. Record these scheduling changes and cold/repeat
  costs rather than claiming the candidate already performs them.
- Preserve explained Firefox storage permission timing, exact pinned/self-hosted
  runtime dependencies and the named no-third-party gate alongside actual photo /
  fallback/cleanup checks. Do not replace them with mock inference or preview reuse.

### Strictly not worse than the candidate (operator, 24 October 2026)

The operator's requirement: the new app must be strictly no worse than the current next.facemorph.me candidate
in performance and in the ordinary experience, iPhone included. The candidate "works and we do get faces"; that
is the floor. The declared UI changes may change a journey's shape, but they must not make the same work slower,
less reliable or heavier. This is a release gate: promotion of the monorepo build (handover of next.facemorph.me
and promotion to facemorph.me) does not happen while a regression stands. It replaces the earlier wording that no
control/control performance report and no physical-iPhone pass were required.

**Control and candidate.** The control is the pinned candidate artifact (by hash, from candidate import). The
candidate under test is the monorepo release artifact. Both run the same workload on the same device, browser,
provider and cache state, in paired alternating order (ABBA), with enough pairs for the comparison to be stable
(at least 5 pairs per cell; more where the control's own spread is wide).

**What is compared, per cell** (each at the same finish boundary for both builds):
- time to a usable page; cold first face (empty cache, including model download) and warm face; the next face;
- confirmed-photo encode, where photo encoding is admitted on that device;
- a complete morph: time to playable video and time per frame;
- first and repeated Save;
- responsiveness while working (long tasks and input delay);
- bytes downloaded on first visit and on a return visit;
- peak memory where the platform reports it;
- reliability: every run that produced a face, photo or video on the control must produce it on the new build.
  No new crashes, tab reloads, out-of-memory kills or fallbacks.

**Pass rule.** Reliability must be equal or better: no new failure in any paired run. For each timing, byte and
memory measure, the new build fails if it is slower or heavier than the control beyond the control's own
run-to-run noise. Concretely, it fails when the 95% interval of the paired new/control ratio lies entirely above
1 plus the noise margin measured from control/control pairs on that cell. A cell that cannot run, or that is
inconclusive, is reported as untested and blocks the gate for that platform class until it runs. It never counts
as passing. A deliberate trade recorded in this plan (for example a larger first Save in exchange for reuse)
names its measure and is the only allowed exception. Gains on one device never offset a loss on another.

**Cells.**
- **iPhone:** Safari in the iOS Simulator (the existing CI lane, now paired against the control), and a physical
  iPhone. The physical device runs the same paired workload automatically through `safaridriver` on the Mac it is
  connected to, as a scheduled lane under the device lease. The device is setup, not an approval step; if none is
  connected, the iPhone gate is untested and blocks.
- **Android:** the emulator lane, plus the physical phone in `tools/device-lab/android` (Huawei P30 Pro, Android 10,
  current Chrome; a human-free loop that pauses and restores the phone's Frigate camera role) on every gate run.
- **Desktop:** WebGPU on eris (RTX 2080 SUPER) and on the Mac, and CPU in CI.

**After release, from real visitors.** The [changeover statistics](#changeover-statistics-in-grafana) record
anonymous timings by platform class (iPhone, Android, desktop) and route. They compare the candidate's last weeks
with the new build's first weeks. A median regression beyond noise on any platform class is treated like a failed
gate: it is investigated and fixed, and rollback to the control artifact stays available until the comparison is
clean.

**Owners.** Integrated verification runs the gate and writes it into the release summary. Workspace build carries
the paired lanes, and autoresearch re-homing supplies the existing paired ABBA harness and the device lease.

### Development workers and GitHub-minute use

Use available capable workers for iteration, builds, component/numerical/media checks
and paired measurements to reduce hosted GitHub minutes. Keep GitHub orchestration,
required release gates, exact-artifact provenance and all platform cases. Inventory
current access, dependencies, actual adapters and capacity before scheduling:

- [eris](../facemorph.me-classic/autoresearch/devices/eris/README.md): RTX2080 SUPER,
  isolated Chromium/profile/CDP recipes and SSH paths. Its documented Fable setup
  lacks .NET; consume the qualified artifact (the new repository builds no F#, so
  eris needs no .NET). Future TS builds still need checked Node/dependency/build compatibility.
  Checked 15 October 2026 on the workstation itself (hostname `eris`): RTX 2080 SUPER,
  12 cores, 31 GB RAM, Docker 29.7.2 with NVIDIA CDI devices and `nvidia-ctk`, Node
  26.8.2 (CI pins Node 22), no usable .NET SDK, no `wrangler`, and `br` only through a
  borrowed binary. It is therefore a candidate GPU host for
  [classic distribution](#classic-distribution) acceptance; the Compose GPU entry must be
  shown to work with its CDI runtime, not assumed.
- TrueNAS: existing self-hosted `truenas,gpu-vulkan` GTX1050 lane. The older host
  `gpu-gtx1050` configuration can use llvmpipe because the NVIDIA Vulkan ICD is absent;
  validate the real adapter before a hardware claim.
- Triton: GTX1080 was documented as a possible worker in the dated
  [device lab](../facemorph.me-classic/docs/local-device-lab.md). Current readiness /
  runner registration is not established by that file. Inventory and use it, and other
  capable workers, when available. Retiring **Triton inference hosting** does not
  retire the machine or prohibit build/research work. Old physical-phone gate text in
  that lab is superseded by the current operator delivery policy.

All heavy local builds, self-hosted CI and benchmarks on one physical machine use
the same `autoresearch/run.py --device <name>` lease identity/state directory. Different
machines may run concurrently. Preserve bounded execution, busy/conflict handling,
owned process-group cleanup and raw receipts; exit zero is execution, not qualification.
The current GPU workflow's own concurrency group does not coordinate with local
agents, so wrap its heavy command in the shared device lease when migrating it.

Build one canonical artifact and fan its exact bytes out to platform consumers where
practical, including iOS product CI; the current separate iOS rebuild is a cost and
identity limitation, not a desired invariant. Retain hosted macOS/iOS jobs when they
provide otherwise unavailable environments. Cache pinned dependencies/immutable
runtime assets by identity, cancel superseded test builds, and cover every new code
root in path filters. Keep preview-deploy serialization/qualified-artifact checks;
never cancel a live publication halfway through to save minutes. Experimental jobs
remain bounded and separate from product checks. Worker acceleration does not weaken
a required check or substitute Linux WebKit for Safari/iOS.

## Contracts and evidence retained from the earlier planning pass

The application owns interaction, consent, input revisions, display URLs, session
selection, slider preference and reporting transport. The manager owns model I/O
and loaded handles; engine owns compute/pipeline resources. Split mixed modules
such as `media.mjs` and `last-result.mjs` instead of moving UI policy into packages.
Cache retention remains bounded and compatible; source photos/typed inputs stay
tab-only; diagnostics contain no raw photos/latents/seeds or durable hardware IDs.
The existing random consent-scoped grouping ID is cleared when reporting is disabled,
as specified by the [debug control](#debug-reporting-control-and-consent).

Operations carry opaque request/input-revision/attempt IDs and actual providers.
Signals/callbacks/promises remain on the caller side; worker payloads are cloneable.
Separate available pixels, file readiness, persistence, decoded display and playable
video. Cancellation/disposal settles pending operations and late results cannot
replace newer input. Define buffer/device ownership and numeric transient-byte
bounds. Sparse preview anchors cannot deadlock ordered video drain. Cover existing
cache/raw/blob/sequential/retained-then-encode browser branches and endpoint reuse.

### Shared resource and release-version contracts

[package and operation contracts](#package-and-operation-contracts) gives one application scheduler authority over competing photo encodes, face
synthesis and morph production. Per-slot queues alone cannot bound aggregate GPU /
WASM/model memory. Initially admit one heavyweight operation at a time per shared
provider context, retaining bounded internal frame pipelining and already qualified
warm reuse. Admission includes manager/provider runtime initialization, model/session
loading and real-model numerical admission work, not only the final inference call.
Separate the compute permit from residency reservations for loaded sessions, shard
buffers, WASM heaps and GPU allocations; verified disk-cache leases are distinct
from live-memory reservations. Idle warm resources continue to count until actual
release/worker termination. Reserve before allocating and account for the encoder-to-
generator transition, preserving the candidate's qualified retention policy.
Completing inference does not imply that its runtime memory was reclaimed.
Downloads, image preparation and file encoding use their own explicit
budgets; no speculative warmup may evict a foreground job's live resources. Allow
additional concurrency only with measured aggregate memory and cancellation evidence.
Apply the [download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming)
to priority, bounded cancellation, ownership transfer and independent acquisition
buffers; download overlap alone cannot justify two hydrated heavy runtimes.
Waiting jobs must acquire budgets without holding resources needed by the active job.
Browser adapters report unavailable/busy capabilities through the same
contract. [morph pipeline](#morph-pipeline) verifies competing intents, disposal and no starvation/deadlock.
Include competing provider-load requests and an idle retained encoder while
generator loading is requested. Resource admission must wait or settle without
exceeding declared reservations; check both constrained teardown and qualified
warm reuse.

Treat Morph as a parent intent, not an extra heavyweight lease while waiting for
its own prerequisite face jobs. Dependencies are admitted once; join an existing
operation for the same slot/revision rather than enqueueing duplicate inference.
Release/yield compute admission before awaiting dependencies or download consent.
When ready, request the frame-production lease through the same scheduler. Distinct
photo-encoder and CPU/WebGPU generator capabilities remain explicit; synthesis
eligibility does not imply encoder admission. Parent Cancel stops work owned solely by that parent, detaches from
independently requested face jobs and leaves their completed results available. Failed
or cancelled required inputs settle the waiting parent with a specific recovery action;
no permanently disabled Morph or waiting promise remains. Check photo → queued Morph,
Morph auto-generation → explicit face request, capability loss while queued and Cancel
at each dependency boundary. Existing bounded internal pipeline parallelism remains.
Join the dependency's compute-ready milestone rather than its default-file completion
when the frame pipeline can consume that verified input. Delayed/failed face-file
preparation must not duplicate inference or unnecessarily block ready Morph inputs.

Before Morph-owned acquisition/inference, estimate frame/slot budgets from the
selected count, current geometry/settings and actual output shape. Independently
requested photo encoding need not wait for a future morph to fit its frame budget.
Use the existing 4,096-frame path limit (`video-worker.mjs`, `last-result.mjs`) unless separately qualified; a legal photo
selection can still require reducing morph length before Morph. Do not truncate
selected faces to force a fit. Batch pixel limits and frame limits have separate
messages within existing actions; neither introduces a new settings screen.

The 120 × 1024²-pixel source limit can represent 480 MiB for just one RGBA buffer,
before decoder, canvas, crop and encoder copies. A compressed-file limit and a
one-at-a-time e4e queue are insufficient memory admission. [package and operation contracts](#package-and-operation-contracts) specifies aggregate
live-byte ceilings from the actual decode pipeline and a declared device policy;
[confirmed-crop encoding](#confirmed-crop-encoding) checks at/over those bounds before duplicate large allocations. Decode to a
bounded working representation where supported while preserving the confirmed
coordinate policy; otherwise report an actionable size limitation. This is an
implementation contract to qualify, not a claim of browser RSS control.

[workspace build and artifact identity](#workspace-build-and-artifact-identity)/[model manager extraction](#model-manager-extraction)/[model hosting extraction](#model-hosting-extraction) preserve a release-consistent app/runtime/model/catalogue set.
An in-flight app uses one immutable manifest identity; publishing a new app cannot
silently switch its shard identities or preprocessors mid-operation. Stage immutable
referenced assets before the app that uses them, preserve referenced assets for the
supported active-session/rollback window, and garbage-collect only by a documented
retention policy. [domain handover and retirement preparation](#domain-handover-and-retirement-preparation)'s delivery inventory names that window and its storage cost.
Test an old open tab while a new app/manifest is published, interrupted acquisition,
mixed/incompatible catalogue assets and ordinary rollback. Missing old assets yield
a clear reload/recovery action, not an unbounded fetch or silent identity change.
Model-cache eviction must never delete completed user exports or application
recovery records as collateral cleanup. No new service worker/offline-install promise
is introduced: offline behavior is limited to the available app/runtime/assets and
compatible retained files, and is reported per journey.

Keep `autoresearch/run.py` for budgets, process cleanup and physical-device leases.
One evaluator wraps existing numerical/component/built-UI harnesses, with normalized
execution, validity, correctness, non-regression, paired-benefit and architecture
verdicts. Generic `passed` or exit zero is not product or release qualification.
Frozen historical scripts/reports retain their bytes; new campaign code is versioned.

Freeze workload, timing boundary, source/artifact/runtime/model/fixture/evaluator
digests, provider, device/browser, cache state, network, warmup/order and regression
decision rules before candidates. First visit, retained-model new generation,
continued session, restored/replayed output and first/repeated Save are separate for research claims;
this does not require a historic service comparison before operator cutover.
Principal useful journey remains navigation/photo selection to decoded playable and
save-ready video, with first-face, responsiveness, scrub, recovery, bytes and memory
beside it. Metadata-free photos must execute the actual encoder.

Use the current fixed 32-frame/16 FPS/1024px workload where supported; an explicit
different-resolution/provider cell is not a comparable replacement. Controlled
initial comparisons use discarded warmup and ABBA ×3, raw distributions and paired
effects. Cold profiles are empty; baseline warmup uses separate profiles. Declare
the statistical method, sample/confirmation rule, invalid-pair handling and
practical margins from control/control evidence before candidate observation.
Correctness failure rejects; missing supported evidence is inconclusive. Expected
failure tests can pass cleanup/correctness without becoming generation timings.

Architecture/parity acceptance without faster timings is not a performance `keep`
under existing research policy. Preserve available desktop and Simulator/mobile
evidence and bounded physical-device trials at their recorded scope. Supported phone
paths are not removed; Simulator success is not universal physical-iPhone qualification.
Native exploratory evidence stays historical/classic, without a native-release gate.
All heavy builds/runs share their device lease; preserve original ledger rows and
append scoped outcomes/corrections. Retrievable reports and exact-artifact/live-byte
receipts distinguish measured, implemented and deployed state.

## Implementation approach and sequencing

This section explains how the architecture can be delivered while preserving the
working product. It is not an issue list or Markdown execution tracker. Dependencies
are described to explain the design and avoid circular implementation assumptions;
issue decomposition, IDs, assignment, status and Beads conversion are deferred.

Start with repository/source identity so organization rename can be the first
external change. Deeper application inventory informs package contracts and the
source import/build setup. Import the candidate's JS dependency closure and pin the
built control artifact before beginning the typed facade. From the facade, follow the
ordered controller port → rendering port (on Vite from the first build) branch while
contracts/build checks permit manager-loaded handles → compute extraction on a separate branch. Integrate each change in a
checked revision; complete UI/Vite migration is not a compute prerequisite. Media and crop
contracts support the morph pipeline and revised controls. Static names publication
uses the media/recovery and hosting contracts. Final integrated verification covers
the resulting app and reusable packages, rather than only an intermediate migration.

Conversion and classic Compose can progress from their own documented inputs.
Research remains independent of release. Candidate-source handover, production
promotion, API retirement, package publication and classic distribution remain
separate delivery decisions with the evidence appropriate to each. Organization
rename and API retirement do not wait for every architecture/research deliverable.

### Workstream prerequisites and requirement ownership

Added in the 15 October decomposition-readiness pass, after a fresh-context reviewer
tried to derive a task graph from this plan and could not do so without guessing. These
are design dependencies between **named workstreams**, collected here because the prose
above and the individual sections state them in about a dozen places and several
sections state none. They carry no IDs, status or assignment. Edges the plan states
outright are plain; **(inferred)** marks an edge this pass derived, to be confirmed
when execution work is created. "Needs" means the dependent cannot be accepted without
it; a soft preference is called out as such.

| Workstream | Needs | Feeds | Note |
| --- | --- | --- | --- |
| [Source and repository identity](#source-and-repository-identity) | — | organization rename, application inventory, domain handover | Small and first. |
| [Organization rename execution](#organization-rename-execution) | source and repository identity | link repair everywhere; the classic distribution's published README URL and `promote.py`'s remote and artifact lookup (neither blocks a technical workstream) | Terminal for implementation work. Not gated by qualification, classic or delivery. The prerequisite is the small identity map, not the deep inventory. |
| [Application inventory](#application-inventory) | source and repository identity | nearly everything below | Supplies the import allowlist, commands, asset acquisition and defect ledger. |
| [Candidate source import and bootstrap](#candidate-source-import-and-bootstrap) | application inventory | workspace build, application migration, provider simplification, diagnostics consent control, confirmed-crop (reproduction), deploy re-homing, autoresearch re-homing stage 2 | Imports the JS closure and pins the control artifact by hash; no .NET, Fable or Webpack in this repository (D1, decided 16 October); Node only. The workstation's missing .NET SDK is therefore not a blocker. |
| [Package and operation contracts](#package-and-operation-contracts) | application inventory; autoresearch re-homing stage 1 (hard only for the decode-ceiling measurement in milestone 2, soft for milestone 1) | every workstream that builds against its types | A design deliverable: no engine or manager implementation is needed to freeze it. Initial byte ceilings come from a bounded decode measurement it must include. |
| [Workspace build and artifact identity](#workspace-build-and-artifact-identity) | candidate import; package contracts (inferred: type and worker gates); autoresearch re-homing stage 1 (soft: the lease wrapper) | application migration milestones 2–4, provider simplification, autoresearch re-homing stage 2, the dependency currency lane, ONNX Runtime Web evaluation, extraction CI, integrated verification | Owns the CI/performance-preservation map. Scaffolds the four package workspaces first. Two milestones: (1) workspaces, TypeScript, lint/format, identity hashing and CI carry-over, which precede the port; (2) Vite targets, production headers and artifact fan-out, delivered together with the port's rendering step. |
| [Application migration](#application-migration) | candidate import; workspace build milestone 1; provider simplification (an ordering edge for the typed-facade milestone only, which edits the shared bridge files) | compute extraction (needs only the typed-facade milestone), and every UI workstream (needs the TS/React milestone) | Ordered milestones: flow-matrix freeze and golden-capture spike, typed facade, controller port, rendering port on Vite, parity against the control artifact. The port (the TS/React milestone) is the largest single unit (the candidate's `Product.fs` alone is about 1,470 dense lines, about 2,000 with the other Next F#); split it at the controller/rendering seam. It owns the UI state machine only; the operation layer is the next row. No time box and no fallback: the port runs to completion (17 October). |
| [Application operation controller](#application-operation-controller) | package contracts; typed-facade milestone | face controls, morph pipeline, acquisition consent | New named workstream; was unowned. Owns the scheduler, residency, intent snapshots, cancellation and whole-action progress behind the operation-service interface that the migration's reducers call. |
| [Provider simplification](#provider-simplification) | candidate import; workspace build milestone 1 (native retirement lands right after the first destination build) | face controls (selector), help and guidance copy, application migration's typed-facade milestone (ordering edge) | The section says it does **not** depend on package or converter extraction. Soft preference: before compute extraction so dead WebGL execution is not extracted. |
| [Model manager extraction](#model-manager-extraction) | package contracts; workspace build (inferred) | compute extraction (via its first milestone, loaded handles accepted), acquisition consent | Its own section stated no prerequisite and no such milestone before this pass. |
| [Compute extraction](#compute-extraction) | typed-facade milestone; package contracts; workspace build checks; manager loaded handles | media and recovery; morph pipeline (through media) | Does not wait for the port. Carries the confirmed-crop reproduction tests if they landed first. Re-runs the typed-name equality check for static names once extraction lands. |
| [Media and recovery](#media-and-recovery) | compute extraction (inferred, except the envelope helpers, which the candidate's code already supplies); package contracts | morph pipeline, static names (envelope helpers), face controls (Save/Share) | The candidate's envelope code is a valid producer before extraction. |
| [Confirmed-crop encoding](#confirmed-crop-encoding) | package contracts (preprocessing policy); candidate import (reproduction); compute extraction (an ordering edge for the fix itself, which edits shared files; the failing-test reproduction needs only candidate import and may land first) | face controls, morph pipeline | The reproduction (a failing test) may land right after candidate import; the fix itself follows compute extraction, which carries the reproduction tests. Multi-selection acceptance is in face controls. |
| [Morph pipeline](#morph-pipeline) | media and recovery; confirmed-crop encoding; operation controller (inferred) | integrated verification | |
| [Acquisition consent, overlap and warming](#acquisition-consent-overlap-and-warming) | package contracts; manager extraction; TS/React milestone; operation controller (inferred) | face controls (photo flow), integrated verification | New named workstream; was unowned. Optional warming is its own row below. |
| Verified-cache warming (optional sub-node of [acquisition consent](#acquisition-consent-overlap-and-warming)) | acquisition consent core; research evaluator (warming adapters); autoresearch re-homing stage 2 | integrated verification (only if it ships) | Ships only if a targeted round shows a foreground-safe benefit within the memory and mobile budgets; dropped otherwise, and nothing else waits on it. |
| [Device check and estimates](#device-check-and-estimates) | package contracts; TS/React milestone | consent copy (soft: unknown estimates are allowed) | New named workstream; was unowned. Never gates phone support. |
| [Face controls and modals](#face-controls-and-modals) | TS/React milestone; confirmed-crop encoding; operation controller; provider simplification; acquisition consent (inferred); media and recovery (Save/Share, recovery reader); static names modal for Browse Names (soft: the menu entry can land first) | integrated verification | The largest catch-all; see the split seams below. Also owns the cropper decision: a spike on `react-advanced-cropper` 0.20.1 versus reproducing the dialog, judged against the locked mockups, before the crop modal is built. |
| [Model hosting extraction](#model-hosting-extraction) | application inventory; package contracts; workspace build (inferred) | static names publication, deploy re-homing (boundary), independent acceptance | Reusable chunk and manifest hosting only. |
| [Application deploy and collector re-homing](#application-deploy-and-collector-re-homing) | application inventory; candidate import; model hosting boundary; autoresearch re-homing stage 1 | delivery from this repository, diagnostics control, static names publication, ONNX Runtime Web evaluation (runtime staging), classic wind-down | New named workstream; the monorepo had no home for staging, promotion, collector or catalogue pipeline. |
| [Static names and picker](#static-names-and-picker) | generator and publication part: contracts, recovery-envelope helpers, hosting machinery, a qualified generator, application deploy and collector re-homing (the pipeline's home) and autoresearch re-homing stage 1 (the lease runner), and domain handover's one-time preview and latent snapshot (hard for the first publication). Picker part: TS/React milestone; its bridge-consuming edits are ordered after confirmed-crop encoding and the morph pipeline (shared files) | integrated verification; delivery (what the names host may claim) | Not gated by compute extraction or the app port, but not free-standing either: the generator part needs the prerequisites on its left, and the first publication also needs the one-time preview snapshot from domain handover. The data-shape spike comes first. |
| [Conversion tooling](#conversion-tooling) | application inventory; package contracts (manifest compatibility); workspace build (soft: CI lanes) | integrated verification (non-face journey), independent acceptance | Builds and verifies on its own; the manager/engine load check joins integrated verification. |
| [Diagnostics consent control](#diagnostics-consent-control) | candidate import; TS/React milestone (for the ported disclosure); deploy re-homing (collector source); the learnings and retention decision (soft: the wording) | delivery (production collector) | New named workstream; was unowned. The learnings ingestion and retention decision are split out as their own row below because they need none of these prerequisites. |
| Diagnostics learnings and retention decision (a task inside [debug reporting](#debug-reporting-control-and-consent), split out) | — | diagnostics consent control (the true retention wording), delivery (a production collector), any requirement the findings change | **Decided 17 and 18 October:** ingest the learnings from the existing reports first (read-only, aggregates only); then delete the reports collected under the 30-day wording, with a receipt (a one-off script, no bucket rule); keep only the findings; make no deletion promise for later reports. Needs nothing from the monorepo. The candidate's string correction was ordinary work (decided 18 October) and is done (commit `40c63a9`, live 17 October at 20:28:59 UTC), which fixes the boundary of the deletion. The earliest reports pass 30 days on 22 October, so the ingestion should not wait. |
| Dependency currency lane ([policy](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026)) | workspace build milestone 1 (the first lockfile) | every workstream, through grouped bump revisions | Automated, with no human review calendar and no owner to name (operator question, 17 October): a dependency updater (the platform's built-in or Renovate, chosen at setup) opens grouped update changes, the existing gates decide whether each passes, and a change that fails its gates is not merged; a hold-back is a recorded reason and re-check trigger next to the pin. The bleeding-edge lane runs on a GPU worker under the lease on a schedule and never ships. Excludes the frozen classic distribution. |
| [Autoresearch re-homing, stage 1](#autoresearch-re-homing) (guides, protocol, runner, lease, ledger continuation, provenance map) | application inventory | package contracts milestone 2 (the decode-ceiling measurement), workspace build (soft: the lease wrapper), research workload design, application deploy and collector re-homing (promotion gate), static names (the lease runner), delivery from this repository, autoresearch re-homing stage 2, classic wind-down | New direction (15 October). Independent of release for an early candidate promotion. |
| [Autoresearch re-homing, stage 2](#autoresearch-re-homing) (drivers and recipes that consume an app artifact, workflow path filters) | autoresearch stage 1; candidate import; workspace build | ONNX Runtime Web currency evaluation, research evaluator (adapters), verified-cache warming (adapters), classic wind-down | Split from stage 1 on 17 October so the table has no row-level cycle: workspace build needs only stage 1's lease wrapper, softly, and stage 2 cannot start before workspace build. |
| [Research workload design](#research-workload-design) | autoresearch re-homing stage 1 | research evaluator, targeted campaigns | Independent of release. |
| [Research evaluator](#research-evaluator) | research workload design; autoresearch re-homing stage 2 (adapters) | targeted campaigns, verified-cache warming (its adapters) | Terminal for release: application migration and cutover do not wait for it. The only row that waits on it is the optional verified-cache warming sub-node. |
| [ONNX Runtime Web currency evaluation](#onnx-runtime-web-currency-evaluation) | autoresearch re-homing stage 2; application deploy and collector re-homing (runtime staging); workspace build | — | One grouped dependency bump: numerical canaries, phone lanes and a paired desktop comparison decide adopt or hold-back (recorded in the updater config). WebNN is a later idea, not an item. |
| [Classic distribution](#classic-distribution) | application inventory; organization rename execution (hard only for publishing the README with its final URL; build and tests do not wait); the branch plan in D4 | delivery (the classic publication action); classic wind-down (re-runs the clean-clone acceptance on the cleaned tree) | Independent of everything else except the default-branch switch's pre-checks in D4 (and retiring the Vercel publisher first if a test shows the switch triggers it). Since 16 October it also owns the [frozen self-host guarantee](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026): vendoring, a one-command README-executed clean-clone acceptance on a GPU worker, and a recurring rot check. Its decisions (D4 to D7) were settled on 16 October. |
| [Integrated verification](#integrated-verification) | application migration; provider simplification; compute extraction; media and recovery; confirmed-crop encoding; morph pipeline; operation controller; acquisition consent; device check and estimates; face controls; static names; diagnostics consent control; model manager extraction; model hosting extraction; conversion tooling; workspace build (every workstream whose claim it records) | delivery from this repository, package publication and documentation, independent acceptance | Produces the release summary, including the tested browser/OS list Help uses. |
| Package publication and documentation (new 17 October; the preparation for the package-publication action in [delivery](#delivery-and-publication)) | compute extraction (engine); model manager extraction; model hosting extraction; media and recovery; conversion tooling; integrated verification (the non-face journey); npm scope and credentials (an execution prerequisite, not a decision) | delivery (the package-publication action); independent published-package acceptance | Owns each package's public README and API docs, a copyable quickstart, examples, licences and notices, model-acquisition instructions, version and provenance binding, the registry name-availability check, and a clean-consumer smoke test from the packed tarballs with a content scan (no weights, no repository-only paths, no secrets). It publishes nothing; publishing is the delivery action. |
| [Domain handover and retirement preparation](#domain-handover-and-retirement-preparation) | source and repository identity; application inventory (hosting, DNS, credential inventory) | delivery and publication; static names (the preview and latent snapshot) | Can start right after the inventory and does not need the monorepo. Includes snapshotting the published name previews before the API stops. What the names host may claim is decided in delivery, after static names, so this row has no edge back to static names. |
| [Delivery and publication](#delivery-and-publication) | domain handover preparation; the operator's decision; static names (what the names host may claim). Promotion from this repository also needs integrated verification, deploy re-homing and autoresearch re-homing stage 1. The package-publication action needs package publication and documentation. A production collector needs the diagnostics retention decision applied (no expiry written); the classic publication action needs classic distribution | classic wind-down; independent published-package acceptance | Six separate actions, each a terminal outcome (candidate-source handover, production promotion, API retirement, package publication, independent acceptance, classic publication). An early candidate promotion needs none of the monorepo workstreams. Its edits to the candidate source are a distinct edit set made on a non-deploying classic branch. |
| [Classic wind-down](#classic-wind-down) | delivery (candidate-source handover); autoresearch re-homing stages 1 and 2; deploy re-homing; classic distribution (the clean-tree acceptance re-run) | — | Terminal and staged, run by agents with no human approval step (operator, 18 October): each stage runs when its preconditions verify and writes a receipt. End state: the self-host distribution plus Git history only. New (15 October end state). |
| [Independent published-package acceptance](#independent-published-package-acceptance) | package publication (the delivery action) and its preparation row; conversion tooling; hosting documentation | — | Terminal. Does not gate web promotion or API retirement. |

**Not graph nodes.** Package publication itself is a delivery action (its preparation has its own row above); targeted campaigns are optional
research rounds run through the evaluator's adapters after the features exist; the operator decisions
named in the table are gate items, each with a recorded outcome, not workstreams. None is open as a
standalone question any more. In a task graph a gate is a node that the work it unblocks depends on.
Four earlier gates were closed on 17 October: the port's checkpoint (withdrawn), the retention fix
(decided: ingest the learnings, then no deletion promise), the maintenance owner (replaced by an
automated update lane) and the package-publication scope (settled from the original plan, in
[independent published-package acceptance](#independent-published-package-acceptance)). Three more were
closed on 18 October: edits to the candidate source are ordinary work on the working candidate and need
no separate approval; the existing tracker items are rewritten from this plan at conversion (see
[decomposition](#decomposition-order-size-and-tracker-coverage)); and classic ends as the self-host
distribution plus Git history only, with its wind-down run without per-step approval (see the
[end state](#end-state-of-the-repositories)). The research overlay was defaulted on 16 October
(committed objects only) and is no longer open. The one thing left to the operator after execution
begins is the explicit cutover decision: the pushes that change what live visitors get (switching
next.facemorph.me to the monorepo build, promotion to `facemorph.me`, and retiring the old API). It is a delivery
action, not a workstream gate. Everything else runs without waiting for a human decision (operator, 24 October);
package publication needs only its npm credentials and the packed-tarball checks.

**Acyclicity.** A reviewer's parse of this table on 16 October read 32 workstreams and found no hard
cycle, but found three latent ones that the edits above break: workspace build against application
migration (split into two build milestones), workspace build against the evidence table that integrated
verification produces (the schema is defined first, the contents later), and compute extraction against
confirmed-crop (soft, either order). Earlier counts in the review record ("31 nodes, 85 edges") are
history. The graph's cycle check is run again on the actual task graph, not asserted here.

**Reading the columns (17 October).** Needs is authoritative. Feeds is a reading aid, and a Feeds cell
reading "every…" or "nearly everything" is a wildcard that the conversion expands, not a list. A
milestone-qualified edge (for example "workspace build milestone 1" or "contracts milestone 2") points at
that milestone of an otherwise unsplit row; the conversion splits such rows into milestone nodes and the
cycle check runs on the split graph. A fresh-eyes parse on 17 October read 34 rows and found a cycle only
while autoresearch re-homing was one node (contracts, then autoresearch, then workspace build, then
contracts); it is now two rows, stages 1 and 2. Nine Feeds cells omit an edge that the other row's Needs cell states
(workspace build to the manager, compute, hosting and conversion rows; compute extraction to confirmed-crop; the
morph pipeline to the names picker's bridge edits and the diagnostics reporting rebinding; hosting and conversion to
package publication; diagnostics control to integrated verification; verified-cache warming to integrated
verification, and the device check to acquisition consent). The conversion takes its edges from Needs, so these are
harmless and are not edited cell by cell.

Stale edges to avoid when execution work is created. The historical records' edges
predate several 11–12 October rulings and contradict this plan in at least three
places: organization rename gated behind release qualification and classic work;
research evaluator gated before the typed facade although migration does not wait for
research; provider simplification gated behind manager extraction although its section
says it does not depend on package extraction. Derive edges from the table above, not
from the historical records.

**Ownership gaps and tie-breaks.** Requirements that sit in specification sections but
name no implementing workstream, and conflicts where several sections claim the same
work. Where a section already settles an item, it governs.

| Requirement or conflict | Owner and tie-break |
| --- | --- |
| Debug-reporting disclosure, consent labels, collector retention ([debug reporting control](#debug-reporting-control-and-consent)) | Diagnostics consent control |
| Consent modal, Prepare encoder, grant ownership, overlap, warming ([consented downloads](#consented-downloads-useful-overlap-and-cached-model-warming)) | Acquisition consent, overlap and warming; the manager supplies primitives only |
| Preflight checker, calibration, estimate copy ([device check](#lightweight-device-check-and-pre-download-guidance)) | Device check and estimates |
| Scheduler, residency reservations, Morph as parent intent, whole-action progress ([shared resource contracts](#shared-resource-and-release-version-contracts)) | Application operation controller |
| Catalogue result generator and publication ([names](#names-selection-implementation-gap-and-complete-target)) | Static names and picker, publishing through the re-homed pipeline |
| Application staging, promotion, collector, catalogue pipeline | Application deploy and collector re-homing |
| Native desktop retirement (named in five sections) | Provider simplification removes native dispatch code, links and guidance and re-homes the artifact verifier in one checked revision right after the first destination build, as candidate import already says. The three `desktop-*.yml` workflows exist only in classic and are never imported, so there is nothing to remove from them here; retiring classic's copies is a classic wind-down step, run automatically. Import only retains the dependencies until then; inventory only lists them; organization rename does not touch them. |
| API-free names pipeline: preview snapshot, result generator, workflow home | Domain handover owns the one-time snapshot of the published previews and latents before the API stops. Static names owns the generator, which never calls the API. Application deploy and collector re-homing owns where the staging and publication workflow runs. |
| "Prepare encoder" action in the Encode image modal | Acquisition consent owns the action, its grant and Cancel semantics; Face controls renders the entry beside Choose image |
| Browse Names in each face's menu | Face controls owns the menu entry and stable-ID capture; Static names owns the modal and result consumption |
| Morph: frame-budget check, production, MP4-availability probe | Morph pipeline; parent-intent scheduling is the operation controller; button, progress and Cancel presentation is Face controls |
| Mixed recovered-still and photo batch | Face controls (batch UI), using Media and recovery's recovery reader |
| Complete-output display, "Preparing file…", file-preparation Retry | Face controls |
| Export identity, filenames, collision handling, prepared-file cache by revision and format | Media and recovery implements; Face controls renders and edits the name |
| Dynamic-shape recovery schema versioning; descriptor-driven mapping; descriptor-driven morph geometry | Media and recovery; Compute extraction; Morph pipeline respectively |
| Help text, computer guidance, native-link removal | Provider simplification |
| Retirement and FAQ copy, names-host redirect | Domain handover and retirement preparation |
| Release summary and the Help tested-browser list | Integrated verification |
| Release-consistent asset sets, old-tab compatibility, retention window | Model hosting extraction (retention, publication order) with Workspace build (identity) |
| Stale harness repair (`next-matrix`, `check-next-artifact`, `check-progress-copy`) | The bead that replaces the control it asserts, recorded in `tests/retired.txt` when a test goes |
| No-regression comparisons on cells that already exist | Integrated verification records them and the Workspace build lanes run them; no new campaign |
| Development-worker inventory and lease wrapper | Workspace build (inventory, CI wrapper); Autoresearch re-homing (lease protocol) |
| Targeted campaigns | Research evaluator adapters first; the rounds are optional research after the features exist |
| Goal-based extra export formats ([export direction](#file-sharing-and-export-direction)) | Proposal only. If pursued, Media and recovery after the default paths work; nothing depends on it (a deferred, optional item at conversion, so it is not dropped) |
| Weighted face blend: operation, view, button, `#blend` deep link, saved recipe ([weighted face blend](#weighted-face-blend-advanced-mode)) | Compute extraction (the `blend` function); Face controls (view, button, deep link, slot reuse); operation controller (blend parent intent); Media and recovery (recipe in saved files); Diagnostics (action list entry) |
| `last-result.mjs` retention split; `media.mjs` split | Application migration (TS/React milestone); Media and recovery |
| Active-link and self-host URL repair | Organization rename; Classic distribution verifies the fresh-clone commands afterwards |
| `?testing` bulk Generate, Help/footer issue links | Retained candidate behavior under application migration; no new work |
| Early retained-candidate promotion edits | Delivery and publication (candidate path), prepared from the domain-handover list |

**Shared-file serialization.** At least eight workstreams edit
`src/Next/product-bridge.mjs`, and several also edit the ported UI sources,
`browser/runtime.mjs` or `browser/ort-worker.mjs`: provider simplification, application
migration, compute extraction, confirmed-crop, morph pipeline, face controls, static
names and diagnostics control. The plan wants separate checked revisions and parallel
branches but forbids worktrees. **Decided 16 October (planner's call, after both reviewers flagged
the either/or):** shared files are serialized by ordering edges, mandatory in the task graph. The
order for `product-bridge.mjs`, `browser/runtime.mjs` and `browser/ort-worker.mjs` is native
retirement and provider simplification, then the typed facade, then compute extraction, then
confirmed-crop and morph pipeline, then static names and diagnostics edits, with the TS/React port
proceeding alongside against the facade (it edits UI sources, not those three files). A newly discovered
shared file gets an ordering edge in the tracker. Separate clones are allowed for read-only runs and experiments, never for concurrent edits
of the same file, and never as a worktree.
The shared physical-device lease is a second serialization resource for heavy runs.

**Mandatory ordering edges (17 October).** These are `Needs` edges in the task graph even where a table
cell names only the design prerequisite: provider simplification, then the typed-facade milestone, then
compute extraction, then the confirmed-crop fix, then the morph pipeline, then the bridge-consuming edits
of the static names picker and of diagnostics control's reporting rebinding. Face controls edits ported UI
sources rather than the three shared files; a face-controls task that touches one of them follows the
morph pipeline. The static names data-shape spike, generator and publication, and the diagnostics
learnings ingestion, edit none of these files and are unordered with respect to them, so the names work is
still not held behind the refactor.

**Split seams.** Units too large to be one reviewable item, and the divisions the plan
itself offers:

- Face controls and modals: tile states, validation, paste and Encode rename; the crop
  confirmation and editor modals; the batch proposal with ordered insertion and
  per-slot cancel/retry, then mixed recovered batches; Share/Save/format/filename;
  many-face layout, Remove, Undo and Start over; Morph controls and complete-output layout; the responsive sweep.
- Package and operation contracts: per package (engine, manager, app) and per area
  (batch and progress types, scheduler and residency, preflight types, export identity,
  screen-state types, model descriptor).
- Workspace build and artifact identity: workspaces and TS; Oxc lint/format; identity
  hashing; CI lane carry-over and the retired-tests check; artifact fan-out.
- Application inventory: identity map; import readiness; licenses; native inventory;
  research dispositions. Candidate import: closure; wrapper and `deploy-next/`
  contract; runtime reuse.
- Provider simplification: WebGL and provider choice; admission and guidance; native
  retirement. Compute extraction: mapping and synthesis; photo orchestration;
  descriptor generalization.
- Static names: data-shape spike; catalogue generator and publication; picker. Device check:
  checker; calibration (supplies measurements to the release summary, which integrated
  verification owns). Conversion: package and container; FFHQ; the non-face fixture.
- Integrated verification, by its own paragraphs: functional journey; consent, overlap
  and warming; scheduler dependencies; mixed batch; non-face proof; degradation;
  responsive sweep. Delivery: its six actions.

### Source and repository identity

This is the first step of [organization rename execution](#organization-rename-execution): scan and classify
every `check-face`/GitHub reference and integration listed above, then rename. No separate committed map. Do
not infer legacy production's exact commit from classic's default branch or candidate checkout.

### Application inventory

Inspect `src/Next/product-bridge.mjs`, runtimes, geometry/photo/media,
`self-host/`, read-only sibling server, workflows, staging and historical clones.
Record every moving path, consumer, build/worker URL, persistent identity, source
revision and live receipt where the import needs it: the machine-readable allowlist the import script reads
(`import/allowlist.json`, with source commit, paths and digests) and shipped licence notices. No separate
inventory document; the defect list is this plan's. Identify provenance/history transfer
and external model sources. Acceptance: all release surfaces have an owner and a
retained/rebuildable input; uncertainties are explicit; this inventory makes no
new remote changes. Include licenses and required notices for imported app,
package, converter and model/data inputs. Preserve provenance/restrictions and
name unresolved redistribution rights before deciding distribution contents.

Before candidate import, this inventory supplies the executable file allowlist /
path map; pinned toolchain and install/build commands with working directories;
applicable baseline check commands and their required artifact inputs; runtime /
photo asset locations, digests and acquisition/mirror procedure; and a known-defect /
declared-change ledger for the selected candidate. Resolve these first-build inputs
before facade work. Other uncertainties, such as legacy production's exact deployed
revision, remain explicit in their own surface inventory rather than blocking a
candidate build whose source is already pinned. This turns source inspection into
a reproducible destination build instead of relying on a developer's prepared tree.

Map remaining browser/research consumers of classic's Fable/Webpack build wrappers before this repository replaces them.
Inventory native packaging/updater paths for retirement, not migration qualification.
Shared browser artifact checks currently live under `desktop/`; preserve or re-home
those consumers without requiring native builds. Freeze package contract schemas
first, rather than requiring a completed
manager implementation merely to design the engine. Independent consumer examples
may use packed local artifacts before npm publication; qualification must not depend
on publishing unqualified packages. Catalogue construction uses qualified compute /
media contracts, and hosting machinery remains separate from app/domain promotion.
This keeps the workstream order acyclic and preserves an independently working
candidate throughout the migration.

### Candidate source import and bootstrap

After application inventory, import the selected **on-device candidate** into the
new monorepo before the facade and port milestones. The planning reference is
`b2d945a8c7f0ff9f382fbfefaecc2651943077a3`; inventory freezes the actual chosen
committed import revision, records any reviewed later-candidate delta, and keeps
the recorded live artifact as a separate identity. Export an explicit allowlist
from Git objects, with source repository ID/commit, source → destination paths,
file digests and notices in `inventory.md`. Any deliberately adopted working-tree
overlay is separately identified by ownership/digest; never silently include other
sessions' edits or label dirty source as the pinned committed snapshot. Classic
retains its history and publisher; import provenance remains available in the new
repo without copying its `.git`, resetting it or creating a worktree.

Import the JS closure at its destination paths under `apps/web`, keeping the `src/Next`
directory structure intact so relative imports and tests still resolve, with temporary root
paths only for files whose consumers have not moved (`desktop/runtime.mjs` and required
`scripts/`), tracked in the inventory. Protect the new repo's `PLAN.md`, entry guides and
execution state; review destination collisions before writing. Merge only required dependency
settings into the destination workspace configuration. Do not copy the entire classic working
tree, ignored weights/caches, `node_modules`, generated Fable output, delivery directories,
credentials or private provenance. Temporary source paths leave the final layout only after
their mapped consumers migrate.

The import is a runnable JS closure plus read-only references, not an F# build. Include the
`src/Next` `.mjs` modules (bridge, browser, photo, geometry, assets), their tests and fixtures
(including `project-v1.fixture.json`), `product-ux.scss`, `src/index.html`, styles/public assets,
package/lock entries for the JS modules, catalogue input, the build/check scripts that survive
(hashing and verification), temporarily imported `desktop/runtime.mjs` and needed photo-runtime
inputs. The F# sources (`Product.fs`, `ProjectJson.fs`, `Contracts.fs`, `Runtime.fs`,
`ModelAssets.fs` and the small shared `Config`, `FancyButton`, `Logos`, `ThemedApp` and `header`
pieces) are neither imported nor built: the port reads them in classic at the pinned commit as its
specification, and the control artifact is the oracle. `global.json`, the `.config` Fable pins and
the Webpack configuration are not imported. Candidate `product-bridge.mjs` statically imports
`desktop/runtime.mjs` and `scripts/build-next.cjs` hashes it; browser/E2E workflows also invoke
`desktop/scripts/verify-web-artifact.py`. Retain these exact dependencies for the first checks, then
remove native dispatch and re-home the general artifact verifier with matching imports/hashes/checks
in a separately checked revision. Do not import native packages or release automation merely because
these browser dependencies share the directory. Inventory identifies exact files and consumers.
Shared/historical compilation inputs are not authority to run or recreate the legacy HTTP
application. Confirm the imported closure and the ported app contain no legacy Server/API artifact.

Before the port, establish a destination root `build:next` compatibility wrapper and explicit
`deploy-next/` artifact contract for retained browser/research harness consumers. These are planned
bootstrap commands; they do not exist in the fresh repo today. Until the ported app passes parity,
`deploy-next/` can be populated from the pinned control artifact, labelled as the control and carrying
classic's identity, so exact-artifact checks, research drivers and deploy re-homing work from the first
day without .NET. The ported app's Vite build then replaces it, recording its own source commit/build
identity plus import provenance; it never presents the classic commit as its deploy source. New
development instructions name the repository and working directory for each command; `npm run build`
in classic builds the historical application and is not a substitute for `build:next`. Change output
locations only with mapped consumer updates and equivalent artifact identity checks.

Frontend build alone supplies neither model/runtime bytes nor inference readiness.
For the early checks and the port, reuse the candidate's digest-checked immutable
runtime mirror/overlay, pinned photo module siblings and notices, without waiting
for converter or model-host extraction. Inventory separates mirror/reuse inputs
from full rebuild inputs: current restaging can depend on ignored `experiment/`,
installed ORT/FFmpeg packages and external `review-artifacts` absent from a fresh
clone. Provide explicit acquisition/mirror commands, checksum checks and model-term /
download authorization for a clean destination; do not copy a prepared private lab
or assume that a simple Vite/static server supplies production headers/assets.
Track bundler-emitted app workers separately from manifest-pinned hosted runtime
workers/modules, including transitive imports, WASM/codec/photo siblings and URLs.
Path/package/build changes preserve both graphs; changed emitted runtime bytes
require updated matching pins rather than reuse of an unrelated old digest.

Acceptance: the destination's JS checks (unit, runtime and bridge-import) pass against the imported
closure, and its local exact-artifact harness exercises the pinned control artifact with the selected
runtime bytes, source identities and applicable functional/cancellation/resource checks. Record known
planned-to-fix candidate behavior separately. No remote publisher/domain changes occur at this
bootstrap. This unblocks the facade and port milestones; classic self-host and final crop/names /
package improvements continue under their separate workstreams.

### Package and operation contracts

**Two milestones, so the bottleneck node does not hold everything.** Milestone 1 freezes what compute
extraction, the typed facade and the manager need: loaded handles, operation signatures, the
confirmed-crop preprocessing policy and manifest compatibility. Milestone 2 freezes the rest: tile,
consent and progress state types, export identity, preflight types, the external developer journey, the
screen-state types and the numeric byte ceilings. Workstreams that need only milestone 1 start after it.
Numeric ceilings are the exception that follows measurement: downstream acceptance criteria that cite a
ceiling can be written only after milestone 2 closes, so decomposition writes those criteria in a
second phase.

**Decode-ceiling measurement protocol.** The measurement needs a worker and the lease runner, which
live in classic until autoresearch stage 1 re-homes them, so contracts depend on that stage for this
one task (soft for milestone 1). For every supported decode route (browser image decode, any WASM or
worker route, and the paths a phone uses) measure peak transient bytes on the named available workers
using fixtures at the maximum compressed size, maximum pixel count and maximum edge length, plus a
typical photo; report peak allocation per representation (compressed, decoded, cropped, tensor), record
the machine, browser and build, and set each ceiling per route. A route that was not measured has no
ceiling and is therefore not admitted.

Write the contracts as TypeScript modules in the packages that own them, with type tests and a limits
constants file; there is no separate `contracts.md`.
Inspect `src/Next/browser/runtime.mjs`, `src/Next/browser/ort-worker.mjs`,
`src/Next/product-bridge.mjs` for actual browser adapter signatures; classify its
temporary `desktop/runtime.mjs` import as a retirement seam, not a new native contract.
Define loaded handles (ownership/digests/shapes/mapping/synthesis/encoder), manager
acquisition lifecycle, operations and `renderMorph` endpoints/settings/display
callbacks/video result. The current bounded encoder uses 108 sequential ORT sessions.
Baseline ownership: the caller's manager/provider adapter supplies an already-loaded
encoder capability whose typed `encode` operation owns bounded sequential session
creation/execution/release. It may read verified local shard storage lazily; no
engine-originated network acquisition occurs during execution. Consent-authorized
acquisition and verification of this encoder's required shards finish before its
admission; unrelated approved generator/encoder acquisition may proceed independently
under its own budgets. Loaded means ready
for offline execution, not all sessions/weights simultaneously resident in RAM.
Do not expose the existing network-repair-capable cache handle as an offline loaded
capability. Freeze verified-local-only reads, invalidation errors and all-backend
no-repair behavior, plus selected bundle authorization, acquisition priority/buffers,
speculative warming ownership and aggregate live-residency limits from the
[download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming).
Freeze verified-asset lease ownership, manager eviction exclusion and typed
invalidation/settlement on browser eviction, corruption, cross-tab deletion or
device loss. Active operations cannot fetch replacement shards; reacquisition and
re-admission belong to the application/manager outside engine execution.
Freeze the [synthesis numerical checks and independent export-quality rules](#synthesis-correctness-and-export-quality)
in these contracts; cross-build encoded-image hashes are not correctness gates.
The engine sees typed encode/abort/dispose operations, no URLs, OPFS handles or
`acquireBytes` callbacks. [package and operation contracts](#package-and-operation-contracts) records exact signatures, memory bounds and the
encoder-to-synthesis residency transition; any alternative needs equivalent
independent-consumer, memory and acquisition-boundary evidence. Freeze
host/converter manifest compatibility, metadata schema/version rejection and the
confirmed-crop preprocessing policy needed by [confirmed-crop encoding](#confirmed-crop-encoding). Define strict TS discriminated
unions for input modes, preparation, ordered batch selections, whole-action and per-crop progress,
retry/cancel and input revisions; validate untrusted runtime payloads. Freeze global cross-file selection-click order, atomic
first-target/additional-keypoint allocation and bounded encode scheduling from the
flow above; selection order must survive cancellation, retry and async completion. Define tile
Cancel as per-slot, modal Cancel as pre-commit batch cancellation, and Retry as one
existing slot with a new attempt ID; pending siblings retain their order. Freeze
reference-counted pending/running/retryable pixel ownership, success/remove/replace /
disposal release, numeric source/crop-count and byte ceilings, transient decode bounds
and over-budget admission before any extra keypoint allocation. Those ceilings must
be written in the contract and exercised at/over the boundary; no unbounded default. Set
the initial values from a bounded measurement of the actual decode path (peak transient
bytes per decode route) on the available workers, record the measurement beside them and
revise only by contract revision; no workstream otherwise measures them. Include the retained frame,
resource, cancellation and evidence contracts above, with numeric byte bounds.
Freeze compute-ready versus default-file-complete milestones, and separate compute
permits, loaded-asset leases and actual runtime-residency reservations. Model/session
loading and canary execution participate in admission; idle warm memory remains
accounted until released. These contracts must work for independent consumers as
well as the application scheduler, without importing application policy into packages.
Include the screen-state types and shared resource/version contracts
above. Record each borrowed UI reference by named surface; resolve picker targeting,
touch exit and cold/error states before their behavior implementation.
Freeze the [preflight](#lightweight-device-check-and-pre-download-guidance) evidence /
estimate types and budgets, separate generator/encoder admission, and the consent
screen's cold/warm costs and material-cost changes. Include the [external developer journey](#external-developer-journey-and-non-face-models)
and model descriptor in these contracts; dimensional assumptions cannot remain
implicit in generic APIs. Define stable export identity and informative collision-safe
suggested names with platform-specific no-clobber behavior.
Freeze typed stage/timing hooks around the existing real model work: await actual
inference/readback completion (including GPU `mapAsync`), and retain e4e verified
read/session-create/run/total timings plus actual WASM/max-live-session facts.
Do not replace these with submission time, a mock or the whole bridge-call duration;
engine events stay reporting-transport-free and app analytics retains its privacy policy.
Acceptance at contract freeze: inventory-backed interface/type/ownership walkthroughs
trace every supported flow without engine download/cache/host dependencies, including
a clean caller-loaded consumer that need not import the manager. Optional stubs may
check signatures; a completed engine/manager is not a prerequisite for these designs.
Actual clean-consumer execution is checked in compute extraction and integrated
verification. Cleanup and unsupported capabilities are explicit; worker messages
contain no promise/signal/callback objects, and status/capability reads start no
acquisition. This keeps contract design ahead of implementation without claiming
that a type walkthrough proves runtime behavior.

### Autoresearch re-homing

Moves the maintained research system out of classic into this repository's
`autoresearch/`, so that new rounds optimise the new application and packages (see
[end state](#end-state-of-the-repositories)). It is a workstream of its own, not a
side effect of [candidate import](#candidate-source-import-and-bootstrap), and it is
independent of release: nothing in delivery waits for it.

Source facts at 15 October 2026, classic `b2d945a`: tracked `autoresearch/` is 137
files and about 9.7 MB (88 files / 8.8 MB are historical `candidates/`); `results.tsv`
is the 11-column header plus 69 rows; `state/` is ignored; two research workflows
(`research-built-ui-media-v1.yml`, `research-rgba-screen-v1.yml`) and
`hosting/next-static/promote.py` reference the tree; four research documents carry
**uncommitted edits** that are not part of any committed snapshot (`README.md`,
`loop-v3-proposal.md`, `reviews/README.md`, `reviews/2026-10-10/next-directions.md`).

- **Moves (maintained and executable):** guide, protocol, record standards and
  templates; `run.py` and the device-lease protocol; the ledger; device and worker
  recipes; the drivers this plan names as starting points (the built-UI paired driver
  and the morph-frame-pipeline product harness); the research workflows.
- **Moves too (changed 18 October):** closed candidate directories, frozen reports, the 10 October
  round, the v2 campaign and native candidates move with the rest, byte-identical, because classic's
  tree is cleaned at wind-down and the experiments are about the candidate that became this app. The
  88 files / 8.8 MB hold no weights. The provenance map then points inside this repository, with
  classic's Git history at the snapshot commit as the audit trail. Links in this plan into classic's
  `autoresearch/` describe the tree at that snapshot; afterwards find the file here or in classic's
  history. No weights or fixtures containing weights enter Git.
- **Control for future rounds:** a pinned artifact recorded by hash (the candidate
  artifact or an earlier new-app build), never F# source or a rebuilt candidate.
- **Promotion coupling (a delivery dependency):** `hosting/next-static/promote.py`
  requires kernel provenance (candidate ID and source hash) in the runtime manifest
  and a matching `keep` row in `autoresearch/results.tsv`, but only
  `if ledger.exists():` — in a checkout without the ledger it **skips the
  research-backing check silently**. The promotion step re-homed with
  [application deploy and collector re-homing](#application-deploy-and-collector-re-homing) must read the canonical
  ledger and fail closed when it is missing. Stage 1 therefore precedes any promotion
  from this repository, though not an early promotion of the candidate from classic.

Handover mechanics. Import from committed Git objects with an allowlist and recorded
source commit. **Default decided 16 October (a reviewer found the question still open):** the four
uncommitted edits above are not imported. They stay in classic until their owner commits them; if they
are committed before the import snapshot they come in with it, otherwise the inventory records them as
excluded with their content digests, and they can be adopted later only by an explicit decision, never
silently. Declare a **handover point**: record the final
classic ledger prefix hash and last journal entry IDs; the first appended row here
cites them; keep the 11-column header, never initialise an empty ledger, and make
corrections as new rows that reference prior IDs. After it, classic receives no new rounds and
only a forward pointer, in a separately reviewable commit that excludes other sessions'
changes; its research tree is removed at [wind-down](#classic-wind-down), and any path with
uncommitted changes is skipped and reported rather than overwritten. **Lease continuity:** one absolute state directory per
physical machine, used identically by local agents, self-hosted CI lanes and drivers
in both repositories, set explicitly before the first run from here (the current
relative `autoresearch/state` resolves differently per checkout and would give two
leases for one GPU). A run from either repository must see the other's lease as busy.

Two stages. **Stage 1** needs only the [application inventory](#application-inventory),
which supplies the source→destination map and consumer list: guides, protocol,
templates, runner, lease, ledger continuation and provenance map. **Stage 2** needs
[candidate import](#candidate-source-import-and-bootstrap) and the
[workspace build contract](#workspace-build-and-artifact-identity): drivers and recipes
that consume an app artifact, and the workflow path filters. Worker recipes (eris,
TrueNAS) are updated for the new paths and flagged where they still assume .NET or
Fable, which new-app builds do not.

Acceptance: from a clean clone one documented command runs a bounded smoke through
the lease runner on a worker and journals it; the ledger prefix is byte-identical to
the frozen classic prefix and every other tracked file of the classic tree at the snapshot is
present here byte-identical (a digest list) or listed with the reason it is not; the 69-row accounting in the
[preservation map](#autoresearch-coverage-and-preservation-map) resolves through the
provenance map; no guide tells an agent to start research in classic; a concurrent
run from classic is held off by the shared lease. This workstream claims no
performance result and does not require the evaluator.

### Research workload design

Deferred until a campaign is requested (one deferred tracker item with the evaluator). Then create
campaign-owned workload specs, in this repository, using current harnesses and retained
control or qualified rebuild. Pin control bytes and declare all expected outcomes,
required cells, statistical method, confidence level, sample/confirmation rules,
protected UX/resource metrics and invalid-run handling. Acceptance: cold/warm/output
cache cases are distinguishable and package/UI/refactor changes have named gates.
Make each targeted campaign's worker-specific launch recipe and consent/chooser /
cache-warm instrumentation concrete using the [research playbook](#targeted-autoresearch-launch-and-preserved-history).
Preserve frozen evaluation/reference scope and append-only history; screen and fresh
confirmation data have distinct identities and no optional-warmup false cache state.

### Workspace build and artifact identity

Prepare npm-workspace layout/aggregate commands and CI for all code roots, using
the runnable imported candidate and its temporary build/artifact contract above.
The [named CI/performance map](#platform-ci-retention-and-performance-preservation)
is a required preservation contract, not an optional list of example platforms.
Use its worker/artifact-sharing policy to reduce cost without dropping checks.
Use the language/build contract in `PLAN.md#language-and-framework-direction`: strict scoped TS configs,
explicit type checking/declaration builds, pinned Oxlint/Oxfmt dependencies and root
JSON configs, `lint`/`lint:fix`/`format`/`format:check` scripts, package export/worker
consumer checks and tested Vite targets/production headers. Start from
`scripts/build-next.cjs`, `scripts/check-tests-listed.mjs`, bridge/progress/artifact checks,
site/mobile workflows and test server/stage/restage paths. Include app/packages in
build/snapshot identity, exact required test invocation and worker completeness.
Acceptance: a package edit changes identity and triggers its required checks before
any migration candidate can be promoted; no protected behavior loses coverage
through an unexplained test removal. Scaffold the four package workspaces first as
empty, building and packable placeholders: this acceptance cannot otherwise be met
before the extraction workstreams that it gates. Establish Vite targets/worker checks
for its later build milestone from a minimal declared browser matrix taken from the
retained CI lanes (the same list the release summary reports, not invented);
there is no Fable/Webpack build in this repository; Vite is the only bundler from the first app build.
CI format/lint/type checks are read-only and fail on violations; validate configured
root discovery, ignored historical/generated bytes and formatting idempotence.
Record the formatting baseline separately from rule fixes and behavioral changes.

Extend `scripts/check-tests-listed.mjs` so that removing or renaming a listed test fails CI unless
`tests/retired.txt` names it with its replacement test or the declared plan change that made it obsolete.
There is no separate map document. For unchanged migration stages,
retain candidate expectations with path/adaptor updates. When a planned UI/provider
change lands, update its mapped checks in the same revision; do not retain assertions
that demand removed controls or freeze a known candidate defect. Source-language
assertions may become equivalent TS/schema/operation/built-product checks, while
numerical, acquisition, cleanup, resource and export integrity coverage survives.
Map any inherited independent-encode image-hash or decoded-lossy equality assertion
to the [synthesis/export rules](#synthesis-correctness-and-export-quality); keep real
prepared-file reuse, corruption checks and independent raw numerical comparisons.
Immutable historical scripts/reports stay in classic's Git history (its tree is cleaned at
wind-down); maintained destination checks are versioned separately. No blanket disabled suite is acceptable.

Concrete seams from the reviewed candidate: `check-next-artifact.sh` assumes the
provider lives in `.next-advanced`, includes WebGL and exposes a separate Browse
names button; `check-progress-copy.mjs` asserts frame-only morph copy and old bridge
source patterns. Photo/crop tests read `Product.fs`, bridge-import checks inspect
generated `.fs.js`, and Fable project qualification invokes `ProjectJson.fs.js`.
Without .NET, golden project JSON and state transitions come from driving the control artifact in a
headless browser (with `project-v1.fixture.json`), not from compiling F#. Replace those specific
expectations when the corresponding provider/UI/progress / TS changes land, preserving their relevant behavioral coverage. Test discovery,
workflow path filters, artifact hashing and retained browser/research consumers must cover new
`apps/web`/package paths instead of only `src/Next`. Artifact lookup inputs name
source repo ID, workflow/run, commit and artifact explicitly; inherited `context.repo`
or a corrected org prefix alone cannot locate a classic artifact from the new repo.

Map deliberate release changes without deleting retained coverage:
`browser/runtime.test.mjs` GPU-to-CPU retry, `browser/route-priors.test.mjs` CPU ordering
and mobile-runtime/resource checks still protect app behavior. Update WebGL-only
expectations when that execution route is removed; retain adapter probing, bounded
failure fallback, successful-slow preference, background watchdogs and completed outputs.
Retain independent provider/reference tests in their qualified library scope. Native packaging/parity
checks are historical or retired, not silently substituted for browser checks.

### Application migration

Start only after the destination's imported JS closure passes its mapped checks and the control
artifact is pinned and exercised. Execute ordered, separately recorded milestones. First, a strict-TS
typed facade over the retained bridge, executed through the real bridge in a headless-browser
harness (the existing runtime test page and local server are the starting point). Then the
controller port: the F# `update` function and `ProjectJson` as pure typed reducers and schema code
with transition tests, goldens recorded by driving the control artifact. Then the rendering port:
React components that keep the `.next-*` DOM/class contract and carry `product-ux.scss`, on Vite from
the first build with worker bundling, production headers and the `deploy-next/` contract. The last two
are the TS/React milestone, split at the controller/rendering seam.

**Freeze the flow matrix first (a gate before the controller port).** The
[user-journey table](#ui-flow-matrix-and-open-journey-contracts) mixes behaviour the control artifact
has with behaviour this plan adds. Before porting, drive the control artifact through every journey row
and record one of three classes per row: *present and unchanged* (parity-graded), *present and changed
by a declared UX change* (graded against this plan's specification after parity, citing the change in
this plan's live requirement sections (the UI requirements table, the flow matrix and the known candidate defects), which the application inventory's defect ledger keeps current)
or *absent* (new, specification-graded). Only the first class gates the port. The output is the Playwright
parity spec itself: one test per journey row, tagged `parity`, `changed` or `new`; its run against the control
is the grading. A row that cannot be exercised against the control is a skipped test with its reason, never a
pass.

**Control custody.** The control is a hash-pinned built `deploy-next/` artifact. Keep its bytes
somewhere that does not depend on classic staying alive: a release asset of this repository (the
classic CI artifact it came from has limited retention, so it is not enough alone), with the SHA-256
recorded in the repository and re-verified before every parity run.

**Golden capture, with a stated fallback.** Reducer-level goldens assume the minified control bundle
exposes its Elmish message stream. The first spike (a few hours) tries to observe messages and model
states for one flow through the control bundle (a development hook, the bridge's events, or DOM state
transitions). If it works, record reducer transitions. If it does not, record DOM and state snapshots
at journey-step level through Playwright and test the reducers against those, a coarser but still
observable oracle. Record which was used.

**Versions during the port.** The port builds on the first destination lockfile, which already carries
latest-stable React, MUI, Vite and TypeScript ([dependency currency](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026));
that lockfile is the baseline, so there is no port-on-old-versions step. Structural parity (DOM
contract, states, text, flow, project-JSON round trips) is exact. MUI v4 to v9 restyles, so pixel
differences in screenshots are reviewed and recorded, not gated; anything that hides, overlaps or
mislabels a control is a defect. Later bumps are grouped revisions kept apart from behaviour changes.

**Controller port versus the operation layer.** The controller port is the UI state machine only: the
model, messages and `update` equivalent, `ProjectJson` and view state. Scheduling, residency
reservations, intent snapshots, cancellation and whole-action progress belong to the
[application operation controller](#application-operation-controller), which exposes a narrow
operation-service interface that the reducers call. The port ships reducers against that interface;
until the controller workstream lands, the interface is backed by the retained bridge's behaviour.

**No time box, no fallback (operator decision, 17 October).** The port starts immediately and runs to
completion. There is no checkpoint date, no failing-row threshold and no .NET fallback: the operator's
ruling is that the team can do this, and that the new repository takes no hacks, backports or
patches for legacy code. If the port meets a real blocker (for example `ProjectJson` cannot round-trip the
fixture), it is reported as a blocker like any other and fixed in the TypeScript, judged against the same
control artifact; the answer is never a .NET build, an F# import or a change to classic. The earlier
two-week/25% proposal and its container fallback are withdrawn.

Parity is judged against the control artifact: the frozen UX/flow matrix through Playwright, the DOM
contract, responsive screenshots, project-JSON and recovery round trips, and the numerical and
performance cells, which stay unchanged because the compute path is the same JS. Each milestone
consumes the previous milestone’s functional checks and preserves the integrated performance paths
identified in the baseline note. Carry the actual candidate code forward; equivalent visual output
alone is insufficient if warm reuse, bounded resources, restoration or export reuse are lost. The
facade uses retained-candidate adapters before extracted packages exist; it does not depend on
[compute extraction](#compute-extraction). Declared UX changes ([face controls and modals](#face-controls-and-modals),
[static names and picker](#static-names-and-picker)) land after parity in separate checked
revisions, so a port is never combined with untracked UX drift; remove native runtime/media dispatch
under the declared retirement revision with equivalent browser behavior checks. No compute/model I/O
or giant bridge singleton moves into React. The new app never builds F#; classic retains its original
build. These stages consume the latest separately qualified app/runtime; preserved behavior does not
require internals to remain physically untouched after checked extraction. Keep facade/port/build
changes apart from engine changes in each revision.
Acceptance: the intended existing Next flows behave as in the control artifact before the deliberate
[face controls and modals](#face-controls-and-modals)/[static names and picker](#static-names-and-picker)
changes; source/asset identity and supported on-origin/file compatibility stay explicit. No
old-server pixel/URL parity or phone pass is required.

### Compute extraction

Begin after the typed facade executes through the real bridge in a headless-browser
harness, frozen contracts and applicable workspace/build checks pass, and manager
loaded handles are accepted. The port is not a prerequisite; final integration joins both.
Move mapping/synthesis/photo orchestration, loaded-provider contract adapters and numerical gates into
`stylegan-js` as strict TS using [model manager extraction](#model-manager-extraction) loaded handles. Emit consumer-ready JS,
public `.d.ts` and explicit worker exports without app aliases or React dependencies. Remove engine-originated downloads and
caches. Provide a minimal consumer example using a caller-loaded model. Acceptance:
no weights/fixture blobs, host URLs, OPFS, UI or reporting transport in engine package;
the app's qualified CPU/WebGPU/mobile and WASM-helper behavior and cancellation pass applicable
checks; independent library CPU/reference capabilities are separately documented
and qualified, without native product-distribution requirements.
Use the [small raw-synthesis tolerances](#synthesis-correctness-and-export-quality),
not encoded-image equality or visual-only evidence, to qualify inference.
The clean consumer executes with its caller-loaded capability without importing the
manager; package construction and status reads start no acquisition.
Check descriptor-driven mapping, synthesis and morph geometry with a qualified
caller-loaded reference, including a different output resolution/latent layer count
and descriptive rejection of unsupported descriptors. These component checks unblock
media/application integration; they do not establish complete non-face package
support. The full external-developer journey closes in integrated verification after
conversion, manager, media and hosting integration are ready.

### Media and recovery

Split media computation from user-gesture Save/share. Export raw-pixel
PNG/lossless-WebP encoding and recovery extraction; reuse the candidate’s image
envelopes, MP4 project metadata, format readers, codec fallback and prepared-file
reuse. Document format/metadata limits and corruption behavior. Preserve product
lossy compatibility as explicit policy. Every offered Save/Share format must embed
and recover latent/model data (and full project data for morphs); do not introduce
metadata-free exports or another encode/inference pass for sharing.
Apply the [separate export-quality and recovery rules](#synthesis-correctness-and-export-quality):
compression/container differences are allowed and hashes describe the actual file.
Acceptance: round-trip latent/model provenance, playable media, first/repeated Save,
still-image UI re-import, MP4 internal metadata-reader validation and promise/surface
cleanup; external MP4 project-open UI is deferred; no hidden additional encoding/inference.
Check distinct source files sharing a basename, multiple crops, text/seed/name inputs,
reversed morph endpoints, linear/figure-eight/settings changes, truncated or invalid
labels and forced suffix collisions. Different export identities stay distinct;
repeated export of identical prepared bytes keeps its name. Optional browser file-picker writes must not
silently overwrite; browser suggested names cannot guarantee filesystem uniqueness.

### Confirmed-crop encoding

Reproduce the crop-confirm failure in the actual built UI. Use [application inventory](#application-inventory)'s
`docs/plans/repo-cleanup-and-architecture-refactor/inventory.md` and [package and operation contracts](#package-and-operation-contracts)'s
`docs/plans/repo-cleanup-and-architecture-refactor/contracts.md` preprocessing/loaded-handle sections.
Trace `src/Next/product-bridge.mjs`, `src/Next/browser/runtime.mjs`,
`src/Next/photo/align-photo.mjs`, `photo-runtime/align-photo.mjs` and worker provenance.
Replace the conflicting exactly-one-face requirement for a versioned confirmed-crop
policy: selection/multi-face handling precedes confirmation, and an eligible confirmed
crop can execute direct e4e without another successful detector pass. Eligibility means
decodable supported pixels within declared size/shape limits, explicit orientation,
alpha/color handling and the qualified encoder's preprocessing requirements; it does
not mean successful redetection. Freeze all eight EXIF orientations, resizing,
normalization and crop coordinates in the contract and cache/provenance identity.
Complete detector-driven alignment/warping for a proposed crop before user
confirmation and display that proposal. After confirmation, apply only the frozen
orientation/rotation/resize/color/normalization preprocessing to approved pixels.
Do not redetect/rewarp approved geometry; optional validation cannot change pixels
or block eligible direct-crop e4e. Preserve cancellation/input revisions and
include forced successful and failed detector/alignment outcomes proving the same
confirmed-pixel preprocessing identity, without another crop prompt.
Acceptance: built-UI forced detection/alignment failure after confirmation executes
real e4e once and finishes or reports an actionable terminal error without reopening
crop. Include every independently confirmed multi-selection crop with click-order
identities and bounded serial e4e scheduling; no partial failure restarts the batch
or creates duplicate keypoints. The single-crop built-UI cases run here on the
existing crop flow; the multi-selection cases need the batch UI and are accepted in
[face controls and modals](#face-controls-and-modals), which therefore follows this
workstream rather than the reverse. Include no-face/multi-face/oriented/non-square/malformed fixtures, cancellation
and stale revisions; numerical/manual-crop-path qualification is independent of speed.

### Morph pipeline

Move geometry/infill/frame-store/writer orchestration behind `renderMorph`.
Keep canonical indices, presentation order and application URL/retention ownership.
Test cached frames, raw sparse anchors, blob stream, bounded sequential browser paths and
retained-then-encode paths with their different callback/drain semantics. Acceptance:
endpoint reuse, bounded bytes, cancellation during production/finish, stale callback
rejection, full playable video and restored scrub state; all shape modes survive.

### Research evaluator

Wrap existing drivers rather than interpreting generic success. Start
from `autoresearch/candidates/direct-rgba-media-v1/built-ui-paired.mjs` and `scripts/next-e2e.md`; historical
analysis pins old source/artifacts and must not be repurposed. Add versioned adapters
for driver correctness/timing scope and extend supported release workloads. Collect
control/control evidence and lock margins before making optimization claims;
[application migration](#application-migration) migration and operator cutover do not wait for this research campaign. Acceptance: complete
context/raw noise reports; invalid/missing/expected-failure cases yield correctly
scoped verdicts and cannot become speed wins or release certificates.
Add versioned overlap/warming adapters from the [targeted launch contract](#targeted-autoresearch-launch-and-preserved-history),
with explicit grants/owners, stage timelines and independent confirmation. The
existing auto-consent/file-injection driver cannot establish native chooser latency.

### Integrated verification

Check the intended working app, building on the existing candidate’s
useful checks: generate text/seed faces; select a name instantly; encode a confirmed
photo; morph supported inputs including unfinished valid words/seeds; cancel/retry;
play/scrub; Share/Save and reopen metadata-bearing still images. Verify MP4 metadata
through internal readers; external video project-open UI is deferred. Include the declared UI changes and diagnostics behavior.
Compare pre-compression network synthesis within the [frozen small numerical margins](#synthesis-correctness-and-export-quality),
and exports under their separate quality/recovery rules; image file bytes need not match.
Use available relevant devices/checks, record unsupported or untested cases, and
fix actual correctness, privacy, cancellation and resource errors. This is not
full parity with the historic API or a separate shutdown-qualification campaign.
The [strictly-not-worse gate](#strictly-not-worse-than-the-candidate-operator-24-october-2026) against the pinned candidate, iPhone included, is part of this verification.
This does not waive existing Android/iOS Simulator, desktop-browser or real-GPU
lanes: retain the [CI matrix and applicable no-regression checks](#platform-ci-retention-and-performance-preservation),
and fix any regression the gate finds before promotion.
For new architecture artifacts, retain [workspace build and artifact identity](#workspace-build-and-artifact-identity) lint/format/type checks, independent
compute/conversion checks and clean package consumers; source/license/notice and
weight-exclusion checks apply to artifacts actually being published. Record the
small intended-feature matrix and which version was exercised.
Include preflight-without-model-network evidence, denied/skipped/timed-out checks,
unknown calibration, context-specific photo/synthesis estimates, cold/warm overhead and
material-cost change consent. Exercise composed scheduler dependencies, runtime snapshots,
shared-download ownership, and whole-action progress through default file readiness.
Exercise Generate and Generate-and-encode approvals, optional photo costs, synthesis-first readiness,
photo choosing/crop review during approved transfer, seed generation before encoder
completion and Cancel before/after crop OK. Verify responsive foreground work and
bounded aggregate transfer buffers; unfinished optional preparation never blocks
completed-result actions. If warming ships, test verified-cache warmup on eligible cached routes,
missing/corrupt/runtime-asset cases with zero speculative network, immediate foreground
preemption/settlement, warm ownership transfer and constrained phone encoder teardown.
Recovered/static results satisfy their requests without inference startup. Keep
uncalibrated time fields honest and slow-work WebGPU-computer copy contextual.
Delay/fail face-file preparation while Morph consumes compute-ready inputs; confirm
bounded endpoint reuse, no duplicate inference and independent file-preparation Retry.
Exercise mixed recovered-still/photo batches before Cancel and OK, checking exact
click order, no partial import, no recovery re-encoding and per-slot error ownership.
Check admission during provider/model loading and idle retained residency, not just
serial final inference calls.
Verify action-gated acquisition, unknown cache status, Escape /
backdrop/Cancel, no late continuation, and no model prompt for static names or valid
cache hits. Inspect default modal copy at narrow widths: irrelevant operation rows
and technical breakdowns stay out of the main decision. Check prediction error against available paired measurements;
record uncalibrated cells honestly. Verify the packed or published packages' real
non-face clean-consumer example independently of the FaceMorph app: trusted checkpoint
acquisition, pinned container conversion and independent reference checks,
developer-controlled static hosting, manager-loaded and directly caller-loaded
inference, morphing and PNG/lossless-WebP export/reopening. Only this joint proof
qualifies the documented non-face capability; component completion or publication
alone does not. Local packs allow the proof before npm publication.

Exercise the [placement/degradation contract](#clean-ui-placement-and-useful-degradation)
in the actual built UI: phone CPU and eligible phone GPU/photo paths, unavailable
operations, null adapters/insufficient limits, failed canaries, slow admitted work
and active device loss. A missing GPU must not trigger GPU downloads or disable qualified
CPU generation. Known-ineligible operation routes stop before their detector/model
network or crop work; another supported operation remains usable. Full-model checks
may fail after authorized acquisition: preserve bounded qualified CPU fallback,
revised assets/cost consent and contextual Retry, never native fallback. No
desktop-download recommendation appears. Use the [research preservation map](#autoresearch-coverage-and-preservation-map)
to check adapter probing, visible-time watchdogs, worker-start/failure separation,
constrained worker teardown and phone encoder limits without reinstating the expensive
per-device lab encoder check in ordinary product startup.
Names, recovery-first file entry, compatible completed playback and Save remain usable
subject to their actual asset/codec capabilities. Verify timing skip cannot bypass
admission, and viewport width/touch hints cannot suppress an eligible route.
Include catalogue failure/offline uncached results, denied/quota-limited storage,
known-unavailable MP4 preparation, post-inference export failure and lost photo
retry pixels after reload. Check whole visible output and decoded full-size face /
complete admitted-resolution video bytes, including disclosed 512px fallback,
contextual reason/Retry/Help placement and no duplicated
warning panels. These UI/negative checks use available browsers/mocked capabilities;
they do not add physical-phone inference qualification or promise measured usability.



**Responsiveness acceptance:** inspect the actual app across a width sweep, not just
mobile/desktop endpoint screenshots: retain 320/360/390px samples, include intermediate
widths (for example 480/600/768/900/1024px), wide desktop and widths immediately either
side of each actual layout breakpoint. Resize continuously through transitions and
change portrait/landscape or window height while the names/crop/download modal, keyboard
focus, queue/progress and results are active. Include short viewports, long names/errors,
browser zoom/text enlargement and touch virtual-keyboard occlusion where available.
Face/crop geometry must stay correct; menus, primary actions, progress and dismissal
remain visible/reachable with sensible scrolling, no overlapping/clipped controls,
page-wide overflow or lost focus. Check grid reflow with 1, 2, 3, 4, 8, 30, 64 and 150 faces at each width in the sweep (the many-face rules in [face controls](#face-controls-and-modals)).
Record exact tested viewport/zoom/artifact and unsupported environments. These are
layout checks using available browsers/devices, not a new physical-phone release gate.

Acceptance applies to the final integrated app after the planned UI and package
changes, not only to an intermediate unchanged migration. Check it against the
identified Next branch baseline: existing features remain usable, the planned
additions work, and every intentional difference is accounted for by this plan.
The examples above are representative checks, not permission to drop unlisted
Next features. Check preservation of existing warm reuse, bounded pipelines,
session/video/scrub recovery and export reuse without requiring a new performance
campaign or historical API parity certification.

**Structure for decomposition and pass criteria.** Integrated verification is four sub-results run by one
release-verification workflow against one artifact digest:

1. *App flows:* the journeys, cancellation and recovery checks above, with the parity-graded rows
   of the frozen flow matrix and the specification-graded rows for the planned changes.
2. *Platform and resource:* consent, overlap, scheduler, degradation and the responsiveness sweep.
3. *Packages and non-face:* clean consumers, conversion and the non-face joint proof.
4. *Release artifact and evidence:* identity, the retained lanes and the preservation of existing
   performance paths.

The workflow writes one release summary: the artifact digest, each sub-result's pass/fail/untested cells, the
tested browser/OS list that Help copies, and every unsupported or unclaimed capability. The operator's cutover
decision reads that summary. A check passes only if it ran against the
named artifact on the named platform and met its stated threshold (numerical tolerances unchanged,
parity-graded rows exact, defects fixed). Otherwise it is recorded as failed or untested, and claims
are limited to the cells that passed. A threshold still unmeasured when this runs (device-check
prediction error, warming benefit, estimate budgets) is decided at its contract milestone; until then
the check is reported as "measured, no threshold" and never as passed.

### Acceptance receipts and gate-style acceptance

Added 16 October after both reviewers found that several workstreams were accepted only by prose such
as "record" or "accepted explicitly".

**Evidence.** A bead's evidence is its merged commit and the CI run on it. Two file receipts exist, because an
irreversible action reads them: the API retirement (what was removed, with the runbook's commands) and the
old-report deletion (count and key-list digest). The release summary (integrated verification) is generated
by CI.

**Network assertions.** End-to-end tests that claim network or consent behaviour (consent, warming, names,
device check, diagnostics) intercept requests and assert on them by host class and bytes, never from a
screenshot. Traces and screenshots are kept on failure. Unit tests accompany each
workstream's own logic; the integrated journeys live in integrated verification.

**UI acceptance is operated, not queried (18 October).** The candidate's Remove control passes its checks and is
unusable for a person ([defect 1](#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026)),
because the checks click by accessible name. So every UI acceptance in this plan follows these rules:
(1) act with real pointer or touch input at the control's visible position, and also assert that the element at
that point is the control (`elementFromPoint`) and that it lies inside the region a person would look in;
(2) a by-name or by-role click is allowed only to set up state, never as the acceptance step;
(3) every list-like or repeating control is exercised at 0 or 1, 2, 3, many and, where a real resource limit exists, at that limit and its degraded state, and every
text-like input with an empty, a very long and a pasted value;
(4) check the result on a phone-width and a desktop-width page and keep a screenshot per case;
(5) a first look at a flow is done by operating the running app (as in the operated check above), because a
reading of the plan or the source cannot see what is covered, clipped or off screen.

**Acceptance for workstreams that had none:**

- *Organization rename:* the rename acceptance in [organization rename first](#organization-rename-first-known-reference-changes).
- *Domain handover and retirement preparation:* the retirement runbook's commands run in a dry run where the
  provider allows; the snapshot of published previews and latents restores; a scan of the production build
  (a CI check) finds zero links to a retired host or to the candidate branch.
- *Delivery and publication:* each action's workflow runs the post-delivery smoke check (the app loads, a
  diagnostics report is accepted, models load). No action's completion is inferred from another.
- *Classic wind-down:* each stage is a commit gated by its CI precondition, run without a human approval
  step. After the last stage the default branch's tree lists only the distribution,
  its README and its rot-check workflows; the recorded README-executed clean-clone acceptance is re-run
  on that tree and passes (a path it shows to be needed is restored); the research tree is present in
  this repository byte-identical; the Git history is unchanged and no branch or tag was deleted.
- *WebGL removal ([provider simplification](#provider-simplification)):* decided 17 October from the route
  read in that section; the remaining check is that a phone without admitted WebGPU finishes on CPU.
- *Application operation controller:* fake-clock scheduler tests cover permit versus residency, Morph
  yielding its permit, joining an existing operation, cancel at each boundary and no starvation; one
  real-bridge run asserts the operation event log against the expected trace.
- *Acquisition consent:* grant state-machine unit tests; a request-log run asserts zero model-host requests
  before approval or after Cancel, synthesis-first order, and zero requests from warming unless it shipped.
- *Device check and estimates:* fake-timer tests of the stated budgets (about two seconds of sampling, the
  five-second UI deadline, 16 MiB of scratch buffers, 100 KiB of checker code); skip, timeout and GPU loss
  each yield "no reliable estimate"; the network log shows no model fetch.
- *Package and operation contracts:* type-level tests per union, validator fuzzing, and an external consumer
  compiling against the emitted declaration files.
- *Dependency currency lane:* a dry-run bump that widens a numerical tolerance or removes a cell is
  rejected; the bleeding-edge lane is non-blocking and its output never reaches `deploy-next`.

- *Typed failure causes:* a forced failure at each listed stage (corrupt photo, refused route, storage full,
  broken download) produces the matching cause and stage in the report, and a scan of the test reports finds
  no `unknown` without a counted defect.
- *Old-report deletion:* runs only after the note is committed; the receipt records the count, the
  key-list digest, the go-live moment of the corrected line and the post-deletion count of the deleted
  set (zero); no object uploaded after the go-live moment was deleted; no raw working copy remains on the
  analysis machine; the bucket has no expiration rule and the new disclosure states retention truthfully.


### Decomposition order, size and tracker coverage

Added 16 October from the cross-model review and a fresh-context structural review; both
reported "ready after listed fixes", and the fixes are in the sections above. Execution
decomposition itself is still a separate requested step and has not started.

**Bead size and ceremony (operator, 24 October 2026).** The first conversion produced 373 beads, which the
operator judged too fine-grained: per-item receipts, join nodes and bookkeeping items cost more than they
protected. These rules replace the earlier estimate of about 250 items:

- A bead is a shippable slice of capability: one coherent change with its own unit tests and, where it has
  user-visible behaviour, its operated end-to-end check. That is typically one to a few days of agent work.
  Splitting stops at "one reviewer can check it in one sitting", not at the finest seam.
- No bead whose only output is a record (an inventory note, a decision entry, a receipt, a map), unless a
  named later bead or decision reads it and cannot go ahead without it. Otherwise that output lives inside
  the bead that needs it.
- Milestones are the work items that complete them, not separate join nodes.
- A "milestone" edge in the Needs column (for example "typed-facade milestone") points at the bead that
  completes that milestone. Apart from the root entry bead (`fm-fy2`, which has no edges), there are no epic, workstream or milestone beads; the workstream is a label.
- Edges come only from the Needs column and the mandatory ordering edges. Soft preferences and Feeds cells are
  not edges.
- Optional work (extra export formats, verified-cache warming, the research evaluator) is one deferred bead
  each. Planner proposals awaiting a veto go inside the owning bead's acceptance as a removable clause.
- Size limit: a reviewer can check it in one sitting, roughly under 1,500 changed lines excluding pure moves
  and generated files.
- The target is about 100 to 140 beads (an estimate).
- An ordinary bead's evidence is its merged commit and the CI run on it, with no separate receipt file. Full
  [receipts](#acceptance-receipts-and-gate-style-acceptance) are kept only where an irreversible action reads
  them: the API retirement and the old-report deletion. The CI-generated release summary from integrated
  verification is what the cutover decision reads.
- Operator decisions live once, in the dated table in PLAN.md; there is no separate decision log. Planner
  proposals are listed once in [remaining choices](#remaining-choices-completion-and-cutover-authority), not as
  tracker items.

**Split first, in this order** (each section already names its seams): face controls and modals
(crop and dialog, photo batch, result export, many-face layout and removal, morph layout and the responsive sweep as separately
accepted items); application migration (flow-matrix freeze, facade, controller, rendering, parity
harness); integrated verification (the four sub-results); classic distribution (reproducible
inputs, one-command startup, GPU and runtime acceptance, recurring rot detection); contracts (two
milestones); workspace build (CI-lane carry-over alone is large); delivery with domain handover; static
names; diagnostics (learnings ingestion first); device check and acquisition consent.

**Tracker state (24 October 2026).** The plan was converted to Beads on 24 October (`.beads/issues.jsonl`, `br`
and `bv` installed from verified release binaries), then consolidated to the bead size above. The 22 earlier
item IDs (`fm-fy2*`) are kept on the beads that absorbed their workstreams. Each bead's `external_ref` is
`plan:<key>` and its workstream is a `ws-<name>` label. Hierarchy never uses `parent-child` links, which block in
`br` and deadlocked the first graph. All beads stay deferred until implementation is explicitly started.

### Delivery and publication

On the operator’s explicit cutover decision, deliver the chosen working
candidate through its correct source/deployment path to `next.facemorph.me` and/or
`facemorph.me`, and retire hosted Triton inference, encoder/legacy API hosting and both
`api.facemorph.me` and `checkface.facemorph.me` using [domain handover and retirement preparation](#domain-handover-and-retirement-preparation)’s concise action list.
October 25 is aspirational; neither a date nor a test score triggers this decision.
The operator may use the existing working candidate before all monorepo/package /
research workstreams finish. Keep the delivery stages separate:
candidate-source handover, production promotion, API retirement, reusable-package
publication, [independent published-package acceptance](#independent-published-package-acceptance)
and classic publication are distinct actions. [integrated verification](#integrated-verification) applies when
claiming new-monorepo release qualification; an earlier retained-candidate promotion
uses its own available ordinary functional/artifact evidence. Do not infer one
action's completion from another. Any promoted release artifact, including an early
retained candidate, preserves qualified browser CPU/WebGPU/mobile behavior and retires active native
recommendations before promotion; unchanged local migration comparisons may retain
historical controls until the declared scope revision. For an early retained-candidate promotion, record
the chosen artifact's actual feature limitations and retained static origins. The edits
this plan lists against the candidate source (organization links, retirement and FAQ
copy, native-link removal, host rebinding, names-limitation text, and the repairs of known candidate defects that are one rule or one string: the Remove control, text-field capitalisation and the copy and spacing typos) are ordinary work on
the working candidate and need no separate approval (operator, 18 October). They are made on a
non-deploying classic branch and merged only after the ordinary qualification, because
the candidate branch publishes on every qualified push; they are owned by this
delivery action, prepared from the domain-handover list. Its
current name picker still synthesizes; redirecting the names hostname to it does
not establish the planned inference-free selection path. Preserve the independent
preview/latent assets that artifact uses, and report remaining work plainly.
If static names are incomplete, do not promise phone result selection/Save from a
preview; show the actual limitation in its owning action and record that the final
static-name contract is not complete. Redirects or phone inference cannot substitute.
Production starts fresh: no old GUID resolver, result-sharing URLs, historic-data
migration or cross-origin OPFS/session transfer. Update retirement/FAQ/fallback
copy accordingly and keep names/model/diagnostics hosting functional. Record the
actual source/artifact and actions performed; use ordinary post-delivery checks
that the chosen app and diagnostic endpoint work. Do not add a phone or full
shutdown-parity certification. Package publication remains a distinct action
after its actual pack/install, metadata and license checks, and needs no operator decision (24 October); unfinished package
work does not force the hosted GPU/API to stay on.

### Model manager extraction

Split `Assets/model-cache.mjs`, shard/OPFS stores, acquisition/session
setup and manifest logic into model manager. Preserve keys/hashes and reject corrupt
chunks with bounded recovery.

**First milestone, "loaded handles accepted"**, is what [compute extraction](#compute-extraction)
waits for: the typed loaded-handle contract, verified-local-only reads with typed
invalidation, and one provider adapter ported from the retained candidate passing the
disposal and lease cases below. The provider adapter is the manager's; compute
extraction consumes it and moves only the engine-side orchestration, so neither
workstream claims the same code. The rest of the manager (quota, eviction, extra
cache backends) proceeds in parallel and does not gate compute. Acceptance: load/cache/read/reload/quota/checksum/error
and cancel cases, no download before authorization, no unnecessary download when
an output cache hit can satisfy the action, and proper loaded-handle disposal.
Test missing/corrupt shards after admission, leased-cache deletion, cross-tab
effects, cancellation and disposal: every affected operation settles, releases
resources and reports typed invalidation without hidden network repair.
Verify both OPFS and Cache Storage local-only handles: disk presence/unchecked peek
cannot bypass digest validation, and speculative reads cannot fetch replacement data.
The app owns selected bundle consent/priorities and eager-warming policy; reusable
manager APIs expose typed acquisition/local-read/load/disposal capabilities only.

### Model hosting extraction

Start from `hosting/next-static/{stage.py,restage-runtime.py,mirror-runtime.py,
promote.py,webgpu_contract.py}`, `hosting/next/prepare-runtime.py`,
`src/Next/browser/stage-assets.py` and photo-runtime staging identified by [application inventory](#application-inventory).
Extract model chunk/manifest hosting, preserving pins and public/private boundaries.
Separate frontend/catalogue/diagnostics and application-domain promotion policy;
existing staging/promotion scripts must not be moved wholesale into this package.
Record commands, inputs and schema in `packages/cloudflare-model-host/README.md`.
Qualify staging and an explicitly identified test origin here; final production
promotion and live-byte receipts belong to [delivery and publication](#delivery-and-publication). Document independently usable
hosting instructions and verify current limits for the exact artifacts. Acceptance:
record the chosen Cloudflare product/tier, total bytes/file count, per-file/chunk
limits, request routing and storage/request/bandwidth allowances. Verify model
requests use the intended path without accidental Worker invocation. If qualified
artifacts cannot meet the free-tier target, record the limitation and resolve an
explicit hosting/cost decision before production publication; do not silently
enable paid services. Every published chunk reconstructs its declared asset, client manager/engine agree
on schema and hashes, and the exact tested headers/runtime bytes are served.

### Application deploy and collector re-homing

Owns the application's own deploy path, which the layout and the hosting extraction
above deliberately leave out: `hosting/next-static/` (frontend staging, runtime
restaging and mirroring, `promote.py`, `attach-domain.py`, the entry Worker and
analytics), `hosting/next/` (runtime preparation), `hosting/next-cloudflare/` (the
diagnostics collector Worker with its tests), `hosting/gallery/` (the names-catalogue
pipeline) and the `deploy` job of `next-site.yml`. In classic the four directories are
about 4.3 MB across 48 tracked files; the collector directory also tracks
`.wrangler/` cache and state files that must stay out of the import allowlist.
Without this workstream the monorepo has no way to publish `next.facemorph.me`, and
classic cannot be wound down (see [end state](#end-state-of-the-repositories)).

Rules: the reusable `cloudflare-model-host` package gets only chunk and manifest
hosting; frontend staging, promotion policy, the collector and the catalogue pipeline
live here. Import from committed objects with the same allowlist and provenance as the
rest. Promotion keeps its structural gates and **fails closed**: a missing research
ledger, kernel provenance or qualified-artifact proof is an error, never a skipped
check (see the promotion coupling in [autoresearch re-homing](#autoresearch-re-homing)).
Any publish remains an explicit operator action (`--publish`), and exactly one
repository's workflow may publish a given target at a time.

Start after the [application inventory](#application-inventory), candidate import (the
`build:next` and `deploy-next/` contract), the boundary decided in
[model hosting extraction](#model-hosting-extraction) and
[autoresearch re-homing](#autoresearch-re-homing) stage 1. Acceptance: from a clean
clone, staging and a non-publishing promotion dry run against a qualified artifact
reproduce classic's receipt fields; collector tests pass; the catalogue pipeline
runs without the hosted API; promotion refuses to run without the ledger.

### Conversion tooling

Package existing converters with pinned sources, reproducible invocation,
model architecture/shape/output declarations and accepted numerical evidence. Include
official FFHQ and the real non-face checkpoint from the external-developer journey;
resolve any unsupported proposed fixture with a compatible non-face checkpoint and
document the actual support boundary. Until this passes, non-face support remains
unqualified rather than an advertised completed capability. Acceptance: supported
formats can be loaded by the manager/engine, acquisition docs do not imply bundled
weights or blanket support for every third-party pretrained model.
Implement the container contract in `PLAN.md#language-and-framework-direction`:
Dockerfile, pinned base-image/tool/dependency versions, bounded build context and
opt-in Compose service; read-only checkpoint inputs, writable outputs and explicit
cache volumes/file ownership. Document clean-clone build/convert/verify commands,
CPU support and optional verified NVIDIA setup. No weights are bundled in the image.
**Distribution (defined 17 October).** The converter ships as that Dockerfile and opt-in Compose service in
the public repository at a tagged release, base images pinned by digest. There is no registry image (the
same reasoning as D5: the container carries upstream licensed code), and any later registry push needs a
licence check first.
Acceptance also includes empty-cache/repeat and failure-cleanup container runs,
image/source/input/output provenance and independent numerical checks; unsupported
CPU/GPU/architecture cells remain explicit, not substituted with silent fallback.

### Classic distribution

Inspect `self-host/compose.yml`, `self-host/compose.gpu.yml`,
`self-host/setup.py`, `self-host/Dockerfile`, `self-host/legacy-route-inventory.json`
and `self-host/verify.sh`. The remote default branch is `master`, which also publishes legacy
production through Vercel; current self-host work is on `candidate/next-delivery-20260916`. Follow
the branch plan in D4 (a dedicated frozen branch and tag, default-branch change only on the stated
conditions, never a merge into `master`). The quickstart is the three-line sequence in
[the one-command contract](#dependency-currency-and-the-frozen-self-host-guarantee--16-october-2026),
using a root `compose.yaml` and a `cd` into the clone directory only; the old multi-step commands and the
wrong `cd facemorph.me/self-host` are removed. Qualify the exact documented fresh-clone /
Compose commands, not an already prepared local tree. Reconcile existing PyTorch self-host with the sibling legacy server's API
inventory; migrate only missing verified functionality into the classic successor.
Replace the current manual setup-profile step with a documented CUDA Compose
entry point whose API waits for checksum-verified setup and logs the URL. Preserve
explicit model-term acknowledgement; never silently inject acceptance. The NVIDIA
host prerequisites and GPU configuration remain explicit. Test interrupted/failed
acquisition, verified-file reuse and startup failure without CUDA. Acceptance: genuine GPU startup from empty
volumes plus restart, original UI/API/photo/morph/media compatibility and direct
author model acquisition; record all untested host/CPU/GPU limitations. Retain the existing
`self-host/validation/2026-10-10/gpu.json` evidence as historical: one GPU/driver,
synthetic inputs and source-only delivery. Existing route tests establish neither
production encoder parity nor byte-identical historical pixel outputs.

### Application operation controller

Owns the application-side controller and scheduler that the contracts describe but no
other workstream builds: input revisions, request and attempt IDs, per-slot
Cancel/Retry, one heavyweight operation per provider context with separate compute
permits and residency reservations, Morph as a parent intent that yields its permit
while awaiting dependencies, and whole-action progress through default-file
readiness. It is the operation-service layer that the language section keeps out of
React rendering. The [application migration](#application-migration) owns the UI state
machine (reducers, `ProjectJson`, view state) and calls this layer through a narrow
operation-service interface; the two are written in the same period and never both
claim the same code. Start after the contracts and the typed-facade milestone. Consumers are [face controls and modals](#face-controls-and-modals),
the [morph pipeline](#morph-pipeline) and [acquisition consent](#acquisition-consent-overlap-and-warming).
Acceptance: the scheduler, dependency, cancellation and starvation cases in those
workstreams and in [integrated verification](#integrated-verification).

### Acquisition consent, overlap and warming

Owns the application side of [consented downloads](#consented-downloads-useful-overlap-and-cached-model-warming):
the Generate and encode / Generate consent modal and bounded grant, the optional
**Prepare encoder** action, grant ownership with Cancel and resumption
semantics, synthesis-first scheduling under aggregate transfer buffers, and the
optional budgeted verified-cache warming. The reusable manager exposes capabilities
only (verified-local-only handles, leases, typed invalidation); policy lives here.
Start after the contracts, [model manager extraction](#model-manager-extraction) and
the TS/React milestone. The consent and overlap parts do not wait on warming, which
ships only if its targeted research round shows a foreground-safe benefit within the
memory and mobile budgets. Acceptance: the acquisition, cancellation and negative-path
checks in [integrated verification](#integrated-verification).

### Device check and estimates

Owns the model-free preflight checker, its versioned calibration against paired
measurements, and the range copy used by consent and slow-work guidance
([lightweight device check](#lightweight-device-check-and-pre-download-guidance)).
Start after the contracts (evidence and estimate types, budgets) and the TS/React
milestone. Calibration runs on development workers under the shared device lease and
may use the targeted research playbook. Unknown or uncalibrated estimates are a
supported state, so consent copy does not wait for calibration, and no result of this
workstream gates phone support. Acceptance: the preflight, skip/timeout and
prediction-error checks in [integrated verification](#integrated-verification).

### Face controls and modals

Use `PLAN.md#supplied-ui-references` and the confirmed-crop/ordered multi-selection
flow above to build a reviewable controls/modal design before behavior implementation.
Refactor the ported UI controller (specified by `src/Next/Product.fs` in classic), `src/Next/photo-selection.mjs` and the product bridge
behind the typed TS application controller, keeping React rendering separate.
Apply exact UI requirements above, including crop confirmation, paste equivalence,
mode-specific Generate/Cancel, hold-to-compare removal, ordered multi-face selection
and disabled Morph/right-of-progress Cancel. Make Share the primary result action,
with Save and compact WebP/PNG/MP4 choices as specified above; reuse metadata-bearing
exports, browser file share and same-file Save fallback. Test A→B versus B→A clicks, deselect/reselect,
zero selections, extra keypoints amid existing faces, crop adjustment for each selection,
stale target changes, mixed per-face failures and cancel/retry without duplicate IDs.
Cancel the first running face while later selections are queued; cancel a queued
face; verify only the selected slot stops, siblings continue in order, completed
faces survive and retry appends one existing slot without reallocating keypoints.
Cancel every selected slot, wait for all jobs to settle, then retry one without
file reimport or crop reopening. Verify input/pixel lifetime at and over [package and operation contracts](#package-and-operation-contracts) budget
ceilings and release after success/removal/replacement/disposal. Acceptance:
responsive rendered controls, keyboard/accessibility behavior, denied consent,
changed input/late result, file/clipboard entry, and Save/share usability pass the
actual app under the responsiveness acceptance sweep above. No post-encode crop button, hold-to-compare gesture/button or duplicate
filename remains. Match confirmation/editor/failure layouts from the inspected archive.

The [audit's repair rows](#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026) 4 to 8, 18
and 20 belong here. Acceptance adds a keyboard-only pass through every journey, a check that the text field turns off
capitalisation, correction and spell-check and sends the text exactly as typed, and one plain message for each refused
input (identical neighbours, over a real resource budget, empty word).

**Many faces and removal (added 18 October, from the [operated check](#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026)).**
The face row is designed for many faces, not for two; there is no fixed face count (operator, 24 October). Requirements:

- *Remove is a real control.* A visible close button on each face image, at rest on touch and desktop, not
  overlapped by any other control, reachable by keyboard, with a hit area of at least 44 by 44 px on touch
  widths (the drawn circle may be smaller). Its style must not be at the mercy of the component library's
  default ordering: the acceptance below tests the rendered result, not the stylesheet.
- *Undo and Start over.* After Remove, a short notice offers **Undo**, which restores the face in its position
  with its content. **Start over** in More options returns the project to two empty faces, with the same
  Undo. The last remaining face stays non-removable, as in the candidate. These two are the planner's
  proposal to make "I added thirty and want to remove twenty" bearable; the operator may veto either.
- *Many-face layout.* No page-level sideways scrolling and no hidden scrolling surface at any count, at any
  width in the responsiveness sweep. Past the width where two or three full tiles fit, the
  faces are a contained strip with a visible scroll cue (edge fade or arrows, and a scrollbar) and snapping,
  or a compact grid; on a phone, tiles beyond the fourth shrink to a compact row (small image, field,
  Remove) so that thirty faces take a few screens, not about fourteen. Past a hundred or so, the strip or grid
  renders only the tiles near the view (virtualised), so the page stays responsive. A Morph that would exceed the
  real frame, memory or storage budget says so before frame inference, with the estimate and the existing
  reduce-length option, rather than failing on a hidden count. The presentation is chosen against the locked
  references and these bars; the plan fixes the bars, not the pixels.
- *Where it lands.* The Remove repair is a one-rule change in the candidate and is ordinary candidate work
  that does not wait for the port; the port implements the full set above. The separately accepted item is
  "many-face layout and removal", in the split list for face controls.
- *Acceptance (operated, see the evidence rule below).* For 1, 2, 3, 4, 8, 30, 64 and 150 faces at every width of the
  responsiveness sweep (integrated verification): no horizontal page scroll; the layout shows a scroll cue whenever faces are off
  screen; each Remove control lies inside its face image; the element at the control's centre is the
  control; a real pointer click (touch tap on phone widths) at that point removes exactly that face and
  leaves focus on a sensible neighbour; Undo restores it in place; Start over works and can be undone;
  from thirty faces every Remove is visible and hittable, each tap removes exactly one face with no
  page reload, and Start over returns thirty faces to two empty faces in one action that Undo reverses.
  Keep one screenshot per case on failure.

### Static names and picker

Compare the named legacy production embedded picker and legacy standalone
names site; preserve the latter's grid with the declared UI changes. Implement
the verified static-result contract above using [media and recovery](#media-and-recovery) recovery helpers and [model hosting extraction](#model-hosting-extraction)
hosting, including catalogue asset preparation/qualification. Do not carry forward
`ChooseName -> RunFace` or mistake a historic JPEG preview for a complete result.
The data shape is open: `catalogue.json` is a candidate artifact, not a contract (see its
[requirements and bars](#names-selection-implementation-gap-and-complete-target)). Start with a
short spike that measures the candidate shapes against those bars (names text plus manifest plus
content-addressed results, with the integrity hash placement and preview packaging alternatives),
choose the smallest that meets them, and publish it beside the existing file.
Two parts with different prerequisites: the **catalogue result generator and
publication** (see the [current publication state](#names-selection-implementation-gap-and-complete-target))
needs the frozen contracts, the recovery-envelope helpers, hosting publication
machinery and a qualified generator, and can run before compute extraction; the
**picker and static-result consumption** needs the TS/React milestone of
[application migration](#application-migration) as its modal host. Either part may
land first. An unchanged-migration build keeps the candidate's synthesizing selection
and is labelled as such; the final contract never falls back to synthesis.
Acceptance: gapless overlay-name grid, no search/header/x, explicit target,
keyboard/touch dismissal, cold/offline/corrupt/stale selection states, and successful
selection/Save/reopen with generator acquisition and inference disabled. Morph
then acquires the generator only with consent. Test catalogue/model consistency,
bounded visible-preview fetching, modal Back/focus, selection-to-text editing, and
exact catalogue-versus-ordinary-text generation identity. No claim of
zero network latency or fully offline uncached browsing follows from “instant.”

### Provider simplification

Inventory WebGL app execution routes, canary/manifest dependencies, saved
preferences and report allowlists before removal. Remove WebGL execution only;
retain CPU/WebGPU selection, saved CPU preferences, CPU ordering and bounded
GPU-failure CPU fallback. Migrate old WebGL preferences explicitly to an eligible
recommendation, without deleting shared legacy assets
needed by the classic/history surface. Distinguish the WebGL execution provider
from the block-stream coefficient format currently named `manifest.webgl`:
`browser/ort-worker.mjs` also uses that bundle for the integrated direct WebGPU engine
and its canary identity. Retain the required coefficients, descriptors and qualified
WebGPU kernels. If the descriptor is renamed, preserve compatible manifest/cache
resolution and content identities; a `webgl` name alone does not make an asset
removable. This protects an existing optimized route through provider cleanup.

**Route read and removal decision (17 October 2026; the read is done).** The operator asked for the
existing route data to be read before removal and, on reading it, ruled that WebGL is removed. Source:
all 791 objects in the consented diagnostics bucket `facemorph-diagnostics` (300 runs from 22 devices,
22 September to 16 October; read-only, nothing changed). Findings:
- WebGL appears in 23 runs on 6 devices and was last seen on 12 October; 60 runs since then used none.
- Per synthesis stage, the median is 69 ms on WebGPU (2,885 stages), 1.28 s on CPU (362) and 7.9 s on
  WebGL (47; the fastest was 7.2 s). Terminal outcomes on the WebGL route were 7 completed and 12 failed;
  11 of those failures came from one Windows Chromium 109 device (4 cores, 2 GB, no WebGPU) where no route
  completed anything.
- Same-device, same-day comparisons: an Android Chromium 154 phone took 25.2 s and 39.8 s per face on
  WebGL against 3.4 to 3.7 s on WebGPU and 5.8 to 12.1 s on CPU; a 32-core Linux desktop took 9.4 s on
  WebGL against 1.6 to 5.6 s on CPU, and a forced WebGL morph took 247 s against 40 to 81 s on CPU.
- The one case in WebGL's favor: an iPhone (Safari) where the device offered WebGPU but the app did not
  admit it. Two WebGL runs completed (17.0 s and 37.3 s) and its single CPU run was interrupted while
  still downloading the 1,040 MB CPU package (678 MB in), where the WebGL route needed 158 MB. That
  advantage is download size, not the route.
- Limits of this read: the reports are opt-in and mostly short bursts from a few devices, so this is
  evidence that WebGL gave no advantage, not a census of visitors. The Google Analytics 4 route
  distribution was **not** read: there is no raw export (see the analytics report script's note) and no
  analytics connector in the planning environment. It adds no new requirement to the removal.

Consequence for acceptance: a phone-class device with no admitted WebGPU must finish a face on the CPU
route, or the guidance must say plainly that it cannot. Record that route's download size, because it
decided the one case above.

**Added 18 October from the [findings note](docs/findings/diagnostics-learnings-2026-10-18.md).** Every iOS
storage check (143 of them) reported a quota of 1,000 MB and zero use, and the CPU package is 1,040 MB, so
a phone with no admitted WebGPU cannot be assumed to keep that package; the one cold iPhone attempt stopped
at 678 MB. Acceptance adds: record how much a phone page can really keep, as evidence and not as a gate (no
physical-phone pass is required for release): the quota the browser reports, which the diagnostics already
carry, and a physical-iPhone measurement only when a device is at hand (the reported estimate is only a
hint). If the CPU package cannot be kept, the consent text says, with the byte count, that it is downloaded
again on each visit; a smaller phone CPU package is a later model-artifact option for the conversion and
hosting workstreams, not a prerequisite of release.
Implement actual operation/resource admission and conditional guidance alongside
these deliberate changes. Preserve integrated phone/iPhone mechanisms in the
[research map](#autoresearch-coverage-and-preservation-map), WASM mapping/e4e/alignment/codec stages and separately
qualified library CPU/reference support; deleting every CPU-labelled module is not
provider retirement. Remove native dispatch in the browser bridge/media, update build
hashing and re-home `desktop/scripts/verify-web-artifact.py` where still needed. Do not import
`desktop-candidates.yml`, `desktop-product.yml` or `desktop-native-inference.yml`
(release entry points that exist only in classic and are retired at wind-down) or their
packaging/update requirements into the monorepo. Preserve archived native source/artifacts and concurrent classic edits.
Remove native desktop-install/availability links from Product/Runtime and active
Help; retain useful CPU/provider recovery copy and record native retirement documentation.

Acceptance: CPU-only/unavailable-WebGPU devices retain qualified CPU work, including
phone paths. Genuine operation limitations settle before their expensive preparation /
acquisition; failure/cancel/reload/device-loss preserves bounded fallback/recovery
and completed output. No WebGL execution or native recommendation remains. Check
CPU and clean/cached direct/mobile-WebGPU loading, numerical canaries, raw face/frame production and browser
export/recovery after removal. Browser artifact validation remains intact despite
retired native paths/workflows. This scope revision precedes any published release;
it does not depend on completing native adapters or converter/package extraction.

### Diagnostics consent control

Owns the [debug-reporting disclosure](#debug-reporting-control-and-consent), which no
other workstream implements: the `#debug-reporting` On/Off control with footer and
FAQ links, saved-choice restoration without a false first state, withdrawal cleanup,
the corrected failure-toast labels (one-shot **Send this report** versus explicit
**Turn on debug reporting**), production host and route rebinding for `analytics.mjs`
and `reporting.mjs`, and the collector's retention behavior under the 17 October
decision recorded in that section (no expiry written, true wording). The learnings ingestion, and the
deletion of the old-wording reports that follows it, need only access to the bucket, so they can run ahead of the monorepo (it is its own row in the workstream
table, with no prerequisites); the
disclosure itself is ported with the TS/React milestone of
[application migration](#application-migration), so the rest of this workstream starts after
[candidate import and bootstrap](#candidate-source-import-and-bootstrap). **Typed failure causes (added 18 October from the [findings note](docs/findings/diagnostics-learnings-2026-10-18.md)):**
all 81 failed events in the existing reports carry one code (`operation_failed`), 58% have kind `unknown` and 26%
no stage, so failures cannot be told apart. Every failed event must carry a cause from a closed list (photo
decode, route refused, canary failed, storage or quota, download or integrity, synthesis, alignment,
encoding, export, page hidden or closed) and the stage it happened in; `unknown` is allowed only for a caught
exception that matched nothing and is itself counted as a defect. Each new event that
consent, batch, scheduler, warming or the device check adds is listed by its owning workstream, with its
allowlist and privacy-policy entry, before that workstream is accepted. Acceptance:
the built-UI checks listed in that section, run against the configured collector.

### Organization rename execution

After [source and repository identity](#source-and-repository-identity), execute the organization rename and known-reference repair
described above as an early, separately reviewable change. Repository renames and
backend archival are already done; preserve their identities. Resolve the selected
`facemorph-me` login, use the actual supported GitHub rename operation and verify
the resulting repo identities and integrations. Prepare concrete edits/checks before
the rename, then update remotes and active clone/Actions/docs/source links, with
native updater references receiving their retirement disposition rather than migration.
Organization branding is not a prerequisite for [domain handover and retirement preparation](#domain-handover-and-retirement-preparation) or API retirement. Keep
the current candidate publisher in classic and production domains unchanged here.

### Domain handover and retirement preparation

Prepare a concise operator-controlled domain handover/retirement action
list. Record stable repo IDs/URLs, chosen candidate source/artifact, existing and
future publisher ownership, hosting owners and actual commands. Distinguish a
candidate-source switch from production replacement; enforce one publisher per
target at handover and retain the ordinary site rollback artifact/configuration.
Name the concrete rollback target for each handover. After API retirement it uses
a retained working on-device artifact, with required immutable runtime/model/catalogue
assets and diagnostics configuration inside the declared retention window; it does
not assume restarting Triton/API hosting or restoring historic production data.
Name the actual Triton, encoder/API processes, API-only routes/tunnels/credentials
and `api.facemorph.me` / `checkface.facemorph.me` DNS/Pages bindings to remove,
starting from the [known source references](#known-active-references-to-the-retiring-hosts--source-scan-15-october-2026),
and snapshot the published name previews and latents to durable storage before the
API stops.
Separate model/name/diagnostics resources and point the standalone names host to the
API-independent main app with its fullscreen names modal; no names-only route is required. Retire obsolete API FAQ links, classic fallback
links, native desktop-download/update recommendations, GUID/link-preservation
promises and fixed-date assurances. Make operation limitations, CPU/WebGPU/mobile
guidance and static-name/result capability match the chosen artifact's actual behavior.

Inventory the candidate's preview-state chrome and copy before cutover, with each string's
replacement or removal: the "Experimental preview" strip and its Classic and retirement links, the
tester invite, the "Use classic FaceMorph" error link, the desktop README link, the "Preview
version" footer label, and the FAQ entries about `next.facemorph.me`, the self-hostable API
(which documents a retired host), Upload image, the model sizes and the support address. Add a
check that no production build links to a retired host or to the candidate branch.

Use [integrated verification](#integrated-verification)’s available working-app evidence and [classic distribution](#classic-distribution)’s actual self-host status;
report remaining gaps without inventing historic-service parity or iPhone gates.
No production-data migration, GUID archive or elaborate restore rehearsal is
required. Preserve repo histories; this plan does not authorize deleting personal
production records. Keep the selected static app version and ordinary site rollback
configuration available, without depending on a permanently running legacy API.
The operator chooses promotion/shutdown timing and order; [delivery and publication](#delivery-and-publication) records execution.

### Classic wind-down

Owns the [end state](#end-state-of-the-repositories): after the new publisher is live,
retire what classic no longer needs and leave it as the self-host distribution plus its Git history.
Start only after candidate-source handover (see [delivery and publication](#delivery-and-publication)),
[autoresearch re-homing](#autoresearch-re-homing) and
[application deploy and collector re-homing](#application-deploy-and-collector-re-homing)
are verified, so that no consumer still points at classic. **No human approval step (operator,
18 October):** the stages run in order, each when its preconditions verify, and each writes a receipt
with the precondition check, the change, the reversal path and a post-check. The stages: disable the
superseded publisher and any workflow whose consumer has moved; make the default branch's tree the
distribution only (the distribution branch of D4, so most of this is true by construction) and remove
the rest, including the research tree once its byte-identical copy here is verified; add a forward
pointer in the README to this repository; re-run the README-executed clean-clone acceptance on the
cleaned tree and restore any path it proves necessary. Preconditions that guard the work of others: any
path with uncommitted changes is skipped and reported, and any path that model staging or the
distribution still reads (named by the application inventory's input inventory) is moved or kept first,
never dropped. Safety rules that are not approvals: Git history is never rewritten, and no
branch or tag is deleted. Nothing in this workstream deletes or archives the repository itself or a
personal production record. Terminal. The planning update performed none of this.

## Remaining choices, completion and cutover authority

Availability/owner access for the chosen organization login and real npm names
are resolved at their workstreams. Complete the already specified crop/name/face
control changes using existing Next code. The proposed file-sharing direction
uses existing WebP/PNG/MP4 paths; JPEG/GIF/animated-WebP and a separate project
toolbar are optional, not dependencies of finishing or retiring the service.

October 25 is aspirational. The operator makes the retirement/domain-promotion
call from the working candidate and visible limitations. No historic GUID/link
preservation, old API parity, cross-domain storage migration, iPhone pass, full
shutdown-qualification campaign or performance win is required. Keep diagnostics
and normal functional checks. Do not represent a compile/test result as a live
fix, and do not silently ignore real correctness/privacy/resource failures.

Architecture completion means the new strict-TS monorepo/packages and classic
Docker distribution actually work for their documented capabilities. Hosted-service
retirement is a separate operator-controlled milestone and may happen earlier.
Published package acceptance additionally requires the independent actual-registry /
public-docs review above; pre-publication packs and internal examples alone do not
close that claim. Publication precedes this final review, avoiding a circular gate.
Performance claims still follow autoresearch evidence rules; those rules do not
keep the API running or require the operator to continue this project indefinitely.
Only the explicitly requested deferred published-package acceptance item is added
in this planning pass; the historical execution graph is not otherwise synchronized.

### Settled product direction and remaining execution choices

These decisions are settled unless the operator changes them. Actual organization /
npm name availability, hosting limits and operator-controlled delivery timing remain
execution-time choices. Do not ask again about accepted e4e or crop/picker design:

The [UI flow review](#ui-flow-matrix-and-open-journey-contracts) records settled
operator dispositions and remaining implementable journey gaps. Morph prepares
unfinished valid words/seeds, external MP4 reopening is deferred, and direct face
reordering is out of scope. These are not open operator questions.

| Direction | Decision and consequence | Relevant design area |
| --- | --- | --- |
| First execution priority | Organization rename/link repair after [source and repository identity](#source-and-repository-identity), as the operator suggested. Keep all live-domain/app-source changes separate. | [organization rename execution](#organization-rename-execution) execution |
| Fast first-use experience | Minimize each wait and complete choosing/generation/export journeys. Keep inference-free names, prioritize approved synthesis transfer, overlap encoder acquisition with choosing/crop review and qualify budgeted verified-cache warming. Candidate FAQ's roughly 200 MB generator / 1 GB encoder are historical guidance; use actual missing bytes. No hosted fallback. | [download/warming policy](#consented-downloads-useful-overlap-and-cached-model-warming) / [static names and picker](#static-names-and-picker) |
| Web-only release | Retire native desktop packages/build/update recommendations; retain browser CPU/WebGPU selection, bounded CPU fallback and candidate phone/iPhone work. Admit each operation by actual capabilities/resources, remove only WebGL execution. WASM helpers and classic Compose remain. | [release support](#web-release-and-desktop-package-retirement--12-october-2026) / [provider simplification](#provider-simplification) |
| Informed download decision | Check actual operation/resource eligibility before optional timing and consent. Recommend eligible Generate and encode with a Generate choice and concise per-purpose missing bytes, download/use ranges or honest unknown. Put substantial-wait WebGPU-computer guidance in that same area; keep setup/details in Help/expansion. Synthetic checks do not qualify models. | [pre-download guidance](#lightweight-device-check-and-pre-download-guidance) |
| Photo reconstruction | Accepted e4e tradeoff. Implement the locked crop mockups and correct encoding flow; retain ordinary regression checks. No replacement-model investigation or further resemblance decision is required. | [confirmed-crop encoding](#confirmed-crop-encoding) |
| Picker exit without header/X | Accepted small floating Back action for touch browsers lacking visible browser Back, with Escape/browser Back elsewhere. Preserve the original grid styling. | [package and operation contracts](#package-and-operation-contracts) walkthrough |
| Primary completed-result action | Keep accepted Share-first plus visible Save; Save is primary when file sharing is unavailable. Actions/format/filename live directly beneath their complete face/video output. Reopen/edit guidance applies to original PNG/WebP; MP4 project reopening is deferred. Session cache is not a project library. | [clean placement](#clean-ui-placement-and-useful-degradation) / [face controls and modals](#face-controls-and-modals) |
| Informative export names | Prefer name/text/seed/source basename, keep labels short, include morph mode and a compact distinguishing suffix. Different outputs must not silently overwrite each other. | [file sharing and export](#file-sharing-and-export-direction) |
| Delivery scope | Complete the planned architecture for its own benefits; choose API shutdown/production timing independently using a named working artifact. Do not promise a performance improvement merely from TS/packages/Vite. | Each [delivery and publication](#delivery-and-publication) action |

Do not add accounts, cloud history, a general gallery browser/search, new output
codecs, a visual redesign, native GPU expansion or a replacement photo model as
implicit prerequisites. These may be useful later, but the reviewed plan already
contains enough product and infrastructure work to complete a substantial release.

### Questions raised by the 18 October audit

No earlier ruling settles these. Until answered, the plan keeps the candidate's behavior for each.

1. **Old text and seed links.** GUID, photo and share links are retired. Links such as
   `?from_value=hello&to_value=world` need no server and could still open the same two faces on the new page. Honour
   them, show a short notice, or open an empty page as the candidate does?
2. **Autoplay.** Classic played the result muted in a loop on its own; the candidate waits for a click. Autoplay?
3. **A plain blend of two faces.** Classic's slider was an exact 50/50 blend. The candidate's slider walks a closed loop
   on a figure-eight path, so a blend needs the shape "Classic linear". Keep a plain blend as an easy path? (Since 24 October, two slots at 0.5/0.5 in the [blend view](#weighted-face-blend-advanced-mode) give exactly that
   still; the question remains only for the morph slider.)
4. **Cropper extras.** Wheel and pinch zoom, a crop square that may extend past the photo edge and the pre-upload
   "look straight forward" tip are in classic and in neither the candidate nor the locked images. Include them?

Planner proposals go ahead as planned and the operator may veto any of them later (24 October: no human gates): Shuffle weights in the blend view; Undo and Start over (face controls); keeping typed words across reload (defect 9);
a stored-data line with a Clear button (defect 22); a job whose files are all cached needing no network (defect 15); and three rules picked during bead conversion: refusing A,B,A morphs (identical neighbours on the closed loop), what Clear keeps, and that the 25 MB alignment limit applies only to the detector's proposed crop.

## Operator overview and clarifications
Source: [Google Doc](https://docs.google.com/document/d/1lVNtTjPOsVYfFUJa0jCiiVU2jtDENcFcQF8iHrufJ1s/edit).
Retrieved: 2026-10-11T04:54:31.206267+00:00

Export SHA-256: `d8818ed151034b733d654f2db1b945800033a152e5566ccdf8982dad7f8fdd6b`. This is the overview supplied
for the release planning pass; later explicit operator revisions supersede it.
The active requirements above incorporate the overview and subsequent operator
clarifications. Current rulings are: classic is `facemorph.me-classic`, the chosen
organization login is `facemorph-me`, backend source is already archived, and
`checkface.facemorph.me` must be retired completely. The reusable engine takes
caller-loaded models, model management stays separate, and all application work
is planned in idiomatic TypeScript, preserving the existing Next features and
integrated performance work except for this plan’s explicit UX changes/removals.
The latest 12 October scope retires native desktop packages, while retaining browser
CPU/WebGPU selection, bounded CPU fallback and candidate phone/iPhone paths.
Admission is per operation and resource policy; no blanket desktop/WebGPU gate.
The e4e/WASM helpers, static names/completed-file use and separate classic
Compose/conversion work are retained.

The inspected image descriptions and checksums are retained in
[Supplied UI references](#supplied-ui-references). Original setup instructions and
superseded naming/hold addenda are removed from the remaining-work plan; Git
history retains their provenance.

## Operator decisions (dated)

| Date | Decision |
| --- | --- |
| 11 Oct | e4e accepted; locked crop design; static names with no selection-time synthesis; API, GUIDs and result links retired; production starts fresh |
| 12 Oct | Native packages retired; Auto/CPU/WebGPU and bounded CPU fallback kept; phones first-class; Morph prepares unfinished inputs; MP4 reopening deferred; no face reordering |
| 15 Oct | New development and autoresearch move to this repository; classic is wound down |
| 16 Oct | D1: direct TS port, no .NET here; dependencies on latest stable; frozen classic self-host guarantee; D4–D7 settled |
| 17 Oct | No port checkpoint or fallback; reports carry no deletion promise; automated update lane; package scope settled; WebGL removed |
| 18 Oct | Candidate edits are ordinary work; tracker rewritten from the plan; classic ends as distribution plus history, wound down automatically; old-wording reports deleted once mined |
| 24 Oct | Only the live cutover pushes need the operator; package publication and planner proposals go ahead; no fixed count caps (only real resource limits, degrading nicely); strictly-not-worse gate against the candidate, iPhone included; changeover statistics in Grafana |
| 24 Oct | Weighted multi-face blend as an advanced view on the new engine (button and `#blend` deep link, established export paths); beads are shippable slices (about 100–140); receipts only where an irreversible action or the cutover decision reads them |

Earlier review rounds, including the 24 October round's findings, are in [`docs/plan-history.md`](docs/plan-history.md)
and Git history; they do not define the current plan.

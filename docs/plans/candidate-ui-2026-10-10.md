# Candidate UI and delivery plan — 10 October 2026

**Later operator revision:** [screenshot feedback/process correction](feedback-process-2026-10-10.md)
supersedes tagline actions, visible shape/length controls and single-result-only
retention. Use that revision for the next iteration; the delivery evidence below
records the earlier scope.

**Status: approved; implementation and qualification in progress.** The operator
authorized implementation through candidate deployment. Completion and deployed
evidence are recorded in [the delivery record](delivery-2026-10-10.md). Work in `facemorph.me`, on the candidate
branch, and promote to **https://next.facemorph.me**. No worktrees.

See the [plan registry](README.md), [development guide](../dev/README.md),
[deployed round 2 gap](../round-2-gap-2026-10-10.md), and
[autoresearch protocol](../../autoresearch/README.md). Preserve concurrent work.

## Goal and design reference

Improve the journey from first arrival through face generation, morphing and
sharing, including repeat visits. Use the
[Claude artifact, revision 2](https://claude.ai/artifact/NodiZ6fLjStK4ajo5yq4jS)
as a visual reference with the **links in tagline** variant. Preserve the current
face textbox behavior and all real application options. The artifact is a sketch,
not an instruction to adopt every behavior it depicts.

## Decisions recorded with the operator

| Decision | Current direction |
| --- | --- |
| Default morph | Keep smooth figure eight, current width and pinched setting; **16 frames per segment** remains default. |
| Length selector | Retain Short / Standard / Long: 8 / 16 / 32 frames per segment. Show the counts and total for the current face list; two faces produce 16 / 32 / 64 total frames. Keep FPS independent. |
| Multiple jobs | **Intelligently schedule serial heavy jobs**; keep one heavy runtime job active. Independent tile progress includes honest queued status. Parallel heavy processing is deferred. |
| Source photo | **Current tab only**. Never persist it for comparison. Restored generated results do not imply a restored source photo. |
| iPhone evaluation | Available qualification → promote to `next.facemorph.me` → consented diagnostics and real feedback → iterate. **Physical iPhone testing is not a pre-promotion gate.** Missing physical evidence remains explicit. |
| Desktop guidance | Suggest a desktop browser or available tested desktop binary when appropriate to the actual device/workload; do not promise unverified GPU support. |

## Proposed UI

### Arrival, faces and generation

- Use tagline links rather than photo chips. No photo pills such as “your photo”.
  Preserve the small image close control from prior feedback; photo-label pills
  are distinct from action controls. Put the accessible hold-to-compare action
  beside/below the image without obscuring it.
- Preserve the existing textbox parsing, modes, browse/picker controls, editing
  behavior and deliberate Generate action. Put Generate to the right when the
  field and controls fit; wrap it underneath at narrow widths. Do not inherit
  automatic generation while typing from the sketch.
- Associate each progress bar and stage label with its own image. Show independent
  download/preparation, detection, cropping, alignment, encoding and synthesis
  status where applicable. Label queued jobs honestly. Use determinate bars only
  for measurable fractions and indeterminate bars for stages without totals.
- Keep measured generation timing, including **0.xxx seconds per image**. Separate
  actual timing, remaining estimates and labelled priors; no fabricated precision.
- Hold to compare the source and generated result for photo-derived faces while
  the source remains in this tab. Provide touch/pointer and keyboard hold behavior;
  release on pointer cancellation, blur and navigation. Generated/text/name faces
  without a comparison source need no misleading compare control.
- Keep insertion between faces and after the last face; align primary Add face
  with that flow and show the estimated additional cost where supported.

### Morph and sharing

- Use an always-visible labelled radio/segmented shape selector. Preserve all five
  shapes: full smooth figure eight, full smooth ellipse, pairwise figure eight,
  pairwise ellipse and linear. Wrap on small screens rather than hide choices.
- Keep all existing visible options, including length and pinch. Preserve width
  and FPS in the underlying settings; these currently have no visible controls.
  Do not introduce new width/FPS controls as part of this layout change. Advanced
  controls can live in More options; no existing option is removed to match the sketch.
- Give the morph its own progress bar. Retain the required monotonic
  **“Generating X / Y images”** counter. Encoding/finalization has a separate
  stage/bar and measured timing; it must not make the generation count regress.
- Address the remaining morph backlog: endpoint/midpoint/quarter infill, live
  scrubbing of available frames, looped muted automatic playback when permitted,
  and measured encoding through completion in total/remaining estimates.
- Preserve completed-frame reuse, cancellation, save and sharing. Keep partial
  availability distinct from a completed playable export.

### Runtime, options and reporting

- Show Ready only after actual route admission/canaries. Caption the active route:
  this device's GPU with **WebGPU** or **WebGL**, or **CPU**. A detected GPU API
  alone is not admission. Before admission show Checking/Preparing; after fallback
  update the caption to the route actually used.
- Move processing overrides to **More options → Advanced**. Retain Auto and every
  existing force mode, with honest rejection/fallback behavior.
- Keep the consent toast: **“Help us test? Send debug reports: no photos, words or
  faces.”** Actions **Turn on** / **No thanks**. Respect stored refusal. Sending
  a single failure report does not enable ongoing reporting.
- Preserve explicit model-download consent. The sketch's automatic large arrival
  downloads are not adopted. Integrate remaining testing/help controls with the
  explanation/FAQ surface; maintain deliberate classic palette and avoid heavy
  boxed-card styling. Keep required candidate/issue links discoverable.

### Welcome back and local retention

- Restore the last completed device-generated result and useful settings from
  existing local storage, displaying Welcome back. Validate saved version,
  provenance and hashes; gallery previews are not device-generated originals.
- Read a saved image/latent before starting model admission or downloading models.
  A missing image with only a retained latent can offer deliberate re-rendering;
  it must not trigger expensive startup work silently.
- Persistence grants protect against eviction; they are not a prerequisite for
  best-effort IndexedDB storage. Denied grants, unavailable storage, private mode,
  eviction and quota failures degrade gracefully to a usable memory-only session.
- Do not save source photos, unfinished jobs or invalid results. Comparison is
  unavailable after reload when the source is gone. This increment restores the
  last result; a complete history/library and transfer UI remain deferred.

## Photo improvements and independent jobs

Large dimensions alone should not force manual cropping. Admit file size and
image dimensions before costly decode where possible, detect on a bounded
preview, map selected face coordinates back to the source, and crop/align from
original detail where the platform supports bounded decoding. Current code fully
decodes before preview downscaling; changing only the preview size does not bound
peak memory. Keep explicit file/pixel limits and a manual crop fallback.

For multiple detected faces, show “Two faces here. Tap the one you mean” with
selectable face regions/previews. Extend the detector to expose bounded boxes or
landmarks; it currently returns a count. Revalidate exactly one selected face
before encoding. Zero, tiny or uncertain faces still get clear crop/retry help.
Never silently choose the largest face. Preserve coordinate correctness under
orientation, scaling and cropping; current legacy-ignore-exif policy must not
change accidentally. Exact original-detail recropping is not universally available.

Replace global progress attribution with per-face jobs, input revisions,
cancellation and stale-result protection. Cropping one image or cancelling another
must not clear unrelated progress or results. Independent tiles must accurately
show which jobs are running, queued, awaiting selection or complete.

Keep heavy processing serial for this increment. Intelligently schedule the next
eligible job across faces and morph work, respect dependencies and pending crop/
face-selection decisions, and avoid head-of-line blocking when a photo needs user
input. Preserve stable ordering among equally eligible requests and prevent
starvation. A deliberate face edit/retry can take priority at the next safe job
boundary without silently discarding unrelated work.

Reuse completed preparation, cached originals and retained frames where valid.
Remove cancelled or superseded queued jobs before they start; check input revision
again before publishing results. Keep queue position/waiting status distinct from
active progress and maintain responsive cancellation. Preserve existing runtime
single-job guards and avoid duplicate model/heaps. Parallel heavy processing is
explicitly deferred by the operator's latest direction; independent tile state
does not imply simultaneous inference.

## Desktop guidance when appropriate

Use observed route, measured cost, memory failures and workload size to decide
whether a desktop suggestion helps. A phone on CPU facing many frames may benefit
from a capable desktop browser; a desktop user should get relevant browser/route
or workload advice rather than “use a desktop”. Device classification is a hint,
not a proven hardware fact. Preserve a usable local CPU path and the user's choice.

A desktop binary can be suggested only when an actual tested download is available
for the user's OS/architecture. Describe its verified route and limitations;
never link an empty releases page or promise speed based on packaging evidence.
The [desktop guide](../../desktop/README.md) currently distinguishes development
skeletons/CPU evidence from native GPU and distribution qualification. This plan
allows contextual desktop guidance; it does not revive the full native GPU matrix
as a web delivery dependency or authorize publishing unqualified binaries.

## Relationship to earlier decisions

| Earlier requirement or artifact behavior | Resolution |
| --- | --- |
| Single heavy runtime job | Preserved. Latest operator direction replaces the earlier parallel-job choice with intelligent serial scheduling; parallel heavy processing is deferred. |
| Artifact Long default | Keep current Standard default; Long remains selectable with frame counts. |
| Artifact photo labels / compare pill | No photo pills; accessible compare action outside the photo surface. |
| Never store source photos | Preserved; welcome back restores generated results only. |
| Testing-area processing select | Move to More options → Advanced; keep all overrides. |
| Counter-only morph copy | Preserved as the counter; add a separate visual bar and encoding stage. |
| Artifact automatic model download / typing generation | Preserve explicit downloads and current textbox/manual generation behavior. |
| Artifact failure report turns debug on | Preserve separate send-once and ongoing consent. |
| Exactly-one-face photo admission | Preserve for the selected crop; add explicit selection when several faces are detected. |
| Broader saved library/transfer work | Deferred beyond last-result restore; do not claim hidden project controls shipped. |
| Physical iPhone evidence as delivery blocker | Superseded for candidate promotion; use diagnostics iteration and retain evidence limits. |
| Desktop app as guaranteed GPU remedy | Not adopted; require an available tested binary and honest capability claims. |

## Analytics additions

Follow the [candidate analytics plan](analytics-2026-10-10.md): release-tagged
error/outcome rates with explicit denominators, first/repeat journey timing, stage
and queue costs, route fallback, photo recovery, cache/restore and save/share
reliability. Preserve telemetry privacy/opt-outs and verify actual GA receipt.
These are planned additions, not current deployed coverage.

## Source reconciliation before implementation

- **Control scope:** the earlier draft described width/FPS as existing UI options,
  but source exposes shape, length and pinch only. Preserve internal width/FPS
  defaults without adding controls. The comment claiming pinch is absent is stale;
  the checkbox exists. Visible shape/length selectors and frame counts explicitly
  supersede the older overflow-only/raw-count-hidden presentation.
- **Qualification harness:** the current integrated harness selects Processing
  mode directly and uses Generate faces as its primary run control. Moving the
  route selector behind Advanced requires updating the harness to navigate the
  actual UI. Its “Generate faces” selector refers to an additional batch action
  currently in source, not the per-face Generate or Create morph controls. The
  planned primary actions are per-face Generate and Create morph; exercise those
  in qualification and keep any batch action behind its existing planned flag. Preserve equivalent workflow coverage; do not keep obsolete
  controls visible merely to satisfy selectors or replace integrated tests with
  component checks.
- **Busy state and existing queues:** cropping/photo acceptance already supports
  queueing another face during active work through PendingFaces; the UI is not
  universally blocked. Other paths still disable Generate or reject drops while
  busy. Preserve working queue paths and make interactions consistent, so unrelated
  faces can be queued/edited safely during a job. Lock the active job's snapshot,
  maintain revision checks, and show cancellation scope explicitly. Preserve every
  eligible queued item when draining; do not clear the whole queue after selecting
  its first item. Do not imply queued images have begun processing.
- **Reporting versus analytics:** the diagnostics toast governs debug reporting;
  the existing FAQ separately discloses usage analytics. Keep that distinction
  and opt-out behavior accurate. “No photos, words or faces” remains true for both
  payload paths; debug consent must not be described as controlling analytics.
  Verify toast, FAQ, settings and actual payload behavior together, including
  send-once versus ongoing consent, stored refusal and analytics opt-outs. Update
  stale wording when controls move; make no privacy or retention claim that the
  implementation and collector do not enforce.

## Fresh review and implementation contracts

The [fresh review](review-2026-10-10.md) separates ready implementation work from
unchecked areas. Its ordering, sparse-frame, restore-index, result-merging and
analytics-lifecycle contracts are part of implementation acceptance. Promote
qualified increments with remaining work explicitly tracked; no partial promotion
closes the whole plan.

## Implementation sequence and acceptance

1. **Reconcile the tree and UI baseline.** Recover relevant feedback with Cass,
   preserve concurrent public-preview work, and identify what is local versus
   deployed. Implement tagline, responsive textbox/button, clean tiles, five-shape
   selector and Advanced route controls. Check narrow/wide layouts, keyboard/touch
   access, defaults and all option mappings.
2. **Progress and scheduler.** Add per-face job/revision state and stage attribution,
   image/morph bars and measured timing. Verify cancellation and stale-result
   rejection across several tiles. Verify dependency-aware serial scheduling,
   stable ordering, priority at safe boundaries, no starvation, and queue progress
   when another tile awaits user input. Keep one heavy runtime job active.
3. **Photo acceptance.** Add bounded detection, face selection and coordinate-safe
   recropping; retain manual fallback. Verify large, rotated, tiny, zero-face and
   multiple-face fixtures, invalid files, cancellation and limited-memory routes.
4. **Return visits and compare.** Restore last completed generated result without
   inference/model downloads. Verify stored, denied-grant, evicted, quota-failed
   and unavailable-storage cases, plus tab-only compare cleanup and privacy.
5. **Finish names/morph backlog.** Fullscreen gap-free names with immediate selected
   previews; separately verified full-size catalogue/latent materialization.
   Integrate infill/live scrubbing/playback/encode estimates without invalidating
   retained frame keys. Track each round 2 item against actual behavior/evidence.
6. **Qualify and promote.** Run relevant component checks, compiled UI and exact
   artifact CPU workflow; inspect responsive layouts at 320/360/390 and 1280 px.
   Check report payload privacy and collector compatibility, forced route failure,
   consent, fallback, cache reuse and share/export. Keep workflow gates intact.
   Promote from this repo to `next.facemorph.me`, record revision/artifact/live
   asset identity, then use consented diagnostics to prioritize real device fixes.
   No pre-promotion physical iPhone dependency. Do not infer universal phone or
   desktop binary qualification from CI/simulator passes.

Development owns behavior and delivery. Autoresearch measures first/nth arrival,
face/photo/morph latency through share, model/cache state, route and scheduling
costs. Record experimental, implemented, qualified and deployed states separately.

## Operator clarification during delivery — phone reloads

10 October: keep automatic **WebGPU → CPU → WebGL** preference on every platform.
Fall back on unavailability/admission/inference failure, never because a successful route is slow.
Measured costs support diagnostics and estimates only. Reload/background interruption markers
do not prove failure and cannot demote routes. Advanced explicit overrides remain.
This supersedes prior adaptive timing ranking and the historical iOS WebGL-first default.

Matching Android Chrome154 diagnostics corroborate WebGPU3.3s → CPU4.1s → WebGL18s on
successive reloads, without any recorded rejection. The old over-three-second exploration rule
caused this rotation and is removed. [Sanitized run evidence](../review/candidate-2026-10-10/phone-reload-summary.json)
retains exact run/build facts. Existing acquisition rows cannot prove network redownloads; the
new rounded model/network counters and cache-inventory fixes provide explicit evidence.

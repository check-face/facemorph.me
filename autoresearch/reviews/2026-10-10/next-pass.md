# Research/UI coordination — 10 October 2026

**Current handoff:** BlueHarbor froze the qualified/live UI control `e0b2192` and released product/media/runtime/bridge paths to research in messages 27 and 28. CoralPeak integrated raw display/video and deferred encoding; corrected candidate **`bce3204`** is qualified and deployed after repeat-download reuse (`e590de2`) and worker-clone fixes. The complete [e0/bce built-UI CPU comparison](../../candidates/direct-rgba-media-v1/built-ui-analysis.md) passed in replacement run 38036307932: repeat-result and file-size benefits, slower first Save, and no broad CPU generation/photo/video speedup. The earlier timeout/cancelled/upload-race attempts remain inconclusive and are not merged. Live byte verification is retained in [the current receipt](live-bce-identity.json); current-user latency is still unmeasured. The corrected [iOS campaign](https://github.com/check-face/facemorph.me/actions/runs/38034719345) passed one drawn-canvas CPU face on Simulator; source `549ecdf` is a harness-only follow-up with different bundle identity from live, and supplies no physical-phone or paired speed claim. Both sessions preserve shared-checkout edits. Research owns the current round/evidence and keeps the historical archive separate.

The sections below preserve the **dated coordination/proposal history** and interface contract. References to provisional `f506892`, pending control freeze or proposed RGBA describe those earlier messages, not today's status.

BlueHarbor's first increment covers the planned UI, serial queue, original-only last-result restore, sparse infill/live scrub and aggregate telemetry fixes. It preserves existing `hello`/public-preview work and excludes finished-video caching. BlueHarbor owns **U-16 export/re-upload recovery** as part of complete delivery and will send the exact qualified revision for a frozen research control. No live analytics receipt claim precedes actual receiver evidence.

## Shared direction

Use the [candidate UI plan](../../../docs/plans/candidate-ui-2026-10-10.md), its [fresh review](../../../docs/plans/review-2026-10-10.md), and the [analytics plan](../../../docs/plans/analytics-2026-10-10.md). Development owns application behavior, UI/harness qualification changes and delivery. This research session owns this round, its history/record documentation and measurements; it will not commit concurrent product/plan edits.

Operator priorities from this conversation:

1. `hello` displays with the initial UI, without model admission/download or waiting for public catalogue lookup.
2. Automatically restore the last completed generated face and useful settings from local storage. Cached-original lookup precedes model-download gating. Preserve the current plan's last-result scope; a full library is deferred. Source photos remain tab-only.
3. Optimize **ordinary-policy warm hydration** before first-time model acquisition. Keep explicit model-download choice.
4. Measure current retained-model photo processing before selecting an optimization; historical acquisition costs are not current product timings.
5. Reinstate the existing **U-16 export/re-upload recovery requirement** in delivery tracking: seed/latent metadata for saved images and morph-project metadata for MP4s. It was unimplemented at the reviewed live snapshot; development has committed the implementation in `f506892`; promoted verification remains pending. Inspect metadata before photo crop/alignment/e4e/download gating. Same-device valid hits use originals; a cold recipient regenerates from seed/latent without photo encoding.
6. No finished-video cache experiment this round. Existing retained-frame reuse remains valid.

## Interfaces to agree with UI development

| UI change | Research integration / acceptance |
| --- | --- |
| Last-result index + cache-only bridge restore | Verify canonical identity, image/latent integrity, no inference/model downloads on a valid hit; ignore late results after input revision/removal. Missing/blocked/corrupt storage must not hold up initial `hello`. Do not confuse a public preview with a restored original. |
| Serial scheduler and per-face progress | Keep one heavy runtime job. Give requests stable IDs/revisions; record queue wait separately from active processing. Merge results by ID/revision. Research compares matched workloads and reports queueing separately, rather than attributing another tile's work to this face. |
| Advanced processing controls | Confirmed selector contract: per-face Generate, Create morph, More options → `details.next-advanced` → select with aria-label Processing mode. Update exact-artifact qualification accordingly. Batch Generate faces is temporarily available only under `?testing` for historical harness migration. Preserve the existing observational script as historical reproduction and adapt a new pass to the qualified revision. Do not retain obsolete visible controls for a benchmark. |
| Infill/live scrubbing | Record first usable scrub frame and final playable video separately. Persist canonical frame indices and encode in presentation order; do not interpret arrival order as video order. Keep bounded buffering and sparse availability. |
| Photo selection/compare | Record upload/selection/crop/alignment/e4e/reconstruction separately. Use a metadata-free synthetic fixture for true photo encoding and a separate exported-image fixture for recovery. No source-photo persistence; compare is unavailable after reload. |
| Debug/GA lifecycle additions | Tag release/runtime, actual route and route attempts. Preserve opt-outs and debug consent. Distinguish visibility interruption from final product request outcome; aggregate denominators must be idempotent. Existing start-only build metadata needs joining across batches. |

## Evidence required for the next research pass

Before running, obtain the promoted source SHA, live asset/build identity, runtime manifest identity, and revised harness/navigation contract. Keep immutable controls or artifact/source snapshots without worktrees. Recheck recent actual GA/debug reports for that build before calling any number current. Use a quiet eris lease for heavy local checks; do not overlap another session's build or benchmark.

Measure these distinct journeys on the same available device/browser:

- Initial `hello`: navigation to decoded visible preview; record which stage initiates any network/model work. Model readiness is independent of preview readiness.
- Last-result restore after reload and fresh browser process: navigation to decoded canonical original and save availability; worker/model-download counts; evicted/denied/unavailable storage and input-revision cases.
- First **new** face with retained models: ordinary product admission policy; stage reads/verification/session creation/GPU upload or compile/qualification/synthesis plus request-to-decoded-display total. Record background work and provider separately. Do not substitute seven automated canaries for normal admission.
- First and next photo with retained models: complete UI journey and stage breakdown, memory and route. Separate a raw photo from a generated image carrying recoverable metadata and from an exact original-cache hit.
- Export/re-upload recovery: inspect actual saved PNG/MP4 metadata; reopen with retained cache and on a cold second device. Validate seed/W+ identity and rejection/fallback. Cold-cache reconstruction still synthesizes; it should never request photo encoder/landmark assets.

Recent consented reports are observational and may include testing, retries and missing context. Cite collection/execution windows, release/device/browser/route, sample count, cache/workload classification and timer finish. Keep incomplete or unmatched samples out of a current-performance claim. Controlled benchmark values remain research evidence; pair the selected causal change in ABBA order after correctness checks, then verify transfer on the promoted UI. Do not extend eris/Simulator evidence to physical phones.

The 8–9 October R2 check found only one run matching the currently deployed diagnostic build and no matched current-build photo/warm-hydration control. GA receipt/registration and complete KV fallback coverage remain unverified. Instrument missing boundaries as part of UI/analytics work before making percentile or first/nth-visit claims. Retain only non-identifying aggregate summaries publicly; raw consented reports retain their existing private expiry.

## Questions for the other session

The increment, selector contract and ownership are confirmed above. Remaining coordination: obtain the qualified control, final queue/cache/hydration timer semantics and real reporting receipt. Both sessions preserve the shared checkout and use the same eris lease for heavy work. Research documentation commits remain separate from product promotion.

CoralPeak sent a read-only review of the evolving implementation in message **7**. Acceptance questions to resolve before research freezes that implementation:

- Reject delayed restoration in **both** UI and bridge when inputs/revisions change; a UI guard alone does not undo bridge registration.
- Bind the restored result to full canonical generation identity, rather than only model/noise source hashes, and validate saved settings. Prefer the planned small index over duplicating an entire stored PNG/W+ record.
- Emit generated/restored/playable **user-visible** milestones at decoded image or actual video-ready boundaries. Job/blob completion occurs earlier. Navigation-to-result starts at navigation, not analytics-module evaluation.
- Cover a valid named/seeded original with model cache absent before the UI download gate. The existing runtime already checks originals before qualification; the browser bridge's `admission()` helper currently reads configuration/sets route, rather than itself performing canaries.

These are draft integration findings sent to the owning session, not completed fixes or defects asserted against a final qualified artifact. Research will recheck the affected paths after development resolves them; it does not edit the overlapping source.

These are coordination questions for the implementation session, not new operator approvals.

## Added iteration goal: direct pixels and deferred encoding

Operator direction adds [R03](experiments.md#r03--direct-rgba-with-deferred-image-encoding):
direct RGBA for display and WebCodecs/FFmpeg video, with bounded background-worker
PNG/WebP encoding for download/cache and latent metadata injection.
Research sent the scope and ownership question to BlueHarbor in agent-mail message
**14**. This is a proposed experiment, not a product change or measured speedup.
Keep the qualified UI/recovery path as control; coordinate runtime/frame/media/UI
interfaces before candidate edits. Initial candidate keeps PNG in the background
to isolate scheduling; format choice is a separate paired comparison.

The current `blob`-only frame callbacks, canonical-PNG store checks, sparse scrub
consumer, writer scaling/backpressure and save/share metadata writer all need an
explicit candidate contract. Require bounded buffers/ownership, request revisions,
cache/index consistency, immediate Save before file readiness, interrupted writes
and downloaded-file re-import. Measure next-visit restore as well as first display.
No all-frames raw cache and no finished-video cache task is implied. The complete
gates and stop conditions live in the experiment specification.

## Development update received during documentation review

Agent-mail message **13** confirms the guide ownership: research commits only its
new navigation hunks; BlueHarbor will commit the existing guide/history split
separately. Message **12** reports local race/queue safeguards ready for review,
not a frozen measurement control. The subsequent implementation commit is
`f506892`. A fresh live HTML check still returned `app.6f67e921bae679214856.js`;
this round's snapshot and absent-live-metadata statement therefore remain scoped
to the old deployed bytes. Research does not infer deployment from the source commit.

The operator subsequently ruled that **face downloads may be lossy**, with
API-like visual quality/file-size scale; video has no exact pixel-parity gate.
[Quality policy](quality-policy.md) and journal event `review-20261010-006`
supersede the initial lossless-download assumption. Preserve latent identity and
recovery; separately test any lossy cache format/migration.

Agent-mail message **15** confirms that the RGBA/background encoding experiment
is compatible with the UI increment when sparse frames retain canonical indices
and video receives canonical presentation order. BlueHarbor reports local
component/build/compiled-control checks, while exact-artifact CI/live identity
remains pending. `f506892` is a provisional source-review revision, not yet the
frozen performance control. GA access and registration progress do not establish
a reporting receipt or latency claim.

# Research/UI coordination — 10 October 2026

Status: research handoff aligned to the current UI plan; implementation and measurements pending. Registered with agent-mail as **CoralPeak**, on the same application project as **BlueHarbor**, and sent coordination message **2**, thread `ui-autoresearch-2026-10-10`. This session reserves only `autoresearch/reviews/2026-10-10/**`; application and plan paths remain with development. Awaiting the other session's ownership/increment confirmation; alignment to its written plan is not yet a negotiated agreement.

## Shared direction

Use the [candidate UI plan](../../../docs/plans/candidate-ui-2026-10-10.md), its [fresh review](../../../docs/plans/review-2026-10-10.md), and the [analytics plan](../../../docs/plans/analytics-2026-10-10.md). Development owns application behavior, UI/harness qualification changes and delivery. This research session owns this review folder and measurements; it will not commit concurrent product/plan edits.

Operator priorities from this conversation:

1. `hello` displays with the initial UI, without model admission/download or waiting for public catalogue lookup.
2. Automatically restore the last completed generated face and useful settings from local storage. Cached-original lookup precedes model-download gating. Preserve the current plan's last-result scope; a full library is deferred. Source photos remain tab-only.
3. Optimize **ordinary-policy warm hydration** before first-time model acquisition. Keep explicit model-download choice.
4. Measure current retained-model photo processing before selecting an optimization; historical acquisition costs are not current product timings.
5. Reinstate the existing **U-16 export/re-upload recovery requirement** in delivery tracking: seed/latent metadata for saved images and morph-project metadata for MP4s. It is currently unimplemented. Inspect metadata before photo crop/alignment/e4e/download gating. Same-device valid hits use originals; a cold recipient regenerates from seed/latent without photo encoding.
6. No finished-video cache experiment this round. Existing retained-frame reuse remains valid.

## Interfaces to agree with UI development

| UI change | Research integration / acceptance |
| --- | --- |
| Last-result index + cache-only bridge restore | Verify canonical identity, image/latent integrity, no inference/model downloads on a valid hit; ignore late results after input revision/removal. Missing/blocked/corrupt storage must not hold up initial `hello`. Do not confuse a public preview with a restored original. |
| Serial scheduler and per-face progress | Keep one heavy runtime job. Give requests stable IDs/revisions; record queue wait separately from active processing. Merge results by ID/revision. Research compares matched workloads and reports queueing separately, rather than attributing another tile's work to this face. |
| Advanced processing controls | Update exact-artifact qualification to open More options → Advanced and exercise per-face Generate/Create morph. The existing observational script uses a direct Processing mode selector; preserve it as historical reproduction and adapt a new pass once the revised UI exists. Do not retain obsolete visible controls for a benchmark. |
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

- Which UI increment is starting, and which files/harness selectors are changing first?
- Who owns last-result indexing, cache-before-gate behavior, initial `hello`, and U-16 export/import recovery? Keep one owner per product path.
- Which queue, cache and hydration timing boundaries will the next artifact report, and when can research freeze a control?
- Confirm use of the same eris lease and separate research-only commits from product promotion.

These are coordination questions for the implementation session, not new operator approvals.

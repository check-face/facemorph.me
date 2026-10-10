# Candidate analytics plan — 10 October 2026

**Status: approved; instrumentation implemented locally, deployment/receipt verification in progress.**
See [the delivery record](delivery-2026-10-10.md) for coverage and operational limits.
Part of the [current candidate plan](candidate-ui-2026-10-10.md). See the
[registry](README.md) and [existing analytics reference](../analytics.md).

## Purpose

After promotion to `next.facemorph.me`, determine whether people get useful results,
where they wait or fail, and whether changes improve first and repeat visits through
sharing. Aggregate analytics answers how often; consented diagnostics explains
individual failure paths. Keep these systems and their controls distinct.

Existing GA4 events already describe job outcomes, timing, downloads, input kinds
and exports. Derive rates from those where sufficient rather than sending redundant
“error rate” events. Add the missing measurements and reliable denominators below.

## Measurements and dashboards

| Area | Add or improve | Useful measure |
| --- | --- | --- |
| Journey | Per-visit milestones: usable UI, first visible preview, first completed generated/restored result, first playable morph, export attempt/result. Distinguish preview, restored result and new generation. | Arrival → usable UI → useful result → playable morph → save/share conversion, plus time to each milestone. |
| First/repeat visits | Coarse first/returning/unknown state, separate from model-cache state. Time first useful result on every visit, not just the current once-per-storage-history activation event. | First versus repeat visit p50/p95 arrival-to-result; restoration versus fresh generation. |
| Job reliability | One logical request start and exactly one terminal outcome, distinct from each route attempt. Include build, action, input kind, requested/admitted route, cache state and closed failure category/stage. | Failed / resolved requests, completed / resolved requests; cancelled and interrupted shares reported separately. |
| Route admission and fallback | Count attempted route admission, rejection, fallback and eventual result, with closed reason categories. | Admission rejection per attempted route; fallback frequency and success after fallback. |
| Stage costs | Bounded stage duration summaries for download, qualification, detection, crop preparation, alignment, encoding, synthesis and video finalization. Separate user decision time and queue wait. | p50/p95 bottlenecks by action/route/cache; actual per-image and full morph completion costs. |
| Scheduling | Enqueue/start/finish lifecycle with queue wait, bounded queue depth and active compute duration. Include cancelled-before-start and superseded outcomes without classifying them as runtime failures. | Queue wait p50/p95, total request-to-result, cancellation while waiting, and starvation warnings. |
| Photos | Admission result; coarse dimensions/size bands; downscale path; face-count category zero/one/multiple; chooser/crop offered/accepted/cancelled; alignment/encoder result. | Photo → generated result conversion; manual-crop frequency; automatic path success; multiple-face selection success. |
| Recovery | Retry/fallback/crop/cache-repair attempted and resolved, categorized by recovery type and final result. | Success / resolved recovery attempts; cost to recover; unresolved failures. |
| Cache and welcome back | Separate model/original/frame cache hit/miss, restoration attempt/result and reason category (missing, incompatible, quota, unavailable). Record persistence request outcome separately from save success. | Warm-cache benefits, restore success rate, unwanted repeat downloads and storage failure rate. |
| Morph | Requested versus completed frames; first scrubbable frame, first playable video, generation/encoding duration and retained-frame reuse. | Time to interactive scrub and playable export; encoding share of total latency; completed morph conversion. |
| Save/share | Attempt and terminal result by image/video and save/share; unsupported API, cancellation and failure are separate. | Successful browser handoff / resolved attempts; fallback download use and export latency. |
| Perceived responsiveness | Supported standard page-load/vital metrics and targeted long-task/UI-delay summaries during processing. Unsupported measurements remain unknown. | LCP/INP/CLS where available, plus evidence of UI stalls during jobs. |
| Desktop guidance | Count eligible nudge exposure and click by coarse context and destination type; no arbitrary URL parameters. | Whether advice is used and where it appears; no claim that clicking proves successful migration. |

“Shared” means the browser share operation resolved, not that the recipient received
it. “Saved” means the supported save/download handoff completed, not proof that a
file remains on disk. Label dashboards accordingly.

## Error rates and denominators

- **Resolved request failure rate:** failed / (completed + failed). Show the
  cancellation/interruption counts alongside it, and also show each outcome's
  share of all observed terminal requests so exclusions cannot hide poor outcomes.
- **Unresolved requests:** starts lacking a terminal outcome after a documented
  expiry window are unknown, not assumed failed or completed. Show their count.
  Browser crashes, process kills and lost beacons can remove the terminal event.
- **Stage failure rate:** stage failures / observed attempts entering that stage;
  distinguish recovered stage errors from final request failures.
- **Export/recovery/restore rates:** use resolved attempts of the same operation,
  not page views or all generation jobs. Always show numerator and denominator.
- **Route rates:** requested and admitted routes are separate. GPU API availability
  is not qualification or a promise that CPU fallback was the wrong choice.
- **Latency:** report p50/p95 and sample size, with cache, first/repeat and route
  breakdowns. Use a reporting/export path that supports percentiles; do not imply
  GA's default average is a percentile. Track failed/cancelled wait separately from
  completion latency to avoid hiding slow abandoned work.
- **Coverage:** GA sees a selected subset because of blockers and opt-outs. Rates
  may be biased in either direction; they are not a proven floor or whole-site
  error rate. Optional edge counts measure document loads, not unique visitors or
  job denominators. Never divide GA job failures by unrelated edge page views.

## Event design and privacy

Use small bounded events and allowlisted enums/numbers. Include a bounded source
release identifier and schema version so a promoted build can be compared with its
predecessor. Snapshot job context before emitting start; mutable previous-job
counts must not leak into the next request. Keep request IDs needed for deduplication
local where possible. If a reporting pipeline needs transmitted correlation,
use short-lived random attempt IDs, with documented expiry and no persistent
person/device identity or linkage to debug-report IDs.

No photos, typed words/seeds, names selected, filenames, face/latent data, project
contents, arbitrary URLs or error text. Face-count/dimension information is coarse
and never identifies a face. No frame-by-frame progress events, raw traces, exact
GPU fingerprints or unbounded queue/stage labels. Keep telemetry cheap and avoid
competing with inference or large downloads. Detailed debug records remain opt-in.

Audit automatic GA page/referrer/click collection as well as custom parameters;
custom-event sanitization alone does not protect automatic metadata. Ensure input
content never appears in reported URLs or titles. Say clearly that GA uses analytics
cookies and coarse usage data; do not describe it as identifier-free anonymous
counts. Preserve GPC/DNT/Save-Data behavior, ad restrictions and existing off-host/
automation exclusions. Debug refusal must not be represented as analytics consent.

This does not enable desktop-binary analytics or the disabled Cloudflare counter.
Evaluate any edge counter separately for current plan availability, cost, opt-outs
and document-route allowlisting; label its coverage precisely.

## Delivery and verification

1. Confirm real GA event receipt with a controlled visit and GA Realtime/DebugView;
   source inclusion and script loading are not proof of collection. Keep test
   traffic distinguishable from real users. Verify relevant dashboard dimensions,
   key events and retention settings rather than relying on the September record.
2. Establish release-tagged dashboards from existing events first, then add visit,
   queue, route, stage, photo, restore and export measurements alongside the product
   features that provide reliable lifecycle boundaries. Keep names and enums in
   the analytics schema/reference and register required GA dimensions/metrics.
3. Verify success, failure, cancellation, interruption, retries, stale jobs and
   duplicate terminal signals; ensure one logical outcome per request. Exercise
   opt-outs and inspect custom and automatic network payloads for private content.
4. Compare the promoted build with its predecessor using matching action/route/
   cache/device cohorts. Prioritize failure spikes, lost repeat-visit cache benefits,
   p95 latency regressions and save/share failures; keep sample size visible.
   Set alert thresholds after obtaining a baseline and minimum useful sample sizes,
   rather than inventing targets before traffic is known.

This supports the promote → diagnostics/analytics → iterate approach. Physical
phone evidence remains useful feedback, not a pre-promotion dependency.

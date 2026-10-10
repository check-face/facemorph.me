# Analytics for next.facemorph.me

Updated **10 October 2026**. Google Analytics 4 is an operator-approved, narrow exception to the
no-third-party-runtime rule. `scripts/check-no-third-party.mjs` names the one allowed URL and fails
on any other Google measurement or advertising origin.

Property: **facemorph.me - GA4** (`364008169`), stream `G-F5F6JBLJ54`. The same stream as classic on
purpose: one journey (banner on classic, then next) is one visitor, told apart by hostname. Cross-domain
linking is in the tag (`linker.domains`), and "facemorph.me" is an unwanted referral so the hop does not
start a new session.

> Current requirements: [10 October analytics plan](plans/analytics-2026-10-10.md).
> Exact implementation, receipt and deployment status: [delivery record](plans/delivery-2026-10-10.md).

## What we want to know, and what answers it

| Question | Answered by |
|---|---|
| Who arrives, from where, on what? | `page_view` (automatic), source/medium, hostname, `platform`, `webgpu`, `cores_band`, `memory_band` |
| Does the classic banner send people? | automatic `click` (outbound) on classic to next.facemorph.me, then sessions on hostname `next.facemorph.me` |
| Do new people get a result? | `first_result` (once per device) with `ttfr_ms`. Mark it as a **key event** once it has arrived (GA only lists received events) |
| What does the first visit cost? | `models_download`: `scope`, `size_mb`, `duration_ms`, `outcome`. Kept apart from job time on purpose |
| Which features are used? | `job_start` / `job_finish` by `action`, `input_kind`, `morph_kind`, `faces`, `frames`; `export` by `export_kind` and `method`; `photo_select`; `names_use` |
| Do jobs work? | `job_finish.outcome` by `route`, `platform`, `memory_band`, `isolated`; failures by `error_kind` and `error_stage` |
| Is the fast route being used? | `route` against user property `webgpu`. GPU availability does not imply qualification; evaluate fallback correctness and measured cost |
| Warm or cold? | `cache_state` on `job_start` |

## Events

`job_start`, `job_finish`, `first_result`, `models_download`, `export`, `photo_select`, `names_use`,
`visit_milestone`, `queue_enter`, `queue_finish`, `operation_start`, `operation_result`,
`route_admission`, `stage_duration`, `responsiveness`.

Schema version 2 carries the built source `release` and `visit_kind` (first/returning/unknown).
Logical jobs have an ephemeral 16-hex `attempt_id` for joining start/terminal records; it is not
registered as a high-cardinality dimension and never links to diagnostic device/run tokens.
Queued requests retain local IDs only. Route admission results use `route_admission`; explicit
admission attempts use `operation_start.operation=qualification`. Cached admission observations
are distinct from a new correctness check. `requested_route` and actual `route` are separate.

Visit milestones distinguish file readiness from decoded visible images/playable video.
`interaction-delay` is a supported Event Timing summary, not a claim of exact INP.
CLS uses the maximum session window. Export `ready` means attempt, while completed/cancelled/failed
are terminals. Share completion proves the browser handoff, not recipient delivery.
Original/frame cache hit/miss observations are not inference performance measurements.

## What is never sent

Names, seeds, photos, file names, project contents, faces, videos, error text. Every parameter passes a
closed vocabulary in `src/Next/analytics.mjs` (`clean`), and anything else is dropped. Detailed debug
records stay in the consented diagnostics collector, which is a separate system with its own opt-in.

## Registered in GA

Event-scoped dimensions: Job action, Job outcome, Processing route, Error kind, Error stage, Input kind,
Export kind, Export method, Download scope, Cache state, Morph kind.
User-scoped: Platform, WebGPU available, CPU cores band, Memory band, Cross origin isolated.
Metrics: Job duration ms, Time to first result ms, Model download MB, Faces in job, Frames in job.
Verified 10 October: user/event retention **14 months**, reset on new activity enabled.
New event dimensions registered: Candidate release (`release`), Visit kind (`visit_kind`),
Visit milestone (`milestone`), Operation (`operation`), Operation reason (`reason`),
Responsiveness metric (`metric`), Requested route (`requested_route`), Photo face count (`face_count`),
Photo size band (`size_band`). New metrics: Queue wait ms (`wait_ms`, milliseconds),
Queue depth (`queue_depth`, standard), Responsiveness value (`metric_value`, standard; units depend
on metric). Registration can take 24 hours to become reportable; it is not receipt evidence.

Enhanced measurement: page views, scroll, outbound click, video and file-download collection remain.
Automatic **site search and form interaction** were disabled and saved on this shared stream on
10 October, reducing automatic content metadata on both classic and candidate. Custom tag config
sanitizes page location to origin+pathname, title to FaceMorph, and referrer to origin.

The saved [Candidate delivery · release and outcomes exploration](https://analytics.google.com/analytics/web/#/analysis/a140064290p364008169/edit/pVj_wXmITseXHgVSziWttQ)
filters hostname to next.facemorph.me, rows by event/release and columns by outcome. Historical
unversioned events remain `(not set)`; do not mix them into current-release error rates.
Observed historical receipt includes job_start/job_finish/export/models_download; new schema receipt
requires the promoted source, and is tracked in the delivery record.

## Rules the loader keeps

- Runs only on `https://next.facemorph.me`. Not on the desktop app, labs, localhost, or under automation.
- Loads after the page is idle, so it does not compete with the model download.
- Off for Save-Data, Global Privacy Control, Do Not Track. Never gated on `effectiveType`.
- Google signals and ad personalisation are off; ad storage is denied.
- Fails open: a blocked script never affects the product.

## Known limits

- Ad and privacy blockers stop GA. Their share is unknown. `hosting/next-static/analytics.mjs` is an
  edge-side page-view counter that blockers cannot stop, written and tested but **not enabled** (see the
  comment in `wrangler.jsonc`). If enabled, it counts document loads, not unique visitors or job attempts.
- GA reports the visitors it can see. Blockers, opt-outs and lost events can bias observed error rates in either direction.
- The beacon path under this site's cross-origin isolation was checked as far as the script loading and
  `crossOriginIsolated` staying true. Delivery could not be confirmed from the two browsers available
  while building (one blocks Google, the other reports beacons as aborted with and without isolation).
  Confirm in GA Realtime from a phone after the first promotion.

## Percentiles and unresolved requests

GA's standard metric averages are not p50/p95. `scripts/analytics-report.py` consumes a raw GA4
BigQuery JSON array or JSONL export locally and writes `report.json` plus a standalone HTML
reliability/latency dashboard. It filters the candidate hostname, joins ephemeral attempts across
fallback routes, deduplicates terminals, separates cancellation/interruption, reports starts without
terminals after 24 hours as unknown, and uses nearest-rank percentiles with sample size. Output has
no person/device/request IDs. A missing start is reported separately from an unknown terminal.

```sh
python scripts/analytics-report.py /path/to/events.jsonl --output /tmp/candidate-analytics
python -m unittest discover -s scripts -p test_analytics_report.py
```

Raw events are required. An aggregate GA CSV cannot recover duration percentiles or match attempts.
This tool does not enable a BigQuery link, billing, a new collector or exports; availability of a
raw-event export remains an operational dependency. Keep unpopulated metrics unknown and show
counts/coverage rather than inventing a baseline or alert threshold.

## Consented diagnostics acquisition detail

Debug reports remain separately opted in. Acquisition rows now contain rounded, bounded MiB:
`modelLoadedMb`, `modelTotalMb`, `networkLoadedMb`, `networkPlannedMb`. Zero network bytes with
model-read progress describes cache reads/verification, not a redownload. Prior reports lacked
these fields and cannot establish network transfer. Storage observations preserve zero usage,
persistence denied and unknown values distinctly. Sender and collector validate the same fields.

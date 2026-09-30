# Analytics for next.facemorph.me

Written **30 September 2026**. Google Analytics 4 is an operator-approved, narrow exception to the
no-third-party-runtime rule. `scripts/check-no-third-party.mjs` names the one allowed URL and fails
on any other Google measurement or advertising origin.

Property: **facemorph.me - GA4** (`364008169`), stream `G-F5F6JBLJ54`. The same stream as classic on
purpose: one journey (banner on classic, then next) is one visitor, told apart by hostname. Cross-domain
linking is in the tag (`linker.domains`), and "facemorph.me" is an unwanted referral so the hop does not
start a new session.

## What we want to know, and what answers it

| Question | Answered by |
|---|---|
| Who arrives, from where, on what? | `page_view` (automatic), source/medium, hostname, `platform`, `webgpu`, `cores_band`, `memory_band` |
| Does the classic banner send people? | automatic `click` (outbound) on classic to next.facemorph.me, then sessions on hostname `next.facemorph.me` |
| Do new people get a result? | `first_result` (once per device) with `ttfr_ms`. Mark it as a **key event** once it has arrived (GA only lists received events) |
| What does the first visit cost? | `models_download`: `scope`, `size_mb`, `duration_ms`, `outcome`. Kept apart from job time on purpose |
| Which features are used? | `job_start` / `job_finish` by `action`, `input_kind`, `morph_kind`, `faces`, `frames`; `export` by `export_kind` and `method`; `photo_select`; `names_use` |
| Do jobs work? | `job_finish.outcome` by `route`, `platform`, `memory_band`, `isolated`; failures by `error_kind` and `error_stage` |
| Is the fast route being used? | `route` against user property `webgpu`. A device with WebGPU running `cpu` is the worst outcome in the product |
| Warm or cold? | `cache_state` on `job_start` |

## Events

`job_start`, `job_finish`, `first_result`, `models_download`, `export`, `photo_select`, `names_use`.

## What is never sent

Names, seeds, photos, file names, project contents, faces, videos, error text. Every parameter passes a
closed vocabulary in `src/Next/analytics.mjs` (`clean`), and anything else is dropped. Detailed debug
records stay in the consented diagnostics collector, which is a separate system with its own opt-in.

## Registered in GA

Event-scoped dimensions: Job action, Job outcome, Processing route, Error kind, Error stage, Input kind,
Export kind, Export method, Download scope, Cache state, Morph kind.
User-scoped: Platform, WebGPU available, CPU cores band, Memory band, Cross origin isolated.
Metrics: Job duration ms, Time to first result ms, Model download MB, Faces in job, Frames in job.
Event data retention is 14 months (default was 2). Adding a parameter in code means registering it here.

## Rules the loader keeps

- Runs only on `https://next.facemorph.me`. Not on the desktop app, labs, localhost, or under automation.
- Loads after the page is idle, so it does not compete with the model download.
- Off for Save-Data, Global Privacy Control, Do Not Track. Never gated on `effectiveType`.
- Google signals and ad personalisation are off; ad storage is denied.
- Fails open: a blocked script never affects the product.

## Known limits

- Ad and privacy blockers stop GA. Their share is unknown. `hosting/next-static/analytics.mjs` is an
  edge-side page-view counter that blockers cannot stop, written and tested but **not enabled** (see the
  comment in `wrangler.jsonc`). Enabling it gives the denominator.
- GA reports the visitors it can see. Error rates from here are a floor for the people it reaches.
- The beacon path under this site's cross-origin isolation was checked as far as the script loading and
  `crossOriginIsolated` staying true. Delivery could not be confirmed from the two browsers available
  while building (one blocks Google, the other reports beacons as aborted with and without isolation).
  Confirm in GA Realtime from a phone after the first promotion.

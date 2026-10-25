# Changeover statistics Worker

Anonymous, aggregate usage and timing counters for the before/after-cutover view in Grafana
(`metrics.facemorph.me`, folder "FaceMorph changeover (public stats)"). Specification: PLAN.md
"Changeover statistics in Grafana".

- `POST /stats/v1` on `next.facemorph.me` / `facemorph.me`: same-origin beacons of closed-vocabulary
  events (at most 4 KB, 200 events). Unknown values are dropped; numbers are clamped; clients are
  rate-limited in memory by a hashed address with a daily salt that is never stored.
- `GET /stats/metrics`: Prometheus text, bearer token (`SCRAPE_TOKEN`). Scraped by the triton
  Prometheus as job `facemorph_web`; every metric starts with `fm_web_`.
- Storage: one Durable Object (SQLite) holding `key -> value` counters. No per-event records.

From this directory, install the service's tool dependencies with `npm ci`, then run `npm test`.
The suite includes the existing pure/handler checks and a real workerd/SQLite check that posts
an aggregate event, restarts the Worker, and verifies the counter and scrape authorization survive.
The deployment entry exports only the handler and `StatsCounters`; helper exports stay test-only.

`cloudflare.config.ts` preserves the existing Worker name, both routes, and the SQLite
`StatsCounters` class. Do not rename that class or its Worker: those identities retain the
existing Durable Object namespace and counters. `npm run deploy -- --dry-run` uses the installed
`cf` CLI and Vite plugin to build and check the deployment without uploading it.

Pushing changes here to `main` runs `.github/workflows/stats-worker.yml`. The workflow uses
Node 24 and `cf auth whoami`, then deploys with `cf deploy --secrets-file`. The scrape token
comes from the existing Actions secret, is written only to a mode-0600 temporary JSON file,
and is removed on exit. It never travels as a process argument or log text. Supply the
existing `CLOUDFLARE_ACCOUNT_ID` variable and `CLOUDFLARE_API_TOKEN` secret to the workflow.
The post-deploy smoke requires unauthenticated metrics to return 401 and the existing token
to fetch valid metrics. A successful local dry run is not deployed evidence.

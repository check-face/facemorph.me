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

Test: `npm test` (node:test, no dependencies). Deploy: pushing changes here to `main` runs
`.github/workflows/stats-worker.yml`.

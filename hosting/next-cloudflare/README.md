# Private diagnostics collector

The imported collector lives here independently of the hosted inference API. The combined
static-site Worker imports its fetch handler; `entry.mjs` is the standalone entry point.
This checkout does not change the currently deployed collector until a delivery action runs.

`environment.mjs` owns public endpoint/host and exact allowed-origin bindings for `next`,
`production` and `local`. The reporter imports its endpoint selector from that same module.
The Worker selects an environment with `DIAGNOSTICS_ENVIRONMENT` (default `next`); unknown
values fail closed. It serves only the configured host and `/diagnostics/events` path.
There is no wildcard or credentialed CORS, public reader, list or deletion endpoint.

`validation.mjs` is the sole bounded event allowlist. The compatibility module under
`apps/web/hosting/` re-exports that function, so the client tests and collector cannot drift.
Session consent and `X-Facemorph-Diagnostics-Consent: session-v1` remain mandatory. The
marker is not authentication or proof of a human click. Unknown/private payload fields are
rejected; cookies, request IP and raw user agents are never stored. A request contains at most
200 validated events and 64 KiB, with a five-second body-read deadline.

Records have a receipt timestamp, **no expiry field and no automatic TTL** (the 17/18 October
retention decision). R2 is primary; a bound KV namespace is the fallback. Both refusing means
503, never a false save confirmation. Keep storage private, application/invocation logs off,
and the buckets free of lifecycle expiration rules. No expiry metadata is written by this
collector. Infrastructure privacy/settings and available account quotas remain deployment facts.
`FREE_PLAN_CONFIRMED=true` must be supplied explicitly before writes are enabled.

## Local fixture

After the root workspace installation, run from the repository root:

```sh
node hosting/next-cloudflare/local.mjs --port=8788 --persist=.cache/diagnostics-local
```

This runs the real workerd runtime and real persistent local R2/KV stores, using the existing
model-host workspace's Miniflare version. It prints its loopback POST endpoint. The local
origin allowlist is in `environment.mjs`. It never sends a report to a deployed collector.
Stop with Ctrl-C or SIGTERM. Pass `--port=0` for an available port. Local evidence stays in
the ignored cache. Do not use private reports as fixture inputs.

```sh
node --test hosting/next-cloudflare/worker.test.mjs apps/web/src/Next/reporting.test.mjs
node --test hosting/next-cloudflare/collector.workerd.mjs
```

The inherited Worker/privacy/deletion regression cases remain, with their obsolete expiry
expectations changed to the retention decision. The workerd suite starts the documented
fixture command, posts real consented/declined payloads, reopens its persisted R2 store,
checks a real KV batch has no TTL, verifies environment routing/CORS, and checks the shared
allowlist. It runs in the eris Cloudflare lane because workerd requires glibc 2.32 or newer.
Local runtime evidence is not a deployed Cloudflare pass.

## Build and deployment configuration

`cloudflare.config.ts` and `vite.config.mts` use the installed `cf`/Vite tools. The standalone
build requires explicit `DIAGNOSTICS_WORKER`, `DIAGNOSTICS_ZONE`, `DIAGNOSTICS_BUCKET` and
`FREE_PLAN_CONFIRMED` values. `DIAGNOSTICS_NAMESPACE_ID` optionally attaches the existing KV
fallback. No account/storage identifiers or credentials are embedded in the browser config.
From this directory, with those values supplied externally:

```sh
../../node_modules/.bin/vite build
../../node_modules/.bin/cf deploy --prebuilt --dry-run
```

This two-step command reuses the root workspace dependencies. It builds the default `next`
bindings and checks the output without uploading it or provisioning resources. The combined
site must bind the same storage/confirmation/environment variables when importing the handler.
The production configuration is separate from authorization to promote the site or rebind
production diagnostics; those actions belong to the delivery/operator gate.

Private KV run deletion remains available from the repository root:

```sh
node hosting/next-cloudflare/delete-run.mjs <run-uuid>
```

Supply `CLOUDFLARE_ACCOUNT_ID`, `DIAGNOSTICS_NAMESPACE_ID` and `CLOUDFLARE_API_TOKEN` outside
Git. It deletes only the requested run prefix without fetching raw values. Disable that debug
session first; late in-flight writes can require another deletion pass. This command does not
claim to delete primary R2 records.

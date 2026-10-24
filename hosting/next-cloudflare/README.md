> Deployment update16 September2026: the operator confirmed Workers Free. Private namespace `3a71e4ec58354345be24a1e02a3edb82` was created. The standalone Worker upload succeeded but its zone route was rejected by the token permissions. The delivery configuration now imports this handler into `../next-static/worker.mjs` and invokes it only for `/diagnostics/*`; standalone route deployment is not required. The public endpoint, private saved record and30-day expiry passed verification; see [deployment evidence](../../docs/review/next-delivery/diagnostics-public-proof.json).

# Managed private Next diagnostics

Deployed at `https://next.facemorph.me/diagnostics/events` through the combined static-site Worker. No TrueNAS,
local computer, model asset bucket or public report reader is involved.

`worker.mjs` serves only `POST /diagnostics/events` and its CORS preflight. Bind it
on the `next.facemorph.me/diagnostics/*` route before the static site's fallback.
The product's off-by-default reporter uses that absolute HTTPS endpoint, also
from installed Tauri builds. Exact accepted origins: `https://next.facemorph.me`,
`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`. Native CSP
must allow `https://next.facemorph.me` in `connect-src`; no localhost-port or null
origin allowance is included. There is no credentialed CORS or wildcard.

## Privacy and retention

- Explicit session consent stays in the product. The request also carries
  `X-Facemorph-Diagnostics-Consent: session-v1`; this is a contract marker, not
  authentication or proof of a human click. No pre-consent backlog is uploaded.
- Strict allowlist mirrors `hosting/next/server.py`: random UUIDs, safe platform /
  browser/provider categories and major version, bounded build/language strings,
  stage names, timings and enumerated error codes. Unknown keys are rejected.
  No photos, words/seeds, latents, media, filenames, IP, cookies or raw user agents
  enter KV. Request bodies are bounded to2048 bytes and five seconds.
- Every event has its own random KV key under `runs/<run UUID>/`, an explicit
  `receivedAt`/`expiresAt`, and a KV expiration exactly30 days after receipt.
  Expiration is mandatory in the only write path: it needs no local cron, D1
  Time Travel or backup restore cleanup. Expired keys are not made public.
- Worker observability/invocation logs are disabled; code has no console logging.
  Provider infrastructure privacy is governed by the Cloudflare account/service
  settings, separately from application payload storage.
- There are no application backups, local exports or public GET/list/delete
  routes. Keep operator access scoped to this namespace. Do not introduce raw
  report copies/backups without implementing the same original expiry deadline.
- `delete-run.mjs` deletes one explicit run via the private Cloudflare API without
  downloading raw records. Disable the submitting debugging session first;
  late already-in-flight writes require another deletion pass. KV changes may
  take time to propagate. Automatic expiry still applies to every late event.

## Free allowance and deployment handoff

The operator confirmed **Workers Free** on16 September2026. The current config has a private `DIAGNOSTICS` KV binding and `FREE_PLAN_CONFIRMED = "true"`. A configured binding is not deployment evidence: verify the public endpoint, private saved event and expiry before handoff. Do not upgrade the plan or assume the flag enforces billing. Temporary TrueNAS collection is permitted only as a documented fallback; it must never block generation.

Cloudflare currently allows1000 KV writes/day and1GB storage on Workers Free.
Each accepted event consumes one write; no per-event read/list/counter is needed.
At the body bound,30 days of1000 daily events is under70MB including record/key
metadata. Account-wide unrelated usage reduces the available allowance. Quota
exhaustion rejects writes; the endpoint returns503 and the product reports failure
without blocking generation or retaining an offline upload queue. This limit may
be reached with extensive debugging; do not claim unlimited reporting or silently
upgrade. Review observed usage before changing event frequency or storage design.

Private manual deletion (uses scoped environment credentials, never prints them):

```sh
node hosting/next-cloudflare/delete-run.mjs <run-uuid>
```

Set `CLOUDFLARE_ACCOUNT_ID`, `DIAGNOSTICS_NAMESPACE_ID` and
`CLOUDFLARE_API_TOKEN` outside source control. The script caps a deletion batch at
900 keys and rejects keys outside the requested run; API operations share Free
quotas. For a larger run use controlled dashboard/API deletion over available
allowances. Do not expose those credentials in browser bundles.

Tests:

```sh
node --test hosting/next-cloudflare/worker.test.mjs src/Next/fresh-review.test.mjs
```

Tests exercise actual Worker Request/Response/stream code with a fake KV binding,
real validation and expiration options, explicit native origins, quota failures,
private deletion and the real client reporter with mocked boundaries. They are
not a deployed Cloudflare or native-WebView delivery proof. Before publication,
verify the actual public endpoint, absent read access, confirmed private KV write
and expiration, Tauri preflight/CSP, off/withdrawal behavior and quota failure.

Primary references checked16 September2026:
[KV Free pricing / hard limits](https://developers.cloudflare.com/kv/platform/pricing/),
[expiration and verified puts](https://developers.cloudflare.com/kv/api/write-key-value-pairs/),
[Worker invocation logging controls](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

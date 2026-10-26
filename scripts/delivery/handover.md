# Handover and retirement actions

Generated from `scripts/delivery/runbook.json` by `scripts/delivery/render-handover.mjs` (fm-5u9); edit the runbook, not this file. Every command here runs in its dry-run or read-only form in CI (`scripts/delivery/dry-run.mjs`, workflow `delivery-dry-run`). Nothing here has been executed. The operator chooses timing and order; Cloudflare commands use the cf CLI, never Wrangler. Observed read-only on 2026-10-24.

Zone `facemorph.me` is `893772fe7a5a4ee368f71706bc19e609`; account `8f550a622a484c03d9267efd45573583`.

## Rollback targets

| Artifact | Build | Source | Digest |
| --- | --- | --- | --- |
| classic candidate build serving next.facemorph.me (observed 24 October, 15:40 UTC) (`candidate`) | next-site.yml run 40080943175, artifact next-site-45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94 | `facemorph-me/facemorph.me-classic@45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94` | `228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b` |
| the pinned control (import/control-artifact.json): an earlier candidate build, no longer what next.facemorph.me serves (`control`) | next-dbc2925ff6e7dcb6 | `facemorph-me/facemorph.me-classic@551b60726290b2d67a32c62477b2fd964de51f96` | `aaeb99a92a082b5399aa809a5aadd802c3c61ccc167f306aa86fc091b527bf50` |
| legacy facemorph.me on Vercel: classic master's last successful deploy.yml (`legacyProduction`) | deploy.yml run 36654890071 | `facemorph-me/facemorph.me-classic@e6e229831533244133f80aea61ae944c811bf9a0` | none (not an on-device artifact) |
| names.facemorph.me on Vercel (facemorph-names) (`namesSite`) | GitHub deployment 359827192 (Production) | `facemorph-me/facemorph-names@9243fef8a34050ccf0a08d37de02784bd06fb57b` | none (not an on-device artifact) |

## Retirement inventory

Remove items run at the action named in "When"; keep items stay, with the reason.

| Item | Target | Disposition | When | Reason | Command | Dry run |
| --- | --- | --- | --- | --- | --- | --- |
| `dns-api` | api.facemorph.me CNAME triton.dilger.dev (proxied), record b2c42b2999fa669db0c9a8c9467a2703 | remove | api-retirement | The old API's public hostname; nothing in the on-device app calls it. | `cf dns records delete b2c42b2999fa669db0c9a8c9467a2703 --zone 893772fe7a5a4ee368f71706bc19e609 --force` | `cf dns records delete b2c42b2999fa669db0c9a8c9467a2703 --zone 893772fe7a5a4ee368f71706bc19e609 --dry-run` |
| `dns-e4e` | e4e.facemorph.me CNAME triton.dilger.dev (proxied), record ec9bc3bd316f393fe194f8b93b94bbbd | remove | api-retirement | The hosted encoder's hostname; the app encodes photos on the device. | `cf dns records delete ec9bc3bd316f393fe194f8b93b94bbbd --zone 893772fe7a5a4ee368f71706bc19e609 --force` | `cf dns records delete ec9bc3bd316f393fe194f8b93b94bbbd --zone 893772fe7a5a4ee368f71706bc19e609 --dry-run` |
| `dns-checkface` | checkface.facemorph.me CNAME facemorph-me.github.io, record baa8e426a96ed754490629120d52c525 | remove | api-retirement | The API documentation site (GitHub Pages of facemorph-me/checkface); retired with the API. | `cf dns records delete baa8e426a96ed754490629120d52c525 --zone 893772fe7a5a4ee368f71706bc19e609 --force` | `cf dns records delete baa8e426a96ed754490629120d52c525 --zone 893772fe7a5a4ee368f71706bc19e609 --dry-run` |
| `pages-checkface` | GitHub Pages of facemorph-me/checkface (master:/docs, custom domain checkface.facemorph.me) | remove | api-retirement | Publishes the API documentation; the repository itself stays archived as-is. | `gh api -X DELETE repos/facemorph-me/checkface/pages` | GitHub has no dry-run for disabling Pages; the read-only probe shows the site exists. |
| `caddy-api` | triton: caddy-docker-proxy service ccheckfaceapi (caddy label api.facemorph.me), /usr/local/caddy-docker-proxy/docker-compose.yml | remove | api-retirement | Routes api.facemorph.me to the API container. | `ssh triton 'cd /usr/local/caddy-docker-proxy && docker compose rm -sf ccheckfaceapi' && remove the ccheckfaceapi service from that docker-compose.yml so a later 'up' does not restore it` | Docker Compose v2.2.3 on triton has no --dry-run; the probe shows the container and its caddy label. |
| `caddy-e4e` | triton: caddy-docker-proxy service ce4eapi (caddy label e4e.facemorph.me) | remove | api-retirement | Routes e4e.facemorph.me to the encoder container. | `ssh triton 'cd /usr/local/caddy-docker-proxy && docker compose rm -sf ce4eapi' && remove the ce4eapi service from that docker-compose.yml` | Docker Compose v2.2.3 on triton has no --dry-run; the probe shows the container and its caddy label. |
| `triton-api` | triton: compose project server, service api (container server-api-1, image server_api), checkface/src/server | remove | api-retirement | The hosted inference API (checkface backend, archived as-is). | `ssh triton 'cd /home/chris/repos/checkface/src/server && docker compose -p server rm -sf api'` | Docker Compose v2.2.3 on triton has no --dry-run; the probe shows the running container. |
| `triton-encoder` | triton: compose project server, service encoderapi (container server-encoderapi-1, image olicoad/encoder4editing) | remove | api-retirement | The hosted e4e encoder behind e4e.facemorph.me. | `ssh triton 'cd /home/chris/repos/checkface/src/server && docker compose -p server rm -sf encoderapi'` | Docker Compose v2.2.3 on triton has no --dry-run; the probe shows the running container. |
| `triton-db` | triton: compose project server, service db (container server-db-1, mongo 4.2): the API's stored GUIDs and results | keep | separate data-disposal operation | Production data disposal and deleting personal records are a separate explicit operation (out of scope here); the container stops with that operation, not with API retirement. | none | Kept here; no command. |
| `cred-mongo` | MONGO_INITDB_ROOT_PASSWORD in checkface/src/server/docker-compose.yml (name only) | remove | separate data-disposal operation | API-only; goes with the database at its disposal. | none | Removed with the compose project; the probe shows the variable is set (its value is never read out). |
| `cred-vercel` | VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID (secrets of facemorph-me/facemorph.me-classic) | remove | vercel-retirement | Used only by classic deploy.yml to publish legacy facemorph.me. | `for s in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do gh secret delete "$s" -R facemorph-me/facemorph.me-classic; done` | gh has no dry-run for deleting a secret; the probe lists the secret names. |
| `dns-vercel-ns` | vercel.facemorph.me NS ns1/ns2.vercel-dns.com, records e644890bdfee1ffb266ecd5759f83c0e and 0285eb6dad67df6609f19b6d3be71481 | remove | vercel-retirement | Delegation to Vercel's DNS, used only by the Vercel publishers. | `for id in e644890bdfee1ffb266ecd5759f83c0e 0285eb6dad67df6609f19b6d3be71481; do cf dns records delete "$id" --zone 893772fe7a5a4ee368f71706bc19e609 --force; done` | `cf dns records delete e644890bdfee1ffb266ecd5759f83c0e --zone 893772fe7a5a4ee368f71706bc19e609 --dry-run` |
| `keep-models` | Worker facemorph-models (models.facemorph.me) over R2 facemorph-runtime-mirror, SITE service binding, its deploy credentials | keep | always | Second runtime origin of every on-device artifact, including rollback artifacts. | none | Kept. |
| `keep-stats` | Worker facemorph-stats (/stats/v1 on next.facemorph.me) and its scrape token (STATS_SCRAPE_TOKEN, SCRAPE_TOKEN) | keep | always | The changeover statistics' 'after' side. | none | Kept. |
| `keep-metrics` | metrics.facemorph.me (Grafana via caddy service cmetrics on triton) and the triton Prometheus with its stored old-API counter series (5-year retention) | keep | always | The changeover statistics' 'before' side and the cutover annotations; the CNAME to triton stays. | none | Kept. |
| `keep-triton` | the triton machine: development worker (GitHub runners for both repositories), Prometheus and Grafana host | keep | always | Only its Triton inference/API processes, their routes and API-only credentials are remove items. | none | Kept. |
| `keep-diagnostics` | Worker facemorph-next-diagnostics and R2 facemorph-diagnostics (the diagnostics collector) | keep | always | Collects reports for every on-device artifact. | none | Kept. |
| `keep-names-data` | Workers facemorph-name-catalogue and facemorph-seed-gallery (preview and latent Workers) and R2 facemorph-names-snapshot | keep | until the snapshot and static names replace their API dependency | The names catalogue and previews the app reads; their API dependency is replaced by the snapshot (fm-old) before they change. | none | Kept. |
| `keep-next` | Worker facemorph-next (next.facemorph.me) and its assets | keep | always | Serves the candidate today and the monorepo build after the handover. | none | Kept. |
| `keep-cloudflare-token` | CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (Workers, R2, Pages deploys) | keep | always | Shared by every Cloudflare publisher that stays. | none | Kept. |
| `keep-preview-tunnel` | cloudflared tunnel facemorph-preview (labs.facemorph.me -> truenas), record 2a02b6eb432cbb165df394bb5192b24b, TUNNEL_TOKEN | keep | outside the API retirement | App-legacy preview host, not the API; its own retirement is the preview owner's. | none | Kept. |

## Source references

| Reference | Disposition |
| --- | --- |
| classic hosting/gallery/materialize.py, .github/workflows/name-catalogue.yml | reads the names snapshot (fm-old) instead of the API before the API retires |
| classic src/Next/Product.fs (FAQ) and src/explain.md linking checkface.facemorph.me/api | retirement copy: the links go and the copy says the API is retired |
| classic src/Config.fs, the overlay Config.fs, verify-config.mjs, verify-overlay.py | historical, classic only, unchanged; apiAddr is never copied into the new app |
| facemorph-names grid (names.facemorph.me) | retired: the host redirects to the main app's names modal (namesHost below); the repository keeps its history with an archive notice |
| external multi-morph-test.vercel.app (api/face/?num_multi=N&guidK=…&amountK=…) | replaced by the on-device weighted face blend; its user is told before the API retires (action api-retirement) |

## Actions

### Early retained-candidate promotion: facemorph.me to the retained candidate before the monorepo app is ready

- **Action:** `early-promotion`
- **Owner:** operator
- **Preconditions:**
  - The retained candidate artifact (deploy-next 228eb615…) passes post-delivery-check --mode app on next.facemorph.me.
  - Every mirrored runtime file of the candidate is held by models.facemorph.me (the dry run's R2 listing).
  - The operator's explicit decision to promote early is recorded in PLAN.md's decisions table.
  - artifacts.candidate names the build serving next.facemorph.me now (re-pin it from classic's latest next-site.yml run if it moved, then re-render handover.md).
- **Commands:**
  - Route facemorph.me to Worker facemorph-next, which serves the retained candidate: replace A record ef8a8938cd3275bf1a4e83a7050e8eb6 (76.76.21.21, Vercel) with a proxied AAAA 100:: and add the facemorph.me/* Worker route (cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"AAAA","name":"facemorph.me","content":"100::","proxied":true}').
  - Dry run: `cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body {"type":"AAAA","name":"facemorph.me","content":"100::","proxied":true} --dry-run`
- **Rollback target:** legacy facemorph.me on Vercel: classic master's last successful deploy.yml: deploy.yml run 36654890071, `facemorph-me/facemorph.me-classic@e6e229831533244133f80aea61ae944c811bf9a0`
- **Rollback steps:**
  - cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"A","name":"facemorph.me","content":"76.76.21.21","proxied":false}' (Vercel production, deploy.yml run 36654890071).
- **One publisher:** Classic deploy.yml (vercel --prod) is disabled (gh workflow disable deploy.yml -R facemorph-me/facemorph.me-classic); classic next-site.yml remains the only publisher of facemorph-next until the candidate-source handover.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode app --host facemorph.me --expect-digest 228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b --identity next-site-SHA256SUMS`
- **Cutover annotation:** `node scripts/delivery/annotate-cutover.mjs --action early-promotion --host facemorph.me --digest 228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b`

### Candidate-source handover: next.facemorph.me from classic candidate/next-delivery-20260916 to the monorepo

- **Action:** `candidate-source-handover`
- **Owner:** operator (release bead fm-s3o)
- **Preconditions:**
  - The monorepo release bead set is closed and its artifact passed the full local validation.
  - models.facemorph.me holds every runtime path of the live and rollback artifacts (warm them, or re-point the mirror's origin, before the switch; verified by the dry-run HEAD list).
- **Commands:**
  - Deploy the monorepo artifact to Worker facemorph-next through the monorepo's deploy workflow (fm-6fx6), then disable classic next-site.yml's deploy job: gh workflow disable next-site.yml -R facemorph-me/facemorph.me-classic.
- **Rollback target:** classic candidate build serving next.facemorph.me (observed 24 October, 15:40 UTC): next-site.yml run 40080943175, artifact next-site-45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94, `facemorph-me/facemorph.me-classic@45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94`, deploy-next digest `228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b`
- **Rollback steps:**
  - Redeploy the classic candidate artifact next-site-551b60726290b2d67a32c62477b2fd964de51f96 (deploy-next 228eb615…) to facemorph-next and re-enable classic next-site.yml.
- **One publisher:** After the switch only the monorepo deploy workflow publishes facemorph-next; classic next-site.yml is disabled.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode app --host next.facemorph.me --expect-digest <the monorepo artifact's deploy-next digest> --identity next-site-SHA256SUMS`
- **Cutover annotation:** `node scripts/delivery/annotate-cutover.mjs --action candidate-source-handover --host next.facemorph.me --digest <the monorepo artifact's deploy-next digest>`

### Production promotion: facemorph.me from legacy Vercel (classic master) to the chosen on-device artifact

- **Action:** `production-promotion`
- **Owner:** operator
- **Preconditions:**
  - The chosen artifact passes post-delivery-check --mode app on next.facemorph.me.
  - The operator's explicit cutover decision is recorded in PLAN.md's decisions table.
- **Commands:**
  - If early-promotion ran, facemorph.me already routes to Worker facemorph-next: production promotion is the deploy of the chosen artifact there (rollback target: the retained candidate). Otherwise: Route facemorph.me to Worker facemorph-next: replace A record ef8a8938cd3275bf1a4e83a7050e8eb6 (76.76.21.21, Vercel) with a proxied AAAA 100:: and add the facemorph.me/* Worker route (cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"AAAA","name":"facemorph.me","content":"100::","proxied":true}').
  - Dry run: `cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body {"type":"AAAA","name":"facemorph.me","content":"100::","proxied":true} --dry-run`
- **Rollback target:** legacy facemorph.me on Vercel: classic master's last successful deploy.yml: deploy.yml run 36654890071, `facemorph-me/facemorph.me-classic@e6e229831533244133f80aea61ae944c811bf9a0`
- **Rollback steps:**
  - cf dns records update ef8a8938cd3275bf1a4e83a7050e8eb6 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"A","name":"facemorph.me","content":"76.76.21.21","proxied":false}' (Vercel production, deploy.yml run 36654890071).
- **One publisher:** Classic deploy.yml (vercel --prod) is disabled: gh workflow disable deploy.yml -R facemorph-me/facemorph.me-classic.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode app --host facemorph.me --expect-digest <the promoted artifact's deploy-next digest> --identity next-site-SHA256SUMS`
- **Cutover annotation:** `node scripts/delivery/annotate-cutover.mjs --action production-promotion --host facemorph.me --digest <the promoted artifact's deploy-next digest>`

### API retirement

- **Action:** `api-retirement`
- **Owner:** operator
- **Preconditions:**
  - facemorph.me serves an on-device artifact (production-promotion done) and nothing in it calls api.facemorph.me or e4e.facemorph.me.
  - The names catalogue and previews read the snapshot, not the API (fm-old).
  - The multi-morph-test.vercel.app user (the Synthetic Data Ltd tester) has been told that it stops and that the on-device weighted blend replaces it; old GUIDs do not carry over, they re-add their photos.
  - A retained working on-device artifact and its immutable runtime, model and catalogue assets are held for rollback within the declared retention window.
  - artifacts.candidate names the build serving next.facemorph.me now (re-pin it from classic's latest next-site.yml run if it moved, then re-render handover.md).
- **Commands:**
  - Run every retirement item with when = api-retirement, in table order (DNS first, then routes and processes, then GitHub Pages).
- **Rollback target:** classic candidate build serving next.facemorph.me (observed 24 October, 15:40 UTC): next-site.yml run 40080943175, artifact next-site-45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94, `facemorph-me/facemorph.me-classic@45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94`, deploy-next digest `228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b`
- **Rollback steps:**
  - Rollback serves the retained on-device artifact (deploy-next 228eb615…) with its immutable assets; Triton and the API are never restarted and historic production data is never restored.
- **One publisher:** No publisher remains for api.facemorph.me, e4e.facemorph.me or checkface.facemorph.me.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode retired --host api.facemorph.me --retired api.facemorph.me,e4e.facemorph.me,checkface.facemorph.me`
- **Cutover annotation:** `node scripts/delivery/annotate-cutover.mjs --action api-retirement --host api.facemorph.me --digest 228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b`

### Names-host redirect: names.facemorph.me to the main app's names modal

- **Action:** `names-redirect`
- **Owner:** operator
- **Preconditions:**
  - facemorph.me serves the on-device app with the fullscreen names modal at /names.
- **Commands:**
  - See namesHost.
- **Rollback target:** names.facemorph.me on Vercel (facemorph-names): GitHub deployment 359827192 (Production), `facemorph-me/facemorph-names@9243fef8a34050ccf0a08d37de02784bd06fb57b`
- **Rollback steps:**
  - See namesHost.rollback.
- **One publisher:** Vercel for GitHub no longer deploys facemorph-names: remove the Vercel project at vercel-retirement.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode redirect --host names.facemorph.me --target https://facemorph.me`

### Vercel publisher retirement

- **Action:** `vercel-retirement`
- **Owner:** operator
- **Preconditions:**
  - production-promotion and names-redirect are done and checked.
- **Commands:**
  - Run every retirement item with when = vercel-retirement; delete the Vercel projects for legacy facemorph.me and facemorph-names in the Vercel dashboard (no dry-run; the probe below shows they still serve).
- **Rollback target:** legacy facemorph.me on Vercel: classic master's last successful deploy.yml: deploy.yml run 36654890071, `facemorph-me/facemorph.me-classic@e6e229831533244133f80aea61ae944c811bf9a0`
- **Rollback steps:**
  - Vercel keeps deleted projects' builds only until deletion; rollback after this point is the on-device artifact (artifacts.candidate).
- **One publisher:** No Vercel publisher remains for any facemorph.me host.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode unchanged --host facemorph.me --before <the production-promotion run's identity file> --identity next-site-SHA256SUMS`

### Classic publication's default-branch switch (pre-checks only)

- **Action:** `classic-default-branch`
- **Owner:** operator
- **Preconditions:**
  - See the classic publication bead's pre-checks; this runbook only records that the switch follows the candidate-source handover.
- **Commands:**
  - None here.
- **Rollback target:** classic candidate build serving next.facemorph.me (observed 24 October, 15:40 UTC): next-site.yml run 40080943175, artifact next-site-45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94, `facemorph-me/facemorph.me-classic@45463b630e5ed3ce6bc00a7af5fecaa93b5a5b94`, deploy-next digest `228eb615fdbd6d46d34459a4574b660e540aeb0c3903cf20018e8107ebd14f6b`
- **Rollback steps:**
  - None here.
- **One publisher:** Unchanged by this action.
- **Post-delivery check:** `node scripts/delivery/post-delivery-check.mjs --mode unchanged --host next.facemorph.me --before <identity before the switch> --identity next-site-SHA256SUMS`

## Names host

- **Before:** names.facemorph.me CNAME cname.vercel-dns.com (not proxied), record 305676364f6ed740e56c97b95fe2d782; `GET /` answered 200 with 1267 bytes (SHA-256 `de7a9518b946d451…`); Vercel (facemorph-names), GitHub deployment 359827192, facemorph-me/facemorph-names@9243fef8.
- **Redirect:**
  - `cf dns records update 305676364f6ed740e56c97b95fe2d782 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"AAAA","name":"names.facemorph.me","content":"100::","proxied":true}'`
  - Add a Single Redirect rule in the zone's http_request_dynamic_redirect phase: when http.host eq "names.facemorph.me", 301 to https://facemorph.me/names (no query, no path carried: no result-bearing or two-click URLs).
  - Dry run: `cf dns records update 305676364f6ed740e56c97b95fe2d782 --zone 893772fe7a5a4ee368f71706bc19e609 --body {"type":"AAAA","name":"names.facemorph.me","content":"100::","proxied":true} --dry-run`
- **Rollback:**
  - `cf dns records update 305676364f6ed740e56c97b95fe2d782 --zone 893772fe7a5a4ee368f71706bc19e609 --body '{"type":"CNAME","name":"names.facemorph.me","content":"cname.vercel-dns.com","proxied":false}'`
  - Delete the Single Redirect rule for names.facemorph.me.
- **Check:** `node scripts/delivery/post-delivery-check.mjs --mode redirect --host names.facemorph.me --target https://facemorph.me`
- **What it may claim:** The redirect does not establish inference-free selection: the candidate's picker still synthesizes. What the names host may claim is decided at delivery, after static names.
- **facemorph-names archive notice:** "facemorph-names is archived. names.facemorph.me now opens facemorph.me's names browser, which runs entirely on your device. This repository keeps its history."

## Second runtime origin

models.facemorph.me (Worker facemorph-models over R2 facemorph-runtime-mirror) copies a runtime file it does not hold from https://next.facemorph.me/ on its first GET or HEAD (classic hosting/next-mirror/worker.mjs; the deploy warms every path that way). The dry run therefore never requests the mirror: it lists the bucket read-only and checks each runtime file of every live and rollback artifact is held (a chunked asset by its chunks). Warming the missing ones is the candidate-source-handover precondition. Only the Worker's MIRRORED prefixes are held (classic hosting/next-mirror/worker.mjs); other runtime paths (the notices page) are served from the site only.

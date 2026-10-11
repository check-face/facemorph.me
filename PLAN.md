# LATEST PLAN — repo-cleanup-and-architecture-refactor

> **LATEST / ACTIVE PLAN.** This root `PLAN.md` is the single release plan. Scope, technology, visuals, tasks, source notes and reviews live here.

Updated: 11 October 2026. Status: **active release planning draft**.
Initiative ID: `repo-cleanup-and-architecture-refactor`. Repository bootstrap complete; application implementation remains unstarted.

Read this file in order, or jump to:
[architecture](#required-repository-architecture),
[language and framework](#language-and-framework-direction),
[Oxfmt/Oxlint](#linting-and-formatting--oxc-tooling),
[conversion Docker environment](#model-conversion-container),
[UI and photo flow](#next-release-ui-and-photo-requirements),
[task graph](#task-graph),
[source notes](#operator-overview-and-clarifications), or
[review record](#planning-review-and-scope-change-record).

## Goal and source of direction

Release the next FaceMorph with a clearer repository architecture, independently
usable compute/model packages, a reliable classic Docker distribution, repaired
photo encoding and simpler face controls. Engine extraction and autoresearch are
workstreams of this release, rather than its whole scope.

The operator's [Google Doc overview](https://docs.google.com/document/d/1lVNtTjPOsVYfFUJa0jCiiVU2jtDENcFcQF8iHrufJ1s/edit)
is the new direction. A [dated source snapshot](#operator-overview-and-clarifications) records what
was read, including incomplete/question-mark items and the later pasted clarification.
The supplied [UI archive references](#supplied-ui-references) and
[language/framework recommendation](#language-and-framework-direction) are part of this plan. This plan supersedes conflicting
engine-only choices and older UX requirements for the next release. Existing
nonconflicting identity, correctness, privacy, retention and evidence rules survive.

Repository bootstrap is complete. The new checkout is the continuation point;
classic remains the current delivery/rollback source until application cutover.
No application extraction, TS migration, new CI/domain promotion or classic
Docker/PyTorch qualification is established by the setup.

## Starting facts and boundaries

- New initiative checkout: `facemorph.me/`, origin `github.com/check-face/facemorph.me`,
  default branch `main`, fresh repository ID `1413979666`. This is the continuation
  point for the monorepo plan; it has no application build or deployment yet.
  Repo creation, local directory rename, plan publication and workspace setup
  are complete. Sibling `facemorph-names/` and `encoder4editing/` are also cloned;
  `fm-control/` and `fm-direct/` are retained historical benchmark copies.
- Retained application/source checkout: sibling `facemorph.me-classic/`, origin
  `github.com/check-face/facemorph.me-classic`, ID `295956585`, branch
  `candidate/next-delivery-20260916`. Existing candidate delivery remains
  `https://next.facemorph.me` until a qualified new-monorepo cutover.
- Source reviewed for planning: `dc8bfcb`; recorded verified delivery:
  `001ba853b277775a060030a3ab23a3900af28f16`, build `next-04403766fff8630a`.
  [Receipt](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/docs/plans/feedback-delivery-2026-10-11.md). Reverify before a new comparison;
  neither current checkout nor a rebuilt artifact is automatically the live control.
- `src/Next/` uses F#/Fable plus JS runtime/worker/media modules. The product bridge
  currently mixes application and compute orchestration. Package extraction must
  split responsibilities, not relocate the entire singleton.
- `self-host/` already has a pinned original frontend, a PyTorch-based NVIDIA
  runtime and Compose packaging. Its Dockerfile clones the current GitHub repo
  at a historical commit. Reconcile this implementation before porting duplicate
  server work. Candidate commit `b2d945a8c7f0ff9f382fbfefaecc2651943077a3`
  already repairs the Dockerfile/README clone URLs for the repository rename;
  inspect default-branch and remaining integration references separately.
- The sibling `checkface/` is the legacy backend. Inspect it read-only for migration
  provenance. Its remote is already archived as-is (ID `185985766`); history
  remains readable/cloneable. Do not re-archive or rewrite it.
- Model staging still consumes selected old lab inputs and external artifacts.
  Do not delete `experiment/` or move production weights without an input inventory.
- Preserve other sessions' `.gitignore` / `.cloudflare/` and `desktop/README.md` work. No worktrees, branch
  resets, cleanup of concurrent edits or inclusion of another session's changes.

Current commands in the retained classic checkout are `npm run build:next` and the existing exact-artifact/UI/device
harnesses. Current CI uses Node 22, .NET 5 and pinned Fable tools. The migration
keeps top-level build/verification commands as stable wrappers while paths change.
Use [development](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/docs/dev/README.md), [research protocol](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/autoresearch/program.md)
and [record standards](https://github.com/check-face/facemorph.me-classic/blob/b2d945a8c7f0ff9f382fbfefaecc2651943077a3/autoresearch/records.md) for current procedures.

## Required repository architecture

| Surface | Required end state | Migration constraint |
| --- | --- | --- |
| GitHub organization | Rename `check-face` to the selected compliant login `facemorph-me` (brand: FaceMorph.me). | Verify the actual available/valid organization login and permissions. `facemorph-me` is the chosen URL login; verify availability/permissions at execution. `facemorph.me` remains the product/domain brand. |
| `facemorph.me-classic` | Complete/qualify the legacy server and original frontend with PyTorch and easy Compose. | Repository rename is done; preserve history, pinned frontend commit, API behavior, model sources and attribution. |
| Existing fresh `facemorph.me` repository | Implement monorepo with UI, engine, model manager, model-host tooling and model converter. | Establish source provenance, package boundaries, CI, deployment pins and a rollback route before cutover. |
| `checkface.facemorph.me` | Retire completely: no hosted site, API, proxy, redirect or DNS record remains. | Inventory consumers/hosting first; classic Compose and the new app must work without this endpoint. Preserve archived source history, not a live service. |
| npm publication | Publish the reusable engine; resolve real npm names/scope when publishing. | Working folder names are not reserved package names. Pack/smoke-test first; ship no pretrained weights. |

Target layout for the new monorepo:

```text
facemorph.me/
  PLAN.md                          # stable latest-plan pointer
  apps/web/                        # TypeScript/React UI and application policy
  packages/
    stylegan-js/                   # compute, morph geometry, image/latent metadata
    browser-model-manager/         # chunks, checksums, OPFS/cache, loaded handles
    cloudflare-model-host/          # reproducible model-chunk hosting tools
    model-conv/                    # pretrained StyleGAN2 conversion tooling
  autoresearch/                    # frozen workloads, evaluator, candidates, ledger
  docs/plans/repo-cleanup-and-architecture-refactor/ # future contract/inventory/qualification outputs
  scripts/                         # aggregate build/qualification/identity tools
  package.json / package-lock.json  # npm workspaces and pinned dependencies
  tsconfig.base.json               # shared strict TS policy; scoped target configs
  desktop/                         # retained native host integration as applicable
  photo-runtime/                   # retained native/WASM preparation toolchain
```

Use npm workspaces for JS package linkage because npm/lockfiles already exist;
do not add another package manager or orchestration framework merely for layout.
Python conversion/build dependencies can remain Python tooling within their owner.
[Workspace contract](https://docs.npmjs.com/cli/v11/using-npm/workspaces/).
Source paths throughout task instructions refer to the retained classic checkout
until inventoried and imported into the new monorepo; they are not already present
in this fresh repo. Source/history transfer still needs RN-01 inventory; the
completed bootstrap does not authorize abandoning existing branches or evidence.

The old repository path is already occupied by the fresh repo: old redirects
cannot be relied upon. Prepare artifacts and manifests before the remaining
organization/integration/domain cutover.
Update Dockerfile historical clones, remotes, Actions references, badges, docs,
webhooks and Cloudflare integration explicitly. GitHub does not redirect every
surface, including reusable action calls and Pages URLs.
[Repository rename rules](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
[organization rename rules](https://docs.github.com/en/organizations/managing-organization-settings/renaming-an-organization).


### Retire `checkface.facemorph.me` completely

The operator requires complete retirement of `checkface.facemorph.me`, separate
from archival of the `checkface` GitHub repository. RN-01 inventories DNS records,
GitHub Pages/custom-domain configuration, origin/API services, Cloudflare proxy
workers/routes, monitoring, automation and all live clients of this hostname.
Grounded source references include archived backend `CNAME`, `docs/CNAME`,
`docs/opensearch.xml` and `src/cloudflare-worker/cloudflare-worker.js`, plus classic
`src/explain.md` and the FAQ in `src/Next/Product.fs`. These are inventory leads,
not evidence of which services are currently live.

RN-16 qualifies classic’s local PyTorch/Compose API and frontend without requests
to this hostname. RN-11 checks that the new app and user-facing links no longer
depend on or advertise it. Put replacement API/self-host documentation in the
classic repository and update live FAQ/docs references before shutdown. Archived
files remain unchanged as historical evidence; disabling Pages and hosting is an
account/infrastructure operation, not a rewrite of archived commits.

RN-20 prepares the retirement manifest and verifies consumers/rollback readiness.
RN-12 performs retirement only after the new app is promoted to `facemorph.me`
and its supported live journeys are verified. Retaining the old hostname during
`next.facemorph.me` candidate trials is allowed; it is not the completed end state.
Remove every site/API deployment and proxy route serving the hostname,
disable its Pages/custom-domain binding, and remove its DNS records. Remove
service-specific automation and revoke credentials used exclusively by the retired
service after confirming they are not shared with classic, names, models or next.
Do not leave a redirect, placeholder site or proxy serving the retired hostname.
This retirement does not authorize shutting down an independent `api.facemorph.me`
or another shared service; inventory and resolve actual dependencies explicitly.
Before shutdown, inventory whether `api.facemorph.me`, current production or
any proxy/redirect still uses this hostname, and remove/replace those dependencies
through qualified application cutover. The chosen site rollback artifact must be
verified to work without the retired host; an old hosted classic build still
requiring that host/API is not a valid post-retirement rollback. Preserve shared
API/hosting resources still needed by another live surface.
Record before/after configuration, owner, time and verification in the cutover
manifest; check authoritative DNS after propagation and confirm hosting/provider
route bindings are absent. An HTTP outage alone does not establish retirement.

RN-12 final release acceptance requires that new/classic supported journeys succeed
without this endpoint, active links/config contain no dependency, and the manifest
has DNS/hosting retirement evidence. Existing site and model hosting must remain
functional. This paragraph authorizes planning the work; no live DNS, Pages or
service deletion is performed by this plan update.

## Browser and desktop alignment ruling — 11 October 2026

Operator direction: keep browser and desktop/Tauri aligned. This is an accepted
architecture and product ruling; native raw transport is not implemented or
qualified by recording it.

- Share the UI, application state, input/crop flow, display, morph scheduling,
  media preparation, metadata/recovery and retention policy by default. A product
  improvement must cover each supported host or record its specific limitation.
- Select optimized paths through explicit runtime/host capabilities, not blanket
  `__TAURI__` exclusions. Both adapters must expose the same operation/result,
  cancellation, error, progress and resource-ownership contracts. Supported
  capabilities and qualified providers may differ and must be reported honestly.
- Raw RGBA display, deferred file encoding and bounded direct frame delivery are
  the shared target where supported. Preserve encoded-result/cache compatibility
  and bounded fallback. Do not add an encode/decode round trip solely because the
  host is desktop, or move browser timing claims onto native IPC without evidence.
- Keep platform differences within adapters for native inference/model access,
  IPC, file dialogs, OS save/share and lifecycle. Any further divergence needs a
  documented capability restriction or measured correctness/resource/performance
  reason, an owner and a revisit gate. A host-name check alone is not justification.
- RN-02 inventories current host checks and freezes capability/result contracts,
  including raw-buffer dimensions, byte bounds, ownership, deferred file readiness
  and frame acknowledgment. RN-09 applies those contracts during extraction.
  RN-11 checks the same supported product journeys in the exact browser and
  installed Tauri artifacts, plus cancellation, fallback, recovery and bounded
  memory/queues; unsupported or untested cells remain explicit. Native IPC transfer
  and encoding must be measured before assigning native performance claims.

Current gap: `desktop/runtime.mjs` reads `result.json` and `image.png` from a native
artifact and returns an encoded Blob; it has no raw-result or `synthesizeFrames`
contract. `src/Next/product-bridge.mjs` disables raw face/photo and streamed morph
paths with Tauri checks. This is an older implementation boundary, not evidence
that raw RGBA/canvas is slow or unsuitable on desktop. Existing native CPU and
shell evidence remains scoped to its tested artifacts; this ruling does not
expand desktop release support or start deferred native GPU work.

## Language and framework direction
Recommendation for `repo-cleanup-and-architecture-refactor`: **strict TypeScript, React and Vite**
for the new web application; framework-independent TypeScript for reusable browser
libraries and JS hosting interfaces; **Python/PyTorch** for model conversion and the
classic API. npm workspaces manage JS packages. This is a grounded planning choice,
not an implemented migration or a performance claim.

### Why this fits this repository

The existing UI in `src/Next/Product.fs` is Elmish/Fable over React, with crop/photo
state, names routing and bridge calls. `package.json` currently uses React 17 and
Webpack, while runtime/media modules are JavaScript. Moving to TS/TSX and React
preserves the component/DOM model and removes Fable from the new app when parity is
proven. A simultaneous move to another component framework offers no established
compute benefit and makes required interaction parity harder to verify.

The next app executes inference locally and deploys static bytes with production
headers. It has no current need for server rendering, server actions or a hosted
application API. Vite fits that static SPA, worker bundling and npm-workspace setup.
React's official guidance generally recommends a framework, but also documents
React + Vite for projects with specific constraints. We accept responsibility for
routing, code splitting, error recovery and deployment tests rather than assuming
Vite supplies them. React Router's declarative mode supplies the small real route
surface, including `/names` and browser back/direct-link behavior, without a server
runtime. Keep existing project/link/redirect behavior in the route parity matrix.

Use React local state for local widgets and pure typed reducers for face preparation,
selection and job transitions. Operation services own abort/disposal and request
revisions; React render/effect lifecycle must not own hidden model downloads.
Typed discriminated unions make invalid state transitions visible and help prevent
crop-confirm loops. Avoid a global-state framework until an actual shared-state
requirement justifies it. Keep high-frequency frames/progress in bounded worker /
service pipelines and throttle displayed updates; React only renders product state.

### Alternatives considered

| Option | Fit and decision |
| --- | --- |
| TypeScript + React + Vite | Recommended. Existing React semantics, static delivery, explicit package/worker boundaries and incremental parity checks. |
| TypeScript + Svelte + Vite | Credible for a greenfield UI; compiler-based components may be convenient. Here it adds a second component/state migration with no measured end-to-end benefit. Revisit only with a bounded parity/performance prototype. |
| Next.js | Supports static export, so it is possible. Its server-oriented features do not solve the present local-inference requirements; additional conventions and static-export constraints offer little benefit for this release. Revisit if real server-rendered content becomes a product requirement. |
| Retain F#/Fable | Lowest immediate visual-migration risk; useful as the measured control and temporary facade host. New product/package code is idiomatic TS. Retirement is a separate parity-qualified step, not a blind file translation. Classic retains its pinned original UI. |

### Monorepo language/build contract

- `apps/web`: TS/TSX + React + Vite + React Router declarative routing. Product styles
  and accessible modal/focus behavior match the supplied references; adopting a
  new UI kit or generic redesign is not a prerequisite. Assess any crop component
  for touch/rotation/coordinates/maintenance against the actual required interactions.
- `packages/stylegan-js`: strict TS, no React/Vite dependency in its public API;
  ESM JS plus generated `.d.ts` and explicit exports. Typed model/latent/media /
  worker contracts, dependency injection for loaded capabilities, no model resources.
  Worker entry points are explicit emitted JS exports with tested bundler loading;
  a consumer must not need the app's Vite aliases or filesystem layout.
- `packages/browser-model-manager`: strict TS browser services for manifests,
  verified chunks, OPFS and loaded handles. Browser-only features have explicit
  capability failure; importing the module does not access globals or start I/O.
- `packages/cloudflare-model-host`: TS public CLI/interfaces where JS tooling is
  appropriate; retain verified Python staging behind documented adapters during
  extraction rather than rewriting it for language uniformity. No UI/React runtime.
- `packages/model-conv`: Python/PyTorch conversion core with pinned environments,
  numerical checks and documented CLI; optional TS wrapper is convenience only.
  Model/tool ecosystems justify Python here. Generated shader/WASM/native code
  remains in its appropriate language and owner; TS is the orchestration language.
- Classic repository: preserve original frontend and Python/PyTorch API/Compose;
  this release does not rewrite that original UI into React/TS.

Use a root base TS configuration with `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `isolatedModules` and type-only imports. Scope DOM,
WebWorker and Node type environments separately; shared contracts must not acquire
accidental DOM/Node globals. Validate `unknown` manifest/metadata/worker values at
runtime rather than trusting erased TS types. No broad `any`, unchecked casts or
silent defaults to make migrated code compile. Temporary JS interop uses narrow
adapters with tests and a named retirement owner; do not mechanically rename `.mjs`.

CI must run explicit TS checking separately from Vite build, since Vite transpiles
but does not type-check. Use package declaration builds and no-emit checking for
app/adapters with workspace dependency ordering. Clean pack/install tests include
public types, emitted worker assets, export resolution and a consumer outside the
monorepo. Keep runtime imports free of repository-only path aliases.

Pin stable dependency versions/lockfile and Node compatibility in RN-04; do not
fetch `latest` at build time. Vite's browser defaults are not a CPU-route support
policy: set and verify app/worker targets for the declared browser matrix. Retain
production COOP/COEP/CORS, WASM/worker/runtime integrity, exact artifact hashing,
static route fallback and qualified-byte promotion. No bundler upgrade is a speed
win until fixed first/nth visit workloads measure it.

### Linting and formatting — Oxc tooling

Use **Oxlint** for authored JS/TS/JSX/TSX linting and **Oxfmt** for formatting
supported authored source/config/docs. Their shared tool ecosystem keeps the TS
monorepo tooling small and consistent. This is a planned RN-04 deliverable; no
packages, configuration or scripts are installed by this planning addition.

Pin `oxlint` and `oxfmt` as root development dependencies in the npm lockfile.
Use one root `.oxlintrc.json` and `.oxfmtrc.json`, with explicit file overrides /
ignore patterns and editor instructions. JSON configs keep tool configuration
independent of TS config-loader/runtime assumptions. Pin a compatible Node version;
registry metadata checked for this pass requires Node `^20.19.0 || >=22.12.0` for
both current tools. Select/test exact versions during RN-04 rather than using
`npx ...@latest` in CI.

Planned root scripts:

| Script | Behavior |
| --- | --- |
| `lint` | `oxlint --deny-warnings`; read-only lint gate over declared authored roots. |
| `lint:fix` | `oxlint --fix`; explicit local safe-fix operation. |
| `format` | `oxfmt`; explicit local write-mode formatting. |
| `format:check` | `oxfmt --check`; read-only formatting gate. |

Oxlint's native TypeScript and verified React/hooks rules apply with environment
overrides for browser UI, workers and Node tooling. Enable correctness rules and
bounded, justified suppressions rather than a blanket disabled legacy ruleset.
Keep package-boundary/worker/artifact checks: linter coverage does not establish
transitive dependency isolation, numerical correctness or complete type checking.
TypeScript checking remains a separate gate. Select rules supported by the pinned
Oxlint release; any additional type-aware lint mode needs its own verified setup.

Oxfmt uses a shared style (100-column width, two-space indentation); leave automatic
import/package-field reordering off initially so formatting does not introduce
side-effect ordering changes. Include authored app/package files, maintained
scripts, configs and current docs; exclude dependencies, generated Fable outputs,
build/distribution assets, vendored code, weights, fixtures, execution-tracker state/export,
and immutable historical scripts/reports identified by RN-01. Exclusions name frozen
artifacts rather than hiding all future autoresearch code or maintained adapters.
Python, F#, Rust and shader formatting is outside these tools' declared scope.

Introduce the style baseline in a separate formatting-only revision; rule fixes
and behavioral refactors stay independently reviewable. CI runs `format:check`,
`lint` and explicit TS checks before build/qualification, without writing fixes.
RN-04 acceptance: supported file roots are discovered, ignored frozen/generated
bytes stay unchanged, deliberate formatting/lint violations fail the relevant check,
formatting twice is idempotent, and CI/local/editor invocations share the pinned
configs. RN-11 retains these gates for release artifacts.

### Model conversion container

RN-15 supplies a reproducible Docker environment under `packages/model-conv`,
with a Dockerfile, pinned Python/PyTorch/export dependencies, `.dockerignore` and
an opt-in Compose conversion service. This avoids host-specific virtualenv setup
and records the actual toolchain used to create provider artifacts. Container
builds include converter code/tools and notices, **no pretrained weights**.

Document build, conversion and independent verification commands from a clean
clone. Mount caller-acquired checkpoint inputs read-only, outputs writable, and
optional reusable tool/download caches as separate volumes. Run with host-compatible
file ownership so outputs are usable without root repair. Keep credentials and
large/generated artifacts out of the build context/image. Acquisition/source terms
and any required acknowledgement remain explicit; containerization grants no rights.

Use a CPU-capable reference conversion/verification path for supported models where
the underlying exporter permits it. An optional documented NVIDIA configuration
uses the host driver/container toolkit and a pinned compatible CUDA/PyTorch stack;
it does not silently fall back or claim arbitrary GPU support. Unsupported CPU /
GPU/export combinations fail clearly. Record the validated OS/architecture/provider
matrix and expose absent hardware evidence. This service does not change the
classic API's separate inference container or add conversion to ordinary app startup.

Pin base images by digest, Python dependencies and upstream converter revisions.
Record image digest, tool/source versions, input checkpoint checksum/provenance,
conversion flags and output manifest/digests with each report. Test empty-cache and
repeat conversion, interrupted/error cleanup, supported model shapes and numerical
parity with independent references. Byte-reproducibility is claimed only if proven;
otherwise record any nondeterministic fields and require numerical/identity parity.
Release builds use the same image/environment qualified by those checks. RN-15
acceptance includes clean-clone container conversion and artifacts loadable by the
manager/engine; RN-11 checks provenance, supported capabilities and package/image
contents alongside the existing release qualification.

### Migration gates and recommendation status

RN-02 freezes TS package/operation types and runtime validation. RN-04 establishes
workspace/type/build/worker/route identity gates. RN-05 qualifies four ordered milestones: typed legacy facade, unchanged path move,
TS/React state/rendering translation, then Vite delivery migration; RN-17 /
RN-18 apply the declared UX changes afterward. If the TS UI parity revision cannot
pass, retain the current app as the qualified control and repair the migration;
do not weaken parity or claim completion of the new TS app. The user requires
idiomatic TypeScript for the revamp; React/Vite is the recommended framework/build
choice. The temporary Fable facade is an RN-05 migration milestone; RN-06
compute extraction begins after all RN-05 parity milestones and RN-13 loaded
handles are accepted. Manager/host/converter work can follow its earlier table
prerequisites. This ordering isolates UI/build parity from compute refactoring. The operator permits
F# removal, not unverified deletion of consumers or classic historical inputs. F# tools can leave new-repo CI only after no new-app
consumer remains, without changing classic's historical build requirements.

### Primary documentation checked for this planning pass

Checked 11 October 2026; these establish supported approaches, not timings:

- [React: build from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
  documents Vite's React/TS template and the SPA/framework tradeoffs.
- [React: reducers](https://react.dev/learn/extracting-state-logic-into-a-reducer)
  supports extracting complex state transitions from rendering.
- [Vite guide](https://vite.dev/guide/) and [features](https://vite.dev/guide/features.html)
  document TS transpilation, independent type checks and worker support.
- [Vite production build](https://vite.dev/guide/build.html) documents browser
  targets, static deployment and library builds; pin actual tool versions in RN-04.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html)
  documents strict checking; runtime boundary validation is still necessary.
- [React Router declarative mode](https://reactrouter.com/start/declarative/installation)
  documents routing without adopting its server framework mode.
- [Svelte overview](https://svelte.dev/docs/svelte/overview) and
  [Next.js static export](https://nextjs.org/docs/app/guides/static-exports)
  support the alternative comparison above.


Oxc sources checked for this tooling addition:

- [Oxlint guide source](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/linter.md)
  and [native plugins](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/linter/plugins.md).
- [Oxfmt guide source](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/formatter.md)
  and [configuration](https://github.com/oxc-project/oxc-project.github.io/blob/main/src/docs/guide/usage/formatter/config.md).
- npm package metadata for [oxlint](https://registry.npmjs.org/oxlint/latest) and
  [oxfmt](https://registry.npmjs.org/oxfmt/latest), checked 11 October 2026.

## Package boundaries

### stylegan-js

Accept a caller-supplied already-loaded model capability, with model identity,
dimensions, latent schema, mapping/synthesis and optional e4e support made explicit.
RN-02 freezes the concrete existing-provider adapter signatures and ownership.
The library neither downloads nor manages model files. The caller-supplied encoder
capability owns bounded sequential sessions using preverified local shards; all
network acquisition finishes before engine execution. It exposes encode/cancel/dispose
operations, never file/cache/downloader access. This keeps the current bounded stream
viable without requiring the whole encoder in memory. It contains no model URLs,
chunk downloader, OPFS cache, model-host dependency or UI/reporting policy.

Own inference, numerical qualification, morph geometry (all current selector modes,
including linear and figure-eight), bounded frame production and computational
image/media helpers. Support raw-pixel encoding to PNG and lossless WebP with exact
latent/stylegan-js recovery metadata, plus validated metadata/latent extraction.
Do not bundle weights or research fixtures containing weights in npm artifacts.
Document NVlabs model acquisition and supported model shapes; unsupported published
datasets are explicit rather than silently forced into FFHQ's current 1024px assumptions.

Lossless library helpers are a required API capability. They do not silently revoke
the existing application's approved practical lossy-cache/download policy. Keep
exact model/latent/provenance integrity separate from decoded-pixel quality.
Worker placement and GPU residency are measured implementation choices.

### browser-model-manager

Own manifest/chunk acquisition, checksum validation/recovery, OPFS/device caching,
cache reuse/eviction/quota behavior and creation/disposal of loaded provider handles.
Its provider adapter owns shard reads and bounded session lifecycle; loaded means
verified and ready for offline operations, not all sessions resident simultaneously.
It supplies a loaded capability to `stylegan-js`; the engine cannot reach back into
the manager to acquire more files. The UI authorizes needed downloads via the modal.
Constructing packages or reading status/capabilities must not trigger acquisition.

Keep cached models and existing originals/session formats compatible during the
package migration. Split model caches from application retention policy. Cold,
model-cached and output-cached cases remain distinct. Bound resources and fallback;
CPU and WebGPU handles identify actual providers, admission and validation state.

Loaded handles hold reference-counted leases on required verified local assets.
Manager-controlled deletion/eviction cannot remove leased assets. Browser eviction,
corruption, cross-tab deletion or device/worker loss invalidates the capability
with a typed error; affected operations settle and release resources without
network repair. Leases constrain manager behavior, not the browser’s ability to
reclaim storage. Reacquisition and re-admission occur outside engine execution
through the application’s acquisition/consent policy.

### cloudflare-model-host

Own chunk staging/publication tooling, manifest generation and digest-consistent
serving with required MIME/CORS/embedding/cache headers. Verify chunk reconstruction,
runtime pins and parity between qualified and published bytes. Keep weights out of
package tarballs and private source provenance out of published manifests.
Validate current Cloudflare limits and author model/source terms before publishing;
"free" is a target to verify against the actual asset sizes and service tier.
The classic server downloads upstream author weights; that does not require our
browser chunk origin to replace the authors' download URLs.

### model-conv

Convert supported pretrained StyleGAN2 checkpoints into the formats required by
the providers/manager. Start from existing exports and pinned upstream converter
code; document architecture/resolution/operator limits and exact model provenance.
Produce manifest/digest/shape metadata and independent tolerance-based checks.
Document supported acquisition from NVlabs and the linked pretrained-model catalogue;
do not claim every catalogue checkpoint works without conversion qualification.
Keep generators, optional photo encoder and preprocessing identities separate.

## Classic distribution acceptance

After clone, `docker compose up` with the documented NVIDIA-capable configuration
must start the original frontend and API, handle author-hosted weight download/setup,
and print a clickable local browser URL. Host prerequisites are an actual working
NVIDIA driver/container runtime, Docker and Compose. No implicit CPU success can
stand in for required CUDA execution. CPU compatibility can remain documented.

Reuse existing PyTorch/self-host compatibility work where verified. Preserve old
seed/text semantics, photo reconstruction, morph/media endpoints, saved identities,
health checks and persistent model/media volumes. Validate both empty-volume
startup and restart reuse on an available GPU; lack of GPU evidence stays explicit.
The new monorepo web app runs locally in the browser and does not acquire the classic
API as a dependency. Backend archival is complete; verify Docker/PyTorch in `facemorph.me-classic` before claiming classic complete.

## Next-release UI and photo requirements

These are intentional changes to the previous delivered UI, not failures of a
framework-parity check. Everything outside this change set keeps the current
accepted behavior. Any F# replacement must reproduce the approved UI state before
or after the changes consistently, not combine a rewrite with untracked UX drift.

| Requirement | Acceptance / explicit interpretation |
| --- | --- |
| CPU/WebGPU selector above the first + | Visible at the top with a useful explanation; actual route still requires capability and correctness admission. |
| Download consent modal | An action needing absent models opens a modal with scope/size and continue/cancel; replace the toast flow. Cancelling starts no downloads. Cached usable results remain usable. |
| Remove WebGL | Remove selectable and automatic WebGL use after dependent workloads/cache/settings tests pass. Map old stored `webgl` preferences to an explained supported mode; preserve successful-slow-route policy. CPU fallback on actual GPU failure remains bounded and tested. |
| Move Browse Names into burger menu | No separate Browse Names button. Names enter their existing instant-result path rather than inference or Generate. |
| Generate inside an empty image tile | Only for text/seed inputs with new eligible text; typing clears the displayed result. No Generate for names or encode-image mode. Define eligibility against revisions, not string comparison alone. |
| Rename Upload image to Encode image | All labels and entry points use the new action. |
| Paste image into text field | Pasted image follows exactly the same selection/crop/consent/encoding flow as file-dialog input; typed text/seed input behavior remains. |
| Remove duplicate filename line | The field may show the filename; no separate caption repeats it below. |
| Generate becomes Cancel while cancellable face work runs | Same action slot, not another row. Encode cancellation becomes available after crop confirmation; names stay instant. Accessible state and keyboard actions are explicit. |
| Crop only before encoding | Proposed crop in a modal, adjustable and confirmed by the user; keep multi-face choice. No post-generation Crop photo button. Use FaceMorph modal styling and top-right logo. |
| Adjust Crop and multi-face selection | Match supplied adjustment/modal style and failure guidance. Select one or several detected faces; OK creates extra next-face keypoints in click order. Freeze crop/rotation proposals and order before encoding. |
| Remove hold-to-compare | Remove its button, pointer/keyboard gesture, instructions and stale UI state; preserve normal face display and Save/share. |
| Repair confirmed-crop loop | After confirmation, encode that exact crop. If alignment fails, take a bounded direct-crop e4e route when the input meets declared encoder requirements; never automatically reopen an endless crop prompt. Preserve cancellation, preprocessing provenance and numerical checks. |
| Morph cancellation | Disable Morph while running and add Cancel to the right of progress. Completed faces survive cancellation. |
| Fullscreen baby-name picker | Closely match classic/names.facemorph.me: edge-to-edge faces, no gaps/borders, names over images; no search, header or x icon. Selection displays immediately. Define accessible dismissal without restoring the removed header/close control. |

The source's standalone "Generate should only" bullet is incomplete; the fuller
Generate bullets above control. The latest clarification **removes hold-to-compare**.
"Save / Share image ????" and "Add drag drop to" remain unresolved placement/target
ideas. Preserve current usable Save/share and accepted photo drop behavior without
inventing a replacement compare gesture. These questions do not block unrelated work.

### Confirmed crop and ordered multi-selection flow

Use [the four inspected screenshots](#supplied-ui-references): dark confirmation modal,
logo top right, proposed crop, Adjust Crop, Cancel and OK. Adjust Crop opens the
existing-style crop editor with movable/resizable square, rotation/angle and face/eye
guides. Use Crop updates the proposal and returns to confirmation; Cancel in the
editor restores the prior proposal. OK at confirmation commits it and returns to
main-page face progress; the same tile action slot now shows Cancel. Cancel before
confirmation abandons preparation without e4e encoding or allocating extra keypoints.

Detect/propose on the source before confirmation. If this needs absent detector /
alignment assets, pass the same scope/size download-consent gate before acquisition;
declining keeps the source/local manual-crop option usable and starts no downloads.
Do not label an unrun detector as a detection failure. If no face is detected, show the
existing meaningful alignment/failure guidance and allow manual adjustment. That
warning does not forbid an eligible confirmed crop from taking the direct e4e route.
Malformed/unsupported pixels still fail clearly. Guides are not burned into pixels;
freeze crop rectangle, rotation, orientation and input revision and derive encoder
pixels once according to the versioned preprocessing contract.

For multiple faces, show selectable previews with accessible ordered selection
badges. Selection order is click order, not detector position or encoding completion.
Deselect removes a selection; reselect appends it. Each selected face has a proposed,
adjustable crop. Disable OK with zero selections. On OK, freeze the ordered proposals
and assign the first to the original target keypoint; insert additional next-face
keypoints immediately after it in that order, retaining existing later faces.
Allocate stable keypoint IDs atomically only when the source/target revision still
matches. Before OK a changed/removed source target invalidates the entire proposal.
After OK each slot has its own frozen crop and input revision: changing/removing
that slot invalidates only its pending/active work and late results, not siblings.

Run the selected encodes in a bounded queue (initially one e4e encode at a time),
not simultaneous full encoder loads. Each frozen crop has request/attempt identity,
independent progress and result. Once confirmed, each queued/running tile shows its
own Cancel in the face action slot: it cancels only that slot, and queued siblings
continue in frozen order. There is no implicit batch-wide Cancel. The confirmation
modal Cancel, before OK, discards the entire uncommitted proposal. Completed faces
survive cancellation. Retry resumes only that existing cancelled/failed slot with
its frozen crop and a new attempt ID (appended to the pending queue); Remove deletes
only that slot. Neither reopens crop or allocates extra keypoints. Pending, running
and retryable slots own a reference-counted tab-only source or immutable derived
crop pixels. A frozen rectangle without pixels cannot satisfy Retry. Successful
slots release retry inputs; failed/cancelled slots retain only the minimum input
needed for Retry. Remove, input replacement and app disposal release remaining
references; a shared source is freed only when no pending/running/retryable owner
needs it. Never persist source photos or retry crops to OPFS/session storage.
RN-02 must freeze numeric count/byte ceilings for retained sources, crop buffers and
transient decode separately, before batch admission. Preserve existing single-input
limits (`src/Next/photo/crop.mjs`: 64 MiB compressed, 120 × 1024² pixels, 20,000px edge)
unless a separately qualified rule changes them; these are not browser RSS bounds.
Reserve batch budget before allocating keypoints; an oversized batch receives an
actionable reduce-selection/remove-retry-input message, not truncation or hidden eviction. Complete any detector-driven alignment/warp used to propose a crop before
confirmation, and display the resulting proposal. After OK, derive encoder pixels
only from the frozen confirmed crop and declared orientation/rotation/resize /
color/normalization policy. Do not redetect/rewarp to replace approved geometry.
Optional post-confirmation validation cannot alter pixels or block otherwise
eligible direct-crop encoding; detector/alignment failure cannot reopen the crop
prompt. An eligible confirmed crop reaches one e4e attempt or an actionable error.
Only a user's explicit Adjust Crop starts another adjustment. RN-02 freezes batch,
revision, cancellation and retry types; RN-08 owns real encoding/fallback; RN-17 owns
modal, ordered selection, atomic keypoint insertion and interaction evidence.

The archive contains no multi-face grid or names-picker screenshot. Create a
reviewable multi-selection design from these written requirements and existing
selection behavior; do not claim an unseen supplied mock establishes it.

## Supplied UI references
Source: workspace `image-archive.zip`, supplied with the operator's 11 October 2026
planning clarification. Archive SHA-256:
`f38de24a7feba6e9213d399ad328280a8017245605e0cfa63c9031415921740a`.
All four actual PNGs were viewed. `__MACOSX/._*` entries are metadata, not screenshots.
Personal-photo pixels stay out of Git; inspect the supplied archive for the visual
reference. The descriptions below carry the requirements even without that archive.

| Archive member | Bytes | SHA-256 |
| --- | --- | --- |
| `recovered image.png` | 267004 | `d67fdf00616cac2a84b93e1099ab59aa75583e18802968dd49db29c448030b62` |
| `failed to align.png` | 580820 | `074096a95337fe9b78cd1b5e4cc6069fc6fab05bbbe3fc1cb407d6d4bf30255b` |
| `crop 2.png` | 255200 | `753f4ad693874253085b60791d83e630765acb50e7f6d74c7363432f3c16b6c1` |
| `crop image.png` | 147501 | `dc2b07087ca3b488b354f08a74eae95b9e9876cd3bf70013a1372a61dd98a280` |

- `recovered image.png`: historical two-face page. It illustrates the duplicate
  filename, post-result Crop photo and Hold to compare controls to remove. Its old
  Generate placement is superseded by the latest written requirements.
- `crop image.png`: dark FaceMorph **Encode an image** confirmation modal. Logo at
  top right; proposed face crop preview; **Adjust Crop** below preview; Cancel at
  bottom left and OK at bottom right. OK confirms the crop and returns to face
  progress/cancellation in the main page. Use this as the confirmation layout.
- `crop 2.png`: dark **Crop your image** adjustment modal. Square adjustable bounds
  with corner/edge handles, eye/face-position guides, rotation control and angle,
  instructional text, Cancel and **Use Crop**. Use Crop updates the proposal and
  returns to confirmation; it does not independently start encoding. Cancel here
  returns to the previous proposal; Cancel at confirmation abandons the flow.
  Guides are overlays, not a mask burned into encoded pixels. Apply orientation,
  rotation and crop to source pixels once, using the frozen preprocessing policy.
- `failed to align.png`: old **Upload an image** modal, full-image preview, Crop
  action, **Unable to auto align face.** and guidance to use another image or
  manually crop with the whole face in frame. Retain the meaningful failure message
  and guidance; update the label to Encode an image and control to Adjust Crop.
  A warning cannot silently re-open crop or prevent an eligible confirmed crop's
  direct e4e path. Unsupported/malformed data still has an actionable terminal error.

No image in this archive depicts a multi-face selection grid or the fullscreen
names picker. Their written requirements and the existing classic/names surfaces
control; do not describe an unseen screenshot as a supplied design. RN-17 produces
an actual reviewed multi-selection layout, including visible selection order.

## Contracts and evidence retained from the earlier planning pass

The application owns interaction, consent, input revisions, display URLs, session
selection, slider preference and reporting transport. The manager owns model I/O
and loaded handles; engine owns compute/pipeline resources. Split mixed modules
such as `media.mjs` and `last-result.mjs` instead of moving UI policy into packages.
Cache retention remains bounded and compatible; source photos/typed inputs stay
tab-only; diagnostics contain no raw photos/latents/seeds or durable hardware IDs.

Operations carry opaque request/input-revision/attempt IDs and actual providers.
Signals/callbacks/promises remain on the caller side; worker payloads are cloneable.
Separate available pixels, file readiness, persistence, decoded display and playable
video. Cancellation/disposal settles pending operations and late results cannot
replace newer input. Define buffer/device ownership and numeric transient-byte
bounds. Sparse preview anchors cannot deadlock ordered video drain. Cover existing
cache/raw/blob/sequential/native/retained-then-encode branches and endpoint reuse.

Keep `autoresearch/run.py` for budgets, process cleanup and physical-device leases.
One evaluator wraps existing numerical/component/built-UI harnesses, with normalized
execution, validity, correctness, non-regression, paired-benefit and architecture
verdicts. Generic `passed` or exit zero is not product or release qualification.
Frozen historical scripts/reports retain their bytes; new campaign code is versioned.

Freeze workload, timing boundary, source/artifact/runtime/model/fixture/evaluator
digests, provider, device/browser, cache state, network, warmup/order and regression
decision rules before candidates. First visit, retained-model new generation,
continued session, restored/replayed output and first/repeated Save are separate.
Principal useful journey remains navigation/photo selection to decoded playable and
save-ready video, with first-face, responsiveness, scrub, recovery, bytes and memory
beside it. Metadata-free photos must execute the actual encoder.

Use the current fixed 32-frame/16 FPS/1024px workload where supported; an explicit
different-resolution/provider cell is not a comparable replacement. Controlled
initial comparisons use discarded warmup and ABBA ×3, raw distributions and paired
effects. Cold profiles are empty; baseline warmup uses separate profiles. Declare
the statistical method, sample/confirmation rule, invalid-pair handling and
practical margins from control/control evidence before candidate observation.
Correctness failure rejects; missing supported evidence is inconclusive. Expected
failure tests can pass cleanup/correctness without becoming generation timings.

Architecture/parity acceptance without faster timings is not a performance `keep`
under existing research policy. Missing physical-phone coverage remains explicit;
available desktop/simulator qualification precedes bounded deployed phone trials.
All heavy builds/runs share their device lease; preserve original ledger rows and
append scoped outcomes/corrections. Retrievable reports and exact-artifact/live-byte
receipts distinguish measured, implemented and deployed state.

## Task graph

The table contains remaining planned work only. RN IDs are specification labels
used to express dependencies and acceptance; no issue records are created here.
Dependencies are blocking edges; not merely a suggested chronological list.

| Workstream | Depends on | Deliverable / gate |
| --- | --- | --- |
| RN-01 Inventory and freeze baseline | — | Repository/source/asset/consumer/receipt inventory; migration manifest. |
| RN-02 Freeze package and operation contracts | RN-01 | Typed loaded-model/batch boundaries, manager/host/convert formats, resources and parity matrix. |
| RN-03 Freeze workloads and comparison rules | RN-01 | Versioned specs, control identity and decision rules. |
| RN-04 Prepare monorepo build/CI identity | RN-01, RN-02 | Strict TS/workspace/type/worker linkage, Oxlint/Oxfmt gates, new-path hashing/discovery. |
| RN-05 Move UI behind package facade | RN-02, RN-04, RN-10 | Parity-preserving facade and isolated recommended TS/React/Vite migration. |
| RN-06 Extract stylegan-js compute | RN-05, RN-13 | Caller-supplied loaded models; no model I/O/weights; tested browser/native capabilities. |
| RN-07 Separate media and metadata helpers | RN-06 | PNG/lossless-WebP recovery API, video pipeline, application Save/share boundary. |
| RN-08 Repair crop-confirm-to-encode flow | RN-06 | Bounded direct confirmed-crop path, actual e4e and no crop loop. |
| RN-09 Extract morph/frame pipeline | RN-07, RN-08 | All geometry modes, ordered bounded frames, cancel/reload compatibility. |
| RN-10 Build evaluator and freeze noise baseline | RN-03 | Same versioned wrapper/control apparatus before facade/extraction. |
| RN-11 Qualify release artifacts and packages | RN-09, RN-14, RN-15, RN-17, RN-18 | Correctness, UI parity/change matrix, paired regression verdicts and pack/install tests. |
| RN-12 Publish and verify release | RN-11, RN-20 | Candidate/site/package receipts and verified runtime/live bytes; distinct classic coverage. |
| RN-13 Extract browser-model-manager | RN-02, RN-04 | Chunks/checksums/OPFS/caching/loaded handles with consent and compatibility. |
| RN-14 Extract cloudflare-model-host | RN-02, RN-04 | Reproducible chunk host, limits/terms check and exact qualified manifest. |
| RN-15 Create model-conv tooling | RN-02 | Containerized supported conversions, shape/provenance manifests and numerical reports. |
| RN-16 Prepare classic repository and Compose successor | RN-01 | Original UI/API/PyTorch migration, one-command GPU bootstrap and verified reuse. |
| RN-17 Apply revised face controls and consent modals | RN-05, RN-08, RN-19 | Referenced crop modals, ordered multi-selection, compare removal, paste/file/cancel matrix. |
| RN-18 Restore fullscreen instant-name picker | RN-05 | Classic-like edge-to-edge layout, accessible dismissal and instant selection. |
| RN-19 Remove WebGL with compatibility handling | RN-05, RN-13 | CPU/WebGPU-only admission, persisted-preference migration and required fallback coverage. |
| RN-20 Complete organization/integration migration and prepare domain cutover/retirement | RN-11, RN-16 | Organization/integration migration, retirement readiness and host-independent recovery manifest. |

### Task instructions and acceptance

**RN-01:** Inspect `src/Next/product-bridge.mjs`, runtimes, geometry/photo/media,
`self-host/`, read-only sibling server, workflows, staging and historical clones.
Record every moving path, consumer, build/worker URL, persistent identity, source
revision and live receipt in `docs/plans/repo-cleanup-and-architecture-refactor/inventory.md`. Identify provenance/history transfer
and external model sources. Acceptance: all release surfaces have an owner and a
retained/rebuildable input; uncertainties are explicit; this inventory makes no
new remote changes. Include licenses and required notices for imported app,
package, converter and model/data inputs. Preserve provenance/restrictions and
name unresolved redistribution rights before deciding distribution contents.

**RN-02:** Write `docs/plans/repo-cleanup-and-architecture-refactor/contracts.md` using
RN-01's inventory at `docs/plans/repo-cleanup-and-architecture-refactor/inventory.md`.
Inspect `src/Next/browser/runtime.mjs`, `src/Next/browser/ort-worker.mjs`,
`desktop/runtime.mjs` and `src/Next/product-bridge.mjs` for actual adapter signatures.
Define loaded handles (ownership/digests/shapes/mapping/synthesis/encoder), manager
acquisition lifecycle, operations and `renderMorph` endpoints/settings/display
callbacks/video result. The current bounded encoder uses 108 sequential ORT sessions.
Baseline ownership: the caller's manager/provider adapter supplies an already-loaded
encoder capability whose typed `encode` operation owns bounded sequential session
creation/execution/release. It may read verified local shard storage lazily; no
network acquisition occurs during engine execution. Consent-authorized acquisition
and verification of all required shards finish before admission. Loaded means ready
for offline execution, not all sessions/weights simultaneously resident in RAM.
Freeze verified-asset lease ownership, manager eviction exclusion and typed
invalidation/settlement on browser eviction, corruption, cross-tab deletion or
device loss. Active operations cannot fetch replacement shards; reacquisition and
re-admission belong to the application/manager outside engine execution.
The engine sees typed encode/abort/dispose operations, no URLs, OPFS handles or
`acquireBytes` callbacks. RN-02 records exact signatures, memory bounds and the
encoder-to-synthesis residency transition; any alternative needs equivalent
independent-consumer, memory and acquisition-boundary evidence. Freeze
host/converter manifest compatibility, metadata schema/version rejection and the
confirmed-crop preprocessing policy needed by RN-08. Define strict TS discriminated
unions for input modes, preparation, ordered batch selections, per-crop progress,
retry/cancel and input revisions; validate untrusted runtime payloads. Freeze atomic
first-target/additional-keypoint allocation and bounded encode scheduling from the
flow above; selection order must survive cancellation, retry and async completion. Define tile
Cancel as per-slot, modal Cancel as pre-commit batch cancellation, and Retry as one
existing slot with a new attempt ID; pending siblings retain their order. Freeze
reference-counted pending/running/retryable pixel ownership, success/remove/replace /
disposal release, numeric source/crop-count and byte ceilings, transient decode bounds
and over-budget admission before any extra keypoint allocation. Those ceilings must
be written in the contract and exercised at/over the boundary; no unbounded default. Include the retained frame,
resource, cancellation and evidence contracts above, with numeric byte bounds.
Acceptance: every supported flow traces without engine download/cache/host dependencies;
a clean consumer with a caller-loaded capability works without importing the manager;
cleanup and unsupported capabilities are explicit. No promise/signal/callback objects
are sent to workers. A status/capability read never starts acquisition.

**RN-03:** Create campaign-owned workload specs using current harnesses and retained
control or qualified rebuild. Pin control bytes and declare all expected outcomes,
required cells, statistical method, confidence level, sample/confirmation rules,
protected UX/resource metrics and invalid-run handling. Acceptance: cold/warm/output
cache cases are distinguishable and package/UI/refactor changes have named gates.

**RN-04:** Prepare npm-workspace layout/aggregate commands and CI for all code roots.
Use the language/build contract in `PLAN.md#language-and-framework-direction`: strict scoped TS configs,
explicit type checking/declaration builds, pinned Oxlint/Oxfmt dependencies and root
JSON configs, `lint`/`lint:fix`/`format`/`format:check` scripts, package export/worker
consumer checks and tested Vite targets/production headers. Start from
`scripts/build-next.cjs`, `scripts/check-tests-listed.mjs`, bridge/progress/artifact checks,
site/mobile workflows and test server/stage/restage paths. Include app/packages in
build/snapshot identity, exact required test invocation and worker completeness.
Acceptance: a package edit changes identity and triggers its required checks before
any migration candidate can be promoted; no historical test is silently dropped.
CI format/lint/type checks are read-only and fail on violations; validate configured
root discovery, ignored historical/generated bytes and formatting idempotence.
Record the formatting baseline separately from rule fixes and behavioral changes.

**RN-05:** Execute ordered, separately recorded milestones: 05a introduces typed
compatibility adapters over the current implementation; 05b relocates the unchanged
app into `apps/web` and verifies artifact/worker identity; 05c translates product
state/rendering into idiomatic TS/React without UX changes; 05d replaces Webpack/Fable
delivery with Vite and verifies routes, workers, headers and exact artifacts.
Each milestone consumes the previous milestone's parity evidence. The facade uses
legacy adapters before extracted packages exist; it does not depend on RN-06.
Retain native host behavior and current Fable bridge exports during that transition. Recommended end state is idiomatic TS/React/Vite per `PLAN.md#language-and-framework-direction`;
perform that UI/bundler migration in a separate parity-qualified revision. Freeze
old versus declared new UX in the matrix before any translation; no compute/model
I/O or giant bridge singleton moves into React. The declared new monorepo app must complete the TS migration gates; deletion of
unused F# tooling follows verified consumers. Classic retains its original build.
Acceptance: the current accepted UI behavior passes before deliberate RN-17/RN-18
changes, with source/asset identity and model/session compatibility preserved.

**RN-06:** Move mapping/synthesis/photo orchestration, loaded-provider contract adapters and numerical gates into
`stylegan-js` as strict TS using RN-13 loaded handles. Emit consumer-ready JS,
public `.d.ts` and explicit worker exports without app aliases or React dependencies. Remove engine-originated downloads and
caches. Provide a minimal consumer example using a caller-loaded model. Acceptance:
no weights/fixture blobs, host URLs, OPFS, UI or reporting transport in engine package;
supported CPU/WebGPU/native behavior and cancellation pass applicable checks.

**RN-07:** Split media computation from user-gesture Save/share. Export raw-pixel
PNG/lossless-WebP encoding and recovery extraction; document format/metadata limits
and corruption behavior. Preserve product lossy compatibility as explicit policy.
Acceptance: round-trip latent/model provenance, playable media, first/repeated Save,
re-import and promise/surface cleanup; no hidden additional encoding/inference.

**RN-08:** Reproduce the crop-confirm failure in the actual built UI. Use RN-01's
`docs/plans/repo-cleanup-and-architecture-refactor/inventory.md` and RN-02's
`docs/plans/repo-cleanup-and-architecture-refactor/contracts.md` preprocessing/loaded-handle sections.
Trace `src/Next/product-bridge.mjs`, `src/Next/browser/runtime.mjs`,
`src/Next/photo/align-photo.mjs`, `photo-runtime/align-photo.mjs` and worker provenance.
Replace the conflicting exactly-one-face requirement for a versioned confirmed-crop
policy: selection/multi-face handling precedes confirmation, and an eligible confirmed
crop can execute direct e4e without another successful detector pass. Eligibility means
decodable supported pixels within declared size/shape limits, explicit orientation,
alpha/color handling and the qualified encoder's preprocessing requirements; it does
not mean successful redetection. Freeze all eight EXIF orientations, resizing,
normalization and crop coordinates in the contract and cache/provenance identity.
Complete detector-driven alignment/warping for a proposed crop before user
confirmation and display that proposal. After confirmation, apply only the frozen
orientation/rotation/resize/color/normalization preprocessing to approved pixels.
Do not redetect/rewarp approved geometry; optional validation cannot change pixels
or block eligible direct-crop e4e. Preserve cancellation/input revisions and
include forced successful and failed detector/alignment outcomes proving the same
confirmed-pixel preprocessing identity, without another crop prompt.
Acceptance: built-UI forced detection/alignment failure after confirmation executes
real e4e once and finishes or reports an actionable terminal error without reopening
crop. Include every independently confirmed multi-selection crop with click-order
identities and bounded serial e4e scheduling; no partial failure restarts the batch
or creates duplicate keypoints. Include no-face/multi-face/oriented/non-square/malformed fixtures, cancellation
and stale revisions; numerical fallback qualification is independent of speed.

**RN-09:** Move geometry/infill/frame-store/writer orchestration behind `renderMorph`.
Keep canonical indices, presentation order and application URL/retention ownership.
Test cached frames, raw sparse anchors, blob stream, native/sequential fallback and
retained-then-encode paths with their different callback/drain semantics. Acceptance:
endpoint reuse, bounded bytes, cancellation during production/finish, stale callback
rejection, full playable video and restored scrub state; all shape modes survive.

**RN-10:** Wrap existing drivers rather than interpreting generic success. Start
from `autoresearch/candidates/direct-rgba-media-v1/built-ui-paired.mjs` and `scripts/next-e2e.md`; historical
analysis pins old source/artifacts and must not be repurposed. Add versioned adapters
for driver correctness/timing scope and extend supported release workloads. Collect
control/control evidence and lock margins before RN-05. Acceptance: complete
context/raw noise reports; invalid/missing/expected-failure cases yield correctly
scoped verdicts and cannot become speed wins or release certificates.

**RN-11:** Require RN-04 read-only Oxlint/Oxfmt/type gates and RN-15 container
conversion provenance/qualification. Qualify the actual app artifact and packed packages with transitive
dependency/weight scans, browser/native numerical gates, exact built-UI change matrix,
crop/encoding/name/cancel/recovery, ordered multi-selection and keypoint insertion,
absence of hold-to-compare, cache quotas and fixed paired workloads.
Record `docs/plans/repo-cleanup-and-architecture-refactor/ui-change-matrix.md` with source bullet,
before/after state, intentional change or retained behavior, and exact-artifact evidence. Test
tarballs in a clean consumer with caller-loaded models. Verify source-license /
notice/provenance obligations for actual package/container contents, not only
weight exclusion; unresolved redistribution rights block the affected artifact.
Acceptance: required supported
correctness/non-regression cells pass; confidence limits/incomplete coverage are
explicit; no declared UI change is confused with accidental parity loss.

**RN-12:** Deliver in explicit stages using verified new-repo CI: 12a promotes
qualified bytes to `next.facemorph.me` for candidate review; 12b promotes the
accepted exact artifact to `facemorph.me` and verifies supported live journeys;
12c completes `checkface.facemorph.me` retirement from RN-20’s manifest, then
rechecks production/classic independence, authoritative DNS and provider bindings.
Do not retire the legacy host while current production or the selected rollback
artifact still depends on it. Candidate delivery alone does not complete this
workstream. Publish npm packages under validated names after pack/install checks and license /
notice checks for actual tarball contents; declared license must match imported
source rights. Unresolved rights block that artifact’s publication; excluding
weights alone is not sufficient.
Bind npm versions/tarball digests, source, manifest/runtime pins, stage-specific
site receipts and live assets. Acceptance: implemented, published and deployed
facts are distinct and auditable; available qualification precedes bounded /
consented phone trials, with failures preserved; final retirement has retrievable
configuration evidence and a qualified host-independent site rollback artifact.

**RN-13:** Split `Assets/model-cache.mjs`, shard/OPFS stores, acquisition/session
setup and manifest logic into model manager. Preserve keys/hashes and reject corrupt
chunks with bounded recovery. Acceptance: load/cache/read/reload/quota/checksum/error
and cancel cases, no download before authorization, no unnecessary download when
an output cache hit can satisfy the action, and proper loaded-handle disposal.
Test missing/corrupt shards after admission, leased-cache deletion, cross-tab
effects, cancellation and disposal: every affected operation settles, releases
resources and reports typed invalidation without hidden network repair.

**RN-14:** Start from `hosting/next-static/{stage.py,restage-runtime.py,mirror-runtime.py,
promote.py,webgpu_contract.py}`, `hosting/next/prepare-runtime.py`,
`src/Next/browser/stage-assets.py` and photo-runtime staging identified by RN-01.
Extract model chunk/manifest hosting, preserving pins and public/private boundaries.
Separate frontend/catalogue/diagnostics and application-domain promotion policy;
existing staging/promotion scripts must not be moved wholesale into this package.
Record commands, inputs and schema in `packages/cloudflare-model-host/README.md`.
Qualify staging and an explicitly identified test origin here; final production
promotion and live-byte receipts belong to RN-12. Document independently usable
hosting instructions and verify current limits for the exact artifacts. Acceptance:
record the chosen Cloudflare product/tier, total bytes/file count, per-file/chunk
limits, request routing and storage/request/bandwidth allowances. Verify model
requests use the intended path without accidental Worker invocation. If qualified
artifacts cannot meet the free-tier target, record the limitation and resolve an
explicit hosting/cost decision before production publication; do not silently
enable paid services. Every published chunk reconstructs its declared asset, client manager/engine agree
on schema and hashes, and the exact tested headers/runtime bytes are served.

**RN-15:** Package existing converters with pinned sources, reproducible invocation,
model architecture/shape/output declarations and accepted numerical evidence. Include
official FFHQ and a representative declared alternate checkpoint conversion where
available; otherwise expose the limitation before release. Acceptance: supported
formats can be loaded by the manager/engine, acquisition docs do not imply bundled
weights or blanket support for every third-party pretrained model.
Implement the container contract in `PLAN.md#language-and-framework-direction`:
Dockerfile, pinned base-image/tool/dependency versions, bounded build context and
opt-in Compose service; read-only checkpoint inputs, writable outputs and explicit
cache volumes/file ownership. Document clean-clone build/convert/verify commands,
CPU support and optional verified NVIDIA setup. No weights are bundled in the image.
Acceptance also includes empty-cache/repeat and failure-cleanup container runs,
image/source/input/output provenance and independent numerical checks; unsupported
CPU/GPU/architecture cells remain explicit, not substituted with silent fallback.

**RN-16:** Inspect `self-host/compose.yml`, `self-host/compose.gpu.yml`,
`self-host/setup.py`, `self-host/Dockerfile`, `self-host/legacy-route-inventory.json`
and `self-host/verify.sh`. Inventory remote default branch (`master` at setup)
and select the supported distribution branch/commit; current self-host work is on
`candidate/next-delivery-20260916`. Record default-branch promotion or an explicit
branch-selecting quickstart. Correct cloned directory instructions to
`facemorph.me-classic/self-host` and qualify the exact documented fresh-clone /
Compose commands, not an already prepared local tree. Reconcile existing PyTorch self-host with the sibling legacy server's API
inventory; migrate only missing verified functionality into the classic successor.
Replace the current manual setup-profile step with a documented CUDA Compose
entry point whose API waits for checksum-verified setup and logs the URL. Preserve
explicit model-term acknowledgement; never silently inject acceptance. The NVIDIA
host prerequisites and GPU configuration remain explicit. Test interrupted/failed
acquisition, verified-file reuse and startup failure without CUDA. Acceptance: genuine GPU startup from empty
volumes plus restart, original UI/API/photo/morph/media compatibility and direct
author model acquisition; record all untested host/CPU/GPU limitations. Retain the existing
`self-host/validation/2026-10-10/gpu.json` evidence as historical: one GPU/driver,
synthetic inputs and source-only delivery. Existing route tests establish neither
production encoder parity nor byte-identical historical pixel outputs.

**RN-17:** Use `PLAN.md#supplied-ui-references` and the confirmed-crop/ordered multi-selection
flow above to build a reviewable controls/modal design before behavior implementation.
Refactor `src/Next/Product.fs`, `src/Next/photo-selection.mjs` and the product bridge
behind the typed TS application controller, keeping React rendering separate.
Apply exact UI requirements above, including crop confirmation, paste equivalence,
mode-specific Generate/Cancel, hold-to-compare removal, ordered multi-face selection
and disabled Morph/right-of-progress Cancel. Test A→B versus B→A clicks, deselect/reselect,
zero selections, extra keypoints amid existing faces, crop adjustment for each selection,
stale target changes, mixed per-face failures and cancel/retry without duplicate IDs.
Cancel the first running face while later selections are queued; cancel a queued
face; verify only the selected slot stops, siblings continue in order, completed
faces survive and retry appends one existing slot without reallocating keypoints.
Cancel every selected slot, wait for all jobs to settle, then retry one without
file reimport or crop reopening. Verify input/pixel lifetime at and over RN-02 budget
ceilings and release after success/removal/replacement/disposal. Acceptance:
320/360/390/desktop rendered controls, keyboard/accessibility behavior, denied consent,
changed input/late result, file/clipboard entry, and Save/share usability pass the
actual app. No post-encode crop button, hold-to-compare gesture/button or duplicate
filename remains. Match confirmation/editor/failure layouts from the inspected archive.

**RN-18:** Compare the classic/names surface, record the intended fullscreen layout
and use current pinned catalogue/preview/recovery metadata. Names must be real usable
instant results, not only previews that later require generation/download. Acceptance:
gapless overlay-name grid, no search/header/x, accessible escape/back dismissal,
instant selection and subsequent morph/save/restore compatibility.

**RN-19:** Inventory all WebGL route lists, canary/manifest dependencies, saved
preferences and report allowlists before removal. Remove WebGL from new app paths
with a migration rule for old preferences, without deleting shared legacy assets
needed by the classic/history surface. Acceptance: CPU-only devices and WebGPU
failure/cancel/reload paths produce correct bounded outcomes; no forced/auto WebGL
route remains. Missing physical-phone evidence is a documented release limitation.

**RN-20:** Complete the remaining organization/integration migration and prepare
application-domain cutover and legacy-host retirement.
Write `docs/plans/repo-cleanup-and-architecture-refactor/cutover-manifest.md` with
current stable repo IDs/URLs, retained commits, source-transfer mapping, owners,
ordered mutations, verification gates and stage-specific rollback commands.
Repository creation/rename and backend archival are already complete; do not
repeat them. Verify availability and owner permissions for organization login
`facemorph-me`, then perform the organization rename and update GitHub/Cloudflare /
Actions/Docker clone references, remotes, badges, docs, webhooks and integration
bindings. Record unresolved integrations explicitly; do not rely on old redirects.

Consume RN-11/RN-16 evidence before final cutover. Fresh-clone classic at its final
organization URL using RN-16’s documented distribution branch/default-branch
policy and verify its Dockerfile fetches the pinned historical frontend commit. Verify new monorepo CI/integrations without promoting unqualified bytes.
Prepare complete `checkface.facemorph.me` retirement under the dedicated
architecture section, including DNS, Pages, origins/proxies and active references.
Inventory current production, `api.facemorph.me` and proxy dependencies, name the
verified host-independent site rollback artifact and freeze shutdown/recovery
commands. Actual domain promotion and destructive retirement belong to RN-12’s
ordered stages; preparation must not disable the current production route.

Preserve both repo histories and archived backend source. Recovery must restore
site delivery independently of organization rollback; name stable IDs, exact
previous source/artifact/Cloudflare versions and recovery owners. If a repository
name ever needs restoration, move the fresh repo to a chosen unused holding name
first, then restore the classic name; never delete a history to resolve collisions.
Acceptance: qualified source exists at the intended organization URLs; classic
bootstrap and new integrations pass; retirement readiness and host-independent
site recovery are qualified and recorded. Legacy-host absence is verified during
RN-12 after production cutover. Setup alone does not satisfy these gates.

## Open choices and release stopping rules

Open design choices: availability/permissions for selected GitHub login `facemorph-me` and npm scope/names;
detailed multi-selection visuals; unspecified drag/drop target and Save/share placement.
Resolve names at their named tasks; RN-05 fixes migration milestone ordering. Remove hold-to-compare now
as planned; preserve existing usable Save/share until a reviewed placement decision exists. Compute extraction follows all RN-05 parity milestones; the temporary Fable
facade is used during migration, not as an exemption from that dependency. The old app
remains the measured comparison/rollback control. TS monorepo completion requires
RN-05 parity gates; a failed migration blocks that completion claim, not the checks.

Stop a candidate on identity/privacy/correctness errors, unbounded resources or
material predeclared regressions. Missing supported gates remain inconclusive;
retain failed attempts, controls and historical reports. Revert only owned changes
with additive commits; never reset/clean the shared checkout. Organization rename,
legacy-host retirement and public package/site actions belong to the concrete
cutover/release workstreams, not this planning pass.

Completion: classic successor verified; new monorepo
strict TS application/package boundaries and supported converter/host/manager flows qualified; revised app
UX/photo/names/provider behavior accepted; engine publication and site delivery have
actual receipts. Unsupported devices/models and unresolved optional interactions
remain explicit. A latest-plan label alone does not claim any of those outcomes.

## Operator overview and clarifications
Source: [Google Doc](https://docs.google.com/document/d/1lVNtTjPOsVYfFUJa0jCiiVU2jtDENcFcQF8iHrufJ1s/edit).
Retrieved: 2026-10-11T04:54:31.206267+00:00

Export SHA-256: `d8818ed151034b733d654f2db1b945800033a152e5566ccdf8982dad7f8fdd6b`. This is the overview supplied
for the release planning pass; later explicit operator revisions supersede it.
The active requirements above incorporate the overview and subsequent operator
clarifications. Current rulings are: classic is `facemorph.me-classic`, the chosen
organization login is `facemorph-me`, backend source is already archived, and
`checkface.facemorph.me` must be retired completely. The reusable engine takes
caller-loaded models, model management stays separate, and all application work
is planned in idiomatic TypeScript with exact approved UI parity.

The inspected image descriptions and checksums are retained in
[Supplied UI references](#supplied-ui-references). Original setup instructions and
superseded naming/hold addenda are removed from the remaining-work plan; Git
history retains their provenance.

## Planning review and scope-change record

This pass reviews only the remaining architecture, migration, classic qualification,
UI, research and delivery work. Completed repository setup is current context,
not a task to repeat. Older review history remains in Git; it does not qualify
this revised plan. Fresh review findings and their disposition are recorded here.

This is a planning-only pass. RN identifiers name specification workstreams, not
issue records. Do not create, convert, import, update or open execution-tracker
records during plan drafting or review. Existing tracker data is separate from
this document and remains untouched; conversion/synchronization is a distinct
later step after the plan is reviewed and the operator requests execution setup.

### Fresh review findings integrated — 11 October 2026

Three independent read-only reviewers checked the cleaned remaining-work plan
against classic/backend source. Integrated corrections: staged next/production
promotion before destructive legacy-host retirement; host-independent rollback;
RN-05/RN-06 scheduling consistent with the graph; immutable confirmed-crop geometry;
verified local-asset leases and typed offline invalidation; exact classic branch /
clone quickstart qualification; explicit free-tier serving/billing checks; and
source-license/notice gates for distributions. A fourth fresh reviewer read the revised plan and source, found no remaining
substantive issue, and requested only matching the RN-20 table label to its
preparation-only retirement ownership. That wording correction is integrated.
These were three independent initial reviews followed by one fresh convergence
review; no cross-model or GPT Pro review is claimed. No execution-tracker records were created or updated.

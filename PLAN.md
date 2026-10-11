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

The operator has authorized repository setup now: rename the existing repository
to `facemorph.me-classic` and create a fresh `facemorph.me` based on this plan.
This setup does not qualify the new application or promote it to either site.
The existing candidate remains the delivery and rollback source until verified
application cutover. Archive `checkface` as-is under the updated operator ruling; complete Docker/PyTorch work in `facemorph.me-classic`.

## Starting facts and boundaries

- New initiative checkout: `facemorph.me/`, origin `github.com/check-face/facemorph.me`,
  default branch `main`, fresh repository ID `1413979666`. This is the continuation
  point for the monorepo plan; it has no application build or deployment yet.
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
  server work; the namespace migration must update its clone source.
- The sibling `checkface/` is the legacy backend. Inspect it read-only for migration
  provenance; archive its remote as-is under the operator’s setup authorization; archived history remains readable for migration.
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
| Existing `facemorph.me` repository | Rename to `facemorph.me-classic`; integrate the legacy server and original frontend with PyTorch and easy Compose. | Preserve history, pinned frontend commit, API behavior, model sources and attribution. |
| Existing `checkface` repository | Archive as-is. | No rewriting or deletion of its history; Operator authorizes archival now; classic Docker/PyTorch remains a separate qualification gate. |
| New `facemorph.me` repository | Monorepo with UI, engine, model manager, model-host tooling and model converter. | Establish source provenance, package boundaries, CI, deployment pins and a rollback route before cutover. |
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
in this fresh repo. Source and history mapping must be decided from the inventory; creating the new
remote does not authorize abandoning existing branches or evidence.

Prepare artifacts and migration manifests before namespace cutover. Reusing the
old organization/repository path for the new application can replace old redirects.
Update Dockerfile historical clones, remotes, Actions references, badges, docs,
webhooks and Cloudflare integration explicitly. GitHub does not redirect every
surface, including reusable action calls and Pages URLs.
[Repository rename rules](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository),
[organization rename rules](https://docs.github.com/en/organizations/managing-organization-settings/renaming-an-organization).

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
build/distribution assets, vendored code, weights, fixtures, `.beads` state/export,
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
choice. Package extraction may progress against the temporary Fable control, while
new-monorepo release completion requires its TS migration gates. The operator permits
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
API as a dependency. The operator authorizes archiving `checkface` now; verify Docker/PyTorch in `facemorph.me-classic` before claiming classic complete.

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
actionable reduce-selection/remove-retry-input message, not truncation or hidden eviction. A valid crop that
fails alignment reaches one direct e4e attempt or an actionable terminal error.
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

All work is planned/deferred. RN IDs identify release scope; existing Beads IDs are
retained where the engine work is refined, with new children for added scope.
Dependencies are blocking edges; not merely a suggested chronological list.

| Task | Beads ID | Depends on | Deliverable / gate |
| --- | --- | --- | --- |
| RN-01 Inventory and freeze baseline | `fm-fy2.1` | — | Repository/source/asset/consumer/receipt inventory; migration manifest. |
| RN-02 Freeze package and operation contracts | `fm-fy2.2` | RN-01 | Typed loaded-model/batch boundaries, manager/host/convert formats, resources and parity matrix. |
| RN-03 Freeze workloads and comparison rules | `fm-fy2.3` | RN-01 | Versioned specs, control identity and decision rules. |
| RN-04 Prepare monorepo build/CI identity | `fm-fy2.4` | RN-01, RN-02 | Strict TS/workspace/type/worker linkage, Oxlint/Oxfmt gates, new-path hashing/discovery. |
| RN-05 Move UI behind package facade | `fm-fy2.5` | RN-02, RN-04, RN-10 | Parity-preserving facade and isolated recommended TS/React/Vite migration. |
| RN-06 Extract stylegan-js compute | `fm-fy2.6` | RN-05, RN-13 | Caller-supplied loaded models; no model I/O/weights; tested browser/native capabilities. |
| RN-07 Separate media and metadata helpers | `fm-fy2.7` | RN-06 | PNG/lossless-WebP recovery API, video pipeline, application Save/share boundary. |
| RN-08 Repair crop-confirm-to-encode flow | `fm-fy2.8` | RN-06 | Bounded direct confirmed-crop path, actual e4e and no crop loop. |
| RN-09 Extract morph/frame pipeline | `fm-fy2.9` | RN-07, RN-08 | All geometry modes, ordered bounded frames, cancel/reload compatibility. |
| RN-10 Build evaluator and freeze noise baseline | `fm-fy2.10` | RN-03 | Same versioned wrapper/control apparatus before facade/extraction. |
| RN-11 Qualify release artifacts and packages | `fm-fy2.11` | RN-09, RN-14, RN-15, RN-17, RN-18 | Correctness, UI parity/change matrix, paired regression verdicts and pack/install tests. |
| RN-12 Publish and verify release | `fm-fy2.12` | RN-11, RN-20 | Candidate/site/package receipts and verified runtime/live bytes; distinct classic coverage. |
| RN-13 Extract browser-model-manager | `fm-fy2.13` | RN-02, RN-04 | Chunks/checksums/OPFS/caching/loaded handles with consent and compatibility. |
| RN-14 Extract cloudflare-model-host | `fm-fy2.14` | RN-02, RN-04 | Reproducible chunk host, limits/terms check and exact qualified manifest. |
| RN-15 Create model-conv tooling | `fm-fy2.15` | RN-02 | Containerized supported conversions, shape/provenance manifests and numerical reports. |
| RN-16 Prepare classic repository and Compose successor | `fm-fy2.16` | RN-01 | Original UI/API/PyTorch migration, one-command GPU bootstrap and verified reuse. |
| RN-17 Apply revised face controls and consent modals | `fm-fy2.17` | RN-05, RN-08, RN-19 | Referenced crop modals, ordered multi-selection, compare removal, paste/file/cancel matrix. |
| RN-18 Restore fullscreen instant-name picker | `fm-fy2.18` | RN-05 | Classic-like edge-to-edge layout, accessible dismissal and instant selection. |
| RN-19 Remove WebGL with compatibility handling | `fm-fy2.19` | RN-05, RN-13 | CPU/WebGPU-only admission, persisted-preference migration and required fallback coverage. |
| RN-20 Prepare and execute repository namespace cutover | `fm-fy2.20` | RN-11, RN-16 | Valid namespace, classic rename/new repo/archive sequence, integration/revert manifest. |

### Task instructions and acceptance

**RN-01:** Inspect `src/Next/product-bridge.mjs`, runtimes, geometry/photo/media,
`self-host/`, read-only sibling server, workflows, staging and historical clones.
Record every moving path, consumer, build/worker URL, persistent identity, source
revision and live receipt in `docs/plans/repo-cleanup-and-architecture-refactor/inventory.md`. Identify provenance/history transfer
and external model sources. Acceptance: all release surfaces have an owner and a
retained/rebuildable input; uncertainties are explicit; no remote changes yet.

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
Pass the exact confirmed crop once through this preprocessing, with bounded alignment
attempt/fallback and no automatic crop-loop. Update both wrappers, runtime admission,
product errors and worker identities together; keep older unconfirmed paths distinct.
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
tarballs in a clean consumer with caller-loaded models. Acceptance: required supported
correctness/non-regression cells pass; confidence limits/incomplete coverage are
explicit; no declared UI change is confused with accidental parity loss.

**RN-12:** Publish under validated package names only after pack/install checks;
deliver the qualified app through verified new-repo CI. Bind npm versions/tarball
digests, source, manifest/runtime pins, site receipts and live assets. Acceptance:
implemented, published and deployed facts are distinct and auditable; ordinary
phone trials are bounded/consented after available checks, with failures preserved.

**RN-13:** Split `Assets/model-cache.mjs`, shard/OPFS stores, acquisition/session
setup and manifest logic into model manager. Preserve keys/hashes and reject corrupt
chunks with bounded recovery. Acceptance: load/cache/read/reload/quota/checksum/error
and cancel cases, no download before authorization, no unnecessary download when
an output cache hit can satisfy the action, and proper loaded-handle disposal.

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
every published chunk reconstructs its declared asset, client manager/engine agree
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
and `self-host/verify.sh`. Reconcile existing PyTorch self-host with the sibling legacy server's API
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

**RN-20:** Write `docs/plans/repo-cleanup-and-architecture-refactor/cutover-manifest.md` before
mutations: stable organization/repository IDs, old/new URLs, retained commits,
source-transfer mapping, integration owners, ordered mutations, verification gates
and rollback commands per stage. Resolve destination-name collisions before reversal;
retain both repositories/histories and restore site delivery independently of
namespace rollback. Prepare exact rename/create/archive sequence and namespace validity from
actual account/repository settings. Name/permission resolution is part of this task,
not a reason to guess or reserve npm names now. Preserve classic history/commits,
create monorepo source provenance, and update GitHub/Cloudflare/Actions/Docker clone
references. Acceptance: qualified source exists in its intended destination and
destination CI/integrations are verified before release; backend archival may occur during setup under the updated ruling;
recovery route and integration changes are recorded without relying on stale redirects.
After final names exist, fresh-clone classic and verify its Dockerfile fetches the
pinned historical frontend commit from that destination. Verify new monorepo CI and
Cloudflare integration without promoting unqualified bytes. Backend `checkface` archival is authorized during setup; classic must still succeed
from its final destination before RN-16 or release completion is claimed.

## Open choices and release stopping rules

Open design choices: availability/permissions for selected GitHub login `facemorph-me` and npm scope/names;
detailed multi-selection visuals; unspecified drag/drop target and Save/share placement.
Resolve names at their named tasks; RN-05 fixes migration milestone ordering. Remove hold-to-compare now
as planned; preserve existing usable Save/share until a reviewed placement decision exists. Package extraction can progress against the temporary Fable facade. The old app
remains the measured comparison/rollback control. TS monorepo completion requires
RN-05 parity gates; a failed migration blocks that completion claim, not the checks.

Stop a candidate on identity/privacy/correctness errors, unbounded resources or
material predeclared regressions. Missing supported gates remain inconclusive;
retain failed attempts, controls and historical reports. Revert only owned changes
with additive commits; never reset/clean the shared checkout. Remote rename/archive
and public package/site actions belong to the concrete cutover/release tasks, not
this planning pass.

Completion: classic successor verified and old backend archived as-is; new monorepo
strict TS application/package boundaries and supported converter/host/manager flows qualified; revised app
UX/photo/names/provider behavior accepted; engine publication and site delivery have
actual receipts. Unsupported devices/models and unresolved optional interactions
remain explicit. A latest-plan label alone does not claim any of those outcomes.

## Operator overview and clarifications
Source: [Google Doc](https://docs.google.com/document/d/1lVNtTjPOsVYfFUJa0jCiiVU2jtDENcFcQF8iHrufJ1s/edit).
Retrieved: 2026-10-11T04:54:31.206267+00:00

Export SHA-256: `d8818ed151034b733d654f2db1b945800033a152e5566ccdf8982dad7f8fdd6b`. This is the overview supplied
for the release planning pass; later explicit operator revisions supersede it.
Use [the release plan](#latest-plan--repo-cleanup-and-architecture-refactor) for reconciled requirements and task dependencies.

The DOCX export contains one screenshot of the existing two-face page. It was
viewed for this pass; it is not a complete crop-modal specification. Its personal
photo pixels are not copied into this repository. Open the source document for
the visual reference. The unfinished bullets and question marks below remain
unresolved, rather than being treated as approved interactions.

---

Repo architecture
1. Rename github.com/check-face to github.com/facemorph.me
2. Rename facemorph.me repo to classic.facemorph.me and integrate the server part of the checkface repo into it (migrated to pytorch for better compatibility) with easy docker-compose
   1. Git clone
   2. Docker compose up (works, they have a running working nvidia docker (over pytorch for nvidia gpus) facemorph api and frontend running locally (and log a link - how to open in browser, one click) but they use the actual nvidia hosted stylegan models and download them from there, we don’t host them.
3. Archive the checkface repo as-is
4. Create facemorph.me repo (monorepo) with UI, engine, and model-loader packages.
5. We will find out what name we can publish under on npm once we actually publish…


Next


6. Create a library (stylegan-js) which we can push to npm which contains the “engine”. Do not bundle any of the resources like the model. Include the morphing algorithms, in the selectors (linear, figure 8 etc). A function for encoding raw pixel data to png or lossless webp (on webworker?) with embedded latent and stylegan-js metadata. Another function for retrieving metadata and latent from a png/webp. Give instructions for how someone is able to download whatever weights they want from nvlabs / stylegan (if they wanted to do one of the other published datasets)


7. Move the webgpu / cpu selector to the top of the page with explanation (above the first + button). Modal if someone tries to do actions that require downloads (remove toast, but similar concept)
8. Remove webgl nobody seems to use it. Ensure that it doesn’t break anything though.
9. We no longer care about F#, we may remove it, but the requirement would be exact parity on the current frontend.
10. Provide a model loader package as well which is responsible for loading from the cloudflare hosting (in chunks) and device caching.
11. Bug: There is a bug where the faces get cropped, but fail to end up encoded. I’m not sure why. It shouldn’t be failing as often as it does, and the user ends up stuck on a loop where they keep getting prompted to crop the image, but it was already cropped. Guessing alignment or something was run after the crop and fails? But it should just take the crop and if it can’t align, just run e4e.



The stylegan-js package is not responsible for managing or loading model files. Users of the library are expected to hand it a model already-loaded.
“Browser-model-manager” package, also in the monorepo, will have the logic for downloading chunks, saving in opfs, recovering from checksum errors
“Cloudflare-model-host” package for hosting model chunks on cloudflare for free
“Model-conv” package for converting pretrained stylegan2 models (eg from https://github.com/justinpinkney/awesome-pretrained-stylegan2 ) to required format(s)


UI Changes






* Generate should only
* Remove the Browse Names button and put it in the burger menu. For either the “baby names” or the encode image, we don't need generate button at all to show, only show it when someone chooses seeds and words. We now don’t need to show the generate button unless we have typed something new in the text box, in it’s place, move the generate button inside the image box - which should be blank, if you start typing anyway. Though, it only needs to show if we’re using text or numeric seeds.
* Rename Upload image to “encode image”
* Pasting an image in the text box automatically kicks of the old “upload an image” which is now “encode an image” should kick off the same flow as if they chose an image with the system ui dialog to upload an image.
* Delete the line of text below the text box referring to the name of the image, inside the text box is fine!
* When doing any encoding or generating, the cancel button shouldn’t be on a separate line, but rather the generate button should change to a cancel button for all the flows that can be canceled, which is encode, (once the crop confirm modal closes, and we’re back to watching status for the face happen) and the 2 seeds, but not the “names” selection, because the names selection is instant.
* Crop photo should only happen before encoding, not it’s own button visible after. It only needs to happen in the modals for doing encoding. A crop should be proposed, (and keep the multi-face flow) but - the user needs to get a chance in their modal to confirm the crop (and move/change it if they desire before doing encoding). Once they confirm the crop - it should encode. See UI mock attached. Use the style of modal from facemorph.me with the logo top right.
* For the morph button (disable it), add a cancel button to the right of the progress bar once you’ve pressed it once if you wish to cancel
* Add drag drop to
* The “baby names” from names.facemorph.me have degraded. It should very closely match the visual experience on the old facemorph.me site - no gaps between the images, the names displayed on top of the images etc - in full screen.
* The baby name picker should not have a search function, and have no header or x icon facemorph.me. It’s important there are no borders between faces. The experience after selecting (because we don’t need to generate a face) is that it instantly displays. It should look very similar to names.facemorph.me anyway.
* Hold to compare ???? (conflict with potentially uploading images if clicking on the image)
* Save / Share image ????


### Later operator clarification — 11 October 2026

The operator pasted the release requirements into this conversation and supplied
workspace `image-archive.zip`. This explicit clarification supersedes conflicting
or incomplete items in the earlier exported overview. Repeated repository/package,
CPU/WebGPU, consent, Generate/Cancel, names and crop-loop requirements remain.
Additional/revised requirements:

> When click Adjust Crop, it should use something very similar to the existing UI.
> If face isn't detected, show existing message. If multiple faces are detected,
> create a very similar UI to the below screenshots, for choosing which face(s)
> you want to encode. If multiple are selected, they should automatically create
> extra next-face keypoints according to the order that you clicked, once clicking OK.

> Just remove hold to compare.

> Architect this as a clean monorepo. Remember to refactor when necessary and
> write idiomatic typescript.

The operator also requested a language/framework recommendation and the planning
process skill for this pass. [Technology recommendation](#language-and-framework-direction) and
[inspected visual references](#supplied-ui-references) record the response. The earlier
question-mark compare idea is now decided: remove it. Save/share placement and an
unspecified drag/drop target remain open; existing usable Save/share and accepted
photo dropping behavior continue. No rename, archival or runtime work is performed
by this planning update.

## Planning review and scope-change record
Initiative: `release-next-facemorph-me`. Date: 11 October 2026.
This records planning, not implementation, experiments, publication or deployment.

### Scope and method

Applied the local Jeff Emanuel planning-workflow skill (workstation source: `/home/cdilga/.claude/skills/planning-workflow/SKILL.md`):
grounded source checks, explicit rationale, self-contained tasks, dependency graph,
four fresh review rounds and Beads conversion. The user requested a simpler layout;
detail is scaled to actionable decisions rather than arbitrary line-count targets.
Reviewers use the available session model; no cross-model or GPT Pro review is claimed.

The operator overview broadens the earlier engine plan into a release: monorepo and
reusable packages, classic distribution/repository migration, UI/photo fixes and
research qualification. The [captured overview](#operator-overview-and-clarifications) records source
retrieval and image interpretation. Earlier engine reviews qualify only their dated
engine-only snapshot retained locally at `../facemorph.me-classic/docs/plans/engine-research/plan-2026-10-11.md`, not this expanded scope.

Root `PLAN.md` is the stable latest pointer. README, agent guides, documentation and
research indexes point here; the former engine entry redirects while history remains.
No application code or research ledger rows are changed by this planning pass.

### Round 1 — loaded-model ownership and confirmed-crop policy

Reviewer: `release_review_1`, fresh context, read-only. Substantive clarifications:

- RN-02 explicitly resolves the bounded 108-session encoder stream, verified bytes,
  acquisition boundary and encoder-to-synthesis residency. A consumer must work
  without importing the model manager; the engine cannot fetch more model files.
- RN-08 replaces the conflicting detector-dependent exactly-one-face policy for
  confirmed crops. Named bridge/runtime/wrapper/worker updates and real-e4e forced
  failure tests prevent another crop loop without weakening unrelated admission.
- Prerequisite artifact paths and preprocessing/ownership requirements are explicit
  in detached task instructions. The unfinished drag/drop bullet stays unresolved.

Validation: 20 tasks, 35 blocking edges, acyclic; all tasks feed release completion.
No task/DAG change was required. Concrete contract revisions required another review.

### Round 2 — repository grounding and release graph

Reviewer: `release_review_2`, fresh context, read-only. No substantive revisions.
Checked actual runtime/cache/converter/build roots, streamed encoder, Compose setup
and historical clone. Package boundaries, source reconciliation and qualification /
cutover ordering are coherent; the graph remains acyclic.

### Round 3 — hosting, classic bootstrap and collision-aware rollback

Reviewer: `release_review_3`, fresh context, read-only. Bounded task clarifications:

- RN-14 names extraction inputs and separates chunk-host staging/test-origin gates
  from application-domain promotion and RN-12 production receipts.
- RN-16 resolves the manual setup-profile/CUDA override mismatch, preserves explicit
  model-term acknowledgement and adds acquisition failure/reuse checks. Historical
  real-GPU evidence stays useful with its one-GPU/driver and synthetic-input limits.
- RN-20 requires stable IDs, stage-specific rollback commands, collision handling,
  independent site recovery and classic fresh-clone verification at final names
  before archival. RN-11 gains an explicit UI change/evidence matrix artifact.

Validation: no task or blocking-edge change; standalone migration/host tasks now
name source inputs, deliverables and test/publication boundaries. Another fresh
review checks these revisions before task export.

### Round 4 — final contract and cutover check

Reviewer: `release_review_4`, fresh context, read-only. No substantive revision
remains. Checked standalone RN-02/RN-14/RN-16/RN-20, confirmed-crop policy, source
fidelity and latest pointers. All 20 tasks feed RN-12; 35 blocking edges, no cycles.
The final round is marginal rather than structural; planning review converged.

### Beads conversion and checks

Epic `fm-fy2` is renamed to `release-next-facemorph-me`; children `.1`–`.12` retain
IDs from the earlier engine initiative and `.13`–`.20` cover the added release
scope. Historical scope remains in the engine snapshot and issue history. The
release label/reference is canonical; the former label on retained records is an
alias. All 21 records are deferred; none starts implementation.

Task descriptions include instructions, concrete prerequisite artifact locations,
applicable package/UI/classic requirements, baseline facts, resource/evidence
contracts, stopping rules and acceptance. Blocking edges match the release table;
parent links remain. Portable export: `.beads/issues.jsonl`; local DB is ignored.

Focused export checks cover specification/task congruence, exact graph and cycles,
detached task context, repository-relative links, status/label readiness, and
DB/portable-export parity. `br ready --json` stays empty during planning.
Local Markdown links and whitespace are checked; the append-only research ledger
is byte-identical to HEAD. No app code, build, experiments or remote actions are
performed. Existing concurrent `.gitignore` and `.cloudflare/` work is preserved.

### Operator ruling — browser/desktop alignment, 11 October 2026

Following the raw RGBA/canvas investigation discussion, the operator asked why
Tauri diverges and directed closer alignment. The active specification now
[records the ruling](#browser-and-desktop-alignment-ruling--11-october-2026):
shared product/media behavior by default, capability-based path selection and
documented, justified adapter exceptions. RN-02/RN-09/RN-11 own contract,
integration and qualification coverage within the existing graph.

Source inspection found the native adapter returns an `image.png` artifact and
does not expose raw results or streamed synthesis; the product bridge explicitly
excludes Tauri from the newer raw paths. No native raw-vs-PNG measurement was
found in the inspected investigation records. The browser component results do
not establish native IPC performance. This is a policy addition only: no runtime
change, new experiment, desktop qualification or deployment is claimed. Earlier
review rounds predate this addition; no fresh multi-agent review is claimed.


### Revamp clarification pass — reviewed, 11 October 2026

The operator clarified multi-face selection/keypoints in click order, supplied
`image-archive.zip`, removed hold-to-compare and requested idiomatic TypeScript plus
a language/framework recommendation. All four PNGs were inspected; the archive
contains no multi-face/names grid mock. Primary React, Vite, TypeScript, React Router,
Svelte and Next.js documentation grounds the [technology recommendation](#language-and-framework-direction).
Concurrent browser/desktop alignment additions and `desktop/README.md` are preserved.
Earlier four reviews precede these changes; this pass has its own fresh rounds.

#### Revamp round 1 — stream ownership and isolated TS migration

Reviewer: `revamp_review_1`, fresh context, read-only. Three bounded changes:

- RN-05 has four ordered parity milestones: typed compatibility facade, unchanged
  path move, TS/React state/rendering translation, then Vite delivery migration.
- Caller provider capability owns bounded sequential sessions with verified local
  shard storage and completed network acquisition. Core sees operations rather
  than downloader/OPFS callbacks. This resolves the load-bearing stream baseline.
- Idiomatic TS is required for the declared revamp; React/Vite is the recommendation.
  The old app remains comparison/rollback control, and package extraction can
  progress against the facade. Failed TS parity blocks the completion claim.

Validation: no task or edge change; RN-02/RN-05 standalone instructions improved,
framework/package decisions have concrete reasons. Further fresh review required.

#### Revamp round 2 — cancellation scope and detector consent

Reviewer: `revamp_review_2`, fresh context, read-only. Three small clarifications:
removed the obsolete open migration-sequencing choice; distinguished pre-confirmation
detection from e4e encoding and required detector-asset consent; froze per-tile Cancel,
pre-OK modal cancellation and retry of one existing slot. Queued siblings continue
in order and retain stable keypoints. Added mixed queued/running cancellation cases.

Validation: no graph changes; input revisions and source lifecycle remain per-slot
post-commit. Diagram/table ordering and ownership choices remain justified; next
review checks edge cases rather than a new structural plan.

#### Revamp round 3 — retry input lifetime

Reviewer: `revamp_review_3`, fresh context, read-only. One lifecycle correction:
retryable slots retain minimal tab-only source/crop pixels after jobs settle;
success/removal/replacement/disposal releases ownership. RN-02 freezes numeric
source/crop/count/transient limits before batch admission; oversize batches fail
before keypoint allocation. Added cancel-all-then-retry and boundary cleanup checks.
The current source admission caps are cited separately from measured browser memory.

Validation: no graph changes. Detached tasks, screenshot fidelity, TS migration,
package/stream ownership and browser/Tauri alignment otherwise converge. Final
fresh review checks this lifecycle correction before refreshing the task export.

#### Revamp round 4 — final lifecycle and dependency closure

Reviewer: `revamp_review_4`, fresh context, read-only. No substantive findings.
Standalone contracts/migration/UI tasks, offline provider ownership, crop/keypoint
order, cancellation/retry lifetime, budget admission, visual/source fidelity and
browser/Tauri alignment converge. All 20 tasks feed RN-12 with 35 acyclic blocking
edges. No additional task or ordering change was required.

#### Refreshed Beads export and verification

Updated the existing deferred epic and all 20 task descriptions after convergence.
IDs, history, parent links and all 35 blocking edges are retained. Descriptions now
include applicable technology/visual decisions and the browser/desktop ruling;
optimistic revision checks protect concurrent task updates. No task was opened.

Verification covers task/specification agreement, exact dependency closure/cycles,
detached task context, portable links, states/readiness and DB/JSONL parity. Planning
Markdown links and whitespace pass; `autoresearch/results.tsv` remains byte-identical
to HEAD. Source/model/application pixels, code, deployment and remote repositories
are untouched. No runtime test or performance result is claimed for this plan.


### Tooling/container planning addendum — 11 October 2026

Operator requested Oxlint/Oxfmt and explicitly limited this to the plan, then added
a model-conversion Docker environment. The technology contract and RN-04/RN-15 /
RN-11 now include these requirements; existing task IDs and blocking edges remain.
Official Oxc source docs/npm metadata ground supported file types, configs, commands
and Node compatibility. Container requirements retain checkpoint provenance, model
terms, independent numerical qualification and explicit supported hardware limits.

This is a bounded planning addendum, not another four-round review claim. No tools
are installed, files reformatted, package manifests/lockfiles changed or containers
built/run. The task descriptions are refreshed and checked against the specification.

### Single-file consolidation — 11 October 2026

Operator requested one plan Markdown file. Root `PLAN.md` now contains the full
release specification, language/framework recommendation, Oxfmt/Oxlint requirements,
conversion Docker environment, inspected visual-reference descriptions, ordered
tasks, captured operator direction and review history. Former split active files
are removed after their content is integrated; links and deferred task descriptions
point to this file. Historical engine plans remain dated background. This changes
presentation and ownership of documentation, not release scope or task dependencies.
No HTML/site publication, runtime change, installation or deployment is performed.

### Initiative naming and human review hold — 11 October 2026

The active initiative is `repo-cleanup-and-architecture-refactor`, formerly
`release-next-facemorph-me`. Root `PLAN.md` remains the single plan; scope, task IDs
and dependencies are retained. Dated review records retain the former identity.

The operator requested a fresh repository based on this plan, delivering first to
`next.facemorph.me` and eventually to `facemorph.me` after qualification and cutover.
Repository creation, organization/repository renames and delivery changes await
human review. No fresh repository has been created and no deployment changed.

The operator briefly authorized archival of `check-face/checkface`, then asked to
hold off pending human review. The archive API call completed before the hold
arrived; it was reversed immediately and the API confirmed `archived: false`.
Repository ID `185985766` and its history remain intact. The original classic
qualification-before-archival gate remains in force; archival is not complete.

### Repository setup authorization and manifest — 11 October 2026

This operator direction supersedes the earlier human-review hold for repository
setup only. The required classic name is now **`facemorph.me-classic`**, replacing
`classic.facemorph.me` in the active architecture. The quoted original overview
and dated review records remain historical.

Stage 1 (authorized now): retain repository ID `295956585`, all branches, tags and
history; rename `check-face/facemorph.me` to `check-face/facemorph.me-classic`.
Move its entire local checkout to sibling `facemorph.me-classic/`, preserving
uncommitted and concurrent work, and update its origin. Create a new public
`check-face/facemorph.me` with a fresh history, this single `PLAN.md`, entry guides
and the portable deferred task graph. No source/model files or secrets are copied.
The classic checkout remains the source for inventory, migration and baseline
qualification; the new checkout is the continuation point for this initiative.

Stage 2 (deferred): implement and qualify the new monorepo and classic Docker /
PyTorch distribution. The new repository will deliver `next.facemorph.me` only
after qualified artifact/CI/Cloudflare setup, then `facemorph.me` after production
cutover. Current site routes, deployment credentials and classic candidate
workflows remain in the retained repository; no empty app is deployed. Update
historical clone URLs before reusing the former name: redirects stop working once
the new repository occupies that path. Retain pinned frontend commit provenance.

Legacy backend ID `185985766` / `check-face/checkface` is archived as-is under
the final operator ruling below. Classic qualification from its final destination
under RN-16 is still deferred. RN-20 remains incomplete: this early namespace
setup satisfies only its preparation portion; RN-11/RN-16 still block final cutover.

Selected organization login is `facemorph-me`, subject to availability and
owner access at execution. GitHub organization logins cannot contain `.`; the
brand `facemorph.me` is not a valid login. Keep `check-face` during this repository
setup until the organization rename is completed. No npm scope is reserved by these repository names.

Rollback: keep both repository IDs and histories. If the original URL must be
restored, first move the fresh repository to an explicitly chosen unused holding
name, then rename ID `295956585` back to `facemorph.me`; update origins and guides.
Never delete either history to resolve a name collision. Site delivery recovery
uses the retained candidate workflow and qualified Cloudflare versions independently
of namespace recovery. Do not archive the backend as a rollback action.

### Final setup rulings — 11 October 2026

The operator permits archiving `check-face/checkface` now, as-is. This supersedes
the earlier human-review hold and qualification-before-archival sequencing.
Docker/PyTorch integration and fresh-clone Compose qualification still belong in
`facemorph.me-classic` under RN-16; archival does not establish their completion.
Use existing classic `self-host/` first, then reconcile the archived backend’s
server behavior/provenance. Archival preserves read/clone access and all history.

Selected compliant organization login: **`facemorph-me`**. GitHub organization
URLs will be `github.com/facemorph-me`; repositories will be
`facemorph-me/facemorph.me` and `facemorph-me/facemorph.me-classic` after the
organization rename. `facemorph.me` remains the domain/brand. The selected login
uses only letters and a hyphen; absence of a public account is not a reservation.
Organization rename requires availability and owner access in GitHub settings;
repository setup proceeds under the existing `check-face` owner until it is done.

### Setup receipt and continuation — 11 October 2026

- Retained classic remote: `https://github.com/check-face/facemorph.me-classic`,
  repository ID `295956585`; all existing branches/history retained.
- Fresh monorepo remote: `https://github.com/check-face/facemorph.me`, repository
  ID `1413979666`, branch `main`. Initial contents are this plan, entry guides and
  the portable task graph, with a fresh Git history.
- Local directories match these names. The entire old checkout, including other
  sessions’ uncommitted work, remains in `../facemorph.me-classic/`.
- Backend `https://github.com/check-face/checkface`, ID `185985766`, is archived
  as-is under the final operator ruling. Its source remains cloneable/readable.
- Classic candidate commit `b2d945a8c7f0ff9f382fbfefaecc2651943077a3` repairs the self-host Dockerfile
  clone URL and README URLs. This does not claim Compose/PyTorch qualification.
- GitHub organization remains `check-face`; selected next login is `facemorph-me`.
  Organization rename and integration migration are still outstanding.
- No app deployment, model migration, npm publication or runtime extraction has
  occurred. Existing `next.facemorph.me` delivery remains in the retained classic
  candidate; new-repo CI, credential binding and domain promotion remain gated.

Continue in this fresh checkout with RN-01 inventory and RN-02 contracts, consulting
the sibling classic source and pinned evidence links. The transferred 20 tasks
retain IDs, deferred states, parent links and all 35 blocking edges. Explicitly
start the appropriate tasks when application work begins; namespace bootstrap
alone does not close RN-20 or satisfy its RN-11/RN-16 prerequisite gates.

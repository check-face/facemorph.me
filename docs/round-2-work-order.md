# Round 2 work order — what to read, and what counts as done

Handoff brief for implementing the round-2 feedback and the 19 September audit findings.
Written **19 September 2026**, after the operator sanctioned every A finding.

## Read these, in this order

1. **[Testing round 2 feedback](testing-feedback-round-2.md)** — items **R2-1…R2-13**, with
   verified current behaviour, causes, and the operator decisions of 18–19 September
   (names route, lossy-served-images rule, connector placement, hidden video encode).
   The summary table at the end is the item index.
2. **[Candidate audit — 19 September](candidate-audit-2026-09-19.md)** — items **A-1…A-8**,
   all operator-approved. §1 answers the longmorph/figure-8/ellipse inclusion question;
   §2 re-verifies that every round-1 parity item (C-01…C-11) has landed in the tree, so
   **do not redo them**; §4 is the visual/UX pass this order schedules.
3. **The 18/19 September decision records** — the top bullets of
   [`migration_plan.md`](../../migration_plan.md) and
   [`web_checkface_delivery_plan.md`](../../web_checkface_delivery_plan.md), the amended
   names contract, and the names row in
   [current-delivery-scope.md](current-delivery-scope.md). Historic lossy full-size images
   are publishable as the same face; the names experience is a fullscreen `/names` route
   inside this app; `catalogue.json` stays light with per-name latents on demand.
4. **[Round-1 work order](round-1-work-order.md)** — sections "The one rule",
   "Verify, validate, deploy", "Traps" and the status-update notes apply unchanged. This
   order does not repeat the pipeline; use the same commands, the same six required e2e
   checks (unweakened), and the same promote discipline.

Code entry points, by item: `Product.fs` (R2-3/5/6/9/10/11, A-1/2/3/5/6),
`product-bridge.mjs` (R2-13, R2-4), `media.mjs` + `morph-frames.mjs` (R2-13/R2-4),
`photo/crop-view.mjs` + `crop-view.test.mjs` (R2-12), `estimate.mjs` (R2-13),
`product-ux.scss` (R2-6/8/10, A-5/6), `geometry/latent-path.mjs` (no changes needed —
A-7 only adds e2e coverage), `scripts/next-e2e-browser.py` + `hosting/next-static/promote.py`
(A-7, every new behaviour).

## The one rule

Same as round 1: **a gate tests the user-visible behaviour, not the component it depends
on.** Round 2 has already produced its own example: the frame store, writer support, key
derivation and slider reader all existed and were tested, while the one call-site argument
(`framesKey`) that connects them was missing — so "Use Slider" told users to regenerate.
R2-13's gate is therefore phrased at the UI, not at the store.

## Order of work (dependencies, not preference)

1. **A-8 — promote the current tree.** Everything else lands faster, and testers are still
   on `23c1646`.
2. **R2-13 — frames persisted + estimates.** Unblocks R2-4's live slider and A-7's slider stage.
3. **R2-4 (slider-first, infill, autoplay) and R2-12 (crop pan 1:1).** The two felt-experience bugs.
4. **R2-3 eager e4e; R2-5/6/10 restyles folding in A-1…A-6; R2-8 accent purge; R2-9 FAQ row.**
5. **Names:** the fullscreen `/names` route (19 Sept decision), catalogue v2 + per-name
   latent endpoints, the Triton API fill for the missing 2,144, and R2-7's latent tests.
6. **A-7 — e2e stages for each behaviour as it lands; R2-11 guidance copy last.**

## Per-item acceptance

| ID | Done when |
|---|---|
| **A-8** | `next.facemorph.me` serves a bundle built from this tree's revision or later, through `promote.py` with its receipt retained; fresh-client generation works on the deployment from a browser with no DNS override |
| **R2-13** | Generate a morph, toggle Use Slider → scrubbing starts immediately with **zero** `synthesis` events and no "not saved" note. Generate the same morph again → the job emits **zero** synthesis stages (encode-only), seconds not minutes. During a fresh morph the status shows per-frame time and a remaining total that **decreases**; the bar stays on frame units. The "about about" double-prefix is gone. A test drives `remaining()` through `jobProgress()`'s real field shape so the done/left mismatch cannot recur |
| **R2-4** | Frame generation order is endpoints first, then midpoint, then binary infill (writer receives the true frame index). The slider is visible and scrubbable **during** generation with an "N of M frames generated" count; it refuses nothing partial while generating but restore still refuses incomplete morphs. The MP4 is ready within seconds of the last frame (encode overlapped, per the approved decision). On completion the video autoplays muted+looped with the from-face poster, as classic |
| **R2-12** | On a ≥12 MP photo the crop image tracks the finger 1:1 at zoom 1 and stays finger-locked while zoomed; arrow keys step ~one viewport-width; a small photo (side ≈ viewport) regresses nowhere. `crop-view.test.mjs` pins the contract: pan one viewport-width → `frame()` translates exactly one viewport-width |
| **R2-3** | Selecting (or crop-accepting) a photo starts alignment + e4e automatically — no further click — with per-face progress, cancellable, and queued behind a running job via `PendingFaces`. No other face synthesises |
| **A-1** | At N=2 and ≥1000 px a visible + exists **between** the faces **and** after the second; no Add-face control remains in the middle column (moved per R2-5) |
| **A-2** | The trailing add affordance is reachable without a blind scroll at N≥3 desktop (peeks into view or auto-reveals) and is keyboard-operable |
| **A-3** | The remove control is recognisably a control at rest on coarse pointers (delete-style icon, resting opacity raised); tooltip and `aria-label` unchanged; e2e selectors still resolve |
| **A-4** | The names surface shows loading, empty and error states **inside itself**; a dialog-scoped failure never renders in the global status line. `build:next` copies `catalogue.json` so a local build matches deployment |
| **A-5** | More options shows no duplicated label/option text ("Shape", "Length"), restyled in the original design language, no accent borders; the processing-mode control's keyboard reachability is untouched (e2e selects CPU through it) |
| **A-6** | Video/slider/export/project render only when there is something to show; Export/Open live with the results area, not before the FAQ; no action row strands a single button on a wrapped second line at 390 px |
| **R2-8** | Zero coloured left-accent borders on rounded cards anywhere in the product surface (grep gate on `product-ux.scss`); the six known occurrences are restyled |
| **R2-6 / R2-10** | For-testing is a styled peer of the FAQ immediately after it; More options uses classic-consistent labelled controls; "Generate faces" renders only under a feature flag, placed after/under both faces |
| **R2-9** | One new FAQ row covers local on-device generation (models cached, offline-capable, nothing uploaded, slow-device honesty); no wholesale rewrite; server-era sentences corrected in place |
| **R2-11** | Guidance is device-honest: a desktop-class device on CPU is never told to move to desktop; a phone without a qualified GPU route is told what would actually help. Transient notices use a Snackbar; report references stay selectable in place. Nothing critical is toast-only |
| **Names (19 Sept)** | `/names` route in this app: near-identical grid (5,055 names, 200 px images), click-to-select targeting the nth face (or "morph to" flow), reopening per additional name; selecting materialises the face automatically — hosted cache first, device generation second, never a Generate click; morph endpoint frames may use the exact stored image. Catalogue v2: name + identity + 200 px/full-size URLs only; per-name latent at `catalogue/latent/<identity>` fetched on pick (never inlined — ~47 MB if it were). The 2,144 missing full-size images generated via `GET api.facemorph.me/api/face/?value=<lowercase>&dim=1024`, each verified against the lowercase-name SHA-256 identity before publication, historic bytes kept |
| **R2-7** | Latent retrieval and saving are CI-tested: derive a name's latent offline and byte-match an independent reference; catalogue/project round-trip with latent metadata keeps canonical bytes unchanged; wired beside the project-reopen check in `next-e2e.yml` |
| **A-7** | `next-e2e-browser.py` gains stages: morph driven for **all five kinds** (rotating), Use Slider end-to-end (zero synthesis), add-face → N≥3 morph through the real buttons, names browse → pick → face. Every new stage is added to `promote.py`'s `required` set **in the same change**; the existing six are never weakened |

## Verify, validate, deploy

Exactly as the round-1 work order: local unit + contract checks, `next-site.yml` build with
`next-e2e.yml` qualification of the same bytes, `promote.py` with receipt, public-URL
validation from a client with no DNS override. Two standing reminders:

- **If you add a behaviour, add its check** — new stage in `next-e2e-browser.py` **and** new
  entry in `promote.py`'s required set, same change.
- The Triton API fill is an **operator-authorised bounded live action**: only identities with
  no full-size candidate, identity-verified per result, historic bytes never overwritten.
  Record what was generated, from where, and the verification results.

## Claiming done

**READY FOR RE-TEST** when: A-8 is promoted and live; every table row above meets its gate;
the six original e2e checks pass unweakened plus the new A-7 stages; visual gates pass at
390 px and 1280 px (no accent borders, connectors per the confirmed placement, no stranded
buttons); and anything not measured is reported as not measured.

## Traps

- **R2-13 is a wiring bug, so its test must span the wiring** — the store and writer already
  have unit tests; what was missing was the call site. Test from `execute()` (or the UI) down.
- **`frameStoreGet`'s totalFrames guard is load-bearing for restore.** R2-4's live scrubbing
  needs a partial read; add it as a separate function rather than weakening the guard.
- **The crop pan fix must not change `rect()` output for existing zoomed states** —
  `cropPhoto` maps preview→source coordinates; only the *pan input conversion* changes.
- **`promote.py` invocation passes `--catalogue hosting/next-static/catalogue.json`** — when
  the catalogue becomes v2, keep that path the published one and update `loadNames` parsing
  in the same change (it already tolerates both shapes).
- **Playwright browsers cannot check H.264 encode/playback** — WebCodecs evidence comes from
  the real-Chromium qualification step, as round 1 recorded.
- **Do not start the native desktop GPU matrix.** Still explicitly later work.

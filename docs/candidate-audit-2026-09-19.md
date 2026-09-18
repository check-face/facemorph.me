# Candidate audit — 19 September 2026

Comprehensive pass over the **current working tree** (`candidate/next-delivery-20260916` @
`7bb4e23` + in-flight edits), in the R2-12/R2-13 style: every claim verified against source,
and — new for this audit — the app **built locally** (`npm run build:next`, bundle
`app.d42bccbc02deb3a80a18.js`) and **visually audited at 390×844 and 1280×900** in Chromium.
The deployed site still serves the round-0 bundle (`23c1646`); nothing below reflects what a
tester sees at `next.facemorph.me` today, which is itself finding A-8.

---

## 1. Longmorph / figure-eight / ellipse spike — INCLUDED, and CI-verified

The operator asked whether the spike work made it in. It did, fully:

- All five kinds — `linear` (classic linear/longmorph), `pairwise-ellipse`,
  `pairwise-figure8`, `full-smooth-ellipse`, `full-smooth-figure8` — are implemented in
  `src/Next/geometry/latent-path.mjs`; the kind set and closed-full-smooth rule match the
  runtime contract exactly.
- `pairwise-figure8` is the shipped default (`Product.fs` init), and the five modes are
  exposed in More options.
- `next-site.yml:28` runs `src/Next/geometry/verify.mjs`, which cross-checks the production
  path against the **independently executed reviewed spike** (`shape-explorer.html` run in a
  VM, planar fixtures so its surrogate J is the true 512-D rotation) across 2/3/5-face rings ×
  both modes × pinch × two widths × nine samples per segment including the seam and midpoint.
  `release-tests/verify-npoint.cjs` additionally proves hit=0, seam C¹ velocity continuity,
  pinched midpoint's positive chord velocity, alternating figure-eight sides, and periodicity.
- The multi-face "longmorph" shape is reachable as closed `linear` with N controls, and
  full-smooth modes accept N-face closed loops.

**Gap (A-6):** CI drives only the *default* kind through real synthesis and MP4
(`next-e2e-browser.py` never touches the shape select). The other four kinds have geometric
proof but no end-to-end inference/export evidence. Cheap fix: parametrise the e2e morph stage
over `kind` and run it for all five in rotation.

## 2. Round-1 leftovers — re-verified: all landed since the 17 Sept status check

The "Status check — 17 September" inside round-1 feedback is now stale. Current tree:

| Item | State |
|---|---|
| C-01 bounded kernel | **Landed** — `fused-resample-v1.mjs` has zero `continue`; `valid=…&&clamp(qy,1u,1026u)` + masked padding |
| C-02 route visibility | Landed (`route-admitted`/`route-rejected`, caption + refusal naming) |
| C-03 canaries | **Landed** — cold path pays exactly one canary before the first face; rest finish in background, `qualificationPending` partials retry |
| C-04 threads | Landed (`cpuThreads()` in ort-worker and the WebGL prefix stage); encoder stream deliberately stays single-threaded (measured no-diff, commit `0f80b7a`) |
| C-05 double hashing | **Landed** — `verifiedAt` markers; consumption re-verify removed from the hot path |
| C-06 frame store | Store + writer support landed; **product wiring missing → R2-13** |
| C-08 measurement | Landed — bench/product parity harness in `next-e2e.yml`; route/provider surfaced |
| C-09 reporting client | Landed — consent owns the run, `keepalive` terminal event (with a documented reason sendBeacon can't be used: the consent header), `visibilitychange` flush |
| C-10 status text | Landed — 38 labels; `fallback-cpu`, `model-loaded`, `original-cache-invalid` all speak |
| C-11 video encode | Landed — WebCodecs probe + correctness check, ffmpeg fallback (`probeVideoEncoder`) |

Round 1's constraint — "the benched winner must be what the product runs" — is satisfied in
source. It is **not** satisfied in the world until the tree is promoted (A-8).

## 3. R2 items — re-verified deltas

| Item | Delta since written |
|---|---|
| R2-1 delete button inline | Stands; note the remove control is a faint "—" (see A-3) |
| R2-2 names | **Partially superseded by the 19 Sept decision** — fullscreen `/names` route in-app, no separate deployment; catalogue stays light, latents on demand |
| R2-3 per-face generate | **First half fixed in-tree** — `faceReady` gives text/seed faces the button too (`Product.fs:531`), with a `PendingFaces` queue so picks during a job run after it. **Eager e4e still missing** (verified: no `encodePhoto` on selection) |
| R2-4 slider-first | Stands; the writer's indexed `add()` makes infill order a small change |
| R2-5 add-face placement | Stands, **and the operator has now confirmed: keep the + between each face AND after.** Audit findings A-1/A-2 are where that decision is currently violated |
| R2-6 consistency | Stands; visual pass added detail (A-4, A-5) |
| R2-8 accent ban | **Visually confirmed** on the built app: the For-testing box's grey left-accent on a rounded card is exactly the banned element |
| R2-12 crop pan | Stands (verified in `crop-view.mjs`; ~9.4× slow on 12 MP) |
| R2-13 frames + estimates | Stands (writer call still lacks `framesKey`; `remaining()` still fed done-counts) |

## 4. New findings — visual + UX pass (built app, both breakpoints)

**A-1 — On desktop with two faces (the most common layout) there is no + anywhere.**
`.next-morph-content.n2 .next-connector-stack { display:none }` hides the only connector the
n2 path renders, so at ≥1000 px the sole add-face affordance is the "Add face" text button
*sitting in the middle column between the faces* — the exact spot the operator said should
have nothing. Violates the confirmed "+ between each face AND after". Fix: render a closing
connector after the to-face in the n2 grid (new grid cell under/right of `to`), and move
"Add face" out of the middle column per R2-5.

**A-2 — In n3 desktop the trailing + is off-screen.** The row scrolls (`overflow-x:auto`,
5 connectors for 4 faces — before each and after the last), but the closing + sits beyond the
right clip edge; with scroll-snap the last face snaps centre, so "add after" requires a
deliberate scroll with no hint. Fix: end-of-row affordance that peeks (partial tile width) or
auto-reveals; the between-face + are fine and confirmed wanted.

**A-3 — Remove reads as a stray dash.** The control is MUI `removeIcon` (a minus glyph) at
`opacity:.25`, revealed on hover/focus-within (`product-ux.scss`). On desktop it looks like
layout noise; on touch there is no hover, so removal is near-invisible until tapped. Fix:
outline `delete`-style icon, keep the tooltip/aria, consider `opacity:.55` resting state on
coarse pointers.

**A-4 — Names dialog failure UX is broken three ways** (observed live by serving a fresh
build without `catalogue.json`, which the deployment pipeline adds but `build:next` doesn't
copy — worth fixing for local parity):
1. The grid renders empty with **"Show more"** offered for zero names;
2. no loading or empty state inside the dialog — it just looks broken;
3. the failure message ("The name gallery is unavailable…") renders in the **global status
   line behind the overlay**, nowhere near where the user is looking.
The 19 Sept names-route decision dissolves most of this, but the pattern (dialog-local
loading/empty/error states, never global status for dialog failures) applies to the crop
dialog too.

**A-5 — More options: the label duplicates the select.** "Length: standard" appears twice —
once as the field label, once as the selected option (`lengthLabel` fed to both). Same
pattern possible for shape. Restyle (R2-6) should drop the duplicated text and use plain
nouns: "Shape", "Length".

**A-6 — Rhythm/empty-state issues on the main surface (both breakpoints):**
the morph-slot action rows wrap unevenly on mobile ("Add face" strands alone on row 2); a
large empty gap separates the slot from the floating "Export project / Open project" row,
which sits before the FAQ with a disabled Export and nothing to export; on desktop n2 the
middle column is a floating button stack with an empty video area. Fix direction: results
area (video/slider/export/project) exists in the DOM only when there is something to show;
Export/Open belong with the results, not the FAQ; per R2-5 the add-face leaves the middle
column, which then holds only Create morph + status + progress.

**A-7 — e2e covers neither the shape select, the slider, N>2 flows, nor names browsing.**
The required "complete connected workflows" gate currently proves: seed determinism, route
rejection, original reuse, photo e4e, local crop, project reopen, default-kind morph → MP4.
Missing against the plan's own workflow list: all four non-default morph kinds (§1 gap),
Use Slider end-to-end (blocked on R2-13), add-face → 3+ face morph through the actual
buttons, and the names browse → pick → face flow. Each is a small stage in
`next-e2e-browser.py`; together they close the largest evidence gap this audit found.

**A-8 — Everything above is invisible to testers until promotion.** Live = `23c1646`; the
tree has since landed the round-1 closers (C-01/C-03/C-05/C-09/C-10/C-11), per-face generate,
the pending-face queue, the fallback invariant (`4363203`), and every fix this audit asks
for will land on top. First action of the build round: promote the tree through the existing
gates.

## 5. Original ideas (offered, not committed)

1. **Filmstrip identity for long morphs.** The n3 row already reads as a path. Number the
   stops (small badges "1…N" on the tiles) and let the slider echo them — scrubbing shows
   "between 2 and 3". Long chains stop being a pile of identical squares.
2. **Endpoint-first slider.** R2-4's slider doesn't have to wait for the midpoint: paint it
   immediately with the two endpoints as an A|B split, cross-fade toward the true frame as
   infill lands. The "instant morph" feeling starts at frame 0, not frame 1.
3. **Pinch-zoom the crop.** The crop already has zoom/rotate/pan maths that is DOM-free; two
   pointers (and trackpad pinch) map naturally onto `zoomTo` around the pinch centroid. On
   phones this is the gesture people will try first, and today it does nothing.
4. **Face of the day.** The right-hand default is already today's date; extend the idea — a
   "today" name/seed surfaced in the names grid (date-hashed) gives returning visitors a
   daily reason to look, for one line of code.
5. **Frame strip as progress.** After R2-13, the morph's frames exist as a persisted strip;
   showing the strip growing under the bar during generation (thumbnails filling left to
   right in infill order — endpoints first) makes the speed feel literal: you watch the morph
   being built.
6. **Long-press face menu** (mobile) / right-click (desktop): regenerate · duplicate ·
   remove. Cheap once per-face actions exist; earns its keep on 8-face chains where tile
   action rows get cramped.

## 6. Build-round order implied by this audit

1. Promote the current tree (A-8) — everything else lands faster after that.
2. R2-13 (frames wired + estimates) — unblocks R2-4 and A-7's slider stage.
3. R2-4 (infill order + live slider + autoplay) + R2-12 (crop pan) — the two felt-experience bugs.
4. R2-3 eager e4e; R2-5/6/10 restyles with A-1..A-6 folded in; R2-8 accent purge; R2-9 FAQ row.
5. Names route (19 Sept decision) + catalogue v2 + Triton API fill + R2-7 latent tests.
6. A-7 e2e stages as each behavior lands; R2-11 guidance copy last (needs the final surfaces).

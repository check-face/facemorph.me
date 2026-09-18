# Testing round 2 — twelve items, sense-checked against the working tree

Raised **18 September 2026**, after the round-1 work landed on
`candidate/next-delivery-20260916` (`364c2d4`…`084d698`). Every "current behaviour" below was
re-verified in the working tree on 18 September, not taken from a commit message.

**Deployment lag worth knowing before reading:** `next.facemorph.me` still serves the
round-0 bundle (`23c1646`, `app.364167e48daf4f9ae92b.js`). Everything from `364c2d4` on —
per-face Generate, the connectors, More options, the For-testing area, the frame store,
WebCodecs — exists only in the tree. Several items below were presumably written against the
newer UI; when testing on the live URL, testers are seeing the older one. First build of this
round should promote the current tree before UX verdicts are re-collected.

Verdicts: **DONE IN TREE** / **PARTIAL** / **MISSING** / **CONFLICT**.

---

## R2-1 — Delete button flows inline · DONE IN TREE (verify visually after deploy)

The remove control is an icon button (`Remove` → `Product.fs:278`, rendered at `:516-519`)
inside `.next-face-actions`, the same flex row as "Share image" / "Save image"
(`.next-actions` = `display:flex; flex-wrap:wrap; gap:.65rem`; buttons dropped to
`.8rem` inside face tiles, `product-ux.scss`). It is gated to `Inputs.Length>1`, disabled
while busy, has `aria-label` "Remove {label}" and a tooltip.

At the 400px tile width the three controls measure comfortably inside one line; `flex-wrap`
is the fallback, not the norm. Nothing to build here. **Do:** add one visual gate at 320–390 px
to the e2e (actions row height stays one row) so a future copy change cannot wrap it, and
promote the tree so testers actually see this row.

## R2-2 — Names replacement · PARTIAL — decisions resolved 18 September

**Resolved by the operator:** the live site is `names.facemorph.me`; there is no
`names.dilger.dev`. **Refined 19 September:** the names experience becomes a **fullscreen
`/names` route/component inside the candidate** — same artifact, no separate
`next.names.facemorph.me` deployment, no in-app browse modal. Classic's iframe embed
(`BrowseFacesDialog.fs`) was only the Svelte workaround; a native route gets direct state
(targets any nth face, reopens per additional name) and works unchanged in the Tauri desktop
skeleton. `names.facemorph.me` stays live untouched and redirects to `/names` at cutover;
parity is verified by the required baseline capture/compare, applied to the rebuild.

**The rule change that unlocks this:** historic full-size lossy WebP/JPEG are now explicitly
publishable and servable as **the same face** — compression variation is within tolerance, and
the working "good enough" standard from this Triton work is the correctness bar for served
images (recorded 18 September in the delivery plan, closeout, and inference learnings;
byte-exact preservation still governs the archive itself).

**What is stored where:** the actual 200px images the names site always served stay the grid
picks (all 5,055 exist, 36.5 MB); full-size versions (historic lossy where they exist — 2,911
names) are stored beside them with per-name metadata: identity (SHA-256 of the lowercase
name), SHA-256s, provenance (historic vs API-generated), and **latents** (derivable
deterministically: hash → seed → z → mapping → W; no Triton Mongo archaeology needed).
**Catalogue shape (19 September):** `catalogue.json` stays light — name, identity, 200px and
full-size URLs only. Per-name W latents are served on demand from
`catalogue/latent/<identity>` and fetched when a pick lands; inlining all 5,055 would add
~47 MB of base64 to a file the grid loads up front.

**Sizes the UX needs — figured out:** `200` (grid thumb) + best-available full size, target
`1024` (tile display, morph endpoint frames, video endpoint point). Nothing else: slider and
intermediate frames synthesise on-device from the latents, and the video's endpoint frames may
use the exact stored image for that point, as the operator approved.

**Generation shortfall:** only the 2,144 names with no full-size anywhere (18 Sep re-probe:
only 200–512px variants exist for them; two of seven sampled have just the 200px). The
operator authorises filling exactly these **on Triton via the public API** —
`GET /api/face/?value=<lowercase name>&dim=1024`, ~2.1k requests, well within what that API
shrugs at — then identity-verify every result (SHA-256 must match the lowercase-name identity;
verify dimensions), export from the cache, publish. **No regeneration of the existing 2,911 or
the 200px gallery** — those bytes are kept as-is. Full-lot regeneration is explicitly not
needed.

**Do:** build the fullscreen `/names` route in the candidate (grid, click-select, nth-face
targeting, reopen-per-additional-name); build the v2 catalogue (name + identity + 200px/full
URLs) with per-name latent endpoints; fill the 2,144 via the API with verification; publish
to the gallery host; wire the product's three-tier lookup (preview → full-size cache → device
generation) with automatic materialisation on selection; capture the live names baseline and
compare the rebuild against it.

## R2-3 — Generate one face; eager e4e · PARTIAL

**Able to generate just one face:** yes for photos and for regenerating anything already
generated — `RunFace` (`Product.fs:283`) posts `action:'face'` and `product-bridge`
synthesises only that face. **Gap:** the per-face Generate button renders only when a face
already has an image or the input is a photo with a file (`Product.fs:509`). A freshly typed
name/seed has no per-face control, so *first* generation of a single face still requires the
global "Generate faces". **Do:** show the per-face Generate for any non-empty input (text,
seed, photo).

**Eager e4e:** missing. Photo selection/crop-accept only records the file
(`Photo`/`Cropped` handlers); encoding waits for Generate. **Do:** the moment a photo is
accepted (crop accepted or small-enough file selected), start alignment + e4e for that face
automatically, with the per-face progress bar active and a visible caption ("Encoding your
photo…"), cancellable; when it lands the face simply appears. The plumbing is all there —
`encodePhoto` is the same call `action:'face'` makes, and `recordFace` already times it, so
estimates stay honest. Guard: don't auto-start while another job runs (queue it, as photo-drop
already queues).

## R2-4 — Slider-first morph, infill order, video last · MISSING — but the foundations just landed

Current tree, verified:

- Frames are generated **strictly in path order 0→N** (`product-bridge.mjs:156`), each fed to
  the video writer as it is produced; the slider only becomes available after the whole job
  completes, and only if "Use Slider" is ticked (`Completed` handler, `Product.fs:347`).
- The writer itself is ready for better: `videoWriter.add(blob, index)` accepts an explicit
  frame index out of order (`media.mjs:128-131`), pipelining/backpressure is internal, and every
  frame is already persisted to the morph-frame store with a display derivative
  (`media.mjs:139`, `morph-frames.mjs`). WebCodecs with correctness probe and ffmpeg fallback
  is in (`media.mjs:probeVideoEncoder`).

So the requested experience is mostly composition, not new machinery:

- **Order:** endpoints first (they are the two face tiles, already rendered), then midpoint,
  then quarter points, binary-infill until the lot is done. Add an infill iteration order over
  `createLatentPath` frames; pass the real index to `writer.add`.
- **Slider during generation:** render the slider from the frame store as frames land — the
  store already accepts out-of-order writes and `totalFrames` lets a partial morph be refused
  only for export/restore, not for scrubbing what exists. Show "N of M frames generated"
  alongside; the slider thumb starts at the midpoint once it exists (classic's slider opened at
  the middle frame).
- **Video after:** `writer.finish()` already only runs after the last frame. **Decided 18
  September:** feed frames to the (hardware) encoder as they are generated while the user
  scrubs the slider — the MP4 is ready moments after the last frame instead of starting a
  second wait. The user-visible sequence is exactly what was asked for (slider first, video
  when done); only the internal encoding overlaps.
- **Classic UI hints to copy:** the "Use Slider" checkbox beside the video
  (`MorphForm.fs:328`), download links under the video (classic had "Download GIF"), and
  autoplay: classic's video is `autoPlay + muted + loop` with the from-face poster
  (`MorphForm.fs:296-314`). The candidate video has `loop` + controls + poster but **no
  autoplay/mute** — add both so the completed morph animates exactly like the old site.

## R2-5 — Add-face placement + time estimate · PARTIAL

Placement. Today there are two affordances: an "Add face" text button **inside the morph slot**
(`Product.fs:586`) — which on desktop N=2 sits in the middle grid column, literally between the
faces — plus dashed-line "plus" connectors before/between/after every tile
(`tilesWithConnectors`, `Product.fs:536-541`; D-08 "the only plus on the surface"). The
requirement overrides this design decision: **mobile = one Add-face button after both faces;
desktop = to the right of the last face** (the N≥3 row already scrolls horizontally at ≥1000 px,
so a trailing add tile at the end of the scroll is natural). **Deviation to resolve:** mid-sequence
insertion (connector between faces) is genuinely useful for long series; keep it as the quiet
dashed affordance and move the *primary* Add-face to the end/right, or drop mid-insertion
entirely — operator's call, default proposal is keep-connectors-quiet, move-the-button.

Estimate. Exists and is honest: measured medians of the last 8 face/frame times
(`product-bridge.mjs:measuredFaceMs/measuredFrameMs`), predictions via `estimate.mjs`, the
"on this device" paragraph renders only once a measurement exists (`Product.fs:742-749`). Eager
e4e (R2-3) feeds the same median, so after the first photo encodes, the estimate covers morph
generation. **Do:** surface the per-face estimate next to Add-face once a measurement exists
("each extra face adds about N to the morph"), matching U-12's measured-not-guessed rule.

**The connector question, in plain terms (the one item still needing an answer):** today the
candidate draws small "+" buttons on dashed lines *between* every pair of faces, not just at
the end. With three faces — A, B, C — tapping the "+" between A and B inserts a new face so
the morph runs A → new → B → C. The question was only: now that the main Add-face button moves
to the end of the row (mobile) or right of the last face (desktop) as you asked, should those
small mid-sequence "+" insertion points **stay** (useful for long chains: slot a face into the
middle without rebuilding) or **go** (cleaner; every addition happens at the end)?

**Resolved 18 September: keep them, small and quiet.** The connectors remain the mid-sequence
insertion affordance; the primary Add-face button still moves to the end (mobile) / right of
the last face (desktop) per this item, and the button currently sitting in the desktop
middle-column morph slot goes with it.

## R2-6 — Consistency of the new elements · PARTIAL

- **"For testing" area** (`Product.fs:700`): it is already after the FAQ in the DOM, but it is
  its own accent-bordered box (see R2-8/R2-10). Restyle into the explain/FAQ language — same
  box, same heading scale, FAQ-style rows — with the processing-mode select kept exactly as
  keyboard-operable as it is now (e2e selects CPU through it).
- **More options** (`Product.fs:583-585`, `overflow` at `:559`): currently two bare native
  selects. Requirement is best-practice design using original elements: classic is MUI
  throughout — use MUI `FormControl`/`Select` (or classic-styled labelled controls) for Morph
  shape and Length, same overflow toggle. The internal names (width/pinch/frames-per-segment)
  are already gone from the surface; keep it that way.
- **"Generate faces" behind a flag:** supported — per-face generation covers the need once
  R2-3 lands. Keep `Run "faces"` wired but render the button only under a feature flag
  (query/build flag), placed after/under both faces, never between them.
- **"The name gallery is unavailable…"** (`product-bridge.mjs:214`): goes away as a
  user-visible sentence once the names catalogue is served reliably (R2-2). Keep a *failure*
  path, but it should degrade to the typed-input flow with quieter copy; the catalogued
  experience is the default, not an error state.
- **Names experience identical to the original — resolved 18 September, refined 19 September:**
  the requirement binds the names experience itself, rebuilt as a **fullscreen `/names` route
  inside the candidate** (near-identical: grid of the 5,055 name faces on the same 200px
  images, click-to-select, same CSS/labels/links), with the two necessary modifications:
  (a) "morph between them" targets the candidate's own state — including a targeted nth face
  when the sequence already has faces, which is why the route reopens for each additional
  pick; (b) the catalogue/morph plumbing points at the new cache. The in-app Browse-names
  modal goes; `names.facemorph.me` stays live until cutover, then redirects to `/names`.
  Parity gate: baseline capture/compare of the live grid against the rebuild.

## R2-7 — Latent metadata retrieval + saving under CI/test · MISSING (new work with R2-2)

What exists today: project-file W+ latent export/open is exercised by `fresh-review.test.mjs`
and the e2e project-reopen step; the morph-frame store has its own contract tests. What does
not: anything about *names-catalogue* latent metadata, because the v2 catalogue doesn't exist
yet. **Do, when building R2-2:** (a) retrieval — for a name, derive its latent offline and
byte-match against an independent fixed reference (the same discipline as the synthesis
fixtures); (b) saving — catalogue/project JSON round-trip with latent metadata embedded,
canonical bytes unchanged, and a checksum over the metadata block; (c) wire both into
`next-e2e.yml` next to the existing project-reopen check so promotion refuses an unverified
catalogue.

## R2-8 — Never the two-radii accent element · CONFLICT — currently used in six places

The element in the image is a rounded card with a thick coloured left border (the border picks
up the card radius at each end — the double-radius artifact). It is a live pattern, not a
hypothetical one:

| Where | Rule |
|---|---|
| `.next-slow-warning`, `.next-slow-route`, `.next-error` | `border-left:4px solid #d08a1e` on rounded `.box` |
| `.next-invite` | same, blue `#2f7dd1` |
| `.next-debug` | same, grey |
| classic review page `.chapter-banner` / `.compute-status` | `border-left:5px/3px solid #ec792b` (`style.scss:236,246`) |

**Rule adopted:** no coloured left-accent borders on rounded cards anywhere in the product.
Restyle all of the above as plain `.box` or FAQ-style sections; emphasis comes from the
existing heading/button vocabulary. This rule also resolves most of R2-6's styling items.

## R2-9 — FAQ: local on-device generation copy · PARTIAL (additive)

The page copy already carries the load-bearing lines ("All of it runs here, on your device.
Your photos and words are never uploaded.", `Product.fs:672`, plus the model-download note at
`:669`). Required addition: one more FAQ row — in the same voice, near-identical structure —
covering how local generation is handled: models download once and are cached on the device;
generation runs on the phone/computer itself, offline-capable after the first load; nothing is
uploaded; a device without graphics acceleration still finishes, just slower, and estimates say
so. Sweep the remaining rows for arch consistency (they already are — the classic FAQ was
carried over deliberately in U-13) — **no wholesale rewrite**; adjust only sentences that
assert server-era behaviour, keeping the Aussie tone ("Short version: nobody really knows."
stays).

## R2-10 — "For testing" integration · PARTIAL

Position is already right (immediately after the FAQ, `Product.fs:809-810`). What remains is
R2-6's restyle plus naturalness: heading as a peer of the FAQ's "Questions" (`Html.h3` inside
the explain box rather than a foreign box), the processing-mode control and the reporting
checkbox presented like classic labelled controls, and the invite (testing-link banner)
reusing the same vocabulary. No accent borders (R2-8).

## R2-11 — Toasts, and device-honest guidance · CONFLICT — the desktop nudge fires on desktops

There are no pop-up toasts; guidance is inline status lines and boxes. Two real defects:

1. **The slow-device box tells desktop users to get a desktop.** `isSlowDevice`
   (`Product.fs:183`) is true whenever the route is CPU or a face took >20 s — on a desktop
   whose GPU route was rejected, the box then says "A laptop or desktop with a graphics card —
   or the desktop app — is dramatically quicker" (`Product.fs:762-766`) and links desktop
   builds. **Do:** guidance depends on what the device actually is and has: phone/tablet
   without a qualified GPU route → suggest trying a computer with a graphics card for long
   morphs (and say the job still finishes here); desktop that rejected its GPU route → name
   that (the route caption already does) and suggest enabling hardware acceleration / the
   desktop app only if the integrated GPU differs; already-on-desktop → never recommend
   moving to desktop. The honest capability data is already in the product (`route-admitted`,
   `route-rejected`, `navigator.gpu`), so this is copy selection, not new plumbing.
2. **Notice delivery is a single overwriteable status line.** Errors render in `.next-error`,
   but transient notices (save/share results, diagnostics status) share one `Status` string
   that each event overwrites — round 1 documented the same failure for report references.
   **Do:** a small MUI Snackbar (classic's own component vocabulary) for transient
   confirmations, styled per R2-8, with persistent facts (report references) staying
   selectable in place. Nothing critical becomes toast-only.

## R2-12 — Crop panning is ~10× slower than the finger on big photos · CONFLICT — verified arithmetic bug

**Operator report (Samsung, ~12 MP photo):** panning the crop is not 1:1; it takes many swipes
to move the crop window across the relevant region.

**Cause, verified in `photo/crop-view.mjs`:** `pan()` treats pointer deltas as *preview*
pixels — `offset -= dx/zoom`. But the pointer reports *screen* pixels over a 320 px viewport
(`Product.fs` `CropPan`, `cropFrame crop.view 320.`), while the preview it moves is the
bounded decode from `crop.mjs` — `PREVIEW_MAX_EDGE=4096`, so a 12 MP 4000×3000 photo is **not
downscaled at all** and its min side (`side`) is 3000 preview px.

The on-screen distance the image moves per finger pixel works out to `320/side`, independent
of zoom (the `zoom` in `pan` cancels against the `zoom` inside `frame`'s factor). At
side = 3000: **the image tracks the finger at ~0.107× — about 9.4× too slow.** Crossing the
pannable range at zoom 1 (±500 preview px horizontally) costs ~9,300 px of finger travel —
dozens of swipes — where 1:1 would cost ~1,000. Exactly the report. The keyboard arrows
(`CropPan` steps of 10/40 px in `Product.fs`) suffer the same conversion error.

**Fix:** convert screen → preview pixels at the display scale. `pan` needs the viewport it is
rendered into: `offset -= dx × (side/state.zoom)/viewport` (equivalently multiply today's
value by `side/viewport`). Carry `viewport` in the crop state from `createCrop` so the maths
stays DOM-free, and apply the same conversion to the arrow-key steps. Existing `pan` tests
feed huge deltas and assert only clamping, so they still pass; add one that pins the 1:1
contract — render `frame(state,v)`, pan by one viewport-width, and assert the image translated
by exactly one viewport-width on screen (before the fix it moves `320/side` of that, e.g.
~0.11 viewport on a 12 MP photo).

**Acceptance:** on a ≥12 MP photo, dragging the crop image moves it 1:1 with the finger at
zoom 1 and stays finger-locked (content under the finger stays under it) while zoomed; arrow
keys step a meaningful distance (one viewport-width per press is fine). Same check on a small
photo (side ≈ viewport) where behaviour is already correct and must not regress.

---

## Sense-check summary

| # | Item | Verdict |
|---|---|---|
| 1 | Delete button inline | Done in tree; add 320 px visual gate; deploy |
| 2 | Names replacement | Fullscreen `/names` route inside the candidate (no separate deployment); keep 200px grid + historic lossy full-size (2,911); fill missing 2,144 via Triton API; latents served per-name — resolved 18–19 Sep |
| 3 | Single-face generate + eager e4e | Per-face exists (gap: first-time text faces); eager e4e missing |
| 4 | Slider-first, infill, video-last | Missing; writer/store already support out-of-order indexed frames; hidden encode approved |
| 5 | Add-face placement + estimate | Button moves to end (mobile) / right (desktop); mid-insert connectors stay small — resolved 18 Sep; estimate exists from measurement |
| 6 | UI consistency | Restyles + feature flag + names as in-app fullscreen `/names` route (no modal, no separate site) |
| 7 | Latent metadata CI | New work alongside the v2 catalogue |
| 8 | Two-radii accent ban | Currently in six places; ban + restyle |
| 9 | FAQ local-generation copy | Additive one-row change, tone preserved |
| 10 | For-testing integration | Position right, restyle into FAQ language |
| 11 | Toasts + honest guidance | Desktop nudge fires on desktops; status line overwriteable |
| 12 | Crop pan 1:1 | Verified bug: pan divides by zoom but ignores preview/viewport scale — ~9× too slow on 12 MP photos |

**Operator decisions — all resolved 18–19 September:** names experience is a fullscreen
`/names` route/component inside the candidate — no separate `next.names.facemorph.me`
deployment, no modal, direct state for nth-face targeting; `names.facemorph.me` redirects to
`/names` at cutover; lossy full-size publishable as the same face, missing 2,144 fillable via
the Triton public API (no full regeneration); video encode runs hidden while scrubbing
(R2-4); mid-sequence insertion connectors stay, small and quiet (R2-5); catalogue stays light
with per-name latents on demand. No open questions remain — the runway is clear to build.

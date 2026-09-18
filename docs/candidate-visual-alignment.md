# Making the candidate feel like FaceMorph

> Acceptance gates for this plan are in the [work order](round-1-work-order.md).

Design plan for U-10 / U-15 in [testing round 1 feedback](testing-feedback-round-1.md).
Compared **17 September 2026**: `https://facemorph.me` against `https://next.facemorph.me`,
at 1800px and at 390×844 (iPhone-class). Screenshots in
[`review/next-delivery/style-delta/`](review/next-delivery/style-delta/).

## The diagnosis, in one line

**Both stylesheets are already loaded. The candidate picked the wrong one.**

`style.scss` imports Bulma at the top and the app wraps itself in `App.ThemedApp`, so every
page has Bulma *and* a configured Material UI theme available. Classic builds its
interactive surface out of MUI — `Mui.textField`, `Mui.button`, `Mui.menu`, `Mui.dialog`,
`Mui.slider` — and uses Bulma only for page scaffolding. The candidate builds its surface
out of raw Bulma utility classes: `.button`, `.box`, `.input`, `.select`,
`.notification is-warning`, plus a `<details>` and a bare `<progress>`.

That is the whole visual gap. It is not a redesign — it is a substitution, and the
components being substituted in are already in the project, already themed, and already
used by the page next door.

The second gap is informational, and it matters more than the first: **classic is a
gallery, the candidate is a form.**

## What actually carries the identity

Five things, and the candidate currently keeps only the first.

1. **The logo and wordmark.** Animated SVG logo plus `facemorph.me` at
   `clamp(2.5rem, 12vw, 4rem)` in Nunito 600. Identical in both. Keep.
2. **The faces are the page.** Classic shows two large generated faces on load, before any
   interaction, with the text fields reading as captions beneath them. The image is the
   hero and the controls are secondary.
3. **One Morph button, and it is alive.** `FancyButton` is a four-colour gradient —
   `#FFA63D → #FF3D77 → #338AFF → #3CF0C5` at `background-size: 800%`, animating over 10s.
   It is the single most characterful element on the site.
4. **Controls that get out of the way.** One outlined TextField per face with a floating
   label, centre-aligned text, and adornment icons that *fade in on hover or focus*
   (`.focuswithin-parent:not(:focus-within):not(:hover) .focuswithin-child{opacity:0}`).
   At rest the page is faces and words, not chrome.
5. **The explainer is on the page.** `Explain.view()` renders inline below the fold —
   "What is this?", how it works, the FAQ. The home page has a body, not just a tool.

## Measured delta

| | Classic | Candidate |
|---|---|---|
| Face image width @390 | **300px** | **157px** |
| Face grid @390 | one column, face at container width | `1fr 1fr` — two 177.8px columns (`style.scss:288`) |
| Faces visible on load | two, generated | none; two grey `+` placeholders |
| Controls per face | 1 TextField, 2 fade-in adornments | 3 (`<select>`, `<input>`, `Browse names`) |
| Primary action | one **MORPH**, animated gradient, between the faces | two flat `#ce621d` rectangles, below everything |
| Desktop layout | grid: `"from vid to" / "from morph to"` at ≥1000px | flat vertical stack |
| Headings on the main surface | "What is this?" at ~3rem Nunito | none |
| Explainer | inline on the page | behind a `Help ⓘ` toggle |
| Disclosure | MUI menus and dialogs | `<details>` with a raw `▶` triangle |

The 157px face on a phone is the finding that matters. On the device the operator actually
used, the candidate renders the product's entire output at **half** the size classic gives
it, to make room for a second column of form controls.

## The reuse contract

The core is the classic frontend, reused. This is not a rewrite that ends up looking
similar. Be explicit about which bucket each module is in:

| Module | Treatment |
|---|---|
| `src/FancyButton.fs` | **Verbatim.** The primary action, unchanged |
| `src/MorphForm.fs` → `SetpointInput`, `getInputConfig`, `setpointKindMenu` | **Verbatim.** Already handles text / seed / image modes, adornments, the mode menu |
| `src/MorphForm.fs` → `renderMorph` | **Verbatim** for video, poster and the `Use Slider` control |
| `src/SliderMorph.fs` | **Verbatim**, with `FrameSrc` pointed at the persisted display-size frame derivatives instead of `/api/morphframe/`. `NumFrames` comes from the morph rather than the classic constant 25 |
| `src/BrowseFacesDialog.fs`, `src/EncodeImageDialog.fs` | **Verbatim** as the dialog shell; contents change |
| `src/Share.fs` | **Verbatim** once U-15 restores URL state |
| `src/App.fs` → `header`, `footer`, `ThemedApp`, `createTheme` | **Verbatim** |
| `style.scss` `.morph-content` grid + its 750/900/1000 media queries | **Extended** — the N=2 case is the existing rule unchanged; N≥3 adds cases |
| `src/Next/Product.fs` | **Rewritten** against the above, keeping its state machine |
| Face tile empty/generating/error states, insertion connectors, per-face progress, crop dialog | **New**, in the same vocabulary |

If a piece of classic UI does the job, use it. Do not reimplement `SetpointInput` as a
lookalike.

## Layout specification

Three layouts. Which one applies is a function of face count and available width, never of
anything else.

**Base — any width where faces cannot sit side by side at full size.** This is the phone
layout and it is the default, not a fallback.

```
          facemorph.me

   ┌───────────────────────┐
   │                       │
   │        face A         │   full container width, >= 300px
   │                       │
   └───────────────────────┘
   [ Morph from         ▾ ]    <- SetpointInput, caption under the image

             (+)                <- insertion connector

   ┌───────────────────────┐
   │        face B         │
   └───────────────────────┘
   [ Morph to           ▾ ]

          ( M O R P H )

   ┌───────────────────────┐
   │        video          │
   └───────────────────────┘
   [x] Use Slider
   ═════════●═════════

   What is this?  ...explainer and FAQ inline...
```

**N = 2, >= 1000px — classic verbatim.** This is the existing `.morph-content` grid rule
(`"from vid to" / "from morph to"`), unchanged.

```
   ┌────────────┬──────────────┬────────────┐
   │            │    video     │            │
   │   face A   ├──────────────┤   face B   │
   │            │  ( MORPH )   │            │
   │ [ from  ▾ ]│              │[ to     ▾ ]│
   └────────────┴──────────────┴────────────┘
```

Before a morph exists the video cell collapses and MORPH sits centred between the faces,
which is what the live classic site does today.

**N >= 3, wide — result is the hero, faces are the path.**

```
              ┌──────────────┐
              │    video     │
              └──────────────┘
                ( MORPH )

   ╭─┐  (+)  ┌───┐  (+)  ┌───┐  (+)  ┌───┐  (+) ╭─╮
   │ │       │ B │       │ C │       │ D │          |
   ╰─┘       └───┘       └───┘       └───┘          |
   [fld]     [fld]       [fld]       [fld]          |
    A └───────────── closes back to A ──────────────┘
```

Faces stay at full size and the row scrolls horizontally with scroll-snap. **Faces never
shrink to fit more faces.** The closing connector is shown because every morph mode except
`linear` is a closed loop.

**The governing rule:** pick a minimum face edge (300px, classic's `imgDim`), let the
container decide how many fit at that size, and wrap or scroll when they do not. Face size
is a floor, never a function of face count. The candidate does the opposite today —
`grid-template-columns:1fr 1fr` at <=550px subdivides the viewport by face count, which is
why a face is 157px on a 390px phone against classic's 300px.

## Face tile states

Every state is specified. There are six.

| State | Image area | Caption area |
|---|---|---|
| **Empty** | Dashed border, image icon, "Drop a photo, or tap to choose". **Not a bare `+`** | `SetpointInput`, empty, placeholder "Just type anything" |
| **Cached** | The cached face, immediately on load, with a quiet "saved on this device" marker | The value that produced it |
| **Photo chosen, not yet encoded** | Bounded preview of the chosen photo, dimmed | Filename, with Crop and Replace available |
| **Working** | Previous image if any, dimmed; thin gradient progress bar across the bottom edge of the image | Field disabled; stage text beneath |
| **Generated** | The face at full size | The value, editable; Regenerate appears when the value no longer matches the image |
| **Failed** | Previous image if any; `Mui.alert` inline in the tile | Field enabled, inputs preserved |

The empty state matters: today's grey `+` collides with the `+` that means "add another
face". They must not look the same. The empty tile is a **photo drop target**; the insertion
connector is a `+`.

## Photo entry mechanics

All of these are required, and the first two already exist and must survive the restyle
(they are in the delivery scope: "Tile/+ click, touch and keyboard open the picker; dropping
a photo targets that tile").

| Mechanic | Behaviour |
|---|---|
| Click / tap the empty image area | Opens the photo picker for that face (`openPhotoPicker`) |
| Keyboard | The image area is a real `<button>`; Enter and Space open the picker |
| Drag onto a tile | Targets that face. The tile shows a drop outline; other tiles do not |
| Drag onto the page background | Fills the first empty face; if none are empty, appends a new face |
| Drop **multiple** files | Creates one face per file, appending as needed, in drop order. New capability, and the natural reading of "load images" |
| After selection | Alignment and e4e start immediately, no further click (U-03). The crop step appears only if alignment fails (U-08) |
| Replace | Same mechanics on a tile that already has a face |

## Adding a face

The current "Add face" button in a toolbar is wrong, and so was the ghost-tile suggestion it
replaced — a ghost `+` tile is indistinguishable from an empty face tile's `+`.

**Use insertion connectors.** A morph is a path through faces in visit order, so the
meaningful action is not "append" but "insert here". Between every adjacent pair — and at the
ends, and on the closing edge — put a thin connector with a `(+)` that expands on hover or
focus. Horizontal between tiles in a row; a horizontal rule with a centred `(+)` in the
vertical stack.

Why this is better:

- It matches the data model. The connector *is* the morph segment, and inserting a face
  subdivides that segment. Where you click determines where the face lands.
- It removes the `+` collision — connector `+` means "another face", tile content means
  "an image for this face".
- Appending stays available: the connector after the last face is the append case.
- It makes the closed loop legible, which nothing currently does.

Keep a plain "Add face" in the overflow for keyboard and screen-reader users who would
rather not hunt for a connector; the connectors are the primary affordance, not the only one.

## Where the new features go

The ask is "the same, but with more features", so every new capability should be spoken in
the existing vocabulary rather than introducing a new one.

| New capability | Expressed as |
|---|---|
| Per-face Generate (U-03) | a small `FancyButton` under that face's field — same gradient, `button.size.small` |
| Per-face progress (U-02) | a thin gradient bar across the bottom edge of the face image itself, using FancyButton's gradient as the fill. Not a separate global bar. Classic's own idiom for the global case is a `Mui.circularProgress` *inside* the Morph button — keep that for the morph |
| Route in use / rejected (C-10, in flight) | a quiet `Mui.typography` caption beneath the Morph button. Note the new `route-admitted` stage is not yet in the `labels` map, so it currently renders as "Working…" — the C-10 fix covers it |
| Crop step (U-08) | `Mui.dialog`, matching `EncodeImageDialog`, which classic already had for uploads |
| Browse names | already the right shape; restyle to `BrowseFacesDialog`, which classic already used for seed thumbnails |
| Slider / face merging (U-14) | classic's exact `Mui.slider` plus the `Use Slider` `Mui.formControlLabel` checkbox beneath the video |
| Morph shape | the mode-menu pattern — an icon button opening `Mui.menu` with a small diagram per shape, not a bare `<select>` |
| Advanced (U-09) | mostly deleted. Length and Shape move into the main row as real controls; Processing mode moves to the debug area next to the reporting checkbox, where a tester will look for it |
| Save / Share (U-06) | `Share.fs` already has the `Mui.speedDial` pattern. One action, per C-06 |
| Explainer and FAQ (U-13) | **back onto the page, below the fold**, as `Explain.view()` does today. This is a large part of feeling like the same site, and it is close to free |

## Decisions register

Decided. Do not improvise on these; if one looks wrong, raise it rather than changing it
silently.

| # | Decision | Why |
|---|---|---|
| D-01 | MUI owns everything a user clicks; Bulma keeps page scaffolding only | Classic already works this way; both are loaded |
| D-02 | The primary action is `FancyButton`, the animated gradient, verbatim | Most characterful element on the site |
| D-03 | Vertical stack is the base layout at every width; side-by-side is an enhancement | The phone layout is the most FaceMorph-feeling arrangement |
| D-04 | Face size is a floor (300px), never divided by face count | The 157px phone face is the single worst regression |
| D-05 | N=2 at >=1000px reproduces classic's grid exactly, as a special case | N=2 is the common case and the one people remember |
| D-06 | N>=3 scrolls horizontally at full size rather than shrinking | Follows from D-04 |
| D-07 | Empty tile is a photo drop target, not a `+` | Avoids collision with the insertion `+` |
| D-08 | Adding a face uses insertion connectors, not a toolbar button or ghost tile | Matches the path model; removes the `+` collision |
| D-09 | Tile click, keyboard and per-tile drag all open/target that face; page-level drag and multi-file drop are added | First two are existing scope; the rest is the "more features" half |
| D-10 | Three controls per face collapse into one `SetpointInput` with adornments | Classic's own idiom; buys back ~120px per face on a phone |
| D-11 | Explainer and FAQ return inline below the fold | Classic has a body, not just a tool |
| D-12 | The `FaceMorph Preview` / `Help` top bar is deleted | Classic has no such bar |
| D-13 | Processing mode leaves Advanced for the debug area, but stays keyboard-reachable | `next-e2e` selects CPU through it |
| D-14 | The design is the requirement; the component library is not a constraint. Upgrade MUI, or swap it, if the installed version cannot express something here | A library version must never silently downgrade the design |
| D-15 | Morph frames are **persisted** in their own IndexedDB store keyed by morph identity, not held in memory and not put in the originals store | The slider, reload survival and repeat-morph cache hits all depend on it; the originals store is keyed by a single face's latent |
| D-16 | The slider scrubs a display-size derivative; the 1024 PNG is kept for export | `SliderMorph` preloads every frame as an `<img>`; at 1024 that is ~4 MB decoded per frame |
| D-17 | The morph **shape** control (figure-eight / ellipse / linear) lives in the overflow, not the main surface | Operator, 17 Sep: most users do not need to tweak it, it is new, and it is advanced |
| D-18 | On the phone the video sits **after** the face stack, as classic does | Operator, 17 Sep |
| D-19 | A cache hit is silent and instant — no badge on the image. The existing `original-cache-hit` status line ("Loaded saved original") is the only acknowledgement | Operator, 17 Sep, emphasised instant. Nothing new to build |
| D-20 | Exported and shared media embeds the **latent**, on by default, no opt-out and no warning | Operator, 17 Sep: a determined recipient can recover a latent from the pixels anyway, so this adds speed, not exposure. Update the runtime contract text for consistency; mention it in the FAQ as a feature |
| D-21 | Metadata is written at **export**, never into the stored canonical original | Protects `imageSha256`, the byte-identical-repeat CI check, and the canonical-bytes contract |
| D-22 | Two cache key layers: latent for anything already generated or shared, aligned tensor for a fresh photo upload. Neither replaces the other | A latent is e4e's output, so it cannot skip e4e |

All three questions previously open here were answered by the operator on 17 September
and are now D-17, D-18 and D-19. The caching answer became a requirement in its own right —
see **U-04** in the [feedback document](testing-feedback-round-1.md).

## What not to bring back

- The retirement-notice overlay. Classic's own is visibly broken at 390px — the text
  overlaps the face and the dismiss button sits on top of the copy. Do not port that.
- `gtagEvent` analytics.
- Bulma's interactive classes. Keep Bulma for page scaffolding only, as classic does, and
  let MUI own anything a user clicks.

## Sequencing and effort

Layer 1 is a substitution pass over `Product.fs` plus deletions from `style.scss` — no new
components, no new dependencies, and it carries most of the perceived change. Layer 2 reuses
`SetpointInput` and `setpointKindMenu` as they stand. Layer 3 is one conditional plus the
existing media queries. Layer 4 is a media-query change and a derivative image.

The feedback document sequences this last, after the parity work, on the grounds that the
operator's complaint was speed rather than looks. Layers 1 and 4 are cheap enough and
visible enough that they are reasonable to pull forward if testers are going to see the
candidate again before the parity work lands — but that is the operator's call, and it does
not change the order of anything in Part 1.

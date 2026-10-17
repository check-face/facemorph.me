# Candidate audit, 18 October 2026: gaps, regressions and inconsistencies

What a full read of the `next.facemorph.me` candidate, the production classic app and `PLAN.md` found when
set against each other. The plan's own three operated defects (Remove, many faces, no bulk removal) are not
repeated here. This note holds the evidence behind the extra rows that `PLAN.md` now carries under
[known candidate defects](../../PLAN.md#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026).

## Method and limits

- **Candidate:** git `40c63a9` (live since 17 October 20:28 UTC). The plan was reviewed against `b2d945a`; the two
  commits in between change only a social preview image and the retention wording.
- **Source reads:** three independent read-only passes (candidate inventory, classic-versus-candidate comparison,
  plan extraction), then spot checks of every claim used here against the code.
- **Operated:** headless Chromium 152 against the live site, a desktop 1,280 by 800 window and an iPhone 13
  emulation, real pointer and keyboard input, the CPU route (headless has no WebGPU), real model downloads
  (149 MB face model, 1,040 MB photo encoder), one complete two-face morph and one photo face.
- **Not covered:** physical phones, Safari, Firefox, WebGPU, a real camera photo, any browser but Chromium.
- **Evidence labels:** **Operated** = seen in the running app on 18 October. **Source** = read in the code, not
  run. A Source row is a lead for the port's tests, not a measured fact.

## 1. Classic to candidate: what a visitor lost or gained

"Plan" is what `PLAN.md` says about it today (after this audit's edits).

| Classic had | Candidate | Plan |
| --- | --- | --- |
| Text fields set to not capitalise (`autocapitalize=off`) | Missing (**Operated**: attribute present on live classic, absent on candidate). Text is hashed exactly, so a phone keyboard that capitalises "hello" gives a different face. | Was silent. Now a requirement (text field turns off capitalisation, correction and spell-check). |
| Any typed word shows its face at once (the server rendered it) | Only catalogue names, seeds 0 to 999 and the default `hello` have an instant picture. Anything else shows "Drop a photo, or tap to choose" until Generate (**Operated**: "banana"). | Consequence of retiring the API, accepted. The empty-tile wording for a typed word is now specified. |
| Enter starts the morph | Enter does nothing (**Source**) | Already required (Generate field rules). |
| Autoplaying, muted, looping result | Plain player, no autoplay (**Source**) | Silent. Operator question below. |
| Cropper: square stencil, head and eye guide, rotation slider with degree readout, coaching copy | Different, simpler crop: drag, zoom 1 to 8, 90 degree rotate, no guide (**Source**) | Restored from the locked reference images. |
| Cropper: wheel and pinch zoom, crop square may extend past the photo edge | Neither (**Source**) | Silent. Operator question below. |
| "Look straight forward at the camera" tip before upload | Gone (**Source**) | Silent. Operator question below. |
| Paste an image | Gone (**Source**) | Planned addition. |
| Photo that could not be aligned could still be accepted with a warning | Refused (**Source**) | Plan allows optional manual crop and explicit continue, better than either. |
| Slider starts at the exact 50/50 blend of two faces | Slider walks a closed loop (A to B and back), default path is a figure eight, so it is not a plain blend unless Shape is "Classic linear" (**Source**) | "Carry forward supported controls". Operator question below. |
| Result file named "from to to.mp4", Web Share also carries the page link | Every file is `facemorph.mp4` or `facemorph.webp` (**Operated**) | Filename choice planned; links retired. |
| Copy link, Facebook, WhatsApp, Twitter, Reddit, link previews, per-morph page title, `?from_value=...` links, back and forward, `/retirement` page | None of them | **Retired by the operator.** One open point: text and seed links need no server, see the operator question below. |
| Light and dark theme by system setting | Kept | Silent. One line added. |
| Names: an iframe of the standalone names site | In-page dialog with a search box over 5,055 names, Show more and Close (**Operated**) | Accepted design drops search, header, Close and Show more for an edge-to-edge grid with a floating Back on touch. A decision, recorded here so the loss of search is a choice. |
| Browse and Change mode reachable with the Tab key | Not reachable (**Operated**: Tab order skips "Change mode", "Browse names" and the empty-tile photo button) | Plan already says "Tab reaches menus and actions"; the defect itself is now recorded. |
| Two faces only | 2 to 64 faces, insert anywhere, per-face Remove, drag and drop, saved-file recovery, per-face Save and Share | New. |

## 2. Candidate defects beyond the plan's first three

Numbering continues the plan's list (1 to 3 are in the plan).

| # | Defect | Evidence | The port must |
| --- | --- | --- | --- |
| 4 | Keyboard users cannot open the mode menu, the names browser or the file picker. Those buttons have `tabIndex=-1`. | **Operated** (Tab order, live). **Source** `Product.fs:820,826,859,898`. | Reach every control with Tab in visual order. |
| 5 | A phone keyboard changes the typed words (capitalises) because the text field lacks `autocapitalize=off`. Names fill lowercase; typing "Charlotte" gives a different face from the picked "charlotte". | **Operated** (attribute on live classic versus candidate, iPhone emulation). **Source** `identity.mjs` hashes the raw string. | Turn off capitalisation, correction and spell-check on the field. |
| 6 | The same word in both faces fails with "This project is invalid or uses an unsupported format." The same happens for A, B, A (the closed loop makes the last face a neighbour of the first). The clear geometry message is never reached. | **Operated** (hello and hello). **Source** `Contracts.fs:75-78`, `product-bridge.mjs:108,224`. | Say plainly that neighbouring faces must differ, before any work starts. |
| 7 | With one face left, "Add face" is disabled while the note beside it says "Add a second face to create a morph". The "+" connectors still work. | **Operated.** **Source** `Product.fs:1030-1033`. | Keep Add face enabled until the cap. |
| 8 | A typed word with no instant picture leaves the tile saying "Drop a photo, or tap to choose", although the person typed words. | **Operated** (desktop and iPhone emulation). | Say "Press Generate to make this face" for a typed word, keep the photo entry in the menu. |
| 9 | After reload the faces return but the words are gone: the field shows a disabled "Restored face". The code omits input text on purpose. | **Operated.** **Source** `last-result.mjs` comment "Deliberately omit source files, input strings". | Planner's proposal (veto-able): keep the typed words or seed with the session, since they stay on the device with the pictures. |
| 10 | Download sizes disagree: the toast says 149 MB, 1.1 GB and 1.2 GB, the progress line says 158 MB and 1,040 MB. | **Operated.** | Show one figure per purpose with one unit, the same in toast, dialog and progress. |
| 11 | The FAQ says nothing leaves the device but two things do. Typing a seed requests one picture per partial number (389 asks for 3, 38 and 389) from a `workers.dev` host. A Cloudflare analytics beacon loads on every visit. The 3.4 MB name list is fetched on the first keystroke. | **Operated** (network capture of the seed and the beacon). **Source** `public-previews.mjs:162-168`. | Make the privacy text complete, send nothing per keystroke, and name every outside request. |
| 12 | The failure toast's "Send report" turns standing reporting on for good, while the error box's near-identical "Send this report" sends once. | **Source** `Product.fs:738`. | Keep a one-off send one-off, and say so on the button. |
| 13 | Reports for photo selection are rejected by the collector (it accepts actions `faces`, `morph`, `project`; the client sends `photo`). One bad event rejects the whole batch. | **Source** `validation.mjs:13`, `reporting.mjs:275`, `worker.mjs:24-27`. The 801 mined reports contain no `photo` action, which fits but does not prove it. | Make client and collector share one list, with a test that fails if they differ. |
| 14 | Names dialog in the candidate: label and Close text are near-black on near-black (contrast 1.18 to 1, title 2.0 to 1), so the only visible dismissal is effectively invisible. A failing name list leaves an empty dialog (the error sits behind it). | **Operated** (measured colours). **Source** `Product.fs:717`. | Keep names over the images readable on any face (4.5 to 1 against a scrim or shadow), follow the accepted exit (floating Back on touch, Escape and browser Back elsewhere) and show a failed list's error inside the dialog. |
| 15 | Offline with models cached: a new face fails with "The local generation engine stopped." Every job re-fetches the model manifest with no cache. | **Operated** (once, one profile). **Source** `product-bridge.mjs:111`. | State what works offline; a job whose files are all cached should not need the network (proposal). |
| 16 | First visit shows two stacked bottom toasts. At 1,280 by 800 the first covers "Create morph" (the element at its centre is the toast); on a phone it fills a third of the screen. | **Operated** (hit test, screenshot). | No prompt may cover an action; only one prompt at a time. |
| 17 | Stale-work bugs: removing a face that is generating does not stop the job; dropping a saved MP4 can leave "Morph queued" stuck until reload and replaces every face with no confirmation; picking a replacement photo destroys the current face before the new photo is validated; cancelling a queued re-generate can leave a broken image. | **Source** `Product.fs:579,444-448,473-474,589-592`, `product-bridge.mjs:230,440`. | Cover each in the stale-completion acceptance. |
| 18 | The 64-face cap is enforced in one of three places: "+" silently does nothing, multi-file drop is uncapped and a 65-face morph fails with the generic project error. | **Source** `Product.fs:573,564,957-960`. | One cap, one plain message, every entry path. |
| 19 | The video-fallback download (32 MB) is not part of any consent, and the download gate lets work start when the size list cannot be built. | **Source** `model-inventory.mjs:5-8`, `Product.fs:365`. | Treat unknown size as "ask"; include the fallback codec in the consent. |
| 20 | Small copy and display bugs: "about 1 seconds", "smaller than25 MB" (missing spaces in three messages), seed placeholder "Just type anything", the cold-device estimate text can never appear, disabled "Create morph" looks enabled, the crop panel has no opaque background in light mode. | **Source** (several need a render to confirm). | Fix with the owning controls. |
| 21 | The licence and notices page is published but linked from nowhere, and misstates where the video codec is served from. | **Source** `stage.py:33`, `P.fs:1457-1466`. | Link it from Help and the footer; keep it true. |
| 22 | Nothing shows or clears what is stored on the device. The faces store has no ceiling. | **Source** `originals.mjs`, `model-cache.mjs:4`. | Planner's proposal (veto-able): a line in Help with the size and a Clear button. |
| 23 | The "Preview" faces for names look like generated faces, only a screen-reader label says otherwise. | **Source** `Product.fs:890-894`. | Already decided: no badge. Noted so it is a choice, not an oversight. |

Not reproduced: a legacy Universal Analytics tag that the code suggests loads on every visit. A page load in
headless Chromium made no request to Google; the only outside request was the Cloudflare beacon above.

## 3. Statements in the plan that disagreed with the candidate

| Plan said | The candidate does | Fix made |
| --- | --- | --- |
| "Today the candidate has only Save image and Save video" | Share image, Save image, Share morph and Save video all exist (**Operated**). | Corrected in the export-flow bullet. |
| Keep Auto, CPU and WebGPU "in the selector above the first +" (six places) | The only selector is inside More options, then Advanced, and also lists WebGL (**Operated**; same at the plan's reviewed commit). The control above the first + does not exist. | Reworded as a move, not a retention. |
| The candidate delays large downloads until crop confirmation | For one clear face the encoder consent dialog appears straight away and no crop step happens (**Operated**; the crop offer for large photos is unreachable, **Source** `photo-selection.mjs:44-58`). | Noted; the planned always-confirm-first flow is a real change. |
| The candidate still says "Deleted after 30 days" | Fixed and live since 17 October. | Stale wording corrected. |

## 4. Plan inconsistencies and ownership gaps

Found by the plan extraction and re-read before use. "Fixed" means fixed in `PLAN.md` on 18 October.

| Finding | Status |
| --- | --- |
| One control named "Prepare photo models" and "Prepare encoder" | Fixed: "Prepare encoder" everywhere. |
| Promotion step assigned to model hosting in one place and to deploy re-homing in four | Fixed: deploy re-homing owns it. |
| Research evaluator marked terminal but verified-cache warming needs it | Fixed in the workstream rows. |
| Physical-iPhone measurement required, yet no physical-phone pass may gate anything | Fixed: reworded as evidence to record, with the browser-reported quota as the floor. |
| Many-face removal bar ("twenty of thirty in twenty actions") equals the broken candidate | Fixed: bar now tests what is new. |
| Many-face widths differ from the responsiveness sweep | Fixed: uses the sweep. |
| Flow-matrix freeze cites a register that lives only in a dated history entry | Fixed: points at the live sections and the defect ledger. |
| Experiment history "stays in classic" versus "moves here" | Fixed: Git history only. |
| Retention fix described as pending and as done | Fixed. |
| Remove repair has no owner | Fixed: joins the early candidate edits the delivery action owns. |
| Help copy for export, session and interruption limits, Firefox storage prompt timing, modal Escape and Back rules, source-pixel retention, detector download gating, accessibility as a whole have no single owner | Open: each still spans several workstreams. |
| A stated name-casing rule versus a lowercase catalogue | Open: consistent only if displayed names are shown lowercase or the picker fills lowercase (it does). |
| Feeds cells missing edges that Needs cells have (nine of them) | Open, harmless by the plan's rule that Needs wins; recheck when the graph is parsed for real. |

## 5. Decisions only the operator can make

1. **Old text and seed links.** The operator retired old GUID, photo and share links. Links such as
   `?from_value=hello&to_value=world` need no server and could still open the same two faces. Honour them, or show
   a short notice, or let them open an empty page as the candidate does today?
2. **Result playback.** Classic autoplayed the video muted in a loop; the candidate waits for a click. Autoplay?
3. **Blend of two faces.** Keep a plain 50/50 blend as an easy path (the old slider), or leave it to Shape "Classic linear"?
4. **Cropper extras.** Wheel and pinch zoom, a crop square that may extend past the photo, and the pre-upload
   posing tip. Include them?
5. **Planner proposals awaiting a veto:** keep typed words across reload (9), a stored-data line with Clear (22),
   cached jobs need no network (15), Undo and Start over (18 October earlier).

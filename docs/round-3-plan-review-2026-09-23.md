# Round 3 plan review: contradictions, broken flows and weak contracts

Written **23 September 2026** as the next plan iteration after the
[round-2 work order](round-2-work-order.md) and the
[19 September audit](candidate-audit-2026-09-19.md).

**What was checked:**
- The governing plans (`AGENTS.md`, `migration_plan.md`, `web_checkface_delivery_plan.md`,
  `delivery_closeout_2026-09-16.md`, `side_by_side_trial_plan.md`, `trial-status.json`).
- The candidate docs in `facemorph.me/docs/`: current scope, round 1 and round 2 feedback and work
  orders, audit, visual alignment, runtime contract, device lab and asset cache.
- The code on `candidate/next-delivery-20260916` at `ddc72b3`. This covers `Product.fs`,
  `product-bridge.mjs`, `reporting.mjs`, `media.mjs`, `identity.mjs` and `promote.py`, the e2e and
  artifact harnesses, and all ten workflows.
- Read-only HTTP checks of `next.facemorph.me`, the gallery origin and the GitHub API.

**What was not done:** no build, test run or deployment was performed for this review. Every
"verified" below comes from reading source at `ddc72b3` or from a live HTTP response on
23 September. Items marked *inferred* follow from the code but were not reproduced in a browser.

**How to use it:** each item has an ID (`R3-nn`), a type, the evidence, what is wrong, a **spec**
(the required behaviour) and a **gate** (what a test or person can observe). Items marked
**Decision** need the operator before they can be built. Everything else can be built now. The
round-2 rule still applies: *a gate tests the user-visible behaviour, not the component it depends
on.*

Severity:
- **P0**: blocks the re-test handoff, produces a wrong result or false evidence, or breaks a
  privacy promise.
- **P1**: fix in this iteration.
- **P2**: schedule it, but it does not block re-test.

---

## Operator direction, 23 September (second pass), and what changed in the tree

The operator reviewed the first pass. These answers are binding for iteration 3 and supersede the
matching recommendations further down.

### Decided

- **Public repository and home runner are accepted** (closes R3-07 as a risk decision). The
  documentation fix in R3-43 still stands. TrueNAS's role widens: it should also run a **native
  desktop GPU lane** (below), not only the browser WebGPU benchmark.
- **The public trial is not the focus.** Keep dates honest, but do not let trial bookkeeping lead
  the work (R3-01 drops to P2).
- **Diagnostics:** fix consent recording. Reporting is **on by default in labs**. During the trial
  phase, which is now and continues for a while after the move to the real facemorph.me, ask every
  first-time visitor once, in a toast. **Done in tree** (see below).
- **Defaults stay.** `hello` and today's date remain, so a visitor has something to try at once.
  Nudging towards uploading a photo is welcome (R3-20 amended below).
- **Desktop:** interim public artifacts via a rolling nightly are acceptable before a real release.
  Every target desktop environment needs a guaranteed GPU route, and the persistence features must
  hold there too (see the desktop section below).
- **`--discard-after` is too blunt.** Replace it with a cleanup and dedupe policy (R3-28 amended below).

### Keeping the date honest (live, 23 September)

The live classic site still says, in its banner and on `/retirement`, that the API retires on
**October 25, 2026 (AEST)**. That is **32 days away**, and no public comparison has started. The
banner also says ***"Hugging Face is still the leading candidate while we keep testing
options"***, which has been untrue since 14 September, when HF was excluded from the
architecture.

The HF sentence is a factual error on the live site and should be corrected first. The date is
the operator's call, but as published it now promises something that preservation and
comparison gates will not allow. Either confirm it with a statement of what happens that day,
or publish "target under review".

Both are live changes to classic and are **not** made by this document.

### Done in the tree today (uncommitted, not deployed)

| Change | Where | Verified |
|---|---|---|
| **Consent is recorded.** The stored choice is `{choice, basis, at, policy}` instead of `'on'`. A "no" is stored, so the question is asked once. Every report carries `consent` = how its sender agreed: `checkbox`, `invite`, `toast`, `labs-default`, `legacy` or `once` | `reporting.mjs` | New unit tests |
| **"Send this report" means send this report.** The error box's button sends the staged failure once, under a throwaway session with no device id, and leaves reporting off. It used to switch on standing consent | `reporting.mjs` `sendOnce`, `Product.fs` `SendReportOnce` | Unit test |
| **Withdrawal really withdraws.** It clears the undelivered batch, its `sessionStorage` mirror and the device id (R3-14) | `reporting.mjs` `withdraw` | Unit test: re-enabling sends nothing from before the withdrawal |
| **Labs is on by default.** On a `labs.` origin with no stored answer, reporting starts on, announced, and a stored "no" is respected. Note: `labs.facemorph.me` currently serves the separate *device lab*, which already records runs automatically. This makes the product behave the same if it is served there | `reporting.mjs` `restore` | Unit test |
| **First-visit trial toast.** A MUI Snackbar in the classic dark palette, bottom centre, with **Turn on**, **No thanks** and **Ask me later (×)**. Clicking elsewhere is not an answer. It is not shown on the `?testing` invitation (which has its own panel) or on labs. `trialPhase` in `Product.fs` turns the question off without touching the For-testing control | `Product.fs`, `product-ux.scss` | Real Chrome at 1280 and 390 px: shown on first visit; "No thanks" stored and not re-asked after reload; "Turn on" stores `basis:"toast"` and ticks the For-testing checkbox |
| **Collector accepts the new field and future origins.** `consent` is a closed enum, pinned by a test against the client's list. Allowed origins now include `https://facemorph.me` and `https://labs.facemorph.me` ahead of the move | `validation.mjs`, `worker.mjs`, `worker.test.mjs` | Unit tests |
| **Latent crash fixed.** The light theme's `background.default` was the colour name `"white"`. MUI's colour maths (`emphasize`, used by Snackbar and others) throws on names, which blanked the whole app under a light OS scheme the moment a Snackbar mounted. It is now `"#fff"`, which renders the same | `App.fs:354` | Real Chrome: blank page before, renders after |
| **The catalogue is part of the artifact** (R3-21). `build:next` copies the tracked `catalogue.json` into `deploy-next`, so it is in SHA256SUMS, served by the qualification server and scanned. `promote.py` refuses a `--catalogue` that differs from the built one and records its hash in the receipt. The no-third-party gate now checks the gallery origin against an explicit list, where the `workers.dev` origin is named as temporary until U-18 moves it | `build-next.cjs`, `promote.py`, `check-no-third-party.mjs` | Leased `build:next`: the catalogue is present and byte-identical, the gate passes |

Checks run on the tree:
- The full `next-site.yml` unit list on Node 22: **213 pass, 0 fail**.
- Fable compile, `check-bridge-imports`, `verify-fable` (44 checks) and `check-progress-copy`.
- Geometry verify.
- `build:next` under the device lease.

Local Node 18 fails the collector tests on `crypto` before and after this change (8 failures on
`ddc72b3` too). CI uses 22.

**Not yet done in this area:** the "What's sent" preview for Send this report, and removing the
device id altogether. The id is kept but disclosed in the invite copy and now deleted on
withdrawal. Removing it is still open under R3-02 if the operator wants no cross-run grouping at
all.

### The progress-line CI gate, in plain terms (R3-03)

Three instructions each describe the one status line under Create morph, and they cannot all be
true at once:

1. **21 September (your release gate, enforced by `check-progress-copy.mjs`):** while a morph
   renders, the line reads exactly `Generating X / Y images` and nothing else. The word
   "Encoding" is banned. The script checks this by matching the source text, including the
   literal expression `frame.index+1` for X.
2. **19 September (R2-13, estimates):** the line should read "Generating frame k of M — about X
   per frame, about Y remaining", and during the video step "Encoding — about Z remaining".
   That uses the banned word and adds text to the line.
3. **18 September (R2-4, slider-first):** frames should be generated endpoints first, then the
   midpoint, then quarter points, and so on. With that order `frame.index+1` jumps 1, 26, 13,
   7… so the "counter" goes backwards, and the gate *requires* that jumpy expression.

**Resolution to adopt (no new decision needed unless you disagree):**
- The line is a **count of finished frames**, always increasing, whatever order frames are made
  in.
- Estimates live on the **separate line beneath it** (`.next-remaining`), which the gate
  explicitly allows.
- During the video step the count stays at `Y / Y` and the estimate line says "Finishing your
  video — about Z remaining". The word "Encoding" stays banned.
- `check-progress-copy.mjs` becomes a behavioural test: it feeds an out-of-order frame sequence
  through `progress()` and asserts that the rendered count never decreases and that nothing else
  reaches the line.

All three instructions are then satisfied.

### Projects, history and "everything just persists": the recommended experience

**What a "project" is today:** a JSON file holding each face's W+ latent (about 36 KB per face),
the morph settings (shape, length, pinch) and the model and noise checksums. It contains **no
images, no video, no photos and no typed words**. Reopening it re-synthesises each face from its
latent. Nothing about it is "historical": it describes one morph. It is hidden (21 Sep) and, as
you say, a user would not expect to need it. They expect their work to still be there.

**Principle:** continuity is automatic. Export is only for **moving** work to another device or
keeping a backup. The product never asks anyone to "save" in order to keep something.

**What is kept on the device, and why it is cheap:**

| Layer | Size | Kept | Regenerable? |
|---|---|---|---|
| Latents + settings for every face and morph ever made (the "library index") | about 36 KB per face | Always. It is the whole history in a few MB | No for photo faces: the latent **is** the photo's result, and the photo itself is never stored. Yes for names and seeds |
| Full-size 1024 originals (PNG) | about 1.4 MB each | Within a storage budget, most recent first | Yes, from the latent (synthesis only, no e4e) |
| Morph videos (MP4) | 1 to 3 MB each | Within budget | Yes, from the frames or by re-rendering |
| Morph frames (slider) | 36 to 90 MB per morph | Recent morphs only; evicted first | Yes, by re-rendering |
| Source photos | n/a | **Never** | n/a. Only the aligned-tensor key that lets a re-upload skip e4e |

So even a device that evicts every image still has its **whole history as latents**. Any old
face or morph can come back at synthesis cost, without the original photo. That is the answer
to "we should be storing the older images on device": store the latents always, and the images
opportunistically.

**What the visitor sees:**

1. **Reload and nothing is lost** (U-05). The page opens with the faces, settings and last morph
   exactly as they were. This alone removes the main reason projects existed.
2. **A Library** (`/library`, a fullscreen route in the same idiom as `/names`, reached from a
   small "Your faces" link by the face row):
   - **Faces:** every face made on this device, newest first, with thumbnail, source (name,
     seed or photo) and date. Tap to put it into a face slot, whether that is the current one,
     a new one, or "morph to". A photo face comes back with no photo and no encoding.
   - **Morphs:** every morph, with poster, face strip, shape and length. Tap to reopen the whole
     morph: its faces, settings and video, with the slider instant if its frames are still here
     or re-rendered on demand if not.
   - Per item: **Share**, **Save**, **Delete**.
   - A storage line: "Using 212 MB on this device · Free up space", which drops frames first,
     then full-size images, and never latents without an explicit "Delete everything".
3. **Move to another device** replaces "Export project". The name is agreed (operator,
   23 September). **What goes in the file is still open.** The operator wants to think
   through what it means for images and videos to come along before choosing. See the options
   below.
4. **Sharing is unchanged:** an image or MP4 with its latent embedded (U-16), so a recipient can
   drop it in and morph from it.

**Copy for users** (FAQ row, R2-9 voice):

> **Where are my faces kept?** On this device, in your browser. Everything you make stays here
> across visits: faces, morphs and videos. Your photos never leave your device and aren't kept
> at all; we keep the face we made from them, as a small list of numbers, so you can use it
> again without the photo. If your browser runs short of space it may clear the big images;
> the faces themselves can always be rebuilt. To move your work to another phone or computer,
> use **Move to another device** in Your faces.

**One honest caveat:** Safari can clear site storage after seven days without a visit unless
persistent storage is granted, and private windows keep nothing. The Library should say so when
`navigator.storage.persisted()` is false, which the product already records.

**Gates:**
- Reload restores the session with zero inference (the old C-06p / U-05 gate).
- The Library lists every face and morph made on the device after a reload.
- Reopening an evicted morph re-renders frames with zero alignment and zero encoding.
- A "Move to another device" round trip between two profiles reproduces byte-identical faces.
- The file contains no JPEG/HEIC signature and no typed text.

#### Open: what "Move to another device" carries (options, not chosen)

Fixed in every option: photos never go in; typed text never goes in; importing adds to the
other device's library rather than replacing it; the file is one `.facemorph` zip with a JSON
manifest.

| Option | Contents | Typical size (20 faces, 5 morphs) | What the receiving device experiences | Risks and costs |
|---|---|---|---|---|
| **A. Recipe only** | Latents + settings | about 1 MB | Everything appears in the Library at once as placeholders. Images and videos regenerate as they are opened, which needs the models (about 200 MB) and synthesis time. A phone may take minutes for a long morph | Smallest and fastest to move (fits in a message). The first open on a slow device is slow. It feels like "it didn't bring my stuff" until the pictures fill in |
| **B. Recipe + videos** | A + the MP4s | 5 to 20 MB | Morphs play at once. Faces regenerate on open | Videos are the costly thing to rebuild, so this saves the most waiting per MB. Face thumbnails are still missing until generated |
| **C. Recipe + videos + full-size images** | B + the 1024 PNGs | 30 to 60 MB | Everything is visible and usable at once, even before models download. Works offline at the destination | Big for email and chat. Must respect the destination's storage budget on import. Duplicates what a synthesis could rebuild |
| **D. Recipe + small previews** | A + about 256 px JPEG thumbnails | 2 to 4 MB | The Library looks complete at once. Full size and video are made when opened | Preview quality is lower until regeneration. A new derivative format to maintain |
| **E. Ask at export** | A default of A, B or D, with checkboxes for videos and full-size images, showing the size live | Varies | The sender chooses | One more decision for the user. Needs sensible defaults and plain copy ("Include videos · 14 MB") |

Questions that decide it:
- Do people move work mainly to *keep* it (so C is a backup) or to *continue* it (so A or D is
  enough)?
- Is the typical destination a phone (where D or B avoids long regeneration) or a desktop
  (where A is fine)?
- Should a moved morph be byte-identical on arrival (B or C), or is "same face, rebuilt"
  acceptable (A)? Synthesis is deterministic per route, so rebuilt images match within the
  qualified tolerance.

`projectFilesVisible` stays off until this is chosen.

### Defaults and nudging towards photos (R3-20 amended)

Keep `hello` and today's date. The fix is to make them **show faces on arrival**:
- Run the cache-first lookup at load (originals store, then the hosted collection). Otherwise
  one Generate each.
- Make the empty *photo* affordance an invitation rather than the default tile state. A text face
  with no image shows a quiet text-face placeholder with its Generate button, never "Drop a
  photo".
- The photo nudge lives in the connector/add area and the mode menu as **"Try your own photo"**,
  with a line under the first generated pair: "Morph yourself: drop a photo onto either face.
  It never leaves your device."

`hello` is not in the hosted names set. Either publish it (a single seed-generated image,
eligible under the provenance rules) or accept one generated face on first visit. Publishing it
is recommended; it is the most-seen face on the site.

### Desktop: interim artifacts, release machinery, GPU and persistence parity

**Testing the GitHub Releases machinery without spamming releases:**
- **Draft releases** are invisible to the public, exercise the same create, upload and asset APIs
  and the same token permissions, and can be deleted afterwards. Use them in CI to test the
  machinery on every relevant change: create the draft, upload, download it back and checksum,
  then delete.
- **One rolling `nightly` prerelease** is the public interim artifact. It is a single tag,
  force-moved to the promoted commit, with its assets replaced (`gh release upload --clobber`).
  It is marked *prerelease*, so it is never "Latest". The notes name the source sha, the
  qualification run and the words "unsigned development build". There is only ever one, so
  nothing piles up.
- **Versioned prereleases** (`v0.x.0-preview.N`) are cut only at handoffs.
- **Updater testing** stays inside CI: build N and N+1, install N, point it at an updater feed
  served from the job, and assert it updates and keeps its library. No public release is needed
  for that.

**"Some GPU will be used on every target desktop environment":** state it as an engineering
guarantee over a declared matrix, not a promise about unknown hardware. The shape:

| OS | GPU vendors | Candidate native route (to be qualified) | Hardware we have for CI |
|---|---|---|---|
| macOS arm64 | Apple | ONNX Runtime CoreML EP, or WebGPU-native (Metal) | The operator's M1 Pro (local lane) |
| Linux x64 | NVIDIA | CUDA EP | **TrueNAS GTX 1050** (self-hosted, has Vulkan in its container) and triton GTX 1080 |
| Linux x64 | AMD / Intel | Vulkan through a native WebGPU implementation (Dawn), ROCm/OpenVINO where faster | None today; needs a tester or hardware |
| Windows x64/arm64 | Any DirectX 12 GPU | DirectML EP (vendor-neutral) | None today; hosted Windows runners have no GPU |

The most promising way to "guarantee *some* GPU everywhere" is one **vendor-neutral** native
route: DirectML on Windows, plus a Dawn/WebGPU-native route on Linux and macOS that reuses the
WGSL kernels already qualified in the browser. Vendor-specific EPs then sit on top where they are
measurably faster. This is a candidate for autoresearch to qualify, not a verified capability.

The admission rules stay the same: canaries on the native route, the named route on screen, and
never a silent CPU fall back.

**TrueNAS native lane:** install the actual Linux desktop package (`.deb`/AppImage) on the
self-hosted runner, disable browser GPU, and drive the installed app through the
`desktop-product.yml` harness. Assert:
- `provider = native-gpu`, with the adapter name recorded
- the six workflow checks
- **the persistence features:**
  - relaunch restores the session with zero inference
  - a repeat face is a cache hit
  - a repeat morph is encode-only
  - the Library survives an N→N+1 update

That is how "the features we develop persist there too" becomes a gate rather than a hope. The
same list runs on the Mac lane, and on Windows once a GPU machine exists.

### What `promote.py` is, and how it relates to autoresearch

Two separate jobs meet at one rule:
- **autoresearch** climbs: it tries kernel, runtime and pipeline variants on real devices,
  measures them against fixed correctness references, and records each variant in
  `autoresearch/results.tsv` with a status. `keep` means it won on correctness and speed.
- **`promote.py`** ships: it takes one CI build, checks that the same bytes passed the real
  browser workflows, checks the model runtime matches what was qualified, and only then uploads
  to Cloudflare, leaving a receipt.

The link between them was added after round 1's C-01: the product had shipped the *old* kernel
while the research had already found a faster, more correct one. So `promote.py` refuses a
runtime whose kernel has no `keep` row in the research ledger. It is a guarantee that **what ships
is something research actually measured and approved**. It is not yet a guarantee of *speed*.

**What would make it a performance guarantee** (recommended):
- The runtime manifest names its research candidate.
- The ledger row carries that candidate's measured numbers per device class.
- The GPU lane (fixed per R3-35 to benchmark the commit, not the live site) produces the same
  metric for the build being promoted.
- `promote.py` refuses when the measured number on the reference machine is worse than the
  ledger's by more than a stated tolerance (for example 15%, the round-1 parity bound).

Research keeps climbing freely. Promotion only admits a build that keeps up with where research
has got to. The ledger check also has to stop failing open (R3-28): today it silently skips when
`../autoresearch` is not on the machine.

### Local storage: replace `--discard-after` with retention and dedupe (R3-28 amended)

Measured on 23 September:
- The workspace holds **37 GiB**, and the Mac has **16 GiB free**.
- The largest areas are `autoresearch/` 10 GiB, `review-artifacts/` 7.3 GiB (2.6 GiB of it
  `device-lab-deploy`), `hosting/next-static/public` 3.7 GiB, `experiment/` 2.4 GiB,
  `hf-trial/` 1.9 GiB, `.runtime-mirror` 1.8 GiB and `preserved-inference/` 1.5 GiB.
- Among files over 20 MB, about **5.5 GiB are same-size copies in separate inodes**: almost
  certainly the same model weights copied into several experiment and deploy trees. Hashes are
  needed to confirm.

Promotion work directories are already small because staging hard-links the runtime. The disk
goes to research and deploy copies, not receipts.

**Policy:**
1. **Receipts are never deleted.** `promote.py` writes the receipt to a tracked path
   (`docs/review/next-delivery/receipts/<source>.json`) before any cleanup.
2. **One content-addressed store for big immutable files.** Model weights, runtime chunks and
   ffmpeg live in `~/.cache/facemorph/blobs/<sha256>`. Every tree that needs one gets an APFS
   clone (`cp -c`) or a hard link, never a copy. `stage.py` already hard-links; extend the same
   rule to the runtime mirror, experiment trees and review-artifacts.
3. **A `scripts/artifact-gc.py`, dry-run by default.** It hashes files over 20 MB, reports
   duplicate groups and reclaimable bytes, and with `--apply` replaces duplicates with clones. It
   deletes work directories older than N days *except* receipts, reports, JSON evidence and
   anything a tracked receipt references, and deletes `hosting/next-static/public*` staging
   directories other than the newest two. It never touches `autoresearch/results.tsv`, `keep`
   candidates or preserved-inference.
4. `--discard-after` becomes `--keep-receipt-only`: delete the heavy staged tree, keep
   `promotion.json`, `qualification/report.json` and `web-receipt.json`.

### Other regressions worth naming

- **Warm loads re-verify every model on every visit.** This is likely the "persistent loading
  would be way quicker on desktop" gap. Since 19 September (R2-15 cache repair),
  `model-cache.mjs` keeps its "verified" mark **in memory only**. Every new session therefore
  streams each asset it opens through the JavaScript SHA-256, then reads it a second time to use
  it. That covers 124 MB of synthesis weights plus mapping and noise on every visit, and about
  1.2 GB more on the first photo of each session. The bytes are cached; the product just does
  not trust its cache between visits.

  The durable marker was removed because it had vouched for corrupted bytes on iOS and Android.
  The right fix keeps that safety without the cost:
  - (a) On devices with memory to spare, hash with native `crypto.subtle.digest` over one buffer.
    This is several times faster than the JS hasher, and the buffer is needed for the ORT session
    anyway.
  - (b) Keep the streaming JS hash only on memory-constrained devices.
  - (c) Consider a durable marker bound to something that changes when the entry does, such as
    the entry's size plus a sampled hash of the first and last 1 MB, with the full hash re-run
    only when that does not match or when a canary fails. Canaries already catch numerically
    corrupt models before any face is shown.

  **Gate:** a second visit on desktop Chrome with a warm cache reaches the first face with zero
  full-asset JS hashes (instrumented as in C-05), and the corrupt-cache-repair suite still passes
  7/7 on the iOS and Android lanes.
- **Queueing** (R3-10, R3-11, R3-12) is confirmed in code, as you noted. These three are P0 for
  iteration 3.

### Third pass, 23 September: ready to direct users

| Change | Where | State |
|---|---|---|
| **Progress line resolution adopted (R3-03 done).** The line counts finished frames, `Generating X / Y images`, and never decreases in any generation order. An encode-only repeat no longer claims to be generating. `check-progress-copy.mjs` is now a behavioural test: it drives the counter through path order, binary infill (26 and 64 frames) and repeats | `stage-labels.mjs` (`createFrameCounter`), `product-bridge.mjs`, `scripts/check-progress-copy.mjs`, `stage-labels.test.mjs` | Passing |
| **GitHub labels.** `next.facemorph.me` (already existed; now coloured and described), `facemorph.me` and `api`. At cutover, `next.facemorph.me` issues are relabelled `facemorph.me` | `check-face/facemorph.me` labels | Live on GitHub |
| **Issue form.** `.github/ISSUE_TEMPLATE/next-facemorph.yml` applies the `next.facemorph.me` label for anyone and prefills version, device, processing route and report reference. GitHub reads issue forms **only from the default branch**, so until this file is on `master` the link falls back to a blank issue with the same details in the body, and `labels=` applies only for maintainers | Candidate branch | Needs to land on `master` |
| **Experimental strip.** A full-width dark strip above the logo on every page: "Experimental preview of the next facemorph.me. Everything runs on your device." Links: **Classic facemorph.me**, **Its server is retiring** (`/retirement`) and **Report an issue** (prefilled). It cannot be dismissed but takes one line on desktop and three on a 360 px phone, with 30 px tap targets and no horizontal scroll | `Product.fs`, `product-ux.scss` | Checked in Chrome at 1280, 390 and 360 px |
| **Footer.** "Found a problem? Report an issue" (prefilled), plus "Preview version `<sha>`". The build now embeds the real git revision (`GITHUB_SHA` in CI, `git rev-parse` locally, `+` when the tree is dirty) | `build-next.cjs`, `webpack.config.js`, `product-bridge.mjs` | Verified in the built bundle |
| **Bigger FAQ.** New rows: what next.facemorph.me is (with the classic link and the retirement page); does anything leave my device (download sizes, the honest reload caveat); why the first face is slow and whether it works on phones; what's in a debug report; how to report a problem. The explain line no longer mentions project export, and the photo answer names controls that actually exist | `Product.fs` | Built |
| **Classic-site proposal (different from next's strip).** The existing dismissible banner on facemorph.me gains "**Try the next facemorph.me.** It makes faces and morphs right on your phone or computer, with no server, so your photos never leave your device. It's an early preview: tell us what breaks.", a **Try the preview** button and the dismissal key bumped to `-v2`, so people who dismissed the old banner see it once. `/retirement` drops the Hugging Face and `testing.facemorph.me` claims and describes the on-device plan and the self-host API. The published **October 25, 2026** date is left as is (operator's call) | Worktree `.delivery-worktrees/classic-invite-next`, branch `proposal/classic-invite-next` off `origin/master`, **uncommitted, not pushed**. Fable compile passes | A PR would create a Vercel preview; a merge to `master` deploys production |
| **Harness safety.** The e2e harness's neutral click moved off `(400,20)`, which now lands in the strip | `scripts/next-e2e-browser.py` | Compiles |
| **AGENTS.md project map.** Surfaces (including labs and the gallery origin), the next pipeline, lanes, issue labels and the toolchain (Node 22, not the local Node 18) | Workspace `AGENTS.md` | Done |

### R3-48: persistent storage and model downloads (issue #28)

**Reported:** Firefox asked "Allow next.facemorph.me to store data in persistent storage?" on
page load. `warmUp()` called `navigator.storage.persist()` as the page settled (added in
`4dca022`).

**Built:** `storage-request.mjs` decides per engine.
- Gecko (Firefox desktop and Android), the only engine that shows a prompt, is never asked
  without an explanation. Its storage state is only *observed* (`persisted()`).
- Chromium and WebKit decide silently, so they are still asked at load.
- `keepModelsOnDevice()` in the bridge is the explained entry point for the UI below.

Verified in Playwright Firefox, Chromium and WebKit: `persist()` is called 0, 1 and 1 times on
load, and Firefox calls only `persisted()`.

**Persistence is not required for caching.** Cache Storage and IndexedDB work without it on
every engine. Persistence only changes what happens under **eviction**:
- storage pressure (low disk)
- Safari's policy of clearing script-writable storage for sites the user hasn't interacted with
  in 7 days of browser use. Home-screen web apps are exempt, and persistence helps there
- a user clearing site data (nothing protects against that)

It also does not raise quota in any way we depend on. Private windows get neither the quota
(1.06 GB measured) nor persistence.

| Way to keep models (and originals) cached | Prompts? | Protects against | Cost |
|---|---|---|---|
| Best-effort storage only (no request) | Never | Nothing beyond normal use; the cache stays until pressure or Safari's 7-day rule | Occasional silent re-download of 0.2 to 1.2 GB. Repair-on-miss already recovers |
| `persist()` silently where the engine never prompts (now) | No (Chromium decides from engagement; WebKit decides for itself) | Pressure eviction when granted | None. It may simply be denied |
| `persist()` from an explained control (proposed below) | Firefox only | Pressure eviction on Firefox too | One sentence of explanation and one click |
| `persist()` on load (was) | Firefox, with no context | As above | Issue #28: a permission ask before the user knows why |
| Install as a home-screen web app (manifest + service worker) | An install flow | Safari's 7-day rule, and the strongest browser durability | A manifest, a service worker, update handling. It must never blanket-delete caches (asset-cache contract) |
| Desktop app | Install | All browser eviction; files live on disk | The native track (not this round) |

**Decided and built, 23 September (operator):**
- Nothing downloads until the visitor asks, for either model: the face model (158 MB CPU,
  212 MB WebGPU) or photo tools (about 1.1 GB). The idle prefetch and the photo-intent prefetch
  are gone.
- The model toast offers **Download** (face model) or **With photos** (both), each showing its
  size, plus **Not now**. It then shows determinate byte progress and "Ready".
- Ignoring the toast and pressing Generate or Create morph, or choosing a photo, opens
  **Download the face model?** or **Download photo tools?**. **Download and continue** records
  consent for that scope and runs the action; **Cancel** keeps the inputs.
- Either path requests persistence in the same click.
- A face-only download interrupted by a generation shows "Download paused" and resumes
  afterwards.
- The reporting toast waits until the model question is settled.
- CI harnesses auto-accept the dialog and record `downloadGateAccepted`.

Verified in an isolated headless Chrome against the qualification server:
- zero model requests on load
- toast progress 1 → 176 MB, then Ready
- no toast after reload
- Generate → dialog → face made, with no second dialog
- photo pick → 1.1 GB dialog → Cancel keeps the photo, and no encoder bytes are requested

Earlier proposal, kept for reference:
1. **A model toast** on first visit, and again on each visit until the models are downloaded
   and the storage question is settled (granted, denied or blocked-and-remembered). A browser
   that denies silently must not cause nagging: at most once per session, and never after an
   explicit "Not now" for 7 days.

   Copy: "FaceMorph makes faces on your device. It needs a 200 MB face model once (about 1 GB
   more for photos). **Download now** · Not now". **Download now** starts the download, calls
   `keepModelsOnDevice()` in the same click (on Firefox this is where the prompt appears, now
   explained), and turns the toast into a determinate progress bar ("84 of 212 MB") that ends
   with "Ready. Saved on this device."
2. **The fallback path:** if the toast was ignored, the first Generate, Create morph or photo
   pick that needs a network download opens a short dialog before starting:
   - what is downloaded and its size
   - that generation happens on this device
   - why the browser may ask about storage

   Choices: **Download and continue** (calls `keepModelsOnDevice()`) or **Cancel**. Cache hits
   and already-downloaded models skip the dialog.
3. **Only one toast at a time.** This toast goes first. The reporting question (trial phase)
   waits until the models are downloading or a first face exists, so a new visitor never sees
   two toasts.
4. **Download timing and the performance philosophy.** Today the route bundle (about 200 MB)
   prefetches silently at idle (respecting Save-Data). Two options, not chosen:
   - (a) Keep the silent prefetch, and make the toast honest about it: "Getting the face model
     ready… 84 of 212 MB" with **Keep on this device** and **Pause**.
   - (b) Download only on **Download now**. That is slower for people who ignore the toast,
     but asks first.

   The photo encoder (about 1 GB) is never prefetched without a photo intent in either case.

**Gates:**
- No `persist()` call on Gecko before an explained click.
- The toast appears once per session at most until the question is settled.
- The dialog appears only when a network download is actually needed.
- The progress is determinate and never restarts per asset.
- The reporting toast never shows at the same time.

---

## 0. Where things actually stand (23 September)

| Fact | Evidence |
|---|---|
| Live bundle is `app.0a02a29a29b9f35d437b.js`, runtime manifest `d9e37e50…` | `curl next.facemorph.me` and `/runtime/manifest.json` hash, 23 Sep |
| **No retained receipt names the live source revision** | Newest receipt in the tree is `review/next-delivery/promotion-r2-8cd8b37` (runtime `d6305682…`). `review/` is **untracked**. `promote.py --discard-after` deletes the work directory, receipt included |
| The UI shows no version | `build-next.cjs` does inject `FACEMORPH_BUILD_ID` (`next-` + a hash of `src/Next`), so reports carry it. It is not the git revision, and nothing in `Product.fs` renders it. *(Corrected 23 Sep, second pass: the first pass said no build id existed.)* |
| Three different "current runtime" digests appear in the docs | Scope doc `982f73bc…`, round-2 A-8 `d6305682…`, CI pin and live `d9e37e50…` |
| GitHub releases: **zero** | `api.github.com/repos/check-face/facemorph.me/releases` → `[]` |
| Public trial not started. The API retirement target is 25 Oct | `trial-status.json` `public_invitation_live:false`, last updated 8 Sep |

### Round-2 work order: how much has landed (verified in source)

| Item | State at `ddc72b3` |
|---|---|
| R2-3 eager e4e | **Done.** Crop-accept and direct-accept both dispatch `RunFace` or queue it (see R3-10 and R3-11 for queue bugs) |
| R2-12 crop pan 1:1 | **Done in `crop-view.mjs`** (viewport carried in state). U-17's transform-only rendering is **not** done (R3-19) |
| R2-13 frames and estimates | Defect 1 (`framesKey`) and defect 2 (`remaining()` fields) **done**. The refined pre-morph total (frames × per-frame + encode) is **not** done (R3-33) |
| A-3 close control | **Done** (`next-face-close`) |
| No-CDN | **Done for the runtime and fonts.** The live manifest references only `next.facemorph.me`. The catalogue origin is still `cdilga.workers.dev` (R3-21) |
| A-1 add-face placement | **Partial.** Connectors exist before, between and after at N=2, but "Add face" is still in the middle column (`Product.fs:740`) |
| A-4 names states | **Missing.** Failure still goes to the global status line via `Notice`, and "Show more" appears with zero names |
| A-5 duplicated label | **Missing.** `lengthLabel` feeds both the span and the option text (`Product.fs:692-712`) |
| A-7 e2e stages | **Missing entirely** (R3-26) |
| R2-4 slider-first, infill, autoplay | **Missing.** Frames are generated in path order, and the `<video>` has no `autoPlay`/`muted` (`Product.fs:825`) |
| R2-6 "Generate faces" behind a flag | **Missing.** Rendered unconditionally (`Product.fs:736`), and the e2e depends on it (R3-27) |
| R2-8 / R2-14 palette and cards | **Missing.** `.box` has `box-shadow:0 12px 36px` (`style.scss:147`) and `ThemedApp` follows `prefers-color-scheme` (`App.fs:376`) |
| R2-9 FAQ row | **Missing** |
| R2-11 guidance ladder | **Missing.** The desktop nudge still fires on desktops, and "Desktop builds" links to an empty releases page (R3-31) |
| R2-16 and names route | **Missing.** `/names` opens the old modal against face 1. There is no instant preview and no automatic materialisation (R3-17) |
| R2-7 latent CI | **Missing**, and its anchor check (`projectSaveReopen`) is now switched off (R3-05) |
| R2-15 | Cache repair and instrumentation done. "Never a bare engine string" is **not** done (R3-18) |

**Consequence:** the round-2 "READY FOR RE-TEST" condition cannot be claimed today. Nothing
reported as shipped is false, but several docs describe the target as if it were the product
(section 6).

---

## 1. Decisions the operator must make

These are contradictions between recorded decisions. They cannot be resolved from the code.
Each one has a recommended default so work is not blocked while waiting.

### R3-01 · P2 (operator, 23 Sep) · Decision · The 25 October target is now arithmetically impossible

**Evidence:** `side_by_side_trial_plan.md` says that for a 28-day window to finish by
25 October, *the public trial must start no later than 27 September*. `trial-status.json` shows
the invitation is not live, and `candidate_address_decision.deployment_verified` is still
`false` although the candidate is deployed.

**Problem:** every plan says the date is subordinate to preservation and the 28 useful days.
No document records that the date has slipped, and public copy still names it.

**Spec:**
1. Record a revised API retirement target, or an explicit "target under review", in
   `migration_plan.md`, `AGENTS.md` and `trial-status.json` in the same change.
2. Rewrite `trial-status.json` from evidence: deployed candidate, live source, receipt and
   invitation state. Stop annotating historical HF fields in place.
3. Any public copy that names 25 October gets the same revision.

**Gate:** `trial-status.json.updated_at` is 23 September or later. It names the live receipt,
and the target date is consistent across the three files.

**Recommended default:** "25 October 2026 is no longer achievable. The new target is set after
the invitation goes live (28 days minimum plus preservation gates)."

### R3-02 · Decided and built 23 Sep (see the operator section) · The scope of diagnostics consent differs across four sources

| Source | What it says |
|---|---|
| Delivery plan, 16 Sep diagnostic UX | A failure toast. Consent is *"for a bounded debugging session"*, with revoke/expire. *"No pre-consent report is silently backfilled"* |
| Closeout, 17 Sep | Retrospective staging is allowed. Buttons are **Enable for this session**, **Send this report (preview first)** and **Email us**. Only *"necessary short-lived correlation IDs"* |
| Current scope, diagnostics row | *"Opt-in persists until turned off"* |
| Code | The checkbox says *"Send debug reports until I turn this off"* (`Product.fs:885`). Consent is stored in `localStorage`. A **persistent random device UUID** is kept in `localStorage['facemorph-debug-device-v1']` (`reporting.mjs:59`), and `withdraw()` does not delete it. The error box's **"Send debug report"** button actually dispatches `Debug true`, so it turns on persistent reporting instead of sending one report (`Product.fs:974-975`). There is no preview |

**Problem:** the privacy promise a tester reads depends on which document they read. The
button labelled "send this report" grants a different and larger consent than it says.

**Spec (recommended, needs confirmation):**
- There are two distinct consents with distinct controls:
  1. **Send this report.** One-shot: preview the staged records for the failed run, then
     upload those and nothing more.
  2. **Keep reporting on.** Persistent until turned off, as the operator chose on 17 Sep. This
     supersedes "bounded session" in the delivery plan. Record that in the plan.
- The device identifier is either removed (use `session` + `run` only), or disclosed with an
  explicit retention and deleted by `withdraw()`. Choose one and write it into the closeout.
- `withdraw()` also clears the pending batch and `sessionStorage['checkface-diagnostics-pending-v1']`
  (see R3-14).

**Gate:** in a browser, "Send this report" produces exactly one run's records and leaves
`Debug=false`. After turning reporting off, `localStorage` holds neither the consent key nor the
device key. After re-enabling in the same tab, none of the pre-withdrawal events are delivered.

### R3-03 · Resolved and built 23 Sep (finished-frame counter) · The progress-line gate conflicts with R2-13 and R2-4

**Evidence:**
- `scripts/check-progress-copy.mjs` is a 21 Sep operator release gate. It requires that during
  a morph only the frame counter and export speak, the text is literally
  `Generating ${frame.index+1} / ${path.totalFrames} images`, and **"Encoding" is banned**.
- R2-13 (19 Sep) requires *"Generating frame k of M — about X per frame, about Y remaining"*
  and *"Encoding — about Z remaining"* during the encode.
- R2-4 requires **binary infill** order, in which `frame.index+1` jumps 1 → 26 → 13 → 7 …
- `Product.fs:758-759` already renders per-frame and remaining text in separate spans next to
  the line.

**Problem:** implementing R2-4 as written makes the counter non-monotonic. Implementing R2-13
as written fails the build gate. The gate pins the implementation expression (`frame.index+1`),
not the behaviour.

**Spec (recommended):**
- The **status line** is a monotonic count of *completed* frames:
  `Generating {done} / {total} images`, where `done` is a counter and not a frame index.
- The **estimate line** is a separate element (`.next-remaining`). It may say
  "about X per frame, about Y remaining" and is explicitly allowed by the gate.
- While encoding: the status line stays at `{total} / {total}` and the estimate line reads
  "Finishing your video — about Z remaining". This keeps the ban on the word "Encoding".
- Rewrite `check-progress-copy.mjs` as a behavioural test: drive `progress()` with an infill
  sequence and assert the rendered counts never decrease.

**Gate:** with infill order enabled, the recorded status texts are non-decreasing, and at no
point does the status line contain anything other than the counter or export text.

### R3-04 · P1 · Decision · Where hosted lossy images may stand in for the face

**Evidence:**
- 18 Sep decision: historic lossy full-size is servable *"as the same face"*, and *"morph
  endpoint frames may use the exact stored image"*.
- The catalogue file itself says *"Preview assets only. Never canonical originals; never
  written to the device originals cache."*
- U-18 describes tier 2 as *"preview only"*.
- 11 Sep cache proof: the historic images are *"almost pixel-identical"* to regenerated ones,
  not identical.

**Problem:** the 18 Sep rule does not say which surfaces may use the lossy image. If a
**closed-loop** morph uses the stored JPEG/WebP at endpoint frames while the neighbouring frames
are synthesised, every loop passes through a compression and generator-era discontinuity. This
shows up as a visible "pop" at each face, repeated every cycle. "Save image" is also
unspecified: historic lossy bytes or a canonical PNG?

**Spec (recommended):**

| Surface | Bytes |
|---|---|
| Tile display on pick | Hosted 200 px, then hosted full-size, then canonical when it exists (R2-16) |
| Morph endpoint frames | Synthesised from the latent. Use the stored image only if a tolerance test passes (below) |
| Save/Share image of a name face | The canonical PNG if materialised. Otherwise the historic file, named as such (`…-historic.webp`) |
| Originals store | Canonical inference output only. Unchanged |

**Gate:** a test compares the historic full-size for 20 sampled names against local synthesis
at 1024 under an agreed metric. Endpoint substitution is enabled only below the threshold.
The same test runs as part of the Triton fill verification (R3-24).

### R3-05 · P0 · Direction set 23 Sep: automatic persistence, a Library, and "Move to another device" · Project files are off, but four plan items still depend on them

**Evidence:**
- `projectFilesVisible = false` (`Product.fs:687`, since 21/22 Sep).
- Still dependent on it:
  - the handoff definition of done: *"export/reopen project"*
  - the friends-and-family checklist: *"reopen an exported project"*
  - R2-7: *"wired beside the project-reopen check"*
  - the page copy: *"export a project to keep editing"* (`Product.fs:844`)
- Round 1 (Part 2) recorded that **Export was the only way to survive a reload**, because faces
  live in a module-level `Map`. U-05 (session restore) was never built.

**Problem:** hiding the controls removed the only workaround for a known data-loss flow. A tester
who reloads, or whose phone evicts the tab, now loses every encoded photo with no way back
except re-encoding. The checklist tells them to do something the product cannot do.

**Spec:**
1. Build **U-05 session restore**, independent of the project-file UI. Persist the canonical
   project JSON to IndexedDB after each completed job and rehydrate on load. Faces come back
   from the originals store (hits, zero inference). Photo faces come back from their latents.
2. Remove "export a project" from page copy and from the checklist while the flag is off.
3. Move R2-7's latent CI to the names catalogue and to U-05's persisted project instead of the
   hidden UI.
4. **Decision:** confirm whether project files return. If they do not, the durable "move to
   another device" path is U-16 media metadata (R3-22), which is not implemented.

**Gate:** encode a photo, generate a morph, reload. Both faces and the morph return with zero
`encoding` and zero `synthesis` stages (this is round-1 C-06p and U-05, which are still open).

### R3-06 · P1 · Decision · URL state versus "no result links"

**Evidence:**
- Delivery plan (share section) says do not create *"seed/query links as the result-sharing
  substitute"*.
- Round-1 U-15 proposes restoring `?from_value=…&to_value=…` URL state so *"sending someone a
  link"* comes back.
- The names decision has `names.facemorph.me` redirect to `/names` at cutover. Classic names
  and facemorph links carry query state that historic-link preservation must honour.
- The candidate parses no URL state except `/names`, `?names` and `?testing`.

**Spec (recommended):** implement URL state as **navigation and historic-link compatibility**,
not as a result-sharing action:
- Parse classic query parameters and restore the text/seed inputs.
- Update the URL on input change (`replaceState`) so back and bookmark work.
- Keep Share actions file-only, per the delivery plan.

Record this in the delivery plan so the two rules stop contradicting each other.

**Gate:** opening `/?from_value=alice&to_value=bob` in a fresh profile shows those inputs, with
the cache-first lookup running. A classic names "morph" link opens the right pair.

### R3-07 · Decided 23 Sep: accepted as is · The self-hosted TrueNAS runner is attached to a public repository

**Evidence:**
- `check-face/facemorph.me` is **public** (GitHub API).
- `next-gpu-lane.yml` runs on `[self-hosted, truenas, gpu-vulkan]` on the operator's home NAS.
- `local-device-lab.md` says the runner is registered on the repository.
- `AGENTS.md` and `migration_plan.md` still describe a "triton GTX 1080 via CDP tunnel" lane,
  while `local-device-lab.md` says the lane is TrueNAS GTX 1050 and *"not an ad-hoc tunnel"*.

**Problem:** any workflow in the repository, including one added by a pull request, can target
that label. GitHub's first-time-contributor approval is the only thing between a fork and a
shell on the NAS. The docs also disagree about which machine and GPU the lane uses.

**Spec:**
- Put the runner in a runner group restricted to named workflows and refs
  (`next-gpu-lane.yml` on `candidate/*` and `master`).
- Require approval for all outside-collaborator workflow runs.
- Never add a `pull_request` trigger to a self-hosted job.
- Reconcile `AGENTS.md` and `migration_plan.md` with the actual lane: TrueNAS GTX 1050
  container runner now, triton as a possible later runner.

**Gate:** the repository settings show the restricted group. A test workflow on a branch not in
the allowlist is refused by the runner.

---

## 2. Broken flows and bugs (verified in source)

### R3-10 · P0 · Bug · Only the first queued face runs; the rest are silently dropped

**Evidence:** `Product.fs:429-434` (`Completed`) and `:443-448` (`Failed`). Both set
`PendingFaces=[]` and dispatch `RunFace` for the **head only**.

**Repro (inferred):** while a face is encoding, choose photos for faces 2 and 3. Face 2 encodes
after the first job. Face 3 never does and shows no error. This is the same class of bug the
22 Sep commits fixed for crops ("intents queue instead of vanishing").

**Spec:** when a job ends (completed, failed or cancelled), dispatch the head and keep the tail
queued. Drop an id from `PendingFaces` when its face is removed or its input changes.

**Gate:** a reducer test (R3-25) drives three queued `Photo` messages during a busy job and
asserts three `RunFace` dispatches, in order.

### R3-11 · P0 · Bug · Dropping three or more photos: the first never auto-encodes

**Evidence:** `Product.fs:340-348`. On `Photo(id,file)`, `dequeue` pops the next file first.
If the queue is still non-empty the handler returns `next,nextCmd` without dispatching
`RunFace id` and without adding `id` to `PendingFaces`.
- With three files: face 1 is skipped, face 2 runs, and face 3 is queued (then lost to R3-10).
- With two files it works, which is probably why nobody noticed.

**Spec:** every accepted photo either dispatches `RunFace` or joins `PendingFaces`, regardless
of how many files are still waiting.

**Gate:** a reducer test drops 3 and then 5 files and asserts one encode per face.

### R3-12 · P1 · Bug · A multi-photo drop is discarded when any job starts or completes

**Evidence:** `Run` (`:403`), `RunFace` (`:389`) and `Completed` (`:430`) all set
`PhotoQueue=[]`.

**Problem:** files still waiting their turn in a multi-drop disappear when a job completes or
the user presses a Generate button. The comment at `:256-261` says photo intents must now always
take effect.

**Spec:** only `Photos` (a new drop) replaces `PhotoQueue`. Jobs never clear it.

**Gate:** in a reducer test, a 4-file drop interleaved with a `Completed` still ends with four
faces holding files.

### R3-13 · P1 · Bug · A stale job result can replace newer input, and edits blank the job's status

**Evidence:**
- `change` (`Product.fs:240`) sets `Status=""` on every keystroke, so editing any face during a
  job erases the job's status line until the next progress event.
- `Completed` sets `Faces=result.faces` from the job's snapshot. If face 1's text changed while
  it was generating, the old image lands under the new text with nothing marking it stale.
- The delivery plan says: *"stale jobs cannot replace newer results"*.

**Spec:**
- Edits do not touch `Status`.
- Each result face carries the source fingerprint it was generated from (mode, value, file
  identity). A tile whose current input no longer matches shows the image dimmed with
  **Regenerate**, which the visual-alignment "Generated" state already specifies.

**Gate:** start a face, edit its text before completion. The tile ends in the "stale" state and
the status line stays intact during the edit.

### R3-14 · Fixed in tree 23 Sep · Withdrawing consent leaves undelivered events that are sent after re-consent

**Evidence:** `withdraw()` (`reporting.mjs:54`) clears `staged` but not `batch`, and not
`sessionStorage['checkface-diagnostics-pending-v1']`. `restore()` then calls `recoverBatch()`
(`:205`) and delivers what it finds.

**Spec:** withdrawal clears the batch and its `sessionStorage` mirror. The delivery plan requires
*"discard unsent debug reports when disabled"*.

**Gate:** R3-02's third assertion.

### R3-15 · P1 · Bug · A morph re-encodes every photo face instead of reusing its latent

**Evidence:**
- `product-bridge.mjs:137`: `inputs()` calls `service.encodePhoto(item.file)` for every photo
  input on every **morph** and every "Generate faces", even when eager e4e already produced that
  face's latent a moment earlier.
- Reuse depends on the photo cache hitting. When the cache is memory-only or evicted (the iPhone
  case in R2-15), each morph repeats the most expensive operation in the product.
- The e2e hides this: `stage_syntheticPhotoE4e` presses "Generate faces" *after* the eager
  encode and asserts nothing about stage counts.

**Spec:** if `faces.get(id)` exists and its `source` equals the input (same mode and same `File`
object), reuse it. Only call `encodePhoto` when the source changed. This is the latent layer of
D-22.

**Gate:** after an eager encode, "Create morph" emits zero `alignment` and zero `encoding` events.

### R3-16 · P1 · Bug · A cache-hit morph says "Generating", and the slider leaks memory

**Evidence:**
- `product-bridge.mjs:208`: the encode-only path (all frames stored) posts
  `Generating N / N images`. No image is generated. Recent commits removed the same dishonesty
  for cache hits ("a cache hit stops calling itself a download").
- `:127`: `sliderFrames()` creates one object URL per frame and never revokes it, on every toggle
  and every morph. That is 26 to 64 URLs per call.
- `:193`: after a per-face job `project=null` and `video=null`, but `urls.get('video')` is never
  revoked. Toggling "Use Slider" then shows *"…Generate the morph again once frame storage is
  on"* (`Product.fs:818`), yet frame storage **is** on.

**Spec:**
- The encode-only path says "Using the frames already on this device", or stays silent and lets
  export speak.
- Slider URLs are revoked when replaced or unmounted.
- The video URL is revoked when the video is invalidated.
- The "not saved" note names the real reason ("Faces changed since this morph; create it again").

**Gate:** no object URL remains alive after 20 slider toggles (instrument
`URL.createObjectURL`/`revokeObjectURL` in the e2e). The encode-only status text contains no
"Generating".

### R3-17 · P0 · Broken flow · `/names` is still the old modal, and picking a name does nothing visible

**Evidence:**
- `stage.py:31-32` copies `index.html` to `names/index.html`. `namesRequested()` opens
  `BrowseNames "face-1"` (the modal, `Product.fs:1031-1040`), always aimed at face 1.
- Closing leaves the URL at `/names/`, so a reload reopens it.
- `BrowseNames` and `ChooseName` are **silently dropped while Busy** (`:470`, `:473`).
- A catalogue failure goes to the global status via `Notice` (A-4).
- `ChooseName` only sets the text. The tile stays empty until the user presses Generate. The
  18 Sep rule says *"never a Generate click"*, and R2-16 says *"paint the tile from the catalogue
  image immediately"*.
- The gallery helpers (`galleryTextUrl`, `gallerySeedUrl`, `loadedGallery`) are exported and
  **used nowhere** (`product-bridge.mjs:343-363`), so the three-tier lookup does not exist.
- The grid still has a `.75rem` gap (`product-ux.scss:153`).

**Spec:**
- `/names` is a fullscreen route with its own history entry. `?face=<id>` targets a face, and
  **Back** returns to `/` with the pick applied.
- Picks made while Busy are applied to the input immediately. Materialisation queues like photos
  do.
- On pick: paint the hosted 200 px image at once, fetch full-size, then run the cache-first
  lookup and synthesise only on a miss (queued if Busy).
- Loading, empty and error states render inside the route (A-4).
- The grid is gap-free (R2-16).

**Gate:** see R3-26 stage `namesPick`. Picking paints `img[src]` equal to the catalogue URL
within one frame, with zero `synthesis`. A pick made during a running job is not lost. Back
returns to `/`.

### R3-18 · P1 · Broken flow · Failures still reach the screen as raw engine messages

**Evidence:** `product-bridge.mjs:221` returns `String(error.message)`. `PhotoError e.Message`,
`Failed(id,e.Message)` and `Notice e.Message` in `Product.fs` render it unchanged. R2-15 required
*"errors carry stage + underlying cause (referenced in the error box), never a bare engine
string"*.

**Spec:** one `userMessage(errorKind, stage)` table, keyed by the `classify()` buckets that
reporting already computes, produces the sentence on screen. The raw message never reaches the
DOM. A consented run's record keeps `errorKind`/`errorStage` as today.

**Gate:** a unit test feeds representative engine errors (ORT, quota, decode, abort) and asserts
that every result comes from the table and no input text is echoed.

### R3-19 · P2 · Bug · The crop preview still animates layout properties

**Evidence:** `Product.fs:1023` writes `width`, `height`, `left` and `top` on every pan. U-17's
gate (*"panning writes only `transform`"*) is unmet. R2-12 fixed the maths, not the rendering.
Decode bounding (U-17 items 4 and 5) was not re-verified here.

**Spec:** the image has a stable intrinsic size, and pan, zoom and rotate are expressed as one
`transform: translate3d(…) scale(…) rotate(…)`. Pointer moves are coalesced to one dispatch per
animation frame.

**Gate:** U-17's first gate, asserted in the e2e crop stage with a `MutationObserver` on `style`.

### R3-20 · P1 · Broken flow · First load shows empty "Drop a photo" tiles under "hello" and today's date

**Evidence:**
- `init` sets text inputs `hello` and `yyyy-MM-dd` (`Product.fs:198`), but nothing looks them up.
  The tile renders the photo-drop empty state (`:617-622`).
- U-04 (*"hello renders on load… zero inference workers"*) and U-18 (*"first load shows two real
  faces"*) are unimplemented.
- U-18 also noted that `hello` is not in the published names, so it can never be a hosted hit.

**Problem:** the first screen a tester sees contradicts itself: a text field says "hello" and the
image area says "drop a photo". Classic showed two faces.

**Spec:**
- On load, run the cache-first lookup for both inputs with no models (originals store, then
  hosted).
- Choose defaults that are in the hosted collection (for example a name for face 1 and a seed
  from 0–999 for face 2), and record the choice in the visual-alignment decisions.
- A text or seed tile with no image yet shows a text-face placeholder with its per-face
  **Generate**. It never shows the photo-drop prompt.

**Gate:** in a fresh profile, two `<img>` elements are present within 2 s of load, with zero
`Worker` constructions and zero model requests.

---

## 3. Weak contracts and mismatched interfaces

### R3-21 · Mostly fixed in tree 23 Sep (the gallery origin move is still open) · The catalogue ships without qualification and bypasses the no-CDN gate

**Evidence:**
- `promote.py --catalogue <path>` and `stage.py` add `catalogue.json` at promotion. It is not
  in the built artifact, not in `next-site-SHA256SUMS`, and not served by the qualification
  server, which is why A-4 was found only by hand.
- `check-no-third-party.mjs` scans `deploy-next`, so it never sees the catalogue.
- The catalogue's `origin` is the personal `https://facemorph-seed-gallery.cdilga.workers.dev`,
  which U-18 said must move before release.

**Spec:**
- The catalogue is a content-addressed input to the build: it is copied into `deploy-next` by
  `build:next` (which also closes A-4's local-parity half) and covered by SHA256SUMS.
- Its origin is on the allowlist, which should be a `facemorph.me` host.
- The receipt names its hash.

**Gate:** `next-site.yml` fails if the catalogue origin is outside the allowlist, and
`promote.py` refuses a catalogue whose hash differs from the qualified artifact's.

### R3-22 · P0 · Contract · Media metadata (U-16) is written into the contracts but not implemented, and it will silently void an e2e gate

**Evidence:**
- `next-runtime-contract.md`, the delivery plan's share section and the closeout all say shared
  media **carries the W+ latent and provenance**.
- `media.mjs` writes none. `grep iTXt|DigitalSourceType` over `src/` finds nothing, and the
  stale comment at `media.mjs:1` (*"never … embeds project latents"*) is still there.
- `stage_syntheticPhotoE4e` uploads a **"Save image" output** as its "photo". Once U-16 lands,
  importing that PNG takes the latent path and **skips e4e**, but the stage asserts only that a
  worker was created. It would keep passing without running the encoder.

**Spec:**
1. Mark U-16 as *pending* in all three contract docs until it ships.
2. When U-16 lands, the e2e photo fixture is a metadata-free PNG (strip chunks, or use a
   dedicated fixture), and the stage asserts ≥ 1 `alignment` and ≥ 1 `encoding` event from the
   diagnostics stream or the stage log.
3. Add a separate `sharedImageReopen` stage that asserts **zero** `alignment` and zero
   `encoding` on import.

**Gate:** both stages exist and are required in `promote.py`.

### R3-23 · P1 · Interface · The per-name latent endpoint disagrees with the product's latent contract

**Evidence:**
- The 18 and 19 Sep decisions say per-name **W** latents are served at
  `catalogue/latent/<identity>`, and R2-2 says *"hash → seed → z → mapping → W"*.
- The product accepts only **W+ `[1,18,512]`** (`requireLatent`, `identity.mjs`).
- The runtime contract forbids implicit W → W+ conversion (*"a conversion must be an explicit,
  qualified operation"*).
- Generation applies **truncation ψ 0.7, cutoff 8** inside the worker, while the project records
  `truncationPsi:1, truncationCutoff:0` (`product-bridge.mjs:143`). So a served latent must
  state whether it is pre- or post-truncation.
- `mapping` (8.4 MB) is already prefetched on load (U-01). A name's W can be computed on-device
  in milliseconds from the same hash, so fetching it over the network gains nothing unless
  mapping is unavailable.

**Spec (recommended):** drop the latent endpoint. On a name pick, derive W+ locally
(`inputLatent` → `mapping` → truncate), exactly as generation does. The catalogue carries name,
identity and image URLs only (unchanged). If an endpoint is still wanted (for example for a
future no-mapping client), serve **post-truncation W+ float32** with `space:"w-plus"`,
`shape:[1,18,512]`, `truncation:{psi:.7,cutoff:8}` and a sha256, and version it.

**Gate:** R2-7(a) becomes: for 10 names, the latent derived on-device byte-matches an independent
Python reference (and the endpoint's bytes, if the endpoint is kept).

### R3-24 · P1 · Contract · Checking the Triton fill against the name's hash does not check the image

**Evidence:** R2-2 and the names row describe identity verification as *"SHA-256 must match the
lowercase-name identity"*. That hash identifies the **request path**, not the returned pixels.
The 11 Sep probe showed the API **writes a new cache JPEG on a miss**, so this bounded live
action is also a set of Triton writes. The approval is recorded on 18 Sep, but `AGENTS.md` still
says Triton is read-only without listing the exception.

**Spec:**
- Per item, record: the request, response status, dimensions, sha256 of the bytes, and a
  **content check**. The check compares against a local 1024 synthesis of the same name under
  R3-04's metric, or against the historic 200 px image downscaled.
- Record the count of Triton cache files created.
- Add a dated exception line to `AGENTS.md` Safety Boundaries.

**Gate:** the fill ledger has 2,144 rows, each with a content-check result. Items that fail
are excluded from publication.

### R3-25 · P1 · Contract · Reducer tests match F# source with regexes instead of running the reducer

**Evidence:** `crop-queue.test.mjs` and `photo-selection.test.mjs` read `Product.fs` and
regex-match lines of source. `check-progress-copy.mjs` does the same to `product-bridge.mjs`.
The delivery plan says to *"remove redundant implementation-mirroring checks"*. These tests
cannot catch R3-10 to R3-12 because the buggy lines match their patterns.

**Spec:**
- Test the compiled `update` from `Product.fs.js` directly (Fable already emits it for
  `verify-fable.mjs`), using message sequences and stubbed commands.
- Keep one test file per behaviour: crop queue, photo queue, pending faces, stale results,
  names picks while busy.
- Delete the regex versions when the behavioural ones land.

**Gate:** the R3-10, R3-11 and R3-12 tests fail on `ddc72b3` and pass after the fix.

### R3-28 · P1 · Contract · `promote.py` gates that fail open or trust the artifact under test

| Gate | Weakness | Spec |
|---|---|---|
| Kernel `keep` row | `if ledger.exists():` (`promote.py:48`) reads `../autoresearch/results.tsv`, **outside the repo**. On any machine or CI without the workspace, the gate is skipped silently | Missing ledger raises. Better: vendor a pinned `kernel-provenance.json` into the repo with the keep-row copy and sha |
| `projectSaveReopen` | Required only if the **DOM of the tested artifact** shows the controls (`:34-36`). A regression that hides the controls removes its own gate | The build emits `features.json` (for example `{"projectFiles":false}`) from `Product.fs` constants. `promote.py` derives `required` from it, the e2e asserts the DOM matches it, and the receipt records it |
| Receipt retention | `--discard-after` deletes `promotion.json`. `review/` is untracked | The receipt is written to a tracked path (`docs/review/next-delivery/receipts/<source>.json`) before any discard. `--publish` refuses to proceed if it cannot write it |
| Runtime bytes | Only `manifest.json`'s hash is compared. The runtime directory is a local path on the promoter's machine | Before staging, verify every manifest-referenced file's sha256 and size in `--runtime` |
| Version identity | No build id | `build:next` injects `FACEMORPH_BUILD_ID=<source sha>`, the UI shows it (see R3-32), and promotion asserts the live `/`'s bundle carries it |

**Gate:** each weakness has a negative test in `hosting/next-static/` (missing ledger, a DOM that
hides a feature the manifest declares, a tampered runtime file, and a receipt path that cannot be
written). Each must refuse.

### R3-29 · P2 · Interface · Absolute runtime URLs tie the product to one hostname

**Evidence:** every asset URL in `runtime/manifest.json` is absolute `https://next.facemorph.me/…`.
The qualification therefore **must** hijack DNS with `--host-resolver-rules`, the setup that
produced the false production-failure report in round 1. The Cache Storage namespace is
per-origin, so the planned move to `facemorph.me` re-downloads about 1.4 GB per device (the
delivery plan's "origin-transfer plan" is still unwritten).

**Spec:** manifest URLs are relative and resolved against the manifest URL. The e2e server then
serves on its own origin with no resolver rules. Write the origin-transfer plan now, including
whether `facemorph.me` fetches runtime from `next.` cross-origin (CORP is already
`cross-origin`) to keep caches warm.

**Gate:** the e2e runs without `--host-resolver-rules`, and the artifact-origin assertion uses the
served header instead of a DNS name.

### R3-30 · P1 · Contract · Qualification headers are not production headers

**Evidence:**
- `next-e2e-server.py:76` sends its own COOP/COEP, `CORP: same-origin`, `Cache-Control: no-store`
  and a CSP.
- Production `_headers` (written by `stage.py`) sends **no CSP**, `CORP: cross-origin` on
  `/runtime/*` and immutable caching.
- `check-next-artifact.sh` serves with `python -m http.server`, which sends no isolation headers
  at all.
- The scope doc claims *"served with production headers"*.

**Spec:** one headers source (`hosting/next-static/headers.txt`). `stage.py` writes it, and both
test servers read and apply it. Add a CSP to production from the same file (self, blob and
`wasm-unsafe-eval` as needed) so the no-CDN rule is enforced by the browser as well as by grep.

**Gate:** a test diffs the headers the e2e server sends against production `_headers` for five
representative paths.

---

## 4. CI and end-to-end coverage

### R3-26 · P0 · CI · The A-7 stages do not exist, so round 2 cannot be declared done

**Evidence:** `STAGES` in `next-e2e-browser.py:338-340` has the original eight. The
`promote.py:27` required set is the original six (minus the conditional `projectSaveReopen`)
plus `routeRejectionNamed`.

**Spec:** add these stages. Each one goes into `required` in the same change:

| Stage | Behaviour asserted |
|---|---|
| `morphKinds` | Rotates the kind via `select[aria-label="Morph shape"]` (one kind per run, keyed on `GITHUB_RUN_NUMBER % 5`, plus a weekly all-five dispatch). Playable MP4 and the frame count equal to `plannedFrames` |
| `sliderScrub` | After a morph, Use Slider scrubs with **zero** `synthesis`. After a repeat morph, zero `synthesis` (encode-only) |
| `addFaceN3` | Add a face through a **connector** (not the "Add face" button) and create a 3-face morph |
| `namesPick` | `/names` route → pick → `img[src]` is the catalogue URL, zero synthesis, Back returns (R3-17) |
| `photoQueue` | Three photos chosen while busy all encode (R3-10 and R3-11) |
| `reloadRestore` | Once U-05 lands: reload restores faces and morph with zero inference (R3-05) |
| `sharedImageReopen` | Once U-16 lands (R3-22) |

**Gate:** the qualification report contains every stage with `passed:true`, and `promote.py`
refuses without them.

### R3-27 · P0 · CI · The harnesses depend on controls the plan removes

**Evidence:**
- `next-e2e-browser.py` uses `'Generate faces'` for `idle()` and every `run()` (`:42`, `:111`).
  R2-6 puts that button behind a flag.
- `check-next-artifact.sh` clicks **"Add face"**, which A-1 removes from the middle column, and
  tests the names **dialog** with Escape, which becomes the `/names` route.
- The routeRejection stage matches `'webgpu'`, `'cpu'` and `'failed'` in **user-facing caption
  text** (`:230`), which blocks R3-34's copy fix.

**Problem:** building the round-2 design breaks the gates. The pressure then is to keep the old
UI or weaken the gates.

**Spec:** before any UI change, rewrite the locator contract `S`:
- `idle()` means no `.next-status progress` and no `data-next-busy="true"` on `.next-product`
  (add that attribute).
- Generation uses per-face **Generate** buttons, or `?flags=generate-all` if the flag is kept.
- Route assertions read `data-next-route` and a new `data-next-rejected` attribute.
- Add-face uses the connector labels.
- The names check drives the route.

**Gate:** the harness passes against the current UI and against the round-2 UI, with no source
edit other than `S`.

### R3-35 · P1 · CI · The GPU lane benchmarks the deployed site, not the pushed commit

**Evidence:**
- `next-gpu-lane.yml:106` uses `GPU_BENCH_URL` with the default `https://next.facemorph.me/` on
  **push**. A push that changes `webgpu-engine.mjs` benchmarks the *old* deployed bytes and
  records the row as if it measured the change.
- The `schedule` trigger (`:38`) never fires because the workflow is not on the default branch.

**Spec:** on push, download the commit's `next-site` artifact, serve it on the runner with
`next-e2e-server.py`, and benchmark that. Label each row with the served artifact's source sha.
Keep `workflow_dispatch` with a URL for deployed-site checks. Either move the workflow file to
`master` so the schedule works, or delete the schedule so it stops implying a nightly run.

**Gate:** each benchmark row's `servedSource` equals `github.sha` on push runs.

### R3-36 · P1 · CI · Engine and iOS lanes are unverified or measure the wrong runtime

**Evidence:**
- `next-matrix.yml` is `workflow_dispatch`-only, so it cannot run from the candidate branch, and
  its cross-engine row is still an open checkbox in the scope doc.
- `mobile-browser.yml` `ios-product-simulator` proxies `/runtime/*` from the **deployed** origin,
  so a commit that changes the runtime overlay is tested against the old runtime.
- CI uses 'iPhone 16 Pro' where the docs say 'iPhone 17 Pro', and the lane is recorded as
  *"expected to run… unverified"*.

**Spec:**
- Give `next-matrix.yml` the same path-scoped push trigger as the GPU lane, or land an inert
  copy on `master`.
- The iOS lane serves the runtime overlay pinned by `runtime_sha`, not the live one.
- Record the first green or red run of each lane in `local-device-lab.md`.

**Gate:** a linked run for each lane on the current tree.

### R3-37 · P2 · CI · Assorted gaps

- **PR qualification:** `qualify` is skipped for `pull_request`, and `master` is unprotected.
  This is fine as long as promotion only accepts branch builds, which it does, but record in
  the scope doc that PRs are compile-and-component only.
- **Build image:** `mcr.microsoft.com/dotnet/sdk:5.0-focal` (out-of-support .NET and Ubuntu) is
  used in two workflows. Pin it by digest now, and schedule the SDK move with the Fable upgrade.
- **Visual gates promised but absent:** R2-8's "grep gate on `product-ux.scss`" and R2-14's
  scheme check. Add `scripts/check-visual-rules.mjs`:
  - no `border-left` with a colour on elements with a radius
  - no `.box` shadows larger than the classic budget
  - `ThemedApp` pinned to dark for the product route
- **Untested flows the handoff lists:**
  - cancellation mid-face and mid-morph
  - remove-face during a job
  - keyboard activation of the empty tile
  - cache eviction and repair through the UI (not only the component suite)
  - consent turned on mid-run through the real checkbox (C-09's gate)

  Add at least cancellation and mid-run consent before re-test.

---

## 5. UX flow issues for the release candidate

### R3-31 · P0 · UX · The slow-device box tells desktop users to buy a desktop and links to an empty page

**Evidence:**
- `Product.fs:959-963`: shown whenever the route is CPU or the median face time is over 20 s.
  Copy: *"A laptop or desktop with a graphics card — or the desktop app — is dramatically
  quicker"*, with a link to `…/releases`, which has **zero releases**.
- The delivery plan says: *"Only show working, qualified download links"*.
- U-12 says: the desktop build *"must not be offered as a GPU remedy"*.
- R2-11 specifies the ladder.

**Spec:** implement R2-11's four rungs. Device class comes from `navigator.userAgentData.mobile`
or pointer/UA heuristics, recorded as a guess and never shown as a fact. The desktop-builds link
is shown only when a `desktopRelease` entry exists in a shipped config with a tested asset for
this OS. Until then the copy is: "We didn't find a GPU this browser can use. It will still
finish here."

**Gate:** four fixtures (phone+CPU, desktop without `navigator.gpu`, desktop with a rejected
route, desktop with a qualified GPU and a slow face). Each shows exactly its rung's copy, and no
fixture shows a link while the release list is empty.

### R3-32 · P1 · UX · Testers cannot see or report which version they are running

**Evidence:** the checklist starts with *"note its version"*, and the handoff says *"Help exposes
the candidate version"*. There is nothing on screen to note (section 0).

**Spec:** the footer shows `Preview · <short sha> · <date>` from the build id, selectable. The
same id is in every diagnostics record.

**Gate:** the e2e reads the footer version and asserts it equals `next-site-source.txt[:7]`.

### R3-33 · P1 · UX · The pre-morph estimate ignores unfinished faces and the encode

**Evidence:** `Product.fs:940-955` computes `perFace × frames`. R2-13's refined spec is
*frames × measured per-frame + this device's measured encode*, labelled as synthesis-only until
encode has been measured. Faces still to generate are not included either.

**Spec:** total = faces left × per-face + frames × per-frame + encode (measured, or "plus video
finishing" when unmeasured). The pieces are shown in one sentence.

**Gate:** an `estimate.test.mjs` case through `jobProgress()` shape and `plannedFrames()` with
two unfinished faces.

### R3-34 · P1 · UX · Page copy names controls that do not exist and uses internal terms

| Where | Now | Change to |
|---|---|---|
| `Product.fs:844` | "…export a project to keep editing." | Remove while `projectFilesVisible=false` (R3-05) |
| `Product.fs:869` FAQ | "Set Face source to Photo…" | "Use a face's mode menu and choose Upload image, or drop a photo onto a face." The only "Face source" control is a hidden, disabled mirror for tooling |
| `Product.fs:748-749` route caption | "Using the cpu route. The webgpu route failed its device check…" | "Running on this device's processor." / "Your GPU didn't pass our check here, so this is running on the processor." Tests read `data-next-route` and `data-next-rejected` (R3-27) |
| `Product.fs:887` | "3 staged report(s) from this session are ready to send if you agree." | "We kept a record of what just happened on this device. Nothing has been sent." together with **Send this report** (R3-02) |
| `Product.fs:871` FAQ API link | `checkface.facemorph.me/api` | Keep only while that host is live. Tie its copy to R3-01's retirement wording |
| R2-9 | missing | Add the single local-generation FAQ row |

**Gate:** a copy test fails if the explain section mentions a control label that is absent from
the rendered DOM.

### R3-38 · P1 · UX · Round-2 surface items still to build (no new decisions)

These are already specified. They are listed here so iteration 3 carries them explicitly:
- A-1: remove "Add face" from `morphSlot`.
- A-2: the trailing connector peeks into view at N≥3.
- A-5: plain "Shape" and "Length" labels. The option text is "Short", "Standard" and "Long".
- A-6: the results area renders only when there is something to show.
- R2-4: infill order, live slider with "N of M frames", autoplay, muted and loop, poster =
  face 1.
- R2-6: "Generate faces" behind a flag, and MUI selects in More options.
- R2-8 and R2-14: pin the palette and remove the card shadows and accent borders.
- R2-10: For-testing restyled as a FAQ peer.
- R2-11: transient notices in a Snackbar.

Sequence them **after** R3-27 so the gates survive.

Also reconcile these two points with the docs:
- **Remove during a job:** R2-1 and A-3 say "disabled while busy". The code allows removing any
  face except the active one (`Product.fs:630`) on purpose (the queued-intent change). Update
  R2-1/A-3 to match the code, and make removal also drop the face from `PendingFaces` (R3-10).
- **Default shape:** the delivery plan, closeout, audit §1 and runtime contract say *pairwise
  figure-eight* is the default. The code and `check-next-artifact.sh` pin
  **`full-smooth-figure8`, pinched** (operator, 22 Sep). Record the 22 Sep decision in the
  delivery plan and the visual-alignment register (a new D-23). Make sure `morphKinds`
  (R3-26) exercises the N=2 closed loop A→B→A that this default implies.

---

## 6. Documentation that no longer matches the tree

| ID | File | Problem | Fix |
|---|---|---|---|
| R3-40 | `docs/current-delivery-scope.md` | Header says "Updated 16 September… deployed and qualified". The snapshot names `23c1646` and runtime `982f73bc` | Replace the snapshot with a pointer to the latest tracked receipt (R3-28). Keep the dated history below it |
| R3-41 | `docs/candidate-audit-2026-09-19.md` §1 | Says `pairwise-figure8` is the shipped default | Add a dated note pointing to D-23 |
| R3-42 | `migration_plan.md` "Open Questions" and "Immediate Next Tasks" | Still HF-era (April) | Mark them historical and link this review |
| R3-43 | `AGENTS.md` | Triton GTX 1080 CDP lane, "Triton read-only" without the 18 Sep API-fill exception, June/Oct wording | R3-07, R3-24, R3-01 |
| R3-44 | `docs/local-device-lab.md` | Mac lane "5/6, morphVideo needs iteration" and the iOS lane "expected to run", both without later status | Record current results or mark them unknown |
| R3-45 | `delivery_workstreams.md` | 14 Sep agent-lane ownership table | Mark historical |
| R3-46 | `next-runtime-contract.md`, delivery plan share section, closeout | State that media carries the latent (R3-22) | Mark as pending until U-16 ships |
| R3-47 | `release-tests/` vs `next-e2e` and `promote.py` | Two evidence systems: 459 target/scenario combinations with zero attestations, versus a six-check promotion set. The delivery plan forbids a parallel CI system | Map each `promote.py` check to `catalog.json` scenario IDs and have `readiness.json` import the qualification report, so there is one readiness number |

---

## 7. Iteration-3 order and the definition of done

The order follows dependencies: gates first, so the UI work cannot weaken them.

1. **Provenance and honesty (small).**
   - R3-28: tracked receipts, fail-closed ledger, feature manifest, runtime file verification.
   - R3-32: visible version.
   - R3-01: record the target.
   - R3-40 to R3-46: doc fixes.
2. **Decisions:** R3-02 to R3-07. Use the recommended defaults unless the operator says
   otherwise.
3. **Harness first:** R3-27 (locator contract), R3-25 (reducer tests), R3-30 (one headers file),
   R3-21 (catalogue in the artifact).
4. **Correctness bugs:** R3-10, R3-11, R3-12, R3-13, R3-14, R3-15, R3-16, R3-18.
5. **Flows:** R3-05 (U-05 session restore), R3-17 and R3-20 (names route, instant faces,
   first-load faces), R3-31 (guidance ladder), R3-33, R3-34.
6. **Round-2 surface:** R3-38, with R3-03's progress contract in place before R2-4's infill.
7. **Coverage:** R3-26's stages as each behaviour lands, then R3-35, R3-36 and R3-37.
8. **Security:** R3-07 before the next GPU-lane run.

**READY FOR RE-TEST (iteration 3)** can be claimed only when all of the following hold:
- Every P0 above is closed or has a recorded operator decision.
- `promote.py`'s required set includes the R3-26 stages that apply to shipped features, derived
  from the artifact's `features.json`.
- The promoted artifact's version is visible in the UI and matches a tracked receipt.
- The public URL is validated from a client with no DNS override.
- Anything not measured is reported as **not measured**. A Simulator row is not a phone row.

As before, the native desktop GPU matrix stays out of scope.

# Round 1 work order — what to read, and what counts as done

Handoff brief for implementing the testing-round-1 feedback. Written **17 September 2026**.

## Read these, in this order

1. **[Testing round 1 feedback](testing-feedback-round-1.md)** — the work itself. Its
   constraint section and ledger are the spine; **C-nn** items are the parity work, **U-nn**
   are everything else. The *Status check — 17 September* section says what is already done
   and verified, so start from there rather than re-deriving it.
2. **[Candidate visual alignment](candidate-visual-alignment.md)** — the design plan for
   U-10 and U-15, with measurements and screenshots in
   [`review/next-delivery/style-delta/`](review/next-delivery/style-delta/).
3. **[Current delivery scope](current-delivery-scope.md)** — what this round is and is not.
   The native desktop GPU matrix is out of scope; do not start it.
4. **[`autoresearch/program.md`](../../autoresearch/program.md)**, "Objective and fixed
   evaluation" — the bench metrics that parity is measured against, and the rule that
   evaluation is never weakened to manufacture a speedup.
5. **`autoresearch/results.tsv`** and `review-artifacts/device-lab-runs/` — the measured
   numbers. `12723cce-…json` is the operator's S24 Ultra.

Code entry points: `src/Next/Product.fs` (UI), `product-bridge.mjs` (orchestration),
`browser/runtime.mjs` (route/admission), `browser/ort-worker.mjs` (inference),
`Assets/model-cache.mjs` (acquisition), `video-worker.mjs` + `media.mjs` (export),
`reporting.mjs` (diagnostics). Classic UI to reuse: `src/MorphForm.fs`, `src/SliderMorph.fs`,
`src/Share.fs`, `src/FancyButton.fs`, `src/BrowseFacesDialog.fs`, `src/EncodeImageDialog.fs`.

CI: `.github/workflows/next-site.yml` builds, `next-e2e.yml` qualifies, `next-matrix.yml`
covers engines, `hosting/next-static/promote.py` gates publication. Browser checks live in
`scripts/next-e2e-browser.py`.

## The one rule

**A gate tests the user-visible behaviour, not the component it depends on.**

This round already produced one example of the failure mode: the collector was verified end
to end and diagnostics were treated as addressed, while the defect the operator actually
reported — turning consent on during a run — remains in `reporting.mjs` untouched. Proving a
dependency works is not proving the behaviour works.

So: every gate below is phrased as something a user or a test can observe from outside.
Where a gate needs hardware we do not have, it is **recorded as missing**, never inferred.

## Per-item acceptance

### Parity work

| ID | Done when |
|---|---|
| **C-01** | The shipped `fused-resample-v1.mjs` is byte-identical to the `mobile-boundary-bounded` kernel (`experiment/device-lab/fused-resample-boundary-v2.js`); zero `continue` in the tap loop; all 31 synthesis cases pass at RGB max ≤ 1 and sampled float ≤ 0.002 against the unchanged fixed references; the promotion receipt names the candidate id and its `results.tsv` status |
| **C-02** | A route rejected by the canary gate is named in the UI, in the diagnostics record, and in the parity table — not silently swallowed. Test: force a canary failure, assert the UI states which route failed and which is now in use |
| **C-03** | Second page load on an unchanged manifest emits **zero** `canary` events before the first face. Cold device emits exactly one before the first face and the remaining six after it. A tampered reference still fails the route, and all seven still run in CI. Test: load twice, count events; then corrupt one reference and assert rejection |
| **C-04** | Already done for the CPU route. Remaining: `webgl-vector-v1.mjs:266` no longer hardcodes `numThreads=1` (it runs the CPU prefix stage — real inference). `webgpu-engine.mjs:8` may stay at 1 with a comment saying why |
| **C-05** | The synthesis model is fully hashed **at most once per bundle version**, not twice per open. Test: instrument the cache and count full-asset digests across two warm generations; assert ≤ 1 |
| **C-06** | Zero `encodeRgbaPng` calls on the morph path for raw encoder frames; zero **originals**-store lookups for them (frames use their own store); MP4 still decodes to the expected frame. Frames persisted to a morph-frame store keyed by morph identity, with a canonical 1024 PNG and a display-size derivative |
| **C-06p** | **Reload survives.** Generate a morph, reload the page, and the morph and its slider are available with **zero** `synthesis` events. Repeat the same morph settings and it is a cache hit. Under a constrained quota the store degrades to memory-only for the session and the generation still succeeds — persisting frames must never be fatal the way the model cache is |
| **C-07** | Encoder path chosen from a measured device budget, not from `manifest.encoderStream` being present. Both paths reachable and recorded in provenance. Encoder qualification cached per bundle: second photo in a session emits no `encoder-correctness-check` |
| **C-08** | A parity harness runs one fixed latent through the bench and the shipped bundle on the same device and route, emits bench ms / product ms / per-stage decomposition, and **every row of the difference maps to a named ledger entry**. Wired into `next-e2e.yml` as a failing check on the engines CI can run |
| **C-09** | Consent enabled **mid-run** produces a complete record for that run: one `run` uuid with a start event, ≥ 1 stage and a terminal event, all in one session, retrievable from KV. The reference is in the DOM, selectable, and survives until the next run starts. The terminal event arrives when the page is hidden mid-run. Negative gates unchanged: unauthenticated POST and foreign origin still 403 |
| **C-10** | A test enumerates every `stage` string emitted anywhere under `src/Next` and asserts each has a label or is explicitly silent. **No stage may fall through to "Working…"** — that assertion is the regression guard. Separately, `createBrowserModelCache({report})` is wired in `ort-worker.mjs` and `fraction` increases strictly *within* a single asset, not only between assets |
| **C-11** | `VideoEncoder` used wherever `isConfigSupported()` passes; `ffmpeg-core.wasm` not downloaded on those browsers; encode pipelined with synthesis rather than awaited inside the frame loop; the encode is its own stage in the parity table, separable from synthesis. Resolution is chosen from measurement and recorded — not lowered first |

### Restoration work

| ID | Done when |
|---|---|
| **U-01** | Network trace with no interaction: `mapping` and the noise set requested before any input; CPU `synthesis` requested within a stated budget of load; `encoder` and `landmarks` requested **only** after a photo tile exists. Acquisition resumes from the last completed chunk after a simulated tab hide. `navigator.storage.persist()` called exactly once, from the UI |
| **U-02** | Face 1's `<img>` has a `src` **before** face 2's job starts. Each tile has its own progress and stage text |
| **U-03** | A per-face Generate exists; generating one face emits no `synthesis` for any other. Choosing a photo starts alignment and e4e without a further click |
| **U-04** | With a warm cache, `hello` renders on load having created **zero** inference workers. Re-uploading a previously encoded photo emits no `alignment` and no `encoding` stage. Re-requesting a previously generated morph emits **zero** `synthesis` events and yields a playable video. All three still hold after a reload. `navigator.storage.persist()` called once from the UI. See the U-04 requirement section in the feedback document |
| **U-05** | Reload mid-session restores faces and settings from the persisted project with zero inference. Export/Open renamed and out of the primary row |
| **U-06** | Exactly one save action per result |
| **U-07** | One input generates; morph controls hidden or disabled below two, with a stated reason |
| **U-08** | A 12 MP JPEG and a HEIC both reach alignment with **no crop dialog**. A no-face photo opens the crop step with a message naming the reason. A multi-face photo offers a choice rather than erroring |
| **U-09** | Width / Pinch / raw frame counts gone from the user surface. **Morph shape goes to the overflow, not the main surface** (D-17). Length stays reachable. Processing mode moves to the debug area and stays keyboard-reachable, because `next-e2e` selects CPU through it |
| **U-10 / U-15** | See the visual gates below |
| **U-11** | A wake lock is held for the duration of a job and released after. Per-face and per-frame checkpointing means an interruption loses at most one unit |
| **U-12** | Already done. Keep the rule that a cached face is not a measurement |
| **U-13** | Explain and FAQ content present in the DOM on the home route **without toggling Help** |
| **U-16** | Saved PNG and MP4 carry provenance plus `IPTC DigitalSourceType = trainedAlgorithmicMedia`, and the **latent**, by default. Re-importing reproduces a byte-identical face with zero inference. A shared image opened on a **second device with a cold cache** produces its face with zero `alignment` and zero `encoding` and never requests the encoder or landmarks assets. No source image and no typed value in the file. The stored canonical original is byte-identical to today's and the byte-identical-repeat check still passes. A metadata-stripped copy still imports as an ordinary photo. The contract wording in `next-runtime-contract.md`, `web_checkface_delivery_plan.md` and `delivery_closeout_2026-09-16.md` is already updated; the stale comment at `src/Next/media.mjs:1` ("never uploads private inputs or embeds project latents") must go with the change |
| **U-17** | Panning writes **only** `transform` — assert no layout-affecting property changes during a pan. Peak decoded-bitmap bytes during crop of a 12 MP photo stay under a stated budget and the original is never decoded at full resolution (use `image-header.mjs` dimensions to size a single bounded `createImageBitmap`). A 48 MP photo opens the cropper on a phone-class memory profile without failing. Crop output quality unchanged and `localCrop` still passes |
| **U-18** | `catalogue.json` covers all three published sets (5,055 names at 200px, 2,911 full-size names, 1,000 seeds at 1024px) and every URL returns 200 at its ledger size. Selecting a name or seed present in the collection shows a face with **zero** inference workers and no model bytes requested. That preview never enters the originals store; canonical generation replaces it and the stored `imageSha256` is inference output. First load shows two real faces with no interaction. Gallery 404, offline and cache miss all fall back to local generation without an error. Seed browser renders 0–999. Gallery moved off `cdilga.workers.dev` onto a `facemorph.me` origin, hashes preserved |
| **U-19** | Census completes over **both** roots (active and oldSeeds), resumable, read-only, reporting unreadable/changed/unknown separately — a sampled scan is not a census. Classification ledger with a provenance class per file; nothing outside the eligible class staged. All 8,966 **served** files checksummed against the ledger, and `publicationApproved` / `allFilesChecksummed` / `losslessOriginalsEstablished` set from evidence rather than left false under a live deployment. The 2,144 names with no full-size image resolved. **Zero writes to Triton. No paid resources.** Measured capacity options presented to the operator before any upload beyond the already-published set |
| **U-14** | The slider scrubs retained frames with **zero** `synthesis` events, before and after a reload. Scrubbing decodes the display-size derivative, not the 1024 original — assert peak bitmap memory stays bounded on a 26-frame morph. "Use Slider" is present as classic had it, and face merging (`explain.md`'s documented use) is reachable again |

### Visual gates (U-10 / U-15)

Assert in a browser at **390×844** and **1800px**:

- `.next-face-image` computed width **≥ 300px** at 390px viewport (classic's figure; it is 157px today)
- **Face width does not decrease when a face is added** — measure at N=2 and N=4 and assert non-decreasing. This is the floor rule and it is the one that matters most
- Exactly **one** focusable control per face in the default non-photo state (three today)
- **Zero** Bulma interactive classes (`.button`, `.input`, `.select`, `.notification`) inside the product surface
- The primary action's computed `background-image` is not `none` — the gradient is back
- Explain content in the DOM on load without interaction
- At N=2 and ≥1000px, the video's horizontal centre lies **between** the two face tiles

Screenshot comparison against `review/next-delivery/style-delta/` is a **reviewed artifact,
not an automated pass/fail** — a pixel diff between two different applications means nothing.

## The structural gate

C-01's root cause was that research winners and product bundles were never bound to each
other. Fix the class, not the instance:

**A bundle may not be built from a kernel or runtime that has no `keep` row in
`autoresearch/results.tsv`, and the promotion receipt must name the candidate id and that
row.** `promote.py` already refuses to publish without a runtime digest match; extend the
same idea one step back into the build.

Without this, the next winner goes missing the same way, and the native GPU matrix will
produce far more candidates to promote than this round did.

## Verify, validate, deploy

Every run ends with the change proven on the deployed artifact, not on a developer machine.
The pipeline already exists — use it rather than inventing a parallel one.

### 1. Verify locally

```sh
# Unit checks. Add your new ones to this line in next-site.yml in the same change.
node --test src/Next/Assets/model-cache.test.mjs src/Next/browser/runtime.test.mjs \
  src/Next/fresh-review.test.mjs src/Next/photo-selection.test.mjs \
  src/Next/photo/crop-view.test.mjs src/Next/estimate.test.mjs \
  src/Next/testing-link.test.mjs src/Next/route-choice.test.mjs \
  src/Next/route-report.test.mjs hosting/next-cloudflare/worker.test.mjs

# Contract and codec checks
dotnet fable src/App.fsproj --outDir /tmp/fable-check
node src/Next/verify-fable.mjs /tmp/fable-check/Next/ProjectJson.js

# Drive the real compiled UI, not a mock. The script expects the built site on
# http://127.0.0.1:8080/ — serve the staged output there first. It writes
# next-artifact-ui.json and is not executable by default, so invoke it with bash.
bash scripts/check-next-artifact.sh
```

A unit test passing is not evidence the product behaves. Every gate in this document is
phrased as observable behaviour for that reason — drive the UI.

### 2. Validate the artifact in CI

`next-site.yml` builds from a clean checkout and calls `next-e2e.yml` as a reusable workflow,
so the same run builds and qualifies the same bytes. `next-matrix.yml` covers the other
engines. `scripts/next-e2e.md` documents the manual dispatch path and, importantly, what that
job does **not** cover: no GPU, no physical phone, no desktop packaging, no cross-browser
parity, no offline install.

**If you add a behaviour, add its check.** `promote.py` enforces this required set:

```
nameSeed  repeatOriginal  syntheticPhotoE4e  localCrop  projectSaveReopen  morphPlayableMp4
```

A new capability with no entry there ships behind a gate that does not test it. Add the check
to `scripts/next-e2e-browser.py` **and** to `required` in `promote.py` in the same change.
Never remove or weaken one of the existing six to make a run green.

### 3. Deploy

```sh
python3 hosting/next-static/promote.py \
  --build-run <next-site run id> \
  --qualification-run <same id, unless qualified separately> \
  --runtime <runtime directory> \
  --catalogue hosting/next-static/catalogue.json \
  --work review/next-delivery/<name> \
  --publish
```

`promote.py` refuses unless both runs succeeded on this repo and workflow path, the web
artifact verifies against the build revision, all six required checks passed, the
qualification's `SHA256SUMS` is byte-identical to the build's, and the runtime manifest hash
equals the qualified `report.runtimeSha256`. It has refused a wrong-runtime attempt in
practice — treat a refusal as correct until proven otherwise.

**Promote the exact qualified bytes. Never rebuild to publish.** Needs `gh` authenticated and
`npx wrangler whoami` working. Keep the receipt it writes.

Note that `master` has no branch protection. The promotion path is gated regardless, so the
discipline above is what stands in for it.

### 4. Validate the deployment

Against the public URL, from a client with **no DNS override** — an earlier probe used
`--host-resolver-rules` and produced a convincing false failure report from a local
`SimpleHTTP` server. Check `Server` and `cf-ray` headers to prove which origin answered.

- Fresh client: acquire → generate → export, on the real deployment.
- Asset integrity: every chunk the runtime manifest references returns HTTP 200 at its exact
  expected size.
- The specific gates for the items in this run, re-checked against the deployed bytes.
- Record what you could not check and why. A simulator row is not a phone row.

## Claiming done

**READY FOR RE-TEST** is claimable only when all of the following hold:

1. The parity criterion in the feedback document holds on at least one **recorded device
   row**, with the route named.
2. Every ledger entry has a budget and meets it. **An overhead with no ledger entry fails
   the gate** — that is the rule that keeps this from regressing.
3. A consented mid-run report round-trips and its reference is capturable by a human.
4. The visual gates pass at both widths.
5. The six existing `next-e2e` workflow checks still pass, unchanged and unweakened, and any
   new behaviour has its own check in both `next-e2e-browser.py` and `promote.py`.
6. The change is **promoted and live**, validated against the public deployment from a client
   with no DNS override, with the promotion receipt retained.

Anything not measured is reported as **not measured**. A simulator row is not a phone row. A
green CI build is not a device result. Missing evidence is not a pass.

## Traps

- **Library versions are never a reason not to build the design.** What is installed today
  is MUI v4 (`@material-ui/core ^4.12.3`, `Feliz.MaterialUI 1.2.6`, React 17), so v4 idioms
  — `makeStyles` and `classes` rather than `sx` — are the path of least resistance and
  `FancyButton.fs` shows the pattern. **If v5, or a different library, or no library serves
  the specified design better, upgrade or swap it.** The design in
  [candidate visual alignment](candidate-visual-alignment.md) is the requirement; the
  component library is an implementation detail. Cost to budget honestly if you do: the F#
  bindings are pinned alongside the npm package (`Feliz.MaterialUI` tracks MUI v4), and MUI
  v5 wants React 18, so an upgrade touches `App.fsproj`, `package.json` and the classic
  pages too — it is a real piece of work, not a blocker. Decide it on merit and record the
  decision; never quietly downgrade the design to fit the installed version.
- **Playwright's Chromium and WebKit ship without proprietary codecs.** H.264 playback is
  already recorded as not checkable in automation; the same applies to WebCodecs H.264
  *encode*. Plan for a real-browser evidence row rather than discovering this at
  qualification.
- **Do not weaken a numerical gate to make a stage green.** RGB max 1 and sampled float
  0.002 are fixed. If a change cannot meet them, the change is wrong.
- **`next-e2e` selects the CPU route through the Processing mode control.** U-09 moves that
  control; keep it reachable and keyboard-operable or the qualification breaks.
- **Do not start the native desktop GPU matrix.** It is explicitly later work.

## Status update — 18 September

- **C-08 descoped from the release gate** (operator decision after cost review): the
  CI-blocking parity job is dropped from `next-e2e.yml`; `scripts/next-parity-browser.py`
  stays for a non-blocking scheduled tripwire after release. Enforcement remains the unit
  determinism suite, per-device canary correctness (31/31, RGB max 1, float 0.002), and the
  e2e artifact checks.
- **WebGPU route fixed in the bundle**: ORT's JSEP loader fell back to the relative
  specifier `./ort-wasm-simd-threaded.jsep.mjs`, unresolvable against a blob: base, so the
  route died ("no available backend found") the first time it ran from served bytes.
  `webgpu-engine.mjs` now verifies the pinned module bytes and rewrites that one literal to
  the verified factory blob URL. First WebGPU-capable qualification still pending (matrix work).
- **Known issue for webgpu enablement**: a cold acquire's `Cache.put` commit phase emits no
  progress events, so a large first-asset write can exceed the 300 s stall watchdog
  ("Generation stopped responding"). Needs progress coverage or an acquire-scoped stall
  window before the webgpu row is qualified in-product.
- **Harness restructured** (`scripts/next-e2e-browser.py`): locator table, named stages with
  stage-tagged failures, seconds-fast preflight, `E2E_UNTIL`/`E2E_SKIP` for bounded local
  runs (skips never set `passed`). `scripts/next-e2e-server.py` mirrors pinned runtime
  assets on disk (keyed by per-file manifest sha) with a 256 MiB bound and sha-verified
  seeding, because the public origin now 404s the pinned landmarks `.dat` and caps nothing
  near the webgpu segment sizes.

# Integrated-verification harness (fm-48bj)

Shared helpers for every verify bead. They make a journey drive the app the way a person does, bind each run to one
artifact digest, and map every case to the flow-matrix row or candidate defect it grades. The code is in
`apps/web/test/verify/`.

| Module | What it gives a journey |
| --- | --- |
| `harness.ts` | Plain values only:<br>• `SWEEP_WIDTHS`, `GRID_COUNTS`, face and slot counts, `TOUCH_TARGET_PX` (44)<br>• `textVariants()`: empty, whitespace, exactly 512 and 513 UTF-8 bytes with multibyte characters, pasted, IME<br>• `SEEDS`: 0, 4,294,967,295, 4,294,967,296, -1, 1.5, and pasted digits with spaces<br>• `breakpoints()`, `builtBreakpoints()`, `sweepPoints()`, `visualOrderProblems()`<br>• the case manifest |
| `operated.ts` | `operatedClick` and `operatedTap`, `typeOperated` (one step per keystroke, fails on a request), `StepLog` |
| `artifact.ts` | `serveArtifact(root, digest)`, `artifactDigest`, `bindOrigins` and `classOf` (per-run host-class binding) |
| `drivers.ts` | `sweep`, `resizeThrough`, `tabWalk`, `focusReturns`, `forCounts`, `withStorageQuota` |
| `fixtures.ts` | `FIXTURES` with digests, and `fixtureFindings` |

## Operated input

Use by-name and by-role locators only for setup. Every press goes through `operatedClick` (real mouse) or
`operatedTap` (real touch). Both:

1. Scroll as a person can: the page, and containers with `overflow: auto` or `scroll`. They never scroll inside an
   `overflow: hidden` container, so a clipped control stays clipped.
2. Take the centre of the control's box. The centre must be inside the viewport and inside the declared `region`,
   for example `{ within: image, part: 'top-right' }` for Remove.
3. Require `document.elementFromPoint` at that point to be the control or one of its descendants. A fading overlay
   gets `settleMs` (3 s by default) to clear, and the control is measured again on each try.
4. Send the real input, then run `effect` inside the step, so the requests the press causes count towards it.

A failure throws. The message names the element actually hit and includes the full step log.

Targets under 44 px are reported as `smallTarget`; they are never passed silently.

Device-lab cells run the same rules through `tools/device-lab/lab.py`: OS-level `adb input tap` on the P30 Pro and a
real mouse on eris. `--journey operated` proves this on the defect-1 page. Emulated touch never stands in for a phone
cell when a case claims phone behaviour.

## Step log

`StepLog` records one JSON line per step:
- step ID (`<bead key>/<case id>/<step>`);
- control, input and point;
- the element hit;
- target size and `smallTarget`;
- requests per host class (count and bytes).

When a run is tagged, its first line is the run tag (`digest`, `kind`, `source`).

Requests are observed, never stubbed. Grouping is by origin until the request-interception helper (fm-o8xn) supplies
host classes through the `classify` argument. Journey assertions use that helper's `assertNoRequests`,
`assertOrder` and `bytesBy`; this harness does not reimplement them.

Write the log with `log.write(path)` as a CI artifact. It is also printed in full on failure.

## Artifact and host classes

`serveArtifact(root, digest)` checks `deploy-next/` against `next-site-identity.json`, using `readIdentity` from
`scripts/import/build-next.mjs`. It then checks the digest: SHA-256 over `<sha256>  deploy-next/<path>\n` lines
sorted by path, the same as the goldens' `deploy_next_sha256`.

Any finding, or a different digest, aborts the run before a browser starts. Staging URLs are not a target yet,
because no staging deploy serves its identity.

`bindOrigins(defaultMap, { app: [served origin] })` puts the run's origins on the helper's default host map, without
adding any class. With `classOf`, data: and blob: URLs are `local`, a mapped origin gets its class, and anything else
is `third-party`.

## Case manifest

Each verify bead declares its cases as a `CaseManifest`:

```ts
const manifest: CaseManifest = {
  bead: 'verify.input', // the bead's plan key
  cases: [
    {
      id: 'remove-to-one', // lower-case words; unique in the manifest
      steps: ['press-remove', 'confirm-one-left'], // step IDs are verify.input/remove-to-one/<step>
      rows: ['remove-down-to-one'], // flow-matrix rows it grades (apps/web/test/parity/rows.ts)
      defects: [1], // candidate defect numbers it grades
      cells: ['phone-cpu', 'eris-webgpu'], // device-lab cells it runs on
      widths: [390, 1280], // emulated widths
    },
  ],
};
```

`manifestProblems(manifest, knownRows)` returns an empty list for a valid manifest. These fail validation:
- a case with no row and no defect;
- an unknown flow-matrix row;
- an unknown lab cell;
- a duplicate case ID;
- an empty step list;
- a bead key or ID that isn't lower-case words;
- a non-integer width or defect number.

The matrix grader (`verify.join`, fm-fy2.11) reads these manifests.

## Width sweep, keyboard and counts

`sweepPoints(touchBreakpoint, builtBreakpoints(dist))` includes:
- every `SWEEP_WIDTHS` width, with touch emulation at or below the breakpoint;
- each media and container-query breakpoint in the built CSS at -1, 0 and +1 px (this build and the control
  have 14, from 600 to 1408);
- portrait and landscape phones, and a short window;
- 200 % zoom: a 640 CSS px layout at device scale 2;
- 200 % text: the root font size, which is what the browser preference changes.

`sweep()` takes screenshots at 390 and 1280 px and at every failure. It collects failures rather than throwing, so
one width doesn't hide another.

Virtual-keyboard occlusion needs a real phone. It runs in the phone cells and is untested in emulation.

`tabWalk()` walks with Tab or Shift+Tab, checking `:focus-visible` at each stop. `visualOrderProblems()` compares
the stops with reading order. `focusReturns()` checks that focus comes back to the opener after a dialog closes.

`forCounts()` runs a check at each count. `withStorageQuota()` sets a quota that Chromium enforces in a persistent
profile (`launchPersistentContext`). Judge it by a refused write: `estimate()` does not report the override, and
incognito contexts ignore it. Other engines report `untested`.

## Fixtures

`FIXTURES` names each fixture once, with its digest:
- a generated face with no EXIF or XMP;
- several faces;
- no face;
- an EXIF-rotated photo (from fm-bbhu's synthetic crop fixtures);
- schema 1, schema 2 PNG and schema 2 WebP recovery stills;
- a model-mismatched still;
- a damaged still;
- a saved project MP4;
- the defect-1 page.

`apps/web/test/fixtures/verify/make-stills.mjs` writes the stills and the MP4 with the candidate's own writers
(`apps/web/src/Next`, the a42829b bytes), reads them back, and is deterministic. There are no photos of people and
no weights.

The schema 1 still uses a realistic latent. With it, the candidate's `recoverImage` throws "Recovery metadata exceeds
limit." That defect is recorded on fm-1muu.

## Running

```sh
cd apps/web
node --test test/build/verify-*.test.ts                   # plain values (part of npm test)
npm run build && npm run build:next --prefix ../..        # dist/ and the pinned control
node --test test/e2e/verify-*.e2e.ts                      # Chromium, Firefox, WebKit (web-shell e2e lane)
cd ../../tools/device-lab && uv run --with playwright python lab.py run --cell phone-cpu --journey operated
```

Run browser work on eris under the device lease
(`python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 900 -- <cmd>`).

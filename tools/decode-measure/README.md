# fm-4cp decode-ceiling measurement

Measures peak transient bytes of every supported image decode route of the candidate
(classic `src/Next`), on the available workers, at the single-input limits
(`CROP_MAX_BYTES` 64 MiB, `CROP_MAX_PIXELS` 120x1024^2 px, `CROP_MAX_EDGE` 20000 px, read
from the candidate source, never hard-coded). Contracts milestone 2 (`fm-2o8q`) reads
these rows to set numeric ceilings; a route with no row is not admitted.

## One command (from a clean checkout)

Heavy steps run under the shared device lease (classic `autoresearch/run.py`):

```sh
cd ../facemorph.me-classic/autoresearch && python3 run.py --lane browser-cpu \
  --device eris --timeout 1800 --wait 120 -- \
  mise x uv@0.12.21 -- uv run --with playwright python \
  "$PWD/../../facemorph.me/tools/decode-measure/measure.py" --browser chromium
```

Repeat with `--browser firefox` and `--browser webkit` (the Linux CI matrix browsers).
The fixtures must exist first: `mise x uv@0.12.21 -- uv run --with playwright python
tools/decode-measure/generate_fixtures.py` (committed here, so only regeneration after
changes).

## What it measures

Routes (the candidate's real decode code, imported unmodified, module digests recorded):

- `imagebitmap-full` - unbounded `createImageBitmap(file)`: the worst case the browser
  can be forced into (this is what the bounded paths exist to avoid).
- `preview-decode` - `crop.mjs decodeBounded()`: the bounded preview decode.
- `preview-display` - `crop.mjs previewPhoto()`: bounded decode + canvas + PNG re-encode.
- `crop-decode` - `crop.mjs cropPhoto()`: crop straight to the encoder's 1024 square.
- `frame-decode-512` / `frame-decode-1024` - `media.mjs framePixels()`: morph-frame RGBA.

Representations per row: `compressed` (fixture bytes), `decoded` (real returned bitmap /
RGBA bytes), `cropped` (crop PNG blob), `cropped_canvas` (1024^2 x 4), `reencoded`
(preview PNG). Decode routes never produce tensors, so there is no tensor row; the
encoder-side tensor budget is a different bead's measurement. A JS-heap delta is recorded
where the browser exposes `performance.memory` (Chromium).

Fixtures: `typical.jpg` (12.2 MP phone class), `max-pixels.jpg` (125,821,089 px),
`max-edge.png` (20000 px edge), `max-compressed.jpg` (65.6 MB, regenerated in-page per
run from the pinned recipe - a 64 MiB file is not committed). All canvas-encoded:
metadata-free by construction, re-checked by `fixtures.test.mjs`.

## Output and status

`measurements/<machine>-<browser>.json` - raw rows + machine, browser version, classic
commit, module sha256 digests, lease run id, and an explicit `not_measured` list: the
Android emulator, iOS Simulator and physical-phone lanes are not available on eris, so
those cells are **not measured and therefore not admitted** until a lane measures them.
Failed route steps are recorded as failed rows and screenshotted under
`measurements/artifacts/`.

Measured so far (eris, 2026-10-24, classic `a42829b`): Chromium, Firefox, WebKit - all
routes x all fixtures, 0 failed steps. Headline: the bounded preview decode peaks at
4096^2x4 = 67,108,864 B regardless of source size, where the unbounded full decode of a
125 MP image peaks at ~503 MB.

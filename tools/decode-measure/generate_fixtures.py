#!/usr/bin/env python3
"""fm-4cp fixture generator: metadata-free images at the candidate's single-input limits.

Generates the three committed fixtures (typical photo, maximum pixel count, maximum edge)
and prints the pinned spec for the maximum-compressed fixture, which is generated at
measurement time (a 64 MiB file has no business in Git). Every image is canvas-encoded by
Chromium, so it carries no EXIF or textual metadata by construction; the test in this
directory re-checks the bytes anyway.

    mise x uv@0.12.21 -- uv run --with playwright python tools/decode-measure/generate_fixtures.py

Limits are read from the candidate source (src/Next/photo/crop.mjs CROP_MAX_*), not
hard-coded here; run with --classic to point at another checkout.
"""
import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

MAKE_JS = """
() => {
  window.make = async (mode, width, height, type, quality, grain) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (mode === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#102030');
      gradient.addColorStop(1, '#c0d0e0');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    } else {
      const image = context.createImageData(width, height);
      let state = 0x2545f491 >>> 0;
      const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
      for (let i = 0; i < image.data.length; i += 4) {
        const v = next() & 0xff;
        const g = grain ? (next() % (grain * 2)) - grain : 0;
        image.data[i] = Math.max(0, Math.min(255, v + g));
        image.data[i + 1] = Math.max(0, Math.min(255, (v * 7) >>> 8) + g);
        image.data[i + 2] = Math.max(0, Math.min(255, 255 - v) + g);
        image.data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }
    return canvas.convertToBlob({type, quality});
  };
  window.sizeOf = async (blob) => blob.size;
  window.base64Of = async (blob) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    await new Promise((resolve) => { reader.onload = resolve; });
    return reader.result.split(',')[1];
  };
  return true;
}
"""


def crop_limits(classic_root: Path) -> dict:
    source = (classic_root / "src/Next/photo/crop.mjs").read_text()
    limits = {}
    for name in ("CROP_MAX_BYTES", "CROP_MAX_PIXELS", "CROP_MAX_EDGE"):
        m = re.search(rf"export const {name}=([0-9*]+);", source)
        if not m:
            raise SystemExit(f"{name} not found in crop.mjs")
        limits[name] = eval(m.group(1))  # arithmetic literal like 64*1024*1024
    return limits


def write(page, path, mode, width, height, type_, quality, grain=0):
    body = base64.b64decode(
        page.evaluate(
            "([m, w, h, t, q, g]) => window.make(m, w, h, t, q, g).then(window.base64Of)",
            [mode, width, height, type_, quality, grain],
        )
    )
    path.write_bytes(body)
    return {
        "path": str(path.relative_to(ROOT)),
        "bytes": len(body),
        "pixels": width * height,
        "sha256": hashlib.sha256(body).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classic", default=str(ROOT.parent / "facemorph.me-classic"))
    parser.add_argument("--out", default=str(ROOT / "tools/decode-measure"))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    limits = crop_limits(Path(args.classic))
    max_edge = limits["CROP_MAX_EDGE"]
    pixels = limits["CROP_MAX_PIXELS"]

    manifests = {"limits": limits, "fixtures": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        page = browser.new_page()
        page.evaluate(MAKE_JS)
        # Typical photo: 12.2 MP (3024x4032), moderate quality - a common phone photo class.
        manifests["fixtures"]["typical.jpg"] = write(page, out / "typical.jpg", "noise", 3024, 4032, "image/jpeg", 0.85)
        # Maximum pixel count: just under CROP_MAX_PIXELS with a smooth gradient (small file).
        side = int(pixels**0.5)
        width, height = side, side
        while width * height > pixels:
            height -= 1
        manifests["fixtures"]["max-pixels.jpg"] = write(page, out / "max-pixels.jpg", "gradient", width, height, "image/jpeg", 0.6)
        # Maximum edge: the longest side CROP_MAX_EDGE admits, the other side sized to stay
        # under the pixel limit.
        other = min(max_edge, max(1, (pixels // max_edge) - 1))
        manifests["fixtures"]["max-edge.png"] = write(page, out / "max-edge.png", "gradient", max_edge, other, "image/png", None)
        # Maximum compressed: generated at measurement time; pin the recipe, not 64 MiB in Git.
        side = int(pixels**0.5)
        best = None
        for quality in (0.92, 0.88, 0.85, 0.8, 0.7, 0.6, 0.5):
            size = page.evaluate(
                "([m, w, h, t, q, g]) => window.make(m, w, h, t, q, g).then(window.sizeOf)",
                ["noise", side, side, "image/jpeg", quality, 24],
            )
            if size <= limits["CROP_MAX_BYTES"]:
                best = {"quality": quality, "grain": 24, "bytes": size}
                break
        if best is None:
            print("no JPEG quality under the byte limit; raise the search", file=sys.stderr)
            return 1
        manifests["fixtures"]["max-compressed.jpg"] = {
            "generated_at_measure_time": True,
            "width": side,
            "height": side,
            "max_bytes": limits["CROP_MAX_BYTES"],
            "recipe": best,
            "note": "Regenerated by measure.mjs before every run; verified against CROP_MAX_BYTES and the metadata scan. Not committed (64 MiB).",
        }
        browser.close()

    (out / "fixtures.json").write_text(json.dumps(manifests, indent=2) + "\n")
    print(json.dumps(manifests["fixtures"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

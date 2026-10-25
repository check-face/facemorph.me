#!/usr/bin/env python3
"""fm-4cp decode-ceiling measurement: peak transient bytes per decode route x fixture.

Runs the CANDIDATE decode code (classic src/Next/photo/crop.mjs, src/Next/media.mjs) in a
real browser against the fixtures in tools/decode-measure/, and writes one JSON row per
route x fixture x representation: compressed, decoded, cropped and re-encoded bytes, plus
a JS-heap delta where the browser exposes one. Phone lanes (Android emulator, iOS
Simulator) are not available on this machine and are listed as not measured -> not
admitted.

Run from this repository with a bounded GPU timing lock for a measurement campaign:

    python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 1800 -- \
      mise x uv@0.12.21 -- uv run --with playwright python \
      tools/decode-measure/measure.py --browser chromium

"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROMIUM = "/usr/bin/chromium"

MEASURE_JS = """
async (spec) => {
  const {routes, fixtureUrl, generate} = spec;
  const crop = await import('/src/Next/photo/crop.mjs');
  let media = null;
  try { media = await import('/src/Next/media.mjs'); } catch (error) { media = {importError: String(error)}; }
  let file;
  if (fixtureUrl) {
    const response = await fetch(fixtureUrl);
    file = new File([await response.blob()], 'fixture', {type: response.headers.get('content-type') || 'application/octet-stream'});
  } else {
    file = await window.__makeFile(generate);
  }
  const compressed = file.size;
  const out = [];
  const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : null);

  async function step(name, fn) {
    const before = heap();
    const t0 = performance.now();
    try {
      const detail = await fn();
      const after = heap();
      out.push({route: name, ok: true, ms: Math.round(performance.now() - t0), compressed_bytes: compressed,
                heap_delta_bytes: before != null && after != null ? after - before : null, ...detail});
    } catch (error) {
      out.push({route: name, ok: false, error: String((error && error.message) || error)});
    }
  }

  if (routes.includes('imagebitmap-full')) {
    await step('imagebitmap-full', async () => {
      const bitmap = await createImageBitmap(file);
      const decoded = bitmap.width * bitmap.height * 4;
      const dims = [bitmap.width, bitmap.height];
      bitmap.close();
      return {decoded_bytes: decoded, decoded_dims: dims};
    });
  }
  if (routes.includes('preview-decode')) {
    await step('preview-decode', async () => {
      const r = await crop.decodeBounded(file, {});
      const decoded = r.bitmap.width * r.bitmap.height * 4;
      const dims = [r.bitmap.width, r.bitmap.height];
      const source = [r.width, r.height];
      r.bitmap.close();
      return {decoded_bytes: decoded, decoded_dims: dims, source_dims: source, scale: r.scale};
    });
  }
  if (routes.includes('preview-display')) {
    await step('preview-display', async () => {
      const r = await crop.previewPhoto(file, {});
      const reencoded = r.blob.size;
      URL.revokeObjectURL(r.url);
      return {decoded_bytes: r.previewWidth * r.previewHeight * 4, decoded_dims: [r.previewWidth, r.previewHeight],
              source_dims: [r.sourceWidth, r.sourceHeight], reencoded_png_bytes: reencoded};
    });
  }
  if (routes.includes('crop-decode')) {
    await step('crop-decode', async () => {
      const preview = await crop.previewPhoto(file, {});
      URL.revokeObjectURL(preview.url);
      const rect = {left: 0, top: 0, width: preview.previewWidth, height: preview.previewHeight};
      const cropped = await crop.cropPhoto(file, rect, {previewScale: preview.scale});
      const bytes = await cropped.arrayBuffer();
      return {cropped_bytes: cropped.size, cropped_canvas_bytes: 1024 * 1024 * 4, cropped_png_sha256: window.__sha(bytes)};
    });
  }
  if (media && !media.importError) {
    for (const size of routes.includes('frame-decode-1024') ? [512, 1024] : [512]) {
      await step('frame-decode-' + size, async () => {
        const pixels = await media.framePixels(file, size);
        return {decoded_bytes: pixels.length, decoded_dims: [size, size]};
      });
    }
  } else if (routes.some((r) => r.startsWith('frame-decode'))) {
    out.push({route: 'frame-decode-*', ok: false, error: 'media.mjs import failed: ' + (media && media.importError)});
  }
  return out;
}
"""

SHA_JS = """
() => {
  window.__sha = async (buffer) => {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  window.__makeFile = async (spec) => {
    // Browser JPEG encoders differ: tune the quality downward until the file fits the byte
    // limit (largest that fits), so every browser measures at the maximum compressed size.
    let blob;
    for (const quality of spec.qualities) {
      const candidate = await window.__encode(spec, quality);
      if (candidate.size <= spec.max_bytes) { blob = candidate; spec.used_quality = quality; break; }
    }
    if (!blob) throw new Error('no JPEG quality fit under the byte limit');
    return new File([blob], 'max-compressed.jpg', {type: spec.type});
  };
  window.__encode = async (spec, quality) => {
    const canvas = new OffscreenCanvas(spec.width, spec.height);
    const context = canvas.getContext('2d', {willReadFrequently: true});
    const image = context.createImageData(spec.width, spec.height);
    let state = 0x2545f491 >>> 0;
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
    for (let i = 0; i < image.data.length; i += 4) {
      const v = next() & 0xff;
      const g = (next() % (spec.grain * 2)) - spec.grain;
      image.data[i] = Math.max(0, Math.min(255, v + g));
      image.data[i + 1] = Math.max(0, Math.min(255, (v * 7) >>> 8) + g);
      image.data[i + 2] = Math.max(0, Math.min(255, 255 - v) + g);
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.convertToBlob({type: spec.type, quality});
  };
  return true;
}
"""


def classic_commit(classic: Path) -> str:
    return subprocess.run(["git", "-C", str(classic), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def module_digests(classic: Path) -> dict:
    out = {}
    for rel in ("src/Next/photo/crop.mjs", "src/Next/photo/image-header.mjs", "src/Next/media.mjs"):
        out[rel] = hashlib.sha256((classic / rel).read_bytes()).hexdigest()
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=["chromium", "firefox", "webkit"], default="chromium")
    parser.add_argument("--fixtures", default=str(ROOT / "tools/decode-measure"))
    parser.add_argument("--classic", default=str(ROOT.parent / "facemorph.me-classic"))
    parser.add_argument("--out", default=str(ROOT / "packages/stylegan-js/src/contracts/decode-measurements"))
    args = parser.parse_args()
    classic = Path(args.classic)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((Path(args.fixtures) / "fixtures.json").read_text())
    limits = manifest["limits"]
    run_id = os.environ.get("FACEMORPH_RUN") or "direct-command"

    with tempfile.TemporaryDirectory() as temp:
        served = Path(temp)
        os.symlink((classic / "src").resolve(), served / "src")
        os.symlink(Path(args.fixtures).resolve(), served / "fixtures")
        handler = http.server.SimpleHTTPRequestHandler
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **kw: handler(*a, directory=str(served), **kw))
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

        rows = []
        with sync_playwright() as p:
            engine = getattr(p, args.browser)
            launch = {"executable_path": CHROMIUM, "args": ["--no-sandbox"]} if args.browser == "chromium" else {}
            browser = engine.launch(**launch)
            version = browser.version
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/src/Next/photo/crop.mjs", wait_until="load")  # same-origin base
            page.evaluate(SHA_JS)
            failures = []
            document_extra = None

            fixtures = {}
            for name in ("typical.jpg", "max-pixels.jpg", "max-edge.png"):
                fixtures[name] = {"url": f"/fixtures/{name}"}
            spec = manifest["fixtures"]["max-compressed.jpg"]
            qualities = sorted({spec["recipe"]["quality"], 0.92, 0.9, 0.88, 0.85, 0.8, 0.7, 0.6, 0.5}, reverse=True)
            fixtures["max-compressed.jpg"] = {
                "generate": {"width": spec["width"], "height": spec["height"], "type": "image/jpeg", "qualities": qualities, "grain": spec["recipe"]["grain"], "max_bytes": limits["CROP_MAX_BYTES"]},
            }

            route_sets = {
                "typical.jpg": ["imagebitmap-full", "preview-decode", "preview-display", "crop-decode", "frame-decode-1024"],
                "max-compressed.jpg": ["imagebitmap-full", "preview-decode", "preview-display", "crop-decode"],
                "max-pixels.jpg": ["imagebitmap-full", "preview-decode", "preview-display", "crop-decode"],
                "max-edge.png": ["imagebitmap-full", "preview-decode", "crop-decode"],
            }
            for name, routes in route_sets.items():
                fixture = fixtures[name]
                if "url" in fixture:
                    found = page.evaluate(MEASURE_JS, {"routes": routes, "fixtureUrl": fixture["url"]})
                else:
                    found = page.evaluate(MEASURE_JS, {"routes": routes, "fixtureUrl": None, "generate": fixture["generate"]})
                if name == "max-compressed.jpg" and found:
                    document_extra = found[0].get("compressed_bytes")
                for entry in found:
                    if not entry.get("ok"):
                        failures.append((name, entry.get("route"), entry.get("error")))
                        artifacts = out / "artifacts"
                        artifacts.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(artifacts / f"{args.browser}-{name}-{entry.get('route', 'x')}.png"), full_page=False)
                    for representation, key in (("compressed", "compressed_bytes"), ("decoded", "decoded_bytes"), ("cropped", "cropped_bytes"), ("reencoded", "reencoded_png_bytes"), ("cropped_canvas", "cropped_canvas_bytes")):
                        if key in entry:
                            rows.append({
                                "route": entry["route"], "fixture": name, "representation": representation,
                                "peak_bytes": entry[key], "ok": True, "ms": entry.get("ms"), "heap_delta_bytes": entry.get("heap_delta_bytes"),
                            })
                    if entry.get("cropped_png_sha256"):
                        rows[-1]["artifact_sha256"] = entry["cropped_png_sha256"]
                    if not entry.get("ok"):
                        rows.append({"route": entry["route"], "fixture": name, "representation": None, "ok": False, "error": entry.get("error")})
            browser.close()
        httpd.shutdown()

    machine = socket.gethostname()
    if failures:
        print(f"{len(failures)} route step(s) failed; screenshots in {out / 'artifacts'}", file=sys.stderr)
    document = {
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "max_compressed_actual_bytes": document_extra,
        "machine": machine,
        "browser": args.browser,
        "browser_version": version,
        "classic_commit": classic_commit(classic),
        "modules": module_digests(classic),
        "lease_run_id": run_id,  # persisted measurement schema; value is the current FACEMORPH_RUN ID
        "limits": limits,
        "rows": rows,
        "not_measured": [
            {"route": route, "fixture": fixture, "reason": "lane unavailable on this machine (Android emulator / iOS Simulator / physical phone lanes run in CI or the device lab); unmeasured routes are not admitted"}
            for route in ("imagebitmap-full", "preview-decode", "preview-display", "crop-decode", "frame-decode-1024")
            for fixture in ("typical.jpg", "max-compressed.jpg", "max-pixels.jpg", "max-edge.png")
        ],
    }
    target = out / f"{machine}-{args.browser}.json"
    target.write_text(json.dumps(document, indent=1) + "\n")
    print(f"rows: {len(rows)} -> {target}")
    return 0


def args_classic_default():
    return str(ROOT.parent / "facemorph.me-classic")


if __name__ == "__main__":
    sys.exit(main())

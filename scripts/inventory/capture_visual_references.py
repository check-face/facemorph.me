#!/usr/bin/env python3
# fm-p7v visual references (read-only): screenshot the three live release surfaces at two
# viewports and record what was served at capture time.
#
#   mise x uv@0.12.21 -- uv run --with playwright python scripts/inventory/capture_visual_references.py
#
# Writes:
#   inventory/visual-references/*.png      (never committed; see .gitignore)
#   inventory/visual-references.json       (committed manifest; one entry per capture)
# and logs one JSON line per capture to stdout: url, viewport, http status, bytes, sha256.
# The durable copy lives as release assets of this repository (same store as the control
# artifact, PLAN.md "Control custody"); the manifest records the asset URLs once uploaded.
# Every navigation is a plain GET of a public page; no form data is sent anywhere.
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "inventory" / "visual-references"
MANIFEST = ROOT / "inventory" / "visual-references.json"
CHROMIUM = "/usr/bin/chromium"

VIEWPORTS = {"390": {"width": 390, "height": 844}, "1280": {"width": 1280, "height": 800}}

# name, url, viewport, interaction (None or ("picker",)) - "picker" opens the embedded
# names picker on legacy production (per-input Browse Names button, dark "Select an
# Image" header with an X), which is one of the operator's visual references.
CAPTURES = [
    ("legacy-production", "https://facemorph.me/", w, None)
    for w in VIEWPORTS
] + [
    ("legacy-production-picker", "https://facemorph.me/", w, "picker")
    for w in VIEWPORTS
] + [
    ("names-site", "https://names.facemorph.me/", w, None)
    for w in VIEWPORTS
] + [
    ("next-site", "https://next.facemorph.me/", w, None)
    for w in VIEWPORTS
]

BUILD_ID = re.compile(r"next-[0-9a-f]{8,}")


def served_identity(html: bytes) -> dict:
    """Artifact identity read from the served bytes at capture time."""
    text = html.decode("utf-8", "replace")
    m = BUILD_ID.search(text)
    if m:
        return {"kind": "build-id", "value": m.group(0), "html_sha256": hashlib.sha256(html).hexdigest()}
    return {"kind": "html-digest", "value": hashlib.sha256(html).hexdigest()}


def open_picker(page) -> str:
    """Open the embedded names picker; returns what happened, for the log."""
    for label in ("Browse Names", "Choose Names", "Names"):
        button = page.get_by_role("button", name=label).first
        if button.count() > 0:
            button.click()
            break
    else:
        return "no Browse Names button found"
    try:
        page.get_by_text("Select an Image").first.wait_for(timeout=8000)
        return "picker open"
    except PWTimeout:
        return "picker did not open"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"])
        for name, url, width, interaction in CAPTURES:
            page = browser.new_page(viewport=VIEWPORTS[width], device_scale_factor=1)
            record = {
                "name": name,
                "url": url,
                "viewport": {"width": width, "height": VIEWPORTS[width]["height"]},
                "captured_at": None,
                "http_status": None,
                "png": None,
                "png_sha256": None,
                "png_bytes": None,
                "served": None,
                "note": None,
            }
            try:
                response = page.goto(url, timeout=45000, wait_until="load")
                page.wait_for_timeout(2500)  # fonts, first paint, client hydration
                record["http_status"] = response.status if response else None
                if interaction == "picker":
                    record["note"] = open_picker(page)
                    page.wait_for_timeout(1200)
                body = response.body() if response else b""
                record["served"] = served_identity(body) if body else None
                png = page.screenshot(full_page=True, animations="disabled")
                record["captured_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                path = OUT_DIR / f"{name}-{width}.png"
                path.write_bytes(png)
                record["png"] = str(path.relative_to(ROOT))
                record["png_sha256"] = hashlib.sha256(png).hexdigest()
                record["png_bytes"] = len(png)
            except Exception as exc:  # noqa: BLE001 - log the failure, keep capturing
                record["note"] = f"FAILED: {type(exc).__name__}: {exc}"
                failures += 1
            print(json.dumps(record), flush=True)
            entries.append(record)
            page.close()
        browser.close()

    MANIFEST.write_text(
        json.dumps(
            {
                "description": "Dated visual references of the live release surfaces (bead fm-p7v). PNGs are stored outside Git; the durable copy is release assets of this repository (same store as the control artifact).",
                "browser": f"system Chromium via Playwright ({CHROMIUM})",
                "captures": entries,
            },
            indent=2,
            sort_keys=False,
        )
        + "\n"
    )
    print(f"manifest: {MANIFEST}  failures: {failures}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

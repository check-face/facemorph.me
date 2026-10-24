"""Writes apps/web/src/contracts/ceilings.vectors.json (fm-2o8q).

An independent second writing of the ceilings: the decode bounds are recomputed here from the raw
fm-4cp measurement rows, and every other value is written out again from the candidate source it cites
(classic a42829b). test/contracts/ceilings.test.ts fails when ceilings.ts and this file disagree, so a
change to either is a visible contract revision. Run from the repository root:

    python3 tools/ceilings/make_vectors.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEASUREMENTS = ROOT / "packages/stylegan-js/src/contracts/decode-measurements"
OUT = ROOT / "apps/web/src/contracts/ceilings.vectors.json"

MiB = 1024 * 1024
CROP_MAX_BYTES = 64 * MiB  # photo/crop.mjs
ROUTES = ["preview-decode", "preview-display", "crop-decode", "frame-decode-512", "frame-decode-1024"]
LANES = ["eris-chromium", "eris-firefox", "eris-webkit"]
CHUNK = 16 * MiB  # Assets/model-cache.mjs: no chunk part over 16 MiB


def decode_bounds():
    bounds = {}
    for lane in LANES:
        m = json.loads((MEASUREMENTS / f"{lane}.json").read_text())
        assert m["limits"]["CROP_MAX_BYTES"] == CROP_MAX_BYTES, lane
        per = {}
        for row in m["rows"]:
            if not row["ok"]:
                sys.exit(f"{lane}: failed row {row}")
            held = per.setdefault(row["route"], {}).setdefault(row["fixture"], 0)
            if row["representation"] != "compressed":
                per[row["route"]][row["fixture"]] = held + row["peak_bytes"]
            elif row["peak_bytes"] > CROP_MAX_BYTES:
                sys.exit(f"{lane}: compressed fixture over CROP_MAX_BYTES")
        bounds[lane] = {route: CROP_MAX_BYTES + max(per[route].values()) for route in ROUTES}
    return bounds


def main():
    bounds = decode_bounds()
    preview = {bounds[lane]["preview-decode"] for lane in LANES}
    assert len(preview) == 1, preview
    rows = []
    for lane in LANES:
        for route in ROUTES:
            rows.append(("DECODE_TRANSIENT_BYTES", f"decode-route:{lane}:{route}", "bytes", bounds[lane][route], "choose-smaller-photo"))
    rows += [
        ("RETAINED_SOURCE_BYTES", "all-routes", "bytes", CROP_MAX_BYTES, "choose-smaller-photo"),
        ("CROP_BUFFER_BYTES", "all-routes", "bytes", 1024 * 1024 * 4, "remove-retry-input"),
        ("BATCH_RETAINED_INPUT_BYTES", "all-routes", "bytes", preview.pop(), "reduce-selection"),
        ("MORPH_FRAME_BUDGET", "all-routes", "frames", 4096, "shorten-morph"),
        ("STORED_SESSION_BYTES", "all-routes", "bytes", 32 * MiB, "reduce-selection"),
        ("PROJECT_FILE_PARSE_BYTES", "all-routes", "bytes", 64 * MiB, "refuse-file"),
        ("SESSION_FILE_PARSE_BYTES", "all-routes", "bytes", 32 * MiB, "refuse-file"),
        ("IMAGE_PREPARATION_BYTES", "all-routes", "bytes", 8 * MiB, "wait"),
        ("FILE_ENCODE_BYTES", "all-routes", "bytes", 48 * MiB, "shorten-morph"),
        ("PREPARED_FILE_CACHE_MAX_BYTES", "all-routes", "bytes", 48 * MiB + 2 * 8 * MiB, "not-retained"),
    ]
    for memory, chunks in (("constrained-or-unknown", 2), ("ample", 4)):
        scope = f"memory-class:{memory}"
        rows += [
            ("ACQUISITION_READ_AHEAD_BYTES", scope, "bytes", chunks * CHUNK, "wait"),
            ("ACQUISITION_HASH_BYTES", scope, "bytes", CHUNK + 64, "wait"),
            ("ACQUISITION_WRITE_BUFFER_BYTES", scope, "bytes", CHUNK, "wait"),
        ]
    rows += [
        ("LIVE_RESIDENT_BYTES", "all-routes", "bytes", 256 * MiB, "wait"),
        ("LIVE_SESSIONS", "all-routes", "sessions", 2, "wait"),
        ("ENGINE_LIVE_ENCODER_SESSIONS", "all-routes", "sessions", 1, "wait"),
        ("ENGINE_WASM_HEAP_BYTES", "compute-route:cpu", "bytes", 256 * MiB, "wait"),
        ("ENGINE_RETAINED_FRAMES", "all-routes", "frames", 4096, "wait"),
        ("ENGINE_RETAINED_FRAME_BYTES", "all-routes", "bytes", 128 * MiB, "wait"),
        ("ENGINE_CODEC_QUEUE_FRAMES", "all-routes", "frames", 8, "wait"),
        ("ENGINE_GPU_BUFFER_BYTES", "compute-route:webgpu", "bytes", 1025 * 1025 * 32 * 4, "wait"),
        ("PREFLIGHT_SAMPLING_MS", "all-routes", "ms", 2000, "wait"),
        ("PREFLIGHT_UI_DEADLINE_MS", "all-routes", "ms", 5000, "wait"),
        ("PREFLIGHT_SCRATCH_BYTES", "all-routes", "bytes", 16 * MiB, "wait"),
        ("PREFLIGHT_CHECKER_CODE_BYTES", "all-routes", "bytes", 100 * 1024, "wait"),
    ]
    not_admitted = [
        {"name": "DECODE_TRANSIENT_BYTES", "scope": f"decode-route:{lane}:imagebitmap-full"}
        for lane in LANES
    ] + [
        {"name": "DECODE_TRANSIENT_BYTES", "scope": f"decode-route:{lane}:{route}"}
        for lane in ("android-emulator", "ios-simulator", "physical-phone", "macos-desktop")
        for route in ROUTES
    ]
    document = {
        "contract": "fm-2o8q ceilings v1: inclusive limits; at boundary admitted, one over refused with its action",
        "classicCommit": "a42829bb0582b5a7a55ba6b1045a05861612b8a5",
        "ceilings": [
            {
                "name": name,
                "scope": scope,
                "unit": unit,
                "value": value,
                "atBoundary": {"requested": value, "ok": True, "remaining": 0},
                "oneOver": {"requested": value + 1, "ok": False, "action": action},
            }
            for name, scope, unit, value, action in rows
        ],
        "notAdmitted": not_admitted,
    }
    OUT.write_text(json.dumps(document, indent=1) + "\n")
    print(f"{len(rows)} ceilings, {len(not_admitted)} not admitted -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

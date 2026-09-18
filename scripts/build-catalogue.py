#!/usr/bin/env python3
"""Build the public gallery catalogue the product reads.

Merges the display names from the previous catalogue with the verified asset
ledger, so every published asset is reachable — not only the 200px previews.

  python3 scripts/build-catalogue.py \
      --ledger ../review-artifacts/static-assets-2026-09-16/verified-selection.json \
      --previous hosting/next-static/catalogue.json \
      --out hosting/next-static/catalogue.json

`hosting/next-static/catalogue.json` is the tracked source that `promote.py --catalogue`
publishes. The copy under `public/` is staged build output and is gitignored.

These are historic lossy previews. They are never canonical originals and must
never be written into the device originals cache.
"""
import argparse, json, sys
from pathlib import Path

ORIGIN = "https://facemorph-seed-gallery.cdilga.workers.dev"
# Derivation rules, verified against every entry in the ledger before writing.
text_path = lambda h, dim, fmt: f"outputImages/hash-{h[0:2]}/{h[2:4]}/hash-{h}_{dim}.{fmt}"
seed_path = lambda n, dim, fmt: f"outputImages/s{n % 100}/{n}/s{n}_{dim}.{fmt}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--previous", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--origin", default=ORIGIN)
    args = ap.parse_args()

    ledger = json.loads(Path(args.ledger).read_text())
    if not ledger.get("publicationApproved"):
        print("refusing: ledger is not publication-approved", file=sys.stderr)
        return 1
    entries = ledger["entries"]

    # Every published path must follow the documented rule, or the client cannot
    # derive URLs and this catalogue would be a lie. Check before emitting.
    for e in entries:
        if e["kind"] == "numeric-seed":
            want = seed_path(e["seed"], e["dimension"], e["format"])
        else:
            want = text_path(e["identity"][5:], e["dimension"], e["format"])
        if want != e["sourceRelativePath"]:
            print(f"refusing: path rule does not derive {e['sourceRelativePath']}", file=sys.stderr)
            return 1

    previews, fulls = {}, {}
    for e in entries:
        if e["kind"] != "public-catalogue-text-seed":
            continue
        h = e["identity"][5:]
        if e["dimension"] == 200:
            previews[e["requestValue"]] = h
        elif e["dimension"] == 1024:
            fulls[e["requestValue"]] = e["format"]

    seeds = sorted(e["seed"] for e in entries if e["kind"] == "numeric-seed")
    if seeds != list(range(seeds[0], seeds[-1] + 1)):
        print("refusing: numeric seeds are not a contiguous range", file=sys.stderr)
        return 1

    names = []
    for row in json.loads(Path(args.previous).read_text())["names"]:
        value = row["value"]
        h = previews.get(value)
        if not h:
            print(f"refusing: {value} has no verified 200px preview", file=sys.stderr)
            return 1
        # The URL is derived from `id` and `paths`; repeating it per name cost
        # 700 KB on a payload every visitor downloads.
        entry = {"name": row["name"], "value": value, "id": h}
        if value in fulls:
            entry["full"] = fulls[value]
        names.append(entry)

    catalogue = {
        "version": "2026-09-17",
        "origin": args.origin,
        "quality": "historic-lossy",
        "note": ("Preview assets only. Never canonical originals; never written to the "
                 "device originals cache."),
        "paths": {
            "text": "outputImages/hash-{h0:2}/{h2:4}/hash-{hash}_{dim}.{fmt}",
            "seed": "outputImages/s{seed mod 100}/{seed}/s{seed}_{dim}.{fmt}",
        },
        "names": names,
        "seeds": {"from": seeds[0], "to": seeds[-1], "dimension": 1024, "format": "webp"},
    }
    Path(args.out).write_text(json.dumps(catalogue, separators=(",", ":")))
    full = sum(1 for n in names if "full" in n)
    print(f"names {len(names)} ({full} with full size, {len(names)-full} preview only)")
    print(f"seeds {seeds[0]}-{seeds[-1]} at 1024 webp")
    print(f"wrote {args.out} ({Path(args.out).stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

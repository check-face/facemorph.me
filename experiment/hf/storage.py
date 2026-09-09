"""Bounded public trial artifacts. Bucket manifests are published last."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from PIL import Image
from huggingface_hub import batch_bucket_files, download_bucket_files, list_bucket_tree
from huggingface_hub.errors import EntryNotFoundError

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "generated"
RESULTS.mkdir(exist_ok=True)
BUCKET = os.getenv("TRIAL_BUCKET", "")
TOKEN = os.getenv("TRIAL_STORAGE_TOKEN", "")
MAX_RESULTS = 200


def validate_key(key):
    if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9]{64}", key):
        raise ValueError("That saved-result link is not valid.")
    return key


def location(key):
    return RESULTS / validate_key(key)


def load(key):
    folder = location(key)
    manifest = folder / "result.json"
    if not manifest.exists() and BUCKET:
        folder.mkdir(exist_ok=True)
        try:
            download_bucket_files(BUCKET, [(f"results/{key}/result.json", manifest)],
                                  raise_on_missing_files=True, token=TOKEN or False)
        except EntryNotFoundError:
            return None
    if not manifest.exists():
        return None
    data = json.loads(manifest.read_text())
    expected = ["first.png", "second.png"] + (["morph.gif"] if data["spec"]["kind"] == "morph" else [])
    for name in expected:
        path = folder / name
        if not path.exists() and BUCKET:
            download_bucket_files(BUCKET, [(f"results/{key}/{name}", path)],
                                  raise_on_missing_files=True, token=TOKEN or False)
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != data["files"][name]:
            raise ValueError("This saved result is incomplete. Please try again later.")
    return data


def ensure_capacity():
    if BUCKET:
        if not TOKEN:
            raise ValueError("Saving is temporarily unavailable; please return later.")
        count = sum(1 for f in list_bucket_tree(BUCKET, prefix="results/", recursive=True, token=TOKEN)
                    if f.path.endswith("/result.json"))
    else:
        count = sum(1 for _ in RESULTS.glob("*/result.json"))
    if count >= MAX_RESULTS:
        raise ValueError("The trial has reached its 200-result limit. Saved results still work; please send feedback while we review capacity.")


def save(key, spec, frames):
    folder = location(key)
    folder.mkdir(exist_ok=True)
    frames[0].save(folder / "first.png")
    frames[len(frames)//2 if spec["kind"] == "morph" else 1].save(folder / "second.png")
    names = ["first.png", "second.png"]
    if spec["kind"] == "morph":
        frames[0].save(folder / "morph.gif", save_all=True, append_images=frames[1:], duration=120,
                       loop=0, optimize=False, disposal=2)
        names.append("morph.gif")
    result = {"key": key, "spec": spec,
              "files": {n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in names},
              "preserved_legacy": False}
    encoded = (json.dumps(result, sort_keys=True, indent=2)+"\n").encode()
    if BUCKET:
        # No manifest is advertised until every asset is uploaded.
        batch_bucket_files(BUCKET, add=[(folder/n, f"results/{key}/{n}") for n in names], token=TOKEN)
        batch_bucket_files(BUCKET, add=[(encoded, f"results/{key}/result.json")], token=TOKEN)
    temp = folder / "result.tmp"
    temp.write_bytes(encoded)
    temp.replace(folder / "result.json")
    return result

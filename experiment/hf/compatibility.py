"""Read-only adaptation of Facemorph's existing media URLs; GET never generates."""
import io
import json
from pathlib import Path
from urllib.parse import parse_qs
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from PIL import Image
from contracts import request_spec, input_identity, cache_key
import storage

ROOT = Path(__file__).resolve().parent
PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#eee"/><text x="256" y="256" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="20">Press Morph to load these faces</text></svg>'


def identity_from_params(params, prefix=""):
    kinds = [name for name in ("value", "seed", "guid") if prefix + name in params]
    if len(kinds) != 1 or kinds[0] == "guid":
        raise ValueError("This trial supports words and seeds. Use classic Facemorph for photo links.")
    name = kinds[0]
    value = params[prefix + name]
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Use one input per face.")
        value = value[0]
    return input_identity(value, "Seeds" if name == "seed" else "Words")


def pair_spec(first, second):
    spec = request_spec("", "", "Words", "morph")
    spec["inputs"] = [identity_from_params(parse_qs(first, keep_blank_values=True)),
                      identity_from_params(parse_qs(second, keep_blank_values=True))]
    return spec


def query_spec(params):
    spec = request_spec("", "", "Words", "morph")
    spec["inputs"] = [identity_from_params(params, "from_"), identity_from_params(params, "to_")]
    return spec


def missing():
    return Response(PLACEHOLDER, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


def face_response(identity):
    # Prefer a new rendering when available; the seven bundled seeds are labeled
    # preservation samples in the trial notice.
    for manifest in storage.RESULTS.glob("*/result.json"):
        data = json.loads(manifest.read_text())
        for index, item in enumerate(data["spec"]["inputs"]):
            if item == identity:
                storage.load(data["key"])
                return FileResponse(manifest.parent / ("first.png" if index == 0 else "second.png"), headers={"Cache-Control": "no-store"})
    if "seed" in identity:
        archive = ROOT / "archive" / f"seed-{identity['seed']}-classic.jpg"
        if archive.exists():
            return FileResponse(archive, headers={"Cache-Control": "no-store"})
    return missing()


def install_routes(app):
    from fastapi import Request

    @app.get("/trial/result")
    def restore(first: str, second: str):
        try:
            return {"found": storage.load(cache_key(pair_spec(first, second))) is not None}
        except ValueError:
            raise HTTPException(400, "Invalid trial input") from None

    @app.get("/trial/api/face/")
    def face(request: Request):
        try:
            return face_response(identity_from_params(dict(request.query_params)))
        except ValueError:
            return missing()

    @app.get("/trial/api/mp4/")
    @app.get("/trial/api/webp/")
    @app.get("/trial/api/morphframe/")
    @app.get("/trial/api/linkpreview/")
    def morph(request: Request):
        try:
            spec = query_spec(dict(request.query_params))
            key = cache_key(spec)
            data = storage.load(key)
            if not data:
                return missing()
            path = storage.location(key) / "morph.gif"
            if request.url.path.endswith("/morphframe/"):
                frame = int(request.query_params.get("frame_num", "0"))
                if not 0 <= frame <= 6:
                    raise ValueError("Frame out of range")
                with Image.open(path) as gif:
                    gif.seek(frame)
                    output = io.BytesIO()
                    gif.convert("RGB").save(output, format="PNG")
                return Response(output.getvalue(), media_type="image/png")
            if request.url.path.endswith("/linkpreview/"):
                return FileResponse(storage.location(key) / "first.png")
            return FileResponse(path, media_type="image/gif", filename="facemorph.gif", content_disposition_type="inline")
        except (ValueError, KeyError):
            raise HTTPException(400, "Invalid trial request") from None

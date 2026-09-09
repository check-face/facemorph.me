"""Facemorph next chapter: a separate, bounded community trial."""
import hashlib
import json
import os
from pathlib import Path
import threading
import time

import spaces  # Must initialize ZeroGPU before importing torch/engine.
import gradio as gr
from contracts import request_spec, cache_key
from engine import Renderer
import storage

ROOT = Path(__file__).resolve().parent
HOSTED = bool(os.getenv("SPACE_ID"))
LOCAL_DEMO = not HOSTED and os.getenv("FACEMORPH_LOCAL_DEMO") == "1"
LOCAL_REVIEW = LOCAL_DEMO and os.getenv("FACEMORPH_REVIEW") == "1"
BASE_URL = os.getenv("TRIAL_BASE_URL", "http://127.0.0.1:7860").rstrip("/")
# Place the model on CUDA at module level for ZeroGPU's startup emulation.
renderer = Renderer("cuda" if os.getenv("SPACES_ZERO_GPU") == "1" else "cpu") if HOSTED else None
lock = threading.Lock()
if LOCAL_DEMO:
    import shutil
    for sample in (ROOT / "samples").glob("*"):
        if sample.is_dir() and not storage.location(sample.name).exists():
            shutil.copytree(sample, storage.location(sample.name))

@spaces.GPU(duration=50)
def gpu_render(spec):
    return renderer.render(spec)



def generate_morph(first, second, profile: gr.OAuthProfile | None, request: gr.Request = None):
    global renderer
    print("trial: queued job entered", flush=True)
    from compatibility import pair_spec
    try:
        spec = pair_spec(first, second)
        key = cache_key(spec)
        with lock:
            if storage.load(key):
                return {"ok": True, "key": key, "cached": True}
            if LOCAL_REVIEW:
                mode = request.request.cookies.get("facemorph_review", "signed-out") if request else "signed-out"
                if mode not in ("free", "paid"):
                    message = ("Your demo allowance is exhausted. Saved results still work. Wait for an allowance reset or choose paid resources with HF; Facemorph will not charge you automatically."
                               if mode == "exhausted" else "Sign in to use your own HF allowance. In this local demo, select a free or paid account above.")
                    return {"ok": False, "message": message}
            if profile is None and not LOCAL_DEMO:
                return {"ok": False, "message": "Sign in with Hugging Face, then press Morph again. Saved faces need no sign-in."}
            if HOSTED and os.getenv("SPACES_ZERO_GPU") != "1":
                return {"ok": False, "message": "HF compute is not enabled yet. Saved examples remain available."}
            storage.ensure_capacity()
            if renderer is None:
                if not (ROOT / "models/generator.pkl").exists():
                    return {"ok": False, "message": "This local checkout has no model weights. You can review the interface and saved samples; see HF_TRIAL.md to enable CPU generation."}
                renderer = Renderer("cpu")
            print("trial: rendering started", flush=True)
            frames = gpu_render(spec) if HOSTED else renderer.render(spec)
            print("trial: rendering finished", flush=True)
            storage.save(key, spec, frames)
            return {"ok": True, "key": key, "cached": False}
    except ValueError as error:
        return {"ok": False, "message": str(error)}
    except Exception:
        return {"ok": False, "message": "The trial could not finish. Wait and retry, or use classic Facemorph."}


# Gradio supplies the HF-native OAuth and ZeroGPU queue. The public interface is
# built from check-face/facemorph.me, served ahead of the mounted Gradio routes.
with gr.Blocks(title="Facemorph compute") as demo:
    if not LOCAL_DEMO:
        gr.LoginButton()
    first = gr.Textbox()
    second = gr.Textbox()
    result = gr.JSON()
    gr.Button("Compute").click(generate_morph, [first, second], result,
                               api_name="morph", concurrency_limit=1)

demo.queue(max_size=8)

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from compatibility import install_routes

app = FastAPI()
install_routes(app)
FRONTEND = ROOT / "frontend"

@app.get("/")
@app.get("/retirement")
@app.get("/classic")
def frontend():
    if not (FRONTEND / "index.html").exists():
        return HTMLResponse("The existing Facemorph frontend has not been built yet.", status_code=503)
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})

# Review controls exist only in explicitly enabled local mode. These cookies
# are never accepted as authentication by the hosted generation path.
if LOCAL_REVIEW:
    from fastapi import Request, HTTPException
    from fastapi.responses import JSONResponse
    from urllib.parse import urlsplit

    @app.get("/review/status")
    def review_status(request: Request):
        return {"mode": request.cookies.get("facemorph_review", "signed-out"), "compute": "local CPU", "hf_connected": False}

    @app.post("/review/session")
    def review_session(request: Request, mode: str):
        if mode not in ("signed-out", "free", "paid", "exhausted"):
            raise HTTPException(400, "Unknown demo state")
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host"):
            raise HTTPException(403, "Use the local review page")
        response = JSONResponse({"mode": mode})
        response.set_cookie("facemorph_review", mode, httponly=True, samesite="strict")
        return response

# Only expose files from the compiled frontend, never model/source/token paths.
@app.get("/assets/{asset:path}")
def asset(asset: str):
    from fastapi import HTTPException
    path = (FRONTEND / asset).resolve()
    if not path.is_relative_to(FRONTEND.resolve()) or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)

app = gr.mount_gradio_app(app, demo, path="/", show_error=False)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0" if HOSTED else "127.0.0.1", port=int(os.getenv("PORT", "7860")), access_log=False)

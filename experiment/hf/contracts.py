"""Versioned input semantics; no model or network imports."""
import hashlib
import json
import numpy as np

RENDERER = "checkface-sg2f-pytorch-trial-v1"
MODEL_SOURCE_SHA256 = "adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d"


def input_identity(value: str, mode: str) -> dict:
    if not isinstance(value, str) or len(value.encode("utf-8")) > 512:
        raise ValueError("Use at most 512 bytes of text.")
    if mode == "Seeds":
        if not value.isascii() or not value.isdecimal():
            raise ValueError("Seeds must be whole numbers from 0 to 4294967295.")
        seed = int(value)
        if not 0 <= seed <= 2**32 - 1:
            raise ValueError("Seeds must be between 0 and 4294967295.")
        return {"seed": seed}
    if mode != "Words":
        raise ValueError("Choose Words or Seeds.")
    return {"sha256": hashlib.sha256(value.encode("utf-8")).hexdigest()}


def latent(identity: dict) -> np.ndarray:
    if "seed" in identity:
        seed = identity["seed"]
    else:
        seed = np.frombuffer(bytes.fromhex(identity["sha256"]), dtype="<u4")
    return np.random.RandomState(seed).randn(512)


def request_spec(first: str, second: str, mode: str, kind: str) -> dict:
    if kind not in ("faces", "morph"):
        raise ValueError("Unknown generation type.")
    return {"renderer": RENDERER, "model_source_sha256": MODEL_SOURCE_SHA256,
            "inputs": [input_identity(first, mode), input_identity(second, mode)],
            "kind": kind, "dimension": 512, "frames": 12 if kind == "morph" else 2,
            "interpolation": "sinusoidal-z", "truncation_psi": 0.7,
            "truncation_cutoff": 8, "noise": "constant", "format": "png+gif"}


def cache_key(spec: dict) -> str:
    return hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def frame_latents(spec: dict) -> np.ndarray:
    a, b = [latent(i) for i in spec["inputs"]]
    if spec["kind"] == "faces":
        return np.stack([a, b]).astype(np.float32)
    # Match the classic generator: start -> end -> start with no repeated final frame.
    weights = (np.sin(np.linspace(0, 2*np.pi, spec["frames"], endpoint=False) + np.pi/2) + 1) / 2
    return np.stack([a*w + b*(1-w) for w in weights]).astype(np.float32)

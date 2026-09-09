"""Extract just the converted G_ema and record reproducible provenance."""
from pathlib import Path
import hashlib, json, pickle, subprocess, sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "vendor/stylegan2-ada-pytorch"))
source = root / "models/legacy-stylegan2-ffhq-config-f.pkl"
expected = "adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d"
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
with (root / "models/converted-stylegan2-ffhq-config-f.pkl").open("rb") as f:
    model = pickle.load(f)["G_ema"]
with (root / "models/generator.pkl").open("wb") as f:
    pickle.dump(model, f)
record = {"source_sha256": expected, "generator_sha256": hashlib.sha256((root / "models/generator.pkl").read_bytes()).hexdigest(),
          "upstream": "https://github.com/NVlabs/stylegan2-ada-pytorch",
          "revision": "d72cc7d041b42ec8e806021a205ed9349f87c6a4",
          "source": "Read-only copy of deployed Triton server-api-1 config-F checkpoint",
          "conversion": "NVIDIA legacy.py; G_ema only; no retraining", "generator_bytes": (root / "models/generator.pkl").stat().st_size}
(root / "models/provenance.json").write_text(json.dumps(record, indent=2)+"\n")
print(json.dumps(record, indent=2))

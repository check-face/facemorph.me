from pathlib import Path
import json,hashlib
from collections import Counter
import onnx
import onnxruntime as ort
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-optimization'
p=ROOT/'review-artifacts/browser-onnx-phase1/synthesis.onnx';m=onnx.load(p)
r={'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'before_nodes':len(m.graph.node)}
options=ort.SessionOptions();options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_BASIC;options.optimized_model_filepath=str(OUT/'synthesis-simplified.onnx');options.intra_op_num_threads=4
session=ort.InferenceSession(str(p),options,providers=['CPUExecutionProvider'])
model=onnx.load(OUT/'synthesis-simplified.onnx')
onnx.checker.check_model(model);onnx.save(model,OUT/'synthesis-simplified.onnx')
r.update(after_nodes=len(model.graph.node),ops=dict(Counter(n.op_type for n in model.graph.node)),sha256=hashlib.sha256((OUT/'synthesis-simplified.onnx').read_bytes()).hexdigest(),note='Shape/constant simplification; runtime fixture comparison done separately in browser')
(OUT/'simplify.json').write_text(json.dumps(r,indent=2)+'\n');print(r)

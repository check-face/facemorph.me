from pathlib import Path
import json
from precompute_demodulation import transform
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-energy'
rows=[]
for b in [2,4]:
 rows.append(transform(R/f'browser-onnx-profile/synthesis-polyphase-b{b}.onnx',O/f'synthesis-polyphase-b{b}.onnx'))
(O/'batch-manifest.json').write_text(json.dumps(rows,indent=2))

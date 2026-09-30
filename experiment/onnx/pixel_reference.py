from pathlib import Path
import numpy as np,json
from PIL import Image,__version__
R=Path(__file__).resolve().parents[3]/'review-artifacts';O=R/'browser-onnx-pixels';O.mkdir(exist_ok=True)
a=np.fromfile(R/'browser-onnx-polyphase/browser-image.f32',np.float32).reshape(3,1024,1024)
rgb=np.clip(a*np.float32(127.5)+np.float32(128),0,255).astype(np.uint8).transpose(1,2,0);im=Image.fromarray(rgb)
for size in [512,256,128]:im.resize((size,size),Image.Resampling.LANCZOS).save(O/f'lanczos-{size}.png')
(O/'manifest.json').write_text(json.dumps({'pillow':__version__,'input':'browser-onnx-polyphase/browser-image.f32','filter':'LANCZOS, RGB8 horizontal then vertical'},indent=2))

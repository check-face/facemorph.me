"""Local upload/alignment server; encoder and synthesis inference run in browser."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import sys,os,io,json,base64,hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-e4e'
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'hf'))
from vendor.e4e.utils.alignment import align_face,NumberOfFacesError
import dlib
asset=ROOT/'facemorph.me/experiment/hf/models/e4e/shape_predictor_68_face_landmarks.dat'
assert hashlib.sha256(asset.read_bytes()).hexdigest()=='fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f'
predictor=dlib.shape_predictor(str(asset))
class Handler(SimpleHTTPRequestHandler):
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');super().end_headers()
 def do_POST(self):
  size=int(self.headers.get('Content-Length',0))
  if size<=0 or size>24*1024*1024:self.send_error(413);return
  data=self.rfile.read(size)
  try:
   if self.path=='/prepare':
    image=Image.open(io.BytesIO(data)).convert('RGB');did_align=False
    try:image=align_face(None,predictor,img=image);did_align=True
    except NumberOfFacesError:pass
    image=image.resize((256,256),Image.Resampling.BILINEAR)
    tensor=((np.asarray(image,dtype=np.float32)/255-.5)/.5).transpose(2,0,1)[None].astype('<f4')
    buf=io.BytesIO();image.save(buf,format='PNG')
    result={'tensor':base64.b64encode(tensor.tobytes()).decode(),'tensor_sha256':hashlib.sha256(tensor.tobytes()).hexdigest(),'aligned':'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(),'did_align':did_align,'preprocessing':'Local CPU: original dlib alignment + Pillow bilinear 256px; model inference is browser WebGPU'}
    payload=json.dumps(result).encode()
   elif self.path.startswith('/save/'):
    name=self.path[len('/save/'):]
    if name not in {'browser.json','browser-w.f32','browser-image.f32','browser-input.f32','browser-reconstructed.png'}:self.send_error(400);return
    (OUT/name).write_bytes(data);payload=b'ok'
   else:self.send_error(404);return
   self.send_response(200);self.end_headers();self.wfile.write(payload)
  except Exception as e:self.send_error(400,str(e))
os.chdir(ROOT)
print('http://127.0.0.1:7866/facemorph.me/experiment/onnx/web/e4e.html',flush=True)
ThreadingHTTPServer(('127.0.0.1',7866),Handler).serve_forever()

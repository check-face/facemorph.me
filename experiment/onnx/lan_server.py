"""LAN viewer for this experiment, without exposing the rest of the workspace.
Remote benchmark reports are isolated by run ID. WebGPU execution requires
HTTPS or the client browser explicitly treating this LAN origin as secure.
"""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,unquote
import os
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'review-artifacts/browser-onnx-throughput';OUT.mkdir(exist_ok=True)
ARTIFACTS={'browser-onnx-phase1','browser-onnx-profile','browser-onnx-optimization','browser-onnx-video','browser-onnx-polyphase','browser-onnx-throughput','browser-onnx-block'}
class Handler(SimpleHTTPRequestHandler):
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');super().end_headers()
 def allowed(self):
  path=unquote(urlsplit(self.path).path).lstrip('/');p=(ROOT/path).resolve()
  if not p.is_relative_to(ROOT) or not p.is_file():return False
  rel=p.relative_to(ROOT).as_posix();parts=Path(rel).parts
  return (rel.startswith('facemorph.me/experiment/onnx/web/') and p.suffix in {'.js','.html'}) or rel.startswith('facemorph.me/experiment/onnx/node_modules/onnxruntime-web/dist/') or rel.startswith('facemorph.me/experiment/onnx/burn-candidate/pkg/') or (len(parts)==3 and parts[0]=='review-artifacts' and parts[1] in ARTIFACTS and p.suffix in {'.json','.f32','.onnx','.html','.png','.bpk','.md'})
 def do_GET(self):
  if not self.allowed():self.send_error(404);return
  super().do_GET()
 def do_HEAD(self):
  if not self.allowed():self.send_error(404);return
  super().do_HEAD()
 def do_POST(self):
  path=urlsplit(self.path).path
  import re
  match=re.fullmatch(r'/save/lan/([a-zA-Z0-9-]{1,80})/(browser.json|face.png)',path)
  if match:
   target=OUT/'lan'/match[1];target.mkdir(parents=True,exist_ok=True);name=match[2]
  else:
   if self.client_address[0] not in {'127.0.0.1','::1'}:self.send_error(403);return
   target=OUT;name=path.removeprefix('/save/')
   if name not in {'browser.json','browser-image.f32','browser-zero.f32','face.png'}:self.send_error(400);return
  length=int(self.headers.get('Content-Length','0'))
  if length<0 or length>32*1024*1024:self.send_error(413);return
  (target/name).write_bytes(self.rfile.read(length));self.send_response(200);self.end_headers();self.wfile.write(b'ok')
os.chdir(ROOT)
print('LAN viewer: http://192.168.11.20:7874/facemorph.me/experiment/onnx/web/throughput.html',flush=True)
ThreadingHTTPServer(('0.0.0.0',7874),Handler).serve_forever()

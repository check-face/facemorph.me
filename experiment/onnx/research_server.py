"""Scoped research server: explicit assets, JSON-only append-by-run reports."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote,urlsplit
import json,os,re
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'review-artifacts/browser-onnx-round5';OUT.mkdir(exist_ok=True)
WEB=ROOT/'facemorph.me/experiment/onnx/web';DIST=ROOT/'facemorph.me/experiment/onnx/node_modules/onnxruntime-web/dist'
PUBLIC=os.environ.get('ONNX_PUBLIC')=='1'
class Handler(SimpleHTTPRequestHandler):
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');self.send_header('Cache-Control','no-store');super().end_headers()
 def allowed(self):
  p=(ROOT/unquote(urlsplit(self.path).path).lstrip('/')).resolve()
  if not p.is_file() or not p.is_relative_to(ROOT):return False
  if PUBLIC:
   manifest=OUT/'public-assets.json'
   return manifest.exists() and p.relative_to(ROOT).as_posix() in json.loads(manifest.read_text())
  return (p.is_relative_to(WEB) and p.suffix in {'.js','.html'}) or p.is_relative_to(DIST) or p.is_relative_to(ROOT/'facemorph.me/experiment/onnx/runtime-122/node_modules/onnxruntime-web/dist') or (p.is_relative_to(ROOT/'review-artifacts') and p.suffix in {'.json','.f32','.onnx','.png'})
 def do_GET(self):
  if not self.allowed():self.send_error(404);return
  super().do_GET()
 def do_HEAD(self):
  if not self.allowed():self.send_error(404);return
  super().do_HEAD()
 def do_POST(self):
  match=re.fullmatch(r'/save/([a-zA-Z0-9-]{1,100})\.json',urlsplit(self.path).path)
  if not match:self.send_error(404);return
  try:
   n=int(self.headers.get('Content-Length','0'));assert 0<n<16*1024*1024
   data=json.loads(self.rfile.read(n));assert isinstance(data,dict)
  except Exception:self.send_error(400);return
  folder=OUT/('phone' if PUBLIC else 'local');folder.mkdir(exist_ok=True)
  (folder/(match[1]+'.json')).write_text(json.dumps(data,indent=2));self.send_response(200);self.end_headers();self.wfile.write(b'ok')
os.chdir(ROOT)
ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('ONNX_PORT','7883'))),Handler).serve_forever()

"""Serve local browser inference; accept diagnostic arrays (no server inference)."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'review-artifacts/browser-onnx-phase1' / os.environ.get('ONNX_RUN_SUBDIR','')
OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if os.environ.get('ONNX_NO_ISOLATION')!='1':
            self.send_header('Cross-Origin-Opener-Policy','same-origin')
            self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        super().end_headers()
    def do_POST(self):
        name=self.path.removeprefix('/save/')
        allowed={'browser-image.f32','browser-w.f32','browser-w-truncated.f32','browser-z.f32','browser.json','browser-zero.f32','recovery-last.png'}
        if os.environ.get('ONNX_FRAME_OUTPUT')=='1':
            allowed.update(f'{variant}-{i}.f32' for variant in ['baseline','segment'] for i in range(26))
        if name not in allowed: self.send_error(400); return
        data=self.rfile.read(int(self.headers['Content-Length']))
        (OUT/name).write_bytes(data)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
os.chdir(ROOT)
print('http://127.0.0.1:'+os.environ.get('ONNX_PORT','7864')+'/facemorph.me/experiment/onnx/web/phase1.html',flush=True)
ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('ONNX_PORT','7864'))),Handler).serve_forever()

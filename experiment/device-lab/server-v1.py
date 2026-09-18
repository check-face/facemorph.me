"""Isolated immutable benchmark assets + authenticated, bounded persistent JSON reports."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote
import os,json,re,secrets,threading
ROOT=Path(os.environ.get('LAB_ASSETS','/assets')).resolve();DATA=Path(os.environ.get('LAB_RESULTS','/results'));DATA.mkdir(parents=True,exist_ok=True)
KEY=os.environ['LAB_KEY'];lock=threading.Lock()
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT),**k)
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Cache-Control','no-cache');super().end_headers()
 def log_message(self,*a):pass
 def do_GET(self):
  if urlsplit(self.path).path=='/health':self.send_response(200);self.end_headers();self.wfile.write(b'OK');return
  if urlsplit(self.path).path=='/':
   self.send_response(302);self.send_header('Location','/facemorph.me/experiment/device-lab/index.html');self.end_headers();return
  p=(ROOT/unquote(urlsplit(self.path).path).lstrip('/')).resolve()
  if not p.is_relative_to(ROOT) or not p.is_file():self.send_error(404);return
  super().do_GET()
 def do_HEAD(self):self.do_GET()
 def do_PUT(self):
  if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+KEY):self.send_error(401);return
  m=re.fullmatch(r'/api/runs/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})',self.path)
  if not m:self.send_error(404);return
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=2*1024*1024:self.send_error(413);return
   data=json.loads(self.rfile.read(n))
   if not isinstance(data,dict) or data.get('runId')!=m[1] or data.get('schemaVersion')!=1:raise ValueError()
  except (ValueError,TypeError):self.send_error(400);return
  with lock:
   dest=DATA/(m[1]+'.json')
   if not dest.exists() and len(list(DATA.glob('*.json')))>=2000:self.send_error(507);return
   tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2));tmp.replace(dest)
  self.send_response(200);self.end_headers();self.wfile.write(b'OK')
ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()

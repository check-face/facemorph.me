#!/usr/bin/env python3
"""Exact UI bytes + pinned remote runtime, preserving production origin in Chrome only.

/runtime/* is served from a write-through disk mirror (.runtime-mirror/<sha256>), keyed by
each asset's OWN manifest sha256 (URL directory shas collide across sibling files):
 mirror hit -> disk; miss -> public origin; origin 404 but the manifest carries the asset's
 pinned chunk list (Pages caps per-file size) -> assemble from chunks, verify sha.
The 256MiB bound fits the webgpu segments the previous 32MiB bound could never proxy.
"""
import argparse,hashlib,json,re,ssl,traceback,urllib.error,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
p=argparse.ArgumentParser();p.add_argument('--manifest-sha',required=True);p.add_argument('--cert',required=True);p.add_argument('--key',required=True);p.add_argument('--runtime-overlay',type=Path,default=None);p.add_argument('--port',type=int,default=8443);a=p.parse_args()
ORIGIN='https://next.facemorph.me'
SOURCE=Path('next-site-source.txt').read_text().strip()
MIRROR=Path('.runtime-mirror');MIRROR.mkdir(exist_ok=True)
ASSET_BOUND=256*1024*1024
def request(url):return urllib.request.Request(url,headers={'User-Agent':'curl/8.7.1'})
# With an overlay the pin applies to the overlay manifest: qualification runs against the
# bytes production does not serve yet, so the origin copy is irrelevant at startup. Asset
# bytes are sha-addressed and fetched on demand either way.
if a.runtime_overlay:
 manifest=(a.runtime_overlay.resolve()/'manifest.json').read_bytes()
 assert hashlib.sha256(manifest).hexdigest()==a.manifest_sha,'Overlay manifest differs from requested pin'
else:
 with urllib.request.urlopen(request(ORIGIN+'/runtime/manifest.json'),timeout=60) as r: manifest=r.read(4*1024*1024+1)
 assert hashlib.sha256(manifest).hexdigest()==a.manifest_sha,'Public manifest differs from requested pin'
parsed=json.loads(manifest)
# A runtime overlay (e.g. hosting/next-static/runtime-overlay) carries a repinned manifest
# and small replacement assets that production does not serve yet; qualification must run
# against exactly these bytes so the pin and the deployment move together.
OVERLAY=a.runtime_overlay.resolve() if a.runtime_overlay else None
PATHMAP={};CHUNKMAP={}
def index(node):
 if isinstance(node,dict):
  url=node.get('url');sha=node.get('sha256')
  if isinstance(url,str) and url.startswith(ORIGIN+'/runtime/') and isinstance(sha,str) and len(sha)==64:
   path=url[len(ORIGIN):];PATHMAP[path]=sha
   chunks=node.get('chunks')
   if isinstance(chunks,list) and chunks and all(isinstance(c,dict) and isinstance(c.get('url'),str) for c in chunks):
    CHUNKMAP[path]=(sha,[c['url'] for c in chunks])
  for v in node.values():index(v)
 elif isinstance(node,list):
  for v in node:index(v)
index(parsed)
def fetch(url,bound=ASSET_BOUND):
 with urllib.request.urlopen(request(url),timeout=300) as r:
  if not r.url.startswith(ORIGIN+'/runtime/'):raise ValueError('Unexpected runtime redirect')
  return r.read(bound+1)
def seed_from_local():
 want={};stack=[parsed]
 while stack:
  node=stack.pop()
  if isinstance(node,dict):
   sha=node.get('sha256');size=node.get('size')
   if isinstance(sha,str) and len(sha)==64 and isinstance(size,int):want.setdefault(size,set()).add(sha)
   stack.extend(node.values())
  elif isinstance(node,list):stack.extend(node)
 for d in [Path('../review-artifacts/browser-onnx-mod-fusion'),Path('../review-artifacts/device-lab-deploy/assets'),Path('../autoresearch/candidates')]:
  if not d.exists():continue
  for f in d.rglob('*'):
   try:
    if not f.is_file() or f.stat().st_size not in want:continue
    h=hashlib.sha256()
    with f.open('rb') as fh:
     for chunk in iter(lambda:fh.read(1<<20),b''):h.update(chunk)
    digest=h.hexdigest()
    if digest in want[f.stat().st_size] and not (MIRROR/digest).exists():(MIRROR/digest).write_bytes(f.read_bytes())
   except OSError:continue
seed_from_local()
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory='deploy-next',**kw)
 def end_headers(self):
  for k,v in [('Cross-Origin-Opener-Policy','same-origin'),('Cross-Origin-Embedder-Policy','require-corp'),('Cross-Origin-Resource-Policy','same-origin'),('Cache-Control','no-store'),('Content-Security-Policy',"script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'"  # no third-party CDN (AGENTS.md): the ffmpeg codec is served from this origin),('X-Next-Artifact-Source',SOURCE),('Access-Control-Allow-Origin','*')]:self.send_header(k,v)
  super().end_headers()
 def do_POST(self):self.send_error(403,'Diagnostics and uploads disabled in qualification')
 def mime_for(self,path):
  if path.endswith('.mjs') or path.endswith('.js'):return 'text/javascript'
  if path.endswith('.json'):return 'application/json'
  if path.endswith('.png'):return 'image/png'
  if path.endswith('.wasm'):return 'application/wasm'
  return 'application/octet-stream'
 def respond(self,data,mime='application/octet-stream'):
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def fetch_pinned(self,path,sha):
  try:return fetch(ORIGIN+path)
  except urllib.error.HTTPError as error:
   if error.code!=404 or sha not in CHUNKMAP:raise
   expected,chunk_urls=CHUNKMAP[path]
   data=b''.join(fetch(cu) for cu in chunk_urls)
   if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Chunk assembly does not match the pinned asset sha')
   return data
 def do_GET(self):
  if not self.path.startswith('/runtime/'):return super().do_GET()
  if '?' in self.path or '#' in self.path or '..' in self.path or '%' in self.path:return self.send_error(400)
  try:
   if self.path=='/runtime/manifest.json':
    # The overlay manifest pins absolute production URLs, but production does not serve the
    # overlay-swapped assets (that is why the overlay exists). Rewrite every runtime URL to
    # this request's own https origin so the browser's fetches flow through the mirror/overlay
    # logic below while staying absolute https, as model-cache acquisition requires.
    host=re.sub(r'[^A-Za-z0-9.:\[\]-]','',self.headers.get('Host') or '')
    if not host:return self.send_error(400,'Missing Host header')
    return self.respond(manifest.replace(b'https://next.facemorph.me/runtime/',('https://'+host+'/runtime/').encode()),self.mime_for(self.path))
   sha=PATHMAP.get(self.path)
   if sha is None:
    m=re.fullmatch(r'/runtime/chunks/([0-9a-f]{64})\.bin',self.path)
    sha=m.group(1) if m else None
   if sha is None:return self.respond(fetch(ORIGIN+self.path),self.mime_for(self.path))
   overlay_file=(OVERLAY/self.path.lstrip('/')) if OVERLAY is not None else None
   if overlay_file is not None and overlay_file.is_file():return self.respond(overlay_file.read_bytes(),self.mime_for(self.path))
   cached=MIRROR/sha
   if cached.exists():return self.respond(cached.read_bytes(),self.mime_for(self.path))
   data=self.fetch_pinned(self.path,sha)
   (MIRROR/sha).write_bytes(data)
   self.respond(data,self.mime_for(self.path))
  except Exception:
   traceback.print_exc();self.send_error(502,'Pinned runtime acquisition failed')
server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(a.cert,a.key);server.socket=ctx.wrap_socket(server.socket,server_side=True);print(f'https://127.0.0.1:{a.port}',flush=True);server.serve_forever()

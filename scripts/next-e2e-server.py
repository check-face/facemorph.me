#!/usr/bin/env python3
"""Exact UI bytes + pinned remote runtime, preserving production origin in Chrome only.

Runtime assets are served through a write-through disk mirror (.runtime-mirror/<sha256>):
 - already mirrored: served from disk, no network;
 - present in a local seed directory with matching sha256 (e.g. lab artifact onnx that the
   pinned webgpu bundle reuses byte-for-byte): served and mirrored;
 - otherwise: fetched from the pinned public origin once, streamed to the client and the
   mirror. The client verifies every asset sha256 regardless of source.
The 256MiB per-asset bound fits the webgpu segments (158/102MiB) that the previous 32MiB
bound could never proxy, which made webgpu qualification impossible through this server.
"""
import argparse,hashlib,json,ssl,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
p=argparse.ArgumentParser();p.add_argument('--manifest-sha',required=True);p.add_argument('--cert',required=True);p.add_argument('--key',required=True);a=p.parse_args()
ORIGIN='https://next.facemorph.me'
SOURCE=Path('next-site-source.txt').read_text().strip()
MIRROR=Path('.runtime-mirror');MIRROR.mkdir(exist_ok=True)
ASSET_BOUND=256*1024*1024
def request(url):return urllib.request.Request(url,headers={'User-Agent':'curl/8.7.1'})
with urllib.request.urlopen(request(ORIGIN+'/runtime/manifest.json'),timeout=60) as r: manifest=r.read(4*1024*1024+1)
assert hashlib.sha256(manifest).hexdigest()==a.manifest_sha,'Public manifest differs from requested pin'
parsed=json.loads(manifest)
def asset_digests(node,out):
 if isinstance(node,dict):
  sha=node.get('sha256');size=node.get('size')
  if isinstance(sha,str) and len(sha)==64 and isinstance(size,int):out.add((sha,size))
  for v in node.values():asset_digests(v,out)
 elif isinstance(node,list):
  for v in node:asset_digests(v,out)
want={}
sha_sizes=set();asset_digests(parsed,sha_sizes)
for sha,size in sha_sizes:want.setdefault(size,[]).append(sha)
# URL directories are named after ONE asset's sha; sibling files in the same directory have
# their own shas, so the mirror key must come from the manifest entry for the exact path,
# never from the URL path segment (two files sharing a directory would otherwise collide).
PATHMAP={}
def index_paths(node):
 if isinstance(node,dict):
  url=node.get('url');sha=node.get('sha256')
  if isinstance(url,str) and url.startswith(ORIGIN+'/runtime/') and isinstance(sha,str) and len(sha)==64:
   PATHMAP[url[len(ORIGIN):]]=sha
  for v in node.values():index_paths(v)
 elif isinstance(node,list):
  for v in node:index_paths(v)
index_paths(parsed)
# Seed the mirror from local artifact copies whose size matches a pinned asset, verified by hash.
SEED_DIRS=[Path('../review-artifacts/browser-onnx-mod-fusion'),Path('../review-artifacts/device-lab-deploy/assets'),Path('../autoresearch/candidates')]
for d in SEED_DIRS:
 if not d.exists():continue
 for f in d.rglob('*'):
  try:
   if not f.is_file() or f.stat().st_size not in want:continue
   h=hashlib.sha256()
   with f.open('rb') as fh:
    for chunk in iter(lambda:fh.read(1<<20),b''):h.update(chunk)
   digest=h.hexdigest()
   if digest in [s for s in want[f.stat().st_size]] and not (MIRROR/digest).exists():
    (MIRROR/digest).write_bytes(f.read_bytes())
  except OSError:continue
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory='deploy-next',**kw)
 def end_headers(self):
  for k,v in [('Cross-Origin-Opener-Policy','same-origin'),('Cross-Origin-Embedder-Policy','require-corp'),('Cross-Origin-Resource-Policy','same-origin'),('Cache-Control','no-store'),('Content-Security-Policy',"script-src 'self' blob: https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'"),('X-Next-Artifact-Source',SOURCE)]:self.send_header(k,v)
  super().end_headers()
 def do_POST(self):self.send_error(403,'Diagnostics and uploads disabled in qualification')
 def asset(self,sha,data): (MIRROR/sha).exists() or (MIRROR/sha).write_bytes(data);return data
 def do_GET(self):
  if not self.path.startswith('/runtime/'):return super().do_GET()
  if '?' in self.path or '#' in self.path or '..' in self.path or '%' in self.path:return self.send_error(400)
  try:
   if self.path=='/runtime/manifest.json':data=manifest;mime='application/json'
   else:
    parts=self.path.split('/')
    mime='application/octet-stream'
    sha=PATHMAP.get(self.path)
    if sha is None:
     import re
     sha_match=re.fullmatch(r'/runtime/chunks/([0-9a-f]{64})\.bin',self.path)
     sha=sha_match.group(1) if sha_match else None
    if sha is not None:
     cached=MIRROR/sha
     if cached.exists():data=cached.read_bytes()
     else:
      with urllib.request.urlopen(request(ORIGIN+self.path),timeout=300) as r:
       if not r.url.startswith(ORIGIN+'/runtime/'):raise ValueError('Unexpected runtime redirect')
       data=r.read(ASSET_BOUND+1)
      if len(data)>ASSET_BOUND:raise ValueError('Runtime resource exceeds static hosting bound')
      data=self.asset(sha,data)
    else:
     with urllib.request.urlopen(request(ORIGIN+self.path),timeout=300) as r:
      if not r.url.startswith(ORIGIN+'/runtime/'):raise ValueError('Unexpected runtime redirect')
      data=r.read(ASSET_BOUND+1)
     if len(data)>ASSET_BOUND:raise ValueError('Runtime resource exceeds static hosting bound')
   self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  except Exception:self.send_error(502,'Pinned runtime acquisition failed')
server=ThreadingHTTPServer(('127.0.0.1',8443),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(a.cert,a.key);server.socket=ctx.wrap_socket(server.socket,server_side=True);server.serve_forever()

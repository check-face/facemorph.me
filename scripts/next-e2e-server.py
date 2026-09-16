#!/usr/bin/env python3
"""Exact UI bytes + pinned remote runtime, preserving production origin in Chrome only."""
import argparse,hashlib,json,ssl,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
p=argparse.ArgumentParser();p.add_argument('--manifest-sha',required=True);p.add_argument('--cert',required=True);p.add_argument('--key',required=True);a=p.parse_args()
ORIGIN='https://next.facemorph.me'
SOURCE=Path('next-site-source.txt').read_text().strip()
def request(url):return urllib.request.Request(url,headers={'User-Agent':'curl/8.7.1'})
with urllib.request.urlopen(request(ORIGIN+'/runtime/manifest.json'),timeout=60) as r: manifest=r.read(4*1024*1024+1)
assert hashlib.sha256(manifest).hexdigest()==a.manifest_sha,'Public manifest differs from requested pin'
json.loads(manifest)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory='deploy-next',**kw)
 def end_headers(self):
  for k,v in [('Cross-Origin-Opener-Policy','same-origin'),('Cross-Origin-Embedder-Policy','require-corp'),('Cross-Origin-Resource-Policy','same-origin'),('Cache-Control','no-store'),('Content-Security-Policy',"script-src 'self' blob: https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'"),('X-Next-Artifact-Source',SOURCE)]:self.send_header(k,v)
  super().end_headers()
 def do_POST(self):self.send_error(403,'Diagnostics and uploads disabled in qualification')
 def do_GET(self):
  if not self.path.startswith('/runtime/'):return super().do_GET()
  if '?' in self.path or '#' in self.path or '..' in self.path or '%' in self.path:return self.send_error(400)
  try:
   if self.path=='/runtime/manifest.json':data=manifest;mime='application/json'
   else:
    with urllib.request.urlopen(request(ORIGIN+self.path),timeout=180) as r:
     if not r.url.startswith(ORIGIN+'/runtime/'):raise ValueError('Unexpected runtime redirect')
     data=r.read(32*1024*1024+1);mime=r.headers.get('Content-Type','application/octet-stream')
    if len(data)>32*1024*1024:raise ValueError('Runtime resource exceeds static hosting bound')
   self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  except Exception:self.send_error(502,'Pinned runtime acquisition failed')
server=ThreadingHTTPServer(('127.0.0.1',8443),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(a.cert,a.key);server.socket=ctx.wrap_socket(server.socket,server_side=True);server.serve_forever()

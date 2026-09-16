"""Short actual-Simulator test on a fresh, isolated origin; never deletes an existing cache."""
from pathlib import Path
import argparse, functools, hashlib, http.server, json, socket, ssl, subprocess, threading, time, urllib.parse, uuid
C=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--staging',type=Path,default=Path('/private/tmp/checkface-next-runtime'));a=p.parse_args()
campaign='sim-chunks-'+str(uuid.uuid4());folder=C/'evidence'/campaign;folder.mkdir(parents=True)
device=next(d for d in json.loads((C/'evidence/simulator-devices.json').read_text())if d['name']=='iPhone 18 Pro Max')
(folder/'device.json').write_text(json.dumps(device,indent=2))
# Binding an unused ephemeral port makes this a separate OPFS origin. No stored
# user/model cache is removed, and the production assets stay untouched.
manifest=json.loads((a.staging/'runtime/photo/manifest.json').read_text())
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(a.staging/'runtime'),**kwargs)
 def do_GET(self):
  path=urllib.parse.urlparse(self.path).path
  if path=='/qualification-chunks.html':data=(C/'qualification-chunks.html').read_bytes();mime='text/html'
  elif path=='/photo/manifest.json':
   remapped=json.loads(json.dumps(manifest));landmarks=remapped['landmarks']
   # Chunk filenames are flat beside the frozen photo manifest. Keep both the
   # original full-model checksum and all original per-part checksums.
   for part in landmarks['chunks']:part['url']='/photo/'+Path(urllib.parse.urlparse(part['url']).path).name
   landmarks['url']='/photo/unused-full-model.dat';data=json.dumps(remapped).encode();mime='application/json'
  else:return super().do_GET()
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_POST(self):
  n=int(self.headers.get('content-length','0'))
  if self.path!='/report' or not 0<n<2*1024*1024:self.send_error(400);return
  report=json.loads(self.rfile.read(n))
  if report.get('campaign')!=campaign:self.send_error(400);return
  temp=folder/'report.partial';temp.write_text(json.dumps(report,indent=2));temp.replace(folder/'report.json');self.send_response(200);self.end_headers();self.wfile.write(b'{}')
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);port=server.server_address[1]
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(a.staging/'cert.pem',a.staging/'key.pem');server.socket=ctx.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start()
def sim(*args):return subprocess.run(['xcrun','simctl',*args],capture_output=True,text=True,timeout=60)
try:
 trust=sim('keychain',device['udid'],'add-root-cert',str(a.staging/'cert.pem'));assert trust.returncode==0,trust.stderr
 (folder/'trust-receipt.json').write_text(json.dumps({'certificateSha256':hashlib.sha256((a.staging/'cert.pem').read_bytes()).hexdigest(),'scope':'Dedicated Simulator keychain'},indent=2))
 url=f'https://localhost:{port}/qualification-chunks.html?'+urllib.parse.urlencode({'campaign':campaign});(folder/'url.txt').write_text(url)
 launch=sim('openurl',device['udid'],url);assert launch.returncode==0,launch.stderr
 (folder/'launch.json').write_text(json.dumps({'returncode':launch.returncode,'stdout':launch.stdout,'stderr':launch.stderr},indent=2));print(json.dumps({'campaign':campaign,'port':port}),flush=True)
 deadline=time.monotonic()+120;report=None
 while time.monotonic()<deadline:
  if(folder/'report.json').exists():
   report=json.loads((folder/'report.json').read_text())
   if report.get('completed'):break
  time.sleep(1)
 sim('io',device['udid'],'screenshot',str(folder/'screen.png'))
 assert report and report.get('completed') and report.get('passed'),report
 print(json.dumps({'passed':True,'report':str(folder/'report.json'),'stats':report['stats']}),flush=True)
finally:server.shutdown();server.server_close()

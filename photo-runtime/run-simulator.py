"""Explicit one-shot Safari campaign in an actual dedicated iOS Simulator."""
from pathlib import Path
import hashlib,http.server,json,ssl,subprocess,sys,threading,time,urllib.parse,uuid
C=Path(__file__).resolve().parent;R=C.parent
product_only='--product-only' in sys.argv
runtime=Path('/private/tmp/checkface-next-runtime');campaign='sim-photo-'+str(uuid.uuid4())
device=next(d for d in json.loads((C/'evidence/simulator-devices.json').read_text())if d['name']=='iPhone 18 Pro Max')
folder=C/'evidence'/campaign;folder.mkdir(parents=True)
(folder/'device.json').write_text(json.dumps(device,indent=2));(runtime/'runtime/photo/qualification.html').write_bytes((C/'qualification.html').read_bytes())
class Handler(http.server.BaseHTTPRequestHandler):
 def response_headers(self):
  self.send_header('Access-Control-Allow-Origin','https://localhost:8443');self.send_header('Access-Control-Allow-Headers','content-type');self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Cross-Origin-Resource-Policy','cross-origin');self.end_headers()
 def do_OPTIONS(self):self.send_response(204);self.response_headers()
 def do_POST(self):
  size=int(self.headers.get('content-length','0'))
  if self.path!='/report' or self.headers.get('origin')!='https://localhost:8443' or not 0<size<2*1024*1024:self.send_error(400);return
  data=json.loads(self.rfile.read(size))
  if data.get('campaignId')!=campaign:self.send_error(400);return
  temp=folder/'report.partial';temp.write_text(json.dumps(data,indent=2));temp.replace(folder/'report.json');self.send_response(200);self.response_headers();self.wfile.write(b'{}')
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8444),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(runtime/'cert.pem',runtime/'key.pem');server.socket=ctx.wrap_socket(server.socket,server_side=True);threading.Thread(target=server.serve_forever,daemon=True).start()
def sim(*args,timeout=60):return subprocess.run(['xcrun','simctl',*args],capture_output=True,text=True,timeout=timeout)
try:
 state=json.loads(sim('list','devices','--json').stdout);flat=[d for group in state['devices'].values()for d in group];current=next(d for d in flat if d['udid']==device['udid'])
 if current['state']!='Booted':
  boot=sim('boot',device['udid']);assert boot.returncode==0,boot.stderr
  ready=sim('bootstatus',device['udid'],'-b',timeout=120);assert ready.returncode==0,ready.stderr
 # Only the task's local development certificate is added to this Simulator.
 trust=sim('keychain',device['udid'],'add-root-cert',str(runtime/'cert.pem'));assert trust.returncode==0,trust.stderr
 (folder/'trust-receipt.json').write_text(json.dumps({'certificateSha256':hashlib.sha256((runtime/'cert.pem').read_bytes()).hexdigest(),'scope':'Dedicated iOS Simulator keychain only','result':trust.stdout},indent=2))
 query=urllib.parse.urlencode({'campaign':campaign,'device':device['name'],'runtime':device['runtime'],'udid':device['udid'],'mode':'product' if product_only else 'full'});url='https://localhost:8443/runtime/photo/qualification.html?'+query;(folder/'url.txt').write_text(url)
 launch=sim('openurl',device['udid'],url);(folder/'launch.json').write_text(json.dumps({'returncode':launch.returncode,'stdout':launch.stdout,'stderr':launch.stderr},indent=2));print(json.dumps({'campaign':campaign,'folder':str(folder),'url':url}),flush=True)
 deadline=time.monotonic()+600;last=None;report=None
 while time.monotonic()<deadline:
  p=folder/'report.json'
  if p.exists():
   report=json.loads(p.read_text());key=(report.get('stage'),len(report.get('cases',[])),report.get('completed'))
   if key!=last:print(json.dumps({'stage':key[0],'cases':key[1],'completed':key[2],'error':report.get('error')}),flush=True);last=key
   if report.get('completed'):break
  time.sleep(2)
 sim('io',device['udid'],'screenshot',str(folder/'screen.png'))
 assert report and report.get('completed'),'No final saved Simulator report'
 assert report.get('platform')=='iPhone' and 'iPhone' in report.get('userAgent',''),'Wrong browser environment'
 assert report['executionEnvironment']['simulatorDeviceId']==device['udid'] and report.get('passed'),report.get('error')
 assert len(report.get('strictRejections',[]))==2 and report['strictRejections'][0]['faceCount']==0 and report['strictRejections'][1]['faceCount']>1
 assert report.get('product',{}).get('passed') and report.get('synthesisExecuted')
 assert len(report['cases'])==(0 if product_only else 5) and all(c.get('passed')and c.get('tensorExact')and c.get('encoderWorkerTerminated')and c.get('landmarkWorkerTerminated')for c in report['cases'])
 print(json.dumps({'passed':True,'campaign':campaign,'report':str(folder/'report.json'),'physicalPerformanceEvidence':False}),flush=True)
finally:
 server.shutdown();server.server_close()

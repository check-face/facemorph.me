"""Public experiment assets, private reports, automatically issued per-run write capabilities."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
import hashlib, hmac, json, os, re, secrets, threading, uuid, datetime
ROOT=Path(os.environ.get('LAB_ASSETS','/assets')).resolve()
DATA=Path(os.environ.get('LAB_RESULTS','/results'));DATA.mkdir(parents=True,exist_ok=True)
KEY=os.environ['LAB_KEY'];lock=threading.Lock()
RUN=re.compile(r'/api/runs/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})')
def capability(run_id):return 'run-v1.'+hmac.new(KEY.encode(),('facemorph-report:'+run_id).encode(),hashlib.sha256).hexdigest()
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT),**k)
 def end_headers(self):
  for k,v in {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store' if urlsplit(self.path).path.startswith('/api/') or urlsplit(self.path).path=='/health' else 'no-cache'}.items():self.send_header(k,v)
  super().end_headers()
 def log_message(self,*a):pass
 def reply(self,status,value):
  body=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers()
  if self.command!='HEAD':self.wfile.write(body)
 def do_GET(self):
  path=urlsplit(self.path).path
  if path=='/health':self.reply(200,{'ok':True,'apiVersion':2,'saving':'per-run-capability'});return
  if path=='/':self.send_response(302);self.send_header('Location','/facemorph.me/experiment/device-lab/index.html');self.end_headers();return
  p=(ROOT/unquote(path).lstrip('/')).resolve()
  if not p.is_relative_to(ROOT) or not p.is_file():self.send_error(404);return
  super().do_GET()
 def do_HEAD(self):
  if urlsplit(self.path).path in ['/health','/']:self.do_GET();return
  p=(ROOT/unquote(urlsplit(self.path).path).lstrip('/')).resolve()
  if not p.is_relative_to(ROOT) or not p.is_file():self.send_error(404);return
  super().do_HEAD()
 def same_origin(self):
  origin=self.headers.get('Origin');site=self.headers.get('Sec-Fetch-Site')
  return site not in ['cross-site'] and (not origin or urlsplit(origin).netloc==self.headers.get('Host'))
 def read_json(self):
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=2*1024*1024:self.reply(413,{'error':'Report must be between 1 byte and 2 MiB'});return None
   self.connection.settimeout(20)
   def invalid(_):raise ValueError('Non-finite JSON')
   data=json.loads(self.rfile.read(n),parse_constant=invalid)
   if not isinstance(data,dict):raise ValueError()
   return data
  except (ValueError,TypeError,RecursionError,TimeoutError):self.reply(400,{'error':'Invalid report JSON'});return None
 def do_POST(self):
  path=urlsplit(self.path).path
  if path=='/api/runs/latest':self.do_POST_latest();return
  if path.startswith('/api/runs/') and path.endswith('/resume'):
   m=RUN.match(path)
   if m and m[1] and path==f'/api/runs/{m[1]}/resume':self.do_POST_resume(m[1]);return
  if path!='/api/runs':self.do_PUT();return
  if not self.same_origin():self.reply(403,{'error':'Open the experiment site directly to start a run'});return
  data=self.read_json()
  if data is None:return
  run_id=str(uuid.uuid4())
  with lock:
   if len(list(DATA.glob('*.json')))>=2000:self.reply(507,{'error':'Experiment storage is full; contact the operator'});return
   record={'schemaVersion':1,'runId':run_id,'registeredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':[],'revision':0,'test':data.get('test') is True}
   (DATA/(run_id+'.json')).write_text(json.dumps(record))
  self.reply(201,{'runId':run_id,'writeToken':capability(run_id),'apiVersion':2})
 def resume_record(self,record):
  # Per-case checkpoints the client can resume from, without the full report body.
  out={}
  for r in record.get('results',[]):
   rid=r.get('id')
   if not rid:continue
   stages=r.get('stages')
   if not stages and not r.get('checkpointAt'):continue
   out[rid]={'stages':list((stages or {}).keys()),'heartbeatAt':r.get('lastBrowserHeartbeatAt') or r.get('heartbeatAt'),'completed':r.get('completed') is True}
  return out
 def latest_for_device(self,device_id):
  if not device_id or not isinstance(device_id,str):return None
  best=None
  for p in DATA.glob('*.json'):
   try:record=json.loads(p.read_text())
   except Exception:continue
   if record.get('deviceId')!=device_id:continue
   if record.get('finished') and not record.get('interrupted'):continue
   if record.get('stopped'):continue
   at=record.get('serverSavedAt') or record.get('registeredAt')
   if best is None or at>(best.get('serverSavedAt') or best.get('registeredAt')):best=record
  return best
 def do_POST_latest(self):
  # Interrupted-run detection: the newest unfinished run for this device, without its body.
  if not self.same_origin():self.reply(403,{'error':'Cross-site writes are not supported'});return
  data=self.read_json()
  if data is None:return
  with lock:record=self.latest_for_device(data.get('deviceId'))
  if not record:self.reply(200,{'run':None});return
  self.reply(200,{'run':{'runId':record['runId'],'suiteVersion':record.get('suiteVersion'),'finished':record.get('finished'),'interrupted':record.get('interrupted') is True,'stopped':record.get('stopped') is True,'serverSavedAt':record.get('serverSavedAt'),'checkpoints':self.resume_record(record)}})
 def do_POST_resume(self,run_id):
  # Re-issue the write capability for an interrupted run to the same device profile.
  # The deviceId is a random per-profile UUID that never leaves the profile; possession of
  # it plus same-origin is the resume credential. The full report (with checkpoints,
  # including any checkpointed latent) is returned so the new session can continue.
  if not self.same_origin():self.reply(403,{'error':'Cross-site writes are not supported'});return
  data=self.read_json()
  if data is None:return
  with lock:
   dest=DATA/(run_id+'.json')
   if not dest.exists():self.reply(404,{'error':'Unknown run'});return
   record=json.loads(dest.read_text())
  if record.get('deviceId')!=data.get('deviceId'):self.reply(403,{'error':'This run belongs to a different device profile'});return
  if record.get('stopped'):self.reply(409,{'error':'This run was stopped by the tester; start a fresh run'});return
  if record.get('finished') and not record.get('interrupted'):self.reply(409,{'error':'This run already finished'});return
  self.reply(200,{'runId':run_id,'writeToken':capability(run_id),'report':record,'apiVersion':2})
 def do_PUT(self):
  m=RUN.fullmatch(urlsplit(self.path).path)
  if not m:self.reply(404,{'error':'Unknown run endpoint'});return
  auth=self.headers.get('Authorization','').encode()
  legacy=secrets.compare_digest(auth,('Bearer '+KEY).encode())
  if not legacy and not secrets.compare_digest(auth,('Bearer '+capability(m[1])).encode()):self.reply(401,{'error':'This run needs a valid write credential; reopen the current lab to recover local results'});return
  if not self.same_origin():self.reply(403,{'error':'Cross-site writes are not supported'});return
  data=self.read_json()
  if data is None:return
  if data.get('schemaVersion')!=1 or data.get('runId')!=m[1] or not isinstance(data.get('results'),list):self.reply(400,{'error':'Report schema/run ID mismatch'});return
  revision=data.get('revision')
  if revision is not None and (type(revision)!=int or revision<1):self.reply(400,{'error':'Invalid report revision'});return
  with lock:
   dest=DATA/(m[1]+'.json')
   if not dest.exists():
    if not legacy:self.reply(404,{'error':'Run reservation missing'});return
    if len(list(DATA.glob('*.json')))>=2000:self.reply(507,{'error':'Experiment storage is full'});return
   else:
    previous=json.loads(dest.read_text())
    if revision is not None and previous.get('revision',0)>revision:self.reply(409,{'error':'A newer report is already saved','revision':previous['revision']});return
   data['serverSavedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
   tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2,allow_nan=False));tmp.replace(dest)
  self.reply(200,{'saved':True,'runId':m[1],'revision':revision,'serverSavedAt':data['serverSavedAt']})
if __name__=='__main__':ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('LAB_PORT','8080'))),Handler).serve_forever()

"""Local regression: fresh clients need no shared secret; report ownership remains enforced."""
import json,os,pathlib,subprocess,tempfile,time,urllib.request,urllib.error,uuid,socket
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);(root/'assets').mkdir();(root/'assets'/'hello.txt').write_text('public');(root/'results').mkdir()
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base='http://127.0.0.1:'+str(port);env={**os.environ,'LAB_KEY':'local-test-key','LAB_PORT':str(port),'LAB_ASSETS':str(root/'assets'),'LAB_RESULTS':str(root/'results')}
 child=subprocess.Popen(['python3',str(pathlib.Path(__file__).with_name('server.py'))],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def request(path,method='GET',data=None,token=None,headers=None):
  req=urllib.request.Request(base+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {}),**(headers or {})})
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read(),r.headers
  except urllib.error.HTTPError as e:return e.code,e.read(),e.headers
 try:
  for _ in range(100):
   try:
    if request('/health')[0]==200:break
   except OSError:time.sleep(.05)
  def create():
   code,data,_=request('/api/runs','POST',{});assert code==201;return json.loads(data)
  a,b=create(),create();assert a['runId']!=b['runId'] and a['writeToken']!=b['writeToken']
  report={'schemaVersion':1,'runId':a['runId'],'revision':1,'results':[{'id':'synthetic-check','completed':False,'error':'GPU unavailable'}]}
  path='/api/runs/'+a['runId']
  assert request(path,'PUT',report)[0]==401
  assert request(path,'PUT',report,b['writeToken'])[0]==401
  assert request(path,'PUT',report,a['writeToken'])[0]==200
  report['revision']=2;report['finished']='test-finished'
  assert request(path,'POST',report,a['writeToken'])[0]==200
  assert request(path,'PUT',{**report,'revision':1},a['writeToken'])[0]==409
  assert json.loads((root/'results'/(a['runId']+'.json')).read_text())['revision']==2
  assert request(path)[0]==404 and request('/results/'+a['runId']+'.json')[0]==404
  assert request('/api/runs','POST',{},headers={'Origin':'https://other.example'})[0]==403
  assert request('/api/runs','POST',{},headers={'Sec-Fetch-Site':'cross-site'})[0]==403
  assert request(path,'PUT',{**report,'results':None},a['writeToken'])[0]==400
  legacy=str(uuid.uuid4());assert request('/api/runs/'+legacy,'PUT',{'schemaVersion':1,'runId':legacy,'results':[]},'local-test-key')[0]==200
  assert request('/hello.txt','HEAD')[1]==b''
  assert request('/hello.txt')[2]['Cross-Origin-Embedder-Policy']=='require-corp'
  assert request('/hello.txt')[2]['Cache-Control']=='no-cache'
  assert request('/health')[2]['Cache-Control']=='no-store'
  subprocess.run(['node',str(pathlib.Path(__file__).with_name('test_save_client_v4.mjs')),base],check=True)
  print('Saving API regressions passed: fresh clients, scoped writes, POST/PUT, stale snapshots, private reports, legacy auth and headers.')
 finally:child.terminate();child.wait(timeout=5)

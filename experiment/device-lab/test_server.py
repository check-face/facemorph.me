"""Integration checks against the deployed result API, without touching other apps."""
import json,os,urllib.request,urllib.error,uuid
base=os.environ['LAB_URL'];key=os.environ['LAB_KEY'];run=str(uuid.uuid4())
def request(path,method='GET',data=None,auth=None):
 req=urllib.request.Request(base+path,method=method,data=data,headers={'Authorization':'Bearer '+(auth or ''),'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,r.read(),r.headers
 except urllib.error.HTTPError as e:return e.code,e.read(),e.headers
assert request('/health')[0]==200
body=json.dumps({'schemaVersion':1,'runId':run,'test':True,'results':[]}).encode()
assert request('/api/runs/'+run,'PUT',body)[0]==401
assert request('/api/runs/'+run,'PUT',b'{}',key)[0]==400
assert request('/api/runs/'+run,'PUT',body,key)[0]==200
assert request('/api/runs/'+run)[0]==404
assert request('/results/'+run+'.json')[0]==404
assert request('/facemorph.me/experiment/device-lab/server.py')[0]==404
assert request('/migration_plan.md')[0]==404
assert request('/api/runs/'+run,'PUT',b'x'*(2*1024*1024+1),key)[0]==413
status,_,headers=request('/facemorph.me/experiment/device-lab/index.html');assert status==200
assert headers['Cross-Origin-Opener-Policy']=='same-origin' and headers['Cross-Origin-Embedder-Policy']=='require-corp'
print('10 deployed checks passed; synthetic test report',run)

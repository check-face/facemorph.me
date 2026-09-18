"""Small deployed browser smoke under the cooperative device lease."""
import subprocess,json,time,os

def bh(code):return subprocess.check_output(['browser-harness'],input=code,text=True).strip()
state=lambda:json.loads(bh('print(js("JSON.stringify({running:document.querySelector(\'#run\').disabled,status:document.querySelector(\'#status\').textContent,saved:document.querySelector(\'#saved\').textContent,report:JSON.parse(localStorage.getItem(\'facemorph-lab-last\'))})"))'))
if state()['running']:raise RuntimeError('Existing experiment still active')
print(bh('print(js("JSON.stringify({hasLegacyKey:!!sessionStorage.getItem(\'lab-key\'),visibility:document.visibilityState})"))'),flush=True)
emulated=os.getenv('LAB_SMOKE_FOCUS')=='1'
if emulated:bh("cdp('Emulation.setFocusEmulationEnabled',enabled=True)\njs('window.__labFocusEmulated=true')")
before=state()['report']['runId']
bh('js("document.querySelectorAll(\'.case input\').forEach(c=>c.checked=[\'colour\',\'ffmpeg\',\'mobile\'].includes(c.value));document.querySelector(\'#label\').value=window.__labFocusEmulated?\'Mac no-key repair: CDP visibility emulated; compatibility only\':\'Mac no-key repair verification\';document.querySelector(\'#run\').click()")')
try:
 for _ in range(150):
  time.sleep(1);s=state()
  if s['report']['runId']!=before and s['report'].get('finished') and not s['running']:
   print(json.dumps({'runId':s['report']['runId'],'status':s['status'],'saved':s['saved'],'results':[{'id':x['id'],'completed':x.get('completed'),'error':x.get('error')} for x in s['report']['results']]}),flush=True)
   if not all(x.get('completed') for x in s['report']['results']):raise RuntimeError('Smoke case failed; inspect saved diagnostic')
   break
 else:raise RuntimeError('Browser smoke deadline reached')
finally:
 if state()['running']:bh('js("document.querySelector(\'#stop\').click()")')
 if emulated:bh("cdp('Emulation.setFocusEmulationEnabled',enabled=False)")

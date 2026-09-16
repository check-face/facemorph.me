# Executed by browser-harness, which supplies js/cdp/new_tab/click_at_xy helpers.
import hashlib,json,os,time
from pathlib import Path
out=Path('next-e2e-evidence');downloads=(out/'downloads').resolve()
result={'passed':False,'checks':{},'runtimeSha256':os.environ['RUNTIME_SHA'],'scope':'Exact compiled UI CPU qualification; synthetic inputs only; not physical-phone evidence. The agent string below states which engine actually ran this; one engine is not evidence for another.'}
def inspect(expression):return json.loads(js('JSON.stringify('+expression+')'))
def wait(predicate,seconds=5400):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  error=js("document.querySelector('.next-error')?.innerText||''")
  if error:raise RuntimeError(error)
  value=predicate()
  if value:return value
  time.sleep(.5)
 raise TimeoutError('UI stage deadline exceeded')
def click(name):
 # Re-resolve through the accessibility tree each attempt: a re-render between reading the
 # box model and dispatching the click otherwise sends a real click at a stale point, which
 # silently does nothing. The click stays a genuine coordinate click on the accessible button.
 for attempt in range(5):
  nodes=cdp('Accessibility.getFullAXTree')['nodes'];n=next(n for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==name)
  ident=n['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
  q=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
  if js("(()=>{const e=document.elementFromPoint(%f,%f),b=e&&e.closest('button');return !!(b&&(b.textContent===%s||b.getAttribute('aria-label')===%s));})()"%(x,y,json.dumps(name),json.dumps(name))):
   click_at_xy(x,y);return
  time.sleep(.5)
 raise RuntimeError('Could not place a click on '+name)
def idle():return js("!document.querySelector('.next-status progress') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Generate faces'&&!b.disabled)")
def run(name):
 before=js('window.__ciBusyChanges');click(name);wait(lambda:js('window.__ciBusyChanges')>before,30);wait(idle)
def faces():
 return inspect("[...document.querySelectorAll('.next-face-image img')].map(i=>({width:i.naturalWidth,height:i.naturalHeight,url:i.src}))")
def download(name):
 folder=downloads/str(time.time_ns());folder.mkdir();cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(folder));click(name)
 return wait(lambda:next((p for p in folder.iterdir() if p.suffix!='.crdownload' and p.stat().st_size>0),None),60)
def upload(selector,path):
 root=cdp('DOM.getDocument')['root']['nodeId'];node=cdp('DOM.querySelector',nodeId=root,selector=selector)['nodeId'];assert node,'File input missing';cdp('DOM.setFileInputFiles',nodeId=node,files=[str(path.resolve())])
def save_check(name,data):result['checks'][name]=data;(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'check':name,**data}),flush=True)
try:
 cdp('Page.enable')
 cdp('Page.addScriptToEvaluateOnNewDocument',source="window.__ciWorkers=0;window.__ciWorkerRequests=0;const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);window.__ciWorkers++;}postMessage(...args){window.__ciWorkerRequests++;return super.postMessage(...args);}};")
 cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(downloads))
 new_tab('https://next.facemorph.me/');wait_for_load()
 # Register on the actual tab too: the initial registration may belong to the prior tab.
 js("if(window.__ciWorkers===undefined){window.__ciWorkers=0;window.__ciWorkerRequests=0;const W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);window.__ciWorkers++;}postMessage(...args){window.__ciWorkerRequests++;return super.postMessage(...args);}};}")
 wait(idle,60);assert js('crossOriginIsolated'), 'Production isolation headers missing'
 # Name the engine that produced this evidence so a matrix row cannot be claimed for another.
 result['agent']=inspect('navigator.userAgent');result['engine']=inspect("(/Firefox|FxiOS/.test(navigator.userAgent)?'gecko':/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent)?'blink':/Safari/.test(navigator.userAgent)?'webkit':'other')")
 js("window.__ciOrigin=null;fetch('/').then(r=>window.__ciOrigin=r.headers.get('X-Next-Artifact-Source')).catch(e=>window.__ciOrigin='error')")
 wait(lambda:js('window.__ciOrigin!==null'),60);assert js('window.__ciOrigin')==Path('next-site-source.txt').read_text().strip(), 'Chrome did not reach exact local artifact origin'
 js("window.__ciBusyChanges=0;window.__ciBusyObserver=new MutationObserver(records=>{for(const r of records)if(r.attributeName==='disabled'&&r.target.textContent==='Generate faces')window.__ciBusyChanges++;});window.__ciBusyObserver.observe(document.querySelector('.next-product'),{subtree:true,attributes:true,attributeFilter:['disabled']});")
 js("document.querySelector('.next-advanced').open=true")
 root=cdp('DOM.getDocument')['root']['nodeId']
 # Explicit CPU selection, independent of GPU availability. Keyboard interaction is the
 # preferred path and is what Linux Chromium exercises; macOS/WebKit/Gecko drive the native
 # popup differently, so the fallback sets the value through the real setter and change event.
 # The method used is recorded: a keyboard pass is stronger evidence than a scripted one.
 node=cdp('DOM.querySelector',nodeId=root,selector='select[aria-label="Processing mode"]')['nodeId'];cdp('DOM.focus',nodeId=node)
 for key,code in [('Home',36),('ArrowDown',40),('Enter',13),('Escape',27)]:
  cdp('Input.dispatchKeyEvent',type='keyDown',key=key,windowsVirtualKeyCode=code);cdp('Input.dispatchKeyEvent',type='keyUp',key=key,windowsVirtualKeyCode=code)
 mode=js("document.querySelector('select[aria-label=\"Processing mode\"]').value")
 selection='keyboard' if mode=='cpu' else 'scripted'
 if mode!='cpu':
  js("(()=>{const s=document.querySelector('select[aria-label=\"Processing mode\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'cpu');s.dispatchEvent(new Event('change',{bubbles:true}));})()")
  wait(lambda:js("document.querySelector('select[aria-label=\"Processing mode\"]').value")=='cpu',10)
 assert js("document.querySelector('select[aria-label=\"Processing mode\"]').value")=='cpu'
 result['processingSelection']=selection
 run('Generate faces');images=wait(lambda:faces() if len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()) else None,60)
 save_check('nameSeed',{'passed':True,'dimensions':[[i['width'],i['height']] for i in images],'processingSelection':selection})
 first=download('Save image');first_hash=hashlib.sha256(first.read_bytes()).hexdigest();workers=js('window.__ciWorkers');requests=js('window.__ciWorkerRequests')
 run('Generate faces');second=download('Save image');assert hashlib.sha256(second.read_bytes()).hexdigest()==first_hash;assert js('window.__ciWorkers')==workers,'Repeat created an inference worker';assert js('window.__ciWorkerRequests')==requests,'Repeat invoked the inference worker'
 save_check('repeatOriginal',{'passed':True,'sha256':first_hash,'newWorkers':0,'newWorkerRequests':0})
 upload('input[aria-label="Choose photo"]',first)
 wait(lambda:js("document.querySelector('select[aria-label=\"Face source\"]').value==='photo'"),60)
 run('Generate faces');assert len(faces())==2 and all(i['width']==1024 for i in faces());assert js('window.__ciWorkers')>workers
 save_check('syntheticPhotoE4e',{'passed':True,'inputSha256':first_hash,'note':'Real photo UI uses generated synthetic face; runtime must pass strict alignment and encoder canaries'})
 project=download('Export project');parsed=json.loads(project.read_text());assert len(parsed['morph']['controls'])==2 and all(len(c['latent']['values'])==9216 for c in parsed['morph']['controls'])
 upload('input[aria-label="Open project"]',project);time.sleep(.5);wait(idle)
 assert js("[...document.querySelectorAll('select[aria-label=\"Face source\"]')].every(s=>s.value==='project')")
 save_check('projectSaveReopen',{'passed':True,'sha256':hashlib.sha256(project.read_bytes()).hexdigest()})
 run('Create morph');wait(lambda:js("!!document.querySelector('.next-result video')"),60)
 js("window.__ciPlayback={done:false};(async()=>{try{const v=document.querySelector('.next-result video');v.muted=true;await v.play();await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('No decoded video frame')),30000);v.requestVideoFrameCallback(()=>{clearTimeout(t);r();});});window.__ciPlayback={done:true,width:v.videoWidth,height:v.videoHeight,duration:v.duration,time:v.currentTime};v.pause();}catch(e){window.__ciPlayback={done:true,error:String(e)};}})()")
 wait(lambda:js('window.__ciPlayback.done'),60);playback=inspect('window.__ciPlayback');assert not playback.get('error') and playback['width']==512 and playback['duration']>0,playback
 video=download('Save video');assert video.stat().st_size>1000 and b'ftyp' in video.read_bytes()[:32]
 save_check('morphPlayableMp4',{'passed':True,**playback,'bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest()})
 result['passed']=True
except Exception as error:
 result['error']=str(error)
 raise
finally:
 result['finishedAt']=time.time();(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

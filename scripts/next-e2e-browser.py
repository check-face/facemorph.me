# Executed by browser-harness, which supplies js/cdp/new_tab/click_at_xy helpers.
#
# Qualifies the exact served artifact bytes in a real browser through the real user flow.
# What the gate protects, in order: (1) provenance - the browser demonstrably reached the
# pinned artifact origin; (2) determinism - same seed produces byte-identical PNGs, project
# export survives reopen with identical latents; (3) honest degradation - a refused route is
# NAMED next to the route in use; (4) cache/worker hygiene - repeats stay cache hits with zero
# new inference workers; (5) real flows - crop, photo e4e, morph, playable MP4 download.
#
# Structure: S (locator contract) -> helpers -> stage functions -> driver. A UI change should
# only ever require editing S. Every stage records its evidence before anything raises, and
# failures name their stage. Set E2E_UNTIL=<stage name> to run the state-building prefix
# through one stage for fast local iteration; CI leaves it unset and runs everything.
# Partial runs never set passed:true.
import hashlib,json,os,time
from pathlib import Path
out=Path('next-e2e-evidence');downloads=(out/'downloads').resolve()
UNTIL=os.environ.get('E2E_UNTIL','')
result={'passed':False,'checks':{},'runtimeSha256':os.environ.get('RUNTIME_SHA',''),'scope':'Exact compiled UI CPU qualification; synthetic inputs only; not physical-phone evidence. The agent string below states which engine actually ran this; one engine is not evidence for another.'}
CTX={}  # stage-to-stage artifacts: seedPng, seedSha, workerBaseline, projectFile

# --- Locator contract: the single place a UI rename may break this harness. ---------------
# Buttons are matched by accessible name via the AX tree; fields by aria-label; containers by
# the app's stable next-* classes. Text content of the seeded faces, not selectors, is data.
S={
 'error':'.next-error',
 'status':'.next-status',
 'busy':'.next-status progress',
 'routeCaption':'.next-route-caption',
 'faceImage':'.next-face-image img',
 'faceTextInputs':'.next-face input',
 'processingMode':'select[aria-label="Processing mode"]',
 'faceSource':'select[aria-label="Face source"]',
 'choosePhoto':'input[aria-label="Choose photo"]',
 'openProject':'input[aria-label="Open project"]',
 'cropView':'.next-crop-view',
 'cropZoom':'.next-crop-zoom input',
 'fileName':'.next-file span',
 'video':'.next-video-slot video',
 'product':'.next-product',
 'advanced':'.next-advanced',
 'buttons':{'generate':'Generate faces','saveImage':'Save image','exportProject':'Export project',
            'createMorph':'Create morph','saveVideo':'Save video','crop':'Crop photo',
            'rotate':'Rotate','useCrop':'Use this crop'},
}
def q(expr):return json.loads(js('JSON.stringify('+expr+')'))
def text(sel):return js("(document.querySelector('%s')?.innerText||'')"%sel)
def wait(predicate,seconds=600):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  error=text(S['error'])
  if error:raise RuntimeError(error)
  value=predicate()
  if value:return value
  time.sleep(.5)
 raise TimeoutError('UI stage deadline exceeded')
def click(name,expect=None):
 # A click must be verified: a stale React node or a re-render can swallow it silently, which
 # used to surface minutes later as an unrelated stage timeout. The DOM route clicks the exact
 # button; `expect` (when given) re-queries up to three times, re-clicking if the UI did not
 # react, before falling back to the coordinate route.
 for attempt in range(3):
  if js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===%s||x.getAttribute('aria-label')===%s);if(!b)return false;b.click();return true;})()"%(json.dumps(name),json.dumps(name))):
   if expect is None:
    time.sleep(1)
    if js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===%s||x.getAttribute('aria-label')===%s);return !!b;})()"%(json.dumps(name),json.dumps(name))) or True:
     return
   else:
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
     try:
      if expect():return
     except Exception:pass
     time.sleep(.5)
  time.sleep(1)
 # Route 2 (fallback): re-resolve through the accessibility tree each attempt: a re-render
 # between reading the box model and dispatching the click otherwise sends a real click at a
 # stale point, which silently does nothing. The click stays a genuine coordinate click on
 # the accessible button.
 for attempt in range(5):
  nodes=cdp('Accessibility.getFullAXTree')['nodes'];name_lower=name.lower()
  n=next((n for n in nodes if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value','').lower()==name_lower),None)
  ident=n['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
  box=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];x,y=sum(box[0::2])/4,sum(box[1::2])/4
  if js("(()=>{const e=document.elementFromPoint(%f,%f),b=e&&e.closest('button');return !!(b&&(b.textContent===%s||b.getAttribute('aria-label')===%s));})()"%(x,y,json.dumps(name),json.dumps(name))):
   click_at_xy(x,y);return
  time.sleep(.5)
 raise RuntimeError('Could not place a click on '+name)
def idle():return js("!document.querySelector('%s') && [...document.querySelectorAll('button')].some(b=>b.textContent==='%s'&&!b.disabled)"%(S['busy'],S['buttons']['generate']))
def run(name,predicate=None):
 # A warm cache can complete a run synchronously - the button's disabled state never flips -
 # so a busy transition cannot be required. Accept either the transition or the stage's own
 # completion evidence, then wait for idle. Outcome assertions stay with the callers.
 before=js('window.__ciBusyChanges')
 click(name,expect=lambda: js('window.__ciBusyChanges')>before or (predicate() if predicate else False))
 wait(lambda: js('window.__ciBusyChanges')>before or (predicate() if predicate else False),30);wait(idle)
def faces():
 return q("[...document.querySelectorAll('%s')].map(i=>({width:i.naturalWidth,height:i.naturalHeight,url:i.src}))"%S['faceImage'])
def select_mode(value):
 js("(()=>{const s=document.querySelector('%s');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'%s');s.dispatchEvent(new Event('change',{bubbles:true}));})()"%(S['processingMode'],value))
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if js("document.querySelector('%s').value"%S['processingMode'])==value:return
  time.sleep(.5)
 raise AssertionError('Processing mode did not become '+value)
def set_last_text_input():
 # The last text input is targeted because a face whose mode sits on 'Numeric seed' renders a
 # digits-only input instead of a words input, and a words input accepts anything. A fresh
 # value every call: a repeated value is a cache hit with zero inference.
 js("(()=>{const ins=[...document.querySelectorAll('%s')].filter(x=>x.type==='text');const i=ins[ins.length-1];if(!i)return;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(i,%s);i.dispatchEvent(new Event('input',{bubbles:true}));})()"%(S['faceTextInputs'],json.dumps('rejection-check '+str(time.time_ns()))))
def download(name):
 folder=downloads/str(time.time_ns());folder.mkdir();cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(folder));click(name)
 return wait(lambda:next((p for p in folder.iterdir() if p.suffix!='.crdownload' and p.stat().st_size>0),None),60)
def upload(selector,path):
 root=cdp('DOM.getDocument')['root']['nodeId'];node=cdp('DOM.querySelector',nodeId=root,selector=selector)['nodeId'];assert node,'File input missing';cdp('DOM.setFileInputFiles',nodeId=node,files=[str(path.resolve())])
def save_check(name,data):result['checks'][name]=data;(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'check':name,**data}),flush=True)

# --- Stages ------------------------------------------------------------------------------
def stage_preflight():
 # Seconds-fast tripwire for the failure class that actually burned us: UI drift. No
 # synthesis, no downloads - only presence of the controls the later stages depend on, plus
 # the provenance assertions (isolation headers, exact artifact origin, engine identity).
 cdp('Page.enable')
 cdp('Page.addScriptToEvaluateOnNewDocument',source="window.__ciWorkers=0;window.__ciWorkerRequests=0;const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);window.__ciWorkers++;}postMessage(...args){window.__ciWorkerRequests++;return super.postMessage(...args);}};")
 cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(downloads))
 new_tab('https://next.facemorph.me/');wait_for_load()
 # Register on the actual tab too: the initial registration may belong to the prior tab.
 js("if(window.__ciWorkers===undefined){window.__ciWorkers=0;window.__ciWorkerRequests=0;const W=window.Worker;window.Worker=class extends W{constructor(...a){super(...a);window.__ciWorkers++;}postMessage(...args){window.__ciWorkerRequests++;return super.postMessage(...args);}};}")
 wait(idle,60);assert js('crossOriginIsolated'), 'Production isolation headers missing'
 result['agent']=q('navigator.userAgent');result['engine']=q("(/Firefox|FxiOS/.test(navigator.userAgent)?'gecko':/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent)?'blink':/Safari/.test(navigator.userAgent)?'webkit':'other')")
 js("window.__ciOrigin=null;fetch('/').then(r=>window.__ciOrigin=r.headers.get('X-Next-Artifact-Source')).catch(e=>window.__ciOrigin='error')")
 wait(lambda:js('window.__ciOrigin!==null'),60);assert js('window.__ciOrigin')==Path('next-site-source.txt').read_text().strip(), 'Chrome did not reach exact local artifact origin'
 js("window.__ciBusyChanges=0;window.__ciBusyObserver=new MutationObserver(records=>{for(const r of records)if(r.attributeName==='disabled'&&r.target.textContent==='Generate faces')window.__ciBusyChanges++;});window.__ciBusyObserver.observe(document.querySelector('%s'),{subtree:true,attributes:true,attributeFilter:['disabled']});"%S['product'])
 state=q("({tiles:document.querySelectorAll('.next-face').length,photos:document.querySelectorAll('%s').length,words:!!document.querySelector('%s'),generate:[...document.querySelectorAll('button')].some(b=>b.textContent==='%s'),modeOptions:[...document.querySelectorAll('%s option')].map(o=>o.value),error:(document.querySelector('%s')?.innerText||'')})"%(S['choosePhoto'],S['faceTextInputs'],S['buttons']['generate'],S['processingMode'],S['error']))
 assert state['tiles']==2 and state['photos']==2 and state['words'] and state['generate'],state
 assert set(['auto','cpu','webgpu','webgl'])<=set(state['modeOptions']),state
 assert not state['error'],state['error']
 save_check('preflight',{'passed':True,'modeOptions':state['modeOptions'],'engine':result['engine']})
def stage_seedGeneration():
 # U-09 moved the processing-mode control into the always-rendered debug area; opening a
 # collapsed advanced section is no longer part of reaching it.
 js("document.querySelector('%s')&&(document.querySelector('%s').open=true)"%(S['advanced'],S['advanced']))
 root=cdp('DOM.getDocument')['root']['nodeId']
 # Explicit CPU selection, independent of GPU availability. Keyboard interaction is the
 # preferred path and is what Linux Chromium exercises; macOS/WebKit/Gecko drive the native
 # popup differently, so the fallback sets the value through the real setter and change event.
 # The method used is recorded: a keyboard pass is stronger evidence than a scripted one.
 node=cdp('DOM.querySelector',nodeId=root,selector=S['processingMode'])['nodeId'];cdp('DOM.focus',nodeId=node)
 for key,code in [('Home',36),('ArrowDown',40),('Enter',13),('Escape',27)]:
  cdp('Input.dispatchKeyEvent',type='keyDown',key=key,windowsVirtualKeyCode=code);cdp('Input.dispatchKeyEvent',type='keyUp',key=key,windowsVirtualKeyCode=code)
 # A native select popup left open (headless quirk) swallows every later click silently;
 # a real click on neutral space closes it. Blur then guard with Escape.
 js("document.activeElement instanceof HTMLElement&&document.activeElement.blur()")
 click_at_xy(400,20);time.sleep(.5)
 mode=js("document.querySelector('%s').value"%S['processingMode'])
 selection='keyboard' if mode=='cpu' else 'scripted'
 if mode!='cpu':select_mode('cpu')
 result['processingSelection']=selection
 run(S['buttons']['generate'],predicate=lambda:len(faces())==2);images=wait(lambda:faces() if len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()) else None,60)
 save_check('nameSeed',{'passed':True,'dimensions':[[i['width'],i['height']] for i in images],'processingSelection':selection})
 first=download(S['buttons']['saveImage'])
 CTX['seedSha']=hashlib.sha256(first.read_bytes()).hexdigest()
 # The photo-face upload needs its own cache identity: same pixels as the seed PNG (decoders
 # ignore bytes after IEND) but different bytes, so the e4e encode really runs instead of
 # replaying a cached entry on the warm profiles this harness accumulates.
 uniq=first.with_name(first.stem+'-e4e.png');uniq.write_bytes(first.read_bytes()+b'\n<!-- e4e '+str(time.time_ns()).encode()+b' -->')
 CTX['seedPng']=uniq
def stage_routeRejection():
 # C-02: force the canary comparison to fail on a second route and assert the interface names
 # both the route that was refused and the route now in use, instead of silently falling back.
 # The forcing hook lives in the canary comparison only; tolerances are untouched. An explicit
 # route has no fallback, so the run fails - the assertion is that the caption NAMES the route
 # that failed and the route still in use, next to the error that says why.
 js("window.__FACEMORPH_FORCE_CANARY_FAIL__=true")
 # The face must actually synthesize or admission never runs (a repeated input is a cache
 # hit with zero inference), so change the second face's text first.
 set_last_text_input()
 select_mode('webgpu')
 before=js('window.__ciBusyChanges');click(S['buttons']['generate']);wait(lambda:js('window.__ciBusyChanges')>before,30)
 # The run is expected to fail on the explicitly selected webgpu route; wait() cannot be used
 # here because it treats any visible error as fatal. Poll for the failure to settle instead.
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  if not js("!!document.querySelector('%s')"%S['busy']):break
  time.sleep(.5)
 caption=''
 deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  caption=text(S['routeCaption'])
  if 'webgpu' in caption and 'cpu' in caption and 'failed' in caption:break
  time.sleep(.5)
 else:raise AssertionError('route caption never named the refused and current routes: '+caption)
 save_check('routeRejectionNamed',{'passed':True,'caption':caption,'error':text(S['error'])})
 # Back to CPU for the remaining checks; the cpu qualification is already cached (C-03). The
 # expected error above stays on screen until the next run starts, so this polls the select
 # directly instead of wait(), which treats any visible error as fatal.
 select_mode('cpu')
 js("window.__FACEMORPH_FORCE_CANARY_FAIL__=false")
def stage_repeatOriginal():
 # Rebuild the cpu runtime once after the forced rejection (stop() disposed it), so the
 # repeat-original zero-worker baselines are measured against a warm, healthy runtime.
 run(S['buttons']['generate'],predicate=lambda:len(faces())==2)
 # Baselines for the repeat-original zero-worker assertions are taken AFTER the forced
 # rejection, which legitimately allocated a worker for the failed webgpu attempt.
 workers=js('window.__ciWorkers');requests=js('window.__ciWorkerRequests')
 run(S['buttons']['generate'],predicate=lambda:len(faces())==2);second=download(S['buttons']['saveImage']);assert hashlib.sha256(second.read_bytes()).hexdigest()==CTX['seedSha'];assert js('window.__ciWorkers')==workers,'Repeat created an inference worker';assert js('window.__ciWorkerRequests')==requests,'Repeat invoked the inference worker'
 save_check('repeatOriginal',{'passed':True,'sha256':CTX['seedSha'],'newWorkers':0,'newWorkerRequests':0})
 CTX['workerBaseline']=workers
def stage_syntheticPhotoE4e():
 upload(S['choosePhoto'],CTX['seedPng'])
 wait(lambda:js("document.querySelector('%s').value==='photo'"%S['faceSource']),60)
 run(S['buttons']['generate'],predicate=lambda:len(faces())==2)
 wait(lambda:len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()),60);assert js('window.__ciWorkers')>CTX['workerBaseline']
def stage_localCrop():
 # Crop the chosen photo locally and generate from the crop, so an arbitrary original never
 # has to be aligned whole. The crop is what reaches alignment.
 click(S['buttons']['crop'],expect=lambda:js("!!document.querySelector('%s img')"%S['cropView']))
 wait(lambda:js("!!document.querySelector('%s img')"%S['cropView']),60)
 # The whole square is kept: alignment rightly refuses a crop that cuts the face in half or
 # turns it on its side, so this proves the crop pipeline feeds alignment, not the detector.
 js("(()=>{const s=document.querySelector('%s');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'1');s.dispatchEvent(new Event('change',{bubbles:true}));})()"%S['cropZoom'])
 for _ in range(4):click(S['buttons']['rotate'])  # Four right angles exercise the control and end upright.
 # The square must also be movable from the keyboard: pan right and back, and confirm Escape is
 # wired by checking the dialog survives an unrelated key.
 js("document.querySelector('%s').focus()"%S['cropView'])
 before=q("(()=>{const i=document.querySelector('%s');return {zoom:i.value,focused:document.activeElement===document.querySelector('%s')};})()"%(S['cropZoom'],S['cropView']))
 assert before['focused'],'Crop area did not take focus'
 for key,code in [('ArrowRight',39),('ArrowLeft',37)]:
  cdp('Input.dispatchKeyEvent',type='keyDown',key=key,windowsVirtualKeyCode=code);cdp('Input.dispatchKeyEvent',type='keyUp',key=key,windowsVirtualKeyCode=code)
 assert js("!!document.querySelector('%s')"%S['cropView']),'Arrow keys closed the crop dialog'
 click(S['buttons']['useCrop'],expect=lambda:js("!document.querySelector('%s')"%S['cropView']))
 wait(lambda:js("!document.querySelector('%s')"%S['cropView']),60);wait(idle)
 cropped=text(S['fileName'])
 assert cropped=='cropped.png',cropped
 run(S['buttons']['generate'],predicate=lambda:len(faces())==2)
 wait(lambda:len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()),60)
 save_check('localCrop',{'passed':True,'file':cropped})
def stage_projectSaveReopen():
 project=download(S['buttons']['exportProject']);parsed=json.loads(project.read_text());assert len(parsed['morph']['controls'])==2 and all(len(c['latent']['values'])==9216 for c in parsed['morph']['controls'])
 upload(S['openProject'],project);time.sleep(.5);wait(idle)
 assert js("[...document.querySelectorAll('%s')].every(s=>s.value==='project')"%S['faceSource'])
 save_check('projectSaveReopen',{'passed':True,'sha256':hashlib.sha256(project.read_bytes()).hexdigest()})
def stage_morphVideo():
 run(S['buttons']['createMorph'],predicate=lambda:js("!!document.querySelector('%s')"%S['video']))
 try:wait(lambda:js("!!document.querySelector('%s')"%S['video']),90)
 except TimeoutError:
  raise AssertionError('morph video absent; status=%r; workers=%r; workerRequests=%r'%(text(S['status']),js('window.__ciWorkers'),js('window.__ciWorkerRequests')))
 # Fire-and-poll: the evaluate must return immediately (the helper's awaitPromise window is
 # shorter than any real playback wait), the probe self-limits to 9s and records its result.
 js("window.__ciPlayback={done:false};(async()=>{const deadline=new Promise((_,j)=>setTimeout(()=>j(Error('playback probe exceeded 9s')),9000));try{const v=document.querySelector('.next-video-slot video');v.muted=true;await Promise.race([v.play(),deadline]);await Promise.race([new Promise(r=>{v.requestVideoFrameCallback(()=>r());}),deadline]);window.__ciPlayback={done:true,width:v.videoWidth,height:v.videoHeight,duration:v.duration,time:v.currentTime};v.pause();}catch(e){const v=document.querySelector('.next-video-slot video');window.__ciPlayback={done:true,error:String(e),src:(v&&v.src||'').slice(0,60),readyState:v?v.readyState:null,networkState:v?v.networkState:null,mediaError:v&&v.error?v.error.code+':'+(v.error.message||''):null,duration:v?v.duration:null};}})();0")
 wait(lambda:js('window.__ciPlayback.done'),45);playback=q('window.__ciPlayback');assert not playback.get('error') and playback['width'] in (512,1024) and playback['duration']>0,playback
 video=download(S['buttons']['saveVideo']);assert video.stat().st_size>1000 and b'ftyp' in video.read_bytes()[:32]
 save_check('morphPlayableMp4',{'passed':True,**playback,'bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest()})

# --- Driver ------------------------------------------------------------------------------
STAGES=[('preflight',stage_preflight),('seedGeneration',stage_seedGeneration),('routeRejection',stage_routeRejection),
        ('repeatOriginal',stage_repeatOriginal),('syntheticPhotoE4e',stage_syntheticPhotoE4e),('localCrop',stage_localCrop),
        ('projectSaveReopen',stage_projectSaveReopen),('morphVideo',stage_morphVideo)]
SKIP=set(filter(None,os.environ.get('E2E_SKIP','').split(',')))
try:
 for name,fn in STAGES:
  if name in SKIP:result.setdefault('skipped',[]).append(name);continue
  result['stage']=name
  try:
   fn()
  except Exception as error:
   result['stageError']=name+': '+str(error)
   raise
  if UNTIL==name:
   result['partial']=True
   print(json.dumps({'partialUntil':name}),flush=True);break
 else:result['passed']=not result.get('skipped')
except Exception as error:
 result['error']=str(error)
 raise
finally:
 result['finishedAt']=time.time();(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

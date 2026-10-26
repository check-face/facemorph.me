# Executed by browser-harness, which supplies js/cdp/new_tab/click_at_xy helpers.
#
# Qualifies the exact served artifact bytes in a real browser through the real user flow.
# What the gate protects, in order: (1) provenance - the browser demonstrably reached the
# pinned artifact origin; (2) determinism - repeat requests reuse the identical prepared file, project
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
network=None
_browser_js=js
def js(source):
 if network is not None:network.collect()
 return _browser_js(source)

# --- Locator contract: the single place a UI rename may break this harness. ---------------
# Buttons are matched by accessible name via the AX tree; fields by aria-label; containers by
# the app's stable next-* classes. Text content of the seeded faces, not selectors, is data.
S={
 'error':'.next-error',
 'status':'.next-status',
 'busy':'.next-status progress',
 'routeCaption':'.next-route-caption',
 'faceImage':'.next-face-image img:not([data-public-preview]), .next-face-image canvas[data-face-drawn="true"]',
 'faceTextInputs':'.next-face .next-field input',
 'faceGenerate':'.next-face .next-face-generate:not(.next-file-preparation)',
 'processingMode':'select[aria-label="Processing mode"]',
 'faceSource':'select[aria-label="Face source"]',
 'choosePhoto':'.next-face input[type="file"]',
 'openProject':'input[aria-label="Open project"]',
 'cropView':'.next-crop-view',
 'cropZoom':'.next-crop-zoom input',
 'fileName':'.next-face[data-next-state="photo"] .next-field input',
 'video':'.next-video-slot video',
 'product':'.next-product',
 'advanced':'.next-advanced',
 'buttons':{'generate':'Generate faces','saveImage':'Save image','exportProject':'Export project',
            'createMorph':'Create morph','saveVideo':'Save video','crop':'Crop photo',
            'rotate':'Rotate','useCrop':'Use this crop'},
}
def logs_tail():
 try:return ' | '.join(js('[...window.__ciLogs].slice(-8)') or [])
 except Exception:return ''
def alive():
 # A dead renderer makes every js() read return null, which used to surface as bizarre stage
 # failures minutes later. Probe the context directly so the failure names the real cause.
 v=js('1+1')
 if v!=2:raise RuntimeError('renderer unresponsive (eval returned %r)'%(v,))
def ensure_instrumented():
 js("if(!window.__ciGate){window.__ciGate=0;setInterval(()=>{const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__ciGate++;b.click();}},250);}")
 # The Worker counters re-install on every document; the busy observer and the console tap do
 # not. Re-arm them so a mid-suite reload degrades to zero-counted transitions instead of
 # null comparisons, and late failures still carry the runtime's last words.
 js("if(!window.__ciLogs){window.__ciLogs=[];['log','warn','error','info'].forEach(k=>{const o=console[k].bind(console);console[k]=(...a)=>{try{window.__ciLogs.push(k+': '+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,300));if(window.__ciLogs.length>40)window.__ciLogs.shift();}catch(e){}};});}")
 # React replaces the status node on re-render, and an observer left watching the detached one
 # counts nothing forever: every later click then looks like a click that did nothing. Re-arm
 # whenever the node being watched is no longer the one in the document — a reload is not the
 # only way instrumentation goes stale.
 js("window.__ciBusyChanges=window.__ciBusyChanges||0;if(!window.__ciBusyObserver||!window.__ciBusyNode||!document.contains(window.__ciBusyNode)){if(window.__ciBusyObserver)window.__ciBusyObserver.disconnect();window.__ciBusyNode=document.querySelector('.next-status');window.__ciBusyObserver=new MutationObserver(()=>{window.__ciBusyChanges++;});window.__ciBusyObserver.observe(window.__ciBusyNode,{subtree:true,attributes:true,childList:true,characterData:true});window.__ciBusyChanges++;}")
def q(expr):return json.loads(js('JSON.stringify('+expr+')'))
def text(sel):return js("(()=>{const e=document.querySelector('%s');return e instanceof HTMLInputElement?e.value:(e?.innerText||'');})()"%sel)
def wait(predicate,seconds=600,allow_error=False):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  error=text(S['error'])
  if error and not allow_error:raise RuntimeError(error)
  value=predicate()
  if value:return value
  time.sleep(.5)
 raise TimeoutError('UI stage deadline exceeded')
def generate_labels():
 return q("[...document.querySelectorAll(%s)].filter(b=>!b.disabled&&/^(Generate|Retry)$/.test(b.textContent.trim())).map(b=>b.getAttribute('aria-label'))"%json.dumps(S['faceGenerate']))
def click(name,expect=None):
 if name==S['buttons']['generate']:
  labels=generate_labels()
  assert labels,'No face is awaiting Generate or inference Retry'
  name=labels[-1]
 if name in generate_labels():
  # File preparation shares the operation slot, but it is never an inference action.
  press_selector(S['faceGenerate']+'[aria-label='+json.dumps(name)+']',allow_error=True)
  return
 # A click must be verified: a stale React node or a re-render can swallow it silently, which
 # used to surface minutes later as an unrelated stage timeout. The DOM route clicks the exact
 # button; `expect` (when given) re-queries up to three times, re-clicking if the UI did not
 # react, before falling back to the coordinate route.
 for attempt in range(3):
  if js("(()=>{const b=[...document.querySelectorAll('button,[role=menuitem]')].find(x=>x.textContent.trim()===%s||x.getAttribute('aria-label')===%s);if(!b)return false;b.click();return true;})()"%(json.dumps(name),json.dumps(name))):
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
  n=next((n for n in nodes if n.get('role',{}).get('value') in ('button','menuitem') and n.get('name',{}).get('value','').lower()==name_lower),None)
  if n is None:
   time.sleep(.5);continue
  ident=n['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
  box=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];x,y=sum(box[0::2])/4,sum(box[1::2])/4
  if js("(()=>{const e=document.elementFromPoint(%f,%f),b=e&&e.closest('button,[role=menuitem]');return !!(b&&(b.textContent.trim()===%s||b.getAttribute('aria-label')===%s));})()"%(x,y,json.dumps(name),json.dumps(name))):
   click_at_xy(x,y);return
  time.sleep(.5)
 # Name what the page was actually showing: whether the button was there at all, whether it was
 # disabled, and what the status line said. "Could not place a click" on its own sent the last
 # failure looking for a missing button that was present and enabled the whole time.
 seen=js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===%s);return JSON.stringify({present:!!b,disabled:b?b.disabled:null,status:(document.querySelector('.next-status')?.innerText||'').slice(0,120)});})()"%json.dumps(name))
 raise RuntimeError('Could not place a click on %s; page showed %s'%(name,seen))
def idle():return js("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'&&!([...document.querySelectorAll('.next-face-generate')].some(b=>/^(Cancel|Cancelling)$/.test(b.textContent.trim())))")

def run(name,predicate=None):
 if name==S['buttons']['generate']:
  labels=generate_labels()
  assert labels,'Generate must operate an invalidated face, not pass on completed results'
  for label in labels:run(label)
  if predicate:wait(predicate,60)
  return
 # A warm cache can complete a run synchronously - the button's disabled state never flips -
 # so a busy transition cannot be required. Accept either the transition or the stage's own
 # completion evidence, then wait for idle. Outcome assertions stay with the callers. A stage
 # may have reloaded the page since the driver last armed the observers, so re-arm here.
 ensure_instrumented()
 before=js('window.__ciBusyChanges')
 # Three independent signals that the click landed, because each one alone has a blind spot: the
 # busy counter misses a job whose status has not changed yet, the stage predicate can be minutes
 # away on the CPU route, and the button's own disabled state says nothing once the job finishes.
 # Every one of these buttons disables while a job runs, so that flip is the earliest honest
 # evidence available and it does not depend on any instrumentation surviving a re-render.
 started=lambda: js('window.__ciBusyChanges')>before or js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===%s||x.getAttribute('aria-label')===%s);return !!b&&b.disabled;})()"%(json.dumps(name),json.dumps(name))) or (predicate() if predicate else False)
 click(name,expect=started)
 wait(started,30);wait(idle)
def faces():
 # fm-id4c reserves a Remove band above the full source frame inside this box (fm-j4i8).
 # The frame fills its width and retains its source aspect; it must not fill the control band.
 return q("[...document.querySelectorAll('%s')].map(i=>{const r=i.getBoundingClientRect(),t=i.closest('.next-face-image').getBoundingClientRect(),width=i.naturalWidth||i.width,height=i.naturalHeight||i.height;return {width,height,url:i.src||'canvas:rgba',renderedWidth:r.width,renderedHeight:r.height,controlBand:r.top-t.top,fitsTile:r.width>0&&r.height>0&&Math.abs(r.width-t.width)<=1&&Math.abs(r.height-r.width*height/width)<=1&&r.left>=t.left-1&&r.right<=t.right+1&&r.top>=t.top-1&&r.bottom<=t.bottom+1};})"%S['faceImage'])
def assert_face_frames():
 images=faces()
 assert images and all(i['fitsTile'] for i in images),'Source frame must retain its aspect, full width and 1px containment: '+str(images)
 evidence=[]
 for index in range(len(images)):
  for right,bottom in [(False,False),(True,False),(False,True),(True,True)]:
   corner=q("""(()=>{
    const i=[...document.querySelectorAll(%s)][%d];
    let r=i.getBoundingClientRect();
    const initialY=r.top+(%s?r.height-.5:.5);
    window.scrollBy({top:initialY-innerHeight/2,left:0,behavior:'instant'});
    r=i.getBoundingClientRect();
    const x=r.left+(%s?r.width-.5:.5),y=r.top+(%s?r.height-.5:.5);
    const hit=document.elementFromPoint(x,y),clipped=[];
    for(let a=i.parentElement;a;a=a.parentElement){
     const c=getComputedStyle(a),b=a.getBoundingClientRect(),root=a===document.scrollingElement;
     const clipX=/(hidden|clip)/.test(c.overflowX)||(!root&&/(scroll|auto)/.test(c.overflowX));
     const clipY=/(hidden|clip)/.test(c.overflowY)||(!root&&/(scroll|auto)/.test(c.overflowY));
     const left=b.left+a.clientLeft,top=b.top+a.clientTop;
     if((clipX&&(r.left<left-1||r.right>left+a.clientWidth+1))||
        (clipY&&(r.top<top-1||r.bottom>top+a.clientHeight+1)))clipped.push(a.className||a.tagName);
    }
    const remove=i.closest('.next-face').querySelector('.next-face-close')?.getBoundingClientRect();
    const removeOverlaps=!!remove&&Math.min(remove.right,r.right)>Math.max(remove.left,r.left)&&Math.min(remove.bottom,r.bottom)>Math.max(remove.top,r.top);
    return {face:i.closest('.next-face').dataset.nextFace,right:%s,bottom:%s,x,y,hit:hit===i,clipped,removeOverlaps};
   })()"""%(json.dumps(S['faceImage']),index,json.dumps(bottom),json.dumps(right),json.dumps(bottom),json.dumps(right),json.dumps(bottom)))
   assert corner['hit'],'Source frame corner is obscured or unreachable by normal scrolling: '+str(corner)
   assert not corner['clipped'],'Full source frame exceeds a clipping ancestor: '+str(corner)
   assert not corner['removeOverlaps'],'Remove overlaps source pixels: '+str(corner)
   evidence.append(corner)
 return evidence
def select_mode(value):
 if not js("!!document.querySelector('select[aria-label=\"Processing mode\"]')"):click('More options')
 js("document.querySelector('.next-advanced')&&(document.querySelector('.next-advanced').open=true)")
 js("(()=>{const s=document.querySelector('%s');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'%s');s.dispatchEvent(new Event('change',{bubbles:true}));})()"%(S['processingMode'],value))
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if js("document.querySelector('%s').value"%S['processingMode'])==value:return
  time.sleep(.5)
 raise AssertionError('Processing mode did not become '+value)
def set_face_text_input(index,value):
 # Operate the source field, never the editable Image filename below the result. Native CDP
 # input goes through React's real change handler and must invalidate the old face.
 before=q("(()=>{const i=[...document.querySelectorAll(%s)].at(%d);if(!i)return null;const c=i.closest('.next-face');return {id:c.dataset.nextFace,value:i.value,disabled:i.disabled,hadResult:!!c.querySelector('.next-face-image img:not([data-public-preview]),canvas[data-face-drawn=\"true\"]'),filenames:[...document.querySelectorAll('.next-result-filename input:not(:disabled)')].filter(f=>!c.contains(f)).map(f=>({id:f.closest('.next-face')?.dataset.nextFace,value:f.value}))};})()"%(json.dumps(S['faceTextInputs']),index))
 assert before and not before['disabled'],'Editable face source is required'
 assert before['value']!=value,'Source edit must change the request identity'
 selector='.next-face[data-next-face='+json.dumps(before['id'])+'] .next-field input'
 js("window.__ciSourceEdits=[];window.__ciSourceListener=e=>window.__ciSourceEdits.push({source:!!e.target.closest('.next-field'),filename:!!e.target.closest('.next-result-filename')});document.addEventListener('input',window.__ciSourceListener,true)")
 try:
  press_selector(selector)
  cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=2)
  cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=2)
  cdp('Input.insertText',text=value)
  wait(lambda:js("document.querySelector(%s)?.value===%s"%(json.dumps(selector),json.dumps(value))),10)
 finally:js("document.removeEventListener('input',window.__ciSourceListener,true)")
 edits=q('window.__ciSourceEdits')
 assert edits and all(e['source'] and not e['filename'] for e in edits),'Input went to an export filename instead of the face source: '+str(edits)
 card='.next-face[data-next-face='+json.dumps(before['id'])+']'
 wait(lambda:not js("!!document.querySelector(%s)?.querySelector('.next-face-image img:not([data-public-preview]),canvas[data-face-drawn=\"true\"]')"%json.dumps(card)),10)
 for filename in before['filenames']:
  assert js("document.querySelector(%s)?.querySelector('.next-result-filename input')?.value"%json.dumps('.next-face[data-next-face='+json.dumps(filename['id'])+']'))==filename['value'],'Source edit changed another face export filename'
 labels=q("[...document.querySelectorAll(%s)].filter(b=>!b.disabled&&b.textContent.trim()==='Generate').map(b=>b.getAttribute('aria-label'))"%json.dumps(card+' .next-face-generate:not(.next-file-preparation)'))
 assert len(labels)==1,'Invalidated source must expose exactly one Generate: '+str(labels)
 CTX.setdefault('sourceEdits',[]).append({'face':before['id'],'pointerKeyboard':True,'resultInvalidated':before['hadResult'],'sourceInputEvents':len(edits),'filenameInputEvents':sum(e['filename'] for e in edits)})
 return labels[0]
def set_last_text_input(value=None):
 index=q("[...document.querySelectorAll(%s)].map((i,index)=>({index,editable:!i.disabled&&i.type==='text'&&i.inputMode!=='numeric'})).filter(i=>i.editable).at(-1)?.index??null"%json.dumps(S['faceTextInputs']))
 assert index is not None,'An editable words source is required'
 return set_face_text_input(index,value or 'rejection-check '+str(time.time_ns()))
def repeat_text_face(index):
 original=q("[...document.querySelectorAll(%s)].at(%d).value"%(json.dumps(S['faceTextInputs']),index))
 set_face_text_input(index,original+' repeat-check')
 label=set_face_text_input(index,original)
 run(label,predicate=lambda:len(faces())==2)
def download(name):
 # Prepared-file controls intentionally disable Save while the selected bytes are being
 # prepared. Readiness, a real pointer click and the downloaded bytes share the original 60s.
 deadline=time.monotonic()+60
 folder=downloads/str(time.time_ns());folder.mkdir();cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(folder))
 selector='.next-face-actions button' if name==S['buttons']['saveImage'] else '.next-video-slot .next-actions button' if name==S['buttons']['saveVideo'] else 'button'
 def state():
  return q("(()=>{const b=[...document.querySelectorAll(%s)].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===%s);return {present:!!b,disabled:b?b.disabled:null};})()"%(json.dumps(selector),json.dumps(name)))
 initial=state()
 def ready():
  value=state()
  return value if value['present'] and not value['disabled'] else None
 try:
  prepared=wait(ready,max(0,deadline-time.monotonic()))
  press_selector(selector,name=name,seconds=min(30,max(0,deadline-time.monotonic())))
  file=wait(lambda:next((p for p in folder.iterdir() if p.suffix!='.crdownload' and p.stat().st_size>0),None),max(0,deadline-time.monotonic()))
  result.setdefault('downloads',[]).append({'action':name,'initial':initial,'ready':prepared,'pointer':True,'bytes':file.stat().st_size})
  return file
 except Exception:
  result['downloadFailure']={'action':name,'initial':initial,'last':state(),'files':len(list(folder.iterdir()))}
  raise
def press_selector(selector,index=0,name=None,allow_error=False,seconds=30):
 # Operate the actual rendered source/crop controls with a verified pointer hit.
 def point():
  return js("""(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(!%s||e.textContent.trim().toLowerCase()===%s);});
   const e=es[%d];if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
   // A person presses a control once it has stopped moving: a menu still growing in (MUI's enter transition) moves
   // its items between this sample and the press, and a press on its backdrop closes it instead (run 40336921863).
   const box=[r.left,r.top,r.width,r.height].map(v=>Math.round(v)).join(','),settled=window.__pressBox===box;window.__pressBox=box;
   const x=r.left+r.width/2,y=r.top+r.height/2;return settled&&r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()"""%(json.dumps(selector),json.dumps(name),json.dumps(name.lower() if name else None),index))
 js('window.__pressBox=null')
 p=wait(point,seconds,allow_error=allow_error);click_at_xy(p['x'],p['y'])
def upload(selector,path):
 root=cdp('DOM.getDocument')['root']['nodeId'];node=cdp('DOM.querySelector',nodeId=root,selector=selector)['nodeId'];assert node,'File input missing';cdp('DOM.setFileInputFiles',nodeId=node,files=[str(path.resolve())])
def save_check(name,data):result['checks'][name]=data;(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'check':name,**data}),flush=True)

# --- Stages ------------------------------------------------------------------------------
def stage_preflight():
 global network
 # Seconds-fast tripwire for the failure class that actually burned us: UI drift. No
 # synthesis, no downloads - only presence of the controls the later stages depend on, plus
 # the provenance assertions (isolation headers, exact artifact origin, engine identity).
 cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(downloads))
 new_tab('about:blank')
 # Install on the journey tab before navigation, including every subsequent reload.
 cdp('Page.enable')
 load_session=cdp('Target.attachToTarget',targetId=current_tab()['targetId'],flatten=True)['sessionId']
 cdp('Page.enable',session_id=load_session)
 document_loaded=False
 def navigation_events():
  nonlocal document_loaded
  events=drain_events()
  if any(e.get('method')=='Page.loadEventFired' and e.get('session_id')==load_session for e in events):document_loaded=True
  return events
 cdp('Page.addScriptToEvaluateOnNewDocument',source="window.__ciWorkers=0;window.__ciWorkerRequests=0;window.__ciWorkerKinds=[];const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);window.__ciWorkers++;}postMessage(...args){window.__ciWorkerRequests++;window.__ciWorkerKinds.push({type:args[0]?.type||null,keys:Object.keys(args[0]||{})});return super.postMessage(...args);}};")
 if os.environ.get('INTERCEPT_DIR'):
  import sys
  sys.path.insert(0,os.environ['INTERCEPT_DIR'])
  import intercept
  from browser_harness.helpers import _send
  network=intercept.attach_cdp(cdp,navigation_events,json.loads(os.environ['NETWORK_HOST_MAP']),page_session=_send({'meta':'session'}).get('session_id'),page_target=current_tab()['targetId'])
  intercept.step(network.rec,'journey')
 # Navigation and renderer evaluations can exceed the harness's 5s IPC deadline.
 # Observe the actual load event first, folding every drained network event into
 # the unchanged privacy record without querying the navigating renderer.
 if network is not None:network.collect()
 else:navigation_events()
 document_loaded=False
 js("setTimeout(()=>{location.href='https://next.facemorph.me/';},0);0")
 deadline=time.monotonic()+15
 while not document_loaded:
  if network is not None:network.collect()
  else:navigation_events()
  if time.monotonic()>=deadline:raise TimeoutError('The journey document did not finish loading')
  time.sleep(.25)
 wait(lambda:js("location.href==='https://next.facemorph.me/'&&document.readyState==='complete'"),15)
 wait(idle,60);assert js('crossOriginIsolated'), 'Production isolation headers missing'
 # The trial-phase reporting question appears on every fresh profile. "Ask me later" closes it
 # without answering, so the harness neither consents nor declines on anyone's behalf, and the
 # toast cannot sit over a control a later coordinate click aims at.
 js("if(!window.__ciGate){window.__ciGate=0;setInterval(()=>{const b=document.querySelector('.next-download-dialog .next-download-accept');if(b){window.__ciGate++;b.click();}},250);}")
 result['consentToastShown']=bool(js('(()=>{const b=document.querySelector(\'.next-consent-toast button[aria-label="Ask me later"]\');if(b)b.click();return !!b;})()'))
 result['agent']=q('navigator.userAgent');result['engine']=q("(/Firefox|FxiOS/.test(navigator.userAgent)?'gecko':/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent)?'blink':/Safari/.test(navigator.userAgent)?'webkit':'other')")
 js("window.__ciOrigin=null;fetch('/').then(r=>window.__ciOrigin=r.headers.get('X-Next-Artifact-Source')).catch(e=>window.__ciOrigin='error')")
 wait(lambda:js('window.__ciOrigin!==null'),60);assert js('window.__ciOrigin')==Path('next-site-source.txt').read_text().strip(), 'Chrome did not reach exact local artifact origin'
 js("window.__ciLogs=[];['log','warn','error','info'].forEach(k=>{const o=console[k].bind(console);console[k]=(...a)=>{try{window.__ciLogs.push(k+': '+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,300));if(window.__ciLogs.length>40)window.__ciLogs.shift();}catch(e){}};});")
 js("window.__ciBusyChanges=0;window.__ciBusyObserver=new MutationObserver(()=>{window.__ciBusyChanges++;});window.__ciBusyObserver.observe(document.querySelector('.next-status'),{subtree:true,attributes:true,childList:true,characterData:true});window.__ciBusyChanges++;")
 click('More options')
 js("document.querySelector('.next-advanced')&&(document.querySelector('.next-advanced').open=true)")
 state=q("({tiles:document.querySelectorAll('.next-face').length,photos:document.querySelectorAll('%s').length,words:!!document.querySelector('%s'),generate:[...document.querySelectorAll('button')].some(b=>b.classList.contains('next-face-generate')&&b.textContent==='Generate'),modeOptions:[...document.querySelectorAll('%s option')].map(o=>o.value),error:(document.querySelector('%s')?.innerText||'')})"%(S['choosePhoto'],S['faceTextInputs'],S['processingMode'],S['error']))
 assert state['tiles']==2 and state['words'] and state['generate'],state
 assert state['photos']==2,state
 # The new app's card menu offers Encode image, which invokes that card's own file input, and a
 # fresh photo then waits for crop confirmation; the retained control encodes on selection.
 press_selector('.next-face [aria-label="Change mode"]',0)
 CTX['confirmCrop']='Encode image' in q("[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())")
 if CTX['confirmCrop']:
  for index in range(2):
   if index:press_selector('.next-face [aria-label="Change mode"]',index)
   # Record which file input the entry invokes; the native chooser itself is not opened here.
   js("(()=>{window.__fileChooser=[];window.__inputClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type!=='file')return window.__inputClick.call(this);window.__fileChooser.push({face:this.closest('[data-next-face]')?.getAttribute('data-next-face'),accept:this.accept});};})()")
   press_selector('[role="menuitem"]',name='Encode image')
   wait(lambda:js("window.__fileChooser.length===1"),30)
   face=js("document.querySelectorAll('.next-face')[%d].getAttribute('data-next-face')"%index)
   assert q("window.__fileChooser[0]")=={'face':face,'accept':'image/*,video/mp4'},q("window.__fileChooser")
   assert not js("!!document.querySelector('[role=dialog]')"),'Encode image must open the card chooser, not a dialog'
   js("HTMLInputElement.prototype.click=window.__inputClick")
  S['buttons']['useCrop']='Use Crop'
 else:cdp('Input.dispatchKeyEvent',type='keyDown',key='Escape',windowsVirtualKeyCode=27);cdp('Input.dispatchKeyEvent',type='keyUp',key='Escape',windowsVirtualKeyCode=27)
 assert set(state['modeOptions'])=={'auto','cpu','webgpu'},state
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
 spot=q("(()=>{const e=document.querySelector('.next-explain h2')||document.querySelector('h1');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+4,y:r.top+r.height/2};})()")
 click_at_xy(spot['x'],spot['y']);time.sleep(.5)
 mode=js("document.querySelector('%s').value"%S['processingMode'])
 selection='keyboard' if mode=='cpu' else 'scripted'
 if mode!='cpu':select_mode('cpu')
 result['processingSelection']=selection
 # Keep the arbitrary-name mapping path and independently qualify the published
 # public-name W+ pathway. Record message kinds only, never inputs or latents.
 labels=generate_labels()
 run(labels[0])
 js("window.__ciNameMessages=[];const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...a){if(m&&['generate','synthesize'].includes(m.type))window.__ciNameMessages.push(m.type);return post.call(this,m,...a);};")
 label=set_last_text_input('charlotte')
 run(label);images=wait(lambda:faces() if len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()) else None,60)
 frame_geometry=assert_face_frames()
 messages=q('window.__ciNameMessages')
 assert 'synthesize' in messages and 'generate' not in messages, 'Published name silently fell back to mapping: '+str(messages)
 save_check('nameSeed',{'passed':True,'dimensions':[[i['width'],i['height']] for i in images],'processingSelection':selection,'publishedLatentSynthesis':True,'frameGeometry':frame_geometry})
 first=download(S['buttons']['saveImage'])
 assert first.suffix=='.webp' and first.read_bytes()[8:12]==b'WEBP', 'Chrome deferred download did not use the supported WebP encoder'
 CTX['seedDownload']=first
 CTX['seedSha']=hashlib.sha256(first.read_bytes()).hexdigest()
 # The photo-face upload needs its own cache identity: same pixels as the seed PNG (decoders
 # ignore bytes after IEND) but different bytes, so the e4e encode really runs instead of
 # replaying a cached entry on the warm profiles this harness accumulates.
 uniq=first.with_name(first.stem+'-e4e'+first.suffix)
 data=first.read_bytes()
 if data[:4]==b'RIFF' and data[8:12]==b'WEBP':
  clean=bytearray(data[:12]);at=12
  while at+8<=len(data):
   size=int.from_bytes(data[at+4:at+8],'little');end=at+8+size+(size&1)
   if data[at:at+4]!=b'FMRP':clean.extend(data[at:end])
   at=end
  nonce=str(time.time_ns()).encode();clean.extend(b'CIUN'+len(nonce).to_bytes(4,'little')+nonce+(b'\0' if len(nonce)&1 else b''));clean[4:8]=(len(clean)-8).to_bytes(4,'little')
 else:
  clean=bytearray(data[:8]);at=8
  while at+12<=len(data):
   size=int.from_bytes(data[at:at+4],'big');end=at+12+size
   if not(data[at+4:at+8]==b'tEXt' and data[at+8:at+8+9]==b'FaceMorph'):
    clean.extend(data[at:end])
   at=end
 assert b'FaceMorph\0' not in clean and b'facemorph-image-v2' not in clean, 'e4e fixture still contains recovery metadata'
 uniq.write_bytes(clean)
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
 label=set_last_text_input()
 assert CTX['sourceEdits'][-1]['resultInvalidated'],'Route refusal must invalidate an existing result'
 select_mode('webgpu')
 before=js('window.__ciBusyChanges');click(label)
 # The refusal can land before the busy flag ever registers (a warm cache makes admission
 # near-instant, so the session's device check fails inside the first poll window), so accept
 # either the busy transition or the expected error itself; wait() would treat the error as
 # fatal even though failing is exactly what this stage forces.
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  if js('window.__ciBusyChanges')>before or text(S['error']):break
  time.sleep(.5)
 else:raise TimeoutError('forced route neither started nor failed')
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
  named=caption.lower()
  if 'webgpu' in named and 'cpu' in named and 'failed' in named:break
  time.sleep(.5)
 else:raise AssertionError('route caption never named the refused and current routes: '+caption)
 save_check('routeRejectionNamed',{'passed':True,'caption':caption,'error':text(S['error']),'sourceEdit':CTX['sourceEdits'][-1]})
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
 repeat_text_face(0);second=download(S['buttons']['saveImage']);assert hashlib.sha256(second.read_bytes()).hexdigest()==CTX['seedSha'];assert js('window.__ciWorkers')==workers,'Repeat created an inference worker';assert js('window.__ciWorkerRequests')==requests,'Repeat invoked the inference worker'
 save_check('repeatOriginal',{'passed':True,'sha256':CTX['seedSha'],'newWorkers':0,'newWorkerRequests':0})
 CTX['workerBaseline']=workers
def stage_recoveredDownload():
 workers=js('window.__ciWorkers');requests=js('window.__ciWorkerRequests')
 upload(S['choosePhoto'],CTX['seedDownload'])
 wait(lambda:js("document.querySelector('%s').value==='project'"%S['faceSource']) and len(faces())==2 and idle(),60)
 assert js('window.__ciWorkers')==workers,'Recovery created a processing worker'
 assert js('window.__ciWorkerRequests')==requests,'Recovery invoked a processing worker'
 save_check('recoveredDownload',{'passed':True,'format':'webp','newWorkers':0,'newWorkerRequests':0,'dimensions':[[i['width'],i['height']] for i in faces()]})
def stage_syntheticPhotoE4e():
 kinds=js('window.__ciWorkerKinds.length')
 upload(S['choosePhoto'],CTX['seedPng'])
 if CTX.get('confirmCrop'):
  wait(lambda:js("!!document.querySelector('.next-encode-preview img')"),60)
  press_selector('.next-encode-dialog button',name='OK')
  wait(lambda:js("!!document.querySelector('.next-face[data-next-state=\"photo\"]')"),60)
 else:wait(lambda:js("document.querySelector('%s').value==='photo'"%S['faceSource']),60)
 # The retained control encodes on selection; the new app encodes after explicit
 # crop OK. Neither needs an extra Generate press. Wait for the completed e4e
 # result, then confirm a repeated full pass still leaves both faces whole.
 wait(lambda:len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()) and idle(),240)
 # The e4e itself, not a new worker: a confirmed crop runs no detector worker (fm-6ib8), and a device with memory
 # to spare keeps the compute worker, so the proof is an 'encode-aligned' request posted after the upload.
 assert js("window.__ciWorkerKinds.slice(%d).some(k=>k.type==='encode-aligned')"%kinds),'the photo was not sent to e4e'
 repeat_text_face(1)
 wait(lambda:len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()),60)
 save_check('syntheticPhotoE4e',{'passed':True,'newWorkers':js('window.__ciWorkers')-CTX['workerBaseline'],'e4eRequests':js("window.__ciWorkerKinds.slice(%d).filter(k=>k.type==='encode-aligned').length"%kinds),'widths':[i['width'] for i in faces()]})
def stage_localCrop():
 # Exercise the editor before confirmation in the new app, or the retained
 # control's crop menu. The accepted geometry must produce the encoded face.
 if CTX.get('confirmCrop'):
  upload(S['choosePhoto'],CTX['seedPng'])
  wait(lambda:js("!!document.querySelector('.next-encode-preview img')"),60)
  press_selector('.next-encode-dialog button',name='ADJUST CROP')
 else:
  js("document.querySelector('.next-face[data-next-state=\"photo\"] [aria-label=\"Change mode\"]').click()")
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
 wait(lambda:js("!document.querySelector('%s')"%S['cropView']),60)
 if CTX.get('confirmCrop'):
  wait(lambda:js("!!document.querySelector('.next-encode-preview img')"),30)
  press_selector('.next-encode-dialog button',name='OK')
 deadline=time.monotonic()+300
 while time.monotonic()<deadline:
  # Local crop preparation keeps the UI responsive and does not own the heavy-job busy
  # flag. Wait for publication of the cropped input as well as the eager encode settling.
  if text(S['fileName'])=='cropped.png' and idle():break
  time.sleep(1)
 else:
  raise RuntimeError('crop accept never settled: status=%r error=%r workers=%r logs=%s'%(text(S['status']),text(S['error']),js('window.__ciWorkers'),logs_tail()))
 cropped=text(S['fileName'])
 assert cropped=='cropped.png',cropped
 repeat_text_face(1)
 wait(lambda:len(faces())==2 and all(i['width']==1024 and i['height']==1024 for i in faces()),60)
 save_check('localCrop',{'passed':True,'file':cropped})
def project_files_shipped():
 # The retained app keeps project export and open behind `projectFilesVisible`, off since
 # 21 September (operator). The harness asks the artifact in front of it rather than assuming,
 # so the day the flag comes back the stage qualifies it again with no edit here.
 return bool(js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===%s);return !!b&&!!document.querySelector('%s');})()"%(json.dumps(S['buttons']['exportProject']),S['openProject'])))
def stage_projectSaveReopen():
 if not project_files_shipped():
  # Neither a pass nor a silent skip. A control that is not on the surface cannot be qualified
  # through the surface, and recording passed:true for it would be exactly the false
  # confirmation this gate exists to prevent. The serialisation itself stays covered:
  # apps/web/test/project/project-json.test.ts round-trips every path kind and latent space against vectors from classic's Fable build
  # (recorded vectors), in the artifact job. promote.py reads shipped:false and stops demanding UI evidence
  # for a feature this artifact does not offer.
  save_check('projectSaveReopen',{'passed':None,'shipped':False,'reason':'Project export and open are not enabled at the moment — we are not sure what we need them for yet (operator, 22 September). projectFilesVisible=false; the ProjectJson round trip stays covered by apps/web/test/project/project-json.test.ts'})
  return
 project=download(S['buttons']['exportProject']);parsed=json.loads(project.read_text());assert len(parsed['morph']['controls'])==2 and all(len(c['latent']['values'])==9216 for c in parsed['morph']['controls'])
 upload(S['openProject'],project);time.sleep(.5);wait(idle)
 CTX['project']=project
 assert js("[...document.querySelectorAll('%s')].every(s=>s.value==='project')"%S['faceSource'])
 save_check('projectSaveReopen',{'passed':True,'shipped':True,'sha256':hashlib.sha256(project.read_bytes()).hexdigest()})
def stage_morphVideo():
 # The morph used to be made from a reloaded, reopened project, which proved the restore and
 # supplied the faces in one move. With project files off the surface there is nothing to
 # reopen, so the morph is made from the faces the earlier stages actually built — the reload
 # is dropped rather than faked, since reloading with no project to restore would only ever
 # test the empty start.
 if CTX.get('project'):
  js('location.reload()');wait_for_load();wait(idle,60)
  upload(S['openProject'],CTX['project']);time.sleep(.5);wait(idle)
  # The reopen is asynchronous: the morph button exists the moment the app renders (disabled
  # until both faces return), so wait for the restored inputs themselves.
  wait(lambda:js("[...document.querySelectorAll('%s')].length===2 && [...document.querySelectorAll('%s')].every(s=>s.value==='project')"%(S['faceSource'],S['faceSource'])),60)
 else:
  wait(lambda:len(faces())==2,60)
 # Reopening a photo-mode project kicks its own re-encode; the morph button is disabled until
 # that settles. Click only when the button can actually receive it.
 wait(lambda:js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Create morph');return b&&!b.disabled;})()"),300)
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

def stage_sessionRestore():
 # Wait for the best-effort retained session to commit before navigating away.
 js("window.__ciSavedSession=null;(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('checkface-originals-v1',1);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});try{const value=await new Promise((r,j)=>{const q=db.transaction('originals').objectStore('originals').get('last-generated-session-v2');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});window.__ciSavedSession={faces:value?.faces?.length||0,video:!!value?.video,compressed:value?.faces?.every(f=>f.result.blob.type==='image/webp')};}finally{db.close();}})();0")
 deadline=time.monotonic()+60
 while not js('window.__ciSavedSession?.video'):
  if time.monotonic()>=deadline:
   result['retentionProbe']=q('window.__ciSavedSession');js('window.__ciStorage=null;navigator.storage.estimate().then(v=>window.__ciStorage=v);0');time.sleep(.5);result['storageProbe']=q('window.__ciStorage');raise AssertionError('Complete session/video was not persisted')
  time.sleep(.5)
  js("(async()=>{const q=indexedDB.open('checkface-originals-v1',1);q.onsuccess=()=>{const db=q.result,r=db.transaction('originals').objectStore('originals').get('last-generated-session-v2');r.onsuccess=()=>{const v=r.result;window.__ciSavedSession={faces:v?.faces?.length||0,video:!!v?.video,compressed:v?.faces?.every(f=>f.result.blob.type==='image/webp')};db.close();};};})();0")
 saved=q('window.__ciSavedSession');assert saved['faces']==2 and saved['compressed'], saved
 js("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Use Slider')).querySelector('input').click()")
 wait(lambda:js("!!document.querySelector('.next-slider-control')"),60)
 js("document.querySelector('.next-slider-control input[type=range]').focus()")
 cdp('Input.dispatchKeyEvent',type='keyDown',key='ArrowRight',code='ArrowRight',windowsVirtualKeyCode=39)
 cdp('Input.dispatchKeyEvent',type='keyUp',key='ArrowRight',code='ArrowRight',windowsVirtualKeyCode=39)
 preference=q("JSON.parse(localStorage.getItem('facemorph-slider-v1'))")
 assert preference['enabled'] and preference['frame']>1,preference
 js('location.reload()');wait_for_load();ensure_instrumented()
 wait(lambda:len(faces())==2 and all(i['fitsTile'] for i in faces()),60)
 wait(lambda:js("!!document.querySelector('.next-slider-control')"),60)
 assert q("JSON.parse(localStorage.getItem('facemorph-slider-v1'))")==preference
 # A restored photo face keeps 'Restored face' (project); a typed face gets its words back in this tab (fm-5hww),
 # shown filled with its exact words and nothing regenerated (the worker check below).
 restored=q("[...document.querySelectorAll('.next-face')].map(s=>[s.dataset.nextState,s.querySelector('input[type=text]')?.value??''])")
 assert len(restored)==2 and all(st=='project' or (st=='filled' and value) for st,value in restored), restored
 project=[i for i,(st,_) in enumerate(restored) if st=='project']
 assert isinstance(js('window.__ciWorkerRequests'),int), 'Restore worker instrumentation missing'
 assert js('window.__ciWorkerRequests')==0, 'Restore worker requests: '+str(q('window.__ciWorkerKinds'))
 js("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Use Slider')).querySelector('input').click()")
 wait(lambda:js("document.querySelector('.next-video-slot video')?.readyState>=2"),30)
 if project:
  # Leaving 'Restored face' for Name or words starts from an empty field, and an empty field cannot Generate.
  k=project[-1]
  js("document.querySelectorAll('button[aria-label=\"Change mode\"]')[%d].click()"%k)
  js("[...document.querySelectorAll('[role=menuitem]')].find(e=>getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0&&e.textContent.trim()==='Name or words').click()")
  wait(lambda:js("document.querySelectorAll('.next-face')[%d].querySelector('input[type=text]')?.value===''"%k),10)
  assert js("document.querySelectorAll('.next-face')[%d].querySelector('.next-face-generate').disabled"%k), 'Empty restored-mode edit must disable Generate'
 save_check('completeSessionRestore',{'passed':True,'faces':2,'restored':[st for st,_ in restored],'compressed':True,'video':True,'sliderFrame':preference['frame'],'newWorkerRequests':0})

# --- Driver ------------------------------------------------------------------------------
STAGES=[('preflight',stage_preflight),('seedGeneration',stage_seedGeneration),('routeRejection',stage_routeRejection),
        ('repeatOriginal',stage_repeatOriginal),('recoveredDownload',stage_recoveredDownload),('syntheticPhotoE4e',stage_syntheticPhotoE4e),('localCrop',stage_localCrop),
        ('projectSaveReopen',stage_projectSaveReopen),('morphVideo',stage_morphVideo),('sessionRestore',stage_sessionRestore)]
SKIP=set(filter(None,os.environ.get('E2E_SKIP','').split(',')))
try:
 for name,fn in STAGES:
  if name in SKIP:result.setdefault('skipped',[]).append(name);continue
  result['stage']=name
  try:
   if name!='preflight':
    alive();ensure_instrumented()
   fn()
  except Exception as error:
   result['stageError']=name+': '+str(error)+' logs='+logs_tail()
   raise
  if UNTIL==name:
   result['partial']=True
   print(json.dumps({'partialUntil':name}),flush=True);break
 else:result['passed']=not result.get('skipped')
except Exception as error:
 result['error']=str(error)
 raise
finally:
 if network is not None:
  network.settled()
  (out/'network.json').write_text(json.dumps(network.rec,indent=1))
 try:result['downloadGateAccepted']=js('window.__ciGate||0')
 except Exception:pass
 result['finishedAt']=time.time();(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

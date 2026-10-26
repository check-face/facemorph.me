#!/usr/bin/env bash
set -euo pipefail
# The processing-mode probe and its expected routes live beside the app (fm-x6h5), wherever this runs from.
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NEXT_PROVIDER_PROBE="${NEXT_PROVIDER_PROBE:-$WEB/build/provider-probe.js}"
export NEXT_PROVIDER_ROUTES="${NEXT_PROVIDER_ROUTES:-$WEB/build/provider-routes.json}"
browser-harness <<'PY'
import json,time,os
from pathlib import Path
def click(role,name):
    deadline=time.monotonic()+10
    # A menu grows in: click only once the target's box holds still between two polls, or the press lands
    # where the item was a frame ago (seen on a loaded runner: Change mode opened, Encode image never chose).
    last_box=None
    while time.monotonic()<deadline:
        nodes=cdp('Accessibility.getFullAXTree')['nodes']
        matching=[n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value','').lower()==name.lower()]
        if not matching and name=='Remove':
            matching=[n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value','').lower().startswith('remove')]
        if matching:
            ident=matching[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
            q=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
            box=(ident,tuple(round(v,1) for v in q))
            if box!=last_box: last_box=box;time.sleep(.1);continue
            hit=js("(()=>{const e=document.elementFromPoint(%f,%f)?.closest('button,[role=menuitem]');const name=e?.getAttribute('aria-label')||e?.textContent||'';return name.trim().toLowerCase()===%s;})()"%(x,y,json.dumps(name.lower())))
            if hit:click_at_xy(x,y);return
        time.sleep(.1)
    raise AssertionError('No visible pointer hit for '+role+' '+name)

DESTINATION=os.environ.get('NEXT_ARTIFACT_KIND')=='destination'
# Destination photo entry lives in each face card: its mode menu's Encode image
# invokes that card's own file input. Count the entry controls and operate one.
PHOTO_SELECTOR='.next-face button[aria-label="Change mode"]' if DESTINATION else 'button[aria-label="Choose photo"]'
PHOTO_OFFSET=0 if DESTINATION else 1
def state():
    return json.loads(js("JSON.stringify({tiles:document.querySelectorAll('.next-face').length,photoControls:document.querySelectorAll(%s).length,helloPreview:(()=>{const i=document.querySelector('[data-next-face=\"face-1\"] img[data-public-preview=\"true\"]');return !!i&&i.complete&&i.naturalWidth===1024&&i.naturalHeight===1024;})(),generate:document.querySelectorAll('.next-face-generate').length===2,pattern:document.querySelector('select[aria-label=\"Morph shape\"]')?.value,errors:document.querySelector('.next-error')?.innerText||''})" % json.dumps(PHOTO_SELECTOR)))
def until(predicate, timeout=15, what='the UI condition'):
    deadline=time.monotonic()+timeout
    last=None
    while time.monotonic()<deadline:
        last=state()
        if predicate(last): return last
        time.sleep(.1)
    # Name the awaited condition and what was open, not only the general snapshot.
    shown=js("JSON.stringify([...document.querySelectorAll('[role=dialog],[role=menu],dialog[open]')].map(e=>e.className||e.tagName))")
    raise AssertionError(f'timed out after {timeout}s waiting for {what}: state={last} open={shown}')
CANVAS_PROBE = """(()=>{
 const tile=document.querySelector('.next-face-image'),children=[...tile.childNodes];
 const canvas=document.createElement('canvas'),scroll={x:scrollX,y:scrollY};
 canvas.width=canvas.height=1024;canvas.className='next-face-img';
 try{
  // Keep Remove in place: the probe must detect a control covering source pixels.
  tile.replaceChildren(canvas,...children.filter(e=>e.nodeType===1&&e.matches('.next-face-close')));
  canvas.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const r=canvas.getBoundingClientRect(),t=tile.getBoundingClientRect(),clipped=[];
  for(let a=canvas.parentElement;a;a=a.parentElement){
   const c=getComputedStyle(a),b=a.getBoundingClientRect(),root=a===document.scrollingElement;
   const clipX=/(hidden|clip)/.test(c.overflowX)||(!root&&/(scroll|auto)/.test(c.overflowX));
   const clipY=/(hidden|clip)/.test(c.overflowY)||(!root&&/(scroll|auto)/.test(c.overflowY));
   const left=b.left+a.clientLeft,top=b.top+a.clientTop;
   if((clipX&&(r.left<left-1||r.right>left+a.clientWidth+1))||
      (clipY&&(r.top<top-1||r.bottom>top+a.clientHeight+1)))clipped.push(a.className||a.tagName);
  }
  const corners=[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,y])=>{
   const px=x<0?r.left+.5:r.right-.5,py=y<0?r.top+.5:r.bottom-.5;
   window.scrollBy({top:py-innerHeight/2,behavior:'instant'});
   const b=canvas.getBoundingClientRect();
   return document.elementFromPoint(px,y<0?b.top+.5:b.bottom-.5)===canvas;
  });
  const remove=tile.querySelector('.next-face-close')?.getBoundingClientRect(),b=canvas.getBoundingClientRect();
  const removeOverlaps=!!remove&&Math.min(remove.right,b.right)>Math.max(remove.left,b.left)&&Math.min(remove.bottom,b.bottom)>Math.max(remove.top,b.top);
  return {width:r.width,height:r.height,tileWidth:t.width,tileHeight:t.height,controlBand:r.top-t.top,clipped,corners,removeOverlaps,
   fitsTile:r.width>0&&r.height>0&&Math.abs(r.width-t.width)<=1&&Math.abs(r.height-r.width)<=1&&
    r.left>=t.left-1&&r.right<=t.right+1&&r.top>=t.top-1&&r.bottom<=t.bottom+1&&
    clipped.length===0&&corners.every(Boolean)&&!removeOverlaps};
 }finally{tile.replaceChildren(...children);window.scrollTo(scroll.x,scroll.y);}
})()"""
result={'passed':False,'artifactKind':os.environ.get('NEXT_ARTIFACT_KIND','control'),'scope':'Exact compiled artifact startup and face controls only; no inference, photo generation or physical-device qualification'}
try:
    new_tab(os.environ.get('NEXT_ARTIFACT_ORIGIN','http://127.0.0.1:8080/'))
    wait_for_load()
    result['agent']=js('navigator.userAgent')
    # Close the trial-phase reporting toast without answering it; it would cover coordinate clicks.
    time.sleep(1)
    result['consentToastShown']=bool(js('(()=>{const b=document.querySelector(\'.next-consent-toast button[aria-label="Ask me later"]\');if(b)b.click();return !!b;})()'))
    initial=until(lambda s:s['tiles']==2 and s['photoControls']==2-PHOTO_OFFSET and s['helloPreview'] and s['generate'],what='the initial two tiles')
    if DESTINATION:
        # Record which file input the menu entry invokes; the native chooser itself is not opened here.
        js("(()=>{window.__fileChooser=[];const click=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type!=='file')return click.call(this);window.__fileChooser.push({face:this.closest('[data-next-face]')?.getAttribute('data-next-face'),accept:this.accept});};})()")
        click('button','Change mode')
        click('menuitem','Encode image')
        until(lambda s:js("window.__fileChooser.length===1"),what="the first card's file chooser after Encode image")
        chooser=js("JSON.stringify(window.__fileChooser[0])");chooser=json.loads(chooser) if isinstance(chooser,str) else chooser
        assert chooser=={'face':'face-1','accept':'image/*,video/mp4'}, chooser
        assert not js("!!document.querySelector('[role=dialog]')"), 'Encode image must open the card chooser, not a dialog'
        result['encodeEntry']={'chooser':chooser,'dialog':False}
    assert not js("document.querySelector('.next-tagline a, .next-tagline button')"), 'Tagline must not replace an implicitly selected face'
    click('button','More options')
    until(lambda s:js("!!document.querySelector('.next-overflow')"))
    initial['shapes']=js("[...document.querySelectorAll('select[aria-label=\"Morph shape\"] option')].map(x=>x.value)")
    assert len(initial['shapes'])==5, initial
    initial['pattern']=js("document.querySelector('select[aria-label=\"Morph shape\"]')?.value")
    initial['pinch']=js("document.querySelector('.next-overflow input[type=\"checkbox\"]')?.checked")
    initial['frames']=js("document.querySelector('select[aria-label=\"Morph length\"]')?.value")
    assert initial['frames']=='16', initial
    # The select is found by its accessible name wherever it lives (fm-x6h5); the expected routes follow the label.
    js(Path(os.environ.get('NEXT_PROVIDER_PROBE','build/provider-probe.js')).read_text())
    probe=js("JSON.stringify(__probeProvider())");probe=json.loads(probe) if isinstance(probe,str) else probe
    expected=json.loads(Path(os.environ.get('NEXT_PROVIDER_ROUTES','build/provider-routes.json')).read_text())[os.environ.get('NEXT_ARTIFACT_KIND','control')]
    initial['routes']=probe['routes'];result['providerLocation']=probe['providerLocation']
    assert probe['found']==1 and sorted(probe['routes'])==sorted(expected), (probe, expected)
    assert initial['pattern']=='full-smooth-figure8' and not initial['errors'], initial
    assert initial['pinch'] is True, initial
    result['initial']=initial
    click('button','Add face')
    result['afterAdd']=until(lambda s:s['tiles']==3 and s['photoControls']==3-PHOTO_OFFSET)
    assert js("[...document.querySelectorAll('.next-face-generate')].at(-1).disabled"), 'Empty face must retain a disabled Generate button'
    click('button','Remove Face 3')
    result['afterRemove']=until(lambda s:s['tiles']==2 and s['photoControls']==2-PHOTO_OFFSET)
    assert not result['afterRemove']['errors'], result['afterRemove']
    click('button','Browse names')
    deadline=time.monotonic()+10
    while not js("!!document.querySelector('.next-name-dialog')?.contains(document.activeElement)"):
        assert time.monotonic()<deadline, 'Names dialog did not receive focus'
        time.sleep(.1)
    cdp('Input.dispatchKeyEvent',type='keyDown',key='Escape',code='Escape',windowsVirtualKeyCode=27)
    cdp('Input.dispatchKeyEvent',type='keyUp',key='Escape',code='Escape',windowsVirtualKeyCode=27)
    deadline=time.monotonic()+10
    while js("!!document.querySelector('.next-name-dialog')"):
        assert time.monotonic()<deadline, 'Escape did not close names dialog'
        time.sleep(.1)
    result['namesDialogEscape']=True
    result['layouts']=[]
    for width in [320,360,390,1280]:
        cdp('Emulation.setDeviceMetricsOverride',width=width,height=900,deviceScaleFactor=1,mobile=width<500)
        time.sleep(.2)
        layout=json.loads(js("JSON.stringify({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>visualViewport.width+1,shapes:document.querySelectorAll('select[aria-label=\"Morph shape\"] option').length,buttons:[...document.querySelectorAll('.next-face-generate')].map(b=>({width:b.getBoundingClientRect().width,right:b.getBoundingClientRect().right}))})"))
        assert not layout['overflow'] and layout['scrollWidth']<=width+1 and layout['shapes']==5, layout
        assert all(b['width']>0 and b['right']<=width+1 for b in layout['buttons']), layout
        # Exercise the actual shipped canvas styling without paying for model admission.
        # Intrinsic 1024 dimensions are not evidence that its CSS surface fits the tile.
        layout['canvas']=js(CANVAS_PROBE)
        if isinstance(layout['canvas'],str): layout['canvas']=json.loads(layout['canvas'])
        assert layout['canvas']['fitsTile'], layout
        assert js("[...document.querySelectorAll('.next-adornment')].every(e=>Number(getComputedStyle(e).opacity)===1)"), 'Face selectors must remain visible at rest'
        result['layouts'].append(layout)
    cdp('Emulation.clearDeviceMetricsOverride')
    result['passed']=True
except Exception as error:
    result['error']=str(error)
    raise
finally:
    Path('next-artifact-ui.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
PY

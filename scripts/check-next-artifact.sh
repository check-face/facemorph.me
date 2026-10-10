#!/usr/bin/env bash
set -euo pipefail
browser-harness <<'PY'
import json,time,os
from pathlib import Path
def click(role,name):
    nodes=cdp('Accessibility.getFullAXTree')['nodes']
    # 'Remove' buttons carry the face name (Remove <face>) and FancyButton renders uppercase in
    # the AX tree, so fall back to a case-insensitive/prefix match before giving up.
    item=next((n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name),None)
    if item is None and name=='Remove':
        item=next(n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value','').lower().startswith('remove'))
    if item is None:
        item=next((n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value','').lower()==name.lower()),None)
    if item is None:raise StopIteration(name)
    ident=item['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=ident)
    q=cdp('DOM.getBoxModel',backendNodeId=ident)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)
def state():
    return json.loads(js("JSON.stringify({tiles:document.querySelectorAll('.next-face').length,photoButtons:document.querySelectorAll('button[aria-label=\"Choose photo\"]').length,helloPreview:(()=>{const i=document.querySelector('[data-next-face=\"face-1\"] img[data-public-preview=\"true\"]');return !!i&&i.complete&&i.naturalWidth===1024&&i.naturalHeight===1024;})(),generate:document.querySelectorAll('.next-face-generate').length===2,pattern:document.querySelector('input[name=\"morph-shape\"]:checked')?.value,errors:document.querySelector('.next-error')?.innerText||''})"))
def until(predicate, timeout=15):
    deadline=time.monotonic()+timeout
    last=None
    while time.monotonic()<deadline:
        last=state()
        if predicate(last): return last
        time.sleep(.1)
    raise AssertionError(f'UI condition timed out: {last}')
result={'passed':False,'scope':'Exact compiled artifact startup and face controls only; no inference, photo generation or physical-device qualification'}
try:
    new_tab(os.environ.get('NEXT_ARTIFACT_ORIGIN','http://127.0.0.1:8080/'))
    wait_for_load()
    result['agent']=js('navigator.userAgent')
    # Close the trial-phase reporting toast without answering it; it would cover coordinate clicks.
    time.sleep(1)
    result['consentToastShown']=bool(js('(()=>{const b=document.querySelector(\'.next-consent-toast button[aria-label="Ask me later"]\');if(b)b.click();return !!b;})()'))
    initial=until(lambda s:s['tiles']==2 and s['photoButtons']==1 and s['helloPreview'] and s['generate'])
    initial['shapes']=js("[...document.querySelectorAll('input[name=\"morph-shape\"]')].map(x=>x.value)")
    assert len(initial['shapes'])==5, initial
    click('button','More options')
    until(lambda s:js("!!document.querySelector('.next-overflow')"))
    initial['pinch']=js("document.querySelector('.next-overflow input[type=\"checkbox\"]')?.checked")
    initial['frames']=js("document.querySelector('select[aria-label=\"Morph length\"]')?.value")
    assert initial['frames']=='16', initial
    js("document.querySelector('.next-advanced').open=true")
    initial['routes']=js("[...document.querySelectorAll('select[aria-label=\"Processing mode\"] option')].map(x=>x.value)")
    assert set(initial['routes'])=={'auto','cpu','webgpu','webgl'}, initial
    assert initial['pattern']=='full-smooth-figure8' and not initial['errors'], initial
    assert initial['pinch'] is True, initial
    result['initial']=initial
    click('button','Add face')
    result['afterAdd']=until(lambda s:s['tiles']==3 and s['photoButtons']==2)
    click('button','Remove Face 3')
    result['afterRemove']=until(lambda s:s['tiles']==2 and s['photoButtons']==1)
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
        layout=json.loads(js("JSON.stringify({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>visualViewport.width+1,shapes:document.querySelectorAll('input[name=\"morph-shape\"]').length,buttons:[...document.querySelectorAll('.next-face-generate')].map(b=>({width:b.getBoundingClientRect().width,right:b.getBoundingClientRect().right}))})"))
        assert not layout['overflow'] and layout['scrollWidth']<=width+1 and layout['shapes']==5, layout
        assert all(b['width']>0 and b['right']<=width+1 for b in layout['buttons']), layout
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

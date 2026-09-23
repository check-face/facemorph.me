#!/usr/bin/env bash
set -euo pipefail
browser-harness <<'PY'
import json,time
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
    return json.loads(js("JSON.stringify({tiles:document.querySelectorAll('.next-face').length,photoButtons:document.querySelectorAll('button[aria-label=\"Choose photo\"]').length,generate:[...document.querySelectorAll('button')].some(b=>b.textContent==='Generate faces'),pattern:document.querySelector('select[aria-label=\"Morph pattern\"]')?.value,errors:document.querySelector('.next-error')?.innerText||''})"))
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
    new_tab('http://127.0.0.1:8080/')
    wait_for_load()
    # Close the trial-phase reporting toast without answering it; it would cover coordinate clicks.
    time.sleep(1)
    result['consentToastShown']=bool(js('(()=>{const b=document.querySelector(\'.next-consent-toast button[aria-label="Ask me later"]\');if(b)b.click();return !!b;})()'))
    initial=until(lambda s:s['tiles']==2 and s['photoButtons']==2 and s['generate'])
    # U-09 moved morph shape into the overflow; open it before asserting the default pattern.
    js("document.querySelector('.next-overflow')||[...document.querySelectorAll('button')].find(b=>b.textContent==='More options').click()")
    until(lambda s:js("!!document.querySelector('select[aria-label=\"Morph shape\"]')"))
    js("document.querySelector('.next-overflow').open=true")
    initial['pattern']=js("document.querySelector('select[aria-label=\"Morph shape\"]')?.value")
    # Smooth figure eight, pinched, is the default (operator, 22 September). Pinch had been
    # passed on every run for weeks with no control on the surface, so changing the default
    # silently took the choice away; the gate now holds both halves — the shape AND the
    # control that turns it off — so neither can go missing again without CI saying so.
    initial['pinch']=js("(()=>{const c=document.querySelector('.next-overflow input[type=\"checkbox\"]');return c?c.checked:null;})()")
    assert initial['pattern']=='full-smooth-figure8' and not initial['errors'], initial
    assert initial['pinch'] is True, initial
    result['initial']=initial
    click('button','Add face')
    result['afterAdd']=until(lambda s:s['tiles']==3 and s['photoButtons']==3)
    click('button','Remove')
    result['afterRemove']=until(lambda s:s['tiles']==2 and s['photoButtons']==2)
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
    result['passed']=True
except Exception as error:
    result['error']=str(error)
    raise
finally:
    Path('next-artifact-ui.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
PY

#!/usr/bin/env bash
set -euo pipefail
browser-harness <<'PY'
import json,time
from pathlib import Path
def click(role,name):
    nodes=cdp('Accessibility.getFullAXTree')['nodes']
    item=next(n for n in nodes if n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name)
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
    initial=until(lambda s:s['tiles']==2 and s['photoButtons']==2 and s['generate'])
    assert initial['pattern']=='pairwise-figure8' and not initial['errors'], initial
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

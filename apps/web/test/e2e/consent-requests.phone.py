#!/usr/bin/env python3
"""fm-qrfz: real P30 CPU cold/warm photo -> encode -> Android Save measurements.

RUNTIME_FILES=/verified/runtime python consent-requests.phone.py --artifact DIR \
  --runtime-sha SHA --out DIR

Uses the existing device lock, Phone, exact-artifact server and native Save helpers.
No proxy, emulated handset, fabricated bridge result or programmatic consent.
Measurements are descriptive; no new performance threshold is imposed.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'tools/device-lab'))
import lab  # noqa: E402

spec = importlib.util.spec_from_file_location('result_phone', Path(__file__).with_name('result-actions.phone.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

# Consent decisions in this journey must use real OS touches. The ordinary lab
# synthesis journey auto-accepts its gates; retain only its privacy setup here.
PRIVACY = "Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:()=>true,configurable:true});"
OBSERVE = r"""
(() => {
  const state = window.__consentPhone = {timeOrigin:performance.timeOrigin, encodes:0,
    queuedAt:0, encodingAt:0, completedAt:0, fileReadyAt:{}, firstFaceAt:{}, inputs:[],
    acquired:[], fileSelections:[], touches:[], cropOKAt:0, firstByteAt:0, errors:[]};
  const post = Worker.prototype.postMessage, seen = new WeakSet();
  Worker.prototype.postMessage = function(message,...rest) {
    if (!seen.has(this)) {
      seen.add(this);
      this.addEventListener('message', ({data}) => {
        const at = performance.now();
        if (data.type === 'progress' && data.stage === 'asset-acquisition' && data.fetched > 0) {
          state.firstByteAt ||= at;
          const last=state.acquired.at(-1);
          if (!last || data.fetched!==last.fetched || data.fetchedTotal!==last.fetchedTotal)
            state.acquired.push({at,fetched:data.fetched,total:data.fetchedTotal});
        }
      });
    }
    if (message?.type === 'encode-aligned') {
      state.encodes++; state.queuedAt=performance.now();
      this.addEventListener('message', ({data}) => {
        if (data.id!==message.id) return;
        if (data.type==='progress' && data.stage==='encoding') state.encodingAt=performance.now();
        if (data.type==='complete') state.completedAt=performance.now();
      });
    }
    return Reflect.apply(post,this,[message,...rest]);
  };
  const inspect = () => document.querySelectorAll('section.next-face').forEach((card,index) => {
    const save=[...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save image');
    if (save && !save.disabled) state.fileReadyAt[index] ??= performance.now();
    const image=card.querySelector('.next-face-img:not([data-public-preview])');
    if ((image instanceof HTMLImageElement && image.complete && image.naturalWidth===1024) ||
        (image instanceof HTMLCanvasElement && image.dataset.faceDrawn==='true' && image.width===1024))
      state.firstFaceAt[index] ??= performance.now();
  });
  document.addEventListener('load',inspect,true);
  new MutationObserver(inspect).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','src','data-public-preview','data-face-drawn']});
  for (const kind of ['keydown','input']) document.addEventListener(kind,event=>{
    if (!event.isTrusted || !(event.target instanceof HTMLInputElement)) return;
    const record={kind,key:event.key??null,at:performance.now(),eventTimestamp:event.timeStamp,
      value:event.target.value,frameAt:0,eventToFrameMs:0};
    state.inputs.push(record);
    requestAnimationFrame(()=>{record.frameAt=performance.now();record.handlerToFrameMs=record.frameAt-record.at;record.eventToFrameMs=record.frameAt-record.eventTimestamp;record.eventToHandlerMs=record.at-record.eventTimestamp;});
  },true);
  document.addEventListener('pointerdown',event=>{
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button=event.target.closest('button');
    if (!button) return;
    const record={at:performance.now(),label:button.textContent.trim()};state.touches.push(record);
    if (button.closest('.next-crop-dialog') && record.label==='OK') state.cropOKAt=record.at;
  },true);
  document.addEventListener('change',event=>{
    if (!(event.target instanceof HTMLInputElement) || event.target.type!=='file') return;
    for (const file of event.target.files??[]) {
      const row={name:file.name,size:file.size,type:file.type,at:performance.now()};
      state.fileSelections.push(row);
      file.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(digest=>{
        row.sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      });
    }
  },true);
  addEventListener('error',event=>state.errors.push(event.message));
})();
"""


def require(value, message):
    if not value:
        raise AssertionError(message)


def button(dev, scope, text, prefix=False):
    return dev.js("([scope,text,prefix])=>[...document.querySelectorAll(scope+' button')].findIndex(b=>prefix?b.textContent.trim().startsWith(text):b.textContent.trim()===text)", [scope, text, prefix])


def tap_button(dev, scope, text, prefix=False):
    index = button(dev, scope, text, prefix)
    require(index >= 0, f'Missing visible {text!r} in {scope}')
    dev.tap(scope + ' button', index)


def state(dev):
    return dev.js('window.__consentPhone')


def approve(dev, record):
    if not dev.page.locator('.next-download-accept').is_visible():
        return False
    record['approvals'].append({'pageAt': dev.js('performance.now()'),
                                'text': dev.page.locator('.next-download-dialog').inner_text()})
    dev.tap('.next-download-accept')
    return True


def wait(dev, predicate, record, seconds=900):
    end = time.monotonic() + seconds
    last_report = 0
    while time.monotonic() < end:
        if predicate():
            return
        approve(dev, record)
        error = dev.js("document.querySelector('.next-error')?.innerText||''")
        require(not error, f'Product reported {error}')
        if time.monotonic() - last_report > 10:
            observed = state(dev)
            lab.log('phone_photo_wait', phase=record['phase'], encodes=observed['encodes'],
                    encodingAt=observed['encodingAt'], completedAt=observed['completedAt'],
                    toast=dev.js("document.querySelector('.next-model-toast')?.innerText||''"))
            last_report = time.monotonic()
        dev.page.wait_for_timeout(250)
    raise TimeoutError('Physical photo journey did not reach its next real UI state')


class Network:
    """Native browser request metadata; sizes() reads counters, never response bodies."""
    def __init__(self, context, encoder):
        self.context, self.encoder, self.rows, self.open = context, encoder, [], {}
        for event, callback in [('request', self.request), ('requestfinished', self.finished), ('requestfailed', self.failed)]:
            context.on(event, callback)

    def request(self, request):
        parsed = urlsplit(request.url)
        path = parsed.path
        # Save observation fetches the app's actual local blob URL. It is not an
        # off-origin network host; preserve it separately in the request log.
        local_blob = request.url.startswith('blob:https://' + lab.ORIGIN_HOST + '/')
        row = {'url': request.url, 'path': path, 'host': parsed.netloc, 'scheme': parsed.scheme,
               'hostClass': 'encoder' if path in self.encoder else 'model' if re.match(r'/runtime/(assets|chunks|encoder-stream|photo)/', path) else 'app' if parsed.hostname == lab.ORIGIN_HOST or local_blob else 'other',
               'startMonotonicS': time.monotonic(), 'finished': False, 'bytes': None}
        self.rows.append(row)
        self.open[request] = row

    def finished(self, request):
        row = self.open.pop(request, None)
        if row is not None:
            row.update(finished=True, endMonotonicS=time.monotonic())
            try:
                row['bytes'] = request.sizes()['responseBodySize']
                row['timing'] = request.timing
            except Exception as error:
                row['sizeError'] = str(error)

    def failed(self, request):
        row = self.open.pop(request, None)
        if row is not None:
            row.update(failure=request.failure, endMonotonicS=time.monotonic())

    def model_rows(self):
        return [row for row in self.rows if row['hostClass'] in ('encoder', 'model')]

    def encoder_active(self):
        return any(row['hostClass'] == 'encoder' and not row['finished'] and 'failure' not in row for row in self.rows)

    def close(self):
        for event, callback in [('request', self.request), ('requestfinished', self.finished), ('requestfailed', self.failed)]:
            self.context.remove_listener(event, callback)


def tile_selector(dev, index):
    face_id = dev.js("i=>document.querySelectorAll('section.next-face')[i].dataset.nextFace", index)
    require(isinstance(face_id, str) and re.fullmatch(r'[\w-]+', face_id), 'Missing actual face identity')
    return 'section.next-face[data-next-face=' + json.dumps(face_id) + ']'


def native_choose(dev, fixture, remote, out, phase, record):
    lab.adb('push', str(fixture), remote)
    lab.sh('am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ' + shlex.quote('file://' + remote))
    record['chooseAt'] = dev.js('performance.now()')
    tile = tile_selector(dev, 1)
    dev.tap(tile + ' button[aria-label="Change mode"]')
    entry = dev.page.get_by_role('menuitem', name='Encode image', exact=True)
    entry.wait_for()
    # Wait for the menu's actual transition, then use Phone's hit-checked OS touch.
    entry.evaluate("async e=>{await Promise.allSettled((e.closest('.MuiPaper-root')?.getAnimations({subtree:true})??[]).map(a=>a.finished))}")
    index = entry.evaluate("el=>[...document.querySelectorAll('[role=menuitem]')].indexOf(el)")
    dev.tap('[role=menuitem]', index)
    xml = native.native_dump()
    (out / f'{phase}-picker.xml').write_text(xml)
    nodes = list(ET.fromstring(xml).iter())
    browse = next((node for node in nodes if node.get('text') == 'Browse'), None)
    require(browse is not None, 'Chrome native photo picker has no Browse control')
    record['browseTouch'] = native.native_tap(browse)
    dev.page.wait_for_timeout(500)
    xml = native.native_dump()
    (out / f'{phase}-files.xml').write_text(xml)
    nodes = list(ET.fromstring(xml).iter())
    choice = next((node for node in nodes if node.get('text') == Path(remote).name), None)
    if choice is None:
        # Recents can keep older provider thumbnails above a newly scanned file.
        # Operate DocumentsUI's real Search instead of injecting a browser File.
        search = next((node for node in nodes if node.get('content-desc') == 'Search'), None)
        require(search is not None, 'DocumentsUI exposes neither the task photo nor Search')
        record['searchTouch'] = native.native_tap(search)
        filename = Path(remote).name
        require(re.fullmatch(r'[A-Za-z0-9.-]+', filename), 'Unsafe native search text')
        lab.sh('input text ' + shlex.quote(filename))
        lab.sh('input keyevent KEYCODE_ENTER')
        end = time.monotonic() + 15
        while choice is None and time.monotonic() < end:
            dev.page.wait_for_timeout(500)
            xml = native.native_dump()
            nodes = list(ET.fromstring(xml).iter())
            choice = next((node for node in nodes if node.get('text') == filename
                           and node.get('resource-id') == 'android:id/title'), None)
        (out / f'{phase}-files-search.xml').write_text(xml)
    require(choice is not None, 'The actual DocumentsUI Recents did not expose the pushed task photo')
    record['fileTouch'] = native.native_tap(choice)


def recovery(path, expected_kind):
    code = """import {readFileSync} from 'node:fs';import{readRecovery}from'stylegan-js';
const r=readRecovery(new Uint8Array(readFileSync(process.argv[1])));
if(r.kind!=='parsed')throw Error('Saved recovery '+r.kind);
const f=r.recovered;
if(f.width!==1024||f.height!==1024||f.provenance.route!=='cpu'||f.provenance.provider!=='wasm'||f.generationKind!==process.argv[2])throw Error('Saved recovery has wrong dimensions/route/kind');
console.log(JSON.stringify({schemaVersion:f.schemaVersion,generationKind:f.generationKind,generationSha256:f.generationSha256,imageSha256:f.imageSha256,latentSha256:f.latentSha256,provenance:f.provenance,mime:f.mime,width:f.width,height:f.height}));"""
    result = subprocess.run(['node', '--input-type=module', '-e', code, str(path), expected_kind], cwd=REPO, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def save(dev, out, phase, index, owned):
    tile = tile_selector(dev, index)
    filename = native.ready(dev, tile)
    before = native.downloads()
    count = len(native.audit(dev)['saves'])
    selector, at = native.button(dev, tile, 'Save image')
    dev.tap(selector, at)
    saved = native.wait_download(dev, out, before, filename, f'{phase}-{index}-save', owned)
    observed = native.until(dev, f"window.__resultPhoneAudit.saves[{count}]?.outcome==='observed'&&window.__resultPhoneAudit.saves[{count}]")
    native.compare_file(saved, observed)
    saved['recovery'] = recovery(out / saved['path'], 'seed' if index == 0 else 'photo')
    saved['pageCompletedAt'] = dev.js('performance.now()')
    return saved


def journey(dev, args, phase, encoder, owned, report):
    record = {'phase': phase, 'approvals': [], 'status': 'running'}
    report['runs'].append(record)
    if phase == 'cold':
        dev.clear_origin(args.url)
    else:
        dev.page.goto('about:blank')
        dev.cdp.send('Storage.clearDataForOrigin', {'origin': args.url.rstrip('/'), 'storageTypes': 'indexeddb,local_storage'})
    net = Network(dev.page.context, encoder)
    try:
        response = dev.page.goto(args.url, wait_until='domcontentloaded')
        require(hashlib.sha256(response.body()).hexdigest() == report['documentSha256'], 'Phone document differs from the verified artifact')
        dev.wait("document.querySelectorAll('section.next-face').length>=2", 120)
        record['routeBefore'] = dev.js("document.querySelector('.next-route-caption')?.innerText||''")
        mode = dev.page.get_by_label('Processing mode')
        if not mode.is_visible():
            tap_button(dev, 'body', 'More options')
            panel = dev.page.locator('.next-advanced')
            if panel.count():
                panel.evaluate('e=>e.open=true')
        mode.select_option('cpu')  # route setup grants no permission
        dev.page.wait_for_timeout(1000)
        require(not net.model_rows(), 'Arrival/provider setup acquired model bytes without approval')
        if phase == 'cold':
            wait(dev, lambda: button(dev, '.next-model-toast', 'Plus photo encoder', True) >= 0, record, 120)
            record['approvedAt'] = dev.js('performance.now()')
            record['approvals'].append({'pageAt': record['approvedAt'], 'text': dev.page.locator('.next-model-toast').inner_text()})
            tap_button(dev, '.next-model-toast', 'Plus photo encoder', True)
            wait(dev, lambda: net.encoder_active() and state(dev)['firstByteAt'] > 0, record, 180)
        record['typingStartMonotonicS'] = time.monotonic()
        record['encoderActiveAtTypingStart'] = net.encoder_active()
        asked = 'Phonecoldseed' if phase == 'cold' else 'Phonewarmseed'
        record['typed'] = asked
        record['fieldValue'] = dev.type_into('section.next-face .next-field input', asked, 0)
        record['typedExactly'] = record['fieldValue'] == asked
        record['encoderActiveAtTypingEnd'] = net.encoder_active()
        record['typingEndMonotonicS'] = time.monotonic()
        record['seedRequestedAt'] = dev.js('performance.now()')
        dev.tap('section.next-face .next-face-generate', 0)
        wait(dev, lambda: '0' in state(dev)['firstFaceAt'], record)
        record['firstUsefulFaceAt'] = state(dev)['firstFaceAt'].get('0') or dev.js('performance.now()')
        remote = '/sdcard/Download/' + f'PearlIvy-{phase}-{os.getpid()}.jpg'
        owned.add(remote)
        native_choose(dev, args.fixture, remote, args.out, phase, record)
        wait(dev, lambda: dev.page.locator('.next-crop-dialog .next-encode-preview img').count() > 0, record, 120)
        record['cropVisibleAt'] = dev.js('performance.now()')
        dev.screenshot(args.out / f'{phase}-crop.png')
        wait(dev, lambda: dev.js("[...document.querySelectorAll('.next-crop-dialog button')].some(b=>b.textContent.trim()==='OK'&&!b.disabled)"), record, 120)
        tap_button(dev, '.next-crop-dialog', 'OK')
        wait(dev, lambda: '1' in state(dev)['fileReadyAt'] and state(dev)['completedAt'] > 0, record)
        observed = state(dev)
        require(observed['encodes'] == 1, f"Expected one real encoder, observed {observed['encodes']}")
        selections = observed['fileSelections']
        require(len(selections) == 1 and selections[0].get('sha256') == report['fixture']['sha256'], 'Native photo File does not match the task fixture')
        record['route'] = dev.js("document.querySelector('.next-route-caption')?.innerText||''")
        lab.check_route(record['route'], False)
        record['exports'] = [save(dev, args.out, phase, index, owned) for index in (0, 1)]
        record['observation'] = observed
        inputs = [entry for entry in observed['inputs'] if entry['frameAt'] > 0]
        # ADB typing blocks Python's event dispatch, so host callback timestamps
        # cannot establish transfer overlap. Both clocks here come from the phone
        # browser: Request.timing's Unix startTime plus response offsets, and the
        # document's explicit performance.timeOrigin plus trusted event.timeStamp.
        transfers = []
        for row in net.rows:
            timing = row.get('timing', {})
            if row['hostClass'] == 'encoder' and (row.get('bytes') or 0) > 0 and timing.get('responseStart', -1) >= 0 and timing.get('responseEnd', -1) >= 0:
                transfers.append({'path': row['path'], 'responseStartEpochMs': timing['startTime'] + timing['responseStart'],
                                  'responseEndEpochMs': timing['startTime'] + timing['responseEnd']})
        for entry in inputs:
            entry['browserEpochMs'] = observed['timeOrigin'] + entry['eventTimestamp']
            entry['encoderTransfers'] = [row['path'] for row in transfers if row['responseStartEpochMs'] <= entry['browserEpochMs'] <= row['responseEndEpochMs']]
        during_transfer = [entry for entry in inputs if entry['encoderTransfers']]
        record['inputLatency'] = {'samples': inputs, 'samplesDuringEncoderTransfer': len(during_transfer),
                                  'transferIntervals': transfers,
                                  'clock': 'phone browser epoch: performance.timeOrigin + trusted DOM event timestamp matched to Request.timing.startTime + response offsets; latency is event timestamp to next animation frame, with handler/queue components; host callback/ADB durations excluded'}
        if phase == 'cold':
            record['approvalOperationStartedAt'] = record['approvedAt']
            record['approvedAt'] = next(touch['at'] for touch in observed['touches'] if touch['label'].lower().startswith('plus photo encoder'))
        model_response_epochs = [row['timing']['startTime'] + row['timing']['responseStart']
                                 for row in net.model_rows() if row.get('timing', {}).get('responseStart', -1) >= 0]
        record['firstModelResponseEpochMs'] = min(model_response_epochs) if model_response_epochs else None
        record['metricsMs'] = {'approvalToFirstModelByte': None if phase == 'warm' else record['firstModelResponseEpochMs'] - observed['timeOrigin'] - record['approvedAt'],
                               'approvalToFirstObservedAcquisitionProgress': None if phase == 'warm' else observed['firstByteAt'] - record['approvedAt'],
                               'approvalToFirstUsefulFace': None if phase == 'warm' else record['firstUsefulFaceAt'] - record['approvedAt'],
                               'seedRequestToUsefulFace': record['firstUsefulFaceAt'] - record['seedRequestedAt'],
                               'chooseToPhotoExport': record['exports'][1]['pageCompletedAt'] - record['chooseAt'],
                               'cropOKToEncoding': observed['encodingAt'] - observed['cropOKAt'],
                               'encodeEndToPreparedFile': observed['fileReadyAt']['1'] - observed['completedAt']}
        require(observed['encodingAt'] > observed['cropOKAt'] > 0, 'Missing ordered actual crop OK -> visitor encoding timestamps')
        require(not observed['errors'], 'Phone page error: ' + repr(observed['errors']))
        require(not [row for row in net.rows if row['hostClass'] == 'other'], 'Phone requested an unpinned external host')
        if phase == 'warm':
            require(not net.model_rows(), 'Warm model cache caused model acquisition')
            require(not record['approvals'], 'Warm unchanged scope unexpectedly requested approval')
        else:
            require(during_transfer, 'No measured trusted input overlapped a natural encoder transfer')
        require(not [row for row in net.model_rows() if row['finished'] and row['bytes'] is None], 'Missing actual browser byte counters')
        record['status'] = 'pass'
        dev.screenshot(args.out / f'{phase}-complete.png')
    finally:
        if record['status'] != 'pass':
            record['status'] = 'fail'
        record['network'] = net.rows
        net.close()
        (args.out / f'{phase}.json').write_text(json.dumps(record, indent=2) + '\n')
        lab.log('phone_photo_metrics', **record)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--runtime-sha', required=True)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--port', type=int, default=lab.LOCAL_PORT, help='Task-owned qualification server and ADB reverse port')
    parser.add_argument('--fixture', type=Path, default=REPO / 'tests/crop/fixtures/no-face.jpg')
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    args.url = 'https://' + lab.ORIGIN_HOST + '/'
    report = {'bead': 'fm-qrfz', 'cell': 'phone-cpu', 'status': 'running', 'runs': [],
              'localCandidate': True, 'deployedEvidence': False, 'runtimeSha256': args.runtime_sha,
              'fixture': {'path': str(args.fixture), 'size': args.fixture.stat().st_size,
                          'sha256': hashlib.sha256(args.fixture.read_bytes()).hexdigest()}}
    owned = set()
    for signum in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, lambda sig, _frame: (_ for _ in ()).throw(SystemExit(128 + sig)))
    try:
        artifact = lab.artifact_evidence(args.artifact)
        report['artifact'] = {key: value for key, value in artifact.items() if key != 'files'}
        report['documentSha256'] = next(row['sha256'] for row in artifact['files'] if row['path'] == 'deploy-next/index.html')
        args.artifact = Path(artifact['directory'])
        runtime = Path(os.environ.get('RUNTIME_FILES', args.artifact.parent / '.runtime-public'))
        require(hashlib.sha256((runtime / 'manifest.json').read_bytes()).hexdigest() == args.runtime_sha, 'Runtime pin mismatch')
        manifest = json.loads((runtime / 'manifest.json').read_text())
        descriptor = json.loads((runtime / urlsplit(manifest['encoderStream']['url']).path.removeprefix('/runtime/')).read_text())
        encoder = {urlsplit(part['url']).path for asset in descriptor['steps'] for part in [asset, *asset.get('chunks', [])]}
        from playwright.sync_api import sync_playwright
        with lab.lab_lock(['phone-cpu']):
            report['device'] = lab.device_facts()
            require(report['device']['model'] in ('VOG-L29', 'VOG-L09', 'VOG-AL00') and not lab.SERIAL.startswith('emulator-'), 'Physical Huawei P30 Pro required')
            lab.HOLD.parent.mkdir(parents=True, exist_ok=True)
            lab.HOLD.touch(exist_ok=True)
            lab.recover()
            lab.camera_off()
            report['cameraBefore'] = lab.camera_status()
            try:
                lab.session_begin()
                lab.phone_chrome_flags(False, True, port=args.port)
                with lab.LocalServer(args.artifact, args.runtime_sha, args.out, port=args.port):
                    with sync_playwright() as pw:
                        dev = lab.Phone(pw, init_script=PRIVACY)
                        session = None
                        try:
                            session = dev.browser.new_browser_cdp_session()
                            session.send('Browser.setDownloadBehavior', {'behavior': 'default'})
                            dev.page.add_init_script(OBSERVE)
                            dev.page.add_init_script(native.AUDIT)
                            dev.page.on('pageerror', lambda error: report.setdefault('pageErrors', []).append(str(error)))
                            for phase in ('cold', 'warm'):
                                lab.cool_down()
                                journey(dev, args, phase, encoder, owned, report)
                        finally:
                            dev.screenshot(args.out / 'last.png')
                            if session:
                                session.send('Browser.setDownloadBehavior', {'behavior': 'default'})
                                session.detach()
                            dev.close()
            finally:
                lab.sh('input keyevent KEYCODE_BACK', check=False)
                for path in owned:
                    lab.sh('rm -f ' + shlex.quote(path), check=False)
                    if path.endswith('.jpg'):
                        lab.sh('content delete --uri content://media/external/images/media --where ' + shlex.quote("_data='" + path + "'"), check=False)
                lab.sh('am force-stop ' + lab.CHROME, check=False)
                lab.session_end()
                lab.STATE.unlink(missing_ok=True)
                report['cleanup'] = {'camera': lab.camera_status(), 'cameraHeldOff': lab.HOLD.exists(),
                                     'taskPort': args.port, 'taskPortListening': lab.port_listening(args.port),
                                     'reverseMappings': lab.adb('reverse', '--list', check=False),
                                     'ownedFilesRemaining': [path for path in owned if lab.sh('test -e ' + shlex.quote(path) + ' && echo yes', check=False) == 'yes']}
        require(not report.get('pageErrors'), 'Actual phone reported page errors')
        report['status'] = 'pass'
    except BaseException as error:
        report.update(status='fail', error=repr(error))
        raise
    finally:
        (args.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        lab.log('phone_photo_result', **report)


if __name__ == '__main__':
    main()

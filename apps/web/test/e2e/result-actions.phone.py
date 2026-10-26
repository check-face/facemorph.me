#!/usr/bin/env python3
"""Physical P30 Pro proof for fm-qh1s; never a CI/emulator substitute.

RUNTIME_FILES=/verified/runtime uv run --with playwright python \
  apps/web/test/e2e/result-actions.phone.py --artifact DIR --runtime-sha SHA --out DIR

Uses the existing phone lease/session and exact-artifact server. Native Share is
observed through a synchronous pass-through, never replaced with a fake response.
The negative case is explicitly an untrusted DOM click without user activation;
all positive controls use lab.Phone's hit-checked, real ADB touch path.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sys
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'tools/device-lab'))
import lab  # noqa: E402


AUDIT = r"""
(() => {
  const audit = window.__resultPhoneAudit = {shares: [], saves: []};
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    b => b.toString(16).padStart(2, '0')).join('');
  const native = navigator.share;
  if (typeof native === 'function') Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: function(data) {
      const record = {activation: navigator.userActivation.isActive, outcome: 'pending',
        files: Array.from(data.files || [], f => ({name: f.name, mime: f.type, size: f.size}))};
      audit.shares.push(record);
      let returned;
      try { returned = native.call(this, data); }
      catch (error) { record.outcome = 'rejected'; record.errorName = error.name; throw error; }
      // Start observation only after invoking native Share within the original gesture.
      Array.from(data.files || []).forEach((file, index) => {
        file.arrayBuffer().then(hash).then(digest => record.files[index].sha256 = digest,
          error => record.files[index].observationError = error.name);
      });
      return returned.then(value => { record.outcome = 'fulfilled'; return value; }, error => {
        record.outcome = 'rejected'; record.errorName = error.name; throw error;
      });
    }
  });
  addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!anchor) return;
    const record = {name: anchor.download, outcome: 'pending'};
    audit.saves.push(record);
    // Passive observation of the actual download URL; no interception or replacement.
    fetch(anchor.href).then(async response => {
      const bytes = await response.arrayBuffer();
      Object.assign(record, {mime: response.headers.get('content-type'), size: bytes.byteLength,
        sha256: await hash(bytes), outcome: 'observed'});
    }).catch(error => { record.outcome = 'unobserved'; record.errorName = error.name; });
  }, true);
})();
"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def evaluate(dev, expression):
    """Inspection must not manufacture transient activation for the negative case."""
    result = dev.cdp.send('Runtime.evaluate', {
        'expression': expression, 'returnByValue': True, 'awaitPromise': True,
        'userGesture': False,
    })
    if result.get('exceptionDetails'):
        raise RuntimeError(str(result['exceptionDetails']))
    return result.get('result', {}).get('value')


def until(dev, expression, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = evaluate(dev, expression)
        if value:
            return value
        time.sleep(.25)
    raise TimeoutError(f'waiting for {expression[:120]}')


def audit(dev):
    return evaluate(dev, 'window.__resultPhoneAudit')


def downloads():
    return set(lab.sh('find /sdcard/Download -maxdepth 1 -type f', check=True).splitlines())


def native_dump():
    remote = f'/sdcard/result-actions-{os.getpid()}.xml'
    try:
        lab.sh(f'uiautomator dump {shlex.quote(remote)} >/dev/null 2>&1')
        xml = lab.sh(f'cat {shlex.quote(remote)}')
    finally:
        lab.sh(f'rm -f {shlex.quote(remote)}', check=False)
    return xml


def native_sheet_kind(xml, focus):
    if re.search(r'chooser|resolver|sharesheet', focus, re.I):
        return 'android-native-resolver'
    root = ET.fromstring(xml)
    nodes = list(root.iter())
    # Chrome 150 on this Huawei presents its native Java share hub before the
    # Android resolver. The activity remains Chrome; these are Android widgets,
    # not controls in the web document (saved in the raw hierarchy for review).
    native = [node for node in nodes if node.get('package') == lab.CHROME
              and node.get('class', '').startswith('android.')]
    texts = {node.get('text', '') for node in native}
    if {'Copy image', 'More'}.issubset(texts) or {'Bluetooth', 'More'}.issubset(texts):
        return 'chrome-native-share-sheet'
    return None


def native_ui(out, label, dev):
    xml = native_dump()
    (out / f'{label}.xml').write_text(xml)
    dev.screenshot(out / f'{label}.png')
    root = ET.fromstring(xml)
    texts = [value for node in root.iter() for key, value in node.attrib.items()
             if key in ('text', 'content-desc') and value]
    focus = lab.focus()
    return {'focus': focus, 'kind': native_sheet_kind(xml, focus), 'texts': texts,
            'xml': f'{label}.xml', 'screenshot': f'{label}.png'}


def chooser_visible():
    return bool(native_sheet_kind(native_dump(), lab.focus()))


def wait_chooser(dev, out, seconds=20, label='native-share-sheet'):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        sheet = native_ui(out, label, dev)
        if sheet['kind']:
            return sheet
        time.sleep(.25)
    raise AssertionError('No native Android chooser/resolver appeared after the real Share tap')


def button(dev, tile, text, kind='image'):
    selector = tile + (' .next-face-actions button' if kind == 'image' else ' .next-actions button')
    index = evaluate(dev, '[...document.querySelectorAll(' + json.dumps(selector) + ')]'
                     '.findIndex(el => el.textContent.trim() === ' + json.dumps(text) + ')')
    require(index >= 0, f'No visible result control {text}')
    return selector, index


def ready(dev, tile, kind='image'):
    expression = '(' + json.dumps(tile) + ')'
    label = 'Image filename' if kind == 'image' else 'Video filename'
    save = 'Save image' if kind == 'image' else 'Save video'
    return until(dev, f"(() => {{const tile=document.querySelector({expression});"
                 f"const input=tile?.querySelector('[aria-label=\"{label}\"]');"
                 f"const save=[...tile?.querySelectorAll('button')||[]].find(b=>b.textContent.trim()==='{save}');"
                 "return input&&!input.disabled&&save&&!save.disabled&&input.value;})()", 180)


def typed_file(dev, tile, kind='image'):
    # A task-unique safe label avoids native overwrite prompts without changing identity suffix rules.
    field = tile + (' [aria-label="Image filename"]' if kind == 'image' else ' [aria-label="Video filename"]')
    prefix = 'Phoneproof' if kind == 'image' else 'Phonevideoproof'
    asked = f'{prefix}{int(time.time())}'
    require(dev.type_into(field, asked) == asked, 'Filename edit did not receive the real keyboard input')
    # Phone.type_into closes the keyboard; a real tap on the image commits the field blur.
    dev.tap(tile + (' .next-face-image' if kind == 'image' else ' .next-video-format'))
    name = ready(dev, tile, kind)
    extension = r'(webp|png)' if kind == 'image' else 'mp4'
    require(re.fullmatch(prefix.lower() + r'\d+-[bcdfghjkmnpqrstvwxz2-9]{6}\.' + extension, name),
            f'Filename was not sanitized with its identity suffix: {name!r}')
    return name


def pulled_file(out, path, label):
    target = out / f'{label}-{Path(path).name}'
    lab.adb('pull', path, str(target))
    data = target.read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime, extension = 'image/png', '.png'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        mime, extension = 'image/webp', '.webp'
    elif data[4:8] == b'ftyp':
        mime, extension = 'video/mp4', '.mp4'
    else:
        raise AssertionError('Actual Android download is neither PNG, WebP nor MP4')
    require(Path(path).suffix == extension, 'Downloaded extension does not match actual bytes')
    return {'path': target.name, 'androidName': Path(path).name, 'mime': mime,
            'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def native_tap(node):
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    require(match is not None, 'Native Android control has no physical bounds')
    x1, y1, x2, y2 = map(int, match.groups())
    require(x2 > x1 and y2 > y1, 'Native Android control has empty physical bounds')
    point = [(x1 + x2) // 2, (y1 + y2) // 2]
    lab.sh(f'input tap {point[0]} {point[1]}')
    return point


def confirm_download(dev, out, label):
    xml = native_dump()
    nodes = list(ET.fromstring(xml).iter())
    if not any(node.get('text') == 'Download file again?' for node in nodes):
        return False
    (out / f'{label}-download-confirmation.xml').write_text(xml)
    dev.screenshot(out / f'{label}-download-confirmation.png')
    # Chrome remembers completed names even after our task-owned file is
    # removed. Accept its real confirmation without changing the default
    # repeated-download preference ('Don't show again' starts checked).
    checked = [node for node in nodes if node.get('checkable') == 'true'
               and node.get('checked') == 'true' and node.get('package') == lab.CHROME]
    require(len(checked) <= 1, 'Unexpected multiple checked controls in native Download confirmation')
    points = []
    if checked:
        points.append({'action': 'uncheck-do-not-show-again', 'point': native_tap(checked[0])})
        nodes = list(ET.fromstring(native_dump()).iter())
        require(not any(node.get('checkable') == 'true' and node.get('checked') == 'true'
                        and node.get('package') == lab.CHROME for node in nodes),
                'Native repeated-download preference checkbox remained checked')
    buttons = [node for node in nodes if node.get('text') == 'Download' and node.get('clickable') == 'true']
    require(len(buttons) == 1, 'Native confirmation has no unique Download button')
    points.append({'action': 'download', 'point': native_tap(buttons[0])})
    (out / f'{label}-download-confirmation-taps.json').write_text(json.dumps(points, indent=2) + '\n')
    return True


def wait_download(dev, out, before, expected, label, owned):
    end = time.monotonic() + 30
    last_confirmation_probe = time.monotonic()
    while time.monotonic() < end:
        found = downloads() - before
        matching = [path for path in found if Path(path).stem.startswith(Path(expected).stem)
                    and Path(path).suffix in ('.webp', '.png', '.mp4')]
        require(len(matching) <= 1, 'One Save produced more than one matching Android download')
        if matching:
            path = matching[0]
            owned.add(path)
            # Chrome may expose a destination before its bytes finish writing.
            first = lab.sh('stat -c %s ' + shlex.quote(path))
            dev.page.wait_for_timeout(500)
            if first == lab.sh('stat -c %s ' + shlex.quote(path)) and int(first) > 0:
                return pulled_file(out, path, label)
        if time.monotonic() - last_confirmation_probe > 2:
            confirm_download(dev, out, label)
            last_confirmation_probe = time.monotonic()
        time.sleep(.25)
    raise TimeoutError('No completed matching file appeared in Android Downloads')


def compare_file(actual, shared):
    for key in ('sha256', 'size', 'mime'):
        require(actual[key] == shared[key], f'Actual download {key} differs from the native shared file')


def morph_proof(dev, args, report, owned):
    """A minimal valid real morph, followed by operated native MP4 Share/Save."""
    record = report['morph'] = {'status': 'untested'}
    index = evaluate(dev, "[...document.querySelectorAll('button')].findIndex(b=>b.textContent.trim()==='More options')")
    require(index >= 0, 'No More options control for the real morph setup')
    dev.tap('button', index)
    # By-name selection is setup, as in the lab's other operated journeys.
    # These are the real product controls; no controller or inference injection.
    dev.page.get_by_label('Morph shape', exact=True).select_option('linear')
    dev.page.get_by_label('Morph length', exact=True).select_option('custom')
    require(dev.type_into('input[aria-describedby="next-custom-frames-note"]', '2') == '2',
            'The real Custom frames input did not retain 2')
    dev.tap('button', index)
    record['settings'] = {'kind': 'linear', 'framesPerFace': 2, 'quality': 'standard'}
    record['journey'] = lab.journey_morph(dev, False)
    tile = '.next-video-slot'
    ready(dev, tile, 'video')
    name = typed_file(dev, tile, 'video')
    report.setdefault('taskFilenames', []).append(name)
    geometry = evaluate(dev, "(() => {const slot=document.querySelector('.next-video-slot');"
                        "const video=slot?.querySelector('video');const actions=slot?.querySelector('.next-actions');"
                        "return {width:video?.videoWidth,height:video?.videoHeight,duration:video?.duration,"
                        "belowVideo:!!video&&!!actions&&actions.getBoundingClientRect().top>=video.getBoundingClientRect().bottom,"
                        "disclosed:slot?.querySelector('[data-next-video-width]')?.textContent};})()")
    require(geometry['width'] == 512 and geometry['height'] == 512 and geometry['duration'] > 0,
            'The actual default-quality MP4 is not a playable 512-pixel morph')
    require(geometry['belowVideo'] and geometry['disclosed'], 'Video actions/resolution are not below the video')
    record['geometry'] = geometry
    dev.screenshot(args.out / 'video-ready.png')
    baseline = downloads()
    share_index = len(audit(dev)['shares'])
    save_count = len(audit(dev)['saves'])
    selector, index = button(dev, tile, 'Share morph', 'video')
    dev.tap(selector, index)
    record['shareTouch'] = evaluate(dev, 'window.__labHit')
    sheet = wait_chooser(dev, args.out, label='native-video-share-sheet')
    shared = until(dev, f'window.__resultPhoneAudit.shares[{share_index}]?.files.every(f=>f.sha256)&&'
                   f'window.__resultPhoneAudit.shares[{share_index}]')
    require(shared['activation'] and len(shared['files']) == 1, 'Native morph Share needs activation and one file')
    file = shared['files'][0]
    require(file['name'] == name and file['mime'] == 'video/mp4' and name.endswith('.mp4'),
            'Native MP4 file does not match the editable name/MIME/extension')
    sheet['filenameVisible'] = any(name in text for text in sheet.pop('texts'))
    record['nativeShare'] = {'status': 'pass', 'file': file, 'sheet': sheet, 'fileCount': 1}
    lab.sh('input keyevent KEYCODE_BACK')
    cancelled = until(dev, f"window.__resultPhoneAudit.shares[{share_index}].outcome==='rejected'&&"
                      f'window.__resultPhoneAudit.shares[{share_index}]')
    require(cancelled['errorName'] == 'AbortError', 'Native morph cancellation did not produce AbortError')
    require(ready(dev, tile, 'video') == name, 'Morph did not stay ready with its name after cancel')
    dev.page.wait_for_timeout(2000)
    require(len(audit(dev)['saves']) == save_count and downloads() == baseline,
            'Cancelling native morph Share triggered a download')
    record['cancel'] = {'status': 'pass', 'nativeError': 'AbortError', 'downloadCount': 0}
    selector, index = button(dev, tile, 'Save video', 'video')
    dev.tap(selector, index)
    saved = wait_download(dev, args.out, baseline, name, 'real-video-save', owned)
    observed = until(dev, f"window.__resultPhoneAudit.saves[{save_count}]?.outcome==='observed'&&"
                     f'window.__resultPhoneAudit.saves[{save_count}]')
    require(observed['name'] == name, 'Real Save video changed the prepared filename')
    compare_file(observed, file)
    compare_file(saved, file)
    record['save'] = {'status': 'pass', 'download': saved, 'touch': evaluate(dev, 'window.__labHit'),
                      'sameSharedBytes': True, 'sameRequestedName': True}
    dev.screenshot(args.out / 'after-video-save.png')
    record['status'] = 'pass'


def proof(dev, args, report, owned):
    dev.expected_index = report['documentSha256']
    dev.page.add_init_script(AUDIT)
    # Seed the model cache, then use the existing isolated warm-session journey.
    report['setupFace'] = lab.journey_face(dev, args.url, False, 'Phoneproofsetup', False)
    warm_requests = []
    def requested(request):
        if urlsplit(request.url).path.startswith('/runtime/'):
            warm_requests.append(urlsplit(request.url).path)
    dev.page.on('request', requested)
    started = time.monotonic()
    try:
        report['warmFace'] = lab.journey_face(dev, args.url, False, 'Phoneproofwarm', False)
    finally:
        dev.page.remove_listener('request', requested)
    duration = round(time.monotonic() - started, 1)
    findings = lab.budget_findings('phone-cpu', [{'durationsS': {'warm-face': duration}}])
    report['warmFace'].update(durationS=duration, budgetFindings=findings,
                              status='fail' if findings else 'pass', runtimeRequests=warm_requests,
                              warmedBy='setupFace on the same exact artifact and origin')
    # A measured budget failure remains a failure; collect independent native
    # Share evidence as well instead of abandoning the rest of the acceptance.
    report['capabilities'] = dev.capabilities
    runtime = evaluate(dev, "(async()=>{const response=await fetch('/runtime/manifest.json');"
                       "if(!response.ok)throw Error('runtime manifest fetch failed');"
                       "return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',"
                       "await response.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')})()")
    require(runtime == args.runtime_sha, 'Phone runtime manifest digest differs from the requested pin')
    report['servedRuntimeSha256'] = runtime
    report['viewport'] = evaluate(dev, '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')
    if args.video_only:
        morph_proof(dev, args, report, owned)
        return
    face_id = evaluate(dev, "document.querySelector('section.next-face')?.dataset.nextFace")
    require(isinstance(face_id, str) and re.fullmatch(r'[\w-]+', face_id), 'Missing first face identity')
    tile = f'section.next-face[data-next-face="{face_id}"]'
    ready(dev, tile)
    name = typed_file(dev, tile)
    report['taskFilename'] = name
    dev.screenshot(args.out / 'ready.png')
    supported = evaluate(dev, "typeof navigator.share==='function'&&typeof navigator.canShare==='function'")
    if not supported:
        raise lab.Untested('This physical Chrome does not expose native file Share')
    share_selector, share_index = button(dev, tile, 'Share image')
    baseline = downloads()
    dev.tap(share_selector, share_index)
    report['shareTouch'] = evaluate(dev, 'window.__labHit')
    sheet = wait_chooser(dev, args.out)
    first = until(dev, "window.__resultPhoneAudit.shares[0]?.files.every(f=>f.sha256) && "
                  'window.__resultPhoneAudit.shares[0]')
    require(first['activation'], 'Native Share was not invoked with user activation')
    require(len(first['files']) == 1, 'Native Share must receive exactly one file')
    shared = first['files'][0]
    require(shared['name'] == name, 'Native Share filename differs from the editable filename')
    require((shared['mime'], Path(name).suffix) in [('image/webp', '.webp'), ('image/png', '.png')],
            'Native Share MIME/extension differ')
    sheet['filenameVisible'] = any(name in text for text in sheet.pop('texts'))
    report['nativeShare'] = {'status': 'pass', 'file': shared, 'sheet': sheet,
                            'activation': first['activation'], 'fileCount': len(first['files'])}
    report['nativeFilenameDisplay'] = {
        'status': 'pass' if sheet['filenameVisible'] else 'untested',
        'reason': None if sheet['filenameVisible'] else 'Native chooser does not expose the full filename in its UI dump',
    }
    lab.sh('input keyevent KEYCODE_BACK')
    cancelled = until(dev, "window.__resultPhoneAudit.shares[0]?.outcome==='rejected'&&"
                      'window.__resultPhoneAudit.shares[0]')
    require(cancelled['errorName'] == 'AbortError', 'Back did not produce the actual native AbortError')
    require(ready(dev, tile) == name, 'Result/name changed after cancelling native Share')
    # Allow an erroneous asynchronous fallback/download to become observable.
    dev.page.wait_for_timeout(2000)
    require(not audit(dev)['saves'], 'Share cancellation triggered the download path')
    require(downloads() == baseline, 'Share cancellation created an Android download')
    report['cancel'] = {'status': 'pass', 'nativeError': cancelled['errorName'],
                        'resultReady': True, 'downloadCount': 0}
    dev.screenshot(args.out / 'after-cancel.png')

    # A deliberately untrusted DOM event, not an operated-input pass. CDP explicitly
    # disables userGesture; Playwright evaluate can otherwise confer activation.
    until(dev, '!navigator.userActivation.isActive', 15)
    before = downloads()
    evaluate(dev, 'document.querySelectorAll(' + json.dumps(share_selector) + ')[' +
             str(share_index) + '].click()')
    second = until(dev, 'window.__resultPhoneAudit.shares[1]')
    require(not second['activation'], 'Negative driver accidentally granted user activation')
    end = time.monotonic() + 15
    while second['outcome'] == 'pending' and time.monotonic() < end:
        time.sleep(.25)
        second = audit(dev)['shares'][1]
    if second['outcome'] == 'pending' and chooser_visible():
        native_ui(args.out, 'negative-unexpected-sheet', dev)
        lab.sh('input keyevent KEYCODE_BACK')
        until(dev, "window.__resultPhoneAudit.shares[1].outcome!=='pending'")
        report['shareFailureFallback'] = {'status': 'untested', 'driver': 'untrusted-dom-click-no-activation',
                                         'reason': 'Native browser admitted Share without transient activation'}
    elif second['outcome'] == 'rejected' and second.get('errorName') != 'AbortError':
        fallback = wait_download(dev, args.out, before, name, 'share-failure', owned)
        compare_file(fallback, shared)
        save = until(dev, "window.__resultPhoneAudit.saves[0]?.outcome==='observed'&&"
                     'window.__resultPhoneAudit.saves[0]')
        require(save['name'] == name, 'Share failure fallback changed the requested filename')
        compare_file(save, shared)
        report['shareFailureFallback'] = {'status': 'pass', 'driver': 'untrusted-dom-click-no-activation',
                                         'nativeError': second['errorName'], 'download': fallback}
    else:
        report['shareFailureFallback'] = {'status': 'untested', 'driver': 'untrusted-dom-click-no-activation',
                                         'reason': 'Native rejection did not exercise a non-AbortError failure',
                                         'nativeOutcome': second}
    require(ready(dev, tile) == name, 'Result/name changed after the native negative case')

    before = downloads()
    save_count = len(audit(dev)['saves'])
    # Evidence is already pulled. Remove only our earlier fallback download so
    # Android's duplicate-name dialog cannot obscure the real Save comparison.
    for path in sorted(owned):
        lab.sh('rm -f ' + shlex.quote(path))
    before = downloads()
    selector, index = button(dev, tile, 'Save image')
    dev.tap(selector, index)
    saved = wait_download(dev, args.out, before, name, 'real-save', owned)
    observed = until(dev, f"window.__resultPhoneAudit.saves[{save_count}]?.outcome==='observed'&&"
                     f'window.__resultPhoneAudit.saves[{save_count}]')
    require(observed['name'] == name, 'Real Save changed the prepared filename')
    compare_file(observed, shared)
    compare_file(saved, shared)
    report['save'] = {'status': 'pass', 'download': saved, 'sameSharedBytes': True,
                      'sameRequestedName': True, 'touch': evaluate(dev, 'window.__labHit')}
    dev.screenshot(args.out / 'after-save.png')
    report['audit'] = audit(dev)
    morph_proof(dev, args, report, owned)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--runtime-sha', required=True)
    parser.add_argument('--artifact-digest', help='Require this exact integrated-verification artifact digest')
    parser.add_argument('--video-only', action='store_true',
                        help='Collect only the independent native morph case after CPU warm-face')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    require(re.fullmatch(r'[0-9a-f]{64}', args.runtime_sha), '--runtime-sha must be lowercase SHA-256')
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    args.url = f'https://{lab.ORIGIN_HOST}/'
    report = {'bead': 'fm-qh1s', 'cell': 'phone-cpu', 'status': 'untested',
              'scope': 'physical-phone native Share/cancel/failure fallback and matching Save',
              'localCandidate': True, 'deployedEvidence': False,
              'runtimeSha256': args.runtime_sha, 'cleanup': {}}
    report['scope'] = ('physical-phone native MP4 Share/cancel and matching Save' if args.video_only else
                       'physical-phone native image/MP4 Share/cancel, image failure fallback and matching Save')
    owned = set()
    def terminate(signum, _frame):
        raise SystemExit(128 + signum)
    for name in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(name, terminate)
    try:
        artifact = lab.artifact_evidence(args.artifact, args.artifact_digest)
        report['artifact'] = {key: value for key, value in artifact.items() if key != 'files'}
        report['documentSha256'] = next(row['sha256'] for row in artifact['files']
                                        if row['path'] == 'deploy-next/index.html')
        args.artifact = Path(artifact['directory'])
        runtime = Path(os.environ.get('RUNTIME_FILES', args.artifact.parent / '.runtime-public'))
        require(hashlib.sha256((runtime / 'manifest.json').read_bytes()).hexdigest() == args.runtime_sha,
                'Local runtime manifest differs from --runtime-sha')
        # Import only after --help/local admission. Importing does not access devices.
        from playwright.sync_api import sync_playwright
        with lab.lab_lock(['phone-cpu']):
            report['device'] = lab.device_facts()
            require(report['device']['model'] in ('VOG-L29', 'VOG-L09', 'VOG-AL00'),
                    'This driver requires the physical Huawei P30 Pro, not an emulator')
            require(not lab.SERIAL.startswith('emulator-'), 'Emulator cannot supply physical-phone evidence')
            report['cameraBefore'] = lab.camera_status()
            # Establish the operator's camera hold before stale recovery can
            # consider resuming a camera paused by an earlier session.
            lab.HOLD.parent.mkdir(parents=True, exist_ok=True)
            lab.HOLD.touch(exist_ok=True)
            lab.recover()
            lab.camera_off()
            try:
                lab.session_begin()
                lab.phone_chrome_flags(False, True)
                report['browser'] = {'package': lab.CHROME, 'version': report['device']['chrome'],
                                     'flags': lab.SAVED.get('chromeFlags', []),
                                     'commandLine': lab.sh(f'cat {lab.CHROME_FLAGS_FILE}', check=False)}
                report['startTempC'] = lab.cool_down()
                with lab.LocalServer(args.artifact, args.runtime_sha, args.out):
                    with sync_playwright() as pw:
                        dev = lab.Phone(pw)
                        download_session = None
                        try:
                            download_session = dev.browser.new_browser_cdp_session()
                            # connectOverCDP's default allowAndName redirects the
                            # DEVICE browser to a HOST /tmp directory. Restore
                            # Android's real browser DownloadManager, not a mock.
                            download_session.send('Browser.setDownloadBehavior', {'behavior': 'default'})
                            report['downloadBehavior'] = 'Android browser default; Playwright host redirect removed'
                            proof(dev, args, report, owned)
                        finally:
                            try:
                                if chooser_visible():
                                    lab.sh('input keyevent KEYCODE_BACK', check=False)
                                report['audit'] = audit(dev)
                                dev.screenshot(args.out / 'last.png')
                            finally:
                                try:
                                    if download_session:
                                        download_session.send('Browser.setDownloadBehavior', {'behavior': 'default'})
                                        download_session.detach()
                                finally:
                                    dev.close()
                required = ('morph',) if args.video_only else (
                    'nativeShare', 'cancel', 'shareFailureFallback', 'save', 'morph')
                report['status'] = ('fail' if report['warmFace']['status'] == 'fail' else
                    'pass' if all(report.get(key, {}).get('status') == 'pass'
                    for key in required)
                    else 'untested')
            finally:
                names = report.get('taskFilenames', []) + ([report['taskFilename']] if report.get('taskFilename') else [])
                if names:
                    # Also remove a task download produced by a failing cancel
                    # path, or a partial download interrupted before observation.
                    owned.update(path for path in downloads()
                                 if any(Path(path).name.startswith(Path(name).stem) for name in names))
                for path in sorted(owned):
                    lab.sh('rm -f ' + shlex.quote(path), check=False)
                lab.sh(f'am force-stop {lab.CHROME}', check=False)
                lab.session_end()
                lab.camera_off()
                report['cameraAfter'] = lab.camera_status()
                require(not report['cameraAfter']['streaming'] and not report['cameraAfter']['watchdogPid'],
                        'Camera did not remain off')
                lab.STATE.unlink(missing_ok=True)
                lab.SAVED.clear()
                report['cleanup'] = {'phoneSessionRestored': True, 'cameraOff': True,
                                     'taskDownloadsRemoved': sorted(owned),
                                     'taskTabAndForwardClosed': True, 'taskServerStopped': True}
    except BaseException as error:
        report['status'] = 'untested' if isinstance(error, lab.Untested) else 'fail'
        report['error'] = f'{type(error).__name__}: {error}'
        if isinstance(error, SystemExit) and error.code == 75:
            report['status'] = 'untested'
            report['error'] = 'Physical-phone lab lease is busy; no phone proof executed'
        if isinstance(error, KeyboardInterrupt):
            report['error'] = 'Interrupted; incomplete proof'
    finally:
        (args.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'report': str(args.out / 'report.json'),
                          'error': report.get('error')}, indent=2))
    return 0 if report['status'] == 'pass' else 2 if report['status'] == 'untested' else 1


if __name__ == '__main__':
    raise SystemExit(main())

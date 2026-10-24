#!/usr/bin/env python3
"""Crop-confirm loop: expected-to-fail tests on the control artifact (fm-f2rs; fixed by crop.fix fm-6ib8).

Failure analysis at the imported revision (facemorph.me-classic a42829b; apps/web/ holds the same bytes):

  1. Product.fs:522 CropAccept -> cropPhoto(crop.file, cropRect ...) (product-bridge.mjs:539 cropPhotoReported,
     photo/crop.mjs) -> Product.fs:450 Cropped(id, revision, file) -> the eager e4e run for that face.
  2. The run calls runtime.encodePhoto(blob) (browser/runtime.mjs:393), which calls the bridge's alignPhoto
     (product-bridge.mjs:116-117, createPhotoAligner in photo/align-photo.mjs:6) with requireSingleFace: true.
  3. The alignment worker re-detects faces on the already confirmed crop (photo/selection-worker.mjs:65) and throws
     "No face was found. Choose a clear photo containing one face." or "More than one face was found ..." for any
     count other than one (selection-worker.mjs:75); align-photo.mjs:21 also rejects faceCount !== 1, a facePolicy
     other than exactly-one-face-v1, or didAlign false, with MULTIPLE_FACES_MESSAGE (align-photo.mjs:4).
  4. product-bridge.mjs:407 (generate's catch) sets cropFace to the target when the message matches
     /No face was found|More than one face was found/ and the face has a source file.
  5. Product.fs:669-670 Completed with cropFace -> "Crop to a clear face to continue." and RequestCrop: the crop
     dialog opens again on the crop the person just confirmed. No e4e attempt is ever made ('encode-aligned' is
     never posted), so a crop the detector cannot re-find loops for ever.
  Size limits that crop.fix reconciles: alignment refuses blobs over 25 MB (photo/align-photo.mjs:9 and
  browser/runtime.mjs:393), while photo/crop.mjs accepts a compressed source up to 64 MiB.

Intended behaviour (PLAN.md confirmed-crop encoding): a confirmed crop goes straight to e4e without re-detection:
one real e4e attempt ('encode-aligned' posted), and the crop dialog does not reopen.

Cases (each reports intended | documented-failure | other):
  ui-no-face                 built UI: a photo with no face; detection fails, the dialog opens, the person
                             confirms the whole image
  ui-redetection-fails       built UI: one small face in a corner; the person crops the middle half (zoom 2)
  bridge-<fixture>           the bridge's composition (product-bridge.mjs:116-118: createBrowserRuntime with the
                             real createPhotoAligner and selection worker) called with cropPhoto's real output for
                             the confirmed crop of each fixture
tests/known-failing.json says which cases must fail, and for which documented reason, until crop.fix.

Test-build hook (for the ported app, absent from production builds and checked by the build scan):
window.__FACEMORPH_TEST_FAIL_DETECTION__ = true would force the detector to report zero faces. The control has no
such hook, so the cases above use real fixtures instead.

  python3 tests/crop/crop_confirm_loop.py [--runtime .cache/runtime] [--out crop-evidence] [--case ui-no-face ...]
Writes <out>/results.json; exit 0 when every case matches tests/known-failing.json, 1 otherwise.
"""
import argparse, asyncio, json, re, shutil, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / 'scripts/import'))
from control_site import ORIGIN, browser_source, served_control  # noqa: E402

FIXTURES = HERE / 'fixtures'
TEST_HOOK = '__FACEMORPH_TEST_FAIL_DETECTION__'
BRIDGE_CROPS = {
    # fixture: crop area as fractions of the image (left, top, size of the shorter side), what a person confirms
    'no-face.jpg': (0, 0, 1),
    'multi-face.jpg': (0, 0, 1),
    'redetection-fails-on-confirmed-crop.jpg': (0.25, 0.25, 0.5),
    'oriented.jpg': (0, 0, 1),
    'non-square.jpg': (0.25, 0.1, 0.8),
    'malformed.jpg': (0, 0, 1),
}
# Records every message posted to any worker: 'align' is a detection pass, 'encode-aligned' an e4e attempt.
INSTRUMENT = """
window.__cropProbe={align:0,encode:0,messages:[]};
const post=Worker.prototype.postMessage;
Worker.prototype.postMessage=function(m,...rest){const t=m&&m.type;if(t){window.__cropProbe.messages.push(t);
 if(t==='align')window.__cropProbe.align++;if(t==='encode-aligned')window.__cropProbe.encode++;}return post.call(this,m,...rest);};
"""
REDETECTION = r'No face was found|More than one face was found|Choose a clear photo containing exactly one face'
# product-bridge.mjs:407: the messages that turn a failed run into a crop reopen.
BRIDGE_REOPENS = r'No face was found|More than one face was found'


def classify(encode_attempts, reopened, error=''):
    if encode_attempts >= 1 and not reopened:
        return 'intended'
    if encode_attempts == 0 and (reopened or re.search(REDETECTION, error or '')):
        return 'documented-failure'
    return 'other'


async def ui_case(context, name, fixture, zoom, evidence):
    page = await context.new_page()
    await page.add_init_script(INSTRUMENT)
    try:
        await page.goto(ORIGIN + '/', wait_until='load')
        await page.wait_for_function("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'", timeout=60000)
        await page.evaluate("document.querySelector('.next-consent-toast button[aria-label=\"Ask me later\"]')?.click()")
        await page.evaluate("setInterval(()=>document.querySelector('.next-download-dialog .next-download-accept')?.click(),250)")
        # The model-download toast can sit over the crop dialog's buttons (candidate defect 16); accept it whenever it
        # shows, as the download dialog is, and count how often it was in the way.
        await page.evaluate("window.__toastAccepted=0;setInterval(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^download\\b/i.test(x.textContent.trim())"
                            "&&x.closest('[class*=toast]'));if(b){window.__toastAccepted++;b.click();}},250)")
        # Count every time the crop dialog appears.
        await page.evaluate("window.__cropOpens=0;let open=false;new MutationObserver(()=>{const now=!!document.querySelector('.next-crop-view');"
                            "if(now&&!open)window.__cropOpens++;open=now;}).observe(document.body,{subtree:true,childList:true})")
        await page.locator('input[aria-label="Choose photo"]').last.set_input_files(str(FIXTURES / fixture))
        # Either detection fails and the dialog opens itself, or the face encodes and the person opens Crop photo.
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline and not await page.evaluate("!!document.querySelector('.next-crop-view')"):
            # Open Crop photo only once the photo's run has settled with the face encoded and no dialog on its way.
            ready = await page.evaluate("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'"
                                        "&&!document.querySelector('.next-crop-dialog')&&(document.querySelector('.next-status')?.innerText||'')"
                                        ".indexOf('Crop to a clear face')<0")
            button = page.get_by_role('button', name='Crop photo').last
            if ready and await button.count() and await button.is_enabled():
                # The eager run can start a moment after the upload settles: require the same state a second later.
                await page.wait_for_timeout(1000)
                if await button.is_enabled() and not await page.evaluate("!!document.querySelector('.next-crop-dialog')"):
                    try:
                        await button.click(timeout=3000)
                    except Exception:
                        pass  # disabled again by a run that just started; look again
            await page.wait_for_timeout(500)
        await page.wait_for_selector('.next-crop-view img', timeout=30000)
        if zoom != 1:
            await page.evaluate("(z)=>{const s=document.querySelector('.next-crop-zoom input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,String(z));"
                                "s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}", zoom)
        before = await page.evaluate("({opens:window.__cropOpens,encode:window.__cropProbe.encode,align:window.__cropProbe.align})")
        await page.get_by_role('button', name='Use this crop', exact=True).click()
        await page.wait_for_function("!document.querySelector('.next-crop-view')", timeout=30000)
        # Settle: the eager run either encodes or bounces back to the crop dialog.
        settle = time.monotonic() + 300
        while time.monotonic() < settle:
            state = await page.evaluate("({opens:window.__cropOpens,encode:window.__cropProbe.encode,busy:document.querySelector('.next-product')?.getAttribute('data-next-busy')})")
            if state['opens'] > before['opens'] or (state['encode'] > before['encode'] and state['busy'] == 'false'):
                break
            await page.wait_for_timeout(500)
        after = await page.evaluate("({opens:window.__cropOpens,encode:window.__cropProbe.encode,align:window.__cropProbe.align,"
                                    "status:document.querySelector('.next-status')?.innerText||'',error:document.querySelector('.next-error')?.innerText||''})")
        reopened = after['opens'] > before['opens']
        encodes = after['encode'] - before['encode']
        outcome = classify(encodes, reopened)
        if outcome != 'intended':
            await page.screenshot(path=str(evidence / f'{name}.png'), full_page=True)
        toast = await page.evaluate("window.__toastAccepted")
        return {'case': name, 'outcome': outcome, 'fixture': fixture, 'cropReopened': reopened, 'e4eAttemptsAfterConfirm': encodes,
                'downloadToastAccepted': toast, **({'defect16': 'model-download toast shown over the page'} if toast else {}),
                'detectionPassesAfterConfirm': after['align'] - before['align'], 'status': after['status'], 'error': after['error']}
    except Exception as exc:
        await page.screenshot(path=str(evidence / f'{name}.png'), full_page=True)
        return {'case': name, 'outcome': 'other', 'fixture': fixture, 'error': f'{type(exc).__name__}: {exc}'}
    finally:
        await page.close()


BRIDGE = """async ([fixture, area]) => {
  const {createBrowserRuntime} = await import('/src/Next/browser/runtime.mjs');
  const {createPhotoAligner} = await import('/src/Next/photo/align-photo.mjs');
  const {previewPhoto, cropPhoto} = await import('/src/Next/photo/crop.mjs');
  const text = await (await fetch('/runtime/manifest.json')).text();
  const manifest = JSON.parse(text);
  const manifestSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  // As product-bridge.mjs:116-118.
  const photoAligner = createPhotoAligner({manifestUrl: manifest.photo.manifestUrl, workerFactory: () => new Worker(new URL('/src/Next/photo/selection-worker.mjs', location.href), {type: 'module'})});
  const alignPhoto = async (blob, options) => { const prepared = await photoAligner(blob, options); if (prepared.provenance?.preprocessingSha256 !== manifest.alignmentSha256) throw Error('Photo processing files changed.'); return prepared; };
  const runtime = createBrowserRuntime({manifest, manifestSha256, alignPhoto});
  const bytes = await (await fetch('/crop-fixtures/' + fixture)).blob();
  const file = new File([bytes], fixture, {type: 'image/jpeg'});
  let crop;
  try {
    const preview = await previewPhoto(file);
    URL.revokeObjectURL(preview.url);
    const w = preview.previewWidth, h = preview.previewHeight, side = Math.min(w, h);
    crop = await cropPhoto(file, {left: area[0] * w, top: area[1] * h, width: area[2] * side, height: area[2] * side}, {previewScale: preview.scale, rotation: 0});
  } catch (error) { return {stage: 'crop', error: String(error?.message || error)}; }
  const before = window.__cropProbe.encode;
  try { await runtime.encodePhoto(crop, {}); return {stage: 'encoded', encode: window.__cropProbe.encode - before, align: window.__cropProbe.align}; }
  catch (error) { return {stage: 'encode', error: String(error?.message || error), encode: window.__cropProbe.encode - before, align: window.__cropProbe.align}; }
  finally { runtime.dispose?.(); }
}"""


async def bridge_case(context, fixture, evidence):
    name = 'bridge-' + fixture.removesuffix('.jpg')
    page = await context.new_page()
    await page.add_init_script(INSTRUMENT)
    try:
        await page.goto(ORIGIN + '/robots.txt')
        r = await page.evaluate(BRIDGE, [fixture, list(BRIDGE_CROPS[fixture])])
        if r['stage'] == 'crop':
            # A file the cropper refuses never reaches detection: intended is a plain refusal, not a loop.
            outcome = 'intended' if fixture == 'malformed.jpg' else 'other'
            return {'case': name, 'outcome': outcome, 'fixture': fixture, 'refusedAtCrop': r['error']}
        outcome = classify(r.get('encode', 0), False, r.get('error', ''))
        return {'case': name, 'outcome': outcome, 'fixture': fixture, 'e4eAttempts': r.get('encode', 0), 'detectionPasses': r.get('align', 0),
                'error': r.get('error', ''), 'bridgeWouldReopenCrop': bool(re.search(BRIDGE_REOPENS, r.get('error', '')))}
    except Exception as exc:
        return {'case': name, 'outcome': 'other', 'fixture': fixture, 'error': f'{type(exc).__name__}: {exc}'}
    finally:
        await page.close()


async def run_cases(site, cases, evidence):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(site.cdp_url)
        context = browser.contexts[0]
        results = []
        for case in cases:
            if case == 'ui-no-face':
                results.append(await ui_case(context, case, 'no-face.jpg', 1, evidence))
            elif case == 'ui-redetection-fails':
                results.append(await ui_case(context, case, 'redetection-fails-on-confirmed-crop.jpg', 2, evidence))
            elif case.startswith('bridge-'):
                results.append(await bridge_case(context, case.removeprefix('bridge-') + '.jpg', evidence))
            print(json.dumps(results[-1]), flush=True)
        await browser.close()
    return results


def expected_outcomes(registry):
    return {e['case']: e for e in registry['entries']}


def main():
    all_cases = ['ui-no-face', 'ui-redetection-fails'] + ['bridge-' + f.removesuffix('.jpg') for f in BRIDGE_CROPS]
    ap = argparse.ArgumentParser()
    ap.add_argument('--runtime', type=Path, default=REPO / '.cache/runtime')
    ap.add_argument('--out', type=Path, default=REPO / 'crop-evidence')
    ap.add_argument('--chrome', default=shutil.which('google-chrome') or shutil.which('chromium') or 'chromium')
    ap.add_argument('--case', action='append', choices=all_cases)
    a = ap.parse_args()
    evidence = a.out.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    registry = json.loads((REPO / 'tests/known-failing.json').read_text())
    known = expected_outcomes(registry)
    cases = a.case or all_cases
    # The fixtures are served beside the control in the site's copy; the control's own files are unchanged.
    # The bridge cases load source modules in the browser: serve a browser-loadable copy (fm-eulc's TS shims inlined).
    src = browser_source(REPO / 'apps/web/src', Path(tempfile.mkdtemp(prefix='crop-src-')) / 'src')
    with served_control(a.runtime, evidence, a.chrome, extra_trees={'src': src, 'crop-fixtures': FIXTURES}) as site:
        results = asyncio.run(run_cases(site, cases, evidence))
        artifact, runtime = site.artifact, site.runtime
    mismatches = []
    for r in results:
        entry = known.get(r['case'])
        want = 'documented-failure' if entry else 'intended'
        r['expected'] = want
        if entry:
            r['knownFailing'] = {'bead': entry['bead'], 'fixedBy': entry['fixedBy']}
        if r['outcome'] != want:
            mismatches.append(r['case'])
    report = {'bead': 'fm-f2rs', 'artifact': artifact, 'runtime': runtime, 'results': results, 'mismatches': mismatches,
              'passed': not mismatches, 'meaning': 'passed = every case behaves as registered: known-failing cases fail for the documented '
              'reason (crop reopens / redetection, no e4e attempt); all others behave as intended. A known-failing case that '
              'now behaves as intended is a mismatch: remove it from tests/known-failing.json in the fixing bead.'}
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'mismatches': mismatches}))
    sys.exit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()

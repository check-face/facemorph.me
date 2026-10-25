#!/usr/bin/env python3
"""Local exact-artifact harness on the control (fm-5ey).

Serves deploy-next/ (from `npm run build:next`) and the runtime from a verified acquisition
(scripts/runtime/acquire.mjs) under the production origin with classic's qualification server
(apps/web/scripts/next-e2e-server.py), mapped into a headless Chromium, then:

  functional    classic's harness, apps/web/scripts/next-e2e-browser.py, through browser-harness
  network       every browser request (pages and workers) recorded through a Playwright CDP connection
                and classed by host: only the artifact origin may be reached; zero to models.facemorph.me
  cancellation  start a morph, press Cancel, the product returns to idle with no error
  resource      worker targets and JS heap before and after (measured, no threshold yet)

Pinned runtime bytes come only from the acquisition: they are seeded into the server's sha-keyed mirror,
so the server never needs the network for them. Evidence goes to --out (report.json, server/chrome logs,
classic's next-e2e-evidence/, a screenshot and trace on failure).

  python3 scripts/import/control-harness.py --runtime .cache/runtime --out control-harness-evidence \
      [--chrome /usr/bin/chromium] [--until <classic stage>]
Needs: openssl, Chromium/Chrome, and Python with browser-harness==0.1.8 and playwright (Python package; it
attaches to the running Chrome, so no Playwright browser download). Exit 1 if any check fails.
"""
import argparse, asyncio, json, os, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from control_site import ORIGIN_HOST, REPO, host_class, served_control  # noqa: E402


async def network_and_extra_checks(evidence: Path, harness_cmd, harness_env, work: Path, report: dict, cdp_port: int):
    from playwright.async_api import async_playwright
    requests = []
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{cdp_port}')
        context = browser.contexts[0]

        def on_request(req):
            requests.append({'url': req.url, 'class': host_class(req.url), 'resource': req.resource_type})

        async def on_finished(req):
            try:
                sizes = await req.sizes()
                for r in reversed(requests):
                    if r['url'] == req.url and 'bytes' not in r:
                        r['bytes'] = sizes['responseBodySize'] + sizes['responseHeadersSize']
                        break
            except Exception:
                pass

        context.on('request', on_request)
        context.on('requestfinished', lambda req: asyncio.ensure_future(on_finished(req)))
        await context.tracing.start(screenshots=True, snapshots=False)

        # Functional: classic's harness, unchanged, driving the same Chrome.
        started = time.monotonic()
        proc = await asyncio.create_subprocess_exec(*harness_cmd, stdin=open(REPO / 'apps/web/scripts/next-e2e-browser.py', 'rb'),
                                                    stdout=open(evidence / 'harness.log', 'wb'), stderr=subprocess.STDOUT, cwd=work, env=harness_env)
        code = await proc.wait()
        classic = work / 'next-e2e-evidence/report.json'
        classic_report = json.loads(classic.read_text()) if classic.exists() else {}
        report['functional'] = {'exit': code, 'seconds': round(time.monotonic() - started), 'passed': code == 0 and classic_report.get('passed') is True,
                                'partial': classic_report.get('partial', False), 'skipped': classic_report.get('skipped', []),
                                # A check the product skips (project save/reopen while its controls are hidden) is not a pass.
                                'checks': {k: (v.get('passed') if v.get('passed') is not None else 'skipped') for k, v in classic_report.get('checks', {}).items()},
                                'stageError': classic_report.get('stageError'), 'engine': classic_report.get('engine'), 'runtimeSha256': classic_report.get('runtimeSha256')}

        # Cancellation and resource, on a fresh page in the same profile (its faces are cached by now).
        page = await context.new_page()
        cdp = await context.new_cdp_session(page)
        try:
            await page.goto(f'https://{ORIGIN_HOST}/', wait_until='load')
            await page.wait_for_function("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'", timeout=60000)
            await page.evaluate("document.querySelector('.next-consent-toast button[aria-label=\"Ask me later\"]')?.click()")
            await page.evaluate("setInterval(()=>document.querySelector('.next-download-dialog .next-download-accept')?.click(),250)")

            async def workers():
                return len([t for t in (await cdp.send('Target.getTargets'))['targetInfos'] if t['type'] in ('worker', 'shared_worker', 'service_worker')])

            async def heap():
                metrics = {m['name']: m['value'] for m in (await cdp.send('Performance.getMetrics'))['metrics']}
                return metrics.get('JSHeapUsedSize')

            await cdp.send('Performance.enable')
            before = {'workers': await workers(), 'jsHeapUsedBytes': await heap()}
            # Two faces are needed for a morph; generate any that are missing.
            for label in await page.evaluate("[...document.querySelectorAll('.next-face-generate')].filter(b=>!b.disabled).map(b=>b.getAttribute('aria-label'))"):
                await page.get_by_role('button', name=label, exact=True).click()
                await page.wait_for_function("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'", timeout=600000)
            morph = page.get_by_role('button', name='Create morph', exact=True)
            await morph.wait_for(state='visible', timeout=60000)
            await page.wait_for_function("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Create morph');return b&&!b.disabled})()", timeout=300000)
            await morph.click()
            await page.wait_for_function("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='true'", timeout=60000)
            during = {'workers': await workers(), 'jsHeapUsedBytes': await heap()}
            cancel_at = time.monotonic()
            await page.get_by_role('button', name='Cancel', exact=True).first.click()
            await page.wait_for_function("document.querySelector('.next-product')?.getAttribute('data-next-busy')==='false'", timeout=120000)
            idle_ms = round((time.monotonic() - cancel_at) * 1000)
            error = await page.evaluate("document.querySelector('.next-error')?.innerText||''")
            video = await page.evaluate("!!document.querySelector('.next-video-slot video')")
            await page.wait_for_timeout(3000)
            after = {'workers': await workers(), 'jsHeapUsedBytes': await heap()}
            report['cancellation'] = {'passed': not error, 'cancelToIdleMs': idle_ms, 'error': error, 'videoAfterCancel': video,
                                      'note': 'a video may be present from the functional run; the check is a clean return to idle with no error'}
            report['resource'] = {'status': 'measured, no threshold', 'before': before, 'duringMorph': during, 'afterCancel': after}
        except Exception as exc:
            report['cancellation'] = {'passed': False, 'error': f'{type(exc).__name__}: {exc}'}
            await page.screenshot(path=str(evidence / 'cancellation-failure.png'), full_page=True)
        failed = not report['functional']['passed'] or not report['cancellation'].get('passed')
        await context.tracing.stop(path=str(evidence / 'trace.zip') if failed else None)
        await browser.close()
    by_class = {}
    for r in requests:
        c = by_class.setdefault(r['class'], {'requests': 0, 'bytes': 0, 'hosts': set()})
        c['requests'] += 1
        c['bytes'] += max(0, r.get('bytes', 0))
        c['hosts'].add(urlsplit(r['url']).hostname or urlsplit(r['url']).scheme)
    report['network'] = {cls: {**v, 'hosts': sorted(v['hosts'])} for cls, v in by_class.items()}
    # The bead's claim: zero requests to models.facemorph.me. Third-party requests (the control's analytics) are
    # reported as their own class; they were attempted but never resolved (see the resolver rules).
    mirror = by_class.get('runtime-mirror (models.facemorph.me)', {}).get('requests', 0)
    report['network']['passed'] = mirror == 0 and by_class.get('artifact-origin', {}).get('requests', 0) > 0
    (evidence / 'requests.json').write_text(json.dumps(requests, indent=1) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runtime', type=Path, default=REPO / '.cache/runtime')
    ap.add_argument('--out', type=Path, default=REPO / 'control-harness-evidence')
    ap.add_argument('--chrome', default=shutil.which('google-chrome') or shutil.which('chromium') or 'chromium')
    ap.add_argument('--harness', default=shutil.which('browser-harness') or str(Path(sys.executable).parent / 'browser-harness'))
    ap.add_argument('--until', default='', help="classic harness E2E_UNTIL stage (a partial run never passes)")
    a = ap.parse_args()
    evidence = a.out.resolve()
    report = {'bead': 'fm-5ey', 'scope': 'identified exact artifact on the CPU route in headless Chromium on this machine'}
    try:
        with served_control(a.runtime, evidence, a.chrome) as site:
            report.update(artifact=site.artifact, runtime=site.runtime, browser=site.browser)
            env = {**os.environ, 'BU_NAME': site.daemon_name, 'BU_CDP_URL': site.cdp_url, 'RUNTIME_SHA': site.runtime['manifestSha256'],
                   **({'E2E_UNTIL': a.until} if a.until else {})}
            asyncio.run(network_and_extra_checks(evidence, [a.harness], env, site.work, report, site.cdp_port))
            if (site.work / 'next-e2e-evidence').exists():
                shutil.copytree(site.work / 'next-e2e-evidence', evidence / 'next-e2e-evidence', dirs_exist_ok=True)
    except RuntimeError as error:
        report.update(passed=False, error=str(error))
        (evidence / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        sys.exit(str(error))
    # Known candidate defects (PLAN.md "Known candidate defects", 18 October) are reported against their numbers and
    # are not import regressions.
    known = []
    if report.get('network', {}).get('other', {}).get('requests'):
        known.append({'defect': 11, 'what': 'third-party requests (analytics) from the control', 'hosts': report['network']['other']['hosts']})
    if 'silently fell back to mapping' in str(report.get('functional', {}).get('stageError')):
        known.append({'defect': 'names: generateNameOrSeed silent fallback (PLAN.md names selection gap)', 'what': report['functional']['stageError']})
    report['knownDefects'] = known
    report['passed'] = bool(report.get('functional', {}).get('passed') and report.get('cancellation', {}).get('passed') and report.get('network', {}).get('passed'))
    (evidence / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report.get(k) for k in ['passed', 'artifact', 'runtime', 'functional', 'cancellation', 'resource', 'network', 'knownDefects']}, indent=1))
    sys.exit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()

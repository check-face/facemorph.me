#!/usr/bin/env python3
"""Paired not-worse runs on the hosted mobile lanes (fm-0q4h): Chrome in the Android emulator and Safari in the
iOS Simulator, in ABBA order with a discarded warmup.

    python3 scripts/verify/not-worse/mobile.py android --control DIR [--build DIR] --pairs 5 \\
        --runtime-sha SHA --out DIR --label LABEL
    python3 scripts/verify/not-worse/mobile.py ios --device 'iPhone 16 Pro' --control DIR ...

Each scheduled run is one execution of the hosted lane's own journeys (tools/device-lab/hosted.py: cold face, warm
face, morph to a playable video, the device lab's real-pointer checks; no second adb/Chrome loop) against the side's
artifact, with the same served-runtime mechanism that lane uses (the published runtime, verified against the pinned
manifest digest; nothing here accepts model terms). Its journey report becomes one run.schema.json document; the
schedule (abbaSchedule) and the artifact digests come from the desktop runner's own modules, and the summary with
the per-measure noise margin from summary.mjs. Without --build both sides are the control (control/control noise).

What the hosted journeys measure: usablePageMs (navigation to the app mounted), coldFaceMs, warmFaceMs,
morphPlayableMs (Create morph to a playable video) and morphPerFrameMs. nextFaceMs, photoEncodeMs and Save are not in
the hosted journeys and are null; lockups and bytes are not observed there (lockups is recorded 0 with the field
named in the trace's `unmeasured`), peak memory is `unreported`. Reliability: face and video produced, page crash
(Android), uncaught page errors as the lane captured them.
"""
import argparse, json, os, platform, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/device-lab'))
import hosted  # noqa: E402

LANES = {'android': ('android-emulator-chrome', 'chrome-android'), 'ios': ('ios-simulator-safari', 'safari')}
MORPH_FRAMES = 32  # the candidate's default morph length, as run.ts
UNMEASURED = ['nextFaceMs', 'photoEncodeMs', 'firstSaveMs', 'repeatSaveMs', 'lockups', 'bytes', 'peakMemory']


def node_json(code):
    """Runs an ES module snippet from the repository root and returns its printed JSON."""
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, timeout=300)
    if out.returncode:
        raise RuntimeError(out.stderr[-2000:])
    return json.loads(out.stdout.strip().splitlines()[-1])


def schedule(pairs):
    return node_json(f"import {{ abbaSchedule }} from './scripts/verify/not-worse/workload.ts';"
                     f"console.log(JSON.stringify(abbaSchedule({int(pairs)})))")


def digest(path):
    return node_json("import { artifactDigest } from './autoresearch/drivers/lib/artifact.mjs';"
                     f"console.log(JSON.stringify(artifactDigest({json.dumps(str(path))})))")['treeSha256']


def ms(record, key, field):
    v = record.get(key)
    return round(v[field] * 1000, 1) if isinstance(v, dict) and isinstance(v.get(field), (int, float)) else None


def run_document(report, run, cell, digests):
    """Pure: one hosted lane report (one journey iteration) to a run.schema.json document."""
    rec = (report.get('runs') or [{}])[-1]
    morph = ms(rec, 'morph', 'videoS')
    values = {
        'usablePageMs': ms(rec, 'cold', 'usableS'),
        'coldFaceMs': ms(rec, 'cold', 'faceS'),
        'warmFaceMs': ms(rec, 'warm', 'faceS'),
        'nextFaceMs': None,
        'photoEncodeMs': None,
        'morphPlayableMs': morph,
        'morphPerFrameMs': None if morph is None else round(morph / MORPH_FRAMES, 3),
        'firstSaveMs': None,
        'repeatSaveMs': None,
    }
    error = str(rec.get('error') or '')
    return {
        'schema': 'facemorph.not-worse-run/1',
        'cell': cell,
        'digests': digests,
        'runs': [{
            'index': run['index'], 'side': run['side'], 'pair': run['pair'], 'order': run['order'],
            'measures': {'values': values, 'lockups': 0, 'bytes': {'first': None, 'return': None},
                         'peakMemory': 'unreported'},
            'reliability': {
                'faceProduced': isinstance(rec.get('cold'), dict) or isinstance(rec.get('warm'), dict),
                'photoFaceProduced': False,
                'videoProduced': isinstance(rec.get('morph'), dict),
                'crash': bool(rec.get('crashed')) or 'PageCrashed' in error or 'Target crashed' in error,
                'reloads': 0,
                'outOfMemory': bool(re.search(r'out of memory', error, re.I)),
                'fallback': False,  # the mobile lanes request no route ('auto'); the app's own choice is recorded
                'uncaughtErrors': len(report.get('browserErrors') or []),
            },
        }],
    }


def browser_version(user_agent):
    m = re.search(r'(?:Chrome|CriOS)/([\d.]+)', user_agent or '') or re.search(r'Version/([\d.]+).*Safari', user_agent or '')
    return m.group(1) if m else 'unknown'


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('platform', choices=sorted(LANES))
    p.add_argument('--control', required=True, type=Path)
    p.add_argument('--build', type=Path)
    p.add_argument('--pairs', type=int, default=5)
    p.add_argument('--runtime-sha', required=True)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--label', required=True)
    p.add_argument('--device', default='iPhone 16 Pro')
    p.add_argument('--device-label', help='the cell device name in run documents (default: the lane and --device)')
    p.add_argument('--port', type=int, default=8791)
    p.add_argument('--timeout', type=int, default=3600, help='iOS: seconds one run may take')
    a = p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', a.label):
        raise SystemExit('label is [A-Za-z0-9_-]{1,80}')
    out = a.out / a.label
    out.mkdir(parents=True, exist_ok=False)  # labels are never overwritten
    lane, browser = LANES[a.platform]
    control = {'dir': a.control.resolve(), 'digest': digest(a.control)}
    build = {'dir': a.build.resolve(), 'digest': digest(a.build)} if a.build else control
    digests = {'control': control['digest'], 'build': build['digest']}
    cache = out / 'runtime-cache'
    cache.mkdir()
    cell_name = f'{lane}-auto'
    cell = {'device': a.device_label or (a.device if a.platform == 'ios' else 'android-emulator'),
            'os': f'{platform.system()} {platform.release()} host', 'browser': browser,
            'browserVersion': 'unknown', 'provider': 'auto', 'cacheState': 'cold'}
    failures = 0
    for run in schedule(a.pairs):
        side = control if run['side'] == 'control' else build
        rid = f"{run['index']:02d}-{run['side']}-{run['order']}" + ('' if run['pair'] is None else f"-p{run['pair']}")
        rdir = out / rid
        rdir.mkdir()
        (rdir / 'runtime-cache').symlink_to(cache.resolve())
        print(json.dumps({'cell': cell_name, 'run': rid, 'side': run['side'], 'digest': side['digest'],
                          'pair': run['pair'], 'order': run['order'], 'load': os.getloadavg()[0]}), flush=True)
        args = argparse.Namespace(lane=lane, artifact=str(side['dir']), runtime_sha=a.runtime_sha, out=str(rdir),
                                  port=a.port, journey='cold-face,warm-face,morph', repeat=1, device=a.device,
                                  timeout=a.timeout, journey_stages=['cold', 'warm', 'morph'])
        started, failure = time.time(), None
        try:
            (hosted.cmd_android if a.platform == 'android' else hosted.cmd_ios)(args)
        except BaseException as e:  # noqa: BLE001  a lane that dies is a failed run, recorded, not a lost schedule
            if isinstance(e, KeyboardInterrupt):
                raise
            failure = f'{type(e).__name__}: {e}'[:400]
        report_path = rdir / f'{lane}.json'
        report = json.loads(report_path.read_text()) if report_path.exists() else {'runs': [{'ok': False, 'error': failure}]}
        if report.get('status') == 'untested' and not report.get('runs'):
            (out / 'untested.json').write_text(json.dumps({'cell': cell_name, 'status': 'untested',
                                                           'reason': report.get('reason')}, indent=2) + '\n')
            print(json.dumps({'summary': {'cell': cell_name, 'untested': report.get('reason'), 'out': str(out)}}))
            return 0
        rec = (report.get('runs') or [{}])[-1]
        failure = failure or (None if rec.get('ok') else (rec.get('error') or 'journey not ok'))
        if cell['browserVersion'] == 'unknown':
            cell['browserVersion'] = browser_version(report.get('userAgent'))
        doc = run_document(report, run, dict(cell), digests)
        (out / f'{rid}.json').write_text(json.dumps(doc, indent=2) + '\n')
        (out / f'{rid}.trace.json').write_text(json.dumps({
            'lane': lane, 'artifact': str(side['dir']), 'digest': side['digest'], 'elapsedMs': round((time.time() - started) * 1000),
            'failure': failure, 'userAgent': report.get('userAgent'), 'journeys': rec, 'unmeasured': UNMEASURED,
            'browserErrors': report.get('browserErrors'), 'progress': report.get('progress')}, indent=2) + '\n')
        failures += bool(failure)
        print(json.dumps({'cell': cell_name, 'run': rid, 'done': True, 'failure': failure,
                          'values': doc['runs'][0]['measures']['values'],
                          'reliability': doc['runs'][0]['reliability']}), flush=True)
    # The summary (medians, raw pairs, ratio spread, control/control noise margin per measure): summary.mjs.
    extra = json.dumps({'cell': cell_name, 'pairs': a.pairs, 'unmeasured': UNMEASURED})
    subprocess.run(['node', str(ROOT / 'scripts/verify/not-worse/summary.mjs'), str(out), '--extra', extra], check=True)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())

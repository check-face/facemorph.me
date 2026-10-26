#!/usr/bin/env python3
"""fm-g019: pair the built checker with completed single-face CPU synthesis.

Uses the exact verified artifact, real input and passive worker timing messages. No
whole-job timing is labelled inference; other workloads remain uncalibrated.
"""
import argparse, datetime, json, os, platform, socket, time
from pathlib import Path

import lab
from hosted import ArtifactServer, lane_report

OBSERVE = r"""
(() => {
  window.__calibration = {initializations: [], synthesis: []};
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(message, ...rest) {
      if(message?.type === 'initialize') {
        const m = message.manifest;
        window.__calibration.initializations.push({provider: message.provider,
          manifestSha256: message.manifestSha256, modelSourceSha256: m?.modelSourceSha256,
          synthesisSha256: m?.synthesis?.sha256});
      }
      return super.postMessage(message, ...rest);
    }
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({data}) => {
        if(data?.type === 'progress' && data.stage === 'synthesis-complete')
          window.__calibration.synthesis.push({id:data.id, elapsedMs:data.elapsedMs});
      });
    }
  };
})();
"""


def collect(args):
    from playwright.sync_api import sync_playwright
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    result = {'schema': 1, 'purpose': 'checker-calibration', 'provider': 'cpu',
              'platformEvidence': 'physical-desktop', 'samples': []}
    # Serialize actual desktop lab sessions; ordinary CI takes no lab lock.
    with lab.lab_lock(['eris-cpu']), ArtifactServer(args.artifact, args.runtime_sha, args.port, out / 'runtime-cache') as server:
        result['artifact'] = lane_report('calibration', 'desktop', server.url, {}, args.artifact, args.runtime_sha)['artifact']
        result['runtimeSha256'] = args.runtime_sha
        with sync_playwright() as pw:
            dev = lab.Desktop(pw, False, False, out / 'profile', family=args.browser)
            try:
                dev.page.add_init_script(OBSERVE)
                result['device'] = {'hostname': socket.gethostname(), 'os': platform.platform(),
                                    'cpu': Path('/proc/cpuinfo').read_text().split('model name\t: ')[-1].split('\n')[0]}
                result['browser'] = dev.identity
                for i in range(args.training + args.held_out):
                    check = dev.ctx.new_page()
                    try:
                        check.goto(server.url + 'preflight-check.html')
                        check.bring_to_front()
                        check.wait_for_function('!!window.preflight')
                        checker = check.evaluate('window.preflight.checkDevice({rerun:true})')
                        facts = check.evaluate('({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated})')
                    finally:
                        check.close()
                    cpu = checker['evidence']['cpuSample']
                    if checker['outcome'] != 'ok' or cpu['state'] != 'known' or checker['resourcesRemaining']:
                        raise RuntimeError('checker did not complete cleanly: ' + json.dumps(checker))
                    dev.page.bring_to_front()
                    word = f'calibration-{args.browser}-{i}-{time.time_ns()}'
                    face = lab.journey_face(dev, server.url, i == 0, word, False)
                    observed = dev.js('window.__calibration')
                    initialization = observed['initializations'][-1]
                    if initialization['provider'] != 'wasm' or initialization['manifestSha256'] != args.runtime_sha:
                        raise RuntimeError('unexpected inference provider/runtime: ' + json.dumps(initialization))
                    resolution = dev.js('(selector)=>[...document.querySelectorAll(selector)].map(image=>image.naturalWidth||image.width).find(width=>width===1024)||0', lab.S['faceImage'])
                    if resolution != 1024:
                        raise RuntimeError('expected an actual full1024 output, got ' + str(resolution))
                    duration = observed['synthesis'][-1]['elapsedMs']
                    if not duration > 0:
                        raise RuntimeError('missing completed synthesis measurement')
                    sample = {'id': f'{args.browser}-{i}', 'partition': 'training' if i < args.training else 'held-out',
                              'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                              'scope': {'checkpoint': initialization['modelSourceSha256'], 'resolution': resolution,
                                        'provider': 'cpu', 'runtime': args.runtime_sha,
                                        'threadMode': 'multi' if facts['crossOriginIsolated'] and facts['hardwareConcurrency'] >= 2 else 'single',
                                        'workload': 'single-face-original-noise'},
                              'stage': 'synthesis-per-output', 'checker': checker, 'facts': facts,
                              'workerInitialization': initialization, 'workerSynthesis': observed['synthesis'],
                              'durationMs': duration, 'journey': face, 'loadAverage': os.getloadavg()}
                    result['samples'].append(sample)
                    (out / 'measurements.json').write_text(json.dumps(result, indent=2) + '\n')
                    print(json.dumps({'sample': sample['id'], 'partition': sample['partition'], 'durationMs': duration,
                                      'checkerUnitMs': cpu['value']['completionMs'] / cpu['value']['samples']}), flush=True)
            finally:
                dev.close()
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--artifact', required=True)
    p.add_argument('--runtime-sha', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--browser', choices=['chrome', 'firefox'], default='chrome')
    p.add_argument('--training', type=int, default=3)
    p.add_argument('--held-out', type=int, default=2)
    p.add_argument('--port', type=int, default=8798)
    args = p.parse_args()
    if args.training < 3 or args.held_out < 2:
        p.error('at least three training and two held-out runs required')
    collect(args)

"""Real mobile browser component checks. No model inference or handset qualification."""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {'worker-module-hash', 'integrity-rejection', 'cancel-partial-retry',
            'concurrent-download-dedup', 'corrupt-cache-repair',
            'png-1024-roundtrip', 'reload-retained-offline'}


def assess(report, run_id):
    if not isinstance(report, dict):
        return False
    rows = report.get('results', [])
    return (report.get('runId') == run_id and report.get('completed') is True
            and not report.get('error') and report.get('secureContext') is True
            and report.get('inferenceExecuted') is False and report.get('e4eExecuted') is False
            and report.get('evidenceLevel') == 'browser-component'
            and isinstance(rows, list) and len(rows) == len(EXPECTED)
            and all(isinstance(row, dict) and row.get('passed') is True for row in rows)
            and {row.get('id') for row in rows} == EXPECTED)


def command(*args, check=True, timeout=90):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout).stdout.strip()


def open_safari(udid, url):
    # Fresh Simulator SpringBoard can report launch failure before Safari becomes
    # usable. Record it; only the subsequent browser report may establish success.
    try:
        result = subprocess.run(['xcrun', 'simctl', 'openurl', udid, url],
                                capture_output=True, text=True, timeout=90)
        return {'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
    except subprocess.TimeoutExpired:
        return {'timedOut': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', required=True, choices=['android', 'ios'])
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--output', type=Path, default=ROOT/'mobile-evidence')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    evidence = {'runId': run_id, 'executionEnvironment': 'android-emulator' if args.platform == 'android' else 'ios-simulator',
                'physicalDeviceQualified': False, 'inferenceQualified': False, 'photoWorkflowQualified': False,
                'sourceCommit': command('git', '-C', str(ROOT), 'rev-parse', 'HEAD'),
                'sourceSha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for folder in ['tests/mobile', 'src/Next/Assets']
                                 for p in (ROOT/folder).glob('*') if p.suffix in ['.py', '.mjs', '.html']},
                'runnerImage': os.environ.get('ImageVersion'), 'completed': False}
    state = {'report': None}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            super().end_headers()

        def do_GET(self):
            # Serve only test/component sources, never arbitrary checkout files.
            path = (ROOT/urlsplit(self.path).path.lstrip('/')).resolve()
            allowed = any(path.is_relative_to(ROOT/folder) for folder in ['tests/mobile', 'src/Next/Assets'])
            if not allowed or not path.is_file() or path.suffix not in ['.html', '.mjs']:
                self.send_error(404)
                return
            super().do_GET()

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if self.path != '/report' or not 0 < size <= 1024*1024:
                    raise ValueError('Invalid request')
                report = json.loads(self.rfile.read(size))
                if not isinstance(report, dict) or report.get('runId') != run_id:
                    raise ValueError('Wrong run')
                state['report'] = report
                (args.output/'browser.json').write_text(json.dumps(report, indent=2))
                self.send_response(204)
                self.end_headers()
            except (ValueError, TypeError):
                self.send_error(400)

    server = ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    udid = None
    url = f'http://127.0.0.1:8765/tests/mobile/index.html?run={run_id}'
    try:
        if args.platform == 'android':
            evidence['device'] = command('adb', 'shell', 'getprop')
            evidence['browser'] = command('adb', 'shell', 'dumpsys', 'package', 'com.android.chrome')
            command('adb', 'reverse', 'tcp:8765', 'tcp:8765')
            command('adb', 'shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome')
            command('adb', 'shell', "echo 'chrome --no-first-run --disable-fre --no-default-browser-check' > /data/local/tmp/chrome-command-line")
            command('adb', 'shell', 'am', 'force-stop', 'com.android.chrome')
            command('adb', 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, 'com.android.chrome')
        else:
            evidence['xcode'] = command('xcodebuild', '-version')
            devices = json.loads(command('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
            options = [(runtime, device) for runtime, group in devices.items() for device in group
                       if '.iOS-' in runtime and device['name'].startswith('iPhone') and device.get('isAvailable')]
            if not options:
                raise RuntimeError('No installed iPhone Simulator; no silent skip')
            runtime, device = sorted(options, key=lambda item: (item[0], 'SE' not in item[1]['name'], item[1]['name']))[-1]
            # Use a newly created simulator; leave any existing user/CI device alone.
            udid = command('xcrun', 'simctl', 'create', 'FaceMorph-CI-'+run_id,
                           device['deviceTypeIdentifier'], runtime)
            evidence['device'] = {'udid': udid, 'runtime': runtime, 'profile': device['name']}
            command('xcrun', 'simctl', 'boot', udid)
            command('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=180)
            evidence['launchAttempts'] = [open_safari(udid, url)]
        deadline = time.monotonic()+args.timeout
        retry_at = time.monotonic()+30
        while time.monotonic() < deadline:
            report = state['report']
            if report and (report.get('completed') is True or report.get('error')):
                break
            if udid and report is None and time.monotonic() >= retry_at and len(evidence['launchAttempts']) == 1:
                evidence['launchAttempts'].append(open_safari(udid, url))
            time.sleep(0.5)
        evidence['passed'] = assess(state['report'], run_id)
        evidence['completed'] = bool(state['report'] and state['report'].get('completed'))
        if not evidence['passed']:
            raise RuntimeError('Mobile browser failed, reset, or timed out; inspect browser.json and screenshot')
    except Exception as error:
        evidence['error'] = str(error)
        raise
    finally:
        try:
            if args.platform == 'android':
                with (args.output/'screen.png').open('wb') as f:
                    subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=f, timeout=20)
                (args.output/'logcat.txt').write_text(command('adb', 'logcat', '-d', '-t', '1000', check=False))
                command('adb', 'reverse', '--remove', 'tcp:8765', check=False)
            elif udid:
                command('xcrun', 'simctl', 'io', udid, 'screenshot', str(args.output/'screen.png'), check=False)
        except Exception as error:
            evidence['diagnosticError'] = str(error)
        finally:
            if udid:
                command('xcrun', 'simctl', 'shutdown', udid, check=False)
                command('xcrun', 'simctl', 'delete', udid, check=False)
            server.shutdown()
            (args.output/'host.json').write_text(json.dumps(evidence, indent=2))
            print(json.dumps({k: evidence.get(k) for k in ['runId', 'executionEnvironment', 'passed', 'error']}))


if __name__ == '__main__':
    main()

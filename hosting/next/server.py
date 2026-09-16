"""Private preview origin: static assets and bounded, opt-in diagnostic events."""
import datetime as dt
import functools
import http.server
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import unquote, urlsplit

ROOT = Path(os.environ.get('ASSET_ROOT', '/assets')).resolve()
REPORTS = Path(os.environ.get('REPORT_ROOT', '/reports')).resolve()
ORIGINS = set(os.environ.get('PUBLIC_ORIGINS', 'https://next.facemorph.me').split(','))
STAGES = set('asset-acquisition runtime-loading model-loading model-loaded mapping-loading mapping canary synthesis synthesis-complete alignment alignment-complete encoder-loading encoder-loaded encoding encoding-complete mapping-complete original-cache-hit original-cached cache-unavailable codec-loading face morph export route-admitted'.split())
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
LOCK = threading.Lock()
LIMIT = 20 * 1024 * 1024  # Daily bound, no paid storage growth.

def checked_event(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('schema')
    # gpu and routeOutcome say why a device ended up on the path it did: whether the browser
    # offered WebGPU at all, and whether a route was admitted, refused or never attempted.
    allowed = {'schemaVersion','session','run','event','action','platform','language','build','stage','elapsedMs','stageMs','errorCode','browser','provider','device','browserMajor','bundle','gpu','routeOutcome'}
    if value.keys() - allowed:
        raise ValueError('fields')
    for field in ('session','run') + (('device',) if 'device' in value else ()):
        if not isinstance(value.get(field), str) or not UUID.fullmatch(value[field]):
            raise ValueError('identity')
    if value.get('event') not in ('start','stage','completed','cancelled','failed'):
        raise ValueError('event')
    if 'stage' in value and value['stage'] not in STAGES:
        raise ValueError('stage')
    if 'gpu' in value and value['gpu'] not in ('webgpu','webgl-only','none'):
        raise ValueError('gpu')
    if 'routeOutcome' in value and value['routeOutcome'] not in ('admitted','canary-failed','unsupported','start-failed','superseded'):
        raise ValueError('routeOutcome')
    for field in ('elapsedMs','stageMs'):
        if field in value and (type(value[field]) is not int or not 0 <= value[field] <= 86400000):
            raise ValueError('timing')
    if 'browserMajor' in value and (type(value['browserMajor']) is not int or not 1 <= value['browserMajor'] <= 9999):raise ValueError('browserMajor')
    enums = {'action': {'faces','morph','project'}, 'errorCode': {'cancelled','operation_failed'},
             'platform': {'ios','android','macos','windows','linux','other'},
             'browser': {'safari','chromium','firefox','other'}, 'provider': {'cpu','webgl','webgpu','native-cpu','native-gpu','auto'}}
    for field, options in enums.items():
        if field in value and value[field] not in options:
            raise ValueError(field)
    if 'language' in value and (not isinstance(value['language'], str) or not re.fullmatch(r'[A-Za-z-]{2,20}', value['language'])):
        raise ValueError('language')
    if 'build' in value and (not isinstance(value['build'],str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', value['build'])):
        raise ValueError('build')
    return value

def purge(now=None):
    REPORTS.mkdir(parents=True, exist_ok=True)
    cutoff = (now or time.time()) - 30*86400
    for item in REPORTS.glob('*.jsonl'):
        if item.stat().st_mtime < cutoff:
            item.unlink()

def housekeeping():
    while True:
        with LOCK:
            purge()
        time.sleep(3600)

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs':'text/javascript', '.wasm':'application/wasm'}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass  # Never retain IP addresses, request URLs or raw user agent strings.

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        self.send_header('Cross-Origin-Resource-Policy','cross-origin' if self.path.startswith('/runtime/') else 'same-origin')
        if self.path.startswith('/runtime/'):
            self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','public, max-age=31536000, immutable' if self.path.startswith('/runtime/assets/') else 'no-cache')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        parts = Path(path).parts
        target = (ROOT/path.lstrip('/')).resolve()
        if any(p.startswith('.') or p.endswith('.private.json') for p in parts) or (target != ROOT and ROOT not in target.parents):
            self.send_error(404)
            return None
        if path.startswith('/diagnostics/'):
            self.send_error(404)
            return None
        if target.is_file() and path.startswith('/runtime/'):
            size = target.stat().st_size
            self._remaining = size
            start, end = 0, size-1
            requested = self.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
                if not match:
                    self.send_error(416)
                    return None
                start = int(match[1]);end = min(int(match[2]),size-1) if match[2] else size-1
                if start > end or start >= size:
                    self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers()
                    return None
            file = target.open('rb');file.seek(start)
            self._remaining = end-start+1
            self.send_response(206 if requested else 200)
            self.send_header('Content-Type',self.guess_type(str(target)))
            self.send_header('Content-Length',str(self._remaining))
            self.send_header('Accept-Ranges','bytes')
            if requested:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.end_headers()
            return file
        return super().send_head()

    def copyfile(self, source, outputfile):
        remaining = getattr(self, '_remaining', None)
        if remaining is None:
            return super().copyfile(source,outputfile)
        while remaining:
            block = source.read(min(1024*1024,remaining))
            if not block:break
            outputfile.write(block);remaining -= len(block)

    def do_POST(self):
        if self.path != '/diagnostics/events':
            self.send_error(404)
            return
        if self.headers.get('Origin') not in ORIGINS or self.headers.get('Content-Type','').split(';')[0] != 'application/json':
            self.send_error(403)
            return
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 1 <= size <= 2048:
                raise ValueError('size')
            self.connection.settimeout(10)
            value = checked_event(json.loads(self.rfile.read(size)))
        except (ValueError, OSError, TypeError):
            self.send_error(400)
            return
        value['receivedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        encoded = (json.dumps(value, separators=(',',':'))+'\n').encode()
        with LOCK:
            purge()
            destination = REPORTS / (dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')+'.jsonl')
            if (destination.stat().st_size if destination.exists() else 0) + len(encoded) > LIMIT:
                self.send_error(429)
                return
            with destination.open('ab') as file:
                file.write(encoded)
        self.send_response(204)
        self.send_header('Content-Length','0')
        self.end_headers()

if __name__ == '__main__':
    threading.Thread(target=housekeeping, daemon=True).start()
    http.server.ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()

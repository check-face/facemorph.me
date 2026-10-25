"""Request-interception helper over CDP, for browser-harness 0.1.8 scripts (fm-o8xn).

The record format and the primitives requestsIn, assertNoRequests, assertOrder and bytesBy mirror record.ts exactly
(same names, same JSON fields, same verdicts on vectors.json). attach_cdp(cdp, drain_events) enables Network, Runtime
and Log on the page session and auto-attaches service workers (and dedicated workers, where the browser reports them
as targets), then collect() folds the drained CDP events into the record: requests with initiator, status, failure,
response body bytes (Content-Length, else the data the browser received) and from_cache; console errors from
Runtime.consoleAPICalled and Log.entryAdded. Inside a browser-harness script:

    import sys; sys.path.insert(0, '<repo>/scripts/ci/intercept'); import intercept
    att = intercept.attach_cdp(cdp, drain_events, host_map)
    intercept.step(att.rec, 'load')
    js(f'setTimeout(() => location.assign({json.dumps(url)}), 0); 0')
    # Poll browser-level current_tab() metadata while calling att.collect().
    # Blocking Page.navigate/Runtime.evaluate may wait on paused worker targets.
    ...; att.collect()
    intercept.assertNoRequests(att.rec, 'model-host', {'toStep': 'load'})
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
DEFAULT_HOST_MAP = json.loads((HERE / 'host-classes.json').read_text())


def LOG(line):
    print(json.dumps(line, separators=(',', ':')), flush=True)


def file_log(path):
    """A log appending each assertion line to a JSONL file (the per-assertion log CI uploads) and printing it."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    def log(line):
        with open(path, 'a') as f:
            f.write(json.dumps(line, separators=(',', ':')) + '\n')
        LOG(line)
    return log


def new_record(helper, host_map, unobservable=()):
    return {'schema': 'facemorph.network-record/1', 'helper': helper, 'hostMap': host_map['version'],
            'steps': [], 'requests': [], 'console': [], 'unobservable': list(unobservable)}


def _next_seq(rec):
    return len(rec['steps']) + len(rec['requests']) + len(rec['console'])


def step(rec, name):
    rec['steps'].append({'name': name, 'seq': _next_seq(rec)})


def _host(u):
    return u.netloc.rsplit('@', 1)[-1].lower()


def classify(url, host_map):
    if url.startswith('data:') or url.startswith('blob:'):
        return 'local'
    try:
        u = urlsplit(url)
    except ValueError:
        return 'third-party'
    if not u.scheme or not u.netloc:
        return 'third-party'
    host, hostname = _host(u), (u.hostname or '')
    for r in host_map['rules']:
        if r['host'] in (host, hostname) and (not r.get('pathPrefix') or (u.path or '/').startswith(r['pathPrefix'])):
            return r['class']
    return 'third-party'


def bindOrigins(host_map, bound):
    """A run's own origins bound to their classes ahead of the default rules (record.ts bindOrigins)."""
    rules = [{'host': _host(urlsplit(o)), 'class': cls} for cls, origins in bound.items() for o in origins]
    return {'version': host_map['version'], 'rules': rules + list(host_map['rules'])}


def _origin(u):
    default = {'http': 80, 'https': 443}.get(u.scheme)
    port = f':{u.port}' if u.port and u.port != default else ''
    return f'{u.scheme}://{u.hostname}{port}'


def template(url):
    if url.startswith('data:'):
        return 'data:'
    if url.startswith('blob:'):
        return 'blob:'
    u = urlsplit(url)
    segs = [':n' if re.fullmatch(r'\d+', s) else ':hex' if re.fullmatch(r'[0-9a-fA-F]{16,}', s) else s
            for s in (u.path or '/').split('/')]
    return _origin(u) + '/'.join(segs)


def add_request(rec, host_map, url, method, initiator):
    req = {'seq': _next_seq(rec), 'step': len(rec['steps']) - 1, 'url': template(url),
           'hostClass': classify(url, host_map), 'method': method, 'initiator': initiator, 'status': None,
           'failed': False, 'errorText': None, 'bytes': None, 'fromCache': None}
    rec['requests'].append(req)
    return req


def add_console(rec, level, text, source):
    rec['console'].append({'seq': _next_seq(rec), 'step': len(rec['steps']) - 1, 'level': level, 'text': text,
                           'source': source})


def _bounds(rec, w):
    names = [s['name'] for s in rec['steps']]
    frm, to = w.get('fromStep'), w.get('toStep')
    lo = -1 if frm is None else (names.index(frm) if frm in names else None)
    hi = len(names) - 1 if to is None else (names.index(to) if to in names else None)
    if lo is None:
        return f'no data for the window: step {frm} was not recorded'
    if hi is None:
        return f'no data for the window: step {to} was not recorded'
    return lo, hi


def _sum_bytes(rs):
    return None if any(r['bytes'] is None for r in rs) else sum(r['bytes'] for r in rs)


def _verdict(log, primitive, host_class, window, count, bytes_, verdict, reason, requests=None):
    out = {'primitive': primitive, 'hostClass': host_class,
           'window': {'fromStep': window.get('fromStep'), 'toStep': window.get('toStep')},
           'count': count, 'bytes': bytes_, 'verdict': verdict, 'reason': reason}
    log({'event': 'network-assertion', **out})
    if requests is not None:
        out['requests'] = requests
    return out


def requestsIn(rec, q, log=LOG):
    hc = q.get('hostClass')
    b = _bounds(rec, q)
    if isinstance(b, str):
        return _verdict(log, 'requestsIn', hc, q, 0, None, 'fail', b, [])
    if 'fromCache' in q and 'fromCache' in rec['unobservable']:
        return _verdict(log, 'requestsIn', hc, q, 0, None, 'untested', f"fromCache is unobservable with {rec['helper']}", [])
    rs = [r for r in rec['requests'] if b[0] <= r['step'] <= b[1] and (hc is None or r['hostClass'] == hc)
          and ('fromCache' not in q or r['fromCache'] == q['fromCache'])]
    return _verdict(log, 'requestsIn', hc, q, len(rs), _sum_bytes(rs), 'pass', f'{len(rs)} request(s)', rs)


def assertNoRequests(rec, host_class, w=None, log=LOG):
    w = w or {}
    b = _bounds(rec, w)
    if isinstance(b, str):
        return _verdict(log, 'assertNoRequests', host_class, w, 0, None, 'fail', b)
    rs = [r for r in rec['requests'] if b[0] <= r['step'] <= b[1] and r['hostClass'] == host_class]
    reason = (f"{len(rs)} {host_class} request(s): {', '.join(r['url'] for r in rs)}" if rs
              else f'no {host_class} request')
    return _verdict(log, 'assertNoRequests', host_class, w, len(rs), _sum_bytes(rs), 'fail' if rs else 'pass', reason)


def _seqs(rec, s):
    if 'step' in s:
        return [x['seq'] for x in rec['steps'] if x['name'] == s['step']]
    return [r['seq'] for r in rec['requests'] if r['hostClass'] == s['hostClass']
            and (s.get('path') is None or (urlsplit(r['url']).path or '/').startswith(s['path']))]


def _describe(s):
    if 'step' in s:
        return f"step {s['step']}"
    return f"{s['hostClass']}{' ' + s['path'] if s.get('path') else ''} request"


def assertOrder(rec, before, after, log=LOG):
    a, z = _seqs(rec, before), _seqs(rec, after)
    hc = after.get('hostClass')
    if not a:
        return _verdict(log, 'assertOrder', hc, {}, len(z), None, 'fail', f'no data: {_describe(before)} was not recorded')
    if not z:
        return _verdict(log, 'assertOrder', hc, {}, 0, None, 'fail', f'no data: {_describe(after)} was not recorded')
    ok = max(a) < min(z)
    reason = (f'{_describe(before)} before {_describe(after)}' if ok
              else f'{_describe(after)} came before {_describe(before)}')
    return _verdict(log, 'assertOrder', hc, {}, len(z), None, 'pass' if ok else 'fail', reason)


def bytesBy(rec, host_class, w=None, log=LOG):
    w = w or {}
    b = _bounds(rec, w)
    if isinstance(b, str):
        return _verdict(log, 'bytesBy', host_class, w, 0, None, 'fail', b)
    rs = [r for r in rec['requests'] if b[0] <= r['step'] <= b[1] and r['hostClass'] == host_class]
    total = None if 'bytes' in rec['unobservable'] else _sum_bytes(rs)
    reason = (f"bytes unobservable for {sum(1 for r in rs if r['bytes'] is None)} request(s)" if total is None
              else f'{total} bytes')
    return _verdict(log, 'bytesBy', host_class, w, len(rs), total, 'untested' if total is None else 'pass', reason)


class Attached:
    """CDP events folded into a network record. cdp and drain_events are browser-harness's helpers."""

    def __init__(self, cdp, drain_events, host_map):
        self.cdp, self.drain, self.host_map = cdp, drain_events, host_map
        self.rec = new_record('cdp', host_map)
        self.by_id = {}          # (session, requestId) -> request
        self.received = {}       # (session, requestId) -> bytes received
        self.sessions = {None: 'page'}  # session id -> initiator kind ('page', 'worker', 'service-worker')
        self.page_session = None
        self.last_network = time.time()

    def _enable(self, session):
        for d in ('Network', 'Runtime', 'Log'):
            try:
                self.cdp(f'{d}.enable', session_id=session)
            except RuntimeError:
                pass  # a worker target has no Log domain
        try:
            self.cdp('Runtime.runIfWaitingForDebugger', session_id=session)
        except RuntimeError:
            pass

    def _event(self, e):
        method, p, sid = e.get('method', ''), e.get('params', {}), e.get('session_id')
        if method.startswith('Network.'):
            self.last_network = time.time()
        if method == 'Target.attachedToTarget':
            info = p['targetInfo']
            kind = {'service_worker': 'service-worker', 'worker': 'worker', 'shared_worker': 'worker'}.get(info['type'])
            # Extensions (policy-installed ones too) run their own service workers: not the page's traffic.
            if kind and not info.get('url', '').startswith('chrome-extension://'):
                self.sessions[p['sessionId']] = kind
                self._enable(p['sessionId'])
            return
        source = self.sessions.get(sid, 'page' if sid in (None, self.page_session) else 'unknown')
        key = (sid, p.get('requestId'))
        if method == 'Network.requestWillBeSent':
            if key in self.by_id and p.get('redirectResponse'):
                return  # a redirect continues the same request
            initiator = source
            if source == 'page' and p.get('type') == 'Other' and p.get('initiator', {}).get('type') == 'other' \
                    and not p.get('frameId'):
                initiator = 'worker'
            self.by_id[key] = add_request(self.rec, self.host_map, p['request']['url'], p['request']['method'],
                                          initiator)
        elif method == 'Network.requestServedFromCache' and key in self.by_id:
            self.by_id[key]['fromCache'] = True
        elif method == 'Network.responseReceived' and key in self.by_id:
            r, res = self.by_id[key], p['response']
            r['status'] = res.get('status')
            if r['fromCache'] is None:
                r['fromCache'] = bool(res.get('fromDiskCache') or res.get('fromPrefetchCache'))
            length = {k.lower(): v for k, v in (res.get('headers') or {}).items()}.get('content-length')
            if length is not None and str(length).isdigit():
                r['bytes'] = int(length)
        elif method == 'Network.dataReceived':
            self.received[key] = self.received.get(key, 0) + p.get('dataLength', 0)
        elif method == 'Network.loadingFinished' and key in self.by_id:
            r = self.by_id[key]
            if r['bytes'] is None:
                r['bytes'] = self.received.get(key, 0)
            if r['fromCache'] is None:
                r['fromCache'] = False
        elif method == 'Network.loadingFailed' and key in self.by_id:
            r = self.by_id[key]
            r['failed'], r['errorText'], r['bytes'] = True, p.get('errorText') or 'failed', 0
        elif method == 'Runtime.consoleAPICalled' and p.get('type') == 'error':
            text = ' '.join(str(a.get('value', a.get('description', ''))) for a in p.get('args', []))
            add_console(self.rec, 'error', text, source)
        elif method == 'Log.entryAdded' and p.get('entry', {}).get('level') == 'error':
            add_console(self.rec, 'error', p['entry'].get('text', ''), source)

    def collect(self):
        """Folds every CDP event drained so far into the record; returns the record."""
        for e in self.drain():
            self._event(e)
        return self.rec

    def settled(self, timeout=10.0, quiet=1.0):
        """Collects until every recorded request has finished or failed, or no network event has arrived for
        `quiet` seconds (a worker's script is requested on the page but loaded by the worker's own target), or
        the timeout passes. True when every request settled."""
        end = time.time() + timeout
        while time.time() < end:
            self.collect()
            if all(r['failed'] or r['bytes'] is not None for r in self.rec['requests']):
                return True
            if time.time() - self.last_network > quiet:
                return False
            time.sleep(0.1)
        return False


def attach_cdp(cdp, drain_events, host_map=None, page_session=None, page_target=None):
    """Starts recording: Network/Runtime/Log on the page session, and auto-attach for the page's workers.

    browser-harness strips the session from Target.* commands, so the page's own auto-attach cannot be set;
    Target.autoAttachRelated (a browser-level command) attaches the dedicated and service workers related to
    page_target (browser-harness current_tab()['targetId']). Without page_target, every new worker target in
    the browser is attached (extension workers are still ignored). A new worker waits at its start until the
    helper has enabled its domains (in collect(), which a script calls while it waits), so none of its requests
    is missed.
    """
    att = Attached(cdp, drain_events, host_map or DEFAULT_HOST_MAP)
    att.page_session = page_session
    drain_events()  # earlier events belong to no step of this record
    att._enable(page_session)
    # TargetFilter includes unmatched targets unless an excluding final entry is supplied. Pausing a
    # newly attached page here deadlocks Page.navigate before the caller can drain worker events.
    workers = [{'type': 'worker'}, {'type': 'shared_worker'}, {'type': 'service_worker'}, {'exclude': True}]
    if page_target:
        att.cdp('Target.autoAttachRelated', targetId=page_target, waitForDebuggerOnStart=True, filter=workers)
    else:
        att.cdp('Target.setAutoAttach', autoAttach=True, waitForDebuggerOnStart=True, flatten=True, filter=workers)
    return att


def keep_on_failure(verdicts, capture_screenshot, directory):
    """Keeps a screenshot (browser-harness capture_screenshot) when any verdict failed; returns its path or None."""
    if not any(v['verdict'] == 'fail' for v in verdicts):
        return None
    Path(directory).mkdir(parents=True, exist_ok=True)
    path = str(Path(directory) / 'failure.png')
    capture_screenshot(path)  # the viewport: a full-page capture can outlast the harness IPC timeout
    return path


if __name__ == '__main__':
    sys.exit('import this module from a browser-harness script; see the docstring')

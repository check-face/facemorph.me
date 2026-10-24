"""The control artifact served under the production origin in a headless Chrome on this machine (fm-5ey).

`served_control()` is shared by the exact-artifact harness (control-harness.py) and the built-UI tests that run
against the control (tests/crop/). It verifies deploy-next/ against its identity, seeds classic's qualification
server (apps/web/scripts/next-e2e-server.py) with runtime bytes from a verified acquisition only, and starts a
headless Chrome on a free debugging port with the origin mapped to the local server and third-party hosts made
unresolvable.

Two traps on eris it guards against: 127.0.0.1:9222 is the device lab's adb forward to the phone's Chrome, so the
debugging port is never fixed and the endpoint must be the websocket this Chrome logged; and browser-harness keeps
a daemon per BU_NAME that outlives a run, so each site gets its own name and stops it at exit.
"""
import hashlib, json, os, shutil, socket, ssl, subprocess, sys, tempfile, time, urllib.request
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[2]
ORIGIN_HOST = 'next.facemorph.me'
ORIGIN = f'https://{ORIGIN_HOST}'
MIRROR_HOST = 'models.facemorph.me'
# The candidate's own public catalogue Workers (name latents, previews): project hosts the control reads, so they
# resolve; blocking them makes the control silently fall back to mapping for a published name.
PROJECT_HOSTS = ('facemorph-name-catalogue.cdilga.workers.dev', 'facemorph-seed-gallery.cdilga.workers.dev')
PORT = 8443  # fixed by classic's next-e2e-server.py


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def host_class(url):
    parts = urlsplit(url)
    if parts.scheme in ('data', 'blob', 'about', 'chrome', 'chrome-extension', 'devtools'):
        return 'local-scheme'
    if parts.hostname == ORIGIN_HOST:
        return 'artifact-origin'
    if parts.hostname == MIRROR_HOST:
        return 'runtime-mirror (models.facemorph.me)'
    if parts.hostname in PROJECT_HOSTS:
        return 'project catalogue hosts'
    return 'other'


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def port_in_use(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def stop_harness_daemons(name):
    """Stop the browser-harness daemon started under BU_NAME=name, so the next run cannot reattach to it."""
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if f'BU_NAME={name}'.encode() in (proc / 'environ').read_bytes().split(b'\0'):
                os.kill(int(proc.name), 15)
        except (OSError, PermissionError):
            continue


def seed_mirror(runtime: Path, mirror: Path):
    """Hard-link (or copy) every acquired file into the server's mirror under its own SHA-256."""
    mirror.mkdir(parents=True, exist_ok=True)
    count = 0
    for f in runtime.rglob('*'):
        if not f.is_file() or f.suffix == '.part':
            continue
        target = mirror / sha256_file(f)
        if not target.exists():
            try:
                os.link(f, target)
            except OSError:
                shutil.copyfile(f, target)
        count += 1
    return count


@dataclass
class Site:
    cdp_port: int
    cdp_url: str
    work: Path
    daemon_name: str
    artifact: dict
    runtime: dict
    browser: str = ''
    info: dict = field(default_factory=dict)


@contextmanager
def served_control(runtime: Path, evidence: Path, chrome_path: str, *, extra_trees: dict | None = None):
    """Yield a Site with the control served at https://next.facemorph.me/ in a headless Chrome.

    extra_trees maps a served path prefix to a directory linked into the served tree (for module-level tests of
    the imported source, e.g. {'src': apps/web/src}); the control's own files are never changed."""
    evidence.mkdir(parents=True, exist_ok=True)
    check = subprocess.run(['node', str(REPO / 'scripts/import/build-next.mjs'), '--check'], capture_output=True, text=True)
    artifact = json.loads(check.stdout.strip().splitlines()[-1])['summary']
    if check.returncode != 0:
        raise RuntimeError('deploy-next/ does not verify against its identity; run npm run build:next')
    if port_in_use(PORT):
        raise RuntimeError(f'127.0.0.1:{PORT} is in use; the qualification server needs it')
    manifest = runtime.resolve() / 'manifest.json'
    manifest_sha = sha256_file(manifest)
    cdp_port = free_port()
    daemon_name = f'control-site-{os.getpid()}-{cdp_port}'
    work = Path(tempfile.mkdtemp(prefix='control-site-'))
    procs = []
    try:
        shutil.copytree(REPO / 'deploy-next', work / 'deploy-next')
        for prefix, directory in (extra_trees or {}).items():
            if (work / 'deploy-next' / prefix).exists():
                raise RuntimeError(f'extra tree {prefix} would shadow a control file')
            os.symlink(Path(directory).resolve(), work / 'deploy-next' / prefix)
        for name in ['next-site-source.txt', 'next-site-SHA256SUMS']:
            shutil.copyfile(REPO / name, work / name)
        (work / 'overlay').mkdir()
        shutil.copyfile(manifest, work / 'overlay/manifest.json')
        seeded = seed_mirror(runtime.resolve(), work / '.runtime-mirror')
        runtime_info = {'manifestSha256': manifest_sha, 'bundleVersion': json.loads(manifest.read_text()).get('bundleVersion'),
                        'acquiredFiles': seeded, 'source': str(runtime)}
        (work / 'next-e2e-evidence/downloads').mkdir(parents=True)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(work / 'next.key'), '-out', str(work / 'next.crt'),
                        '-days', '1', '-subj', f'/CN={ORIGIN_HOST}'], check=True, capture_output=True)
        server = subprocess.Popen([sys.executable, str(REPO / 'apps/web/scripts/next-e2e-server.py'), '--manifest-sha', manifest_sha,
                                   '--runtime-overlay', str(work / 'overlay'), '--runtime-files', str(runtime.resolve()),
                                   '--cert', str(work / 'next.crt'), '--key', str(work / 'next.key')],
                                  cwd=work, stdout=open(evidence / 'server.log', 'wb'), stderr=subprocess.STDOUT)
        procs.append(server)
        chrome = subprocess.Popen([chrome_path, '--headless=new', '--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server',
                                   # The origin maps to the local server; every host but the project catalogue Workers fails to
                                   # resolve, so third-party and analytics requests are attempted (and recorded) but never delivered.
                                   f'--host-resolver-rules=MAP {ORIGIN_HOST}:443 127.0.0.1:{PORT},MAP * ~NOTFOUND,EXCLUDE 127.0.0.1,'
                                   + ','.join(f'EXCLUDE {h}' for h in PROJECT_HOSTS),
                                   f'--remote-debugging-port={cdp_port}', f'--user-data-dir={work / "chrome"}', 'about:blank'],
                                  stdout=open(evidence / 'chrome.log', 'wb'), stderr=subprocess.STDOUT)
        procs.append(chrome)
        insecure = ssl._create_unverified_context()
        browser = ''
        for _ in range(60):
            try:
                urllib.request.urlopen(f'https://127.0.0.1:{PORT}/runtime/manifest.json', context=insecure, timeout=2)
                version = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json/version', timeout=2).read())
                logged = (evidence / 'chrome.log').read_text(errors='replace')
                if chrome.poll() is not None or f'DevTools listening on {version.get("webSocketDebuggerUrl")}' not in logged:
                    raise RuntimeError(f'the debugging endpoint on {cdp_port} is not the Chrome this run started: {version.get("Browser")}')
                browser = version.get('Browser', '')
                break
            except RuntimeError:
                raise
            except Exception:
                if server.poll() is not None or chrome.poll() is not None:
                    raise RuntimeError('server or Chrome exited at startup; see server.log and chrome.log')
                time.sleep(1)
        else:
            raise RuntimeError('server or Chrome did not become ready in 60 s')
        yield Site(cdp_port, f'http://127.0.0.1:{cdp_port}', work, daemon_name, artifact, runtime_info, browser)
    finally:
        stop_harness_daemons(daemon_name)
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
        shutil.rmtree(work, ignore_errors=True)

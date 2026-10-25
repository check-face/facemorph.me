// The interception fixture (fm-o8xn): an app origin and a model-host origin on 127.0.0.1 (a secure context), plus a
// port nothing listens on. The page makes one app request, starts a dedicated worker that fetches, registers a
// service worker that fetches on install, requests one cacheable file twice (the second from the browser cache), one
// missing file (404) and one unreachable origin (failed), logs one console error, and requests the model only when
// Approve is pressed. With ?early=1 it requests the model before anyone approves.
//   node scripts/ci/intercept/fixture.ts            serves until killed; prints {"app","model","closed"} as JSON
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const PAGE = `<!doctype html><meta charset="utf-8"><title>loading</title>
<button id="approve">Approve</button>
<script type="module">
const q = new URLSearchParams(location.search);
const model = q.get('model'), closed = q.get('closed');
await fetch('/app.json');
const worker = new Worker('/worker.js');
await new Promise((r) => (worker.onmessage = r));
await navigator.serviceWorker.register('/sw.js');
await navigator.serviceWorker.ready;
await fetch('/cached.json');
await fetch('/cached.json');
await fetch('/missing.json');
await (await fetch('/streamed.json')).text();
await fetch(closed + '/unreachable.json').catch(() => {});
console.error('fixture console error');
if (q.get('early')) await fetch(model + '/model.bin');
document.getElementById('approve').onclick = async () => {
  await fetch(model + '/model.bin');
  document.title = 'approved';
};
document.title = 'ready';
</script>`;
const WORKER = `fetch('/worker-data.json').then((r) => r.text()).then(() => postMessage('done'));`;
const SW = `self.addEventListener('install', (e) => e.waitUntil(fetch('/sw-asset.json')));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));`;

const listen = (s: Server) =>
  new Promise<number>((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)),
  );

export interface Fixture {
  readonly app: string;
  readonly model: string;
  readonly closed: string;
  /** The host map for this fixture's origins: the app port is 'app', the model port 'model-host'. */
  readonly hostMap: { version: number; rules: { host: string; class: 'app' | 'model-host' }[] };
  stop(): Promise<void>;
}

export async function startFixture(): Promise<Fixture> {
  const app = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const send = (type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(200, {
        'content-type': type,
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
        ...headers,
      });
      res.end(body);
    };
    if (path === '/') {
      // A real delayed response exercises navigation past browser-harness's 5 s
      // command socket limit while the driver keeps draining worker attach events.
      const delay = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('delay') ?? 0);
      if (delay > 0 && delay <= 10_000) {
        setTimeout(() => send('text/html', PAGE), delay);
        return;
      }
      return send('text/html', PAGE);
    }
    if (path === '/worker.js') return send('text/javascript', WORKER);
    if (path === '/sw.js') return send('text/javascript', SW);
    // Streamed in two writes with no Content-Length: its bytes are known only when the request finishes.
    if (path === '/streamed.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.write('{"part":1,');
      setTimeout(() => res.end('"streamed":true}'), 200);
      return;
    }
    if (path === '/cached.json')
      return send('application/json', '{"cached":true}', { 'cache-control': 'max-age=600' });
    if (['/app.json', '/worker-data.json', '/sw-asset.json'].includes(path))
      return send('application/json', JSON.stringify({ path }));
    res.writeHead(404, { 'content-type': 'text/plain', 'content-length': '9' });
    res.end('not found');
  });
  const model = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'access-control-allow-origin': '*',
      'content-length': '4096',
      'cache-control': 'no-store',
    });
    res.end(Buffer.alloc(4096, 7));
  });
  const appPort = await listen(app);
  const modelPort = await listen(model);
  const probe = createServer();
  const closedPort = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  return {
    app: `http://127.0.0.1:${appPort}`,
    model: `http://127.0.0.1:${modelPort}`,
    closed: `http://127.0.0.1:${closedPort}`,
    hostMap: {
      version: 1,
      rules: [
        { host: `127.0.0.1:${appPort}`, class: 'app' },
        { host: `127.0.0.1:${modelPort}`, class: 'model-host' },
      ],
    },
    stop: () =>
      Promise.all(
        [app, model].map(
          (s) =>
            new Promise<void>((r) => {
              s.closeAllConnections();
              s.close(() => r());
            }),
        ),
      ).then(() => {}),
  };
}

/** The page URL of a fixture, optionally requesting the model before approval. */
export const pageUrl = (f: Fixture, early = false) =>
  `${f.app}/?model=${encodeURIComponent(f.model)}&closed=${encodeURIComponent(f.closed)}${early ? '&early=1' : ''}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = await startFixture();
  console.log(
    JSON.stringify({
      app: f.app,
      model: f.model,
      closed: f.closed,
      hostMap: f.hostMap,
      page: pageUrl(f),
      early: pageUrl(f, true),
    }),
  );
}

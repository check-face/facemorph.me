// The mirror Worker (fm-fy2.14) in the Workers runtime itself: workerd through Miniflare, with Miniflare's local R2
// bucket and a real local HTTP upstream with a fault switch. Every outbound request the Worker makes is recorded and
// forwarded for real. The classic hosting/next-mirror/worker.test.mjs cases, plus: a path outside the configured
// immutable prefixes is refused, the configured upstream is the only origin fetched, and an unconfigured Worker
// fetches nothing. workerd needs glibc 2.32 or newer, so this runs in the cloudflare-model-host lane on eris, not in
// npm test (triton has glibc 2.31).
//   npm run test:workerd -w packages/cloudflare-model-host
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { after, before, test } from 'node:test';
import { Miniflare } from 'miniflare';

const script = stripTypeScriptTypes(
  readFileSync(new URL('../src/mirror/worker.ts', import.meta.url), 'utf8'),
);
// The deploy's compatibility date, or the newest the workerd binary Miniflare runs supports, if that is older.
const DEPLOY_DATE = '2026-09-16';
const fromMiniflare = createRequire(createRequire(import.meta.url).resolve('miniflare'));
const { compatibilityDate: supported } = fromMiniflare('workerd') as { compatibilityDate: string };
const compatibilityDate = supported < DEPLOY_DATE ? supported : DEPLOY_DATE;
const PREFIXES =
  'runtime/assets/,runtime/chunks/,runtime/manifests/,runtime/photo/,runtime/encoder-stream/';
const chunk =
  'runtime/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/part-091.onnx';

// The upstream: answers every path with three bytes, or with the fault the switch selects.
const site = { mode: 'ok' as 'ok' | '500' | '404', asked: [] as string[] };
let server: Server;
let upstream: string;
before(async () => {
  server = createServer((req, res) => {
    site.asked.push(req.url ?? '');
    if (site.mode === '500') return res.writeHead(500).end('fault');
    if (site.mode === '404') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([1, 2, 3]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  upstream = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => server?.close());

/** The local R2 bucket methods the tests read (Miniflare types them with workers-types, not a dependency here). */
interface Bucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  list(): Promise<{ objects: unknown[] }>;
}

/** A Worker under test and every URL it fetched. */
async function mirror(
  vars: Record<string, string> = { UPSTREAM: upstream, PREFIXES },
  siteBinding = false,
) {
  const outbound: string[] = [];
  const forward = async (request: Request) =>
    fetch(request.url, { method: request.method, headers: request.headers });
  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate,
    r2Buckets: ['MIRROR'],
    bindings: vars,
    outboundService: (request: Request) => {
      outbound.push(request.url);
      return forward(request);
    },
    ...(siteBinding ? { serviceBindings: { SITE: forward } } : {}),
  });
  const get = (path: string, method = 'GET') =>
    mf.dispatchFetch(`https://mirror.test/${path}`, { method });
  return {
    mf,
    get,
    outbound,
    bucket: async () => (await mf.getR2Bucket('MIRROR')) as unknown as Bucket,
  };
}
const bytes = async (r: { arrayBuffer(): Promise<ArrayBuffer> }) => [
  ...new Uint8Array(await r.arrayBuffer()),
];

test('a file not yet held is copied from the upstream once, then served from R2 with CORS, CORP and immutable caching', async () => {
  site.mode = 'ok';
  site.asked = [];
  const m = await mirror();
  try {
    const first = await m.get(chunk);
    assert.equal(first.status, 200);
    assert.deepEqual(await bytes(first), [1, 2, 3]);
    assert.equal(first.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(first.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(first.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(first.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.deepEqual(site.asked, [`/${chunk}`]);
    const again = await m.get(chunk);
    assert.deepEqual(await bytes(again), [1, 2, 3]);
    assert.equal(again.headers.get('Content-Type'), 'application/octet-stream');
    assert.equal(site.asked.length, 1, 'the second request is served from R2');
    assert.deepEqual(m.outbound, [`${upstream}${chunk}`]);
  } finally {
    await m.mf.dispose();
  }
});

test('HEAD warms the copy without a body', async () => {
  site.mode = 'ok';
  const m = await mirror();
  try {
    const r = await m.get(chunk, 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Content-Length'), '3');
    assert.deepEqual(await bytes(r), []);
    const held = await (await m.bucket()).get(chunk);
    assert.ok(held, 'the bucket holds the file');
    assert.deepEqual([...new Uint8Array(await held.arrayBuffer())], [1, 2, 3]);
  } finally {
    await m.mf.dispose();
  }
});

test('mutable or unsafe paths are never copied, and an upstream failure is not stored', async () => {
  site.mode = 'ok';
  site.asked = [];
  const m = await mirror();
  try {
    for (const path of [
      'runtime/manifest.json',
      'index.html',
      'runtime/chunks/../manifest.json',
      'runtime/chunks/%2E%2E/manifest.json',
      'runtime/chunks//x',
    ])
      assert.equal((await m.get(path)).status, 404, path);
    assert.equal(site.asked.length, 0);
    assert.equal((await m.get(chunk, 'POST')).status, 405);
    const options = await m.get(chunk, 'OPTIONS');
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD');
    site.mode = '500';
    assert.equal((await m.get(chunk)).status, 502);
    assert.equal((await (await m.bucket()).list()).objects.length, 0, 'nothing stored');
    site.mode = '404';
    assert.equal((await m.get(chunk)).status, 404);
  } finally {
    site.mode = 'ok';
    await m.mf.dispose();
  }
});

test('a path outside the configured immutable prefixes is refused without a fetch', async () => {
  site.asked = [];
  const m = await mirror({ UPSTREAM: upstream, PREFIXES: 'runtime/chunks/' });
  try {
    assert.equal((await m.get('runtime/photo/a.onnx')).status, 404, 'a prefix not configured');
    assert.equal((await m.get('runtime/chunks/a.bin')).status, 200, 'the configured prefix');
    assert.deepEqual(site.asked, ['/runtime/chunks/a.bin']);
  } finally {
    await m.mf.dispose();
  }
});

test('the configured upstream is the only origin fetched, through the service binding when one is bound', async () => {
  site.mode = 'ok';
  const direct = await mirror();
  try {
    for (const path of [
      chunk,
      'runtime/chunks/a.bin',
      'runtime/chunks/http:/evil.test/x',
      'runtime/assets/%2F%2Fevil.test/x',
    ])
      await direct.get(path);
    assert.ok(direct.outbound.length > 0);
    assert.ok(
      direct.outbound.every((u) => new URL(u).origin === new URL(upstream).origin),
      direct.outbound.join(' '),
    );
  } finally {
    await direct.mf.dispose();
  }
  site.asked = [];
  const bound = await mirror({ UPSTREAM: upstream, PREFIXES }, true);
  try {
    assert.equal((await bound.get(chunk)).status, 200);
    assert.deepEqual(bound.outbound, [], 'no global fetch when SITE is bound');
    assert.deepEqual(site.asked, [`/${chunk}`]);
  } finally {
    await bound.mf.dispose();
  }
});

test('an unconfigured Worker fetches nothing', async () => {
  site.asked = [];
  const m = await mirror({ PREFIXES });
  try {
    assert.equal((await m.get(chunk)).status, 503);
    assert.deepEqual(m.outbound, []);
    assert.equal(site.asked.length, 0);
  } finally {
    await m.mf.dispose();
  }
});

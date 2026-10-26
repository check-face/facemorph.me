// The developer-hosted example (examples/developer-hosted, fm-19eb) from the packed tarballs in real Chromium on the CPU.
//
// @facemorph/browser-model-manager and @facemorph/stylegan-js are built fresh from their sources and `npm pack`ed
// (packages/stylegan-js/test/support/packed.ts, packed-manager.ts), both tarballs are installed offline into a clean
// project in os.tmpdir() (outside the monorepo), the example is compiled there against the emitted .d.ts only, and its
// index.html is served as-is over HTTPS with COOP/COEP (an import map onto node_modules; no bundler). A second local
// HTTPS origin is the developer's static model host: the converted AFHQ cat model (packages/model-conv/out/afhqcat,
// FACEMORPH_AFHQ_CAT; gitignored) and the pinned CPU runtime (FACEMORPH_RUNTIME_CACHE). Requests are recorded by the
// interception helper (scripts/ci/intercept) by host class, and by the model host's own log with bytes.
//
// Checked, step by step: construction and status reads make zero requests; review fetches only the two manifests and
// no model bytes; acquisition without approval is refused with zero requests; an approved acquisition aborted while a
// synthesis chunk is in flight settles as AbortError and leaves no partial asset readable; a new approval resumes and
// (on OPFS) refetches only the chunks not already verified; every model request goes to the declared static origin;
// every asset reads back through the verified local reader with zero requests; the engine loads from those reads and
// synthesizes a 512 x 512 image with zero model-host requests; eviction keeps leased assets; release disposes every
// session and lease; eviction then removes every asset. Absent the converted model or the pinned runtime it reports
// untested.
//   node --test packages/browser-model-manager/test/example.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../scripts/ci/intercept/playwright.ts';
import {
  bindOrigins,
  requestsIn,
  step,
  type NetworkRecord,
} from '../../../scripts/ci/intercept/record.ts';
import { packManagerFresh } from '../../stylegan-js/test/support/packed-manager.ts';
import { packFresh, REPO } from '../../stylegan-js/test/support/packed.ts';

const PKG = join(REPO, 'packages/browser-model-manager');
const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ?? join(homedir(), '.cache/facemorph-runtime');
const PINNED_RUNTIME = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const AFHQ_SOURCE = (
  JSON.parse(
    readFileSync(
      join(REPO, 'packages/stylegan-js/test/vectors/afhq-cat-512/reference.json'),
      'utf8',
    ),
  ) as { converted: { manifestSha256: string } }
).converted.manifestSha256;
const sha256File = (p: string) =>
  execFileSync('sha256sum', [p], { encoding: 'utf8' }).split(' ')[0] ?? '';
const SKIP = !existsSync(join(RUNTIME, 'manifest.json'))
  ? `untested: the pinned CPU runtime is not acquired at ${RUNTIME} (scripts/runtime/acquire.mjs)`
  : sha256File(join(RUNTIME, 'manifest.json')) !== PINNED_RUNTIME
    ? `untested: ${RUNTIME}/manifest.json is not the pinned runtime`
    : !existsSync(join(MODEL, 'manifest.json'))
      ? `untested: the converted AFHQ cat model is not at ${MODEL}`
      : sha256File(join(MODEL, 'manifest.json')) !== AFHQ_SOURCE
        ? `untested: ${MODEL}/manifest.json is not the converted AFHQ cat model`
        : false;

interface Asset {
  sha256: string;
  size: number;
  file?: string;
  url?: string;
  chunks?: { sha256: string; size: number; file?: string }[];
}
const model = SKIP
  ? null
  : (JSON.parse(readFileSync(join(MODEL, 'manifest.json'), 'utf8')) as {
      mapping: Asset;
      synthesis: Asset;
      average: Asset;
      noise: Asset[];
    });
const runtimeAssets = SKIP
  ? []
  : (
      JSON.parse(readFileSync(join(RUNTIME, 'manifest.json'), 'utf8')) as {
        runtime: { assets: Asset[] };
      }
    ).runtime.assets;
const assets = model
  ? [
      ...new Map(
        [...runtimeAssets, model.mapping, model.synthesis, model.average, ...model.noise].map(
          (a) => [a.sha256, a],
        ),
      ).values(),
    ]
  : [];
const TOTAL = assets.reduce((n, a) => n + a.size, 0);
const SYNTH_CHUNKS = model?.synthesis.chunks?.map((c) => `/afhq/${c.file}`) ?? [];

const work = mkdtempSync(join(tmpdir(), 'manager-developer-hosted-'));
after(() => rmSync(work, { recursive: true, force: true }));
const project = join(work, 'consumer');
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const TSC = join(REPO, 'node_modules/.bin/tsc');
let compiled: { status: number; output: string; declarations: string[]; sources: string[] } | null =
  null;

const tls = (() => {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ].concat(['-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')]),
    { stdio: 'ignore' },
  );
  return { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) };
})();

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};
interface Served {
  path: string;
  bytes: number;
}
/** A static HTTPS server over `roots`; `served` logs every path with the bytes it sent; `hold` defers a response. */
function staticServer(
  roots: Record<string, string>,
  headers: Record<string, string>,
  served: Served[],
  hold: (path: string, send: () => void) => boolean = () => false,
) {
  return createServer(tls, (req: IncomingMessage, res: ServerResponse) => {
    res.on('error', () => {});
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    const prefix = Object.keys(roots)
      .sort((a, b) => b.length - a.length)
      .find((p) => path.startsWith(p));
    const root = prefix === undefined ? '' : roots[prefix]!;
    const rest = prefix === undefined ? '' : path.slice(prefix.length);
    const file = normalize(join(root, rest === '' ? 'index.html' : rest));
    const send = () => {
      if (res.destroyed) return;
      if (!prefix || !file.startsWith(root) || !existsSync(file)) {
        served.push({ path, bytes: 0 });
        return res.writeHead(404, headers).end();
      }
      const body = readFileSync(file);
      served.push({ path, bytes: body.length });
      res
        .writeHead(200, {
          ...headers,
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'content-length': String(body.length),
        })
        .end(body);
    };
    if (!hold(path, send)) send();
  });
}
const listen = async (s: Server) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  return `https://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
};

// The gate holds synthesis chunks after the first two, so an abort lands while one is in flight.
let gateClosed = false;
const held: { path: string; send: () => void }[] = [];
let heldAtAbort = 0;
const openGate = () => {
  gateClosed = false;
  for (const h of held.splice(0)) h.send();
};

let appServer: Server, modelServer: Server, appOrigin: string, modelOrigin: string;
const appServed: Served[] = [];
const modelServed: Served[] = [];
before(async () => {
  if (SKIP) return;
  const stylegan = packFresh(work);
  const manager = packManagerFresh(work);
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'developer-hosted-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  // Offline: both tarballs are local and neither package has a registry dependency.
  run(
    'npm',
    [
      'install',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--no-package-lock',
      stylegan,
      manager,
    ],
    project,
  );
  cpSync(join(PKG, 'examples/developer-hosted'), project, { recursive: true });
  let status = 0;
  let output = '';
  try {
    output = run(TSC, ['-p', 'tsconfig.json'], project);
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const ours = run(TSC, ['-p', 'tsconfig.json', '--listFilesOnly'], project)
    .split('\n')
    .filter((f) => f.includes('/node_modules/@facemorph/'));
  compiled = {
    status,
    output: output.trim(),
    declarations: ours,
    sources: ours.filter((f) => !f.endsWith('.d.ts')),
  };
  appServer = staticServer(
    { '/': project + '/' },
    {
      // Cross-origin isolated, so the CPU route may use its bounded threads.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
    },
    appServed,
  );
  modelServer = staticServer(
    { '/afhq/': MODEL + '/', '/runtime/': RUNTIME + '/' },
    {
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'cache-control': 'no-store',
    },
    modelServed,
    (path, send) => {
      if (!gateClosed || SYNTH_CHUNKS.indexOf(path) < 2) return false;
      held.push({ path, send });
      return true;
    },
  );
  appOrigin = await listen(appServer);
  modelOrigin = await listen(modelServer);
});
after(() => {
  openGate();
  appServer?.close();
  modelServer?.close();
});

type Page = {
  evaluate<T>(fn: (a: never) => T | Promise<T>, arg?: unknown): Promise<T>;
  goto(u: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  waitForFunction(fn: string | (() => boolean)): Promise<unknown>;
  on(e: 'console', fn: (m: { type(): string; text(): string }) => void): unknown;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o?: object): Promise<Context>; close(): Promise<void> };
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium',
  { launch(o: object): Promise<Browser> }
>;

/** Runs `body` with window.example in scope (a string, so it is the page's code, not this file's). */
const inPage = <T>(page: Page, body: string, arg?: unknown) =>
  page.evaluate(
    ([b, a]: [string, unknown]) =>
      new Function('example', 'arg', `return (async () => { ${b} })();`)(
        (window as unknown as { example: unknown }).example,
        a,
      ),
    [body, arg] as never,
  ) as Promise<T>;
const inStep = (rec: NetworkRecord, name: string) =>
  requestsIn(rec, { fromStep: name, toStep: name }, () => {}).requests ?? [];
const trace = (line: string) => process.stderr.write(`[developer-hosted] ${line}\n`);

type Failure = { ok: false; error: { name: string; message: string } };
type Codes = { ok: true; codes: string[]; verified: number };

test(
  'the developer-hosted example compiles in a clean project against the packed declarations only',
  { skip: SKIP },
  () => {
    assert.ok(compiled);
    assert.equal(compiled.status, 0, compiled.output);
    assert.ok(compiled.declarations.some((f) => f.includes('/@facemorph/browser-model-manager/')));
    assert.ok(compiled.declarations.some((f) => f.includes('/@facemorph/stylegan-js/')));
    assert.deepEqual(compiled.sources, []);
  },
);

test(
  'developer-hosted example, CPU in Playwright Chromium: authorize-then-acquire from a static origin, abort, verified reads, one image, release and eviction',
  { skip: SKIP, timeout: 1_800_000 },
  async (t) => {
    assert.equal(compiled?.status, 0, 'compiled');
    const browser = await pw.chromium.launch({}).catch(() => null);
    if (!browser) return t.skip('untested: Playwright Chromium does not start here');
    t.after(() => browser.close());
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    t.after(() => context.close());
    const net = attachPlaywright(
      context as never,
      bindOrigins(DEFAULT_HOST_MAP, { app: [appOrigin], 'model-host': [modelOrigin] }),
    );
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') trace(`console error: ${m.text().slice(0, 300)}`);
    });
    const servedSince = (from: number) => modelServed.slice(from);
    const counts: Record<string, number> = {};
    const count = (name: string) => {
      counts[name] = inStep(net.rec, name).filter((r) => r.hostClass !== 'local').length;
      return counts[name];
    };

    step(net.rec, 'page');
    const q = new URLSearchParams({
      model: `${modelOrigin}/afhq/`,
      runtime: `${modelOrigin}/runtime/`,
    });
    await page.goto(`${appOrigin}/?${q}`);
    await page.waitForFunction(() => 'example' in window);
    await net.settled();
    assert.equal(modelServed.length, 0, 'loading the page requested nothing from the model host');

    // Construction and status reads: a second example constructed, both read. Nothing may move.
    step(net.rec, 'construct');
    const served0 = [appServed.length, modelServed.length];
    const status = await inPage<{ backend: string; persistence: string; stored: null }>(
      page,
      `const m = await import('./out/example.js');
       const other = m.createDeveloperHostedExample({ modelBase: arg, runtimeBase: arg });
       await other.status();
       return example.status();`,
      `${modelOrigin}/afhq/`,
    );
    await net.settled();
    assert.equal(count('construct'), 0, 'zero requests at construction and status');
    assert.deepEqual([appServed.length, modelServed.length], served0, 'neither host served');
    trace(`backend ${status.backend}, persistence ${status.persistence}`);

    // Review, through the page's own button: only the two manifests, and the exact bytes shown for consent.
    step(net.rec, 'review');
    let from = modelServed.length;
    await page.click('#review');
    await page.waitForFunction(`document.getElementById('consent').textContent.length > 0`);
    await net.settled();
    const consent = (await page.textContent('#consent')) ?? '';
    const reviewed = JSON.parse((await page.textContent('#report')) ?? '{}') as {
      ok: boolean;
      origin: string;
      assets: number;
      totalBytes: number;
      remainingBytes: number;
    };
    assert.ok(reviewed.ok, JSON.stringify(reviewed));
    assert.deepEqual(
      servedSince(from).map((s) => s.path),
      ['/afhq/manifest.json', '/runtime/manifest.json'],
      'review fetches the manifests only',
    );
    assert.deepEqual(
      [reviewed.origin, reviewed.assets, reviewed.totalBytes, reviewed.remainingBytes],
      [modelOrigin, assets.length, TOTAL, TOTAL],
      'the grant shows every asset and the exact bytes',
    );
    assert.match(consent, new RegExp(`${(TOTAL / 1e6).toFixed(1)} MB from ${modelOrigin}`));

    // Acquiring without approval: refused by the manager before any request.
    step(net.rec, 'unauthorized');
    from = modelServed.length;
    const refused = await inPage<Failure>(page, 'return example.acquire();');
    await net.settled();
    assert.equal(refused.ok, false);
    assert.equal(refused.error.name, 'GrantRefused', JSON.stringify(refused));
    assert.equal(count('unauthorized'), 0, 'no request without approval');
    assert.equal(servedSince(from).length, 0);

    // Approved, then aborted while a synthesis chunk is in flight.
    step(net.rec, 'abort');
    from = modelServed.length;
    gateClosed = true;
    await inPage(page, `example.authorize(); window.__acquiring = example.acquire(); return null;`);
    for (let i = 0; held.length === 0; i++) {
      assert.ok(i < 1200, 'a gated synthesis chunk was requested');
      await new Promise((r) => setTimeout(r, 50));
    }
    heldAtAbort = held.length;
    const aborted = await inPage<Failure & { totals: { loaded: number; total: number } }>(
      page,
      'example.abort(); return window.__acquiring;',
    );
    openGate();
    await net.settled();
    assert.equal(aborted.ok, false);
    assert.equal(aborted.error.name, 'AbortError', JSON.stringify(aborted));
    const afterAbort = await inPage<Codes>(page, 'return example.verify();');
    const synthIndex = assets.findIndex((a) => a.sha256 === model!.synthesis.sha256);
    assert.notEqual(afterAbort.codes[synthIndex], 'ok', 'no partial synthesis asset is readable');
    assert.ok(
      afterAbort.verified > 0 && afterAbort.verified < assets.length,
      JSON.stringify(afterAbort),
    );
    const abortRequests = inStep(net.rec, 'abort').filter((r) => r.hostClass !== 'local');
    for (const r of abortRequests) assert.equal(r.hostClass, 'model-host', r.url);

    // A new review and approval resumes: on OPFS, only chunks not already verified are fetched again.
    step(net.rec, 'resume');
    from = modelServed.length;
    const again = await inPage<{ ok: true; remainingBytes: number }>(
      page,
      'return example.review();',
    );
    assert.ok(again.ok);
    assert.ok(again.remainingBytes < TOTAL, 'what is stored is not asked for again');
    const resumed = await inPage<{
      ok: true;
      grantRemaining: number;
      totals: { loaded: number; total: number; fetched: number; fetchedTotal: number };
    }>(page, 'example.authorize(); return example.acquire();');
    await net.settled();
    assert.ok(resumed.ok, JSON.stringify(resumed));
    assert.deepEqual(
      [resumed.totals.loaded, resumed.totals.total],
      [TOTAL, TOTAL],
      'progress reached the total',
    );
    const resumedServed = servedSince(from).filter((s) => !s.path.endsWith('manifest.json'));
    const synthAfter = resumedServed.filter((s) => SYNTH_CHUNKS.includes(s.path));
    const transferred = again.remainingBytes - resumed.grantRemaining;
    assert.equal(
      transferred,
      resumedServed.reduce((n, s) => n + s.bytes, 0),
      'the grant was charged exactly the bytes the host sent',
    );
    if (status.backend === 'opfs') {
      assert.ok(synthAfter.length < SYNTH_CHUNKS.length, 'verified chunks were kept');
      assert.ok(transferred < again.remainingBytes, 'the resumed transfer is less than approved');
    }
    for (const r of inStep(net.rec, 'resume').filter((x) => x.hostClass !== 'local'))
      assert.equal(r.hostClass, 'model-host', r.url);

    // Verified local reads: every asset, zero requests.
    step(net.rec, 'verify');
    const verified = await inPage<Codes>(page, 'return example.verify();');
    await net.settled();
    assert.equal(verified.verified, assets.length, JSON.stringify(verified.codes));
    assert.equal(count('verify'), 0, 'verified reads make no request');

    // The engine loads from verified local bytes and synthesizes one image.
    step(net.rec, 'generate');
    from = modelServed.length;
    const image = await inPage<
      | Failure
      | {
          ok: true;
          provider: string;
          threads: number;
          width: number;
          height: number;
          distinct: number;
          ms: number;
          leased: number;
          liveSessions: number;
        }
    >(
      page,
      `const g = await example.generate(0);
       if (!g.ok) return g;
       const { rgba, ...rest } = g;
       return { ...rest, distinct: new Set(rgba).size };`,
    );
    await net.settled();
    assert.ok(image.ok, JSON.stringify(image));
    assert.equal(image.provider, 'cpu');
    assert.deepEqual([image.width, image.height], [512, 512]);
    assert.ok(image.distinct > 64, 'a real image, not a flat fill');
    assert.ok(image.leased >= assets.length, 'the handle leases what the engine reads');
    assert.equal(servedSince(from).length, 0, 'the engine requested nothing from the model host');
    for (const r of inStep(net.rec, 'generate'))
      assert.ok(['local', 'app'].includes(r.hostClass), `generate: ${r.hostClass} ${r.url}`);
    const reads = await inPage<string[]>(page, 'return example.reads();');
    assert.ok(reads.length > 0);

    // Eviction while the handle lives keeps every leased asset.
    step(net.rec, 'evict-leased');
    const kept = await inPage<{ removed: number; kept: number }>(page, 'return example.evict();');
    assert.deepEqual([kept.removed, kept.kept], [0, assets.length], 'leased assets are kept');

    // Release disposes every session and lease; eviction then removes the model.
    step(net.rec, 'release');
    const released = await inPage<{ liveSessions: number; leased: number }>(
      page,
      'return example.release();',
    );
    assert.deepEqual(
      [released.liveSessions, released.leased],
      [0, 0],
      'release frees sessions and leases',
    );
    step(net.rec, 'evict');
    const evicted = await inPage<{ removed: number; kept: number }>(
      page,
      'return example.evict();',
    );
    assert.deepEqual([evicted.removed, evicted.kept], [assets.length, 0]);
    const gone = await inPage<Codes>(page, 'return example.verify();');
    await net.settled();
    assert.equal(gone.verified, 0, 'nothing is readable after eviction');
    assert.ok(
      gone.codes.every((c) => c === 'cache-miss' || c === 'evicted'),
      JSON.stringify(gone.codes),
    );
    for (const name of ['evict-leased', 'release', 'evict'])
      assert.equal(count(name), 0, `${name}: zero requests`);

    // Across the run: model requests only to the declared static origin, and nothing anywhere else.
    const nonLocal = net.rec.requests.filter((r) => r.hostClass !== 'local');
    for (const r of nonLocal)
      assert.ok(
        r.url.startsWith(`${appOrigin}/`) || r.url.startsWith(`${modelOrigin}/`),
        `unexpected request ${r.url}`,
      );
    t.diagnostic(
      `backend ${status.backend}; requests construct 0, review ${count('review')}, unauthorized 0, ` +
        `abort ${count('abort')} (${heldAtAbort} synthesis chunk request(s) in flight), ` +
        `resume ${count('resume')} (synthesis chunks fetched ${synthAfter.length}/${SYNTH_CHUNKS.length}, ` +
        `${transferred} B of ${again.remainingBytes} B approved), ` +
        `verify 0, generate 0 model-host (${reads.length} verified reads), evict/release 0; ` +
        `image ${image.ok ? `${image.width}x${image.height} on ${image.provider} with ${image.threads} threads in ${Math.round(image.ms)} ms` : ''}; ` +
        `model host served ${modelServed.length} responses, ${modelServed.reduce((n, s) => n + s.bytes, 0)} B; total ${TOTAL} B`,
    );
  },
);

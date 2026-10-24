// Model-cache eviction never touches user data (fm-fy2.14), in real Chromium, Firefox and WebKit. The scenario plants
// a completed export at the OPFS root (one named like a model digest, too), an application recovery record through
// the app's own originals store, the last-result key and an unrelated Cache Storage entry, and two model units
// through the manager's own shard store. Eviction then runs through the manager's evictUnleased with one unit
// leased. A full inventory of the origin's storage before and after (OPFS tree, IndexedDB record, Cache Storage
// keys, localStorage keys) is the spy: the only deletion is the unleased model unit. Each engine runs a persistent
// profile (WebKit refuses OPFS in an ephemeral one). The scenario runs on the page, or in a module worker where the
// engine writes OPFS only from workers, as the manager does there. The manager and app modules are served from their
// sources (TypeScript types stripped), nothing stubbed.
//   node --test test/e2e/model-eviction-user-data.e2e.ts      (FACEMORPH_E2E_ENGINES=webkit to run one engine)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');
const MANAGER = fileURLToPath(
  new URL('../../../../packages/browser-model-manager/src/', import.meta.url),
);
const APP = fileURLToPath(new URL('../../src/', import.meta.url));
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

// The scenario, as a module the page and a worker both import. `local` is the page's localStorage inventory, which a
// worker cannot read; the page adds it.
const SCENARIO = `
import { openShardStore } from '/mgr/cache/shard-store.ts';
import { createLeaseRegistry, evictUnleased } from '/mgr/handles/leases.ts';
import { openOriginals } from '/app/Next/browser/originals.mjs';
const A = '${A}', B = '${B}';
async function writeFile(dir, name, bytes) {
  const handle = await dir.getFileHandle(name, { create: true });
  if (handle.createWritable) {
    const w = await handle.createWritable();
    await w.write(bytes);
    return w.close();
  }
  const access = await handle.createSyncAccessHandle();
  access.truncate(0);
  access.write(bytes, { at: 0 });
  access.flush();
  access.close();
}
export async function run() {
  const store = await openShardStore();
  if (!store) return { untested: true };
  const root = await navigator.storage.getDirectory();
  for (const name of ['checkface-export-1.webp', A]) await writeFile(root, name, new Uint8Array([9, 9, 9]));
  const originals = await openOriginals();
  await originals.put('recovery-key', { generationSha256: 'f'.repeat(64), latent: [1, 2, 3] });
  await (await caches.open('user-exports')).put('/export.webp', new Response('export'));
  await store.write(A, new Uint8Array([1, 2, 3]));
  await store.write(B, new Uint8Array([4, 5, 6]));
  const inventory = async () => {
    const files = [];
    const walk = async (dir, prefix) => {
      for await (const [name, entry] of dir.entries())
        if (entry.kind === 'directory') await walk(entry, prefix + name + '/');
        else files.push('opfs:' + prefix + name);
    };
    await walk(await navigator.storage.getDirectory(), '');
    const record = await originals.get('recovery-key');
    const cached = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        cached.push('cache:' + name + ':' + new URL(request.url).pathname);
    return [...files, ...(record ? ['idb:checkface-originals-v1:recovery-key'] : []), ...cached].sort();
  };
  const before = await inventory();
  const registry = createLeaseRegistry();
  const [lease] = registry.lease([{ sha256: B, bytes: 3 }], { invalidated() {} });
  const evicted = await evictUnleased([A, B], [store], registry);
  const after = await inventory();
  lease.release();
  return { before, after, evicted };
}
`;
const WORKER = `import { run } from '/e2e/scenario.mjs'; postMessage(await run().catch((e) => ({ error: String(e) })));`;

// /mgr/ serves the manager's sources with their types stripped, /app/ the app's modules, /e2e/ the scenario.
let server: Server;
let origin: string;
before(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const js = (text: string) =>
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(text);
    if (path === '/e2e/scenario.mjs') return js(SCENARIO);
    if (path === '/e2e/worker.mjs') return js(WORKER);
    const [base, rel] = path.startsWith('/mgr/')
      ? [MANAGER, path.slice(5)]
      : path.startsWith('/app/')
        ? [APP, path.slice(5)]
        : [null, ''];
    if (base === null)
      return res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><title>e</title>');
    const file = normalize(join(base, rel));
    if (!file.startsWith(base)) return res.writeHead(404).end();
    try {
      const text = readFileSync(file, 'utf8');
      js(file.endsWith('.ts') ? stripTypeScriptTypes(text) : text);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

interface Outcome {
  readonly where: 'page' | 'worker';
  readonly before: string[];
  readonly after: string[];
  readonly evicted: { removed: string[]; kept: string[] };
}

for (const [engine, type] of Object.entries(ENGINES)) {
  test(`${engine}: model eviction deletes only the unleased model unit; exports and recovery records stay`, async (t) => {
    if (only && !only.includes(engine)) return t.skip(`${engine} not selected`);
    // A persistent profile, as a person's browser has: WebKit refuses OPFS in an ephemeral context.
    const context = await type.launchPersistentContext(mkdtempSync(join(tmpdir(), 'evict-')));
    t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const result = (await page.evaluate(async () => {
      localStorage.setItem('last-generated-result-v1', '{"kept":true}');
      const keys = () => Object.keys(localStorage).map((k) => `local:${k}`);
      const local = keys();
      const { run } = await import('/e2e/scenario.mjs' as string);
      let r = await run();
      let where = 'page';
      if (r.untested) {
        where = 'worker';
        const worker = new Worker('/e2e/worker.mjs', { type: 'module' });
        r = await new Promise((resolve) => (worker.onmessage = (e) => resolve(e.data)));
      }
      if (r.error || r.untested) return r;
      return {
        where,
        before: [...r.before, ...local].sort(),
        after: [...r.after, ...keys()].sort(),
        evicted: r.evicted,
      };
    })) as Outcome | { error?: string; untested?: boolean };
    assert.ok(!('error' in result) && !('untested' in result), JSON.stringify(result));
    const r = result as Outcome;
    t.diagnostic(`${engine}: ran on the ${r.where}`);
    const shards = 'opfs:checkface-model-shards-v1/';
    assert.deepEqual(r.evicted, { removed: [A], kept: [B] });
    assert.deepEqual(
      r.before.filter((k) => !r.after.includes(k)),
      [`${shards}${A}`],
      'the one deletion is the unleased model unit',
    );
    assert.deepEqual(
      r.after.filter((k) => !r.before.includes(k)),
      [],
      'nothing appeared',
    );
    for (const kept of [
      'opfs:checkface-export-1.webp',
      `opfs:${A}`,
      'idb:checkface-originals-v1:recovery-key',
      'cache:user-exports:/export.webp',
      'local:last-generated-result-v1',
      `${shards}${B}`,
    ])
      assert.ok(r.after.includes(kept), `${kept} kept`);
  });
}

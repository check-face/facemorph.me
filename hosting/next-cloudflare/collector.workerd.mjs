import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { localCollector } from './local.mjs';
import { collectorEnvironment, collectorEndpoint } from './environment.mjs';
import { checkedEvent } from './validation.mjs';
import { checkedEvent as clientCheckedEvent } from '../../apps/web/hosting/next-cloudflare/validation.mjs';

const id = '76d02e92-9e4f-4dd1-8a0d-8254a1568fbc';
const event = { schemaVersion: 1, session: id, run: id, device: id, event: 'stage', stage: 'model-loaded', stageMs: 123, elapsedMs: 456, browser: 'safari', browserMajor: 26, platform: 'ios', build: 'next-test' };
function options(body = event, origin = collectorEnvironment('local').origins[0]) {
  return { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Facemorph-Diagnostics-Consent': 'session-v1' }, body: JSON.stringify(body) };
}

test('local fixture command accepts consented HTTP, rejects declined/private input and persists private R2 without expiry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fm-collector-'));
  const child = spawn(process.execPath, ['hosting/next-cloudflare/local.mjs', '--port=0', `--persist=${dir}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', errors = '';
  child.stderr.on('data', b => { errors += b; });
  const exited = once(child, 'exit');
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`collector startup: ${errors}`)), 15000);
      child.stdout.on('data', b => { log += b; const match = log.match(/http:\/\/127\.0\.0\.1:\d+\/diagnostics\/events/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      exited.then(([code]) => { clearTimeout(timer); reject(Error(`collector exited ${code}: ${errors}`)); });
    });
    const declined = options(); delete declined.headers['X-Facemorph-Diagnostics-Consent'];
    assert.equal((await fetch(url, declined)).status, 403);
    assert.equal((await fetch(url, options({ ...event, photo: 'private' }))).status, 400);
    assert.equal((await fetch(url, options())).status, 204);
    assert.equal((await fetch(url, { headers: { Origin: options().headers.Origin } })).status, 405);
    child.kill('SIGTERM');
    assert.ok([0, 143].includes((await exited)[0]), errors); // Miniflare's exit hook uses the POSIX SIGTERM code.
    const reopened = localCollector({ persist: dir });
    try {
      const bucket = await reopened.getR2Bucket('DIAGNOSTICS_R2');
      const { objects } = await bucket.list();
      assert.equal(objects.length, 1, 'declined/private payloads write nothing');
      const saved = await bucket.get(objects[0].key);
      assert.deepEqual(saved.customMetadata, {});
      const [record] = await saved.json();
      assert.equal(record.stageMs, 123);
      assert.equal(record.expiresAt, undefined);
      assert.ok(Number.isFinite(Date.parse(record.receivedAt)));
      assert.equal((await (await reopened.getKVNamespace('DIAGNOSTICS')).list()).keys.length, 0, 'R2 is primary');
    } finally { await reopened.dispose(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
});

test('real KV fallback stores one validated batch with no TTL', async () => {
  const mf = localCollector({ sink: 'kv' });
  try {
    const url = collectorEnvironment('local').collector;
    const batch = { ...event, events: [{ event: 'stage', stage: 'morph' }, { event: 'completed' }] };
    assert.equal((await mf.dispatchFetch(url, options(batch))).status, 204);
    const kv = await mf.getKVNamespace('DIAGNOSTICS');
    const { keys } = await kv.list();
    assert.equal(keys.length, 1);
    assert.equal(keys[0].expiration, undefined);
    const records = JSON.parse(await kv.get(keys[0].name));
    assert.deepEqual(records.map(r => r.event), ['stage', 'completed']);
    assert.ok(records.every(r => r.receivedAt && !Object.hasOwn(r, 'expiresAt')));
    assert.equal((await mf.dispatchFetch(url, options({ ...batch, events: [{ event: 'stage', stage: 'private' }] }))).status, 400);
    assert.equal((await kv.list()).keys.length, 1);
  } finally { await mf.dispose(); }
});

test('environment controls endpoint host, path and exact CORS origins; unknown environment fails closed', async () => {
  for (const name of ['next', 'production']) {
    const config = collectorEnvironment(name), mf = localCollector({ environment: name });
    try {
      const preflight = await mf.dispatchFetch(config.collector, { method: 'OPTIONS', headers: { Origin: config.origins[0], 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-facemorph-diagnostics-consent' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), config.origins[0]);
      assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
      assert.equal((await mf.dispatchFetch(config.collector, options(event, 'https://evil.example'))).status, 403);
      assert.equal((await mf.dispatchFetch(config.collector.replace(new URL(config.collector).host, 'wrong.example'), options(event, config.origins[0]))).status, 404);
      assert.equal((await mf.dispatchFetch(`${config.collector}?secret=1`, options(event, config.origins[0]))).status, 404);
      assert.equal(collectorEndpoint(new URL(config.collector).hostname), config.collector);
    } finally { await mf.dispose(); }
  }
  const mf = localCollector({ environment: 'invalid' });
  try { assert.equal((await mf.dispatchFetch(collectorEnvironment('local').collector, options())).status, 503); }
  finally { await mf.dispose(); }
});

test('client/collector use one validation function and hosting contains no local Wrangler state', async () => {
  assert.equal(clientCheckedEvent, checkedEvent);
  const reporter = await readFile(new URL('../../apps/web/src/Next/reporting.mjs', import.meta.url), 'utf8');
  assert.match(reporter, /fetch\(collectorEndpoint\(/);
  assert.doesNotMatch(reporter, /https:\/\/next\.facemorph\.me/);
  const names = await readdir(new URL('..', import.meta.url), { recursive: true });
  assert.ok(names.every(name => !name.split(/[\\/]/).includes('.wrangler')), 'do not import local Wrangler state');
});

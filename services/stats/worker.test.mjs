import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, increments, exposition, StatsCounters } from './worker.mjs';

// An in-memory stand-in for the Durable Object's SQLite storage, enough for the two statements it runs.
function fakeSql() {
  const rows = new Map();
  return {
    rows,
    exec(sql, key, by) {
      if (sql.startsWith('INSERT')) rows.set(key, (rows.get(key) || 0) + by);
      return { toArray: () => [...rows].map(([k, value]) => ({ key: k, value })) };
    },
  };
}
function env(token = 'scrape-secret') {
  const sql = fakeSql();
  const obj = new StatsCounters({ storage: { sql } });
  return { sql, SCRAPE_TOKEN: token, COUNTERS: { idFromName: () => 'global', get: () => ({ fetch: (u, i) => obj.fetch(new Request(u, i)) }) } };
}
const beacon = (events) => JSON.stringify({ v: 1, events });
const post = (body, headers = {}) => new Request('https://next.facemorph.me/stats/v1', {
  method: 'POST', body,
  headers: { origin: 'https://next.facemorph.me', 'sec-fetch-site': 'same-origin', 'user-agent': 'Mozilla/5.0 (iPhone)', 'cf-connecting-ip': '203.0.113.' + Math.floor(Math.random() * 250), ...headers },
});

test('valid beacon becomes aggregate counters only', async () => {
  const e = env();
  const res = await handle(post(beacon([
    { t: 'visit', platform: 'ios', visit: 'first' },
    { t: 'job', action: 'photo', route: 'cpu', outcome: 'completed', platform: 'ios', ms: 31000 },
    { t: 'job', action: 'face', route: 'webgpu', outcome: 'failed', platform: 'desktop' },
    { t: 'export', kind: 'image', method: 'save' },
  ])), e);
  assert.equal(res.status, 204);
  const keys = [...e.sql.rows.keys()];
  assert.ok(keys.includes('fm_web_visits_total{platform="ios",visit="first"}'));
  assert.ok(keys.includes('fm_web_jobs_total{action="photo",route="cpu",platform="ios",outcome="completed"}'));
  assert.equal(e.sql.rows.get('fm_web_job_duration_seconds_bucket{action="photo",route="cpu",platform="ios",le="60"}'), 1);
  assert.equal(e.sql.rows.get('fm_web_job_duration_seconds_bucket{action="photo",route="cpu",platform="ios",le="30"}'), undefined);
  assert.ok(keys.every((k) => k.startsWith('fm_web_')));
  assert.ok(!keys.some((k) => k.includes('203.0.113')), 'no address stored');
});

test('unknown vocabulary, free text and oversized values are dropped or clamped', () => {
  const inc = increments({ v: 1, events: [
    { t: 'job', action: 'hello world', route: 'cpu', outcome: 'completed', ms: 5 },
    { t: 'visit', platform: 'ios', visit: 'sneaky"}' },
    { t: 'frames', n: 1e12 },
    { t: 'job', action: 'face', route: 'mars', outcome: 'completed', platform: 'toaster', ms: 1e12 },
  ] });
  const keys = [...inc.keys()];
  assert.ok(!keys.some((k) => k.includes('hello') || k.includes('sneaky') || k.includes('mars') || k.includes('toaster')));
  assert.equal(inc.get('fm_web_morph_frames_total{platform="unknown"}'), 100000);
  assert.equal(inc.get('fm_web_job_duration_seconds_sum{action="face",route="unknown",platform="unknown"}'), 3600);
});

test('malformed or oversized beacons are refused', async () => {
  const e = env();
  assert.equal((await handle(post('not json'), e)).status, 400);
  assert.equal((await handle(post(JSON.stringify({ v: 2, events: [] })), e)).status, 400);
  assert.equal((await handle(post(beacon(Array.from({ length: 201 }, () => ({ t: 'visit' })))), e)).status, 400);
  assert.equal((await handle(post(beacon([{ t: 'visit', pad: 'x'.repeat(5000) }])), e)).status, 413);
  assert.equal(increments({ v: 1, events: Array.from({ length: 201 }, () => ({})) }), null);
  assert.equal(e.sql.rows.size, 0);
});

test('only same-origin POSTs from the app hosts are accepted; automation is ignored', async () => {
  const e = env();
  const body = beacon([{ t: 'visit', platform: 'ios', visit: 'first' }]);
  assert.equal((await handle(post(body, { origin: 'https://evil.example' }), e)).status, 403);
  assert.equal((await handle(post(body, { 'sec-fetch-site': 'cross-site' }), e)).status, 403);
  assert.equal((await handle(post(body, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/130' }), e)).status, 204);
  assert.equal((await handle(new Request('https://next.facemorph.me/stats/v1'), e)).status, 405);
  assert.equal(e.sql.rows.size, 0);
});

test('a client sending too fast is rate limited', async () => {
  const e = env();
  const body = beacon([{ t: 'visit', platform: 'desktop', visit: 'returning' }]);
  const statuses = [];
  for (let i = 0; i < 25; i++) statuses.push((await handle(post(body, { 'cf-connecting-ip': '198.51.100.7' }), e)).status);
  assert.ok(statuses.slice(0, 20).every((s) => s === 204));
  assert.ok(statuses.slice(20).every((s) => s === 429));
});

test('metrics need the bearer token and render Prometheus text', async () => {
  const e = env();
  await handle(post(beacon([{ t: 'ttfr', cache: 'cold', platform: 'android', ms: 8000 }])), e);
  const scrape = (auth) => handle(new Request('https://next.facemorph.me/stats/metrics', { headers: auth ? { authorization: auth } : {} }), e);
  assert.equal((await scrape()).status, 401);
  assert.equal((await scrape('Bearer wrong-secret!')).status, 401);
  const res = await scrape('Bearer scrape-secret');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /# TYPE fm_web_time_to_first_result_seconds histogram/);
  assert.match(text, /fm_web_time_to_first_result_seconds_bucket\{cache="cold",platform="android",le="10"\} 1/);
  assert.match(text, /fm_web_time_to_first_result_seconds_count\{cache="cold",platform="android"\} 1/);
});

test('exposition ignores keys outside the fm_web_ families', () => {
  assert.equal(exposition([{ key: 'other_total{a="b"}', value: 3 }]), '');
});

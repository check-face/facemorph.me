import test from 'node:test';
import assert from 'node:assert/strict';
import { allowed, createSink, toStatsEvent, platformClass, OPT_OUT_KEY } from './usage-stats.mjs';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile Safari/604.1';
function env({ host = 'next.facemorph.me', nav = {}, store = {}, dnt } = {}) {
  return {
    location: { hostname: host, protocol: 'https:' },
    navigator: { userAgent: iphone, ...nav },
    localStorage: { getItem: (k) => store[k] ?? null },
    doNotTrack: dnt,
  };
}

test('off for other hosts, automation, GPC, DNT, Save-Data and the opt-out', () => {
  assert.equal(allowed(env()), true);
  assert.equal(allowed(env({ host: 'localhost' })), false);
  assert.equal(allowed(env({ nav: { webdriver: true } })), false);
  assert.equal(allowed(env({ nav: { globalPrivacyControl: true } })), false);
  assert.equal(allowed(env({ nav: { doNotTrack: '1' } })), false);
  assert.equal(allowed(env({ nav: { connection: { saveData: true } } })), false);
  assert.equal(allowed(env({ store: { [OPT_OUT_KEY]: 'off' } })), false);
});

test('events keep only the closed vocabulary and bounded numbers', () => {
  assert.deepEqual(toStatsEvent('job', { action: 'photo', route: 'cpu', outcome: 'completed', ms: 31234.6 }, 'ios'),
    { t: 'job', action: 'photo', route: 'cpu', outcome: 'completed', platform: 'ios', ms: 31235 });
  assert.equal(toStatsEvent('job', { action: 'import', outcome: 'completed' }, 'ios'), null);
  assert.equal(toStatsEvent('job', { action: 'face', route: 'webgl', outcome: 'failed', ms: 5 }, 'desktop').route, 'unknown');
  assert.equal(toStatsEvent('job', { action: 'face', route: 'cpu', outcome: 'failed', ms: 5 }, 'desktop').ms, undefined);
  assert.equal(toStatsEvent('job', { action: 'morph', route: 'cpu', outcome: 'interrupted' }, 'android').outcome, 'cancelled');
  assert.equal(toStatsEvent('export', { kind: 'project', method: 'save' }), null);
  assert.equal(platformClass({ userAgent: iphone }), 'ios');
  assert.equal(platformClass({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'desktop');
});

test('batches until the page hides, then sends one small beacon', () => {
  const sent = [];
  const e = env();
  const handlers = {};
  e.addEventListener = (name, fn) => { handlers[name] = fn; };
  const sink = createSink({ env: e, send: (body) => sent.push(body), now: () => 0 });
  sink.record('visit', { visit: 'first' });
  sink.record('job', { action: 'face', route: 'webgpu', outcome: 'completed', ms: 120 });
  assert.equal(sent.length, 0);
  handlers.pagehide();
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0]);
  assert.equal(body.v, 1);
  assert.equal(body.events.length, 2);
  assert.ok(!/iPhone|Safari|next\.facemorph/.test(sent[0]), 'no user agent or host in the beacon');
});

test('large batches are split under the size limit; opted-out visitors send nothing', () => {
  const sent = [];
  const sink = createSink({ env: env(), send: (b) => sent.push(b), now: () => 0 });
  for (let i = 0; i < 149; i++) sink.record('job', { action: 'face', route: 'cpu', outcome: 'completed', ms: i });
  sink.flush();
  assert.ok(sent.length >= 2);
  assert.ok(sent.every((b) => b.length <= 3800));
  assert.equal(sent.reduce((n, b) => n + JSON.parse(b).events.length, 0), 149);
  const quiet = [];
  const off = createSink({ env: env({ store: { [OPT_OUT_KEY]: 'off' } }), send: (b) => quiet.push(b), now: () => 0 });
  off.record('visit', {}); off.flush();
  assert.equal(quiet.length, 0);
});

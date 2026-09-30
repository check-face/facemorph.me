import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {pageView, referrerClass} from './analytics.mjs';

const req = (path, headers = {}, init = {}) => Object.assign(
  new Request('https://next.facemorph.me' + path, {headers: {'sec-fetch-dest': 'document', ...headers}, ...init}),
  {cf: {country: 'AU'}});

test('counts a home load with coarse fields only', () => {
  const p = pageView(req('/', {referer: 'https://www.reddit.com/r/x?secret=1', 'sec-ch-ua-mobile': '?1', 'user-agent': 'UA', cookie: 'a=b'}), 200);
  assert.deepEqual(p, {indexes: ['home'], blobs: ['home', 'www.reddit.com', 'AU', 'mobile', '200'], doubles: [1]});
  assert.ok(!JSON.stringify(p).includes('secret') && !JSON.stringify(p).includes('UA'));
});
test('ignores assets, other routes, non-GET and opt-outs', () => {
  assert.equal(pageView(req('/app.js', {'sec-fetch-dest': 'script'}), 200), null);
  assert.equal(pageView(req('/anything-else'), 200), null);
  assert.equal(pageView(req('/', {}, {method: 'POST'}), 200), null);
  assert.equal(pageView(req('/', {'sec-fetch-dest': ''}), 200), null);
  assert.equal(pageView(req('/', {'sec-gpc': '1'}), 200), null);
  assert.equal(pageView(req('/', {dnt: '1'}), 200), null);
  assert.equal(pageView(req('/names'), 308), null);
});
test('referrer classes', () => {
  assert.equal(referrerClass(null), 'direct');
  assert.equal(referrerClass('nonsense'), 'unknown');
  assert.equal(referrerClass('https://next.facemorph.me/names'), 'self');
  assert.equal(referrerClass('https://facemorph.me/'), 'facemorph.me');
});
test('records status and never alters the response; survives a broken binding', async () => {
  const points = [];
  const assets = {fetch: async () => new Response('x', {status: 200})};
  const r = await worker.fetch(req('/names'), {ASSETS: assets, PAGEVIEWS: {writeDataPoint: p => points.push(p)}});
  assert.equal(r.status, 200); assert.equal(points[0].blobs[0], 'names');
  const ok = await worker.fetch(req('/'), {ASSETS: assets, PAGEVIEWS: {writeDataPoint() { throw Error('down'); }}});
  assert.equal(ok.status, 200);
  assert.equal((await worker.fetch(req('/'), {ASSETS: assets})).status, 200);
});

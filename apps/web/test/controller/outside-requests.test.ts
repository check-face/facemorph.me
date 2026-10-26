import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environments } from '../../../../hosting/next-cloudflare/environment.mjs';
import { OUTSIDE_REQUESTS, outsideRequest } from '../../src/controller/outside-requests.ts';

const page = 'https://next.facemorph.me';
test('same-origin, data and blob requests are not outside requests', () => {
  for (const url of [
    `${page}/runtime/manifest.json`,
    `${page}/catalogue.json`,
    'data:image/png;base64,AA==',
    'blob:https://next.facemorph.me/1',
  ])
    assert.equal(outsideRequest(url, page), null, url);
});
test('every entry names its host, purpose and trigger; unlisted hosts are reported', () => {
  for (const entry of OUTSIDE_REQUESTS) {
    assert.match(entry.host, /^(\*\.)?[a-z0-9.-]+$/);
    assert.ok(entry.purpose.length > 10 && entry.trigger.length > 10, entry.host);
  }
  assert.equal(
    outsideRequest('https://region1.google-analytics.com/g/collect', page)?.host,
    '*.google-analytics.com',
  );
  assert.equal(outsideRequest('https://unlisted.example/x', page), undefined);
  // Served elsewhere, the collector is an outside request and still listed.
  assert.equal(
    outsideRequest('https://next.facemorph.me/diagnostics/events', 'http://127.0.0.1:1')?.host,
    'next.facemorph.me',
  );
});
test('the hosts hard-coded in the app source are all listed', () => {
  const sources = ['../../src/Next/public-previews.mjs', '../../src/Next/analytics.mjs'].map(
    (path) => readFileSync(new URL(path, import.meta.url), 'utf8'),
  );
  const catalogue = JSON.parse(
    readFileSync(new URL('../../hosting/next-static/catalogue.json', import.meta.url), 'utf8'),
  ) as { origin: string };
  const hosts = new Set<string>([
    new URL(catalogue.origin).hostname,
    ...(['next', 'production'] as const).map(
      (name) => new URL(environments[name].collector).hostname,
    ),
  ]);
  for (const text of sources)
    for (const [, host] of text.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g))
      if (host !== undefined) hosts.add(host);
  for (const host of hosts)
    assert.notEqual(outsideRequest(`https://${host}/`, 'http://127.0.0.1:1'), undefined, host);
});

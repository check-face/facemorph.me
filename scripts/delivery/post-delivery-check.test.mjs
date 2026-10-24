// The post-delivery check and the cutover annotation (fm-tayo): the judges on plain values, every runbook invocation
// through the scripts' own argument parsers, and the redirect, retired, page and unchanged probes against a real
// local HTTP server with a fault switch. Live hosts are checked by the delivery-dry-run lane.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { handle } from '../../services/stats/worker.mjs';
import { annotation, parseAnnotateArgs } from './annotate-cutover.mjs';
import {
  deployNextDigest,
  invocationArgs,
  judgeChunk,
  judgeIdentity,
  judgeRedirect,
  judgeRetiredProbe,
  judgeStats,
  judgeThirdParty,
  pageCheck,
  parseArgs,
  parseIdentity,
  PLATFORM_BEACON,
  redirectCheck,
  retiredCheck,
  statsProbe,
  summarize,
  TEST_REPORT_MARKER,
  testReport,
  unchangedCheck,
} from './post-delivery-check.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const runbook = JSON.parse(readFileSync(new URL('runbook.json', import.meta.url), 'utf8'));

// A real local server with a fault switch: `mode` decides how / answers.
let server, origin;
const site = { mode: 'ok', files: { '/': 'index', '/app.js': 'app' } };
before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (site.mode === 'redirect-308' && path === '/')
      return res.writeHead(308, { location: 'https://facemorph.me/names' }).end();
    if (site.mode === 'redirect-302' && path === '/')
      return res.writeHead(302, { location: 'https://facemorph.me/names' }).end();
    if (site.mode === 'redirect-foreign' && path === '/')
      return res.writeHead(301, { location: 'https://example.com/' }).end();
    if (site.mode === 'gone')
      return res.writeHead(410, { 'content-type': 'text/plain' }).end('gone');
    if (site.mode === 'api')
      return res.writeHead(404, { 'content-type': 'application/json' }).end('{"guid":"x"}');
    const body = site.files[path === '/' ? '/' : path];
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('third-party: one platform beacon is its own part; any other request or a second beacon fails', () => {
  const beacon = `${PLATFORM_BEACON}/vce701823e78c4301a35b7e07294d87301792088814092`;
  const byPart = (parts) => Object.fromEntries(parts.map((p) => [p.part, p.verdict]));
  assert.deepEqual(byPart(judgeThirdParty([])), {
    'third-party': 'pass',
    'platform-beacon': 'not_applicable',
  });
  assert.deepEqual(byPart(judgeThirdParty([beacon])), {
    'third-party': 'pass',
    'platform-beacon': 'pass',
  });
  assert.deepEqual(byPart(judgeThirdParty([beacon, 'https://www.googletagmanager.com/gtag/js'])), {
    'third-party': 'fail',
    'platform-beacon': 'pass',
  });
  assert.deepEqual(byPart(judgeThirdParty([beacon, `${PLATFORM_BEACON}/v2`])), {
    'third-party': 'pass',
    'platform-beacon': 'fail',
  });
  // Lookalikes are ordinary third-party requests: another path or host on the beacon's origin.
  for (const u of [
    'https://static.cloudflareinsights.com/other.js',
    'https://static.cloudflareinsights.com/beacon.min.jsx',
    'https://cloudflareinsights.example.com/beacon.min.js',
  ])
    assert.equal(byPart(judgeThirdParty([u]))['third-party'], 'fail', u);
});

test('identity: a wrong digest fails, a missing file fails, no expectation is not_applicable', () => {
  assert.equal(
    judgeIdentity({ expected: 'a'.repeat(64), served: 'b'.repeat(64), missing: [] }).verdict,
    'fail',
  );
  assert.equal(
    judgeIdentity({ expected: 'a'.repeat(64), served: 'a'.repeat(64), missing: ['x.js (404)'] })
      .verdict,
    'fail',
  );
  assert.equal(
    judgeIdentity({ expected: 'a'.repeat(64), served: 'a'.repeat(64), missing: [] }).verdict,
    'pass',
  );
  assert.equal(judgeIdentity({ expected: null }).verdict, 'not_applicable');
});

test('model chunk: missing from the host fails; a mirror digest mismatch fails; both matching passes', () => {
  const pin = sha('chunk');
  assert.equal(judgeChunk({ pin, site: undefined, mirror: pin }).verdict, 'fail');
  assert.equal(judgeChunk({ pin, site: pin, mirror: sha('other') }).verdict, 'fail');
  assert.equal(judgeChunk({ pin, site: pin, mirror: pin }).verdict, 'pass');
});

test('retired: 200 and every 3xx fail; NXDOMAIN, no answer and an error without an API body pass', () => {
  const at = { host: 'api.facemorph.me', path: '/', dns: 'resolves' };
  for (const status of [200, 301, 302, 307, 308])
    assert.equal(judgeRetiredProbe({ ...at, status }).verdict, 'fail', `${status}`);
  assert.equal(judgeRetiredProbe({ ...at, dns: 'nxdomain' }).verdict, 'pass');
  assert.equal(judgeRetiredProbe({ ...at, status: null }).verdict, 'pass');
  assert.equal(
    judgeRetiredProbe({ ...at, status: 410, contentType: 'text/plain' }).verdict,
    'pass',
  );
  assert.equal(
    judgeRetiredProbe({ ...at, status: 404, contentType: 'application/json' }).verdict,
    'fail',
    'an API body',
  );
  assert.equal(
    judgeRetiredProbe({ ...at, status: 404, contentType: 'image/jpeg' }).verdict,
    'fail',
    'an image body',
  );
});

test('redirect: 200 fails, 302 fails, a foreign Location fails, 308 to the expected origin passes', () => {
  const target = 'https://facemorph.me';
  assert.equal(judgeRedirect({ status: 200, location: null, target }).verdict, 'fail');
  assert.equal(
    judgeRedirect({ status: 302, location: 'https://facemorph.me/names', target }).verdict,
    'fail',
  );
  assert.equal(
    judgeRedirect({ status: 301, location: 'https://example.com/', target }).verdict,
    'fail',
  );
  assert.equal(
    judgeRedirect({ status: 308, location: 'https://facemorph.me/names', target }).verdict,
    'pass',
  );
});

test("stats: the site's 404 fails app mode; the Worker's refusal passes; the probe is refused by the Worker before counting", async () => {
  assert.equal(
    judgeStats({ status: 404, bodyLength: 512, cacheControl: 'public' }).verdict,
    'fail',
  );
  assert.equal(
    judgeStats({ status: 403, bodyLength: 0, cacheControl: 'no-store' }).verdict,
    'pass',
  );
  // The statistics Worker's own handler, given the check's probe: no counter is bound, so reaching one would throw.
  const probe = statsProbe('https://next.facemorph.me');
  const res = await handle(new Request(probe.url, probe.init), {});
  assert.equal(res.status, 403);
  assert.equal((await res.arrayBuffer()).byteLength, 0);
});

test('the test report carries the collector marker and fresh identities; not_applicable parts are reported, never passed', () => {
  const a = testReport();
  const b = testReport();
  assert.equal(a.build, TEST_REPORT_MARKER);
  assert.notEqual(a.run, b.run);
  const s = summarize('page', 'x', [
    { part: 'page', verdict: 'pass' },
    { part: 'identity', verdict: 'not_applicable' },
  ]);
  assert.deepEqual([s.failed, s.notApplicable, s.ok], [0, 1, true]);
});

test('every runbook invocation parses with the scripts own argument parsers', () => {
  const fill = (line) =>
    line.replace(/<[^>]*digest[^>]*>/g, 'a'.repeat(64)).replace(/<[^>]+>/g, 'placeholder.json');
  const checks = [...runbook.actions.map((a) => a.check), runbook.namesHost.check];
  for (const line of checks) {
    const o = parseArgs(invocationArgs(fill(line)));
    assert.ok(o.mode && o.host, line);
  }
  for (const line of runbook.actions.filter((a) => a.annotate).map((a) => a.annotate)) {
    const words = fill(line).split(/\s+/);
    assert.equal(words[1], 'scripts/delivery/annotate-cutover.mjs');
    const o = parseAnnotateArgs(words.slice(2));
    assert.ok(o.action && o.host && /^[0-9a-f]{64}$/.test(o.digest), line);
  }
  assert.throws(() => parseArgs(['--mode', 'retired', '--host', 'x']), /needs --retired/);
  assert.throws(() => parseArgs(['--host', 'x', '--bogus', '1']), /unknown argument/);
  assert.equal(
    annotation({ action: 'a', host: 'h', digest: 'd' }, null, 1).tags[0],
    'facemorph-cutover',
  );
});

test('redirect, retired, page and unchanged against a real local server with a fault switch', async () => {
  site.mode = 'redirect-308';
  assert.equal((await redirectCheck(origin, 'https://facemorph.me')).verdict, 'pass');
  site.mode = 'redirect-302';
  assert.equal((await redirectCheck(origin, 'https://facemorph.me')).verdict, 'fail');
  site.mode = 'redirect-foreign';
  assert.equal((await redirectCheck(origin, 'https://facemorph.me')).verdict, 'fail');

  const host = origin.replace('http://', '');
  site.mode = 'ok';
  assert.ok(
    (await retiredCheck([host], 'http')).some((p) => p.verdict === 'fail'),
    'a live host fails retired',
  );
  site.mode = 'gone';
  assert.ok(
    (await retiredCheck([host], 'http')).every((p) => p.verdict === 'pass'),
    'a host answering 410 passes',
  );
  site.mode = 'api';
  assert.ok(
    (await retiredCheck([host], 'http')).every((p) => p.verdict === 'fail'),
    'an API body fails',
  );
  // A known-absent host passes. Most resolvers answer .invalid with NXDOMAIN; some (systemd-resolved on triton)
  // refuse to look it up at all (EAI_AGAIN), and then the HTTP probes find nothing listening.
  const absent = await retiredCheck(['retired-check.invalid']);
  assert.ok(
    absent.length && absent.every((p) => p.verdict === 'pass'),
    'a known-absent host passes',
  );
  const answer = await dns.lookup('retired-check.invalid').then(
    () => 'resolves',
    (e) => e.code,
  );
  if (answer === 'ENOTFOUND')
    assert.deepEqual(
      absent.map((p) => p.detail),
      ['NXDOMAIN'],
    );

  site.mode = 'ok';
  const page = await pageCheck(origin, 'index');
  assert.deepEqual(
    page.slice(0, 2).map((p) => p.verdict),
    ['pass', 'pass'],
  );
  assert.ok(page.slice(2).every((p) => p.verdict === 'not_applicable'));
  assert.equal((await pageCheck(origin, 'absent words'))[1].verdict, 'fail');

  const identity = parseIdentity(
    `${sha('index')}  deploy-next/index.html\n${sha('app')}  deploy-next/app.js\n`,
  );
  assert.equal(deployNextDigest(identity.files).length, 64);
  assert.equal((await unchangedCheck(origin, identity))[0].verdict, 'pass');
  site.files['/app.js'] = 'changed';
  assert.equal(
    (await unchangedCheck(origin, identity))[0].verdict,
    'fail',
    'a changed file fails unchanged',
  );
  site.files['/app.js'] = 'app';
});

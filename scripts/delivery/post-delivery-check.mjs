#!/usr/bin/env node
// Post-delivery check (fm-tayo, domain.actions.check): run after every delivery action (scripts/delivery/runbook.json
// names each invocation). Read-only apart from one test diagnostics report.
//
//   --mode app        HTTP 200 with no console error and no third-party request (interception helper) beyond at
//                     most one Cloudflare zone analytics beacon, its own part (PLATFORM_BEACON); the served
//                     artifact is the expected one (every deploy-next/ file listed by the identity file fetched from
//                     the host and re-digested, equal to --expect-digest); the runtime manifest parses; one model
//                     chunk verifies against its pin from the host and from models.facemorph.me; the names catalogue
//                     parses; a test diagnostics report (build 'post-delivery-check-test') is accepted; /stats/v1 is
//                     bound to the statistics Worker (a foreign-Origin POST gets its 403 with an empty no-store body,
//                     never the site's 404, so no counter moves).
//   --mode retired    each --retired host: NXDOMAIN or refused, or 4xx/5xx with no API body, on /, the API path and a
//                     historic GUID path; any 2xx or 3xx fails. Redirects are not followed.
//   --mode page       the page answers 200 and contains --text; the app parts are not_applicable.
//   --mode redirect   the host answers 301 or 308 with Location on --target's origin (not followed), then app mode
//                     on the target.
//   --mode unchanged  the host's served artifact equals --before (an identity file).
//
//   node scripts/delivery/post-delivery-check.mjs --mode <mode> --host <hostname> [--expect-digest <sha256>]
//     [--identity <next-site-identity.json | next-site-SHA256SUMS>] [--retired <a,b>] [--target <origin>] [--text <t>] [--before <file>]
//     [--out <summary.json>]
// One JSON line per part (pass, fail or not_applicable), then the summary; exit 1 when any part fails.
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const MODES = ['app', 'retired', 'page', 'redirect', 'unchanged'];
/** The diagnostics collector's filter for these reports: build is this value (hosting/next-cloudflare). */
export const TEST_REPORT_MARKER = 'post-delivery-check-test';
export const MIRROR = 'https://models.facemorph.me';
export const COLLECTOR = 'https://next.facemorph.me/diagnostics/events';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------------------------- arguments

const FLAGS = {
  mode: 'mode',
  host: 'host',
  'expect-digest': 'expectDigest',
  identity: 'identity',
  retired: 'retired',
  target: 'target',
  text: 'text',
  before: 'before',
  out: 'out',
};

/** Parses an invocation's arguments; refuses unknown flags, a missing value and a mode's missing inputs. */
export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !(flag in FLAGS))
      throw new Error(`unknown argument ${argv[i]}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${flag} needs a value`);
    o[FLAGS[flag]] = value;
  }
  o.mode ??= 'app';
  if (!MODES.includes(o.mode)) throw new Error(`unknown mode ${o.mode}`);
  if (!o.host) throw new Error('--host is required');
  if (o.retired) o.retired = o.retired.split(',').filter(Boolean);
  if (o.mode === 'retired' && !o.retired?.length)
    throw new Error('--mode retired needs --retired <hosts>');
  if (o.mode === 'redirect' && !o.target)
    throw new Error('--mode redirect needs --target <origin>');
  if (o.mode === 'page' && !o.text) throw new Error('--mode page needs --text');
  if (o.mode === 'unchanged' && !o.before)
    throw new Error('--mode unchanged needs --before <identity file>');
  if (o.expectDigest && !/^[0-9a-f]{64}$/.test(o.expectDigest))
    throw new Error('--expect-digest is a SHA-256');
  return o;
}

/** Splits a runbook invocation ('node scripts/delivery/post-delivery-check.mjs --mode … ') into its arguments. */
export function invocationArgs(line) {
  const words = line.trim().split(/\s+/);
  const at = words.findIndex((w) => w.endsWith('post-delivery-check.mjs'));
  if (words[0] !== 'node' || at !== 1)
    throw new Error(`not a post-delivery-check invocation: ${line}`);
  return words.slice(2);
}

// ------------------------------------------------------------------------------------------------- judges

const part = (name, verdict, detail) => ({ part: name, verdict, detail });

/** The served artifact's digest: deploy-next/ files as sha256sum lines sorted by path (the goldens' digest). */
export function deployNextDigest(files) {
  return sha256(
    files
      .filter((f) => f.path.startsWith('deploy-next/'))
      .map((f) => `${f.sha256}  ${f.path}\n`)
      .sort()
      .join(''),
  );
}

export function judgeIdentity({ expected, served, missing }) {
  if (!expected) return part('identity', 'not_applicable', 'no expected digest given');
  if (missing.length)
    return part(
      'identity',
      'fail',
      `${missing.length} artifact file(s) not served as listed: ${missing.slice(0, 3).join(', ')}`,
    );
  return served === expected
    ? part('identity', 'pass', `served deploy-next digest ${served}`)
    : part('identity', 'fail', `served deploy-next digest ${served}, expected ${expected}`);
}

export function judgeChunk({ pin, site, mirror }) {
  const bad = [];
  if (site !== pin) bad.push(`the host served ${site ?? 'nothing'}`);
  if (mirror !== pin) bad.push(`${MIRROR} served ${mirror ?? 'nothing'}`);
  return bad.length
    ? part('model-chunk', 'fail', `chunk ${pin}: ${bad.join('; ')}`)
    : part('model-chunk', 'pass', `chunk ${pin} verified from the host and the mirror`);
}

/** Cloudflare's zone Web Analytics beacon, injected into served HTML at the edge, outside the built artifact
 * (classic docs/analytics.md, 'Platform operations'). PLAN.md's runtime privacy boundaries keep this narrowly
 * approved platform beacon as its own policy, separate from the no-third-party gate; whether the zone stops
 * injecting it on next.facemorph.me is the operator's open choice. */
export const PLATFORM_BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';

/** Third-party requests of a page load: at most one platform beacon script is reported as its own part; any other
 * third-party request, or a second beacon, fails. */
export function judgeThirdParty(urls) {
  const beacons = urls.filter((u) => u === PLATFORM_BEACON || u.startsWith(`${PLATFORM_BEACON}/`));
  const others = urls.filter((u) => !beacons.includes(u));
  const parts = [
    others.length
      ? part(
          'third-party',
          'fail',
          `${others.length} third-party request(s): ${others.slice(0, 5).join(', ')}`,
        )
      : part('third-party', 'pass', 'no third-party request besides the platform beacon'),
  ];
  if (beacons.length > 1)
    parts.push(
      part('platform-beacon', 'fail', `${beacons.length} platform beacons: ${beacons.join(', ')}`),
    );
  else if (beacons.length === 1)
    parts.push(
      part(
        'platform-beacon',
        'pass',
        `Cloudflare zone Web Analytics beacon injected at the edge, outside the artifact: ${beacons[0]}`,
      ),
    );
  else parts.push(part('platform-beacon', 'not_applicable', 'no platform beacon loaded'));
  return parts;
}

/** A retired host's probe: no answer at all, or an error status without an API body. Any 2xx or 3xx fails. */
export function judgeRetiredProbe({
  host,
  path,
  dns: dnsState,
  status,
  location,
  contentType,
  bodySha256,
}) {
  const where = `${host}${path ?? ''}`;
  if (dnsState === 'nxdomain') return part(`retired:${where}`, 'pass', 'NXDOMAIN');
  if (status === null || status === undefined)
    return part(`retired:${where}`, 'pass', 'connection refused or no answer');
  if (status >= 200 && status < 400)
    return part(
      `retired:${where}`,
      'fail',
      `answered ${status}${location ? ` Location ${location}` : ''}: still serving`,
    );
  if (/json|image\//.test(contentType ?? ''))
    return part(`retired:${where}`, 'fail', `answered ${status} with an API body (${contentType})`);
  return part(`retired:${where}`, 'pass', `answered ${status}, body ${bodySha256 ?? 'empty'}`);
}

/** A redirect host: 301 or 308, with Location on the expected origin. */
export function judgeRedirect({ status, location, target }) {
  if (status !== 301 && status !== 308)
    return part('redirect', 'fail', `answered ${status}, expected 301 or 308`);
  let origin = null;
  try {
    origin = new URL(location).origin;
  } catch {
    return part('redirect', 'fail', `Location ${JSON.stringify(location)} is not an absolute URL`);
  }
  return origin === new URL(target).origin
    ? part('redirect', 'pass', `${status} to ${location}`)
    : part('redirect', 'fail', `${status} to ${location}, not ${new URL(target).origin}`);
}

/** /stats/v1 is the statistics Worker's when a foreign-Origin POST gets its refusal: 403, empty body, no-store. */
export function judgeStats({ status, bodyLength, cacheControl }) {
  if (status === 403 && bodyLength === 0 && /no-store/.test(cacheControl ?? ''))
    return part(
      'stats-route',
      'pass',
      "the statistics Worker's refusal (403, empty, no-store): bound, nothing counted",
    );
  return part(
    'stats-route',
    'fail',
    `answered ${status} with ${bodyLength} bytes: not the statistics Worker (route not bound?)`,
  );
}

/** The statistics probe: a POST from a foreign Origin, which the Worker refuses before reading or counting it. */
export function statsProbe(origin) {
  return {
    url: `${origin}/stats/v1`,
    init: {
      method: 'POST',
      headers: { origin: 'https://example.invalid', 'content-type': 'application/json' },
      body: '{}',
    },
  };
}

/** A test diagnostics report, filterable by its build marker; fresh UUIDs for session and run. */
export function testReport(uuid = () => crypto.randomUUID()) {
  return {
    schemaVersion: 1,
    session: uuid(),
    run: uuid(),
    event: 'start',
    build: TEST_REPORT_MARKER,
    platform: 'linux',
    browser: 'chromium',
  };
}

export function summarize(mode, host, parts) {
  const failed = parts.filter((p) => p.verdict === 'fail').length;
  return {
    mode,
    host,
    parts: parts.length,
    failed,
    notApplicable: parts.filter((p) => p.verdict === 'not_applicable').length,
    ok: failed === 0,
  };
}

// ------------------------------------------------------------------------------------------------- probes

async function get(url, init = {}) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body };
  } catch (error) {
    return { status: null, error: String(error?.cause?.code ?? error) };
  }
}

/** An artifact's file list: its next-site-identity.json, or the next-site-SHA256SUMS every classic artifact carries. */
export function parseIdentity(text) {
  try {
    const id = JSON.parse(text);
    if (Array.isArray(id.files)) return id;
  } catch {
    /* not JSON: sha256sum lines */
  }
  const files = text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (!m) throw new Error(`not an identity file or sha256sum line: ${line.slice(0, 80)}`);
      return { sha256: m[1], path: m[2] };
    });
  if (!files.length) throw new Error('the identity lists no files');
  return { files };
}
const readIdentity = (path) => parseIdentity(readFileSync(path, 'utf8'));

/** Fetches every deploy-next/ file the identity lists from the host and re-digests what was served. */
async function servedIdentity(origin, identity) {
  const files = [];
  const missing = [];
  for (const f of identity.files.filter((x) => x.path.startsWith('deploy-next/'))) {
    const path = f.path.slice('deploy-next/'.length);
    const res = await get(`${origin}/${path === 'index.html' ? '' : path}`);
    if (res.status !== 200) missing.push(`${path} (${res.status})`);
    files.push({ path: f.path, sha256: res.body ? sha256(res.body) : 'missing' });
  }
  return { served: deployNextDigest(files), missing };
}

async function appMode({ host, expectDigest, identity: identityPath }, out) {
  const origin = `https://${host}`;
  const parts = [];
  const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright');
  const { attachPlaywright, DEFAULT_HOST_MAP } = await import('../ci/intercept/playwright.ts');
  const { bindOrigins, step } = await import('../ci/intercept/record.ts');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const net = attachPlaywright(context, bindOrigins(DEFAULT_HOST_MAP, { app: [origin] }));
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    step(net.rec, 'load');
    const res = await page.goto(origin, { waitUntil: 'networkidle' });
    await net.settled();
    parts.push(
      res?.status() === 200
        ? part('page', 'pass', '200')
        : part('page', 'fail', `answered ${res?.status()}`),
    );
    parts.push(
      errors.length
        ? part('console', 'fail', errors.slice(0, 3).join(' | '))
        : part('console', 'pass', 'no console error'),
    );
    parts.push(
      ...judgeThirdParty(
        net.rec.requests.filter((r) => r.hostClass === 'third-party').map((r) => r.url),
      ),
    );
    if (parts.some((p) => p.verdict === 'fail')) {
      await page.screenshot({ path: `${out}-failure.png`, fullPage: true }).catch(() => {});
      await context.tracing.stop({ path: `${out}-trace.zip` });
    } else await context.tracing.stop();
  } finally {
    await browser.close();
  }

  const identity =
    identityPath || expectDigest
      ? readIdentity(identityPath ?? join(REPO, 'next-site-identity.json'))
      : null;
  parts.push(
    judgeIdentity(
      identity
        ? { expected: expectDigest, ...(await servedIdentity(origin, identity)) }
        : { expected: null },
    ),
  );

  const manifestRes = await get(`${origin}/runtime/manifest.json`);
  let manifest = null;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRes.body));
    parts.push(part('runtime-manifest', 'pass', `fetched (${manifestRes.body.length} bytes)`));
  } catch {
    parts.push(
      part('runtime-manifest', 'fail', `answered ${manifestRes.status}: no runtime manifest`),
    );
  }
  const chunk = manifest?.synthesis?.chunks?.[0];
  if (chunk) {
    const path = new URL(chunk.url).pathname;
    const site = await get(`${origin}${path}`);
    const mirror = await get(`${MIRROR}${path}`);
    parts.push(
      judgeChunk({
        pin: chunk.sha256,
        site: site.body && sha256(site.body),
        mirror: mirror.body && sha256(mirror.body),
      }),
    );
  } else if (manifest)
    parts.push(part('model-chunk', 'fail', 'the manifest names no synthesis chunk'));

  const catalogue = await get(`${origin}/catalogue.json`);
  try {
    const names = JSON.parse(new TextDecoder().decode(catalogue.body));
    parts.push(
      part(
        'names-catalogue',
        'pass',
        `parses (${Array.isArray(names) ? names.length : Object.keys(names).length} entries)`,
      ),
    );
  } catch {
    parts.push(part('names-catalogue', 'fail', `answered ${catalogue.status}: not a catalogue`));
  }

  const collectorOrigins = ['next.facemorph.me', 'facemorph.me'];
  if (collectorOrigins.includes(host)) {
    const sent = await get(COLLECTOR, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-facemorph-diagnostics-consent': 'session-v1',
      },
      body: JSON.stringify(testReport()),
    });
    parts.push(
      sent.status >= 200 && sent.status < 300
        ? part('test-report', 'pass', `accepted (${sent.status}), build ${TEST_REPORT_MARKER}`)
        : part('test-report', 'fail', `the collector answered ${sent.status}`),
    );
  } else parts.push(part('test-report', 'not_applicable', `${host} is not a collector origin`));

  const probe = statsProbe(origin);
  const stats = await get(probe.url, probe.init);
  parts.push(
    judgeStats({
      status: stats.status,
      bodyLength: stats.body?.length ?? -1,
      cacheControl: stats.headers?.get('cache-control'),
    }),
  );
  return parts;
}

/** Each retired host's probes; `scheme` is https except in tests against a local server. */
export async function retiredCheck(retired, scheme = 'https') {
  const parts = [];
  for (const host of retired) {
    let dnsState = 'resolves';
    try {
      await dns.lookup(host.replace(/:\d+$/, ''));
    } catch (e) {
      dnsState = e.code === 'ENOTFOUND' ? 'nxdomain' : 'error';
    }
    if (dnsState === 'nxdomain') {
      parts.push(judgeRetiredProbe({ host, dns: dnsState }));
      continue;
    }
    for (const path of [
      '/',
      '/api/face/?seed=0&dim=512',
      '/api/queue/?guid=00000000-0000-4000-8000-000000000000',
    ]) {
      const r = await get(`${scheme}://${host}${path}`);
      parts.push(
        judgeRetiredProbe({
          host,
          path,
          dns: dnsState,
          status: r.status,
          location: r.headers?.get('location'),
          contentType: r.headers?.get('content-type'),
          bodySha256: r.body?.length ? sha256(r.body) : null,
        }),
      );
    }
  }
  return parts;
}

export async function pageCheck(origin, text) {
  const r = await get(`${origin}/`);
  const body = r.body ? new TextDecoder().decode(r.body) : '';
  return [
    r.status === 200 ? part('page', 'pass', '200') : part('page', 'fail', `answered ${r.status}`),
    body.includes(text)
      ? part('text', 'pass', `contains ${JSON.stringify(text)}`)
      : part('text', 'fail', `does not contain ${JSON.stringify(text)}`),
    ...[
      'identity',
      'runtime-manifest',
      'model-chunk',
      'names-catalogue',
      'test-report',
      'stats-route',
    ].map((p) => part(p, 'not_applicable', 'a legacy page has no artifact, manifest or collector')),
  ];
}

/** The redirect part alone, against any origin (the redirect mode's first step). */
export async function redirectCheck(origin, target) {
  const r = await get(`${origin}/`);
  return judgeRedirect({ status: r.status, location: r.headers?.get('location'), target });
}

async function redirectMode(o, out) {
  const verdict = await redirectCheck(`https://${o.host}`, o.target);
  if (verdict.verdict === 'fail') return [verdict];
  return [verdict, ...(await appMode({ ...o, host: new URL(o.target).host }, out))];
}

/** The served artifact against a before-identity, at any origin. */
export async function unchangedCheck(origin, identity) {
  const expected = deployNextDigest(identity.files);
  return [judgeIdentity({ expected, ...(await servedIdentity(origin, identity)) })];
}

export async function check(o) {
  const out = o.out ?? join(REPO, 'test-results/post-delivery', `${o.host}-${o.mode}`);
  mkdirSync(dirname(out), { recursive: true });
  const parts =
    o.mode === 'app'
      ? await appMode(o, out)
      : o.mode === 'retired'
        ? await retiredCheck(o.retired)
        : o.mode === 'page'
          ? await pageCheck(`https://${o.host}`, o.text)
          : o.mode === 'redirect'
            ? await redirectMode(o, out)
            : await unchangedCheck(`https://${o.host}`, readIdentity(o.before));
  const summary = summarize(o.mode, o.host, parts);
  writeFileSync(`${out}.json`, `${JSON.stringify({ summary, parts }, null, 2)}\n`);
  return { summary, parts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  const { summary, parts } = await check(o);
  for (const p of parts) console.log(JSON.stringify(p));
  console.log(JSON.stringify({ summary }));
  process.exit(summary.ok ? 0 : 1);
}

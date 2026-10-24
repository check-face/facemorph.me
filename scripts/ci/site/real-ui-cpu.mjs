#!/usr/bin/env node
// real-ui-cpu (fm-aa8, next-e2e.yml): the exact artifact through classic's whole product journey on the CPU route
// (apps/web/scripts/next-e2e-browser.py, unedited: name and seed faces, e4e on a metadata-free photo, crop,
// original reuse, recovered still without inference, GPU refusal scope, playable and saved MP4, restore), with
// its network folded by host class (scripts/ci/intercept): zero third-party requests, and real inference
// (inferenceVerdict: worker replies per model operation, and the weights the workers fetched).
// - The runtime is the verified acquired runtime; its manifest must be the pinned runtime_sha, or the run is
//   refused before any server or browser starts.
// - The artifact (deploy-next/ beside next-site-source.txt and next-site-SHA256SUMS) is served at
//   https://next.facemorph.me by classic's qualification server through the parity specs' control server
//   (port 8443: run it under the device lease), and Chromium reaches it through a host mapping.
// - Chromium gets its own profile and free CDP port; the harness is pointed at the exact WebSocket URL it printed.
//   node scripts/ci/site/real-ui-cpu.mjs --site <dir> --runtime-sha <sha> [--runtime <dir>] [--out next-e2e-evidence]
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const REPO = resolve(new URL('../../..', import.meta.url).pathname);
const HARNESS =
  process.env['BROWSER_HARNESS'] ?? join(homedir(), 'Work/runs/venv-bh/bin/browser-harness');
// Chrome for Testing (proprietary codecs: the journey plays the saved H.264 MP4, which Arch's Chromium cannot).
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium';
const JOURNEY = join(REPO, 'apps/web/scripts/next-e2e-browser.py');
// Served at https://next.facemorph.me, the product's analytics.mjs asks for GA4's loader: the one operator-approved
// exception (30 September 2026), the same single URL check-no-third-party.mjs allows. Only that URL is 'analytics'
// (any other Google origin, a collect hit included, stays third-party), and the qualification server's CSP refuses
// it, so the lane also requires that it moved zero bytes: qualification never reaches the production property.
export const ANALYTICS_RULE = {
  host: 'www.googletagmanager.com',
  pathPrefix: '/gtag/js',
  class: 'analytics',
};

/** Refuses a runtime whose manifest is not the pinned one, before anything starts. Pure. */
export function runtimeRefusal(runtimeSha, manifestSha) {
  if (!/^[0-9a-f]{64}$/.test(runtimeSha ?? ''))
    return `runtime_sha must be 64 lowercase hex, got ${runtimeSha}`;
  if (manifestSha !== runtimeSha)
    return `the runtime manifest is ${manifestSha}, not the pinned runtime_sha ${runtimeSha}: refused before the browser starts`;
  return null;
}

// Inference events, seen from the page: each reply an inference worker sends for a model operation, as one console
// line. The probe subclasses Worker with a prototype postMessage (as the journey's own worker counter does), so the
// two wrappers chain in either order, and console lines survive the journey's reloads.
const INFERENCE_OPS = ['generate', 'synthesize', 'synthesize-frames', 'encode-aligned'];
const PROBE_TAG = '[real-ui-cpu inference]';
const PROBE = `(() => {
  if (window.__realUiCpuProbe) return;
  window.__realUiCpuProbe = true;
  const OPS = new Set(${JSON.stringify(INFERENCE_OPS)});
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...args) {
      super(...args);
      this.__ops = new Map();
      this.addEventListener('message', ({ data }) => {
        const op = data && this.__ops.get(data.id);
        if (op && (data.type === 'frame' || data.type === 'complete' || data.type === 'error'))
          console.debug(${JSON.stringify(PROBE_TAG)} + ' ' + JSON.stringify({ op, reply: data.type }));
      });
    }
    postMessage(message, ...rest) {
      if (message && message.id != null && OPS.has(message.type)) this.__ops.set(message.id, message.type);
      return super.postMessage(message, ...rest);
    }
  };
})();`;

/** Real inference, or a named reason it was not seen. Pure: the probe's events, the journey's report and the network
 * record. Every name/seed face the journey reports needs a completed `generate`; the e4e encode needs a completed
 * `encode-aligned` followed by a `synthesize` (the encoded face rendered); the morph needs frames; and the workers must
 * have fetched the generator's chunks and the encoder's stream. A mocked engine answers without the last of these. */
export function inferenceVerdict(events, report, rec) {
  const done = (op) => events.filter((e) => e.op === op && e.reply === 'complete').length;
  const faces = report?.checks?.nameSeed?.dimensions?.length ?? 0;
  const firstEncode = events.findIndex((e) => e.op === 'encode-aligned' && e.reply === 'complete');
  const workerBytes = (part) =>
    rec.requests
      .filter((r) => r.initiator === 'worker' && r.hostClass === 'app' && r.url.includes(part))
      .reduce((n, r) => n + (r.bytes ?? 0), 0);
  const counts = {
    faces,
    generate: done('generate'),
    encode: done('encode-aligned'),
    synthesizeAfterEncode:
      firstEncode < 0
        ? 0
        : events.slice(firstEncode).filter((e) => e.op === 'synthesize' && e.reply === 'complete')
            .length,
    morphFrames: events.filter((e) => e.op === 'synthesize-frames' && e.reply === 'frame').length,
    generatorBytes: workerBytes('/runtime/chunks/'),
    encoderBytes: workerBytes('/runtime/encoder-stream/'),
  };
  const reasons = [];
  if (faces === 0) reasons.push('the journey reported no generated faces');
  if (counts.generate < faces)
    reasons.push(`${counts.generate} generate completions for ${faces} faces`);
  if (counts.encode === 0) reasons.push('no completed e4e encode');
  if (counts.synthesizeAfterEncode === 0) reasons.push('the encoded face was never synthesized');
  if (counts.morphFrames === 0) reasons.push('no morph frames');
  if (counts.generatorBytes === 0) reasons.push('no generator chunk bytes fetched by a worker');
  if (counts.encoderBytes === 0) reasons.push('no encoder stream bytes fetched by a worker');
  return { verdict: reasons.length ? 'fail' : 'pass', counts, reasons };
}

const freePort = () =>
  new Promise((r) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

function harness(script, env, cwd, timeoutMs) {
  return new Promise((done) => {
    const p = spawn(HARNESS, [], {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      done({ code, out, err });
    });
    p.stdin.end(script);
  });
}

async function main(argv) {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      site: { type: 'string' },
      'runtime-sha': { type: 'string' },
      runtime: { type: 'string', default: join(homedir(), '.cache/facemorph-runtime') },
      out: { type: 'string', default: 'next-e2e-evidence' },
    },
  });
  const site = resolve(a.site ?? '');
  const out = resolve(a.out);
  const manifest = join(a.runtime, 'manifest.json');
  const manifestSha = existsSync(manifest)
    ? createHash('sha256').update(readFileSync(manifest)).digest('hex')
    : null;
  const refusal = runtimeRefusal(a['runtime-sha'], manifestSha);
  if (refusal) {
    console.error(refusal);
    return 2;
  }
  const source = readFileSync(join(site, 'next-site-source.txt'), 'utf8').trim();
  const { startControl, chromiumArgs } = await import(
    join(REPO, 'apps/web/test/parity/control-server.ts')
  );
  mkdirSync(out, { recursive: true });
  const control = await startControl({
    artifact: join(site, 'deploy-next'),
    source,
    runtime: a.runtime,
    log: join(out, 'server.log'),
  });
  // The journey reads next-site-source.txt and writes next-e2e-evidence/ in its working directory.
  const work = mkdtempSync(join(tmpdir(), 'real-ui-cpu-'));
  cpSync(join(site, 'next-site-source.txt'), join(work, 'next-site-source.txt'));
  // As classic's workflow prepared it: the evidence directory with its downloads folder and the artifact's receipts.
  mkdirSync(join(work, 'next-e2e-evidence/downloads'), { recursive: true });
  for (const f of ['next-site-source.txt', 'next-site-SHA256SUMS'])
    if (existsSync(join(site, f))) cpSync(join(site, f), join(work, 'next-e2e-evidence', f));
  const port = await freePort();
  const profile = join(work, 'chrome');
  const chrome = spawn(
    CHROMIUM,
    [
      '--headless=new',
      '--no-sandbox',
      '--no-proxy-server',
      ...chromiumArgs,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const name = `real-ui-cpu-${process.pid}`;
  let code = 1;
  try {
    const ws = await new Promise((ok, fail) => {
      let log = '';
      const t = setTimeout(
        () => fail(new Error(`Chromium did not report DevTools on ${port}`)),
        30_000,
      );
      chrome.stderr.on('data', (d) => {
        log += d;
        const m = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/\S+)/.exec(log);
        if (m && Number(m[2]) === port) {
          clearTimeout(t);
          ok(m[1]);
        }
      });
    });
    const env = {
      BU_NAME: name,
      BU_CDP_WS: ws,
      BU_CDP_URL: '',
      RUNTIME_SHA: a['runtime-sha'],
    };
    // The journey drains the harness daemon's event buffer as it waits, so the network is recorded by a second CDP
    // client on the same browser: Playwright over CDP with the interception helper on its default context.
    const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright');
    const { attachPlaywright, fileLog, DEFAULT_HOST_MAP } = await import(
      join(REPO, 'scripts/ci/intercept/playwright.ts')
    );
    const { assertNoRequests, requestsIn, step } = await import(
      join(REPO, 'scripts/ci/intercept/record.ts')
    );
    const observer = await chromium.connectOverCDP(ws);
    const context = observer.contexts()[0];
    const att = attachPlaywright(context, {
      version: DEFAULT_HOST_MAP.version,
      rules: [ANALYTICS_RULE, ...DEFAULT_HOST_MAP.rules],
    });
    const events = [];
    context.on('console', (m) => {
      const text = m.text();
      if (text.startsWith(PROBE_TAG)) events.push(JSON.parse(text.slice(PROBE_TAG.length)));
    });
    await context.addInitScript(PROBE);
    step(att.rec, 'journey');
    const journey = await harness(readFileSync(JOURNEY, 'utf8'), env, work, 1_500_000);
    writeFileSync(join(out, 'journey.log'), journey.out + journey.err);
    if (journey.code !== 0) process.stderr.write(journey.err.slice(-4000));
    await att.settled();
    await observer.close().catch(() => {}); // disconnects; the harness's browser keeps running until stopped below
    if (existsSync(join(work, 'next-e2e-evidence')))
      cpSync(join(work, 'next-e2e-evidence'), out, { recursive: true });
    const rec = att.rec;
    writeFileSync(join(out, 'network.json'), JSON.stringify(rec, null, 1));
    writeFileSync(join(out, 'inference-events.json'), JSON.stringify(events, null, 1));
    const log = fileLog(join(out, 'network-assertions.jsonl'));
    const third = assertNoRequests(rec, 'third-party', {}, log);
    const app = requestsIn(rec, { hostClass: 'app' }, log);
    const analytics = requestsIn(rec, { hostClass: 'analytics' }, log);
    let report = null;
    try {
      report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    } catch {
      /* the journey stopped before writing it */
    }
    const inference = inferenceVerdict(events, report, rec);
    log({ event: 'inference', ...inference });
    console.log(
      JSON.stringify({
        journeyExit: journey.code,
        passed: report?.passed ?? false,
        thirdParty: third.count,
        appRequests: app.count,
        analyticsAttempts: analytics.count,
        analyticsBytes: analytics.bytes,
        inference: inference.verdict,
        inferenceReasons: inference.reasons,
        artifactSource: source,
      }),
    );
    code =
      journey.code === 0 &&
      report?.passed === true &&
      third.verdict === 'pass' &&
      app.count > 0 &&
      analytics.bytes === 0 &&
      inference.verdict === 'pass'
        ? 0
        : 1;
  } finally {
    let daemons = '';
    try {
      daemons = execFileSync('pgrep', ['-f', 'browser_harness'], { encoding: 'utf8' });
    } catch {
      /* none */
    }
    for (const pid of daemons.split(/\s+/).filter(Boolean))
      try {
        if (readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`BU_NAME=${name}`))
          process.kill(Number(pid));
      } catch {
        /* gone */
      }
    chrome.kill('SIGTERM');
    await control.stop();
    rmSync(work, { recursive: true, force: true });
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = await main(process.argv.slice(2));

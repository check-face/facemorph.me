// The site lane's checks (fm-aa8): the retired-host scan (pure matching, then real runs of the CLI on planted
// artifact trees, report-only for the control's identity and blocking for a build's), and real-ui-cpu's runtime
// refusal (plain values).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ANALYTICS_RULE, inferenceVerdict, runtimeRefusal } from './real-ui-cpu.mjs';
import { classify } from '../intercept/record.ts';
import { DEFAULT_HOST_MAP } from '../intercept/playwright.ts';
import { hits, modeFor } from './retired-hosts.mjs';

const CLI = new URL('./retired-hosts.mjs', import.meta.url).pathname;

test('retired hosts and the candidate branch match; shared hosts that stay do not', () => {
  assert.deepEqual(
    hits(
      'fetch("https://api.facemorph.me/api/face/")\nx="https://checkface.facemorph.me/x"\nref=candidate/next-delivery-20260916',
    ).map((h) => [h.name, h.line]),
    [
      ['api.facemorph.me', 1],
      ['checkface.facemorph.me', 2],
      ['candidate/next-delivery-20260916', 3],
    ],
  );
  assert.deepEqual(
    hits(
      'https://models.facemorph.me/runtime https://next.facemorph.me/ https://facemorph.me https://names.facemorph.me',
    ),
    [],
  );
  assert.equal(hits('https://eu.api.facemorph.me/').length, 1);
});

test('report-only for the pinned control, blocking for a build', () => {
  assert.equal(modeFor('control'), 'report');
  assert.equal(modeFor('build'), 'block');
  assert.equal(modeFor(undefined), 'block');
});

function artifact(kind, files) {
  const root = mkdtempSync(join(tmpdir(), 'retired-'));
  mkdirSync(join(root, 'deploy-next'));
  writeFileSync(join(root, 'next-site-identity.json'), JSON.stringify({ kind }));
  for (const [p, t] of Object.entries(files)) writeFileSync(join(root, 'deploy-next', p), t);
  return root;
}
const run = (root) =>
  spawnSync(process.execPath, [CLI, join(root, 'deploy-next')], { encoding: 'utf8' });

test('a build containing api.facemorph.me fails; the control reports its hits and passes; shared hosts pass', () => {
  const build = artifact('build', { 'app.js': 'const API="https://api.facemorph.me/api/face/";' });
  const r = run(build);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"name":"api.facemorph.me"/);
  const control = artifact('control', { 'app.js': 'link="https://checkface.facemorph.me"' });
  const c = run(control);
  assert.equal(c.status, 0);
  assert.match(c.stdout, /"mode":"report".*"hits":1/);
  const shared = artifact('build', {
    'app.js': 'm="https://models.facemorph.me/runtime/manifest.json"',
  });
  assert.equal(run(shared).status, 0);
  for (const d of [build, control, shared]) rmSync(d, { recursive: true });
});

test('real-ui-cpu refuses a runtime whose manifest is not the pinned runtime_sha, before anything starts', () => {
  const pinned = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
  assert.equal(runtimeRefusal(pinned, pinned), null);
  assert.match(runtimeRefusal(pinned, 'f'.repeat(64)) ?? '', /refused before the browser starts/);
  assert.match(runtimeRefusal(pinned, null) ?? '', /refused before the browser starts/);
  assert.match(runtimeRefusal('D9E37E', pinned) ?? '', /64 lowercase hex/);
});

test("real-ui-cpu: only GA4's approved loader URL is analytics; every other Google origin stays third-party", () => {
  const map = {
    version: DEFAULT_HOST_MAP.version,
    rules: [ANALYTICS_RULE, ...DEFAULT_HOST_MAP.rules],
  };
  assert.equal(classify('https://www.googletagmanager.com/gtag/js?id=G-X', map), 'analytics');
  for (const url of [
    'https://www.googletagmanager.com/gtm.js?id=GTM-X',
    'https://www.google-analytics.com/g/collect?v=2',
    'https://region1.google-analytics.com/g/collect',
    'https://googletagmanager.com/gtag/js?id=G-X',
  ])
    assert.equal(classify(url, map), 'third-party', url);
  assert.equal(classify('https://next.facemorph.me/', map), 'app');
  assert.equal(
    classify('https://www.googletagmanager.com/gtag/js', DEFAULT_HOST_MAP),
    'third-party',
  );
});

// Shaped like a real run's probe events (e2e7 on the control: 2 generate, 1 encode, 4 synthesize, 28 morph frames).
const ev = (op, reply, n = 1) => Array.from({ length: n }, () => ({ op, reply }));
const REAL = [
  ...ev('generate', 'complete', 2),
  ...ev('synthesize', 'complete'),
  ...ev('encode-aligned', 'complete'),
  ...ev('synthesize', 'complete', 3),
  ...ev('synthesize-frames', 'frame', 28),
  ...ev('synthesize-frames', 'complete', 2),
];
const REPORT = {
  checks: {
    nameSeed: {
      dimensions: [
        [1024, 1024],
        [1024, 1024],
      ],
    },
  },
};
const req = (url, bytes, initiator = 'worker') => ({ url, bytes, initiator, hostClass: 'app' });
const REC = {
  requests: [
    req('https://next.facemorph.me/runtime/chunks/a142.bin', 15807857),
    req('https://next.facemorph.me/runtime/encoder-stream/:hex/part-001.onnx', 16682611),
  ],
};

test('real-ui-cpu inference: a real run passes; a mocked or partial one fails with its reason named', () => {
  assert.equal(inferenceVerdict(REAL, REPORT, REC).verdict, 'pass');
  const reasons = (events, report = REPORT, rec = REC) =>
    inferenceVerdict(events, report, rec).reasons;
  // A mocked engine: the UI shows faces, but no worker answered a model operation and no weights moved.
  assert.deepEqual(reasons([], REPORT, { requests: [] }), [
    '0 generate completions for 2 faces',
    'no completed e4e encode',
    'the encoded face was never synthesized',
    'no morph frames',
    'no generator chunk bytes fetched by a worker',
    'no encoder stream bytes fetched by a worker',
  ]);
  // Replies without weights (an engine that answers from canned frames) still fail.
  assert.deepEqual(reasons(REAL, REPORT, { requests: [] }), [
    'no generator chunk bytes fetched by a worker',
    'no encoder stream bytes fetched by a worker',
  ]);
  // The page fetching the weights is not a worker running them.
  assert.equal(
    inferenceVerdict(REAL, REPORT, {
      requests: REC.requests.map((r) => ({ ...r, initiator: 'page' })),
    }).verdict,
    'fail',
  );
  assert.deepEqual(reasons(REAL.filter((e, i) => !(e.op === 'generate' && i === 0))), [
    '1 generate completions for 2 faces',
  ]);
  // An encode whose face is never rendered, and an encode before which all synthesis happened.
  assert.deepEqual(reasons(REAL.filter((e) => e.op !== 'synthesize')), [
    'the encoded face was never synthesized',
  ]);
  assert.deepEqual(reasons(REAL, {}), ['the journey reported no generated faces']);
});

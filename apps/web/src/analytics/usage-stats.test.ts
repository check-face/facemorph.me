// fm-5yqq: the changeover statistics sink. Opt-outs, the candidate's event definitions (its usage-stats.test.mjs
// cases give the same events), the three like-for-like kinds, the batching rule and the switch.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD,
  FLUSH_AT,
  FLUSH_EVERY_MS,
  MAX_BYTES,
  OPT_OUT_KEY,
  allowed,
  bodies,
  createSink,
  environmentBlock,
  platformClass,
  shouldFlush,
  toStatsEvent,
  type StatsEnv,
  type StatsEvent,
} from './usage-stats.ts';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile Safari/604.1';

interface Fake {
  host?: string;
  nav?: Record<string, unknown>;
  store?: Record<string, string>;
  dnt?: string;
  throwing?: boolean;
}
function env({ host = 'next.facemorph.me', nav = {}, store = {}, dnt, throwing }: Fake = {}) {
  const handlers: Record<string, () => void> = {};
  const document = {
    visibilityState: 'visible',
    addEventListener: (name: string, fn: () => void) => void (handlers[`doc:${name}`] = fn),
  };
  const fail = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  const e: StatsEnv & { handlers: typeof handlers; document: typeof document } = {
    location: { hostname: host, protocol: 'https:' },
    navigator: { userAgent: iphone, ...nav },
    localStorage: throwing
      ? { getItem: fail, setItem: fail, removeItem: fail }
      : {
          getItem: (k) => store[k] ?? null,
          setItem: (k, v) => void (store[k] = v),
          removeItem: (k) => void delete store[k],
        },
    doNotTrack: dnt,
    document,
    handlers,
    addEventListener: (name, fn) => void (handlers[name] = fn),
  };
  return e;
}
const parse = (text: string) =>
  JSON.parse(text) as { v: number; app: string; events: StatsEvent[] };

test('off under GPC, Do Not Track, Save-Data, automation, other hosts and the switch; on for both production hosts', () => {
  assert.equal(allowed(env()), true);
  assert.equal(allowed(env({ host: 'facemorph.me' })), true);
  assert.equal(allowed(env({ host: 'labs.facemorph.me' })), false);
  assert.equal(allowed(env({ host: 'localhost' })), false);
  assert.equal(
    allowed({ ...env(), location: { hostname: 'next.facemorph.me', protocol: 'http:' } }),
    false,
  );
  assert.equal(allowed(env({ nav: { webdriver: true } })), false);
  assert.equal(allowed(env({ nav: { globalPrivacyControl: true } })), false);
  assert.equal(allowed(env({ nav: { doNotTrack: '1' } })), false);
  assert.equal(allowed(env({ dnt: '1' })), false);
  assert.equal(allowed(env({ nav: { connection: { saveData: true } } })), false);
  assert.equal(allowed(env({ store: { [OPT_OUT_KEY]: 'off' } })), false);
  assert.equal(environmentBlock(env({ nav: { globalPrivacyControl: true } })), 'gpc');
  assert.equal(
    environmentBlock(env({ nav: { webdriver: true } }), { allowAutomation: true }),
    null,
  );
});

test('a throwing storage leaves statistics on and never throws into the caller', () => {
  const e = env({ throwing: true });
  assert.equal(allowed(e), true);
  const sent: string[] = [];
  const sink = createSink({ env: e, send: (b) => sent.push(b), now: () => 0 });
  assert.doesNotThrow(() => sink.record('visit', { visit: 'first' }));
  sink.flush();
  assert.equal(sent.length, 1);
  // The switch still works for the tab, and says it was not saved.
  assert.equal(sink.setOn(false), false);
  sink.record('visit', { visit: 'first' });
  sink.flush();
  assert.equal(sent.length, 1);
  assert.equal(sink.setOn(true), false);
  sink.record('visit', { visit: 'first' });
  sink.flush();
  assert.equal(sent.length, 2);
});

test("the candidate's mapping cases give the same events", () => {
  assert.deepEqual(
    toStatsEvent(
      'job',
      { action: 'photo', route: 'cpu', outcome: 'completed', ms: 31234.6 },
      'ios',
    ),
    { t: 'job', action: 'photo', route: 'cpu', outcome: 'completed', platform: 'ios', ms: 31235 },
  );
  assert.equal(toStatsEvent('job', { action: 'import', outcome: 'completed' }, 'ios'), null);
  const webgl = toStatsEvent(
    'job',
    { action: 'face', route: 'webgl', outcome: 'failed', ms: 5 },
    'desktop',
  );
  assert.equal(webgl?.t === 'job' && webgl.route, 'unknown');
  const failed = toStatsEvent(
    'job',
    { action: 'face', route: 'cpu', outcome: 'failed', ms: 5 },
    'desktop',
  );
  assert.equal(failed?.t === 'job' && failed.ms, undefined);
  const morph = toStatsEvent(
    'job',
    { action: 'morph', route: 'cpu', outcome: 'interrupted' },
    'android',
  );
  assert.equal(morph?.t === 'job' && morph.outcome, 'cancelled');
  assert.equal(toStatsEvent('export', { kind: 'project', method: 'save' }, 'ios'), null);
  assert.equal(platformClass({ userAgent: iphone }), 'ios');
  assert.equal(platformClass({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'desktop');
  assert.equal(platformClass({ userAgent: 'Mozilla/5.0 (Linux; Android 10)' }), 'android');
  assert.equal(platformClass({ userAgent: 'curl/8' }), 'unknown');
});

test('blend, faces as face, clamped durations, every other kind, and malformed events dropped', () => {
  assert.deepEqual(
    toStatsEvent(
      'job',
      { action: 'blend', route: 'webgpu', outcome: 'completed', ms: 9e9 },
      'desktop',
    ),
    {
      t: 'job',
      action: 'blend',
      route: 'webgpu',
      outcome: 'completed',
      platform: 'desktop',
      ms: 3.6e6,
    },
  );
  const faces = toStatsEvent(
    'job',
    { action: 'faces', route: 'auto', outcome: 'cancelled' },
    'ios',
  );
  assert.equal(faces?.t === 'job' && faces.action, 'face');
  assert.deepEqual(toStatsEvent('visit', { visit: 'returning' }, 'android'), {
    t: 'visit',
    platform: 'android',
    visit: 'returning',
  });
  assert.deepEqual(toStatsEvent('visit', { visit: 'weird' }, 'android'), {
    t: 'visit',
    platform: 'android',
    visit: 'first',
  });
  assert.deepEqual(toStatsEvent('ttfr', { cache: 'warm', ms: 1500.4 }, 'ios'), {
    t: 'ttfr',
    cache: 'warm',
    platform: 'ios',
    ms: 1500,
  });
  assert.deepEqual(toStatsEvent('frames', { n: 120.2 }, 'ios'), {
    t: 'frames',
    platform: 'ios',
    n: 120,
  });
  assert.deepEqual(toStatsEvent('export', { kind: 'video', method: 'share' }, 'ios'), {
    t: 'export',
    kind: 'video',
    method: 'share',
  });
  assert.deepEqual(toStatsEvent('model_mb', { mb: 211.66 }, 'ios'), {
    t: 'model_mb',
    cache: 'cold',
    platform: 'ios',
    mb: 211.7,
  });
  for (const [kind, data] of [
    ['job', { action: 'face', route: 'cpu', outcome: 'done' }],
    ['job', { action: '<script>', outcome: 'completed' }],
    ['ttfr', { ms: -1 }],
    ['ttfr', { ms: Number.NaN }],
    ['ttfr', { ms: '12' }],
    ['frames', { n: 0 }],
    ['frames', { n: Infinity }],
    ['export', { kind: 'image', method: 'open' }],
    ['model_mb', { mb: -3 }],
    ['words', { value: 'emma' }],
    ['job_warm', { action: 'face', ms: 3 }],
  ] as const)
    assert.equal(toStatsEvent(kind, data, 'ios'), null, `${kind} ${JSON.stringify(data)}`);
});

function job(
  sink: ReturnType<typeof createSink>,
  action: string,
  stages: [string, Record<string, unknown>][],
  outcome = 'completed',
) {
  sink.record('start', { action, route: 'cpu' });
  for (const [name, event] of stages) sink.stage(name, event);
  sink.record('job', { action, route: 'cpu', outcome, ms: 900 });
}

test('job_warm only for a completed job that loaded no model; compute per face or photo encode; model by phase', () => {
  const sent: string[] = [];
  const sink = createSink({ env: env(), send: (b) => sent.push(b), now: () => 0 });
  // A cold first face: the model was fetched, then loaded.
  job(sink, 'face', [
    ['asset-acquisition', { loaded: 10, total: 10, fetched: 10, fetchedTotal: 10 }],
    ['model-loading', {}],
    ['model-loaded', { elapsedMs: 4200 }],
    ['synthesis', {}],
    ['synthesis-complete', { elapsedMs: 1600 }],
  ]);
  // A warm face: only synthesis. A canary's synthesis is qualification, not a face.
  job(sink, 'face', [
    ['canary', { name: 'c1', loaded: 0, total: 2 }],
    ['synthesis', {}],
    ['synthesis-complete', { elapsedMs: 1700 }],
    ['synthesis', {}],
    ['synthesis-complete', { elapsedMs: 1500 }],
  ]);
  // A reload restores the model from the cache.
  job(sink, 'faces', [
    ['asset-acquisition', { loaded: 10, total: 10, fetched: 0, fetchedTotal: 0 }],
    ['model-loaded', { elapsedMs: 800 }],
    ['synthesis-complete', { elapsedMs: 1400 }],
    ['synthesis-complete', { elapsedMs: 1450 }],
  ]);
  // A photo: its compute is the encode; a warm cancelled job is not job_warm.
  job(sink, 'photo', [
    ['encoder-loaded', { elapsedMs: 300 }],
    ['encoding-complete', { elapsedMs: 9000 }],
    ['synthesis-complete', { elapsedMs: 1500 }],
  ]);
  job(sink, 'face', [['synthesis-complete', { elapsedMs: 1500 }]], 'cancelled');
  // A morph: frames are not per-face compute.
  job(sink, 'morph', [
    ['synthesis-complete', { elapsedMs: 700 }],
    ['synthesis-complete', { elapsedMs: 700 }],
  ]);
  sink.flush();
  const events = sent.flatMap((b) => parse(b).events);
  const of = (t: string) => events.filter((e) => e.t === t);
  assert.deepEqual(of('job_warm'), [
    { t: 'job_warm', action: 'face', route: 'cpu', platform: 'ios', ms: 900 },
    { t: 'job_warm', action: 'morph', route: 'cpu', platform: 'ios', ms: 900 },
  ]);
  assert.deepEqual(
    of('compute').map((e) => (e.t === 'compute' ? [e.action, e.ms] : null)),
    [
      ['face', 1600],
      ['face', 1500],
      ['face', 1400],
      ['face', 1450],
      ['photo', 9000],
      ['face', 1500],
    ],
  );
  assert.deepEqual(of('model'), [
    { t: 'model', phase: 'download', platform: 'ios', ms: 4200 },
    { t: 'model', phase: 'cache', platform: 'ios', ms: 800 },
  ]);
  assert.equal(of('job').length, 6);
  // A stage with no job running is ignored; a job event with no start still counts as a job only.
  sink.stage('model-loaded', { elapsedMs: 5 });
  sink.record('job', { action: 'face', route: 'cpu', outcome: 'completed', ms: 4 });
  sink.flush();
  assert.deepEqual(
    parse(sent.at(-1)!).events.map((e) => e.t),
    ['job'],
  );
});

test('the batching rule and the split are pure functions of plain values', () => {
  assert.equal(shouldFlush(FLUSH_AT - 1, 0, 0), false);
  assert.equal(shouldFlush(FLUSH_AT, 0, 0), true);
  assert.equal(shouldFlush(1, FLUSH_EVERY_MS - 1, 0), false);
  assert.equal(shouldFlush(1, FLUSH_EVERY_MS, 0), true);
  const events: StatsEvent[] = Array.from({ length: 200 }, (_, i) => ({
    t: 'job',
    action: 'face',
    route: 'webgpu',
    outcome: 'completed',
    platform: 'desktop',
    ms: i * 1000,
  }));
  const parts = bodies(events);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((b) => b.length <= MAX_BYTES));
  assert.deepEqual(
    parts.flatMap((b) => parse(b).events),
    events,
  );
  for (const b of parts) assert.deepEqual(Object.keys(parse(b)), ['v', 'app', 'events']);
  assert.equal(parse(parts[0]!).app, BUILD);
  assert.equal(BUILD, 'monorepo');
});

test('the sink batches until 150 events, 60 s, page hide or a hidden page; nothing identifying is sent', () => {
  let clock = 0;
  const sent: string[] = [];
  const e = env();
  const sink = createSink({ env: e, send: (b) => sent.push(b), now: () => clock });
  for (let i = 0; i < FLUSH_AT - 1; i++) sink.record('visit', { visit: 'first' });
  assert.equal(sent.length, 0);
  sink.record('visit', { visit: 'first' });
  assert.equal(
    sent.reduce((n, b) => n + parse(b).events.length, 0),
    FLUSH_AT,
  );
  sent.length = 0;
  sink.record('visit', { visit: 'first' });
  clock += FLUSH_EVERY_MS;
  sink.record('visit', { visit: 'returning' });
  assert.equal(sent.length, 1);
  sink.record('export', { kind: 'image', method: 'save' });
  e.handlers['pagehide']!();
  assert.equal(sent.length, 2);
  sink.record('export', { kind: 'image', method: 'save' });
  e.document.visibilityState = 'hidden';
  e.handlers['doc:visibilitychange']!();
  assert.equal(sent.length, 3);
  assert.ok(!sent.some((b) => /iPhone|Safari|next\.facemorph/.test(b)));
});

test('a throwing sendBeacon never reaches the product', () => {
  const e = {
    ...env(),
    navigator: {
      userAgent: iphone,
      sendBeacon: () => {
        throw new Error('blocked');
      },
    },
  };
  const sink = createSink({ env: e, now: () => 0 });
  sink.record('visit', { visit: 'first' });
  assert.doesNotThrow(() => sink.flush());
  assert.equal(sink.pending(), 0);
});

test('the switch: Off saves the opt-out, drops the queue and stops sending; On removes it and resumes', () => {
  const store: Record<string, string> = {};
  const sent: string[] = [];
  const sink = createSink({ env: env({ store }), send: (b) => sent.push(b), now: () => 0 });
  sink.record('visit', { visit: 'first' });
  assert.equal(sink.setOn(false), true);
  assert.equal(store[OPT_OUT_KEY], 'off');
  assert.equal(sink.pending(), 0);
  sink.record('job', { action: 'face', route: 'cpu', outcome: 'completed', ms: 3 });
  sink.flush();
  assert.deepEqual(sent, []);
  assert.equal(sink.setOn(true), true);
  assert.equal(OPT_OUT_KEY in store, false);
  sink.record('job', { action: 'face', route: 'cpu', outcome: 'completed', ms: 3 });
  sink.flush();
  assert.equal(sent.length, 1);
});

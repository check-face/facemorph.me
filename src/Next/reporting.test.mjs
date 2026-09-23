import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Browser globals the reporter legitimately depends on, supplied here rather than mocked away.
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.CustomEvent) globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

/**
 * C-09. The operator turned debug reporting on during a run and got nothing back. These drive
 * the client the way they did: consent arrives in the middle of a job, the page is backgrounded
 * before it ends, and a reference has to come out the other side that a human can read out.
 */
const listeners = new Map();
function browser() {
  const store = new Map();
  const posts = [];
  const events = [];
  globalThis.window = { dispatchEvent: event => { events.push(event.detail); return true; } };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn)
  };
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0', language: 'en-AU', platform: 'Linux armv8l', maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 8 }
  });
  globalThis.fetch = async (url, options) => {
    // Events now leave in batches; the tests read one post per event, so unwrap here. This keeps
    // every existing assertion about field shape honest without rewriting each of them.
    const parsed = JSON.parse(options.body);
    const { events = [null], ...common } = parsed;
    for (const event of events)
      posts.push({ url, keepalive: options.keepalive === true, consent: options.headers['X-Facemorph-Diagnostics-Consent'],
        body: event ? { ...common, ...event } : parsed });
    return { ok: true };
  };
  return { store, posts, events };
}
let loaded = 0;
async function fresh() {
  const world = browser();
  const { diagnostics } = await import(`./reporting.mjs?case=${loaded++}`);
  return { ...world, diagnostics, hide: () => { globalThis.document.visibilityState = 'hidden'; listeners.get('visibilitychange')(); } };
}
// Events leave in batches on a timer now, so "let everything happen" means flushing the buffer
// too. Tests drive it explicitly rather than waiting out the real window.
const settle = async (diagnostics) => {
  diagnostics?.flush?.();
  await new Promise(resolve => setTimeout(resolve, 0));
  diagnostics?.flush?.();
  await new Promise(resolve => setTimeout(resolve, 0));
};

test('consent given in the middle of a run still produces a complete record for that run', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('a'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('model-loading', { elapsedMs: 10 });
  diagnostics.stage('synthesis', { elapsedMs: 20 });
  assert.deepEqual(posts, [], 'nothing may leave the device before consent');
  diagnostics.enable(true);                       // the tester says yes, mid-run
  diagnostics.stage('synthesis-complete', { elapsedMs: 30 });
  diagnostics.finish('completed');
  await settle(diagnostics);
  assert.ok(posts.length >= 5, `only ${posts.length} events`);
  const runs = new Set(posts.map(p => p.body.run)), sessions = new Set(posts.map(p => p.body.session));
  assert.equal(runs.size, 1, 'one run');
  assert.equal(sessions.size, 1, 'one session');
  assert.ok([...runs][0], 'the run has an identity');
  const kinds = posts.map(p => p.body.event);
  assert.equal(kinds.filter(k => k === 'start').length, 1);
  assert.ok(kinds.filter(k => k === 'stage').length >= 1);
  assert.ok(diagnostics.terminalEvents().has(kinds.at(-1)), 'the run is closed by a terminal event');
  // Every event says which bundle produced it, including the first one.
  for (const post of posts) assert.equal(post.body.bundle, 'a'.repeat(64));
});

test('the start event waits for the bundle hash rather than going out without it', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.enable(true);
  diagnostics.start('faces', 'cpu');
  await settle(diagnostics);
  assert.deepEqual(posts, [], 'a start event with no bundle identifies nothing');
  diagnostics.bundle('b'.repeat(64));
  await settle(diagnostics);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.event, 'start');
  assert.equal(posts[0].body.bundle, 'b'.repeat(64));
});

test('turning consent on twice is a no-op, not a reset that discards the run', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('c'.repeat(64));
  diagnostics.start('morph', 'cpu');
  diagnostics.enable(true);
  await settle(diagnostics);
  const session = posts[0].body.session, run = posts[0].body.run;
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  diagnostics.finish('completed');
  await settle(diagnostics);
  assert.equal(new Set(posts.map(p => p.body.session)).size, 1);
  assert.equal(posts.at(-1).body.session, session);
  assert.equal(posts.at(-1).body.run, run);
});

test('withdrawing consent stops sending and drops the buffer, without ending the job', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('d'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  await settle(diagnostics);
  const run = posts[0].body.run;
  diagnostics.enable(false);
  assert.equal(diagnostics.status().staged, 0, 'the buffer is dropped the moment consent ends');
  const after = posts.length;
  // Staging resumes, on the device only: this is what lets a tester send what led up to a failure.
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  await settle(diagnostics);
  assert.equal(posts.length, after, 'nothing leaves the device once consent is withdrawn');
  assert.equal(diagnostics.status().staged, 1);
  // The run is still the same run: consent coming back reports the rest of it, not a new one.
  diagnostics.enable(true);
  diagnostics.stage('synthesis-complete', { elapsedMs: 6 });
  diagnostics.finish('completed');
  await settle(diagnostics);
  assert.ok(posts.length > after);
  for (const post of posts.slice(after)) assert.equal(post.body.run, run);
});

test('the page going away mid-run still closes the run, with keepalive', async () => {
  const { diagnostics, posts, hide } = await fresh();
  diagnostics.bundle('e'.repeat(64));
  diagnostics.start('morph', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  await settle(diagnostics);
  assert.ok(!posts.some(p => diagnostics.terminalEvents().has(p.body.event)));
  hide();
  await settle(diagnostics);
  const terminal = posts.filter(p => diagnostics.terminalEvents().has(p.body.event));
  assert.equal(terminal.length, 1, 'exactly one terminal event for a backgrounded run');
  assert.equal(terminal[0].body.event, 'interrupted');
  assert.equal(terminal[0].keepalive, true, 'a terminal event must survive the page');
  assert.equal(terminal[0].body.run, posts[0].body.run);
  // Hiding twice does not file the run twice.
  hide();
  await settle(diagnostics);
  assert.equal(posts.filter(p => p.body.event === 'interrupted').length, 1);
});

test('a finished run is reported once, with keepalive, and not again when the page hides', async () => {
  const { diagnostics, posts, hide } = await fresh();
  diagnostics.bundle('f'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.finish('completed');
  diagnostics.finish('failed', Error('late'));
  await settle(diagnostics);
  const terminal = posts.filter(p => diagnostics.terminalEvents().has(p.body.event));
  assert.deepEqual(terminal.map(p => p.body.event), ['completed']);
  assert.equal(terminal[0].keepalive, true);
  hide();
  await settle(diagnostics);
  assert.equal(posts.filter(p => p.body.event === 'interrupted').length, 0);
});

test('the reference names the run events were filed under, and one outcome is reported per run', async () => {
  const { diagnostics, events } = await fresh();
  diagnostics.bundle('0'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 1 });
  diagnostics.finish('completed');
  await settle(diagnostics);
  const last = events.at(-1);
  assert.equal(last.status, 'sent');
  assert.match(last.reference, /^[0-9a-f-]{36}$/);
  assert.equal(last.failed, 0);
  assert.ok(last.sent >= 3, 'the outcome counts the whole run, not the last POST');
  const reference = last.reference;
  // It survives everything short of the next run.
  diagnostics.stage('synthesis', { elapsedMs: 2 });
  await settle(diagnostics);
  assert.equal(diagnostics.status().reference, reference);
  diagnostics.start('faces', 'cpu');
  assert.equal(diagnostics.status().reference, '', 'the next run clears the old reference');
});

test('the reference a tester must hold arrives as its own stable payload, not status churn', async () => {
  const { diagnostics, posts, events } = await fresh();
  diagnostics.bundle('5'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('model-loading', { elapsedMs: 5 });
  assert.equal(events.filter(e => e.state !== undefined).length, 0, 'no reference is offered for a run consent has not opened');
  diagnostics.enable(true);                       // mid-run yes: the already-elapsed work gets its name
  await settle(diagnostics);
  let refs = events.filter(e => e.state !== undefined);
  assert.equal(refs.length, 1, 'one open reference, not one per POST');
  assert.equal(refs[0].state, 'open');
  const held = refs[0].run;
  assert.ok(posts.length > 0);
  assert.equal(posts[0].body.run, held, 'the held reference is the run the events were filed under');
  diagnostics.finish('completed');
  await settle(diagnostics);
  refs = events.filter(e => e.state !== undefined);
  assert.equal(refs.length, 2);
  assert.equal(refs[1].state, 'closed');
  assert.equal(refs[1].terminal, 'completed');
  assert.equal(refs[1].run, held, 'the reference survives the close, not just the open');
  diagnostics.start('faces', 'cpu');              // only the next run replaces it
  refs = events.filter(e => e.state !== undefined);
  assert.equal(refs.length, 3);
  assert.equal(refs[2].state, 'open');
  assert.notEqual(refs[2].run, held);
});

test('one failed POST does not hide the rest, and one late success does not hide a failure', async () => {
  const { diagnostics, events } = await fresh();
  // A batch carries several events, so a failure now fails all of its members at once. The
  // guarantee is unchanged: one bad delivery is reported as failed and does not erase the
  // successes, and a later success does not erase the failure.
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: calls !== 2 }; };
  diagnostics.bundle('1'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 1 });
  await settle(diagnostics);            // first delivery succeeds
  diagnostics.stage('synthesis-complete', { elapsedMs: 2 });
  await settle(diagnostics);            // second fails
  diagnostics.finish('completed');
  await settle(diagnostics);            // third succeeds
  const last = events.at(-1);
  assert.equal(last.status, 'failed', 'a later success does not erase the failure');
  assert.ok(last.failed >= 1, 'the failure is counted');
  assert.ok(last.sent >= 1, 'the successes are still counted');
});

test('consent that cannot be written down says so instead of promising to stay on', async () => {
  const { diagnostics } = await fresh();
  globalThis.localStorage.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  diagnostics.enable(true);
  assert.equal(diagnostics.status().enabled, true);
  assert.equal(diagnostics.status().persisted, false);
});

test('every POST carries the consent header, so an unauthenticated one stays impossible', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('2'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.finish('completed');
  await settle(diagnostics);
  assert.ok(posts.length > 0);
  for (const post of posts) {
    assert.equal(post.consent, 'session-v1');
    assert.equal(post.url, 'https://next.facemorph.me/diagnostics/events');
  }
});

test('two different stages a few milliseconds apart are two events, not one', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('3'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  // No elapsedMs, so these are exactly the bursty boundaries the old shared clock swallowed.
  diagnostics.stage('runtime-loading');
  diagnostics.stage('model-loading');
  diagnostics.stage('model-loaded');
  diagnostics.stage('model-loaded');
  await settle(diagnostics);
  const stages = posts.filter(p => p.body.event === 'stage').map(p => p.body.stage);
  assert.deepEqual(stages, ['runtime-loading', 'model-loading', 'model-loaded']);
});

test('a stage outside the allowlist is never forwarded', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('4'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('gpu-stage', { name: 'anything' });
  diagnostics.stage('fallback-cpu');
  await settle(diagnostics);
  const stages = posts.filter(p => p.body.event === 'stage').map(p => p.body.stage);
  assert.deepEqual(stages, ['fallback-cpu']);
});

test('the storage stage carries the persistence truth and rounded megabytes (R2-15)', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('b'.repeat(64));
  diagnostics.enable(true);
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('storage', { persisted: true, usageMb: 812, quotaMb: 1024 });
  await settle(diagnostics);
  const row = posts.map(p => p.body).find(b => b.stage === 'storage');
  assert.ok(row, 'the storage stage is reported');
  assert.equal(row.persisted, true);
  assert.equal(row.usageMb, 812);
  assert.equal(row.quotaMb, 1024);
  // Non-finite figures are dropped rather than invented: closed fields only.
  diagnostics.stage('storage', { persisted: false, usageMb: Number.NaN });
  await settle(diagnostics);
  const second = posts.map(p => p.body).filter(b => b.stage === 'storage').at(-1);
  assert.equal(second.persisted, false);
  assert.equal(second.usageMb, undefined);
  assert.equal(second.quotaMb, undefined);
});
test('a photo-preparation failure is reported with its stage and kind, not lost (R2-15)', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('c'.repeat(64));
  diagnostics.enable(true);
  // The wrapper lives in product-bridge; its contract is driven here through the same
  // diagnostics calls it makes: a photo run opens, the crop stage fails, the run closes.
  diagnostics.start('photo', 'auto');
  diagnostics.stage('photo-crop', {});
  diagnostics.finish('failed', Error('This photo could not be read. Try a JPEG or PNG copy.'), { stage: 'photo-crop' });
  await settle(diagnostics);
  const terminal = posts.map(p => p.body).at(-1);
  assert.equal(terminal.errorStage, 'photo-crop', 'the record names the exact step');
  assert.equal(terminal.errorKind, 'decode', 'the failure is bucketed as a decode failure');
});

// --- Consent recording (round 3, R3-02 / R3-14) -------------------------------------------------
function sessionStore() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  return store;
}
const failingRun = diagnostics => {
  diagnostics.bundle('e'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  diagnostics.finish('failed', new Error('Stored asset disappeared; acquire again'), { stage: 'synthesis' });
};

test('a choice records how and when it was made, and every report carries its basis', async () => {
  const { diagnostics, posts, store } = await fresh();
  diagnostics.enable(true, 'toast');
  const saved = JSON.parse(store.get('facemorph-debug-consent-v1'));
  assert.equal(saved.choice, 'on');
  assert.equal(saved.basis, 'toast');
  assert.match(saved.at, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(saved.policy, 'the disclosure version is recorded');
  failingRun(diagnostics);
  await settle(diagnostics);
  assert.ok(posts.length > 0);
  for (const post of posts) assert.equal(post.body.consent, 'toast');
});

test('a "no" is remembered, so a first-visit prompt is not asked again, and nothing is sent', async () => {
  const { diagnostics, posts, store } = await fresh();
  assert.equal(diagnostics.answered(), false);
  diagnostics.enable(false, 'toast');
  assert.equal(diagnostics.answered(), true);
  assert.equal(JSON.parse(store.get('facemorph-debug-consent-v1')).choice, 'off');
  assert.equal(diagnostics.restore(), false, 'a stored no never restores reporting');
  failingRun(diagnostics);
  await settle(diagnostics);
  assert.deepEqual(posts, []);
});

test('"Send this report" sends one failure once, without a device id, and leaves reporting off', async () => {
  const { diagnostics, posts, store } = await fresh();
  failingRun(diagnostics);
  assert.ok(diagnostics.status().staged > 0);
  assert.equal(diagnostics.sendOnce(), true);
  await settle(diagnostics);
  assert.ok(posts.length > 0, 'the staged failure went out');
  for (const post of posts) {
    assert.equal(post.body.consent, 'once');
    assert.equal(post.body.device, undefined, 'a one-off report carries no device id');
  }
  assert.equal(diagnostics.status().enabled, false, 'no standing consent was created');
  assert.equal(store.get('facemorph-debug-consent-v1'), undefined, 'and none was stored');
  assert.equal(store.get('facemorph-debug-device-v1'), undefined);
  assert.ok(diagnostics.status().reference, 'the tester is handed the reference it was filed under');
  const sent = posts.length;
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  await settle(diagnostics);
  assert.equal(posts.length, sent, 'the next run is not reported');
});

test('withdrawal discards undelivered events and the device id; a later yes cannot send them', async () => {
  const { diagnostics, posts, store } = await fresh();
  const pending = sessionStore();
  diagnostics.enable(true);
  assert.ok(store.get('facemorph-debug-device-v1'), 'a consenting device groups its runs');
  diagnostics.bundle('f'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.stage('synthesis', { elapsedMs: 5 });   // batched, not yet delivered
  assert.ok(pending.size > 0, 'the batch is mirrored for reload survival');
  diagnostics.enable(false);
  assert.equal(pending.size, 0, 'the mirror is cleared on withdrawal');
  assert.equal(store.get('facemorph-debug-device-v1'), undefined, 'the device id is forgotten');
  await settle(diagnostics);
  assert.deepEqual(posts.filter(p => p.body.event === 'start'), [], 'the withdrawn run start never left');
  diagnostics.enable(true);
  await settle(diagnostics);
  assert.deepEqual(posts, [], 'events accepted before the withdrawal are gone, not held for the next yes');
  delete globalThis.sessionStorage;
});

test('labs starts with reporting on and says so; an explicit no there is still respected', async () => {
  globalThis.location = { hostname: 'labs.facemorph.me' };
  try {
    const first = await fresh();
    assert.equal(first.diagnostics.restore(), true);
    assert.equal(first.diagnostics.status().enabled, true);
    assert.equal(first.diagnostics.status().basis, 'labs-default');
    assert.ok(first.events.some(e => e.status === 'enabled'), 'the on state is announced, never silent');
    const second = await fresh();
    second.store.set('facemorph-debug-consent-v1', JSON.stringify({ choice: 'off', basis: 'checkbox' }));
    assert.equal(second.diagnostics.restore(), false);
    assert.equal(second.diagnostics.status().enabled, false);
  } finally { delete globalThis.location; }
});

test('the product origin never starts reporting without an answer, and a legacy "on" still restores', async () => {
  globalThis.location = { hostname: 'next.facemorph.me' };
  try {
    const first = await fresh();
    assert.equal(first.diagnostics.restore(), false);
    const second = await fresh();
    second.store.set('facemorph-debug-consent-v1', 'on');
    assert.equal(second.diagnostics.restore(), true);
    assert.equal(second.diagnostics.status().basis, 'legacy');
  } finally { delete globalThis.location; }
});

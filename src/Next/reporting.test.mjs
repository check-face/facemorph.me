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
    posts.push({ url, keepalive: options.keepalive === true, consent: options.headers['X-Facemorph-Diagnostics-Consent'], body: JSON.parse(options.body) });
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
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

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
  await settle();
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
  await settle();
  assert.deepEqual(posts, [], 'a start event with no bundle identifies nothing');
  diagnostics.bundle('b'.repeat(64));
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.event, 'start');
  assert.equal(posts[0].body.bundle, 'b'.repeat(64));
});

test('turning consent on twice is a no-op, not a reset that discards the run', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('c'.repeat(64));
  diagnostics.start('morph', 'cpu');
  diagnostics.enable(true);
  await settle();
  const session = posts[0].body.session, run = posts[0].body.run;
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  diagnostics.finish('completed');
  await settle();
  assert.equal(new Set(posts.map(p => p.body.session)).size, 1);
  assert.equal(posts.at(-1).body.session, session);
  assert.equal(posts.at(-1).body.run, run);
});

test('withdrawing consent stops sending and drops the buffer, without ending the job', async () => {
  const { diagnostics, posts } = await fresh();
  diagnostics.bundle('d'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  await settle();
  const run = posts[0].body.run;
  diagnostics.enable(false);
  assert.equal(diagnostics.status().staged, 0, 'the buffer is dropped the moment consent ends');
  const after = posts.length;
  // Staging resumes, on the device only: this is what lets a tester send what led up to a failure.
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  await settle();
  assert.equal(posts.length, after, 'nothing leaves the device once consent is withdrawn');
  assert.equal(diagnostics.status().staged, 1);
  // The run is still the same run: consent coming back reports the rest of it, not a new one.
  diagnostics.enable(true);
  diagnostics.stage('synthesis-complete', { elapsedMs: 6 });
  diagnostics.finish('completed');
  await settle();
  assert.ok(posts.length > after);
  for (const post of posts.slice(after)) assert.equal(post.body.run, run);
});

test('the page going away mid-run still closes the run, with keepalive', async () => {
  const { diagnostics, posts, hide } = await fresh();
  diagnostics.bundle('e'.repeat(64));
  diagnostics.start('morph', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 5 });
  await settle();
  assert.ok(!posts.some(p => diagnostics.terminalEvents().has(p.body.event)));
  hide();
  await settle();
  const terminal = posts.filter(p => diagnostics.terminalEvents().has(p.body.event));
  assert.equal(terminal.length, 1, 'exactly one terminal event for a backgrounded run');
  assert.equal(terminal[0].body.event, 'interrupted');
  assert.equal(terminal[0].keepalive, true, 'a terminal event must survive the page');
  assert.equal(terminal[0].body.run, posts[0].body.run);
  // Hiding twice does not file the run twice.
  hide();
  await settle();
  assert.equal(posts.filter(p => p.body.event === 'interrupted').length, 1);
});

test('a finished run is reported once, with keepalive, and not again when the page hides', async () => {
  const { diagnostics, posts, hide } = await fresh();
  diagnostics.bundle('f'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.finish('completed');
  diagnostics.finish('failed', Error('late'));
  await settle();
  const terminal = posts.filter(p => diagnostics.terminalEvents().has(p.body.event));
  assert.deepEqual(terminal.map(p => p.body.event), ['completed']);
  assert.equal(terminal[0].keepalive, true);
  hide();
  await settle();
  assert.equal(posts.filter(p => p.body.event === 'interrupted').length, 0);
});

test('the reference names the run events were filed under, and one outcome is reported per run', async () => {
  const { diagnostics, events } = await fresh();
  diagnostics.bundle('0'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 1 });
  diagnostics.finish('completed');
  await settle();
  const last = events.at(-1);
  assert.equal(last.status, 'sent');
  assert.match(last.reference, /^[0-9a-f-]{36}$/);
  assert.equal(last.failed, 0);
  assert.ok(last.sent >= 3, 'the outcome counts the whole run, not the last POST');
  const reference = last.reference;
  // It survives everything short of the next run.
  diagnostics.stage('synthesis', { elapsedMs: 2 });
  await settle();
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
  await settle();
  let refs = events.filter(e => e.state !== undefined);
  assert.equal(refs.length, 1, 'one open reference, not one per POST');
  assert.equal(refs[0].state, 'open');
  const held = refs[0].run;
  assert.ok(posts.length > 0);
  assert.equal(posts[0].body.run, held, 'the held reference is the run the events were filed under');
  diagnostics.finish('completed');
  await settle();
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
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: calls !== 2 }; };
  diagnostics.bundle('1'.repeat(64));
  diagnostics.start('faces', 'cpu');
  diagnostics.enable(true);
  diagnostics.stage('synthesis', { elapsedMs: 1 });
  diagnostics.finish('completed');
  await settle();
  const last = events.at(-1);
  assert.equal(last.status, 'failed');
  assert.equal(last.failed, 1);
  assert.ok(last.sent >= 2, 'the successes are still counted');
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
  await settle();
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
  await settle();
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
  await settle();
  const stages = posts.filter(p => p.body.event === 'stage').map(p => p.body.stage);
  assert.deepEqual(stages, ['fallback-cpu']);
});

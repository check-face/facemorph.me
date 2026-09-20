// A generation that cannot reach device storage still has to finish. An IndexedDB open that
// neither succeeds nor fails — `blocked` while another tab holds an older version, or nothing at
// all while a deleteDatabase waits behind an open connection — used to hang the run with no
// message and no stage. The caller already treats an unavailable store as "generate without
// persistence"; these checks are what let it get there.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openOriginals} from './originals.mjs';

function withIndexedDb(t, behaviour) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const request = {onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null};
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true, writable: true,
    value: {open() { queueMicrotask(() => behaviour(request)); return request; }}
  });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'indexedDB', old); else delete globalThis.indexedDB; });
  return request;
}

const database = (closed = []) => ({close() { closed.push(true); }, transaction() { throw Error('unused'); }});

test('a store held open by another tab is refused rather than awaited forever', async t => {
  withIndexedDb(t, request => request.onblocked());
  await assert.rejects(openOriginals(), /held open by another tab/);
});

test('an open that never settles becomes a refusal, so the run can continue without storage', async t => {
  withIndexedDb(t, () => {}); // a pending deleteDatabase fires no event at all
  const began = Date.now();
  await assert.rejects(openOriginals(), /did not open/);
  assert.ok(Date.now() - began >= 4500, 'the wait is bounded, not instant');
});

test('a connection that arrives after the wait is closed rather than leaked', async t => {
  const closed = [];
  const request = withIndexedDb(t, () => {});
  await assert.rejects(openOriginals(), /did not open/);
  request.result = database(closed);
  request.onsuccess();
  assert.deepEqual(closed, [true]);
});

test('an ordinary open still resolves to a usable store', async t => {
  const request = withIndexedDb(t, item => { item.result = database(); item.onsuccess(); });
  const store = await openOriginals();
  assert.equal(typeof store.get, 'function');
  assert.equal(typeof store.put, 'function');
  store.close();
  assert.equal(request.onupgradeneeded === null, false, 'the schema upgrade stays wired');
});

test('an explicit open error is reported as itself', async t => {
  withIndexedDb(t, request => { request.error = Error('quota'); request.onerror(); });
  await assert.rejects(openOriginals(), /quota/);
});

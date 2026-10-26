import assert from 'node:assert/strict';
import test from 'node:test';
import { acquisitionPhase } from '../src/acquisition/phases.ts';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function cancelledWaiter() {
  const started = latch();
  const finish = latch();
  let active = 0;
  let peak = 0;
  const first = acquisitionPhase('hash', async () => {
    peak = Math.max(peak, ++active);
    started.release();
    await finish.promise;
    active--;
  });
  await started.promise;
  const stop = new AbortController();
  const reason = new Error('last owner cancelled while waiting for the hash phase');
  let cancelledRan = false;
  const cancelled = acquisitionPhase(
    'hash',
    () => {
      cancelledRan = true;
    },
    stop.signal,
  );
  const refused = assert.rejects(cancelled, (error) => error === reason);
  stop.abort(reason);
  await refused;
  let thirdRan = false;
  const third = acquisitionPhase('hash', () => {
    thirdRan = true;
    peak = Math.max(peak, ++active);
    active--;
  });
  // Let every queued promise reaction run: a cancelled middle waiter must not release the first.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(thirdRan, false);
  assert.equal(cancelledRan, false);
  finish.release();
  await Promise.all([first, third]);
  assert.equal(thirdRan, true);
  assert.equal(peak, 1);
  assert.equal(active, 0);
}

test('a cancelled native-lock hash waiter neither runs nor releases its predecessor', async () => {
  assert.ok(navigator.locks, 'Node 24 supplies the real Web Locks manager');
  await cancelledWaiter();
  const state = await navigator.locks.query();
  assert.equal(
    state.held?.filter((lock) => lock.name === 'facemorph-acquisition:phase-hash').length,
    0,
  );
  assert.equal(
    state.pending?.filter((lock) => lock.name === 'facemorph-acquisition:phase-hash').length,
    0,
  );
});

test('opaque-origin local fallback preserves its predecessor when a queued hash is cancelled', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    await cancelledWaiter();
  } finally {
    Object.defineProperty(globalThis, 'navigator', original);
  }
});

test('hash and write phases are independent and a failed operation releases its lock exactly once', async () => {
  const started = latch();
  const finish = latch();
  const reason = new DOMException('real storage operation denied', 'SecurityError');
  let runs = 0;
  const hash = acquisitionPhase('hash', async () => {
    runs++;
    started.release();
    await finish.promise;
    throw reason;
  });
  const failed = assert.rejects(hash, (error) => error === reason);
  await started.promise;
  assert.equal(await acquisitionPhase('write', () => 'committed'), 'committed');
  finish.release();
  await failed;
  assert.equal(runs, 1, 'an operation SecurityError is never mistaken for a denied lock API');
  assert.equal(await acquisitionPhase('hash', () => 'next'), 'next');
});

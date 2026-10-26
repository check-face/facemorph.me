import assert from 'node:assert/strict';
import test from 'node:test';
import { frameSubscription } from '../../shell/react-subscription.ts';

function fixture(defer = () => true) {
  const listeners = new Set();
  const frames = new Map();
  let sequence = 0;
  const cancelled = [];
  const subscribe = (notify) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  };
  return {
    listeners,
    frames,
    cancelled,
    subscribe,
    render: frameSubscription(
      subscribe,
      (notify) => {
        const id = sequence++;
        frames.set(id, notify);
        return id;
      },
      (id) => {
        cancelled.push(id);
        frames.delete(id);
      },
      defer,
    ),
    publish(event) {
      for (const notify of listeners) notify(event);
    },
    paint() {
      const pending = [...frames.values()];
      frames.clear();
      for (const notify of pending) notify();
    },
  };
}

test('microtask bursts preserve synchronous subscribers and render the latest state once per frame', async () => {
  const f = fixture();
  let state = 0;
  const synchronous = [];
  const rendered = [];
  f.subscribe(() => synchronous.push(state));
  const off = f.render(() => rendered.push(state));
  for (let i = 1; i <= 300; i++) {
    state = i;
    f.publish();
    assert.equal(synchronous.at(-1), i);
    await Promise.resolve();
  }
  assert.equal(synchronous.length, 300);
  assert.deepEqual(rendered, []);
  assert.equal(f.frames.size, 1);
  f.paint();
  assert.deepEqual(rendered, [300]);
  state = 301;
  f.publish();
  f.paint();
  assert.deepEqual(rendered, [300, 301]);
  off();
});

test('interactive changes notify synchronously and replace a pending progress paint', () => {
  const f = fixture((type) => type === 'Progressed');
  let state = 'progress';
  const rendered = [];
  const off = f.render(() => rendered.push(state));
  f.publish('Progressed');
  assert.deepEqual(rendered, []);
  state = 'typed value';
  f.publish('Edit');
  assert.deepEqual(
    rendered,
    ['typed value'],
    'React sees the value before the native event returns',
  );
  assert.deepEqual(f.cancelled, [0]);
  assert.equal(f.frames.size, 0);
  f.paint();
  state = 'runner transition';
  f.publish();
  assert.deepEqual(rendered, ['typed value', 'runner transition']);
  state = 'later progress';
  f.publish('Progressed');
  assert.equal(f.frames.size, 1);
  f.paint();
  assert.deepEqual(rendered, ['typed value', 'runner transition', 'later progress']);
  off();
});

test('unsubscribing cancels frame zero and rejects even an already captured late callback', () => {
  const f = fixture();
  let renders = 0;
  const off = f.render(() => renders++);
  f.publish();
  const late = [...f.frames.values()][0];
  off();
  off();
  assert.deepEqual(f.cancelled, [0]);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.frames.size, 0);
  late();
  f.publish();
  f.paint();
  assert.equal(renders, 0);
  const again = f.render(() => renders++);
  f.publish();
  f.paint();
  assert.equal(renders, 1, 'a later mount gets its own live subscription');
  again();
  assert.deepEqual(f.cancelled, [0], 'a completed frame needs no cancellation');
});

test('a change during React notification schedules another frame instead of re-entering notification', () => {
  const f = fixture();
  let renders = 0;
  const off = f.render(() => {
    renders++;
    if (renders === 1) f.publish();
  });
  f.publish();
  f.paint();
  assert.equal(renders, 1);
  assert.equal(f.frames.size, 1);
  f.paint();
  assert.equal(renders, 2);
  off();
});

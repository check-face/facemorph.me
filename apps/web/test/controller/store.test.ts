import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/controller/store.ts';
import { init } from '../../src/controller/init.ts';
import { msg } from '../../src/controller/msg.ts';
const state = init({
  today: '<today>',
  url: 'https://next.facemorph.me/',
  consentAnswered: true,
  sliderPreference: false,
  sliderPosition: 1,
}).state;
test('1000 listener-dispatched messages run in FIFO order without re-entrant notifications', () => {
  const store = createStore(state);
  let depth = 0;
  let maximum = 0;
  const observed: number[] = [];
  const off = store.subscribe(() => {
    depth++;
    maximum = Math.max(maximum, depth);
    observed.push(store.getState().NameLimit);
    if (observed.length < 1000) store.dispatch(msg('MoreNames'));
    depth--;
  });
  store.dispatch(msg('MoreNames'));
  assert.equal(maximum, 1);
  assert.deepEqual(
    observed,
    Array.from({ length: 1000 }, (_, i) => 48 * (i + 2)),
  );
  off();
  store.dispose();
  const last = store.getState();
  store.dispatch(msg('MoreNames'));
  assert.equal(store.getState(), last);
});
test('a subscriber added during notification starts with the following message', () => {
  const store = createStore(state);
  let first = true;
  let later = 0;
  store.subscribe(() => {
    if (first) {
      first = false;
      store.subscribe(() => {
        later++;
      });
    }
  });
  store.dispatch(msg('MoreNames'));
  assert.equal(later, 0);
  store.dispatch(msg('MoreNames'));
  assert.equal(later, 1);
  store.dispose();
});

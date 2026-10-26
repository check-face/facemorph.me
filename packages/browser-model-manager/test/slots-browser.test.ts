// Native Web Locks lifecycle coverage. No lock, signal or query API is replaced. The browser chooses callback
// ordering; the tests arrange real holders, observe real queued requests, and inspect the eventual lock inventory.
/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { componentBrowser } from './support/browser.ts';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'manager-native-slots-'));
const built = join(work, 'dist');
const { engine, browser, newContext, unavailable } = await componentBrowser();
const exercise = String.raw`
import {createAcquisitionSlots} from '/pkg/acquisition/slots.js';
const state = async name => {
  const snapshot = await navigator.locks.query();
  const own = list => list.filter(lock => lock.name.startsWith(name + ':slot-')).map(lock => lock.name).sort();
  return {held: own(snapshot.held), pending: own(snapshot.pending)};
};
const until = async (name, accept) => {
  const deadline = performance.now() + 5000;
  for (;;) {
    const snapshot = await state(name);
    if (accept(snapshot)) return snapshot;
    if (performance.now() >= deadline) throw Error('Native slot state did not settle: ' + JSON.stringify(snapshot));
    await new Promise(resolve => setTimeout(resolve, 2));
  }
};
const holders = async name => {
  const releases = [], requests = [];
  await Promise.all([0, 1].map(i => new Promise(ready => {
    requests.push(navigator.locks.request(name + ':slot-' + i, () => new Promise(release => {
      releases.push(release); ready();
    })));
  })));
  return () => { for (const release of releases) release(); return Promise.all(requests); };
};
export async function queuedAbort() {
  const name = 'abort-' + crypto.randomUUID(), unlock = await holders(name);
  const slots = createAcquisitionSlots({locks: navigator.locks, count: 2, name});
  const controller = new AbortController();
  const reason = new Error('caller cancelled while native slots held');
  const take = slots.take('foreground-required', controller.signal).then(
    release => { release(); return {rejected: false}; },
    error => ({rejected: true, sameReason: error === reason}));
  const queued = await until(name, s => s.pending.length === 2);
  controller.abort(reason);
  const outcome = await take;
  const cancelled = await until(name, s => s.pending.length === 0);
  await unlock();
  const release = await slots.take('foreground-required', new AbortController().signal);
  const reused = await until(name, s => s.held.length === 1 && s.pending.length === 0);
  release();
  return {queued, outcome, cancelled, reused, final: await until(name, s => !s.held.length && !s.pending.length)};
}
export async function optionalAbort() {
  const name = 'optional-' + crypto.randomUUID(), unlock = await holders(name);
  const slots = createAcquisitionSlots({locks: navigator.locks, count: 2, name});
  const controller = new AbortController(), reason = new Error('optional caller cancelled');
  const take = slots.take('optional', controller.signal).then(
    release => { release(); return {rejected: false}; },
    error => ({rejected: true, sameReason: error === reason}));
  const foreground = slots.take('foreground-required', new AbortController().signal);
  controller.abort(reason);
  const outcome = await take;
  const queued = await until(name, s => s.held.length === 2 && s.pending.length === 2);
  await unlock();
  const release = await foreground;
  release();
  return {outcome, queued, final: await until(name, s => !s.held.length && !s.pending.length)};
}
export async function availability(cancel) {
  const name = 'available-' + crypto.randomUUID(), unlock = await holders(name);
  const slots = createAcquisitionSlots({locks: navigator.locks, count: 2, name});
  const controller = new AbortController(), reason = new Error('cancel as both native slots become available');
  const take = slots.take('foreground-required', controller.signal).then(
    release => ({release}), error => ({error}));
  await until(name, s => s.pending.length === 2);
  const unlocked = unlock(); // both real holders release in the same JavaScript turn
  if (cancel) controller.abort(reason);
  const result = await take;
  await unlocked;
  let admitted;
  if ('release' in result) {
    admitted = await until(name, s => s.held.length === 1 && s.pending.length === 0);
    result.release(); result.release();
  } else if (result.error !== reason) throw result.error;
  await until(name, s => !s.held.length && !s.pending.length);
  const release = await slots.take('foreground-required', new AbortController().signal);
  release();
  return {rejected: 'error' in result, admitted, final: await until(name, s => !s.held.length && !s.pending.length)};
}
export async function successes() {
  const name = 'success-' + crypto.randomUUID();
  const slots = createAcquisitionSlots({locks: navigator.locks, count: 2, name});
  const controller = new AbortController();
  globalThis.slotLifecycleSignal = controller.signal; // actual signal, retained only for read-only inspector access
  for (let i = 0; i < 108; i++) {
    const release = await slots.take('foreground-required', controller.signal);
    release(); release();
  }
  const completed = await until(name, s => !s.held.length && !s.pending.length);
  let refusal;
  try {
    await createAcquisitionSlots({locks: navigator.locks, count: 1, name: '-reserved'}).take('foreground-required', controller.signal);
  } catch (error) { refusal = error.name; }
  const release = await slots.take('foreground-required', new AbortController().signal);
  release();
  return {completed, refusal, final: await until(name, s => !s.held.length && !s.pending.length)};
}
`;

execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(PKG, 'tsconfig.build.json'),
  '--outDir',
  built,
]);
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  res.setHeader('cache-control', 'no-store');
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>native acquisition slots</title>');
  }
  if (path === '/exercise.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(exercise);
  }
  if (path.startsWith('/pkg/')) {
    try {
      const body = readFileSync(join(built, path.slice(5)));
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(body);
    } catch {
      /* 404 below */
    }
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; // loopback is a secure context
test.after(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(work, { recursive: true, force: true });
});

for (const operation of [
  'queuedAbort',
  'optionalAbort',
  'availability',
  'abortAvailability',
  'successes',
]) {
  test(
    `${engine}: native acquisition slots ${operation} settle and leave no locks`,
    { skip: unavailable, timeout: 30_000 },
    async (t) => {
      const context = await newContext!();
      try {
        const page = await context.newPage();
        await page.goto(origin);
        const result = await page.evaluate(async (operation) => {
          const m = await import(String('/exercise.js'));
          return operation === 'availability'
            ? m.availability(false)
            : operation === 'abortAvailability'
              ? m.availability(true)
              : m[operation]();
        }, operation);
        assert.deepEqual(result.final, { held: [], pending: [] });
        if (operation === 'queuedAbort') {
          assert.equal(result.queued.held.length, 2);
          assert.equal(result.queued.pending.length, 2);
          assert.deepEqual(result.outcome, { rejected: true, sameReason: true });
          assert.equal(
            result.cancelled.held.length,
            2,
            'cancellation settles before either holder releases',
          );
          assert.equal(result.reused.held.length, 1, 'the same local queue remains usable');
        }
        if (operation === 'optionalAbort') {
          assert.deepEqual(result.outcome, { rejected: true, sameReason: true });
          assert.equal(result.queued.held.length, 2);
          assert.equal(
            result.queued.pending.length,
            2,
            'foreground queues before native holders release',
          );
        }
        if (operation === 'availability') {
          assert.equal(result.rejected, false);
          assert.equal(
            result.admitted.held.length,
            1,
            'one grant wins and any simultaneous loser releases',
          );
        }
        if (operation === 'abortAvailability') assert.equal(result.rejected, true);
        if (operation === 'successes') {
          assert.deepEqual(result.completed, { held: [], pending: [] });
          assert.equal(
            result.refusal,
            'NotSupportedError',
            'the real platform refuses its reserved lock name',
          );
          await t.test(
            'completed takes remove native AbortSignal listeners',
            {
              skip:
                engine !== 'chromium'
                  ? 'untested: browser exposes no read-only listener inspector'
                  : false,
            },
            async () => {
              const inspector = await context.newCDPSession(page);
              try {
                const remote = await inspector.send('Runtime.evaluate', {
                  expression: 'globalThis.slotLifecycleSignal',
                });
                assert.ok(remote.result.objectId);
                const listeners = await inspector.send('DOMDebugger.getEventListeners', {
                  objectId: remote.result.objectId,
                });
                assert.equal(
                  listeners.listeners.filter((listener) => listener.type === 'abort').length,
                  0,
                );
              } finally {
                await inspector.detach();
              }
            },
          );
        }
      } finally {
        await context.close();
      }
    },
  );
}

test(
  `${engine}: exact locks.query reply timing and grant callback interleaving`,
  {
    skip: 'untested: native Web Locks exposes no control over query completion or callback/continuation ordering; APIs are not patched',
  },
  () => {},
);

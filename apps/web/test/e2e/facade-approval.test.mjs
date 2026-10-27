// Unit regressions for the actual facade setup helper; real facade inference remains in facade.e2e.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
// TypeScript 7 ships its native compiler without the old in-process compiler API.
// Extract actual source like app-grants.test.ts, then use the installed compiler for type erasure.
const source = readFileSync(new URL('./facade/page.ts', import.meta.url), 'utf8');
const inventoryStart = source.indexOf('function downloadInventory(');
const inventoryEnd = source.indexOf('\nconst harness = {', inventoryStart);
const approvalStart = source.indexOf('  async approveDownloads() {', inventoryEnd);
const approvalEnd = source.indexOf('\n  controllerJourney,', approvalStart);
assert.ok(inventoryStart >= 0 && inventoryEnd > inventoryStart);
assert.ok(approvalStart > inventoryEnd && approvalEnd > approvalStart);
const scratch = mkdtempSync(join(tmpdir(), 'facade-approval-'));
let compiled;
try {
  const input = join(scratch, 'approval.ts'),
    output = join(scratch, 'out', 'approval.js');
  writeFileSync(
    input,
    `${source.slice(inventoryStart, inventoryEnd)}\nconst harness = {${source.slice(approvalStart, approvalEnd)}};\nharness.approveDownloads;`,
  );
  execFileSync(process.execPath, [
    new URL('../../../../node_modules/typescript/bin/tsc', import.meta.url).pathname,
    '--noCheck',
    '--target',
    'es2022',
    '--module',
    'commonjs',
    '--outDir',
    join(scratch, 'out'),
    input,
  ]);
  compiled = readFileSync(output, 'utf8');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function fixture(initial = {}, prepare = () => {}) {
  let snapshot = {
    known: true,
    scope: '',
    phase: 'idle',
    photoReady: false,
    photoApprovalRequired: false,
    photoBytes: 300,
    ...initial,
  };
  const listeners = new Set(),
    timers = new Map(),
    calls = [];
  const publish = (next) => {
    snapshot = { ...snapshot, ...next };
    for (const notify of listeners) notify({ ...snapshot });
  };
  const f = {
    subscribeDownloads(notify) {
      listeners.add(notify);
      notify({ ...snapshot }); // The public subscription immediately reports its current snapshot.
      return () => listeners.delete(notify);
    },
    downloadModels(includePhoto) {
      calls.push(['downloadModels', includePhoto]);
      prepare(publish);
    },
    cancelDownloadSetup() {
      calls.push(['cancelDownloadSetup']);
      publish({ phase: 'idle', photoApprovalRequired: false });
    },
    consentToDownload(scope) {
      calls.push(['consentToDownload', scope]);
      return scope;
    },
  };
  const context = vm.createContext({
    f,
    queueMicrotask,
    setTimeout(callback, delay) {
      const id = Symbol();
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  return {
    run: vm.runInContext(compiled, context),
    calls,
    publish,
    clean() {
      assert.equal(listeners.size, 0, 'inventory subscription is removed');
      assert.equal(timers.size, 0, 'deadline is cleared');
    },
    expire() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      assert.equal(timer.delay, 30_000, 'keep the helper’s real deadline');
      timers.delete(id);
      timer.callback();
    },
  };
}
const flush = () => new Promise(setImmediate);
const photoStage = (publish) => publish({ scope: 'photo', phase: 'downloading' });

test('explicit revised photo signal approves a new scope even when missing bytes fall', async () => {
  const f = fixture({}, (publish) => {
    publish({ scope: 'route', photoBytes: 200 }); // Generator progress is not the photo measurement.
    photoStage(publish);
    publish({ scope: 'photo', photoBytes: 200, photoApprovalRequired: true, phase: 'waiting' });
  });
  assert.deepEqual(
    { ...(await f.run()) },
    { scope: 'photo', initialPhotoBytes: 300, revisedPhotoBytes: 200, approvedRevisedCost: true },
  );
  assert.deepEqual(f.calls, [
    ['downloadModels', true],
    ['cancelDownloadSetup'],
    ['consentToDownload', 'photo'],
  ]);
  f.clean();
});

test('a falling measurement waits for the later explicit revised decision from the setup pump', async () => {
  const f = fixture({}, (publish) => {
    photoStage(publish);
    // pushGrants(strict) publishes measured inventory before its refusal reaches pumpDownloads.
    publish({ scope: 'photo', photoBytes: 200, photoApprovalRequired: false });
  });
  let settled = false;
  const running = f.run().then((value) => {
    settled = true;
    return value;
  });
  await flush();
  assert.equal(
    settled,
    false,
    'a lower total cannot stand in for the pending exact-scope decision',
  );
  f.publish({ scope: 'photo', phase: 'waiting', photoBytes: 200, photoApprovalRequired: true });
  assert.equal((await running).approvedRevisedCost, true);
  assert.deepEqual(f.calls, [
    ['downloadModels', true],
    ['cancelDownloadSetup'],
    ['consentToDownload', 'photo'],
  ]);
  f.clean();
});

test('increased measured photo cost requests an explicit additional approval', async () => {
  const f = fixture({}, (publish) => {
    photoStage(publish);
    publish({ scope: 'photo', phase: 'done', photoReady: true, photoBytes: 350 });
  });
  assert.equal((await f.run()).approvedRevisedCost, true);
  assert.deepEqual(f.calls, [
    ['downloadModels', true],
    ['cancelDownloadSetup'],
    ['consentToDownload', 'photo'],
  ]);
  f.clean();
});

test('cached-ready photo inventory needs no preparation or setup cancellation', async () => {
  const f = fixture({ photoReady: true, photoBytes: 0 });
  assert.deepEqual(
    { ...(await f.run()) },
    { scope: 'photo', initialPhotoBytes: 0, revisedPhotoBytes: 0, approvedRevisedCost: false },
  );
  assert.deepEqual(f.calls, [['consentToDownload', 'photo']]);
  f.clean();
});

test('unchanged photo cost does not create another approval after preparation', async () => {
  const f = fixture({}, (publish) => {
    photoStage(publish);
    publish({ scope: 'photo', photoReady: true, phase: 'done' });
  });
  assert.equal((await f.run()).approvedRevisedCost, false);
  assert.deepEqual(f.calls, [['downloadModels', true], ['cancelDownloadSetup']]);
  f.clean();
});

test('photo measurement deadline failure unsubscribes and cancels setup without another approval', async () => {
  const f = fixture({}, (publish) => {
    publish({ scope: 'route' });
    photoStage(publish);
  });
  const rejected = assert.rejects(
    f.run(),
    /Photo approval did not produce a measured inventory.*30 seconds/,
  );
  await flush();
  f.expire();
  await rejected;
  assert.deepEqual(f.calls, [['downloadModels', true], ['cancelDownloadSetup']]);
  f.clean();
});

test('failed public preparation is rejected and cleaned up without another approval', async () => {
  const f = fixture({}, (publish) => {
    photoStage(publish);
    publish({ scope: 'photo', phase: 'failed' });
  });
  await assert.rejects(f.run(), /Background model preparation failed before photo readiness/);
  assert.deepEqual(f.calls, [['downloadModels', true], ['cancelDownloadSetup']]);
  f.clean();
});

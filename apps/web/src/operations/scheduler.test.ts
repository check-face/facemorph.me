// fm-in6a: the governor's admission rules, with symbolic budgets until the decode measurement lands.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CEILINGS } from '../contracts/ceilings.ts';
import type {
  ConstrainedTeardownPolicy,
  HeavyOp,
  ProviderContextId,
  Residency,
} from '../contracts/scheduler.ts';
import { CapabilityUnavailable, contractLimits, createGovernor, type Lease } from './scheduler.ts';
import { face, fakeBridge, flush, output, route } from './fake-bridge.ts';
import { createOperationService } from './bridge-service.ts';

const cpu: ProviderContextId = 'cpu:runtime';
const gpu: ProviderContextId = 'webgpu:runtime';
const limits = { maxResidentBytes: 10, maxLiveSessions: 4 };

function governor(memory: ConstrainedTeardownPolicy['memory'] = 'ample') {
  const calls: string[] = [];
  const pendingReleases: (() => void)[] = [];
  let holdReleases = false;
  const g = createGovernor({
    policy: { memory },
    limits,
    hooks: {
      releaseWarm(context: ProviderContextId, residency: Residency) {
        calls.push(`release:${context}:${residency}`);
        if (holdReleases) return new Promise<void>((resolve) => pendingReleases.push(resolve));
      },
      terminateWorkers(context: ProviderContextId) {
        calls.push(`terminate:${context}`);
      },
    },
  });
  return {
    g,
    calls,
    pendingReleases,
    holdReleases: () => (holdReleases = true),
  };
}
const job = (id: string, op: HeavyOp, bytes = 4, context: ProviderContextId = cpu) => ({
  id,
  op,
  context,
  bytes,
  sessions: 1,
});
/** Records the order leases are granted in, without awaiting them. */
function granted(promises: Record<string, Promise<Lease>>) {
  const order: string[] = [];
  const leases = new Map<string, Lease>();
  for (const [id, promise] of Object.entries(promises))
    void promise.then(
      (lease) => {
        order.push(id);
        leases.set(id, lease);
      },
      () => {},
    );
  return { order, leases };
}

test('permit-vs-residency: idle warm encoder keeps its reservation without holding the compute permit', async () => {
  const { g, calls } = governor('ample');
  const lease = await g.request(job('encode', 'photo-encode', 6));
  lease.settle();
  await flush();
  const after = g.snapshot();
  assert.deepEqual(after.permits, [], 'the compute permit is released');
  assert.deepEqual(
    after.warm.map((r) => [r.jobId, r.residency]),
    [['encode', 'encoder']],
    'the idle encoder still counts',
  );
  assert.equal(after.residentBytes, 6);
  assert.deepEqual(calls, []);
});

test('permit-vs-residency: generator load waits for reservation release, never exceeds the budget', async () => {
  const { g, calls, pendingReleases, holdReleases } = governor('ample');
  holdReleases();
  const encode = await g.request(job('encode', 'photo-encode', 6));
  await encode.settle();
  const generator = g.request(job('face', 'face-synthesis', 6));
  const seen = granted({ face: generator });
  await flush();
  assert.deepEqual(calls, ['release:cpu:runtime:encoder']);
  assert.deepEqual(seen.order, [], 'no generator while the encoder is still resident');
  assert.ok(g.snapshot().residentBytes <= limits.maxResidentBytes);
  pendingReleases.shift()!();
  await generator;
  const snapshot = g.snapshot();
  assert.deepEqual(
    snapshot.reservations.map((r) => r.residency),
    ['generator'],
  );
  assert.ok(snapshot.residentBytes <= limits.maxResidentBytes);
});

test('competing provider-load requests admit one at a time', async () => {
  const { g } = governor();
  const started: string[] = [];
  const finish: Record<string, () => void> = {};
  const start = (name: string) => () =>
    new Promise<string>((resolve) => {
      started.push(name);
      finish[name] = () => resolve(name);
    });
  const first = g.load(cpu, start('cpu-a'));
  const joined = g.load(cpu, start('cpu-b'));
  const other = g.load(gpu, start('gpu'));
  await flush();
  assert.deepEqual(started, ['cpu-a'], 'one load runs; the same context joins it');
  finish['cpu-a']!();
  assert.equal(await first, 'cpu-a');
  assert.equal(await joined, 'cpu-a');
  await flush();
  assert.deepEqual(started, ['cpu-a', 'gpu'], 'the next context loads after the first finished');
  finish['gpu']!();
  assert.equal(await other, 'gpu');
});

test('constrained device tears down alignment/encoder workers before the next heavy phase', async () => {
  const { g, calls } = governor('constrained');
  const encode = await g.request(job('encode', 'photo-encode', 6));
  const next = g.request(job('face', 'face-synthesis', 6));
  await encode.settle();
  assert.deepEqual(calls, ['release:cpu:runtime:encoder', 'terminate:cpu:runtime']);
  const lease = await next;
  assert.deepEqual(
    g.snapshot().reservations.map((r) => r.jobId),
    [lease.permit.jobId],
    'the encoder residency was gone before the generator was reserved',
  );
});

test('qualified desktop warm reuse keeps residency', async () => {
  const { g, calls } = governor('ample');
  const first = await g.request(job('face-1', 'face-synthesis', 6));
  await first.settle();
  const second = await g.request(job('face-2', 'face-synthesis', 6));
  assert.deepEqual(calls, [], 'no release or teardown between same-residency jobs');
  assert.equal(g.snapshot().residentBytes, 6, 'the warm generator is reused, not counted twice');
  await second.settle();
  assert.equal(g.snapshot().warm.length, 1);
});

test('admission covers runtime init, session load and canary, not just inference', async () => {
  const { g } = governor();
  const lease = await g.request(job('face-1', 'face-synthesis', 4));
  const next = g.request(job('face-2', 'face-synthesis', 4));
  const seen = granted({ next });
  for (const phase of ['runtime-init', 'session-load', 'canary', 'inference'] as const) {
    lease.phase(phase);
    await flush();
    assert.deepEqual(seen.order, [], `the second job waits through ${phase}`);
    assert.equal(g.capability(cpu), 'busy');
  }
  assert.deepEqual(lease.phases, ['runtime-init', 'session-load', 'canary', 'inference']);
  await lease.settle();
  await next;
  assert.throws(() => lease.phase('inference'), /settled lease/);
});

test('waiting job holds no permit or reservation', async () => {
  const { g } = governor();
  const lease = await g.request(job('face-1', 'face-synthesis', 4));
  void g.request(job('encode', 'photo-encode', 4));
  await flush();
  const snapshot = g.snapshot();
  assert.deepEqual(snapshot.waiting, ['encode']);
  assert.deepEqual(
    snapshot.permits.map((p) => p.jobId),
    ['face-1'],
  );
  assert.deepEqual(
    snapshot.reservations.map((r) => r.jobId),
    ['face-1'],
  );
  await lease.settle();
});

test('no starvation: an eligible Morph runs after at most the faces queued before it, despite a continuous stream of new face requests', async () => {
  const { g } = governor();
  const before = ['face-1', 'face-2'].map((id) => g.request(job(id, 'face-synthesis', 4)));
  const morph = g.request(job('morph', 'morph-frames', 4));
  const order: string[] = [];
  let stream = 0;
  void morph.then(() => order.push('morph'));
  for (const promise of before)
    void promise.then(async (lease) => {
      order.push(lease.permit.jobId);
      // Every time a face finishes, another face is requested.
      void g.request(job(`late-${++stream}`, 'face-synthesis', 4)).then(async (late) => {
        order.push(late.permit.jobId);
        await late.settle();
      });
      await lease.settle();
    });
  const lease = await morph;
  assert.deepEqual(order, ['face-1', 'face-2', 'morph']);
  await lease.settle();
});

test('request order preserved across face/photo/import', async () => {
  const { g } = governor();
  const jobs = {
    face: g.request(job('face', 'face-synthesis', 2)),
    photo: g.request(job('photo', 'photo-encode', 2)),
    import: g.request(job('import', 'face-synthesis', 2)),
    face2: g.request(job('face2', 'face-synthesis', 2)),
  };
  const order: string[] = [];
  for (const [name, promise] of Object.entries(jobs))
    void promise.then(async (lease) => {
      order.push(name);
      await lease.settle();
    });
  await Promise.all(Object.values(jobs));
  await flush();
  assert.deepEqual(order, ['face', 'photo', 'import', 'face2']);
});

test('compute permit released when compute settles; file preparation holds no heavyweight permit', async () => {
  const { g } = governor();
  const face = await g.request(job('face-1', 'face-synthesis', 4));
  const next = g.request(job('face-2', 'face-synthesis', 4));
  await face.settle(); // compute-ready: file preparation now runs outside the governor
  const lease = await next;
  assert.deepEqual(
    g.snapshot().permits.map((p) => p.jobId),
    ['face-2'],
    'the face preparing its file holds no permit',
  );
  await lease.settle();
});

test('busy/unavailable capability reported through the operation contract', async () => {
  const { g } = governor();
  assert.equal(g.capability(cpu), 'available');
  const lease = await g.request(job('face', 'face-synthesis', 4));
  assert.equal(g.capability(cpu), 'busy');
  assert.equal(g.capability(gpu), 'available', 'contexts are independent');
  const queued = g.request(job('lost', 'face-synthesis', 4, gpu));
  g.setAvailable(gpu, false);
  assert.equal(g.capability(gpu), 'unavailable');
  await assert.rejects(queued, (error) => {
    assert.ok(error instanceof CapabilityUnavailable);
    assert.equal(error.status, 'unavailable');
    return true;
  });
  await lease.settle();
  assert.equal(g.capability(cpu), 'available');
});

test('numeric ceilings come from the contracts limits file', () => {
  const value = (name: string) => CEILINGS.find((c) => c.name === name)?.value;
  assert.deepEqual(contractLimits(), {
    maxResidentBytes: value('LIVE_RESIDENT_BYTES'),
    maxLiveSessions: value('LIVE_SESSIONS'),
  });
  const g = createGovernor({
    policy: { memory: 'ample' },
    hooks: { releaseWarm() {}, terminateWorkers() {} },
  });
  assert.deepEqual(g.limits, contractLimits(), 'the default governor uses the contracts values');
  return assert.rejects(
    g.request(job('too-big', 'face-synthesis', g.limits.maxResidentBytes + 1)),
    RangeError,
    'a job over the ceiling is refused, never admitted past it',
  );
});

test('the operation service reports capability and releases the permit before file preparation', async () => {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  assert.equal(service.capability(route), 'available');
  const handle = service.requestFace(face('a'));
  await flush();
  assert.equal(service.capability(route), 'busy', 'busy while the face computes');
  fake.executions[0]!.resolve(output(['a']));
  await flush();
  assert.equal(fake.files.length, 1, 'the file is being prepared');
  assert.equal(service.capability(route), 'available', 'file preparation holds no permit');
  fake.files[0]!.resolve(output(['a']));
  assert.equal((await handle.done).status, 'completed');
  await service.dispose();
});

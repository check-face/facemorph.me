// Acquisition slots settle every take (fm-fy2.13). Hosted macOS WebKit hung the OPFS cut-transfer cell: a sibling
// chunk's connection reset aborted a lane while that lane's `ifAvailable` lookups were still being answered; the
// lookup then found a free slot, which the slots handed back without ever settling the take, so the acquisition
// waited for it forever. These Web Locks answer `ifAvailable` lookups only when the test says, which makes that
// interleaving exact instead of a timing accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcquisitionSlots, type SlotLocks } from '../src/acquisition/slots.ts';

/** Exclusive locks whose `ifAvailable` lookups wait in `lookups` until answered with `answer()`. */
function steppedLocks() {
  const held = new Set<string>();
  const queued = new Map<string, (() => void)[]>();
  const lookups: (() => void)[] = [];
  const grant = (name: string, run: (lock: unknown) => Promise<void> | void) => {
    held.add(name);
    return Promise.resolve(run({ name })).finally(() => {
      held.delete(name);
      queued.get(name)?.shift()?.();
    });
  };
  const locks: SlotLocks = {
    request(name, options, run) {
      if (options.ifAvailable)
        return new Promise((resolve, reject) =>
          lookups.push(() => {
            if (held.has(name)) Promise.resolve(run(null)).then(resolve, reject);
            else grant(name, run).then(resolve, reject);
          }),
        );
      if (!held.has(name)) return grant(name, run);
      return new Promise((resolve, reject) => {
        const turn = () => {
          options.signal?.removeEventListener('abort', leave);
          grant(name, run).then(resolve, reject);
        };
        const leave = () => {
          const list = queued.get(name) ?? [];
          list.splice(list.indexOf(turn), 1);
          reject(options.signal!.reason);
        };
        options.signal?.addEventListener('abort', leave, { once: true });
        queued.set(name, [...(queued.get(name) ?? []), turn]);
      });
    },
  };
  /** Answers the oldest pending lookup, then lets the slots react. */
  const answer = async () => {
    lookups.shift()!();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { locks, held, lookups, answer };
}

const settled = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ state: 'resolved' as const, value }),
    (reason: unknown) => ({ state: 'rejected' as const, reason }),
  );

test('a take cancelled while its slot lookup is in flight rejects and hands the slot back', async () => {
  const { locks, held, lookups, answer } = steppedLocks();
  const slots = createAcquisitionSlots({ locks, count: 2, name: 'test' });

  const first = slots.take('foreground-required', new AbortController().signal);
  await answer(); // slot-0 is free
  const releaseFirst = await first;
  assert.deepEqual([...held], ['test:slot-0']);

  const lane = new AbortController();
  const second = settled(slots.take('foreground-required', lane.signal));
  await Promise.resolve();
  assert.equal(lookups.length, 1, 'the second take is looking for a free slot');
  const reason = new Error('a sibling chunk failed');
  lane.abort(reason); // the take is the slots' current attempt: its lookup decides
  await answer(); // slot-1 (next after slot-0) is free: the attempt finds a slot after its caller left
  if (lookups.length) await answer();

  const outcome = await Promise.race([
    second,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 200)),
  ]);
  assert.deepEqual(outcome, { state: 'rejected', reason }, 'the cancelled take settles');
  assert.deepEqual(
    [...held],
    ['test:slot-0'],
    'the slot found for the cancelled take is free again',
  );
  releaseFirst();
  await Promise.resolve();
  assert.deepEqual([...held], []);
});

test('a take cancelled during its lookups never queues on the slots', async () => {
  const { locks, held, lookups, answer } = steppedLocks();
  const slots = createAcquisitionSlots({ locks, count: 2, name: 'test' });
  const holders = [
    slots.take('foreground-required', new AbortController().signal),
    slots.take('foreground-required', new AbortController().signal),
  ];
  while (lookups.length || held.size < 2) await answer();
  const releases = await Promise.all(holders);

  const lane = new AbortController();
  const waiting = settled(slots.take('foreground-required', lane.signal));
  await Promise.resolve();
  const reason = new Error('cancelled');
  lane.abort(reason);
  while (lookups.length) await answer(); // both slots taken: nothing free
  const outcome = await Promise.race([
    waiting,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 200)),
  ]);
  assert.deepEqual(outcome, { state: 'rejected', reason });
  for (const release of releases) release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([...held], [], 'no queued request took a slot for the cancelled take');
});

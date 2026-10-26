// Reference-counted leases, eviction that skips leased assets, and typed invalidation when an asset goes anyway.
// Two lease registries stand for two tabs; BroadcastChannel carries an explicit deletion between them.
import {
  createLeaseRegistry,
  deleteAssets,
  DELETION_CHANNEL,
  evictUnleased,
  LEASE_INVALIDATION,
  listenForDeletions,
  type LeaseHolder,
  type Removable,
} from 'browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const [x, y] = ['a'.repeat(64), 'b'.repeat(64)]; // asset digests
const stored = new Set([x, y]);
const store: Removable = { remove: async (sha) => stored.delete(sha) };

// A holder hears once, with the cause and the mapped manager error.
const heard: string[] = [];
const holder: LeaseHolder = {
  invalidated: (cause, error) => heard.push(`${cause}:${error.code}`),
};

// Tab A leases x twice (two handles share it) and y once.
const tabA = createLeaseRegistry();
const [x1, y1] = tabA.lease(
  [
    { sha256: x, bytes: 10 },
    { sha256: y, bytes: 20 },
  ],
  holder,
);
const [x2] = tabA.lease([{ sha256: x, bytes: 10 }], holder);
check(tabA.refCount(x) === 2, 'x has two leases');

// Manager eviction never removes a leased asset.
const first = await evictUnleased([x, y], [store], tabA);
check(first.removed.length === 0 && stored.size === 2, 'leased assets are kept');

// Released leases make an asset evictable again; release is idempotent.
y1!.release();
y1!.release();
const second = await evictUnleased([x, y], [store], tabA);
check(second.removed[0] === y && second.kept[0] === x, 'only the unleased asset is evicted');

// The person clears the model cache in tab B: deletion removes even leased assets and tells the other tabs,
// whose leases are invalidated with a typed cause. Nothing is refetched.
const tabB = new BroadcastChannel(DELETION_CHANNEL);
const listening = new BroadcastChannel(DELETION_CHANNEL);
const delivered = new Promise<void>((resolve) =>
  listening.addEventListener('message', () => resolve(), { once: true }),
);
const stop = listenForDeletions(listening, tabA);
await deleteAssets([x], [store], tabB);
await delivered;
stop();
tabB.close();
listening.close();
check(!stored.has(x), 'deleted');
check(heard[0] === 'cross-tab-deletion:invalidated', 'the holder heard a typed invalidation');

// Browser eviction or corruption found underneath a lease maps to its own error the same way.
tabA.invalidate(x, 'browser-eviction');
x1!.release();
x2!.release();
check(tabA.leased().length === 0, 'every lease released');

console.log(
  JSON.stringify({
    firstEviction: first,
    secondEviction: { removed: second.removed.length, kept: second.kept.length },
    heard,
    mapping: LEASE_INVALIDATION,
  }),
);

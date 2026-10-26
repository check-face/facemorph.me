// Construct, read status, authorize, acquire with progress, then read back verified bytes.
// Storage and the network are in memory here so this runs anywhere (the docs test runs it in Node with every
// network API refused). In a browser, use createBrowserModelCache() and the default fetch.
import {
  createAcquisitionBudget,
  createModelCache,
  GrantRefused,
  grantRemaining,
  type AcquisitionGrant,
  type BlobStore,
  type Fetcher,
} from '@facemorph/browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');

// One model file on your own static origin, pinned by digest and exact size.
const file = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) % 251);
const asset = {
  sha256: await sha256(file),
  size: file.byteLength,
  url: 'https://models.example.com/demo/weights.bin',
};

// The network and storage, handed in. Every request is counted.
const requests: string[] = [];
const fetcher: Fetcher = async (url) => {
  requests.push(url);
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= file.byteLength) return c.close();
      c.enqueue(file.slice(at, (at += 256 * 1024))); // arrives in pieces, as over a network
    },
  });
  return new Response(body);
};
const saved = new Map<string, Uint8Array<ArrayBuffer>>();
const store: BlobStore = {
  get: async (hash) => (saved.has(hash) ? new Response(saved.get(hash)) : undefined),
  // Commits only after the whole body has been read, and the cache's verifying stream fails before EOF on a wrong
  // size or digest, so nothing partial or unverified is ever stored.
  put: async (hash, response) => {
    saved.set(hash, new Uint8Array(await response.arrayBuffer()));
  },
  remove: async (hash) => saved.delete(hash),
};

// Progress for the whole acquisition: the cache reports byte-level events to it.
const progress = createAcquisitionBudget();
const bar: string[] = [];
progress.attach((t) => bar.push(`${t.loaded}/${t.total}`));

// 1. Construction and status reads: no request, no transfer.
const cache = createModelCache({ store, fetcher, report: (event) => progress.cacheEvent(event) });
progress.planAsset([asset]);
await progress.probe((a) => cache.has(a));
const before = await cache.local.read(asset);
check(!before.ok && before.error.code === 'cache-miss', 'nothing is stored yet');
check(requests.length === 0, 'construction and status made no request');

// 2. Without an approved grant naming this owner and digest, acquire() refuses before any request.
const declined: AcquisitionGrant = {
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: [],
  assets: [],
  remainingBytes: 0,
};
const refused = await cache.acquire(asset, { grant: declined, owner: 'face:demo' }).then(
  () => null,
  (e: unknown) => e,
);
check(refused instanceof GrantRefused, 'refused without a grant');
check(requests.length === 0, 'a refusal made no request');

// 3. The person approves exactly these bytes (show `remainingBytes` in your consent UI); then acquire.
const grant: AcquisitionGrant = {
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: ['face:demo'],
  assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
  remainingBytes: asset.size,
};
await cache.acquire(asset, { grant, owner: 'face:demo' });

// 4. The verified local reader: exact-length bytes whose SHA-256 matched on this read, and never a fetch.
const after = await cache.local.read(asset);
check(after.ok && (await sha256(after.value)) === asset.sha256, 'verified bytes read back');
check(requests.length === 1, 'one request, made after authorization');
check(grantRemaining(grant) === 0, 'the grant was spent exactly');

console.log(
  JSON.stringify({
    refused: (refused as GrantRefused).refusal,
    requests: requests.length,
    progress: bar,
    grantRemaining: grantRemaining(grant),
    localRead: after.ok ? after.value.byteLength : after.error.code,
  }),
);

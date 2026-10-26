// Abort keeps verified chunks and never yields a partial asset; refusals and failures are typed.
// The shard store and the network are in memory here so this runs anywhere; in a browser, openShardStore() gives
// the OPFS store and createBrowserModelCache() wires it up.
import {
  CacheQuotaExceeded,
  createModelCache,
  GrantRefused,
  type AcquisitionGrant,
  type BlobStore,
  type Fetcher,
  type ShardStore,
} from 'browser-model-manager';

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const MiB = 1024 * 1024;
const base = 'https://models.example.com/demo/';

// A 4 MiB asset published as four 1 MiB chunks, each pinned by its own digest.
const file = new Uint8Array(4 * MiB).map((_, i) => (i * 13) % 251);
const parts = [0, 1, 2, 3].map((i) => file.slice(i * MiB, (i + 1) * MiB));
const chunks = await Promise.all(
  parts.map(async (p, i) => ({
    sha256: await sha256(p),
    size: p.byteLength,
    url: `${base}part-${i}`,
  })),
);
const asset = {
  sha256: await sha256(file),
  size: file.byteLength,
  url: `${base}weights.bin`,
  chunks,
};
const served = new Map(chunks.map((c, i) => [c.url, parts[i]!]));

const requests: string[] = [];
let onRequest = (_url: string) => {};
const fetcher: Fetcher = async (url) => {
  requests.push(url);
  onRequest(url);
  return new Response(served.get(url) ?? null, { status: served.has(url) ? 200 : 404 });
};
// One file per verified unit, as OPFS keeps them.
const units = new Map<string, Uint8Array<ArrayBuffer>>();
let failWrites: DOMException | null = null;
const shards: ShardStore = {
  read: async (sha, size) => (units.get(sha)?.byteLength === size ? units.get(sha) : undefined),
  has: async (sha, size) => units.get(sha)?.byteLength === size,
  write: async (sha, bytes) => {
    if (failWrites) throw failWrites;
    units.set(sha, new Uint8Array(bytes));
  },
  remove: async (sha) => void units.delete(sha),
};
const store: BlobStore = {
  get: async () => undefined,
  put: async () => {},
  remove: async () => {},
};
const cache = createModelCache({ store, shards, fetcher, readAhead: 1 });
const grantFor = (remainingBytes: number, owner: `face:${string}`): AcquisitionGrant => ({
  manifestSha256: asset.sha256,
  route: 'cpu',
  purpose: 'generate',
  owners: [owner],
  assets: [{ sha256: asset.sha256, bytes: asset.size, priority: 'foreground-required' }],
  remainingBytes,
});
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as Error,
  );

// Abort while the third chunk is being requested: the two verified chunks stay, the asset is not readable.
const controller = new AbortController();
onRequest = (url) => {
  if (url === chunks[2]!.url) controller.abort();
};
const aborted = await outcome(
  cache.acquire(asset, {
    grant: grantFor(asset.size, 'face:a'),
    owner: 'face:a',
    signal: controller.signal,
  }),
);
onRequest = () => {};
check(aborted?.name === 'AbortError', 'the acquisition was cancelled');
const partial = await cache.local.read(asset);
check(!partial.ok, 'a partly acquired asset is never handed out');

// Each chunk is reserved against the grant before it is requested. A grant that cannot cover the next chunk is
// refused before that request: more scope needs a new decision, and nothing the cache does adds to a grant.
const before = requests.length;
const short = await outcome(
  cache.acquire(asset, { grant: grantFor(MiB - 1, 'face:b'), owner: 'face:b' }),
);
check(requests.length === before, 'refused before any request');
check(
  short instanceof GrantRefused && short.refusal === 'revision-required',
  'needs a revised grant',
);

// A new approval for the missing bytes resumes: only the two missing chunks are fetched.
await cache.acquire(asset, { grant: grantFor(2 * MiB, 'face:c'), owner: 'face:c' });
const resumed = requests.slice(before);
const read = await cache.local.read(asset);
check(read.ok && (await sha256(read.value)) === asset.sha256, 'whole asset verified');

// Bytes changed underneath are found by the next local read (every read digests what it returns).
units.get(chunks[1]!.sha256)![0]! ^= 0xff;
const corrupt = await cache.local.read(asset);
check(
  !corrupt.ok && corrupt.error.code === 'corrupt',
  'corruption is a typed error, never a fetch',
);
// The remedy is the app's: remove the bad unit, then acquire again under a new approval.
await shards.remove(chunks[1]!.sha256);
const repairFrom = requests.length;
await cache.acquire(asset, { grant: grantFor(MiB, 'face:e'), owner: 'face:e' });
const repaired = requests.slice(repairFrom);
check((await cache.local.read(asset)).ok, 'readable again');

// A storage refusal is a typed quota error, separate from any execution capability.
units.clear();
failWrites = new DOMException('full', 'QuotaExceededError');
const quota = await outcome(
  cache.acquire(asset, { grant: grantFor(asset.size, 'face:d'), owner: 'face:d' }),
);
check(quota instanceof CacheQuotaExceeded && quota.error.code === 'quota', 'typed quota error');

console.log(
  JSON.stringify({
    aborted: aborted?.name,
    partialRead: partial.ok ? 'ok' : partial.error.code,
    shortGrant: (short as GrantRefused).refusal,
    resumedRequests: resumed.map((u) => u.slice(base.length)),
    corruptRead: corrupt.ok ? 'ok' : corrupt.error.code,
    repairedRequests: repaired.map((u) => u.slice(base.length)),
    quota: (quota as CacheQuotaExceeded).error,
    totalRequests: requests.length,
  }),
);

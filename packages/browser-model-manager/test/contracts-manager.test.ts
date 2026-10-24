// Manager contract tests (fm-hwh). tsc checks the type-level parts (an unused @ts-expect-error fails the
// build); node --test runs the rest: the grant walkthrough, the lease mapping, the manifest validator
// against the candidate's recorded runtime manifest, and a fixed-seed manifest fuzz.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/index.ts';
import type {
  AcquisitionGrant,
  GrantOwnerId,
  LeaseInvalidationCause,
  ManagerCapabilities,
  ManagerError,
  ManagerErrorCode,
  ManagerStatus,
  ModelManager,
  VerifiedLocalReader,
} from '../src/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const is = <T extends true>(): T => true as T;

/** Every citable manager value export. */
const VALUES = [
  'LEASE_INVALIDATION',
  'scopeCovers',
  'cancelOwner',
  'inventoryAction',
  'MANIFEST_SCHEMA_MAJOR',
  'E4E_MAX_WASM_BYTES',
  'parseModelManifest',
  'assetIdentity',
  'ACQUISITION_CHUNK_MAX_BYTES',
  'ACQUISITION_BUDGETS',
  'acquisitionMemoryClass',
  'acquisitionBudget',
  'LIVE_RESIDENCY_LIMIT',
] as const satisfies readonly (keyof typeof api)[];

/** Every citable manager type export; tsc fails on a missing or renamed one. */
export type CitableTypes = [
  api.ModelManager,
  api.ManagerStatus,
  api.ManagerCapabilities,
  api.VerifiedLocalReader,
  api.LoadedModelHandle,
  api.CreateModelManager,
  api.ManagerStorage,
  api.ManagerFetcher,
  api.AssetInventory,
  api.AssetLease,
  api.LeaseInvalidationCause,
  api.SettlementRule,
  api.ManagerError,
  api.ManagerErrorCode,
  api.Result<1, 2>,
  api.AcquisitionGrant,
  api.GrantOwnerId,
  api.GrantDecision,
  api.GrantPurpose,
  api.AcquisitionPriority,
  api.WarmingOwnership,
  api.SharedFetch,
  api.AcquisitionBudget,
  api.LiveResidencyLimit,
  api.ModelManifestV1,
  api.RuntimeManifest,
  api.AssetIdentity,
  api.AssetDescriptor,
  api.EncoderStreamDescriptor,
  api.KernelProvenance,
  api.ManifestError,
  api.ManifestErrorCode,
];

test('every citable manager value is exported', () => {
  for (const name of VALUES) assert.ok(name in api, name);
});

// ---- Exhaustiveness over the manager unions.
const never = (x: never): never => {
  throw new Error(`unhandled ${String(x)}`);
};
export function errorDetail(e: ManagerError): string {
  switch (e.code) {
    case 'cache-miss':
    case 'corrupt':
    case 'evicted':
      return e.sha256;
    case 'invalidated':
      return e.cause;
    case 'quota':
      return String(e.requiredBytes);
    case 'manifest-rejected':
      return e.reason;
    case 'unknown-status':
      return String(e.retryable);
    case 'network':
      return String(e.retryable);
    default:
      return never(e);
  }
}
// @ts-expect-error a quota error says how many bytes it needed
export const quotaWithoutBytes: ManagerError = { code: 'quota', message: 'full' };
const notRetryable = { code: 'unknown-status', retryable: false, message: '' } as const;
// @ts-expect-error unknown status is always retryable, never permission to fetch
export const unknownNotRetryable: ManagerError = notRetryable;
// @ts-expect-error owners are face, photo, warming or export slots
export const strangeOwner: GrantOwnerId = 'robot:1';
is<Equal<keyof typeof api.LEASE_INVALIDATION, LeaseInvalidationCause>>();

// ---- No repair-capable handle is reachable from status(), capabilities() or the local reader.
type Repair = 'acquire' | 'bytes' | 'open' | 'fetch' | 'fetcher' | 'repair' | 'url' | 'urls';
type DeepKeys<T, D extends unknown[] = []> = D['length'] extends 6
  ? never
  : T extends ArrayBufferView | ArrayBuffer | string | number | boolean | null | undefined
    ? never
    : T extends (...args: infer A) => infer R
      ? DeepKeys<A[number], [...D, 1]> | DeepKeys<Awaited<R>, [...D, 1]>
      : T extends readonly (infer U)[]
        ? DeepKeys<U, [...D, 1]>
        : T extends object
          ? { [K in keyof T]-?: K | DeepKeys<T[K], [...D, 1]> }[keyof T]
          : never;
is<
  Equal<
    Extract<
      DeepKeys<ManagerStatus | ManagerCapabilities | Awaited<ReturnType<ModelManager['status']>>>,
      Repair
    >,
    never
  >
>();
is<Equal<Extract<keyof VerifiedLocalReader, Repair>, never>>();
is<Equal<VerifiedLocalReader['allowRepair'], false>>();
const repairReader = {
  allowRepair: true,
  read: async () => ({ ok: true, value: new Uint8Array() }),
} as const;
// @ts-expect-error a reader that may repair is not a verified local reader
export const repairing: VerifiedLocalReader = repairReader;

test('each lease invalidation cause maps to a manager error and a settlement rule', () => {
  const codes: ManagerErrorCode[] = [
    'cache-miss',
    'corrupt',
    'evicted',
    'invalidated',
    'quota',
    'manifest-rejected',
    'unknown-status',
    'network',
  ];
  const causes: LeaseInvalidationCause[] = [
    'browser-eviction',
    'corruption',
    'cross-tab-deletion',
    'device-loss',
    'worker-loss',
  ];
  assert.deepEqual(Object.keys(api.LEASE_INVALIDATION).sort(), [...causes].sort());
  for (const cause of causes) {
    const { error, settlement } = api.LEASE_INVALIDATION[cause];
    assert.ok(codes.includes(error), cause);
    assert.ok(
      ['fail-pending-and-release', 'fail-pending-and-dispose-handle'].includes(settlement),
      cause,
    );
  }
  assert.equal(api.LEASE_INVALIDATION['device-loss'].settlement, 'fail-pending-and-dispose-handle');
});

// ---- Grant walkthrough.
const manifestSha256 = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const synthesis = { sha256: 'a'.repeat(64), bytes: 124_000_000 };
const encoder = { sha256: 'b'.repeat(64), bytes: 1_069_000_000 };
const landmarks = { sha256: 'c'.repeat(64), bytes: 100_000_000 };
const grant = (
  purpose: AcquisitionGrant['purpose'],
  assets: { sha256: string; bytes: number }[],
  owners: GrantOwnerId[],
): AcquisitionGrant => ({
  manifestSha256,
  route: 'webgpu',
  purpose,
  assets: assets.map((a) => ({
    ...a,
    priority: a === synthesis ? 'synthesis-prerequisite' : 'foreground-required',
  })),
  remainingBytes: assets.reduce((n, a) => n + a.bytes, 0),
  owners,
});

test('walkthrough: approve both downloads, then Cancel the crop', () => {
  const both = grant('generate-and-encode', [synthesis, encoder, landmarks], ['face:1', 'photo:1']);
  assert.equal(
    api.scopeCovers(both, {
      manifestSha256,
      route: 'webgpu',
      assets: [synthesis, encoder, landmarks],
    }),
    'covered',
  );
  const fetches = [
    { sha256: synthesis.sha256, owners: ['face:1', 'photo:1'] as GrantOwnerId[] },
    { sha256: encoder.sha256, owners: ['photo:1'] as GrantOwnerId[] },
    { sha256: landmarks.sha256, owners: ['photo:1'] as GrantOwnerId[] },
  ];
  const after = api.cancelOwner(fetches, 'photo:1');
  // The photo's own downloads stop; synthesis carries on for the face that still wants it.
  assert.deepEqual([...after.stopped].sort(), [encoder.sha256, landmarks.sha256].sort());
  assert.deepEqual(after.continuing, [{ sha256: synthesis.sha256, owners: ['face:1'] }]);
});

test('walkthrough: Generate-only approval, then a photo request needs a revised decision', () => {
  const generateOnly = grant('generate', [synthesis], ['face:1']);
  assert.equal(
    api.scopeCovers(generateOnly, { manifestSha256, route: 'webgpu', assets: [synthesis] }),
    'covered',
  );
  assert.equal(
    api.scopeCovers(generateOnly, {
      manifestSha256,
      route: 'webgpu',
      assets: [synthesis, encoder],
    }),
    'revision-required',
  );
  // Retry and deduplicated requests stay within scope; a different route or a grown asset does not.
  assert.equal(
    api.scopeCovers(generateOnly, {
      manifestSha256,
      route: 'webgpu',
      assets: [synthesis, synthesis],
    }),
    'covered',
  );
  assert.equal(
    api.scopeCovers(generateOnly, { manifestSha256, route: 'cpu', assets: [synthesis] }),
    'revision-required',
  );
  assert.equal(
    api.scopeCovers(generateOnly, {
      manifestSha256,
      route: 'webgpu',
      assets: [{ ...synthesis, bytes: synthesis.bytes + 1 }],
    }),
    'revision-required',
  );
});

test('walkthrough: a shared fetch with two owners continues when one cancels, stops when both do', () => {
  const shared = [{ sha256: synthesis.sha256, owners: ['face:1', 'face:2'] as GrantOwnerId[] }];
  const one = api.cancelOwner(shared, 'face:1');
  assert.deepEqual(one, {
    continuing: [{ sha256: synthesis.sha256, owners: ['face:2'] }],
    stopped: [],
  });
  assert.deepEqual(api.cancelOwner(one.continuing, 'face:2'), {
    continuing: [],
    stopped: [synthesis.sha256],
  });
});

test('walkthrough: unknown inventory never fetches, even when approved', () => {
  assert.equal(api.inventoryAction('unknown', 'approved'), 'inspect');
  assert.equal(api.inventoryAction('absent', 'approved'), 'fetch');
  assert.equal(api.inventoryAction('partial', 'declined'), 'wait-for-decision');
  assert.equal(api.inventoryAction('verified-local', 'cancelled'), 'none');
});

// ---- Manifests.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test("the candidate's runtime manifest validates; a newer major is rejected with a typed error", () => {
  const r = api.parseModelManifest(fixture('candidate-runtime-manifest.json'));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.encoderStream?.phoneAdmitted, true);
    assert.equal(r.value.encoderStream?.maxWasmBytes, api.E4E_MAX_WASM_BYTES);
    assert.equal(r.value.kernel?.candidateId, 'mobile-boundary-bounded-phone');
    const id = api.assetIdentity(r.value);
    assert.equal(id.generator.modelSourceSha256, r.value.modelSourceSha256);
    assert.equal(id.photoEncoder?.sourceEncoderSha256, r.value.encoderStream?.sourceEncoderSha256);
    assert.equal(id.preprocessing?.alignmentSha256, r.value.alignmentSha256);
  }
  const newer = api.parseModelManifest(fixture('newer-major-manifest.json'));
  assert.deepEqual(newer.ok ? null : newer.error.code, 'newer-major');
});

test('a converter manifest (unpublished file assets) validates only when unpublished assets are allowed', () => {
  const conv = fixture('model-conv-build-manifest.json');
  assert.equal(api.parseModelManifest(conv, { unpublished: true }).ok, true);
  const hosted = api.parseModelManifest(conv);
  assert.equal(hosted.ok ? 'accepted' : hosted.error.code, 'invalid-asset');
  for (const file of ['../mapping.onnx', '/abs/mapping.onnx', 'https://x/y', 'a/../../b', 'a b']) {
    const r = api.parseModelManifest(
      { ...conv, mapping: { ...conv.mapping, file } },
      { unpublished: true },
    );
    assert.equal(r.ok ? 'accepted' : r.error.code, 'invalid-asset', file);
  }
  const both = api.parseModelManifest(
    { ...conv, mapping: { ...conv.mapping, url: 'https://h/m' } },
    { unpublished: true },
  );
  assert.equal(both.ok ? 'accepted' : both.error.code, 'invalid-asset');
});

test('invalid manifests are typed rejections', () => {
  const base = fixture('candidate-runtime-manifest.json');
  const cases: [unknown, string][] = [
    [null, 'not-an-object'],
    [{ ...base, schemaVersion: 0 }, 'unsupported-major'],
    [{ ...base, schemaVersion: '1' }, 'invalid-field'],
    [{ ...base, modelSourceSha256: 'XYZ' }, 'invalid-field'],
    [{ ...base, mapping: { ...base.mapping, url: 'http://insecure/x' } }, 'invalid-asset'],
    [{ ...base, mapping: { ...base.mapping, url: 'https://user:pw@host/x' } }, 'invalid-asset'],
    [{ ...base, synthesis: { ...base.synthesis, size: base.synthesis.size + 1 } }, 'invalid-asset'],
    [
      {
        ...base,
        encoderStream: { ...base.encoderStream, maxWasmBytes: api.E4E_MAX_WASM_BYTES + 1 },
      },
      'invalid-field',
    ],
    [{ ...base, kernel: { ...base.kernel, sourceHash: 'nope' } }, 'invalid-field'],
    [
      { ...base, webgpu: { ...base.webgpu, prefix: { ...base.webgpu.prefix, sha256: 'short' } } },
      'invalid-asset',
    ],
  ];
  for (const [value, code] of cases) {
    const r = api.parseModelManifest(value);
    assert.equal(r.ok ? 'accepted' : r.error.code, code);
  }
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutate(value: unknown, random: () => number, odd: unknown[], depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 5 || random() < 0.1)
    return odd[Math.floor(random() * odd.length)];
  const copy: Record<string, unknown> = Array.isArray(value)
    ? ([...value] as unknown as Record<string, unknown>)
    : { ...(value as Record<string, unknown>) };
  const keys = Object.keys(copy);
  if (keys.length === 0) return odd[Math.floor(random() * odd.length)];
  const key = keys[Math.floor(random() * keys.length)]!;
  if (random() < 0.1) delete copy[key];
  else copy[key] = mutate(copy[key], random, odd, depth + 1);
  return copy;
}

test('manifest fuzz (seed 20261024, 3000 cases): every mutation is accepted or a typed rejection', () => {
  const base = fixture('candidate-runtime-manifest.json');
  const random = mulberry32(20261024);
  const odd: unknown[] = [
    null,
    -1,
    0,
    1.5,
    2,
    '',
    'x',
    'http://x/y',
    'f'.repeat(64),
    [],
    {},
    true,
    2 ** 53,
  ];
  const counts: Record<string, number> = {};
  const cases = 3000;
  for (let i = 0; i < cases; i++) {
    const r = api.parseModelManifest(mutate(base, random, odd));
    const k = r.ok ? 'accepted' : r.error.code;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b),
    cases,
  );
  assert.ok(
    (counts['invalid-asset'] ?? 0) + (counts['invalid-field'] ?? 0) > cases / 3,
    'the fuzz reaches field validation',
  );
  console.log(`manifest fuzz: ${cases} cases`, counts);
});

test('acquisition budgets: aggregate figures per memory class; transfer is the grant, never a constant', () => {
  assert.equal(api.acquisitionMemoryClass(undefined), 'constrained-or-unknown');
  assert.equal(api.acquisitionMemoryClass(7.9), 'constrained-or-unknown');
  assert.equal(api.acquisitionMemoryClass(8), 'ample');
  const phone = api.acquisitionBudget('constrained-or-unknown', 5);
  assert.deepEqual(phone, {
    transferBytes: 5,
    readAheadBytes: 33554432,
    hashBytes: 16777280,
    writeBufferBytes: 16777216,
  });
  assert.equal(api.acquisitionBudget('ample', 0).readAheadBytes, 67108864);
  for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => api.acquisitionBudget('ample', bad), RangeError);
  // Every chunk of the candidate's manifest fits one read-ahead slot and one write buffer.
  const m = fixture('candidate-runtime-manifest.json');
  const chunks = [m.synthesis, m.encoder].flatMap((a: { chunks: { size: number }[] }) => a.chunks);
  assert.ok(chunks.length > 0);
  for (const c of chunks) assert.ok(c.size <= api.ACQUISITION_CHUNK_MAX_BYTES, String(c.size));
});

test("live residency covers the candidate's generator bundle and its streamed encoder heap", () => {
  const m = fixture('candidate-runtime-manifest.json');
  const generator =
    m.mapping.size +
    m.synthesis.size +
    m.average.size +
    m.noise.reduce((n: number, a: { size: number }) => n + a.size, 0);
  assert.ok(generator <= api.LIVE_RESIDENCY_LIMIT.maxResidentBytes, String(generator));
  assert.equal(m.encoderStream.maxWasmBytes, api.LIVE_RESIDENCY_LIMIT.maxResidentBytes);
  assert.equal(api.LIVE_RESIDENCY_LIMIT.maxLiveSessions, 2);
});

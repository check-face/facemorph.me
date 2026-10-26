// fm-qrfz: the grants the app hands its workers (src/Next/browser/bridge-grant.mjs), on the pinned runtime manifest.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  chargeGrant,
  grantAsset,
  grantRemaining,
  GrantRefused,
} from '../../../../packages/browser-model-manager/src/acquisition/grants.ts';
import {
  appGrants as appGrantsJs,
  BRIDGE_OWNER,
  chooseGrant,
  createApprovalGenerations,
  mergeGrants,
  resolveDiscoveredGrants,
  widenWithin,
} from '../Next/browser/bridge-grant.mjs';
import { CHUNK_RETRY_DELAYS_MS } from '../Next/Assets/model-cache.mjs';
import { collectAssets } from '../Next/browser/acquisition-budget.mjs';
import { routeAssets } from '../Next/model-inventory.mjs';

type Asset = { sha256: string; size: number; url: string };
// bridge-grant.mjs is plain JS: its grants are AcquisitionGrant-shaped objects (with allowances), or null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const appGrants = appGrantsJs as (options: object) => Promise<{ approved: any; local: any }>;
const SHA = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const manifest = JSON.parse(
  readFileSync(
    new URL(`../../../../import/runtime-manifests/control/${SHA}/manifest.json`, import.meta.url),
    'utf8',
  ),
) as Record<string, any>;
const retries = 1 + CHUNK_RETRY_DELAYS_MS.length;
const cacheOf = (present: readonly string[] = [], descriptor: unknown = null) => ({
  has: async (a: Asset) => present.includes(a.sha256),
  peek: async () => (descriptor === null ? null : { text: async () => JSON.stringify(descriptor) }),
});
const sum = (xs: readonly { bytes: number }[]) => xs.reduce((n, a) => n + a.bytes, 0);
const cpu = routeAssets(manifest, 'cpu', 'ort') as Asset[];
const stream = manifest['encoderStream'] as Asset;
const descriptorBytes = readFileSync(
  new URL(
    '../../../../import/runtime-manifests/encoder-stream/417811d879ac9ef5a8714f38a453571d86e7168047e3d22b7d809b74905bf468/manifest.json',
    import.meta.url,
  ),
);
const pinnedDescriptor = JSON.parse(descriptorBytes.toString('utf8')) as {
  steps: Asset[];
};

test('nothing approved and nothing cached: no grant, so every acquisition is refused before a request', async () => {
  const grants = await appGrants({ manifest, manifestSha256: SHA, cache: cacheOf() });
  assert.deepEqual(grants, { approved: null, local: null });
  assert.equal(chooseGrant(grants, cpu[0]), null);
  assert.throws(
    () => grantAsset(undefined, BRIDGE_OWNER, cpu[0]!.sha256, cpu[0]!.size),
    (e: unknown) => e instanceof GrantRefused && e.refusal === 'no-grant',
  );
});

test('approving the route covers exactly this route’s assets, with the retry allowance, and nothing of the photo path', async () => {
  const { approved } = await appGrants({
    manifest,
    manifestSha256: SHA,
    route: 'cpu',
    approved: new Set(['route']),
    cache: cacheOf(),
  });
  assert.deepEqual(
    approved!.assets.map((a: { sha256: string }) => a.sha256).sort(),
    [...new Set(cpu.map((a) => a.sha256))].sort(),
  );
  assert.ok(
    approved!.assets.every((a: { priority: string }) => a.priority === 'synthesis-prerequisite'),
  );
  assert.equal(approved!.remainingBytes, sum(approved!.assets) * retries);
  assert.equal(approved!.purpose, 'generate');
  const grants = { approved, local: null };
  assert.equal(
    chooseGrant(grants, stream),
    null,
    'the encoder descriptor needs the photo approval',
  );
  const gpuOnly = (routeAssets(manifest, 'webgpu', 'direct') as Asset[]).find(
    (a) => !cpu.some((c) => c.sha256 === a.sha256),
  )!;
  assert.equal(
    chooseGrant(grants, gpuOnly),
    null,
    'another route’s files are a new cost, asked again',
  );
});

test('approving a photo before its descriptor is read admits shards against the advertised bytes, never beyond', async () => {
  const { approved } = await appGrants({
    manifest,
    manifestSha256: SHA,
    route: 'cpu',
    approved: new Set(['photo']),
    cache: cacheOf(),
  });
  const encoderSize = (manifest['encoder'] as Asset).size;
  assert.deepEqual(approved!.allowances, [
    { via: stream.sha256, bytes: encoderSize, priority: 'foreground-required' },
  ]);
  assert.ok(chooseGrant({ approved, local: null }, stream), 'the descriptor itself is approved');
  assert.equal(approved!.remainingBytes, (sum(approved!.assets) + encoderSize) * retries);
  const shard = (c: string, size: number): Asset => ({
    sha256: c.repeat(64),
    size,
    url: `https://next.facemorph.me/runtime/${c}`,
  });
  const descriptor = {
    steps: [shard('a', encoderSize - 1000), shard('b', 600), shard('c', 600)],
  };
  // Spend part of the grant first: widening must keep what is left, not start a new budget.
  const charge = chargeGrant(approved!, stream.sha256, stream.size);
  charge.received(stream.size);
  charge.settle();
  const left = grantRemaining(approved!);
  const widened = widenWithin(approved!, stream.sha256, descriptor);
  assert.equal(grantRemaining(widened), left);
  assert.ok(chooseGrant({ approved: widened, local: null }, descriptor.steps[0]!));
  assert.ok(chooseGrant({ approved: widened, local: null }, descriptor.steps[1]!));
  assert.equal(
    chooseGrant({ approved: widened, local: null }, descriptor.steps[2]!),
    null,
    'the shard past the advertised bytes is asked again',
  );
  assert.equal(widened.allowances[0].bytes, 400);
  assert.equal(
    widenWithin(approved!, 'f'.repeat(64), descriptor),
    approved,
    'another descriptor widens nothing',
  );
});

test('cached files the approval does not cover are readable but never fetched', async () => {
  const cachedGpu = (routeAssets(manifest, 'webgpu', 'direct') as Asset[]).find(
    (a) => !cpu.some((c) => c.sha256 === a.sha256),
  )!;
  const grants = await appGrants({
    manifest,
    manifestSha256: SHA,
    route: 'cpu',
    approved: new Set(['route']),
    cache: cacheOf([cpu[0]!.sha256, cachedGpu.sha256]),
  });
  assert.deepEqual(
    grants.local!.assets.map((a: { sha256: string }) => a.sha256),
    [cachedGpu.sha256],
    'an approved file is in the approved grant only',
  );
  const local = chooseGrant(grants, cachedGpu);
  assert.equal(local, grants.local);
  assert.equal(local.remainingBytes, 0);
  assert.throws(
    () => chargeGrant(local, cachedGpu.sha256, 1),
    (e: unknown) => e instanceof GrantRefused && e.refusal === 'revision-required',
  );
  assert.equal(chooseGrant(grants, cpu[0]), grants.approved);
});

test('posting the same grants again keeps their ledgers; a new approval replaces them', async () => {
  const make = (approved: Set<string>) =>
    appGrants({ manifest, manifestSha256: SHA, route: 'cpu', approved, cache: cacheOf() });
  const first = await make(new Set(['route']));
  const charge = chargeGrant(first.approved!, cpu[0]!.sha256, 10);
  charge.received(10);
  charge.settle();
  const again = mergeGrants(first, structuredClone(await make(new Set(['route']))));
  assert.equal(again.approved, first.approved, 'the same grant posted again keeps its spent bytes');
  assert.equal(grantRemaining(again.approved!), grantRemaining(first.approved!));
  const photo = mergeGrants(first, await make(new Set(['photo'])));
  assert.notEqual(photo.approved, first.approved);
  assert.equal(photo.approved!.purpose, 'generate-and-encode');
});

test('descriptor discovery cannot inflate a frozen approval; only a new decision admits the exact larger set', async () => {
  const approvals = createApprovalGenerations();
  const encoderSize = (manifest['encoder'] as Asset).size;
  const oversized = {
    shards: [{ sha256: 'a'.repeat(64), size: encoderSize + 1, url: '/extra-shard' }],
  };
  const options = { manifest, manifestSha256: SHA, approved: new Set(['photo']), cache: cacheOf() };
  approvals.approve('photo');
  const [first, concurrent] = await Promise.all([
    approvals.snapshot(options),
    approvals.snapshot(options),
  ]);
  assert.equal(first.grants, concurrent.grants, 'simultaneous pushes freeze one scope');
  const frozen = first.grants.approved;
  assert.ok(frozen);
  const discovered = { ...options, cache: cacheOf([], oversized) };
  const again = await approvals.snapshot(discovered);
  assert.equal(
    again.grants.approved,
    frozen,
    'later inventory does not rebuild the approved scope',
  );
  const bounded = widenWithin(frozen, stream.sha256, oversized);
  assert.equal(
    chooseGrant({ approved: bounded, local: null }, oversized.shards[0]),
    null,
    'a shard above the displayed allowance is refused before acquisition',
  );
  approvals.approve('photo'); // the person accepts the revised exact amount
  const revised = await approvals.snapshot(discovered);
  assert.equal(approvals.current(first.id), false);
  assert.equal(approvals.current(revised.id), true);
  assert.notEqual(revised.grants.approved!.approvalId, frozen.approvalId);
  assert.ok(chooseGrant(revised.grants, oversized.shards[0]));
  assert.deepEqual(
    revised.grants.approved!.allowances,
    [],
    'the revised decision knows the exact shards',
  );
});

test('actual crop-batch entry refuses the pinned descriptor overage before starting the runtime or encoder', async () => {
  assert.equal(createHash('sha256').update(descriptorBytes).digest('hex'), stream.sha256);
  assert.equal(descriptorBytes.byteLength, stream.size);
  const approvals = createApprovalGenerations();
  approvals.approve('photo');
  const first = await approvals.snapshot({ manifest, manifestSha256: SHA, cache: cacheOf() });
  const frozen = first.grants.approved;
  const before = structuredClone(frozen);
  const bounded = widenWithin(frozen, stream.sha256, pinnedDescriptor);
  const uncovered = (collectAssets(pinnedDescriptor) as Asset[]).find(
    (asset) => !chooseGrant({ approved: bounded, local: first.grants.local }, asset),
  );
  assert.ok(uncovered, 'the real pinned descriptor exceeds the advertised encoder allowance');

  const source = readFileSync(new URL('../Next/product-bridge.mjs', import.meta.url), 'utf8');
  const entry = source
    .slice(
      source.indexOf('export async function encodeCropBatch('),
      source.indexOf('export async function retryCropSlots('),
    )
    .replace('export ', '');
  let runtimeStarts = 0;
  let encoderCalls = 0;
  const context = vm.createContext({
    pushGrants: async (options: { strict?: boolean }) => {
      assert.equal(options.strict, true, 'foreground encoding requests strict preflight');
      return resolveDiscoveredGrants(first.grants, stream.sha256, pinnedDescriptor, cacheOf());
    },
    engine: async () => {
      runtimeStarts++;
      return {
        encodeConfirmedCrops: () => {
          encoderCalls++;
        },
      };
    },
  });
  const encode = vm.runInContext(`${entry}\nencodeCropBatch`, context) as (
    files: unknown[],
  ) => Promise<unknown>;
  await assert.rejects(
    encode([]),
    (error: unknown) =>
      error instanceof GrantRefused &&
      error.refusal === 'revision-required' &&
      error.sha256 === uncovered.sha256,
  );
  assert.deepEqual([runtimeStarts, encoderCalls], [0, 0]);
  assert.equal(approvals.current(first.id), true, 'discovery cannot create a new decision');
  assert.equal((await approvals.snapshot({ manifest, cache: cacheOf() })).grants, first.grants);
  assert.deepEqual(frozen, before, 'a refused discovery cannot alter the frozen approval');
});

test('actual inputs preflights only a new photo, preserving synthesis and cached photos under an underestimated photo approval', async () => {
  const approvals = createApprovalGenerations();
  approvals.approve('photo');
  const { grants } = await approvals.snapshot({ manifest, manifestSha256: SHA, cache: cacheOf() });
  await assert.rejects(
    resolveDiscoveredGrants(grants, stream.sha256, pinnedDescriptor, cacheOf()),
    GrantRefused,
  );
  const source = readFileSync(new URL('../Next/product-bridge.mjs', import.meta.url), 'utf8');
  const entry = source.slice(
    source.indexOf('async function inputs('),
    source.indexOf('async function commit('),
  );
  const reuse = source.slice(
    source.indexOf('function sameSource('),
    source.indexOf('function superseded('),
  );
  for (const mode of ['seed', 'text', 'cached-photo', 'new-photo'] as const) {
    const file = new Blob(['photo']);
    const item = {
      id: 'face-1',
      mode: mode.includes('photo') ? 'photo' : mode,
      value: '32',
      file: mode.includes('photo') ? file : null,
    };
    const result = {
      latent: { space: 'w-plus', shape: [1, 1], values: new Float32Array([1]) },
      provenance: {
        bundleVersion: 'test',
        manifestSha256: SHA,
        modelSha256: manifest['modelSourceSha256'],
        noiseSha256: manifest['noiseSha256'],
      },
      source: { mode: 'photo', value: item.value, file },
    };
    const faces = new Map(mode === 'cached-photo' ? [[item.id, result]] : []);
    let strictCalls = 0,
      encoded = 0,
      generated = 0,
      committed = 0;
    const service = {
      encodePhoto: async () => {
        encoded++;
        return result;
      },
    };
    const context = vm.createContext({
      Blob,
      Float32Array,
      Array,
      Map,
      faces,
      engine: async () => service,
      checked() {},
      progress() {},
      revisionOf: () => 1,
      active: { signal: new AbortController().signal },
      jobCounts: {},
      pushGrants: async (options: { strict?: boolean }) => {
        assert.equal(options.strict, true);
        strictCalls++;
        return resolveDiscoveredGrants(grants, stream.sha256, pinnedDescriptor, cacheOf());
      },
      generateNameOrSeed: async (_service: unknown, input: { mode: string }) => {
        assert.equal(input.mode, mode);
        generated++;
        return result;
      },
      canonicalProject: (project: unknown) => project,
      GEOMETRY_VERSION: 'test',
      rememberLast: undefined,
      commit: async (next: Map<string, unknown>) => {
        assert.ok(next.has(item.id));
        committed++;
      },
    });
    const run = vm.runInContext(`${reuse}\n${entry}\ninputs`, context) as (
      request: object,
      revisions: Map<string, number>,
    ) => Promise<unknown>;
    const running = run({ inputs: [item] }, new Map([[item.id, 1]]));
    if (mode === 'new-photo') await assert.rejects(running, GrantRefused);
    else await running;
    assert.equal(strictCalls, mode === 'new-photo' ? 1 : 0, mode);
    assert.equal(encoded, 0, 'no new encoder starts without its exact approved scope');
    assert.equal(generated, mode === 'seed' || mode === 'text' ? 1 : 0, mode);
    assert.equal(committed, mode === 'new-photo' ? 0 : 1, mode);
  }
});

test('an explicit revised decision admits every pinned descriptor asset without another cache or approval change', async () => {
  const approvals = createApprovalGenerations();
  const options = { manifest, manifestSha256: SHA, cache: cacheOf() };
  approvals.approve('photo');
  const first = await approvals.snapshot(options);
  await assert.rejects(
    resolveDiscoveredGrants(first.grants, stream.sha256, pinnedDescriptor, cacheOf()),
    GrantRefused,
  );
  approvals.approve('photo');
  const revised = await approvals.snapshot({ ...options, cache: cacheOf([], pinnedDescriptor) });
  const resolved = await resolveDiscoveredGrants(revised.grants, stream.sha256, pinnedDescriptor, {
    has: async () => assert.fail('the exact approved scope needs no local-cache admission'),
  });
  assert.equal(resolved.approved, revised.grants.approved);
  assert.equal(resolved.local, revised.grants.local);
  assert.notEqual(resolved.approved.approvalId, first.grants.approved!.approvalId);
  assert.deepEqual(resolved.approved.allowances, []);
  for (const asset of collectAssets(pinnedDescriptor) as Asset[])
    assert.equal(chooseGrant(resolved, asset), revised.grants.approved);
  assert.equal(approvals.current(first.id), false);
  assert.equal(approvals.current(revised.id), true);
});

test('verified cached descriptor overage is local-only and never renews or spends the approved transfer budget', async () => {
  const approvals = createApprovalGenerations();
  approvals.approve('photo');
  const { id, grants } = await approvals.snapshot({
    manifest,
    manifestSha256: SHA,
    cache: cacheOf(),
  });
  const bounded = widenWithin(grants.approved, stream.sha256, pinnedDescriptor);
  const uncovered = (collectAssets(pinnedDescriptor) as Asset[]).filter(
    (asset) => !chooseGrant({ approved: bounded, local: grants.local }, asset),
  );
  assert.ok(uncovered.length);
  const checked: Asset[] = [];
  const remaining = grantRemaining(grants.approved!);
  const resolved = await resolveDiscoveredGrants(grants, stream.sha256, pinnedDescriptor, {
    has: async (asset: Asset) => {
      checked.push(asset);
      return uncovered.some(
        (cached) => cached.sha256 === asset.sha256 && cached.size === asset.size,
      );
    },
  });
  assert.deepEqual(checked, uncovered, 'only assets absent from the exact grants need cache proof');
  assert.equal(resolved.local.remainingBytes, 0);
  assert.equal(grantRemaining(resolved.local), 0);
  assert.equal(grantRemaining(resolved.approved), remaining);
  assert.equal(resolved.approved.approvalId, grants.approved!.approvalId);
  assert.equal(approvals.current(id), true, 'verified local bytes need no revised decision');
  for (const asset of collectAssets(pinnedDescriptor) as Asset[])
    assert.ok(chooseGrant(resolved, asset));
  for (const asset of uncovered) {
    assert.equal(chooseGrant(resolved, asset), resolved.local);
    assert.throws(
      () => chargeGrant(resolved.local, asset.sha256, 1),
      (error: unknown) => error instanceof GrantRefused && error.refusal === 'revision-required',
    );
  }
});

test('descriptor preflight carries spent bytes through widening and requires exact digest and size coverage', async () => {
  const { approved } = await appGrants({
    manifest,
    manifestSha256: SHA,
    approved: new Set(['photo']),
    cache: cacheOf(),
  });
  const charge = chargeGrant(approved, stream.sha256, stream.size);
  charge.received(stream.size);
  charge.settle();
  const remaining = grantRemaining(approved);
  const originalAssets = [...approved.assets];
  const descriptor = { steps: pinnedDescriptor.steps.slice(0, 2) };
  const resolved = await resolveDiscoveredGrants(
    { approved, local: null },
    stream.sha256,
    descriptor,
    { has: async () => assert.fail('the frozen allowance covers these first pinned shards') },
  );
  assert.notEqual(resolved.approved, approved);
  assert.equal(grantRemaining(resolved.approved), remaining);
  assert.equal(grantRemaining(approved), remaining);
  assert.deepEqual(approved.assets, originalAssets);
  for (const asset of descriptor.steps)
    assert.equal(chooseGrant(resolved, asset), resolved.approved);
  const again = await resolveDiscoveredGrants(resolved, stream.sha256, descriptor, cacheOf());
  assert.equal(again.approved, resolved.approved, 'repeated discovery changes no grant or ledger');
  assert.equal(again.local, resolved.local);

  const asset = descriptor.steps[0]!;
  const wrongSize = {
    ...resolved.approved,
    allowances: [],
    assets: [{ sha256: asset.sha256, bytes: asset.size + 1 }],
  };
  await assert.rejects(
    resolveDiscoveredGrants(
      { approved: wrongSize, local: wrongSize },
      stream.sha256,
      { steps: [asset] },
      cacheOf(),
    ),
    (error: unknown) =>
      error instanceof GrantRefused &&
      error.refusal === 'revision-required' &&
      error.sha256 === asset.sha256,
  );
});

test('reposting an approval retains its widened ledger; explicit identical reapproval renews it', async () => {
  const approvals = createApprovalGenerations();
  const options = { manifest, manifestSha256: SHA, approved: new Set(['photo']), cache: cacheOf() };
  approvals.approve('photo');
  const { grants: first } = await approvals.snapshot(options);
  const shard = { sha256: 'a'.repeat(64), size: 400, url: '/shard' };
  const widened = widenWithin(first.approved, stream.sha256, { shards: [shard] });
  const charge = chargeGrant(widened, shard.sha256, shard.size);
  charge.received(shard.size);
  charge.settle();
  const left = grantRemaining(widened);
  const reposted = mergeGrants({ approved: widened, local: first.local }, structuredClone(first));
  assert.equal(
    reposted.approved,
    widened,
    'same approval retains discovered assets and spent bytes',
  );
  assert.equal(grantRemaining(reposted.approved), left);
  assert.equal(
    reposted.approved.allowances[0].bytes,
    (manifest['encoder'] as Asset).size - shard.size,
  );
  assert.ok(chooseGrant(reposted, shard));
  approvals.approve('photo');
  const { grants: renewed } = await approvals.snapshot(options);
  const merged = mergeGrants(reposted, structuredClone(renewed));
  assert.notEqual(merged.approved, widened, 'a real new decision can renew identical asset scope');
  assert.equal(grantRemaining(merged.approved), first.approved!.remainingBytes);
});

test('a late snapshot from an older approval cannot become the current decision', async () => {
  const approvals = createApprovalGenerations();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const options = { manifest, manifestSha256: SHA, approved: new Set(['route']), cache: cacheOf() };
  const slow = {
    ...options,
    cache: {
      ...cacheOf(),
      peek: async () => {
        await held;
        return null;
      },
    },
  };
  approvals.approve('route');
  const old = approvals.snapshot(slow);
  approvals.approve('route');
  const current = await approvals.snapshot(options);
  release();
  assert.equal(approvals.current((await old).id), false);
  assert.equal(approvals.current(current.id), true);
});

test('an unrelated route approval never renews or expands an earlier photo approval', async () => {
  const approvals = createApprovalGenerations();
  const oversized = {
    shards: [
      {
        sha256: 'a'.repeat(64),
        size: (manifest['encoder'] as Asset).size + 1,
        url: '/extra-shard',
      },
    ],
  };
  const options = { manifest, manifestSha256: SHA, route: 'cpu', cache: cacheOf() };
  approvals.approve('photo');
  const photo = await approvals.snapshot(options);
  assert.ok(photo.grants.approved!.allowances.length);
  const exact = { ...options, cache: cacheOf([], oversized) };
  assert.equal((await approvals.snapshot(exact)).grants, photo.grants);

  // After cancelling the revised photo dialog, a name-only run asks for another route's files.
  approvals.approve('route');
  const route = await approvals.snapshot({ ...exact, route: 'webgpu', engine: 'direct' });
  assert.equal(route.grants.approved!.purpose, 'generate');
  assert.deepEqual(route.grants.approved!.allowances, []);
  assert.equal(
    chooseGrant(route.grants, stream),
    null,
    'route consent cannot renew descriptor bytes',
  );
  assert.equal(
    chooseGrant(route.grants, oversized.shards[0]),
    null,
    'exact photo cost still needs photo consent',
  );
  const gpuOnly = (routeAssets(manifest, 'webgpu', 'direct') as Asset[]).find(
    (a) => !cpu.some((c) => c.sha256 === a.sha256),
  )!;
  assert.ok(chooseGrant(route.grants, gpuOnly), 'the explicit route decision covers the new route');

  approvals.approve('photo');
  const reapproved = await approvals.snapshot({ ...exact, route: 'webgpu', engine: 'direct' });
  assert.ok(
    chooseGrant(reapproved.grants, oversized.shards[0]),
    'only explicit photo reapproval admits exact cost',
  );
});

test('an automatic route change never adopts a new route under an old decision', async () => {
  const approvals = createApprovalGenerations();
  const options = { manifest, manifestSha256: SHA, route: 'cpu', cache: cacheOf() };
  approvals.approve('route');
  const first = await approvals.snapshot(options);
  const fallback = await approvals.snapshot({ ...options, route: 'webgpu', engine: 'direct' });
  assert.equal(fallback.grants, first.grants);
  assert.equal(fallback.grants.approved!.route, 'cpu');
  const gpuOnly = (routeAssets(manifest, 'webgpu', 'direct') as Asset[]).find(
    (a) => !cpu.some((c) => c.sha256 === a.sha256),
  )!;
  assert.equal(chooseGrant(fallback.grants, gpuOnly), null);
});

test('the actual worker preflights the complete encoder scope before downloading any shards', async () => {
  const approvals = createApprovalGenerations();
  approvals.approve('photo');
  const { grants } = await approvals.snapshot({ manifest, manifestSha256: SHA, cache: cacheOf() });
  const encoderSize = (manifest['encoder'] as Asset).size;
  const descriptor = {
    steps: [
      { sha256: 'a'.repeat(64), size: encoderSize - 1, url: '/first-shard' },
      { sha256: 'b'.repeat(64), size: 2, url: '/over-budget-shard' },
    ],
  };
  const source = readFileSync(new URL('../Next/browser/ort-worker.mjs', import.meta.url), 'utf8');
  const admission = source.slice(
    source.indexOf('function admitDescriptor('),
    source.indexOf('async function floats('),
  );
  const encode = source.slice(
    source.indexOf('async function encodeStream('),
    source.indexOf('async function load('),
  );
  const fetched: string[] = [];
  const context = vm.createContext({
    manifest,
    grants,
    chooseGrant,
    widenWithin,
    collectAssets,
    GrantRefused,
    TextDecoder,
    performance,
    JSON,
    bytes: async (asset: Asset) => {
      fetched.push(asset.sha256);
      return new TextEncoder().encode(JSON.stringify(descriptor));
    },
    planAsset: () =>
      assert.fail('No encoder asset should be planned for acquisition before scope is complete'),
  });
  const run = vm.runInContext(
    `${admission}\n${encode}\nencodeStream`,
    context,
  ) as () => Promise<unknown>;
  await assert.rejects(
    run(),
    (error: unknown) =>
      error instanceof GrantRefused &&
      error.refusal === 'revision-required' &&
      error.sha256 === descriptor.steps[1]!.sha256,
  );
  assert.deepEqual(
    fetched,
    [stream.sha256],
    'only the approved descriptor was read, never the admissible prefix of shards',
  );
});

test('the actual uncached encoder reader preserves a mid-step grant refusal as a consent decision', async () => {
  const source = readFileSync(new URL('../Next/browser/ort-worker.mjs', import.meta.url), 'utf8');
  const readerSource = source.slice(
    source.indexOf(' const local=asset=>'),
    source.indexOf(' // The runtime is the small half:'),
  );
  assert.ok(readerSource.includes('const reader='));
  const refused = new GrantRefused('revision-required', 'a'.repeat(64));
  const context = vm.createContext({
    cache: { uncached: true },
    bytes: async () => {
      throw refused;
    },
    compute: async (work: () => unknown) => work(),
    id: 1,
  });
  const reader = vm.runInContext(`${readerSource}\nreader`, context) as {
    read(asset: Asset): Promise<unknown>;
  };
  await assert.rejects(
    reader.read({ sha256: 'a'.repeat(64), size: 1, url: '/shard' }),
    (error: unknown) => error === refused,
  );
});

test('actual photo-selection wrapper reads no descriptor for unreadable, cancelled or recovered input', async () => {
  const source = readFileSync(new URL('../Next/product-bridge.mjs', import.meta.url), 'utf8');
  const wrapper = source
    .slice(
      source.indexOf('export async function selectPhotoReported('),
      source.indexOf('export function previewPhotoReported('),
    )
    .replace('export ', '');
  for (const outcome of ['unreadable', 'cancelled', 'recovered'] as const) {
    let inspections = 0;
    let selections = 0;
    const context = vm.createContext({
      Blob,
      Uint8Array,
      URL,
      revisionOf: () => 1,
      analytics: { operationResult() {}, photoSelected() {} },
      inspectForPhoto: () => {
        inspections++;
      },
      recoverVideoProject: async () => null,
      recoverImage: async () => (outcome === 'recovered' ? { generationKind: 'blend' } : null),
      fetch: async (url: string) => {
        assert.equal(
          url,
          '/runtime/manifest.json',
          'recovery may inspect identity, not model files',
        );
        return { ok: true, json: async () => ({}) };
      },
      checkFaceModel() {},
      register: async () => {},
      snapshot: () => ({}),
      warmPhotoTools() {},
      photoStage: (_stage: string, run: () => unknown) => run(),
      selectPhoto: async () => {
        selections++;
        if (outcome === 'unreadable') throw Error('This photo could not be read.');
        return null;
      },
    });
    const select = vm.runInContext(`${wrapper}\nselectPhotoReported`, context) as (
      request: object,
    ) => Promise<unknown>;
    const result = select({ id: 'face-1', files: [new Blob(['unreadable'])] });
    if (outcome === 'unreadable') await assert.rejects(result, /could not be read/);
    else await result;
    assert.equal(inspections, 0, outcome);
    assert.equal(selections, outcome === 'recovered' ? 0 : 1, outcome);
  }
});

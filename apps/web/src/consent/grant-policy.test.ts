// fm-qrfz rows 1 and 2: the grant state machine and no repeated asks. Pure: events and timestamps are plain inputs.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GrantOwnerId } from '@facemorph/browser-model-manager';
import {
  INSPECT_MS,
  initialPolicy,
  makeGrant,
  run,
  sha256Of,
  step,
  type Effect,
  type NeededAsset,
  type Request,
  type Sha256,
} from './grant-policy.ts';

const sha = (c: string): Sha256 => sha256Of(c.repeat(64))!;
const GEN = sha('a');
const MAP = sha('b');
const DET = sha('c');
const ENC = sha('d');
const EXTRA = sha('e');
const MANIFEST = 'f'.repeat(64);

const asset = (
  sha256: Sha256,
  bytes: number | null,
  priority: NeededAsset['priority'],
  inventory: NeededAsset['inventory'] = 'absent',
): NeededAsset => ({ sha256, bytes, priority, inventory });
const generator = (inventory: NeededAsset['inventory'] = 'absent') => [
  asset(GEN, 60_000_000, 'synthesis-prerequisite', inventory),
  asset(MAP, 2_000_000, 'synthesis-prerequisite', inventory),
];
const photo = (inventory: NeededAsset['inventory'] = 'absent') => [
  asset(DET, 1_000_000, 'detector-prerequisite', inventory),
  asset(ENC, 90_000_000, 'foreground-required', inventory),
];
const face = (owner: GrantOwnerId, assets = generator()): Request => ({
  owner,
  purpose: 'generate',
  manifestSha256: MANIFEST,
  route: 'cpu',
  assets,
});
const types = (effects: readonly Effect[]) => effects.map((e) => e.type);
const asks = (effects: readonly Effect[]) => effects.filter((e) => e.type === 'ask');
const fetched = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === 'fetch' ? [e.sha256] : []));
const stopped = (effects: readonly Effect[]) =>
  effects.flatMap((e) => (e.type === 'stop' ? [e.sha256] : []));

test('approve, cancel and resume: a cancelled intent stops its fetches; a new press asks again and resumes', () => {
  const [asked, e1] = step(initialPolicy, { type: 'request', request: face('face:1#1'), at: 0 });
  assert.deepEqual(types(e1), ['ask']);
  const decision =
    asks(e1)[0]!.type === 'ask' ? (asks(e1)[0] as Extract<Effect, { type: 'ask' }>).decision : null;
  assert.equal(decision!.bytes, 62_000_000);
  assert.equal(decision!.extraBytes, 62_000_000);
  const [approved, e2] = step(asked, { type: 'approve', decision: decision!.id, at: 1 });
  assert.deepEqual(fetched(e2), [GEN, MAP]);
  assert.deepEqual(types(e2).slice(-1), ['proceed']);
  assert.equal(approved.grants[0]!.remainingBytes, 62_000_000);
  const [cancelled, e3] = step(approved, { type: 'cancel', owner: 'face:1#1', at: 2 });
  assert.deepEqual(stopped(e3).sort(), [GEN, MAP].sort());
  assert.deepEqual(types(e3).slice(-1), ['abandon']);
  assert.equal(cancelled.grants.length, 0, 'no perpetual consent once every owner has left');
  // Resume is a new press, a new owner: asked again (the verified chunks the manager kept show up as partial).
  const [, e4] = step(cancelled, {
    type: 'request',
    request: face('face:1#2', generator('partial')),
    at: 3,
  });
  assert.deepEqual(types(e4), ['ask']);
});

test('two owners share one fetch: the first cancelling leaves it running; both cancelling stop it', () => {
  const [, effects] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'request', request: face('face:2#1', generator('partial')), at: 2 },
  ]);
  assert.equal(
    asks(effects).length,
    1,
    'the second owner joins the covering grant without a decision',
  );
  assert.deepEqual(fetched(effects), [GEN, MAP], 'one fetch per digest');
  const [shared] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'request', request: face('face:2#1', generator('partial')), at: 2 },
  ]);
  const [afterFirst, e1] = step(shared, { type: 'cancel', owner: 'face:1#1', at: 3 });
  assert.deepEqual(stopped(e1), []);
  assert.deepEqual(
    afterFirst.fetches.map((f) => f.owners),
    [['face:2#1'], ['face:2#1']],
  );
  const [afterBoth, e2] = step(afterFirst, { type: 'cancel', owner: 'face:2#1', at: 4 });
  assert.deepEqual(stopped(e2).sort(), [GEN, MAP].sort());
  assert.deepEqual(afterBoth.fetches, []);
});

test('cancel during inspection: the inspection result is ignored and nothing is fetched or asked', () => {
  const [, effects] = run([
    { type: 'request', request: face('face:1#1', generator('unknown')), at: 0 },
    { type: 'cancel', owner: 'face:1#1', at: 5 },
    { type: 'inspected', owner: 'face:1#1', assets: generator('absent'), at: 6 },
  ]);
  assert.deepEqual(types(effects), ['inspect', 'abandon']);
});

test('unknown inventory is inspected, then asked; never fetched', () => {
  const [inspecting, e1] = step(initialPolicy, {
    type: 'request',
    request: face('face:1#1', generator('unknown')),
    at: 0,
  });
  assert.deepEqual(types(e1), ['inspect']);
  assert.equal((e1[0] as Extract<Effect, { type: 'inspect' }>).until, INSPECT_MS);
  const [, e2] = step(inspecting, {
    type: 'inspected',
    owner: 'face:1#1',
    assets: generator('absent'),
    at: 100,
  });
  assert.deepEqual(types(e2), ['ask']);
  // Still unknown after inspection, or past the bound: Retry, never a fetch.
  const [, e3] = step(inspecting, {
    type: 'inspected',
    owner: 'face:1#1',
    assets: [asset(GEN, null, 'synthesis-prerequisite', 'unknown')],
    at: 100,
  });
  assert.deepEqual(types(e3), ['retry']);
  const [, e4] = step(inspecting, { type: 'tick', at: INSPECT_MS });
  assert.deepEqual(e4, [{ type: 'retry', owner: 'face:1#1', reason: 'inventory-unknown' }]);
  // A known asset with an unknown size is inspected too: no grant for bytes nobody counted.
  const [, e5] = step(initialPolicy, {
    type: 'request',
    request: face('face:1#1', [asset(GEN, null, 'synthesis-prerequisite')]),
    at: 0,
  });
  assert.deepEqual(types(e5), ['inspect']);
});

test('scope inflation needs a revised decision: an extra asset is asked for, naming the grant it extends', () => {
  const [, effects] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    {
      type: 'continue',
      request: face('face:1#1', [
        ...generator('partial'),
        asset(EXTRA, 5_000_000, 'foreground-required'),
      ]),
      at: 2,
    },
  ]);
  const revised = asks(effects)[1] as Extract<Effect, { type: 'ask' }>;
  assert.equal(revised.decision.revises, 1);
  assert.equal(revised.decision.extraBytes, 5_000_000, 'only the new asset is new to the person');
  assert.deepEqual(
    revised.decision.assets.map((a) => a.sha256),
    [GEN, MAP, EXTRA],
  );
  // A changed size of an approved digest is a new material cost too.
  const [, grown] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    {
      type: 'continue',
      request: face('face:1#1', [asset(GEN, 61_000_000, 'synthesis-prerequisite')]),
      at: 2,
    },
  ]);
  assert.equal(asks(grown).length, 2);
  // So is another route.
  const [, otherRoute] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'request', request: { ...face('face:2#1'), route: 'webgpu' }, at: 2 },
  ]);
  assert.equal(asks(otherRoute).length, 2);
});

test('a late continuation after Cancel is refused and restarts nothing', () => {
  const [, effects] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'cancel', owner: 'face:1#1', at: 2 },
    { type: 'continue', request: face('face:1#1', generator('partial')), at: 3 },
    { type: 'request', request: face('face:1#1', generator('partial')), at: 4 },
  ]);
  assert.deepEqual(types(effects).slice(-2), ['refuse', 'refuse']);
  assert.equal(fetched(effects).length, 2, 'only the first approval fetched');
});

test('a declined detector abandons its continuation; manual continuation is a new explicit request', () => {
  const crop: Request = {
    owner: 'photo:1#1',
    purpose: 'generate-and-encode',
    manifestSha256: MANIFEST,
    route: 'cpu',
    assets: photo(),
  };
  const [declined, e1] = run([
    { type: 'request', request: crop, at: 0 },
    { type: 'decline', decision: 1, at: 1 },
    { type: 'continue', request: crop, at: 2 },
  ]);
  assert.deepEqual(types(e1), ['ask', 'abandon', 'refuse']);
  assert.deepEqual(fetched(e1), []);
  const [, e2] = step(declined, {
    type: 'request',
    request: { ...crop, owner: 'photo:1#2' },
    at: 3,
  });
  assert.deepEqual(types(e2), ['ask']);
});

test('no repeated asks: a second Generate in a valid scope and a cached-and-verified action open no decision', () => {
  const [, effects] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'request', request: face('face:1#2', generator('partial')), at: 2 },
    { type: 'request', request: face('face:3#1', generator('verified-local')), at: 3 },
  ]);
  assert.equal(asks(effects).length, 1);
  assert.deepEqual(types(effects).slice(-1), ['proceed']);
  const [, cold] = step(initialPolicy, {
    type: 'request',
    request: face('face:1#1', generator('verified-local')),
    at: 0,
  });
  assert.deepEqual(cold, [{ type: 'proceed', owner: 'face:1#1' }]);
});

test('a photo request yields one grouped detector and encoder decision; approval fetches synthesis first', () => {
  const crop: Request = {
    owner: 'photo:1#1',
    purpose: 'generate-and-encode',
    manifestSha256: MANIFEST,
    route: 'cpu',
    assets: [...photo(), ...generator()],
  };
  const [, effects] = run([
    { type: 'request', request: crop, at: 0 },
    { type: 'approve', decision: 1, at: 1 },
  ]);
  const [ask] = asks(effects) as Extract<Effect, { type: 'ask' }>[];
  assert.equal(asks(effects).length, 1);
  assert.deepEqual(
    ask!.decision.assets.map((a) => a.sha256),
    [GEN, MAP, DET, ENC],
  );
  assert.deepEqual(
    fetched(effects),
    [GEN, MAP, DET, ENC],
    'generator, then detector, then encoder',
  );
});

test('only assets outside the grant or a new material cost produce a revised decision', () => {
  const crop: Request = {
    owner: 'photo:1#1',
    purpose: 'generate-and-encode',
    manifestSha256: MANIFEST,
    route: 'cpu',
    assets: photo(),
  };
  const [, effects] = run([
    { type: 'request', request: face('face:1#1'), at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'request', request: face('face:2#1', generator('partial')), at: 2 },
    { type: 'request', request: crop, at: 3 },
  ]);
  const all = asks(effects) as Extract<Effect, { type: 'ask' }>[];
  assert.equal(all.length, 2, 'the face inside the grant is not asked; the photo outside it is');
  assert.equal(all[1]!.decision.revises, 1);
  assert.equal(all[1]!.decision.extraBytes, 91_000_000);
});

test('makeGrant refuses an asset without a byte size; the approved scope is the assets total', () => {
  const g = makeGrant({
    id: 1,
    manifestSha256: MANIFEST,
    route: 'cpu',
    purpose: 'generate',
    assets: [
      { sha256: GEN, bytes: 10, priority: 'synthesis-prerequisite' },
      { sha256: MAP, bytes: 5, priority: 'synthesis-prerequisite' },
    ],
    owners: ['face:1#1'],
  });
  assert.equal(g.remainingBytes, 15);
  assert.throws(
    () =>
      makeGrant({
        id: 2,
        manifestSha256: MANIFEST,
        route: 'cpu',
        purpose: 'generate',
        assets: [{ sha256: GEN, bytes: Number.NaN, priority: 'synthesis-prerequisite' }],
        owners: ['face:1#1'],
      }),
    RangeError,
  );
  assert.equal(sha256Of('not a digest'), null);
});

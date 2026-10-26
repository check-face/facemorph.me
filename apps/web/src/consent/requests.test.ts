// fm-qrfz: grant-policy requests built from the pinned runtime manifest the deploy serves (d9e37e50).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { routeAssets } from '../Next/model-inventory.mjs';
import { run, sha256Of, type Effect, type Sha256 } from './grant-policy.ts';
import { faceRequest, photoRequest, type ManifestAsset } from './requests.ts';

const SHA = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const manifest = JSON.parse(
  readFileSync(
    new URL(`../../../../import/runtime-manifests/control/${SHA}/manifest.json`, import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const absent = () => 'absent' as const;
const common = { manifest, manifestSha256: SHA, route: 'cpu' as const, inventory: absent };
const stream = manifest['encoderStream'] as ManifestAsset;
const encoder = manifest['encoder'] as ManifestAsset;

test('a face asks for exactly the assets model-inventory.mjs sizes for its route, as synthesis prerequisites', () => {
  for (const route of ['cpu', 'webgpu'] as const) {
    const request = faceRequest({ ...common, route, owner: 'face:1#1' });
    const expected = routeAssets(manifest, route, 'ort') as ManifestAsset[];
    assert.deepEqual(
      request.assets.map((a) => [a.sha256, a.bytes]),
      [...new Map(expected.map((a) => [a.sha256, a.size])).entries()],
    );
    assert.ok(request.assets.length > 0);
    assert.ok(request.assets.every((a) => a.priority === 'synthesis-prerequisite'));
  }
});

test('a photo before its descriptor is read asks for synthesis, detector and descriptor, plus the advertised encoder', () => {
  const request = photoRequest({ ...common, owner: 'photo:1#1', descriptorShards: null });
  const priorities = new Set(request.assets.map((a) => a.priority));
  assert.deepEqual(
    [...priorities],
    ['synthesis-prerequisite', 'detector-prerequisite', 'foreground-required'],
  );
  assert.equal(
    request.assets.at(-1)!.sha256,
    stream.sha256,
    'the descriptor itself is fetched under the grant',
  );
  assert.deepEqual(request.discovers, {
    via: stream.sha256,
    bytes: encoder.size,
    priority: 'foreground-required',
  });
  // Through the policy: one grouped decision showing the advertised encoder bytes.
  const [, effects] = run([{ type: 'request', request, at: 0 }]);
  const ask = effects.find((e): e is Extract<Effect, { type: 'ask' }> => e.type === 'ask')!;
  const listed = request.assets.reduce((n, a) => n + (a.bytes ?? 0), 0);
  assert.equal(ask.decision.bytes, listed + encoder.size);
});

test('once the verified descriptor is read, its shards come via it and are covered by the approved allowance', () => {
  const shards: ManifestAsset[] = [
    { sha256: 'a'.repeat(64), size: 400_000_000, url: 'https://next.facemorph.me/runtime/s1' },
    { sha256: 'b'.repeat(64), size: 600_000_000, url: 'https://next.facemorph.me/runtime/s2' },
  ];
  const cold = photoRequest({ ...common, owner: 'photo:1#1', descriptorShards: null });
  const read = photoRequest({
    ...common,
    owner: 'photo:1#1',
    descriptorShards: shards,
    inventory: (sha: Sha256) => (sha === stream.sha256 ? 'verified-local' : 'absent'),
  });
  assert.equal(read.discovers, undefined);
  assert.deepEqual(
    read.assets.filter((a) => a.via).map((a) => [a.sha256, a.bytes, a.via]),
    shards.map((s) => [s.sha256, s.size, sha256Of(stream.sha256)]),
  );
  const [, effects] = run([
    { type: 'request', request: cold, at: 0 },
    { type: 'approve', decision: 1, at: 1 },
    { type: 'continue', request: read, at: 2 },
  ]);
  assert.equal(
    effects.filter((e) => e.type === 'ask').length,
    1,
    'the shards need no second decision',
  );
  assert.deepEqual(
    effects.flatMap((e) =>
      e.type === 'fetch' && shards.some((s) => s.sha256 === e.sha256) ? [e.sha256] : [],
    ),
    shards.map((s) => s.sha256),
  );
});

test('verified-local assets are reported as such, and a malformed digest is refused', () => {
  const warm = faceRequest({ ...common, owner: 'face:1#1', inventory: () => 'verified-local' });
  const [, effects] = run([{ type: 'request', request: warm, at: 0 }]);
  assert.deepEqual(effects, [{ type: 'proceed', owner: 'face:1#1' }]);
  assert.throws(
    () =>
      photoRequest({
        ...common,
        owner: 'photo:1#1',
        descriptorShards: [
          { sha256: 'not-a-digest', size: 1, url: 'https://next.facemorph.me/runtime/x' },
        ],
      }),
    /valid digest/,
  );
});

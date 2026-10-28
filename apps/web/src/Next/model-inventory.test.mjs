import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAssets, photoAssets, measure } from './model-inventory.mjs';

const asset = (sha, size) => ({ sha256: sha.repeat(64).slice(0, 64), size, url: 'https://next.facemorph.me/runtime/assets/' + sha });
const manifest = {
  runtime: { assets: [asset('a', 10)] }, mapping: asset('b', 20), average: asset('c', 1), noise: [asset('d', 5)],
  synthesis: asset('e', 100), webgpu: { prefix: asset('f', 150), suffix: asset('g', 30) }, webgl: asset('h', 90),
  landmarks: asset('i', 95), photoCanary: asset('j', 2), photoCanaries: [asset('k', 3)],
  encoderStream: asset('l', 1), encoder: asset('m', 1000)
};
const cacheWith = (present, descriptor) => ({
  has: async asset => present.has(asset.sha256),
  peek: async asset => descriptor && asset.sha256 === manifest.encoderStream.sha256 ? { text: async () => JSON.stringify(descriptor) } : null
});

test('the route set follows the route the device will use', () => {
  const sizes = route => routeAssets(manifest, route).reduce((sum, a) => sum + a.size, 0);
  assert.equal(sizes('cpu'), 136);
  assert.equal(sizes('webgpu'), 216);
  // The direct engine downloads the block-stream coefficients, not the ORT split graph.
  assert.equal(routeAssets(manifest, 'webgpu', 'direct').reduce((sum, a) => sum + a.size, 0), sizes('webgl'));
  assert.equal(sizes('webgl'), 126);
});

test('a missing encoder descriptor counts the encoder as still to download, without fetching', async () => {
  const listed = await photoAssets(manifest, cacheWith(new Set()));
  assert.equal(listed.estimated, true);
  const result = await measure(listed.assets, cacheWith(new Set()), listed.extraBytes);
  assert.equal(result.ready, false);
  assert.equal(result.total, 95 + 2 + 3 + 1 + 1000);
});

test('with the descriptor cached, readiness is exact over every shard', async () => {
  const shards = [asset('n', 500), asset('o', 500)];
  const all = new Set([...Object.values(manifest).flatMap(v => Array.isArray(v) ? v : [v]).map(a => a.sha256), ...shards.map(s => s.sha256)]);
  const listed = await photoAssets(manifest, cacheWith(all, { shards }));
  assert.equal(listed.estimated, false);
  assert.deepEqual(await measure(listed.assets, cacheWith(all), listed.extraBytes), { present: 1101, total: 1101, ready: true });
  all.delete(shards[1].sha256);
  const partial = await measure(listed.assets, cacheWith(all), 0);
  assert.equal(partial.ready, false);
  assert.equal(partial.total - partial.present, 500);
});

test('the route set counts the correctness canaries and sample indices the worker fetches before the first face', () => {
  const withChecks = { ...manifest, canaries: [{ w: asset('p', 7), png: asset('q', 3) }], sampleIndices: asset('r', 2) };
  const sizes = route => routeAssets(withChecks, route).reduce((sum, a) => sum + a.size, 0);
  assert.equal(sizes('cpu'), 136 + 7 + 3 + 2);
  assert.equal(sizes('webgpu'), 216 + 7 + 3 + 2);
});
// fm-9kr8: chunks an interrupted download already stored count as present, so the inventory (and the failure's
// remaining figure) is what is still to transfer; a cache without partial knowledge keeps whole-asset presence.
test('measure counts stored chunks of a partly downloaded asset', async () => {
  const { measure } = await import('./model-inventory.mjs');
  const a = { sha256: 'a'.repeat(64), size: 100 }, b = { sha256: 'b'.repeat(64), size: 50 };
  const partial = { has: async asset => asset === b, heldBytes: async asset => (asset === b ? 50 : 30) };
  assert.deepEqual(await measure([a, b], partial), { present: 80, total: 150, ready: false });
  const whole = { has: async asset => asset === b };
  assert.deepEqual(await measure([a, b], whole), { present: 50, total: 150, ready: false });
});

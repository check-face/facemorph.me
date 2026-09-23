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
  has: async sha => present.has(sha),
  peek: async sha => descriptor && sha === manifest.encoderStream.sha256 ? { text: async () => JSON.stringify(descriptor) } : null
});

test('the route set follows the route the device will use', () => {
  const sizes = route => routeAssets(manifest, route).reduce((sum, a) => sum + a.size, 0);
  assert.equal(sizes('cpu'), 136);
  assert.equal(sizes('webgpu'), 216);
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

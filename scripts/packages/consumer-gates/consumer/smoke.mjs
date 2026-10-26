// Runtime smoke over the installed tarballs (fm-7ge): blend from stylegan-js and the cache surface of
// browser-model-manager behave, not only load. One JSON line; exit 1 on a failed check.
import {
  blend,
  clampWeight,
  latentDigest,
  parseModelDescriptor,
  AFHQ_CAT_512_DESCRIPTOR,
} from 'stylegan-js';
import { createModelCache, createShardStore, Sha256 } from 'browser-model-manager';

const checks = {};
checks.clampWeight = clampWeight(5) === 2 && clampWeight(-5) === -2 && clampWeight(0.5) === 0.5;
const d = parseModelDescriptor(AFHQ_CAT_512_DESCRIPTOR);
const [layers, width] = [d.value.latent.layers, d.value.latent.width];
const latent = (v) => ({
  space: 'w-plus',
  shape: [layers, width],
  values: new Float32Array(layers * width).fill(v),
});
const r = blend(d.value, [latent(1), latent(3)], [0.5, 0.5]);
checks.blend = r.ok && r.value.latent.values.every((x) => x === 2);
checks.latentDigest =
  /^[0-9a-f]{64}$/.test(latentDigest(latent(1))) &&
  latentDigest(latent(1)) !== latentDigest(latent(2));
const h = new Sha256();
h.update(new TextEncoder().encode('abc'));
checks.sha256 = h.hex() === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const store = { get: async () => undefined, put: async () => {}, remove: async () => {} };
const cache = createModelCache({
  store,
  fetcher: async () => {
    throw new Error('no network in the smoke');
  },
});
checks.cacheLocal = cache.local.allowRepair === false && typeof cache.local.read === 'function';
checks.shardStore = typeof createShardStore === 'function';
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ event: 'consumer-smoke', ok, checks }));
if (!ok) process.exitCode = 1;

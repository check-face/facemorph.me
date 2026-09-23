import { collectAssets } from './browser/acquisition-budget.mjs';

export function routeAssets(manifest, route) {
  const bundle = route === 'webgpu' ? manifest.webgpu : route === 'webgl' ? manifest.webgl : manifest.synthesis;
  return unique(collectAssets([bundle, manifest.runtime, manifest.mapping, manifest.average, manifest.noise]));
}

export async function photoAssets(manifest, cache) {
  const base = collectAssets([manifest.landmarks, manifest.photoCanary, manifest.photoCanaries]);
  const descriptor = manifest.encoderStream;
  if (!descriptor) return { assets: unique([...base, ...collectAssets(manifest.encoder)]), estimated: false };
  const stored = await cache.peek(descriptor.sha256);
  if (!stored) return { assets: unique([...base, descriptor]), estimated: true, extraBytes: manifest.encoder?.size || 0 };
  try {
    const shards = collectAssets(JSON.parse(await stored.text()));
    return { assets: unique([...base, descriptor, ...shards]), estimated: false };
  } catch {
    return { assets: unique([...base, descriptor]), estimated: true, extraBytes: manifest.encoder?.size || 0 };
  }
}

export async function measure(assets, cache, extraBytes = 0) {
  let present = 0, total = extraBytes;
  for (const asset of assets) {
    total += asset.size;
    if (await cache.has(asset.sha256)) present += asset.size;
  }
  return { present, total, ready: assets.length > 0 && extraBytes === 0 && present === total };
}

function unique(assets) {
  const seen = new Set();
  return assets.filter(asset => !seen.has(asset.sha256) && seen.add(asset.sha256));
}

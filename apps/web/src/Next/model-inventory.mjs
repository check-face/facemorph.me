import { collectAssets } from './browser/acquisition-budget.mjs';

// On desktop the WebGPU route runs the direct engine, which reads the block-stream coefficients
// (manifest.webgl) rather than the ORT split graph; size what the device will actually download.
// The device correctness canaries and the sample indices are fetched before the first face too (fm-qrfz): they are
// part of what a face needs, so they are counted in the size the visitor is shown and covered by its approval.
export function routeAssets(manifest, route, engine = 'ort') {
  const bundle = route === 'webgpu' ? (engine === 'direct' ? manifest.webgl : manifest.webgpu) : route === 'webgl' ? manifest.webgl : manifest.synthesis;
  return unique(collectAssets([bundle, manifest.runtime, manifest.mapping, manifest.average, manifest.noise, manifest.canaries, manifest.sampleIndices]));
}

export async function photoAssets(manifest, cache) {
  const base = collectAssets([manifest.landmarks, manifest.photoCanary, manifest.photoCanaries]);
  const descriptor = manifest.encoderStream;
  if (!descriptor) return { assets: unique([...base, ...collectAssets(manifest.encoder)]), estimated: false };
  const stored = await cache.peek(descriptor);
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
    // Chunks an interrupted download already stored count as present (fm-9kr8): they are not fetched again.
    present += cache.heldBytes ? await cache.heldBytes(asset) : (await cache.has(asset)) ? asset.size : 0;
  }
  return { present, total, ready: assets.length > 0 && extraBytes === 0 && present === total };
}

function unique(assets) {
  const seen = new Set();
  return assets.filter(asset => !seen.has(asset.sha256) && seen.add(asset.sha256));
}

// Browser-only component driver. Every model/session/store/lease is the production implementation.
import * as engine from '/stylegan/engine/index.js';
import * as manager from '/manager/index.js';

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
let prepared;
const assetsOf = (value, out = []) => {
  if (!value || typeof value !== 'object') return out;
  if (typeof value.sha256 === 'string' && typeof value.url === 'string') {
    out.push(value);
    return out;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) assetsOf(item, out);
  return out;
};

export async function acquire(manifest, manifestSha256) {
  const shards = await manager.openShardStore();
  check(shards, 'native OPFS is required for the loaded-handle component');
  const cache = await manager.createBrowserModelCache({ shards });
  const assets = [
    ...new Map(
      assetsOf([
        manifest.runtime,
        manifest.mapping,
        manifest.average,
        manifest.noise,
        manifest.synthesis,
        manifest.sampleIndices,
        manifest.canaries[0],
      ]).map((asset) => [asset.sha256, asset]),
    ).values(),
  ];
  const bytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  const grant = {
    manifestSha256,
    route: 'cpu',
    purpose: 'generate',
    owners: ['face:loaded-browser'],
    assets: assets.map((asset) => ({
      sha256: asset.sha256,
      bytes: asset.size,
      priority: 'foreground-required',
    })),
    remainingBytes: bytes,
  };
  for (const asset of assets) await cache.acquire(asset, { grant, owner: 'face:loaded-browser' });
  check(
    manager.grantRemaining(grant) === 0,
    'real acquisition must spend exactly its authorized bytes',
  );
  prepared = { manifest, manifestSha256, cache, shards };
  return { assets: assets.length, bytes, remainingBytes: manager.grantRemaining(grant) };
}

export async function run() {
  const { manifest, manifestSha256, cache, shards } = prepared;
  check(cache.local.allowRepair === false, 'engine reader must be local-only');
  const original = await cache.local.read(manifest.mapping);
  check(original.ok, 'mapping must be verified before corruption/deletion fixtures');
  const threads = engine.cpuThreads({
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
  const runtime = await engine.loadOrtRuntime(
    cache.local,
    engine.cpuRuntimeAssets(manifest.runtime),
    engine.browserModuleHost(),
    threads,
  );
  const rows = [];
  let warm;
  const ids = (requestId) => ({ requestId, inputRevision: 1, attemptId: 0 });
  try {
    for (const cause of ['release', 'browser-eviction', 'corruption']) {
      const started = performance.now();
      const generator = await engine.loadCpuGenerator({
        reader: cache.local,
        manifest,
        manifestSha256,
        ort: async () => runtime.ort,
      });
      const loadMs = performance.now() - started;
      const registry = manager.createLeaseRegistry({ locks: navigator.locks });
      const handle = manager.createLoadedHandle({
        manifestSha256,
        capability: generator,
        assets: generator.assets,
        registry,
      });
      const invalidations = [];
      handle.onInvalidated((reason) => invalidations.push(reason));
      try {
        check(
          generator.provider.actual === 'cpu' && generator.engine === 'ort-wasm',
          'real CPU/WASM provider required',
        );
        const mapping = await handle.capability.map({
          ids: ids(`${cause}-map`),
          z: engine.inputLatent('seed', '7').z,
          truncation: { psi: 0.7, cutoff: 8 },
        });
        check(
          generator.inspect().liveSessions === 2,
          'real mapping and synthesis sessions must both be live',
        );
        check(registry.refCount(manifest.mapping.sha256) === 1, 'mapping lease must exist');
        const leased = await navigator.locks.request(
          manager.lockName(manifest.mapping.sha256),
          { mode: 'exclusive', ifAvailable: true },
          (lock) => lock !== null,
        );
        check(!leased, 'native shared lease must exclude an exclusive asset lock');
        if (cause === 'release') {
          // One product canary uses the unchanged maxRgb=1/maxFloat=.002 gates and independent pinned reference.
          const qualification = engine.createCanaryQualification({
            manifest: { ...manifest, canaries: [manifest.canaries[0]] },
            manifestSha256,
            route: 'cpu',
            bundle: manifest.synthesis,
            records: cache.records,
            reader: cache.local,
            synthesizeRaw: (values, noise) => generator.synthesizeRaw(values, noise),
            full: true,
          });
          const receipt = await qualification.admit();
          check(
            receipt.ran === 1 && receipt.checks[0].passed,
            'real product canary must pass its frozen gates',
          );
          const before = performance.now();
          const face = await handle.capability.synthesize({
            ids: ids('warm-face'),
            wPlus: mapping.wPlus,
            output: 'rgba',
          });
          check(
            face.rgba.length === 1024 * 1024 * 4,
            'real warm face must contain 1024x1024 RGBA pixels',
          );
          const milliseconds = performance.now() - before;
          const canvas = document.createElement('canvas');
          canvas.width = face.width;
          canvas.height = face.height;
          canvas
            .getContext('2d')
            .putImageData(new ImageData(face.rgba, face.width, face.height), 0, 0);
          document.body.append(canvas); // A native screenshot retains the actual generated pixels.
          warm = {
            milliseconds,
            rgbaBytes: face.rgba.length,
            digest: Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', face.rgba)),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join(''),
            canary: receipt.checks[0],
          };
        }
        let detected = null;
        if (cause !== 'release') {
          // This deliberately bypasses eviction's lease protection, as browser data loss/corruption does.
          if (cause === 'browser-eviction') await shards.remove(manifest.mapping.sha256);
          else {
            const corrupt = original.value.slice();
            corrupt[1000] ^= 0xff;
            await shards.write(manifest.mapping.sha256, corrupt);
          }
          const read = await cache.local.read(manifest.mapping);
          const expected = cause === 'browser-eviction' ? 'evicted' : 'corrupt';
          check(
            !read.ok && read.error.code === expected,
            `${cause}: actual local read must detect ${expected}`,
          );
          detected = read.error.code;
          check(
            registry.refCount(manifest.mapping.sha256) === 1,
            'loss must occur while the actual asset remains leased',
          );
        }
        const pending = handle.capability
          .synthesize({
            ids: ids(`${cause}-pending`),
            wPlus: mapping.wPlus,
            output: 'rgba',
          })
          .then(
            () => null,
            (error) => error,
          );
        const before = { handle: handle.inspect(), generator: generator.inspect() };
        check(
          before.handle.pending === 1 && before.generator.pending === 1,
          'real adapter and handle operation must be pending before invalidation',
        );
        const settlementStarted = performance.now();
        let release;
        if (cause === 'release') release = handle.release();
        else
          check(
            registry.invalidate(manifest.mapping.sha256, cause) === 1,
            'one real holder must be invalidated',
          );
        const error = await pending;
        const settledMs = performance.now() - settlementStarted;
        check(
          error instanceof manager.HandleUnavailable,
          `${cause}: pending operation must settle HandleUnavailable`,
        );
        check(
          error.error.code ===
            (cause === 'release' ? 'invalidated' : cause === 'corruption' ? 'corrupt' : 'evicted'),
          `${cause}: typed settlement differs`,
        );
        if (release) await release;
        await handle.release(); // Also waits for the invalidation's actual native session teardown.
        const after = {
          handle: handle.inspect(),
          generator: generator.inspect(),
          leases: registry.leased(),
        };
        check(
          after.generator.disposed &&
            after.generator.liveSessions === 0 &&
            after.generator.pending === 0,
          `${cause}: native sessions/pending operations leaked`,
        );
        check(
          after.handle.pending === 0 && after.leases.length === 0,
          `${cause}: handle/leases leaked`,
        );
        check(
          after.handle.state === (cause === 'release' ? 'released' : 'invalidated'),
          `${cause}: final handle state differs`,
        );
        check(
          invalidations.length === (cause === 'release' ? 0 : 1),
          `${cause}: invalidation notification count differs`,
        );
        // A real exclusive request must now acquire every previously shared native lease lock.
        for (const asset of generator.assets) {
          await navigator.locks.request(
            manager.lockName(asset.sha256),
            { mode: 'exclusive' },
            async () => {},
          );
        }
        const later = await handle.capability
          .map({
            ids: ids('after'),
            z: engine.inputLatent('seed', '7').z,
            truncation: { psi: 0.7, cutoff: 8 },
          })
          .then(
            () => null,
            (error) => error,
          );
        check(
          later instanceof manager.HandleUnavailable,
          `${cause}: disposed capability ran again`,
        );
        await handle.release(); // Idempotent after both explicit release and platform invalidation.
        rows.push({
          cause,
          loadMs,
          detected,
          before,
          error: error.error,
          settledMs,
          after,
          nativeLocksReleased: true,
        });
      } finally {
        await handle.release();
        await shards.write(manifest.mapping.sha256, original.value);
      }
    }
    return {
      threads,
      warm,
      rows,
      runtime: manifest.runtime.version,
      manifestSha256,
      canaryScope:
        'one pinned product canary; full seven-canary qualification belongs to engine matrix',
      disposalBoundary:
        'actual adapter promise pending; no claim that WASM kernel execution was interrupted',
    };
  } finally {
    runtime.release();
  }
}

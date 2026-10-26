// Installed tarballs only. This consumer exercises the acquisition-free public boundary;
// a caller-owned inert capability permits engine construction without loading any model.
import { createBrowserModelCache, MODEL_CACHE_NAME, storageStatus } from 'browser-model-manager';
import { capabilities, createEngine, rankedRoutes, supportedRoutes } from 'stylegan-js/engine';

export async function exerciseStatus(onPhase) {
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const operations = [];
  let cache,
    engine,
    disposed = 0,
    inferenceCalls = 0;
  const asset = {
    sha256: 'a'.repeat(64),
    size: 3,
    url: 'https://model-host.invalid/unapproved-model.onnx',
  };
  const inert = {
    identity: {
      modelSha256: asset.sha256,
      noiseSha256: 'b'.repeat(64),
      manifestSha256: 'c'.repeat(64),
    },
    latent: { zLength: 1, layers: 1, width: 1 },
    image: { width: 1, height: 1 },
    provider: { requested: 'cpu', actual: 'cpu', admission: 'pending', validation: 'unvalidated' },
    unsupported: [],
    map() {
      inferenceCalls++;
      throw Error('Construction/status must not execute mapping');
    },
    synthesize() {
      inferenceCalls++;
      throw Error('Construction/status must not execute synthesis');
    },
    async dispose() {
      disposed++;
    },
  };
  let result;
  try {
    await onPhase('construct');
    cache = await createBrowserModelCache({ readOnly: true, retryDelaysMs: [] });
    operations.push('manager.createBrowserModelCache');
    engine = createEngine({ generator: inert });
    operations.push('engine.createEngine');

    await onPhase('status');
    const present = await cache.has(asset);
    operations.push('manager.cache.has');
    check(
      present === false,
      'Fresh native browser cache unexpectedly contains the unapproved model',
    );
    const peek = await cache.peek(asset);
    operations.push('manager.cache.peek');
    check(peek === null, 'Status inspection unexpectedly produced model bytes');
    check(cache.local.allowRepair === false, 'Local read boundary permits repair');
    const local = await cache.local.read(asset);
    operations.push('manager.cache.local.read');
    check(
      local.ok === false && local.error.code === 'cache-miss',
      'Unapproved model must be a typed local cache miss',
    );
    const storage = await storageStatus({ requestPersistence: false });
    operations.push('manager.storageStatus');
    check(
      ['granted', 'not-granted', 'unavailable'].includes(storage.persistence),
      'Invalid native storage status',
    );
    const state = engine.state();
    operations.push('engine.state');
    check(
      !state.admitted && state.invalid === null && state.queued === 0 && state.running === false,
      'Engine construction started work or admitted an unloaded capability',
    );
    const trace = engine.trace();
    operations.push('engine.trace');
    check(trace.length === 0, 'Construction/status unexpectedly ran engine operations');
    await engine.qualified();
    operations.push('engine.qualified');
    const facts = capabilities({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      hardwareConcurrency: navigator.hardwareConcurrency,
      gpu: !!navigator.gpu,
    });
    const routes = rankedRoutes(facts, supportedRoutes(facts));
    operations.push('engine.capabilities', 'engine.supportedRoutes', 'engine.rankedRoutes');
    check(
      routes.includes('cpu') && routes.every((route) => ['cpu', 'webgpu'].includes(route)),
      'Engine route status omitted the retained CPU route',
    );
    result = {
      operations,
      cache: { present, peek: null, local: local.error },
      storage,
      engine: { state, trace, facts, routes },
    };
  } finally {
    await onPhase('cleanup');
    if (engine) {
      await engine.dispose();
      await engine.dispose();
      operations.push('engine.dispose');
    }
    if (cache) {
      await caches.delete(MODEL_CACHE_NAME);
      operations.push('manager.native-cache-cleanup');
    }
  }
  check(
    disposed === 1 && inferenceCalls === 0,
    'Engine did not dispose exactly once without executing inference',
  );
  return {
    ...result,
    cleanup: { callerCapabilityDisposals: disposed, nativeCacheRemoved: true },
    scope: {
      engineCapability: 'explicit inert caller-owned capability for constructor/state/dispose only',
      managerBackend: 'real browser Cache Storage and available read-only OPFS',
      grantApproved: false,
      modelLoaded: false,
      admissionAttempted: false,
      inferenceExecuted: false,
      storagePersistenceRequested: false,
    },
  };
}

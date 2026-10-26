// Real selected browser worker: pinned model acquisition and native ORT/WASM lifecycle execution.
// The page/controller must acknowledge acquisition before sending run, so runtime reads can be gated.
// The mobile/component HTTPS servers provide this endpoint from the shared
// package driver; it is a served module URL, not an app-root source file.
const driverUrl = '/manager-loaded-driver.mjs';
const driver = import(driverUrl);

let phase = 'new';
let backend;
let setup;
const message = (error) => (error instanceof Error ? error.stack || error.message : String(error));
const identity = () => ({
  backend,
  userAgent: navigator.userAgent,
  secureContext: self.isSecureContext,
});
const failure = async (error) => {
  if (phase === 'failed' || phase === 'complete') return;
  const failedPhase = phase;
  phase = 'failed';
  let cleanupError;
  try {
    await (await driver).cleanup();
  } catch (error) {
    cleanupError = message(error);
  }
  self.postMessage({
    type: 'error',
    ...identity(),
    phase: 'failed',
    failedPhase,
    error: message(error),
    cleanupError,
  });
};
self.addEventListener('unhandledrejection', (event) => {
  void failure(event.reason);
});
self.onmessage = async ({ data }) => {
  try {
    const { acquire, run, cleanup } = await driver;
    if (!self.isSecureContext)
      throw Error('loaded runtime worker requires a native secure context');
    if (data.type === 'acquire' || (!data.type && data.manifest)) {
      if (phase !== 'new') throw Error(`acquire is invalid in phase ${phase}`);
      backend = data.backend;
      if (!['opfs', 'cache-storage'].includes(backend)) throw Error('select opfs or cache-storage');
      phase = 'acquiring';
      setup = await acquire(data.manifest, data.manifestSha256, { backend });
      if (phase === 'failed') { await cleanup(); return; }
      phase = 'acquired';
      self.postMessage({ type: 'acquired', ...identity(), setup });
    } else if (data.type === 'run') {
      if (phase !== 'acquired') throw Error(`run is invalid in phase ${phase}`);
      phase = 'running';
      const result = await run();
      if (phase === 'failed') return;
      phase = 'complete';
      self.postMessage({ type: 'result', ...identity(), setup, result });
    } else throw Error('unknown loaded runtime worker command');
  } catch (error) {
    await failure(error);
  }
};

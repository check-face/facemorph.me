// The page the route-choice e2e drives: the real createBrowserRuntime and the real ort-worker, bundled by Vite.
// Nothing here replaces product behaviour. `failWebgpuCanary` sets the runtime's own test-only switch
// (__FACEMORPH_FORCE_CANARY_FAIL__, read by runtime.mjs at every worker initialize) while the webgpu route is
// being attempted, so the comparison fails on a real worker. `badWorkerStarts` makes the first N worker
// factory calls point at a URL that does not exist: a real worker start failure.
import { createBrowserRuntime } from '../../../src/Next/browser/runtime.mjs';

let runtime;
let events = [];
let workerStarts = 0;

const describeError = (error) => ({
  name: error?.name,
  code: error?.code,
  route: error?.route,
  message: error?.message,
  engineStopped: error?.engineStopped === true,
  failedOperation: error?.failedOperation,
  reasonKey: error?.reasonKey,
  helpAnchor: error?.helpAnchor,
});

async function canaryLatent() {
  const manifest = await (await fetch('/runtime/manifest.json')).json();
  const bytes = await (await fetch(manifest.canaries[0].w.url)).arrayBuffer();
  return { space: 'w-plus', shape: [1, 18, 512], values: new Float32Array(bytes) };
}

window.harness = {
  create({
    preferredRoute = 'auto',
    failWebgpuCanary = false,
    badWorkerStarts = 0,
    fullQualify,
  } = {}) {
    events = [];
    workerStarts = 0;
    if (fullQualify !== undefined) globalThis.__FACEMORPH_FULL_QUALIFY__ = fullQualify;
    runtime = createBrowserRuntime({
      preferredRoute,
      onProgress(detail) {
        events.push({
          stage: detail.stage,
          provider: detail.provider,
          outcome: detail.routeOutcome,
          gpu: detail.gpu,
          ...(detail.admission ? { admission: detail.admission } : {}),
        });
        if (failWebgpuCanary && detail.stage === 'route-attempt') {
          globalThis.__FACEMORPH_FORCE_CANARY_FAIL__ = detail.provider === 'webgpu';
        }
      },
      workerFactory() {
        workerStarts++;
        if (workerStarts <= badWorkerStarts) {
          return new Worker('/no-such-worker.js', { type: 'module' });
        }
        return new Worker(new URL('../../../src/Next/browser/ort-worker.mjs', import.meta.url), {
          type: 'module',
        });
      },
    });
  },
  setFallbackScope(scope) {
    runtime.setFallbackScope(scope);
  },
  /** One automatic or explicit intent: a raw synthesis of the first canary latent. */
  async synthesize() {
    try {
      const result = await runtime.synthesize(await canaryLatent(), { raw: true, persist: false });
      return { ok: true, rgbaBytes: result.rgba?.byteLength, status: runtime.status() };
    } catch (error) {
      return { ok: false, error: describeError(error), status: runtime.status() };
    }
  },
  async qualify(route) {
    try {
      const result = await runtime.qualify(route);
      return {
        ok: true,
        provider: result.provider,
        checks: result.checks,
        status: runtime.status(),
      };
    } catch (error) {
      return { ok: false, error: describeError(error), status: runtime.status() };
    }
  },
  async plan() {
    const plan = await runtime.plan();
    return { route: plan.route, engine: plan.engine };
  },
  /** Constructing or reconfiguring toward the removed route. */
  async removedRouteChecks() {
    const out = {};
    try {
      createBrowserRuntime({ preferredRoute: 'webgl', manifest: {}, manifestSha256: 'x' });
      out.construct = 'accepted';
    } catch (error) {
      out.construct = describeError(error);
    }
    const rt = createBrowserRuntime({ preferredRoute: 'auto' });
    try {
      rt.setPreferredRoute('webgl');
      out.setPreferredRoute = 'accepted';
    } catch (error) {
      out.setPreferredRoute = describeError(error);
    }
    try {
      await rt.qualify('webgl');
      out.qualify = 'accepted';
    } catch (error) {
      out.qualify = describeError(error);
    }
    rt.dispose();
    return out;
  },
  events: () => events,
  workerStarts: () => workerStarts,
  gpuOffer: async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { hasGpuObject: Boolean(navigator.gpu), adapter: Boolean(adapter) };
  },
  dispose() {
    runtime?.dispose();
  },
};
window.harnessReady = true;

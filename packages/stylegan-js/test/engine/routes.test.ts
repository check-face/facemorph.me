// Route and engine selection against the control (fm-3h3w "route selection unchanged versus the control"): the
// candidate's route-priors.mjs, route-selection.mjs and webgpu-direct.mjs (apps/web/src/Next/browser), with WebGL
// execution retired. The candidate's route-priors.test.mjs and the engine decisions mobile-runtime.test.mjs checks
// are restated here over plain capability values; the fused-resample and direct WGSL are compared character for
// character with the control and with the manifest's pinned kernel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { boundaryCode } from '../../src/engine/adapters/fused-resample.ts';
import * as shaders from '../../src/engine/adapters/direct-shaders.ts';
import {
  admissionCandidates,
  capabilities,
  cpuThreads,
  DIRECT_LIMITS,
  directSupported,
  failRoute,
  gpuEngine,
  isMobile,
  NO_FAILURES,
  ortWebGpuSupported,
  priorOrder,
  rankedRoutes,
  ROUTE_PRIORS,
  type RouteCapabilities,
} from '../../src/engine/routes.ts';
import type { ComputeRoute } from '../../src/contracts/capability.ts';
import { acquiredManifest, pathOf } from './support/runtime.ts';

const CONTROL = new URL('../../../../apps/web/src/Next/browser/', import.meta.url);
const priors = (await import(new URL('route-priors.mjs', CONTROL).href)) as {
  priorOrder(c: object, supported: string[]): string[];
  capabilities(scope: object): RouteCapabilities & { webgl: boolean };
};
const selection = (await import(new URL('route-selection.mjs', CONTROL).href)) as {
  rankedRoutes(c: object, supported: string[], measured?: object, failed?: Set<string>): string[];
};
const direct = (await import(new URL('webgpu-direct.mjs', CONTROL).href)) as {
  DIRECT_LIMITS: Record<string, number>;
  directSupported(l: object): boolean;
};
const fused = (await import(new URL('fused-resample-v1.mjs', CONTROL).href)) as {
  boundaryCode: typeof boundaryCode;
};

const AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0) Chrome/153',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) Chrome/152.0.0.0 Mobile',
  'Mozilla/5.0 (Linux; Android 10; VOG-L29) Chrome/141.0.0.0 Mobile',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
];
const without = (routes: string[]) => routes.filter((r) => r !== 'webgl');

test('for every browser, GPU state and failure set the order is the control order without WebGL', () => {
  let cases = 0;
  for (const userAgent of AGENTS)
    for (const platform of ['Linux x86_64', 'MacIntel'])
      for (const maxTouchPoints of [0, 5])
        for (const gpu of [false, true]) {
          const facts = { userAgent, platform, maxTouchPoints, hardwareConcurrency: 8, gpu };
          const ours = capabilities(facts);
          const scope = {
            navigator: {
              userAgent,
              platform,
              maxTouchPoints,
              hardwareConcurrency: 8,
              ...(gpu ? { gpu: {} } : {}),
            },
            OffscreenCanvas: class {},
          };
          const theirs = priors.capabilities(scope);
          assert.deepEqual(
            { ...ours },
            {
              webgpu: theirs.webgpu,
              android: theirs.android,
              ios: theirs.ios,
              mobile: theirs.mobile,
              cores: theirs.cores,
            },
          );
          for (const supported of [
            ['cpu'],
            ['cpu', 'webgpu'],
            ['webgpu', 'cpu'],
          ] as ComputeRoute[][]) {
            const controlSupported = [...supported, 'webgl'];
            assert.deepEqual(
              priorOrder(ours, supported),
              without(priors.priorOrder(theirs, controlSupported)),
            );
            for (const failed of [[], ['webgpu'], ['cpu'], ['cpu', 'webgpu']] as ComputeRoute[][]) {
              assert.deepEqual(
                rankedRoutes(ours, supported, new Set(failed)),
                without(
                  selection.rankedRoutes(
                    theirs,
                    controlSupported,
                    { webgpu: 99999, cpu: 1 },
                    new Set(failed),
                  ),
                ),
              );
              cases++;
            }
          }
        }
  assert.ok(cases > 400);
});

test('measured priors order ascending by recorded cost; unmeasured ones say why (route-priors.test.mjs)', () => {
  let measured = 0;
  for (const entry of ROUTE_PRIORS) {
    if (!entry.measured) {
      assert.match(entry.because, /not measured|unmeasured|no WebGPU adapter/i);
      continue;
    }
    measured++;
    for (let i = 1; i < entry.order.length; i++) {
      const a: number | undefined = entry.measured[entry.order[i - 1] as ComputeRoute];
      const b: number | undefined = entry.measured[entry.order[i] as ComputeRoute];
      if (a !== undefined && b !== undefined) assert.ok(a <= b, entry.order.join('>'));
    }
  }
  assert.ok(measured >= 2);
});

test('slow timings never demote a working route; only failure filters it', () => {
  const phone = capabilities({ userAgent: AGENTS[3] as string, gpu: true });
  assert.deepEqual(rankedRoutes(phone, ['webgpu', 'cpu']), ['webgpu', 'cpu']);
  assert.deepEqual(rankedRoutes(phone, ['webgpu', 'cpu'], new Set(['webgpu'])), ['cpu']);
  const desktop = capabilities({ userAgent: AGENTS[0] as string, gpu: false });
  assert.deepEqual(priorOrder(desktop, ['cpu']), ['cpu']);
});

test('the direct engine: desktop only, adapter limits, and a direct failure retries WebGPU on ORT (mobile-runtime.test.mjs)', () => {
  assert.deepEqual({ ...DIRECT_LIMITS }, direct.DIRECT_LIMITS);
  const big = {
    maxStorageBufferBindingSize: 2 ** 31,
    maxBufferSize: 2 ** 31,
    maxComputeWorkgroupStorageSize: 49152,
    maxComputeInvocationsPerWorkgroup: 1024,
    maxComputeWorkgroupSizeX: 1024,
    maxComputeWorkgroupSizeY: 1024,
    maxStorageBuffersPerShaderStage: 10,
  };
  const small = { ...big, maxStorageBufferBindingSize: 134217728 };
  for (const limits of [big, small, {}, { ...big, maxStorageBuffersPerShaderStage: 6 }])
    assert.equal(directSupported(limits), direct.directSupported(limits));
  const facts = { mobile: false, directFailed: false, hasDirectBundle: true, limits: big };
  assert.equal(gpuEngine('webgpu', facts), 'direct');
  assert.equal(gpuEngine('cpu', facts), 'ort');
  assert.equal(
    gpuEngine('webgpu', { ...facts, mobile: true }),
    'ort',
    'custom WGSL never reaches a phone GPU',
  );
  assert.equal(gpuEngine('webgpu', { ...facts, limits: small }), 'ort');
  assert.equal(gpuEngine('webgpu', { ...facts, hasDirectBundle: false }), 'ort');
  assert.equal(gpuEngine('webgpu', { ...facts, directFailed: true }), 'ort');
  for (const ua of AGENTS.slice(3)) assert.ok(isMobile({ userAgent: ua }), ua);
  assert.ok(
    isMobile({ userAgent: AGENTS[2] as string, platform: 'MacIntel', maxTouchPoints: 5 }),
    'iPadOS desktop mode',
  );
  assert.ok(isMobile({ userAgent: AGENTS[0] as string, userAgentDataMobile: true }));
  assert.ok(!isMobile({ userAgent: AGENTS[0] as string }));
  // A failed direct engine costs the engine once; the next failure costs the route.
  const once = failRoute(NO_FAILURES, 'webgpu', 'direct');
  assert.deepEqual([once.directFailed, [...once.failed]], [true, []]);
  assert.equal(gpuEngine('webgpu', { ...facts, directFailed: once.directFailed }), 'ort');
  const twice = failRoute(once, 'webgpu', 'ort');
  assert.deepEqual([...twice.failed], ['webgpu']);
});

test('the ORT WebGPU split needs exactly 128 MiB buffers and bindings, checked separately', () => {
  const MiB = 1024 * 1024;
  assert.ok(
    ortWebGpuSupported({ maxStorageBufferBindingSize: 128 * MiB, maxBufferSize: 128 * MiB }),
  );
  assert.ok(
    !ortWebGpuSupported({ maxStorageBufferBindingSize: 128 * MiB - 1, maxBufferSize: 256 * MiB }),
  );
  assert.ok(
    !ortWebGpuSupported({ maxStorageBufferBindingSize: 256 * MiB, maxBufferSize: 64 * MiB }),
  );
  assert.ok(!ortWebGpuSupported(null));
});

test('admission candidates: explicit routes alone; an exhausted auto session clears once (runtime.mjs admit)', () => {
  const gpu = capabilities({ userAgent: AGENTS[0] as string, gpu: true });
  assert.deepEqual(admissionCandidates('auto', gpu, NO_FAILURES).candidates, ['webgpu', 'cpu']);
  assert.deepEqual(
    admissionCandidates('webgpu', gpu, failRoute(NO_FAILURES, 'webgpu', 'ort')).candidates,
    ['webgpu'],
  );
  const dead = { failed: new Set<ComputeRoute>(['webgpu', 'cpu']), directFailed: true };
  const retry = admissionCandidates('auto', gpu, dead);
  assert.equal(retry.retried, true);
  assert.deepEqual(retry.candidates, ['webgpu', 'cpu']);
  assert.equal(retry.state.directFailed, true, 'the slate clears routes, not the engine verdict');
});

test('CPU threads are bounded to 1-4 and need isolation (ort-worker.mjs cpuThreads)', () => {
  const t = (
    sharedArrayBuffer: boolean,
    crossOriginIsolated: boolean,
    hardwareConcurrency: number | undefined,
  ) => cpuThreads({ sharedArrayBuffer, crossOriginIsolated, hardwareConcurrency });
  assert.equal(t(false, true, 16), 1);
  assert.equal(t(true, false, 16), 1);
  assert.equal(t(true, true, undefined), 1);
  assert.equal(t(true, true, 1), 1);
  assert.equal(t(true, true, 2), 1);
  assert.equal(t(true, true, 4), 3);
  assert.equal(t(true, true, 5), 4);
  assert.equal(t(true, true, 32), 4);
});

test('the fused-resample WGSL is the control kernel and the manifest kernel, character for character', async (t) => {
  for (const tail of [false, true])
    for (const variant of ['bounded', 'unrolled'] as const)
      for (const workgroup of [64, 256]) {
        const m = { strength: 0.0123, gain: 1.4142135623730951 };
        const code = boundaryCode(m, tail, variant, workgroup);
        assert.equal(code, fused.boundaryCode(m, tail, variant, workgroup));
        assert.ok(!code.includes('continue') && code.includes('select(0.0,sample,valid)'));
      }
  assert.throws(() => boundaryCode({ strength: 0, gain: 1 }, false, 'signed' as 'bounded', 256));
  assert.throws(() => boundaryCode({ strength: 0, gain: 1 }, false, 'bounded', 128));
  const runtime = acquiredManifest();
  if (!runtime)
    return t.skip('the manifest kernel comparison is untested: the runtime is not acquired here');
  const kernel = (runtime.manifest['webgpu'] as { kernel: { url: string } }).kernel;
  const pinned = (await import(pathToFileURL(pathOf(kernel)).href)) as {
    boundaryCode: typeof boundaryCode;
  };
  assert.equal(
    boundaryCode({ strength: 0.5, gain: 2 }, true),
    pinned.boundaryCode({ strength: 0.5, gain: 2 }, true),
  );
});

test('the direct engine WGSL appears verbatim in the control engine', () => {
  const source = readFileSync(new URL('webgpu-direct.mjs', CONTROL), 'utf8');
  for (const name of ['FIR', 'RGB', 'AFFINE', 'DEMOD', 'OUT', 'RGBA8'] as const)
    assert.ok(source.includes('`' + shaders[name] + '`'), name);
  // The GEMM generator: every tile and tap set the engine uses, against the control's own generator text.
  const gemm = source.slice(source.indexOf('function gemmShader'), source.indexOf('// 4x4 FIR'));
  const controlGemm = new Function(
    'return ' + gemm.replace(/^function gemmShader/, 'function'),
  )() as typeof shaders.gemmShader;
  for (const co of [16, 32, 64, 512])
    for (const [taps, act, nx, centre] of [
      [shaders.TAPS3, true, 3, 1],
      [shaders.parityTaps(0, 0), false, 2, 0],
      [shaders.parityTaps(1, 1), false, 1, 0],
    ] as const)
      assert.equal(
        shaders.gemmShader(shaders.TILES(co), taps, act, nx, centre),
        controlGemm(shaders.TILES(co), taps, act, nx, centre),
      );
});

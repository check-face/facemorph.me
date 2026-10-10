/**
 * What to try first on a device this one has never measured.
 *
 * The ordering is not a guess about which hardware "should" be faster. Every entry below is a
 * number someone recorded on a real machine, and the one that matters most is the reversal: on a
 * Galaxy S24 Ultra the WebGL path cost about twice what the CPU path cost, so preferring a GPU
 * route because one exists put that phone on the slower of its two options.
 *
 * Measured, per face:
 *
 *   Galaxy S24 Ultra   WebGPU (ORT Web, bounded padding)   618 ms single, 686 ms in sequence
 *                      CPU, four threads        2,582 ms
 *                      CPU, one thread          5,911 ms
 *                      WebGL                   ~13,000 ms   (operator reports, deployed build)
 *   Mac (Chromium)     WebGPU                     294-327 ms
 *                      CPU, four threads       ~11,000 ms   (22.9 s for two faces)
 *   Windows (desktop GPU) WebGPU                   60-70 ms    (operator reports, earlier tests)
 *
 * The fast route is onnxruntime-web's WebGPU execution provider, not a bespoke WGSL runtime; the
 * direct-WGSL proposal remains unimplemented. iPhone Simulator figures exclude WebGPU entirely,
 * because that Simulator exposes no adapter, so they cannot be used to rank it against anything.
 *
 * Sources: autoresearch/results.tsv, phone_gpu_success_2026-09-14.md, s24_ultra_findings_2026-09-14.md,
 * and opted-in reports from the deployed site.
 *
 * Operator, 10 October: fixed WebGPU -> CPU -> WebGL preference on all platforms.
 * Timings are recorded for estimates/diagnostics; only route unavailability or failure
 * causes automatic fallback. Historical measurement-driven ranking is superseded.
 *
 * Historical measured tables provide context only; new timing results do not change this
 * preference without a new operator decision.
 */

export const ROUTE_PRIORS = Object.freeze([
  {
    // WebGPU has been the fastest route on every device where it was actually measured, by a
    // margin no other ordering question comes close to. It is tried first wherever it is offered,
    // including on iOS: its larger working set is acceptable while the run stays stable, and an
    // unstable one fails admission rather than being pre-emptively avoided.
    when: capabilities => capabilities.webgpu,
    order: ['webgpu', 'cpu', 'webgl'],
    measured: {webgpu: 618, cpu: 2582, webgl: 13000},
    because: 'WebGPU measured 618 ms on a phone and 294 ms on a Mac; nothing else is close'
  },
  {
    // Android without WebGPU: CPU beat WebGL by roughly two to one on the S24. This is the
    // reversal that the old "a GPU route exists, so use it" rule got wrong. Scoped to Android,
    // because it is an Android measurement.
    when: capabilities => capabilities.android,
    order: ['cpu', 'webgl'],
    measured: {cpu: 5911, webgl: 13000},
    because: 'S24 Ultra: CPU 5,911 ms against WebGL about 13,000 ms per face'
  },
  {
    // Operator, 10 October: the same failure-only preference applies on iOS.
    // Historical memory-driven WebGL preference is superseded; availability and actual
    // failed admission still select a supported fallback.
    when: capabilities => capabilities.ios,
    order: ['cpu', 'webgl'],
    because: 'iOS CPU/WebGL speed is not measured here; operator fixed CPU before WebGL on 10 October'
  },
  {
    // Desktop without a usable WebGPU adapter. Desktop WebGL against desktop CPU is not measured,
    // but no measurement anywhere puts WebGL ahead of CPU: S24 Ultra WebGL ~13,000 ms against CPU
    // 2,582-5,911 ms, and the iOS Simulator's pure WebGL ran about three times slower than
    // four-thread CPU. Operator ruling, 8 October 2026: keep WebGPU -> CPU -> WebGL until an explicit operator decision changes it. Diagnostics caught a 32-core Linux desktop on WebGL at 7.4 s per face
    // because this entry used to put WebGL first. Device timings are observational only.
    when: () => true,
    order: ['cpu', 'webgl'],
    because: 'Desktop WebGL against desktop CPU is not measured; nothing recorded favours WebGL, so CPU first (operator ruling WebGPU -> CPU -> WebGL)'
  }
]);

/** Cheap, allocation-free reading of what this browser offers. No model or context is created. */
export function capabilities(scope = globalThis) {
  const agent = scope.navigator?.userAgent || '';
  return {
    webgpu: Boolean(scope.navigator?.gpu),
    webgl: typeof scope.OffscreenCanvas !== 'undefined',
    android: /Android/i.test(agent),
    ios: /iPhone|iPad|iPod/i.test(agent)||(scope.navigator?.platform==='MacIntel'&&scope.navigator?.maxTouchPoints>1),
    mobile: /Android|iPhone|iPad|iPod/i.test(agent),
    cores: Number(scope.navigator?.hardwareConcurrency) || 0
  };
}

/**
 * Routes to try in the fixed operator preference order.
 * `supported` filters the order down to what this build can actually run.
 */
export function priorOrder(capability, supported) {
  const rule = ROUTE_PRIORS.find(entry => entry.when(capability)) || ROUTE_PRIORS.at(-1);
  const ordered = rule.order.filter(route => supported.includes(route));
  // Anything supported but unranked still belongs at the end; never silently drop a usable route.
  return [...ordered, ...supported.filter(route => !ordered.includes(route))];
}

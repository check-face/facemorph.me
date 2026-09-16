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
 *   Galaxy S24 Ultra   WebGPU (bounded padding)   618 ms single, 686 ms in sequence
 *                      CPU, four threads        2,582 ms
 *                      CPU, one thread          5,911 ms
 *                      WebGL                   ~13,000 ms   (operator reports, deployed build)
 *   Mac (Chromium)     WebGPU                     294-327 ms
 *                      CPU, four threads       ~11,000 ms   (22.9 s for two faces)
 *
 * Sources: autoresearch/results.tsv, phone_gpu_success_2026-09-14.md, s24_ultra_findings_2026-09-14.md,
 * and opted-in reports from the deployed site.
 *
 * A prior only decides what to try first. An admission timing measured on this device replaces it,
 * because the device in front of us outranks anything recorded on another one.
 */

export const ROUTE_PRIORS = Object.freeze([
  {
    // WebGPU has been the fastest route on every device where it was actually measured, by a
    // margin no other ordering question comes close to. It is tried first wherever it is offered.
    when: capabilities => capabilities.webgpu,
    order: ['webgpu', 'cpu', 'webgl'],
    because: 'WebGPU measured 618 ms on a phone and 294 ms on a Mac; nothing else is close'
  },
  {
    // Without WebGPU on a phone, CPU beat WebGL by roughly two to one on the S24. This is the
    // reversal that the old "a GPU route exists, so use it" rule got wrong.
    when: capabilities => capabilities.mobile,
    order: ['cpu', 'webgl'],
    because: 'S24 Ultra: CPU 5,911 ms against WebGL about 13,000 ms per face'
  },
  {
    // On desktop without WebGPU neither order has been measured, so try the GPU path first and let
    // the device's own timings settle it. Stated as unmeasured rather than dressed up as a finding.
    when: () => true,
    order: ['webgl', 'cpu'],
    because: 'Desktop WebGL against desktop CPU is not measured; the device decides'
  }
]);

/** Cheap, allocation-free reading of what this browser offers. No model or context is created. */
export function capabilities(scope = globalThis) {
  const agent = scope.navigator?.userAgent || '';
  return {
    webgpu: Boolean(scope.navigator?.gpu),
    webgl: typeof scope.OffscreenCanvas !== 'undefined',
    mobile: /Android|iPhone|iPad|iPod/i.test(agent),
    cores: Number(scope.navigator?.hardwareConcurrency) || 0
  };
}

/**
 * Routes to try, best first, for a device with no measurements of its own.
 * `supported` filters the order down to what this build can actually run.
 */
export function priorOrder(capability, supported) {
  const rule = ROUTE_PRIORS.find(entry => entry.when(capability)) || ROUTE_PRIORS.at(-1);
  const ordered = rule.order.filter(route => supported.includes(route));
  // Anything supported but unranked still belongs at the end; never silently drop a usable route.
  return [...ordered, ...supported.filter(route => !ordered.includes(route))];
}

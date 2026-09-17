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
 *
 * The fast route is onnxruntime-web's WebGPU execution provider, not a bespoke WGSL runtime; the
 * direct-WGSL proposal remains unimplemented. iPhone Simulator figures exclude WebGPU entirely,
 * because that Simulator exposes no adapter, so they cannot be used to rank it against anything.
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
    // margin no other ordering question comes close to. It is tried first wherever it is offered,
    // including on iOS: its larger working set is acceptable while the run stays stable, and an
    // unstable one fails admission rather than being pre-emptively avoided.
    when: capabilities => capabilities.webgpu,
    order: ['webgpu', 'cpu', 'webgl'],
    because: 'WebGPU measured 618 ms on a phone and 294 ms on a Mac; nothing else is close'
  },
  {
    // Android without WebGPU: CPU beat WebGL by roughly two to one on the S24. This is the
    // reversal that the old "a GPU route exists, so use it" rule got wrong. Scoped to Android,
    // because it is an Android measurement.
    when: capabilities => capabilities.android,
    order: ['cpu', 'webgl'],
    because: 'S24 Ultra: CPU 5,911 ms against WebGL about 13,000 ms per face'
  },
  {
    // iOS without WebGPU keeps the GPU path first, and not for speed. WebGL was adopted there to
    // remove the large ORT/WASM synthesis heap on a device that may not have room for it, and no
    // iPhone measurement shows CPU beating it. The Android ordering must not be borrowed here: it
    // would trade a memory-driven choice for another platform's timings.
    //
    // Operator direction, 17 September: a large working set is wanted when it buys speed, so long
    // as the run stays stable and below the point where the tab is reclaimed. Memory is therefore
    // not a reason to pass over a faster route — only an observed reset or failure is, and that
    // arrives as a refused admission which already removes the route from contention.
    //
    // Every iPhone figure on record is from the Simulator, which returns no WebGPU adapter at
    // all, so those runs cannot speak to the fast path and must not be read as if they rank it.
    // Safari 26 ships WebGPU on iOS, so a current iPhone should match the rule above instead of
    // this one, and its own timings replace this starting point either way.
    when: capabilities => capabilities.ios,
    order: ['webgl', 'cpu'],
    because: 'iOS WebGL avoids the large WASM heap; Simulator runs have no WebGPU adapter to compare'
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
    android: /Android/i.test(agent),
    ios: /iPhone|iPad|iPod/i.test(agent)||(scope.navigator?.platform==='MacIntel'&&scope.navigator?.maxTouchPoints>1),
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

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
 * Operator, 10 October: fixed WebGPU -> CPU -> WebGL preference on all platforms; WebGL execution removed
 * 17 October (fm-x6h5), so the order is WebGPU -> CPU. The WebGL figures below stay as history.
 * Timings are recorded for estimates/diagnostics; only route unavailability or failure
 * causes automatic fallback. Historical measurement-driven ranking is superseded.
 *
 * Historical measured tables provide context only; new timing results do not change this
 * preference without a new operator decision.
 */

// The priors and their order are stylegan-js engine/routes.ts (fm-7f2o), the candidate's without the retired WebGL
// route; this module keeps the names and the globalThis-reading capabilities() its callers use.
import {ROUTE_PRIORS,priorOrder,capabilities as fromFacts} from 'stylegan-js/engine';
export {ROUTE_PRIORS,priorOrder};

/** Cheap, allocation-free reading of what this browser offers. No model or context is created. */
export function capabilities(scope = globalThis) {
  const n = scope.navigator;
  return fromFacts({
    userAgent: n?.userAgent || '',
    platform: n?.platform,
    maxTouchPoints: n?.maxTouchPoints,
    hardwareConcurrency: n?.hardwareConcurrency,
    gpu: Boolean(n?.gpu),
  });
}

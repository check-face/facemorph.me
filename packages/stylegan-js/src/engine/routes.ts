// Route and engine selection (fm-3h3w), ported from the candidate's browser/route-priors.mjs,
// route-selection.mjs and the decisions inside runtime.mjs (gpuEngine, failRoute, admit) and
// ort-worker.mjs (cpuThreads), classic a42829b. Everything here is pure: it reads plain capability
// values, never a navigator, so it is tested by calling it.
//
// The retained routes are CPU (ORT WASM) and WebGPU, run by one of two engines: the direct WGSL engine
// on desktop GPUs that clear its limits, and ORT's WebGPU execution provider everywhere else, phones
// included. WebGL execution is retired (its block-stream coefficients, manifest.webgl, stay: the direct
// engine runs them). The preference is the operator's fixed one (10 October 2026): WebGPU, then CPU.
// Timings are observations; only unavailability, a failed admission or a failed inference moves a
// device off a route, and a failed direct engine costs the engine, not the route.

import type { ComputeRoute, RequestedRoute } from '../contracts/capability.ts';

/** What a browser offers, read once from plain values (route-priors.mjs capabilities()). */
export interface RouteCapabilities {
  /** navigator.gpu exists and (once probed) yields an adapter, and the manifest has a WebGPU bundle. */
  readonly webgpu: boolean;
  readonly android: boolean;
  readonly ios: boolean;
  readonly mobile: boolean;
  readonly cores: number;
  /** The probed WebGPU adapter's vendor and architecture (GPUAdapterInfo), once known. */
  readonly gpuVendor?: string;
  readonly gpuArchitecture?: string;
}

/** The navigator fields the capability read uses. */
export interface NavigatorFacts {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly hardwareConcurrency?: number;
  readonly userAgentDataMobile?: boolean;
  readonly gpu?: boolean;
}

const IOS = /iPhone|iPad|iPod/i;
const iPadDesktopMode = (n: NavigatorFacts) =>
  n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1;

/** runtime.mjs's mobile test (gpuEngine, holdEncoder, photoAvailable): UA-CH, then the UA, then iPadOS. */
export function isMobile(n: NavigatorFacts): boolean {
  return (
    n.userAgentDataMobile === true ||
    /Android|iPhone|iPad|iPod/.test(n.userAgent ?? '') ||
    iPadDesktopMode(n)
  );
}

export function capabilities(n: NavigatorFacts): RouteCapabilities {
  const agent = n.userAgent ?? '';
  return {
    webgpu: n.gpu === true,
    android: /Android/i.test(agent),
    ios: IOS.test(agent) || iPadDesktopMode(n),
    mobile: /Android|iPhone|iPad|iPod/i.test(agent),
    cores: Number(n.hardwareConcurrency) || 0,
  };
}

export interface RoutePrior {
  readonly when: (c: RouteCapabilities) => boolean;
  readonly order: readonly ComputeRoute[];
  /** Per-face milliseconds someone recorded on a real device, where there is a measurement. */
  readonly measured?: Readonly<Partial<Record<ComputeRoute, number>>>;
  readonly because: string;
}

/**
 * The candidate's priors without the retired WebGL route. The measurements (route-priors.mjs): Galaxy
 * S24 Ultra WebGPU 618 ms single / 686 ms in sequence, CPU four threads 2,582 ms, one thread 5,911 ms;
 * Mac Chromium WebGPU 294-327 ms against CPU about 11,000 ms; Windows desktop GPU 60-70 ms.
 */
export const ROUTE_PRIORS: readonly RoutePrior[] = Object.freeze([
  {
    // fm-ve6a: the one Mali measured (Huawei P30 Pro, Mali-G76, adapter vendor `arm`, architecture `bifrost`) is
    // faster on its CPU. Only that architecture: newer Valhall/5th-gen Malis, Adreno (the Galaxy S24 Ultra),
    // iPhones and unnamed GPUs keep WebGPU first until measured.
    when: (c: RouteCapabilities) =>
      c.webgpu && c.android && c.gpuVendor === 'arm' && c.gpuArchitecture === 'bifrost',
    order: ['cpu', 'webgpu'],
    measured: { cpu: 16000, webgpu: 22000 },
    because:
      'On a Mali-G76 (Bifrost) phone the CPU route measured 16 s per warm face against 22 s on WebGPU',
  },
  {
    when: (c: RouteCapabilities) => c.webgpu,
    order: ['webgpu', 'cpu'],
    measured: { webgpu: 618, cpu: 2582 },
    because: 'WebGPU measured 618 ms on a phone and 294 ms on a Mac; nothing else is close',
  },
  {
    when: (c: RouteCapabilities) => c.android,
    order: ['cpu'],
    measured: { cpu: 5911 },
    because: 'Android without a WebGPU adapter: the CPU route is the only retained one',
  },
  {
    when: (c: RouteCapabilities) => c.ios,
    order: ['cpu'],
    because:
      'iOS without a WebGPU adapter is not measured here; the CPU route is the only retained one',
  },
  {
    when: () => true,
    order: ['cpu'],
    because:
      'Desktop with no WebGPU adapter is not measured against anything; CPU is the only retained route',
  },
] satisfies RoutePrior[]);

/** Routes in the fixed preference order, filtered to `supported`; unranked supported routes come last. */
export function priorOrder(
  c: RouteCapabilities,
  supported: readonly ComputeRoute[],
): ComputeRoute[] {
  const rule = ROUTE_PRIORS.find((entry) => entry.when(c)) ?? (ROUTE_PRIORS.at(-1) as RoutePrior);
  const ordered = rule.order.filter((route) => supported.includes(route));
  return [...ordered, ...supported.filter((route) => !ordered.includes(route))];
}

/** route-selection.mjs rankedRoutes(): timings never reorder; only a failure filters a route out. */
export function rankedRoutes(
  c: RouteCapabilities,
  supported: readonly ComputeRoute[],
  failed: ReadonlySet<ComputeRoute> = new Set(),
): ComputeRoute[] {
  return priorOrder(c, supported).filter((route) => !failed.has(route));
}

/** The retained routes a browser can be offered: CPU always, WebGPU where capabilities allow it. */
export function supportedRoutes(c: RouteCapabilities): ComputeRoute[] {
  return c.webgpu ? ['cpu', 'webgpu'] : ['cpu'];
}

/** GPU limits the engines check, as GPUSupportedLimits reports them. */
export type GpuLimits = Readonly<Record<string, number | undefined>>;

/**
 * The direct engine's needs (webgpu-direct.mjs DIRECT_LIMITS): its largest binding is the 1025^2 x 32
 * float phase grid (134,480,000 bytes, above the 128 MiB a phone often reports) and its narrow-channel
 * tile needs 18 KiB of workgroup memory.
 */
export const DIRECT_LIMITS = Object.freeze({
  maxStorageBufferBindingSize: 1025 * 1025 * 32 * 4,
  maxBufferSize: 1025 * 1025 * 32 * 4,
  maxComputeWorkgroupStorageSize: 18432,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 16,
  maxComputeWorkgroupSizeY: 16,
  maxStorageBuffersPerShaderStage: 7,
});

export function directSupported(limits: GpuLimits | undefined | null): boolean {
  return (
    Boolean(limits) &&
    Object.entries(DIRECT_LIMITS).every(([k, v]) => ((limits as GpuLimits)[k] ?? 0) >= v)
  );
}

/**
 * The ORT WebGPU engine's bounded mobile split needs exactly 128 MiB buffers and storage bindings
 * (webgpu-engine.mjs): 32 * 1024 * 1024 float32s, not the untiled graph's 134,742,528-byte binding.
 */
export const ORT_WEBGPU_REQUIRED_BYTES = 134217728;
export function ortWebGpuSupported(limits: GpuLimits | undefined | null): boolean {
  return (
    Boolean(limits) &&
    ((limits as GpuLimits)['maxStorageBufferBindingSize'] ?? 0) >= ORT_WEBGPU_REQUIRED_BYTES &&
    ((limits as GpuLimits)['maxBufferSize'] ?? 0) >= ORT_WEBGPU_REQUIRED_BYTES
  );
}

export type GpuEngine = 'direct' | 'ort';

/**
 * Which engine runs a route (runtime.mjs gpuEngine()). The direct engine is about 1.7x faster on desktop
 * GPUs but tuned for them, with no phone evidence, so it is offered only to a non-mobile device whose
 * adapter clears its limits and whose manifest carries the block-stream coefficients; a direct failure
 * moves the next attempt to the ORT engine on the same route. Custom WGSL kernels never reach a phone GPU.
 */
export function gpuEngine(
  route: ComputeRoute,
  facts: {
    readonly mobile: boolean;
    readonly directFailed: boolean;
    readonly hasDirectBundle: boolean;
    readonly limits: GpuLimits | undefined | null;
  },
): GpuEngine {
  return route === 'webgpu' &&
    !facts.directFailed &&
    !facts.mobile &&
    facts.hasDirectBundle &&
    directSupported(facts.limits)
    ? 'direct'
    : 'ort';
}

/**
 * CPU threads (ort-worker.mjs cpuThreads()): the threaded build needs SharedArrayBuffer and cross-origin
 * isolation; then cores - 1, bounded to 1-4, because threads add stacks and scheduling pressure on the
 * small devices the CPU route exists for and the gain flattens quickly.
 */
export function cpuThreads(facts: {
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number | undefined;
}): number {
  if (!facts.sharedArrayBuffer || !facts.crossOriginIsolated) return 1;
  const cores = Number(facts.hardwareConcurrency);
  if (!Number.isFinite(cores) || cores < 2) return 1;
  return Math.max(1, Math.min(4, Math.floor(cores) - 1));
}

/** Failure memory for one page: routes that failed an attempt, and whether the direct engine has. */
export interface RouteFailures {
  readonly failed: ReadonlySet<ComputeRoute>;
  readonly directFailed: boolean;
}
export const NO_FAILURES: RouteFailures = Object.freeze({
  failed: new Set<ComputeRoute>(),
  directFailed: false,
});

/** runtime.mjs failRoute(): a failed direct engine costs the engine once, then the route. */
export function failRoute(
  state: RouteFailures,
  route: ComputeRoute,
  engine: GpuEngine,
): RouteFailures {
  if (route === 'webgpu' && engine === 'direct' && !state.directFailed)
    return { failed: state.failed, directFailed: true };
  return { failed: new Set([...state.failed, route]), directFailed: state.directFailed };
}

/**
 * The routes an admission tries, in order (runtime.mjs admit()). An explicit selection is tried alone and
 * never silently substituted. In auto mode, when every supported route has failed once, the slate is
 * cleared once and the priors decide again (`retried`): a failure is evidence about an attempt, not a
 * permanent verdict.
 */
export function admissionCandidates(
  requested: RequestedRoute,
  c: RouteCapabilities,
  state: RouteFailures,
): {
  readonly candidates: ComputeRoute[];
  readonly state: RouteFailures;
  readonly retried: boolean;
} {
  if (requested !== 'auto') return { candidates: [requested], state, retried: false };
  const supported = supportedRoutes(c);
  const ordered = rankedRoutes(c, supported, state.failed);
  if (ordered.length || !supported.length) return { candidates: ordered, state, retried: false };
  const cleared: RouteFailures = { failed: new Set(), directFailed: state.directFailed };
  return { candidates: rankedRoutes(c, supported, cleared.failed), state: cleared, retried: true };
}

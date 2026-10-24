// Route admission (fm-4umi): which provider runs each operation (face generation, photo encode, morph), decided as a
// pure function of capability values and qualified evidence, never of phone/desktop labels, viewport or touch.
// Every decision is one typed event; every refusal carries its reason as data (key, sentence, Help anchor), never
// a runtime exception's text. fm-lt2p wires this into the runtime and bridge.
//
// Candidate facts kept: the adapter is probed (requestAdapter) before any GPU asset is acquired, since
// `navigator.gpu` alone once cost ~180 MiB of Simulator downloads; the bounded WebGPU route needs 128 MiB storage
// bindings and buffers (webgpu-engine.mjs); WebGPU then CPU, no native fallback, a healthy slow GPU is not demoted;
// a GPU failure falls back to the qualified CPU route as a declared transition. The photo encoder stream is admitted
// on constrained memory only when its manifest says `phoneAdmitted` (scope friends-and-family-candidate), within
// its 268,435,456-byte WASM limit. Quick product admission is separate from the lab's full numerical checks.

export type Operation = 'face' | 'photo-encode' | 'morph';
export type RequestedRoute = 'auto' | 'cpu' | 'webgpu';
export type Provider = 'cpu' | 'webgpu';

/** What the page can read without loading a model (see apps/web/test/admission/capture-capabilities.mjs). */
export interface CapabilityRecord {
  /** 'absent': no navigator.gpu. `adapter: null`: requestAdapter() returned none. */
  readonly webgpu:
    | 'absent'
    | {
        readonly adapter: null | {
          readonly limits: { readonly maxBufferSize: number; readonly maxStorageBufferBindingSize: number };
          readonly features: readonly string[];
          /** A software (fallback) adapter is not a GPU route. */
          readonly fallback: boolean | null;
        };
      };
  readonly wasm: { readonly simd: boolean; readonly threads: boolean; readonly maxMemoryBytes: number };
  readonly crossOriginIsolated: boolean;
  readonly deviceMemoryGiB: number | null;
  readonly videoEncoder: 'absent' | { readonly avc1024: boolean; readonly avc512: boolean };
}

/** Qualified runtime/model evidence and what has happened on this device in this session. */
export interface AdmissionEvidence {
  readonly modelIdentity: string;
  readonly runtimeIdentity: string;
  /** The generator's correctness canary per route; 'not-run' until it runs. */
  readonly canary: { readonly webgpu: 'passed' | 'failed' | 'not-run'; readonly cpu: 'passed' | 'failed' | 'not-run' };
  /** The WebGPU device was lost in this session (stage where it happened). */
  readonly deviceLost: null | { readonly stage: string };
  readonly encoderStream: null | {
    readonly phoneAdmitted: boolean;
    readonly maxWasmBytes: number;
    readonly scope: string;
  };
  /** The FFmpeg WASM codec is in the runtime manifest (the fallback when WebCodecs cannot encode). */
  readonly ffmpegCodec: boolean;
}

export const WEBGPU_MIN_BINDING_BYTES = 128 * 1024 * 1024;
export const E4E_MAX_WASM_BYTES = 268_435_456;
/** At or below this device memory the encoder stream needs its constrained-memory admission. */
export const CONSTRAINED_MEMORY_GIB = 4;

export type ReasonKey =
  | 'webgpu-absent'
  | 'webgpu-no-adapter'
  | 'webgpu-software-adapter'
  | 'webgpu-limits'
  | 'webgpu-canary-failed'
  | 'webgpu-device-lost'
  | 'cpu-wasm-unavailable'
  | 'cpu-canary-failed'
  | 'encoder-not-delivered'
  | 'encoder-memory'
  | 'encoder-not-admitted-constrained'
  | 'generator-not-admitted'
  | 'codec-unavailable'
  | 'unknown-failure';

export interface RefusalReason {
  readonly reasonKey: ReasonKey;
  /** Plain sentence; placeholder per key until provider.copy lands. */
  readonly text: string;
  readonly helpAnchor: `#help-${string}`;
}

const TEXT: Readonly<Record<ReasonKey, string>> = Object.freeze({
  'webgpu-absent': 'This browser does not offer WebGPU.',
  'webgpu-no-adapter': 'This browser offers WebGPU but has no graphics adapter for it.',
  'webgpu-software-adapter': 'WebGPU here runs in software, which is not a graphics route.',
  'webgpu-limits': 'This graphics adapter cannot hold the model.',
  'webgpu-canary-failed': 'The graphics route gave wrong results on the check face.',
  'webgpu-device-lost': 'The graphics device stopped working.',
  'cpu-wasm-unavailable': 'This browser cannot run the processor route.',
  'cpu-canary-failed': 'The processor route gave wrong results on the check face.',
  'encoder-not-delivered': 'Photo encoding is not available in this version.',
  'encoder-memory': 'This browser cannot reserve the memory photo encoding needs.',
  'encoder-not-admitted-constrained': 'Photo encoding is not yet admitted on devices with this little memory.',
  'generator-not-admitted': 'Faces cannot be made in this browser, so neither can a morph.',
  'codec-unavailable': 'This browser cannot encode the morph video.',
  'unknown-failure': 'Something went wrong on this route.',
});

export const reason = (reasonKey: ReasonKey): RefusalReason => ({ reasonKey, text: TEXT[reasonKey], helpAnchor: `#help-${reasonKey}` });

/** Maps a thrown runtime error to a known key; the error's own text never becomes the reason. */
export function reasonFromError(error: unknown): RefusalReason {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/device lost/i.test(message)) return reason('webgpu-device-lost');
  if (/needs 128 MiB|maxStorageBufferBindingSize|maxBufferSize|limit/i.test(message)) return reason('webgpu-limits');
  if (/canary|correctness/i.test(message)) return reason('webgpu-canary-failed');
  if (/WebAssembly\.Memory|out of memory|memory access out of bounds|RangeError: .*memory/i.test(message)) return reason('encoder-memory');
  return reason('unknown-failure');
}

export interface Fallback {
  readonly kind: 'gpu-failure-to-cpu';
  readonly stage: string;
  readonly from: RefusalReason;
}

/** One per admitted or refused operation. */
export interface AdmissionEvent {
  readonly operation: Operation;
  readonly requestedProvider: RequestedRoute;
  readonly provider: Provider | null;
  readonly fallback: Fallback | null;
  readonly reasonKey: ReasonKey | null;
  readonly modelIdentity: string;
  readonly runtimeIdentity: string;
  readonly authorizationScope: string | null;
}

export type Admission =
  | { readonly status: 'admitted'; readonly provider: Provider; readonly fallback: Fallback | null; readonly event: AdmissionEvent }
  | { readonly status: 'refused'; readonly reason: RefusalReason; readonly event: AdmissionEvent };

/** Why WebGPU cannot run the generator here, or null when it can. */
function webgpuRefusal(caps: CapabilityRecord, ev: AdmissionEvidence): RefusalReason | null {
  if (caps.webgpu === 'absent') return reason('webgpu-absent');
  const a = caps.webgpu.adapter;
  if (a === null) return reason('webgpu-no-adapter');
  if (a.fallback === true) return reason('webgpu-software-adapter');
  if (a.limits.maxStorageBufferBindingSize < WEBGPU_MIN_BINDING_BYTES || a.limits.maxBufferSize < WEBGPU_MIN_BINDING_BYTES)
    return reason('webgpu-limits');
  if (ev.deviceLost) return reason('webgpu-device-lost');
  if (ev.canary.webgpu === 'failed') return reason('webgpu-canary-failed');
  return null;
}

function cpuRefusal(caps: CapabilityRecord, ev: AdmissionEvidence): RefusalReason | null {
  if (!caps.wasm.simd) return reason('cpu-wasm-unavailable');
  if (ev.canary.cpu === 'failed') return reason('cpu-canary-failed');
  return null;
}

const event = (
  operation: Operation,
  requested: RequestedRoute,
  ev: AdmissionEvidence,
  provider: Provider | null,
  fallback: Fallback | null,
  refusal: RefusalReason | null,
  authorizationScope: string | null = null,
): AdmissionEvent => ({
  operation,
  requestedProvider: requested,
  provider,
  fallback,
  reasonKey: refusal?.reasonKey ?? fallback?.from.reasonKey ?? null,
  modelIdentity: ev.modelIdentity,
  runtimeIdentity: ev.runtimeIdentity,
  authorizationScope,
});

function generator(operation: Operation, requested: RequestedRoute, caps: CapabilityRecord, ev: AdmissionEvidence): Admission {
  const gpu = webgpuRefusal(caps, ev);
  const cpu = cpuRefusal(caps, ev);
  const refuse = (r: RefusalReason): Admission => ({ status: 'refused', reason: r, event: event(operation, requested, ev, null, null, r) });
  const admit = (provider: Provider, fallback: Fallback | null = null): Admission => ({
    status: 'admitted',
    provider,
    fallback,
    event: event(operation, requested, ev, provider, fallback, null),
  });
  if (requested === 'cpu') return cpu ? refuse(cpu) : admit('cpu');
  if (requested === 'webgpu' && gpu) return refuse(gpu);
  if (!gpu) return admit('webgpu');
  if (cpu) return refuse(cpu);
  // auto: WebGPU unavailable or failed. A failure after it was admitted (device loss, failed canary) is the
  // declared GPU-to-CPU transition; a WebGPU route that never existed is just the CPU route.
  const failed = gpu.reasonKey === 'webgpu-device-lost' || gpu.reasonKey === 'webgpu-canary-failed';
  return admit('cpu', failed ? { kind: 'gpu-failure-to-cpu', stage: ev.deviceLost?.stage ?? 'canary', from: gpu } : null);
}

/** The admission for one operation. Generator admission says nothing about the encoder or the codec. */
export function admit(operation: Operation, requested: RequestedRoute, caps: CapabilityRecord, ev: AdmissionEvidence): Admission {
  if (operation === 'face') return generator('face', requested, caps, ev);
  if (operation === 'photo-encode') {
    const refuse = (r: RefusalReason, scope: string | null = null): Admission => ({
      status: 'refused',
      reason: r,
      event: event('photo-encode', requested, ev, null, null, r, scope),
    });
    const stream = ev.encoderStream;
    if (!stream) return refuse(reason('encoder-not-delivered'));
    if (!caps.wasm.simd) return refuse(reason('cpu-wasm-unavailable'), stream.scope);
    if (caps.wasm.maxMemoryBytes < Math.min(stream.maxWasmBytes, E4E_MAX_WASM_BYTES)) return refuse(reason('encoder-memory'), stream.scope);
    const constrained = caps.deviceMemoryGiB !== null && caps.deviceMemoryGiB <= CONSTRAINED_MEMORY_GIB;
    if (constrained && !stream.phoneAdmitted) return refuse(reason('encoder-not-admitted-constrained'), stream.scope);
    // The encoder stream runs on the CPU (WASM) route only.
    return { status: 'admitted', provider: 'cpu', fallback: null, event: event('photo-encode', requested, ev, 'cpu', null, null, stream.scope) };
  }
  const faces = generator('morph', requested, caps, ev);
  if (faces.status === 'refused') {
    const r = reason('generator-not-admitted');
    return { status: 'refused', reason: r, event: event('morph', requested, ev, null, null, r) };
  }
  const webcodecs = caps.videoEncoder !== 'absent' && (caps.videoEncoder.avc1024 || caps.videoEncoder.avc512);
  if (!webcodecs && !ev.ffmpegCodec) {
    const r = reason('codec-unavailable');
    return { status: 'refused', reason: r, event: event('morph', requested, ev, null, null, r) };
  }
  return faces;
}

/** A control's state: disabled for a capability reason only with that reason; other causes carry none. */
export type ActionState =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly cause: 'capability'; readonly reason: RefusalReason }
  | { readonly enabled: false; readonly cause: 'busy' | 'input' };

export function actionState(admission: Admission): ActionState {
  return admission.status === 'admitted' ? { enabled: true } : { enabled: false, cause: 'capability', reason: admission.reason };
}

/** The diagnostics stage for an admission, with only fields the collector already allows. */
export function reportingStage(a: Admission): { stage: 'route-admitted'; provider?: Provider; gpu: 'webgpu' | 'none'; routeOutcome: 'admitted' | 'canary-failed' | 'unsupported' | 'start-failed' } {
  const gpu: 'webgpu' | 'none' = a.event.requestedProvider === 'cpu' && a.status === 'admitted' ? 'none' : a.event.reasonKey === 'webgpu-absent' ? 'none' : 'webgpu';
  if (a.status === 'admitted') return { stage: 'route-admitted', provider: a.provider, gpu, routeOutcome: 'admitted' };
  const key = a.reason.reasonKey;
  const routeOutcome = key.endsWith('canary-failed') ? 'canary-failed' : key === 'webgpu-device-lost' || key === 'unknown-failure' ? 'start-failed' : 'unsupported';
  return { stage: 'route-admitted', gpu, routeOutcome };
}

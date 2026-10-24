// Route admission (fm-4umi): a pure function of capability values, tested on capability records captured from real
// browsers on the lab machines (capabilities/*.json, captured by capture-capabilities.mjs) and on edge values
// derived from them. Admission events go through the collector's own validator (hosting/next-cloudflare).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import {
  CONSTRAINED_MEMORY_GIB,
  E4E_MAX_WASM_BYTES,
  WEBGPU_MIN_BINDING_BYTES,
  actionState,
  admit,
  reason,
  reasonFromError,
  reportingStage,
  type ActionState,
  type AdmissionEvidence,
  type CapabilityRecord,
  type Operation,
} from '../../src/admission/route-admission.ts';

const { checkedEvent } = (await import(
  new URL('../../hosting/next-cloudflare/validation.mjs', import.meta.url).href
)) as {
  checkedEvent: (e: object) => unknown;
};

const dir = new URL('./capabilities/', import.meta.url);
const captured = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [
      f.replace(/\.json$/, ''),
      JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as {
        browser: string;
        record: CapabilityRecord & { userAgent: string };
      },
    ]),
);
const caps = (name: string): CapabilityRecord => captured[name]!.record;

const evidence = (over: Partial<AdmissionEvidence> = {}): AdmissionEvidence => ({
  modelIdentity: 'ffhq-1024-v1',
  runtimeIdentity: 'd9e37e50',
  canary: { webgpu: 'not-run', cpu: 'not-run' },
  deviceLost: null,
  encoderStream: {
    phoneAdmitted: true,
    maxWasmBytes: E4E_MAX_WASM_BYTES,
    scope: 'friends-and-family-candidate',
  },
  ffmpegCodec: true,
  ...over,
});
const gpuAdapter = (
  over: Partial<{
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    fallback: boolean;
  }> = {},
): CapabilityRecord['webgpu'] => ({
  adapter: {
    limits: {
      maxBufferSize: over.maxBufferSize ?? 2 ** 31,
      maxStorageBufferBindingSize: over.maxStorageBufferBindingSize ?? 2 ** 31,
    },
    features: [],
    fallback: over.fallback ?? false,
  },
});
const OPS: Operation[] = ['face', 'photo-encode', 'morph'];

test('captured records: real browsers on eris admit each operation by capability alone', () => {
  assert.ok(Object.keys(captured).length >= 3, 'records from at least three real browsers');
  // Headless Chromium: navigator.gpu exists, requestAdapter() returns null -> CPU, no fallback transition.
  const chromium = caps('eris-playwright-chromium');
  assert.deepEqual(chromium.webgpu, { adapter: null });
  const face = admit('face', 'auto', chromium, evidence());
  assert.equal(face.status === 'admitted' && face.provider, 'cpu');
  assert.equal(face.event.fallback, null);
  assert.equal(face.event.reasonKey, null);
  // Firefox: no navigator.gpu at all.
  assert.equal(caps('eris-playwright-firefox').webgpu, 'absent');
  assert.equal(
    admit('face', 'webgpu', caps('eris-playwright-firefox'), evidence()).status,
    'refused',
  );
  // WebKit: no WebCodecs H.264, so a morph needs the FFmpeg codec; without it the morph alone is refused.
  const webkit = caps('eris-playwright-webkit');
  assert.equal(admit('morph', 'auto', webkit, evidence()).status, 'admitted');
  const noCodec = admit('morph', 'auto', webkit, evidence({ ffmpegCodec: false }));
  assert.equal(noCodec.status === 'refused' && noCodec.reason.reasonKey, 'codec-unavailable');
  assert.equal(
    admit('face', 'auto', webkit, evidence({ ffmpegCodec: false })).status,
    'admitted',
    'face generation does not need the codec',
  );
  // A real adapter (system Chromium on the RTX 2080 SUPER) admits WebGPU first, where it was captured.
  if (captured['eris-chromium-webgpu']) {
    const gpu = admit('face', 'auto', caps('eris-chromium-webgpu'), evidence());
    assert.equal(gpu.status === 'admitted' && gpu.provider, 'webgpu');
  }
  // The lab phone (Chrome on the P30 Pro, no WebGPU debug flags): an adapter-less navigator.gpu, 8 GiB, H.264.
  if (captured['lab-phone-chrome']) {
    const phone = caps('lab-phone-chrome');
    for (const op of OPS)
      assert.equal(admit(op, 'auto', phone, evidence()).event.provider, 'cpu', `phone ${op}`);
    const strict = evidence({
      encoderStream: { phoneAdmitted: false, maxWasmBytes: E4E_MAX_WASM_BYTES, scope: 'none' },
    });
    assert.equal(
      admit('photo-encode', 'auto', phone, strict).status,
      phone.deviceMemoryGiB !== null && phone.deviceMemoryGiB <= CONSTRAINED_MEMORY_GIB
        ? 'refused'
        : 'admitted',
      'decided by memory, not by being a phone',
    );
  }
  // Admission never reads the user agent: blanking it changes nothing.
  for (const [name, doc] of Object.entries(captured))
    for (const op of OPS)
      assert.deepEqual(
        admit(op, 'auto', { ...doc.record, userAgent: '' } as CapabilityRecord, evidence()),
        admit(op, 'auto', doc.record, evidence()),
        `${name} ${op}`,
      );
});

test('edge values: null adapter, insufficient limits, software adapter, failed canary, device loss', () => {
  const base = caps('eris-playwright-chromium');
  const withGpu = (webgpu: CapabilityRecord['webgpu']) => ({ ...base, webgpu });
  const first = admit('face', 'auto', withGpu(gpuAdapter()), evidence());
  assert.equal(first.status === 'admitted' && first.provider, 'webgpu');
  const limited = admit(
    'face',
    'webgpu',
    withGpu(gpuAdapter({ maxStorageBufferBindingSize: WEBGPU_MIN_BINDING_BYTES - 1 })),
    evidence(),
  );
  assert.equal(limited.status === 'refused' && limited.reason.reasonKey, 'webgpu-limits');
  const buffer = admit(
    'face',
    'webgpu',
    withGpu(gpuAdapter({ maxBufferSize: WEBGPU_MIN_BINDING_BYTES - 1 })),
    evidence(),
  );
  assert.equal(
    buffer.status === 'refused' && buffer.reason.reasonKey,
    'webgpu-limits',
    'maxBufferSize checked separately',
  );
  assert.equal(
    admit('face', 'auto', withGpu(gpuAdapter({ fallback: true })), evidence()).event.provider,
    'cpu',
  );
  const canary = admit(
    'face',
    'auto',
    withGpu(gpuAdapter()),
    evidence({ canary: { webgpu: 'failed', cpu: 'not-run' } }),
  );
  assert.deepEqual(
    canary.status === 'admitted' && [
      canary.provider,
      canary.fallback?.kind,
      canary.fallback?.stage,
    ],
    ['cpu', 'gpu-failure-to-cpu', 'canary'],
  );
  const lost = admit(
    'face',
    'auto',
    withGpu(gpuAdapter()),
    evidence({ deviceLost: { stage: 'synthesis' } }),
  );
  assert.deepEqual(
    lost.status === 'admitted' && [lost.provider, lost.fallback?.stage, lost.event.reasonKey],
    ['cpu', 'synthesis', 'webgpu-device-lost'],
  );
  // A healthy GPU that is merely slow is never demoted: speed is not an input.
  assert.equal(
    admit(
      'face',
      'auto',
      withGpu(gpuAdapter()),
      evidence({ canary: { webgpu: 'passed', cpu: 'passed' } }),
    ).event.provider,
    'webgpu',
  );
  // Requested CPU is honoured even where WebGPU is available; requested WebGPU is never silently swapped.
  assert.equal(admit('face', 'cpu', withGpu(gpuAdapter()), evidence()).event.provider, 'cpu');
  assert.equal(admit('face', 'webgpu', withGpu({ adapter: null }), evidence()).status, 'refused');
  const noWasm = admit(
    'face',
    'auto',
    { ...base, wasm: { ...base.wasm, simd: false } },
    evidence(),
  );
  assert.equal(noWasm.status === 'refused' && noWasm.reason.reasonKey, 'cpu-wasm-unavailable');
});

test('encoder unavailable while the generator is admitted: each operation answers for itself', () => {
  const base = caps('eris-playwright-chromium');
  const noStream = evidence({ encoderStream: null });
  assert.equal(admit('face', 'auto', base, noStream).status, 'admitted');
  const photo = admit('photo-encode', 'auto', base, noStream);
  assert.equal(photo.status === 'refused' && photo.reason.reasonKey, 'encoder-not-delivered');
  assert.equal(admit('morph', 'auto', base, noStream).status, 'admitted');
  const small = admit(
    'photo-encode',
    'auto',
    { ...base, wasm: { ...base.wasm, maxMemoryBytes: 128 * 1024 * 1024 } },
    evidence(),
  );
  assert.equal(small.status === 'refused' && small.reason.reasonKey, 'encoder-memory');
  const constrained = { ...base, deviceMemoryGiB: CONSTRAINED_MEMORY_GIB };
  const notAdmitted = admit(
    'photo-encode',
    'auto',
    constrained,
    evidence({
      encoderStream: { phoneAdmitted: false, maxWasmBytes: E4E_MAX_WASM_BYTES, scope: 'none' },
    }),
  );
  assert.equal(
    notAdmitted.status === 'refused' && notAdmitted.reason.reasonKey,
    'encoder-not-admitted-constrained',
  );
  const admitted = admit('photo-encode', 'webgpu', constrained, evidence());
  assert.deepEqual(
    admitted.status === 'admitted' && [admitted.provider, admitted.event.authorizationScope],
    ['cpu', 'friends-and-family-candidate'],
  );
});

test('event shape: operation, requested route, actual provider, fallback and refusal reason for every case', () => {
  const records = [
    ...Object.values(captured).map((c) => c.record),
    { ...caps('eris-playwright-chromium'), webgpu: gpuAdapter() },
  ];
  const evs = [
    evidence(),
    evidence({ canary: { webgpu: 'failed', cpu: 'not-run' } }),
    evidence({ encoderStream: null, ffmpegCodec: false }),
  ];
  for (const r of records)
    for (const ev of evs)
      for (const op of OPS)
        for (const requested of ['auto', 'cpu', 'webgpu'] as const) {
          const a = admit(op, requested, r, ev);
          assert.deepEqual(Object.keys(a.event).sort(), [
            'authorizationScope',
            'fallback',
            'modelIdentity',
            'operation',
            'provider',
            'reasonKey',
            'requestedProvider',
            'runtimeIdentity',
          ]);
          assert.equal(a.event.operation, op);
          assert.equal(a.event.requestedProvider, requested);
          if (a.status === 'refused') {
            assert.equal(a.event.provider, null);
            assert.equal(a.event.reasonKey, a.reason.reasonKey);
            assert.match(a.reason.helpAnchor, /^#help-/);
            assert.ok(a.reason.text.length > 10);
          } else assert.ok(a.event.provider === 'cpu' || a.event.provider === 'webgpu');
          // The collector accepts the report exactly as the allowlist stands.
          checkedEvent({
            schemaVersion: 1,
            session: '76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',
            run: '76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',
            event: 'stage',
            action: 'faces',
            ...reportingStage(a),
          });
        }
  // Historical reports that named the retired WebGL route still parse.
  checkedEvent({
    schemaVersion: 1,
    session: '76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',
    run: '76d02e92-9e4f-4dd1-8a0d-8254a1568fbc',
    event: 'stage',
    action: 'faces',
    stage: 'route-admitted',
    provider: 'webgl',
    gpu: 'webgpu',
    routeOutcome: 'admitted',
  });
});

test('refusal reasons: a key, a sentence and a Help anchor; thrown errors map to known keys, never their text', () => {
  const lost = reasonFromError(new Error('WebGPU device lost: destroyed by the driver at 0x7f3a'));
  assert.equal(lost.reasonKey, 'webgpu-device-lost');
  assert.doesNotMatch(lost.text, /0x7f3a|driver/);
  assert.equal(
    reasonFromError(
      new DOMException('The bounded WebGPU route needs 128 MiB buffers', 'NotSupportedError'),
    ).reasonKey,
    'webgpu-limits',
  );
  assert.equal(
    reasonFromError(new RangeError('WebAssembly.Memory(): could not allocate memory')).reasonKey,
    'encoder-memory',
  );
  assert.equal(reasonFromError('weird').reasonKey, 'unknown-failure');
  assert.deepEqual(
    actionState(
      admit(
        'photo-encode',
        'auto',
        caps('eris-playwright-chromium'),
        evidence({ encoderStream: null }),
      ),
    ),
    {
      enabled: false,
      cause: 'capability',
      reason: reason('encoder-not-delivered'),
    },
  );
});

// A control disabled for a capability reason must carry the reason.
// @ts-expect-error capability-disabled without a reason does not type-check
export const missingReason: ActionState = { enabled: false, cause: 'capability' };
export const busy: ActionState = { enabled: false, cause: 'busy' };

test('route-admission.ts reads no labels, viewport or touch', () => {
  const src = readFileSync(
    new URL('../../src/admission/route-admission.ts', import.meta.url),
    'utf8',
  ).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(
    src,
    /userAgent|android|ios\b|iphone|mobile|phone(?!Admitted)|desktop|innerWidth|matchMedia|maxTouchPoints|ontouch/i,
  );
});
